// src/mappers/Mapper4.ts
import type { Mapper } from './Mapper';
import { Mirroring } from './Mirroring';

/**
 * Mapper 4 (MMC3) — implementação mínima viável e estável:
 * - $8000 (even): bank select (bits 0-2 reg alvo; bit6 PRG mode; bit7 CHR mode)
 * - $8001 (odd) : bank data (R0..R7)
 * - $A000 (even): mirroring (0=Horizontal, 1=Vertical)
 * - $A001 (odd) : PRG-RAM protect (bit7 enable, bit6 write-protect)
 * - $C000 (even): IRQ latch
 * - $C001 (odd) : IRQ reload (recarrega na próxima A12↑)
 * - $E000 (even): IRQ disable + acknowledge (limpa pending)
 * - $E001 (odd) : IRQ enable
 *
 * PRG map (8KB):
 *  mode 0: $8000=R6, $A000=R7, $C000=second-last, $E000=last
 *  mode 1: $8000=second-last, $A000=R7, $C000=R6, $E000=last
 *
 * CHR map (1KB entradas; R0/R1 são 2KB alinhados):
 *  chrMode 0: R0@0000(2KB), R1@0800(2KB), R2@1000, R3@1400, R4@1800, R5@1C00
 *  chrMode 1: R2@0000, R3@0400, R4@0800, R5@0C00, R0@1000(2KB), R1@1800(2KB)
 */
export class Mapper4 implements Mapper {
  readonly mapperId = 4;

  private prgRom: Uint8Array;
  private chr: Uint8Array;
  private chrIsRam: boolean;

  private prgRam = new Uint8Array(8 * 1024);
  private prgRamEnable = true;
  private prgRamWriteProtect = false;

  private mirroring: Mirroring;

  // Bank regs
  private bankSelect = 0;               // $8000
  private bankRegs = new Uint8Array(8); // R0..R7 ($8001)
  private prgMode = 0;                  // $8000 bit6
  private chrMode = 0;                  // $8000 bit7

  private prgBankCount: number;         // em 8KB
  private chrBankCount1k: number;       // em 1KB
  private prgFixedLast: number;
  private prgFixedSecondLast: number;

  private prgMap = new Uint16Array(4);   // 4 janelas de 8KB → índice de banco
  private chrMap1k = new Uint16Array(8); // 8 janelas de 1KB → índice de banco

  // IRQ
  private irqLatch = 0;
  private irqCounter = 0;
  private irqReload = false;
  private irqEnabled = false;
  private irqPending = false;

  // Filtro de A12
  private lastA12 = 0;
  private a12LowStreak = 0;
  private a12Cooldown = 0; // “debounce” simples de borda

  constructor(prgRom: Uint8Array, chrRom: Uint8Array, mirroring: Mirroring) {
    this.prgRom = prgRom;
    this.chrIsRam = chrRom.length === 0;
    this.chr = this.chrIsRam ? new Uint8Array(8 * 1024) : chrRom;
    this.mirroring = mirroring;

    this.prgBankCount = this.prgRom.length >> 13; // / 0x2000 (8KB)
    this.chrBankCount1k = this.chr.length >> 10;  // / 0x400 (1KB)
    this.prgFixedLast = Math.max(0, this.prgBankCount - 1);
    this.prgFixedSecondLast = Math.max(0, this.prgBankCount - 2);
  }

  getMirroring(): Mirroring {
    return this.mirroring;
  }

  reset(): void {
    this.prgRam.fill(0);
    if (this.chrIsRam) this.chr.fill(0);

    this.bankSelect = 0;
    this.bankRegs.fill(0);
    this.prgMode = 0;
    this.chrMode = 0;

    // IRQ
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.irqPending = false;

    // A12 filtro
    this.lastA12 = 0;
    this.a12LowStreak = 0;
    this.a12Cooldown = 0;

    // Estado inicial mais compatível: R6=second-last, R7=last (se existirem)
    if (this.prgBankCount > 0) {
      this.bankRegs[6] = (this.prgBankCount > 1 ? this.prgBankCount - 2 : 0) % Math.max(1, this.prgBankCount);
      this.bankRegs[7] = (this.prgBankCount > 1 ? this.prgBankCount - 1 : 0) % Math.max(1, this.prgBankCount);
    } else {
      this.bankRegs[6] = 0;
      this.bankRegs[7] = 0;
    }

    this.recomputePrgMap();
    this.recomputeChrMap();
  }

  // ===================== CPU space =====================

  cpuRead(addr: number): number {
    addr &= 0xffff;

    if (addr >= 0x6000 && addr <= 0x7fff) {
      if (!this.prgRamEnable) return 0; // open bus simplificado
      return this.prgRam[addr - 0x6000];
    }

    if (addr >= 0x8000) {
      if (this.prgBankCount === 0) return 0;
      const window = (addr - 0x8000) >> 13; // 8KB janela 0..3
      const bank = this.prgMap[window] % this.prgBankCount;
      const offset = (bank << 13) | (addr & 0x1fff);
      return this.prgRom[offset];
    }

    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    addr &= 0xffff; value &= 0xff;

    if (addr >= 0x6000 && addr <= 0x7fff) {
      if (!this.prgRamEnable || this.prgRamWriteProtect) return;
      this.prgRam[addr - 0x6000] = value;
      return;
    }

    // $8000-$9FFF: bank select/data
    if (addr >= 0x8000 && addr <= 0x9fff) {
      if ((addr & 1) === 0) {
        // $8000 even: bank select
        this.bankSelect = value & 0x07;
        this.prgMode = (value >> 6) & 1;
        this.chrMode = (value >> 7) & 1;
        this.recomputePrgMap();
        this.recomputeChrMap();
      } else {
        // $8001 odd: bank data
        this.bankRegs[this.bankSelect] = value & 0xFF;

        // Normalização de PRG em R6/R7 (evitar overflow)
        if (this.bankSelect === 6 || this.bankSelect === 7) {
          if (this.prgBankCount > 0) {
            this.bankRegs[this.bankSelect] %= this.prgBankCount;
          } else {
            this.bankRegs[this.bankSelect] = 0;
          }
          this.recomputePrgMap();
        } else {
          // CHR mapeado em blocos de 1KB (R0/R1 precisam ser alinhados a 2KB)
          this.recomputeChrMap();
        }
      }
      return;
    }

    // $A000-$BFFF: mirroring / PRG-RAM control
    if (addr >= 0xA000 && addr <= 0xBFFF) {
      if ((addr & 1) === 0) {
        // $A000 even: mirroring (0=H, 1=V)
        this.mirroring = (value & 1) ? Mirroring.Vertical : Mirroring.Horizontal;
      } else {
        // $A001 odd: PRG-RAM control
        this.prgRamWriteProtect = (value & 0x40) !== 0;
        this.prgRamEnable = (value & 0x80) !== 0;
      }
      return;
    }

    // $C000-$DFFF: IRQ latch/reload
    if (addr >= 0xC000 && addr <= 0xDFFF) {
      if ((addr & 1) === 0) {
        // $C000 even: IRQ latch
        this.irqLatch = value & 0xff;
      } else {
        // $C001 odd: IRQ reload na próxima borda A12↑
        this.irqReload = true;
        // Alguns docs citam zerar o counter aqui; manter 0 ajuda a “forçar” reload no próximo clock
        this.irqCounter = 0;
      }
      return;
    }

    // $E000-$FFFF: IRQ disable/enable
    if (addr >= 0xE000) {
      if ((addr & 1) === 0) {
        // $E000 even: disable + acknowledge
        this.irqEnabled = false;
        this.irqPending = false; // ACK somente aqui
      } else {
        // $E001 odd: enable
        this.irqEnabled = true;
      }
    }
  }

  // ===================== PPU space (CHR) =====================

  ppuRead(addr: number): number {
    addr &= 0x3fff;
    if (addr < 0x2000) {
      this.trackA12(addr);
      if (this.chrBankCount1k === 0) return 0;
      const bank1k = (addr >> 10) & 7;
      const bank = this.chrMap1k[bank1k] % this.chrBankCount1k;
      const offset = (bank << 10) | (addr & 0x3ff);
      return this.chr[offset];
    }
    return 0;
  }

  ppuWrite(addr: number, value: number): void {
    addr &= 0x3fff; value &= 0xff;
    if (addr < 0x2000) {
      this.trackA12(addr);
      if (!this.chrIsRam) return; // CHR-ROM: ignora
      if (this.chrBankCount1k === 0) return;
      const bank1k = (addr >> 10) & 7;
      const bank = this.chrMap1k[bank1k] % this.chrBankCount1k;
      const offset = (bank << 10) | (addr & 0x3ff);
      this.chr[offset] = value;
    }
  }

  // ===================== Helpers =====================

  private recomputePrgMap(): void {
    if (this.prgBankCount === 0) {
      this.prgMap.fill(0);
      return;
    }

    const r6 = this.bankRegs[6] % this.prgBankCount;
    const r7 = this.bankRegs[7] % this.prgBankCount;

    if (this.prgMode === 0) {
      // $8000=R6, $A000=R7, $C000=-2, $E000=-1
      this.prgMap[0] = r6;
      this.prgMap[1] = r7;
      this.prgMap[2] = this.prgFixedSecondLast;
      this.prgMap[3] = this.prgFixedLast;
    } else {
      // $8000=-2, $A000=R7, $C000=R6, $E000=-1
      this.prgMap[0] = this.prgFixedSecondLast;
      this.prgMap[1] = r7;
      this.prgMap[2] = r6;
      this.prgMap[3] = this.prgFixedLast;
    }
  }

  private recomputeChrMap(): void {
    if (this.chrBankCount1k === 0) {
      this.chrMap1k.fill(0);
      return;
    }

    const r = this.bankRegs;

    if (this.chrMode === 0) {
      // R0/R1 são 2KB alinhados (mask & 0xFE)
      const r0 = (r[0] & 0xFE) % this.chrBankCount1k;
      const r1 = (r[1] & 0xFE) % this.chrBankCount1k;
      this.chrMap1k[0] = r0;
      this.chrMap1k[1] = (r0 + 1) % this.chrBankCount1k;
      this.chrMap1k[2] = r1;
      this.chrMap1k[3] = (r1 + 1) % this.chrBankCount1k;
      this.chrMap1k[4] = r[2] % this.chrBankCount1k;
      this.chrMap1k[5] = r[3] % this.chrBankCount1k;
      this.chrMap1k[6] = r[4] % this.chrBankCount1k;
      this.chrMap1k[7] = r[5] % this.chrBankCount1k;
    } else {
      const r0 = (r[0] & 0xFE) % this.chrBankCount1k;
      const r1 = (r[1] & 0xFE) % this.chrBankCount1k;
      this.chrMap1k[0] = r[2] % this.chrBankCount1k;
      this.chrMap1k[1] = r[3] % this.chrBankCount1k;
      this.chrMap1k[2] = r[4] % this.chrBankCount1k;
      this.chrMap1k[3] = r[5] % this.chrBankCount1k;
      this.chrMap1k[4] = r0;
      this.chrMap1k[5] = (r0 + 1) % this.chrBankCount1k;
      this.chrMap1k[6] = r1;
      this.chrMap1k[7] = (r1 + 1) % this.chrBankCount1k;
    }
  }

  /** Filtro simples de A12 para clockar o contador de IRQ (borda 0→1). */
  private trackA12(addr: number): void {
    const a12 = (addr & 0x1000) ? 1 : 0;

    if (this.a12Cooldown > 0) this.a12Cooldown--;

    if (a12 === 0) this.a12LowStreak++;

    if (this.lastA12 === 0 && a12 === 1) {
      // clock apenas se A12 ficou baixo "por um tempo" e sem cooldown
      if (this.a12LowStreak >= 8 && this.a12Cooldown === 0) {
        this.clockIrqCounter();
        this.a12Cooldown = 8; // debounce simples
      }
      this.a12LowStreak = 0;
    }

    this.lastA12 = a12;
  }

  /** Contador de IRQ seguindo a ordem canônica. */
  private clockIrqCounter(): void {
    let justReloaded = false;

    if (this.irqReload || this.irqCounter === 0) {
      this.irqCounter = this.irqLatch & 0xFF;
      this.irqReload = false;
      justReloaded = true;
    } else {
      this.irqCounter = (this.irqCounter - 1) & 0xFF;
    }

    // Dispara IRQ quando o contador chega a 0 por contagem,
    // ou imediatamente após reload somente se latch==0 (refinamento comum).
    if (this.irqEnabled && this.irqCounter === 0) {
      if (!justReloaded || this.irqLatch === 0) {
        this.irqPending = true; // nível permanece até ACK ($E000)
      }
    }
  }

  /** Driver chama após os passos de PPU para testar IRQ. Mantém “nível”, não limpa aqui. */
  public consumeIrq(): boolean {
    return this.irqPending;
  }
}
