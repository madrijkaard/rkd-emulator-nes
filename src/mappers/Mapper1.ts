// src/mappers/Mapper1.ts
//
// MMC1 (Nintendo SxROM)
// - Registrador de shift (5 bits) gravado via writes em $8000–$FFFF
// - CONTROL: mirroring (0..3), PRG mode (2 bits), CHR mode (1 bit)
// - CHR: 8KB ou 4KB+4KB, dependendo do CHR mode
// - PRG: 32KB ou 16KB com janela fixa no início/fim (modes 2/3)
// Observação sobre mirroring: o hardware suporta "OneScreen A/B", mas como
// a PPU atual só entende Horizontal/Vertical/FourScreen, mapeamos:
//   CONTROL.mirror = 0 (OneScreen A) → Mirroring.Horizontal (aproximação)
//   CONTROL.mirror = 1 (OneScreen B) → Mirroring.Vertical   (aproximação)
//   2 → Vertical; 3 → Horizontal
//
// Nota sobre PRG-RAM ($6000–$7FFF):
// Seu barramento atual (Memory) não delega essa faixa ao mapper, então esta
// implementação não trata PRG-RAM. Isso é condizente com Mapper0/4 no projeto.

import type { Mapper } from './Mapper';
import { Mirroring } from './Mirroring';

export class Mapper1 implements Mapper {
  // ROM/RAM
  private prg: Uint8Array;
  private chr: Uint8Array; // se vier size=0, alocamos CHR-RAM 8KB
  private hasChrRam: boolean;

  // Bancagem corrente (índices em unidades de 16KB para PRG e 4KB para CHR)
  private control = 0x0C; // reset padrão: PRG mode=3, CHR mode=0, mirror=0
  private chrBank0 = 0;
  private chrBank1 = 0;
  private prgBank = 0;

  // Janelas resolvidas (PRG: 16KB cada; CHR: 4KB cada)
  private prgBankLo = 0; // $8000–$BFFF (16KB)
  private prgBankHi = 0; // $C000–$FFFF (16KB)

  private chr4kLo = 0;   // $0000–$0FFF (4KB)
  private chr4kHi = 1;   // $1000–$1FFF (4KB)

  // Mirroring atual exposto à PPU
  private mirroring: Mirroring;

  // Shift register (5 bits) e contador de writes
  private shift = 0x10;  // bit5=1 indica "pronto para receber LSB primeiro"
  private writes = 0;    // 0..4 (na 5ª write, comita)

  constructor(prg: Uint8Array, chr: Uint8Array, defaultMirroring: Mirroring) {
    this.prg = prg;
    this.hasChrRam = chr.length === 0;
    this.chr = chr.length ? chr : new Uint8Array(8 * 1024); // CHR-RAM 8KB
    this.mirroring = defaultMirroring;
    this.reset();
  }

  // ============ Interface pública (Mapper) ============

  reset(): void {
    // Reset MMC1: shift limpo e CONTROL |= 0x0C
    this.shift = 0x10;
    this.writes = 0;

    this.control = 0x0C; // PRG mode = 3 (fixa banco alto), CHR mode = 0, mirror = 0
    this.chrBank0 = 0;
    this.chrBank1 = 0;
    this.prgBank = 0;

    // Espelhamento inicial: honrar o default passado pelo header até alguém escrever CONTROL
    this.mirroring = this.mirroring ?? Mirroring.Horizontal;

    // Resolve janelas conforme control/bancos
    this.updateBanks();
  }

  getMirroring(): Mirroring {
    return this.mirroring;
  }

  // CPU $4020–$FFFF (Memory só delega $4020+)
  cpuRead(addr: number): number {
    addr &= 0xFFFF;

    if (addr >= 0x8000) {
      const off = addr - 0x8000;
      if (off < 0x4000) {
        // $8000–$BFFF → prgBankLo (16KB)
        return this.readPrgFromBank(this.prgBankLo, off);
      } else {
        // $C000–$FFFF → prgBankHi (16KB)
        return this.readPrgFromBank(this.prgBankHi, off - 0x4000);
      }
    }

    // Demais endereços (APU/expansion/etc) não tratados aqui
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    addr &= 0xFFFF;
    value &= 0xFF;

    if (addr < 0x8000) {
      // Projeto atual não roteia PRG-RAM ($6000–$7FFF) para o mapper.
      return;
    }

    // Se bit7=1 → reset shift e força CONTROL |= 0x0C
    if (value & 0x80) {
      this.shift = 0x10;
      this.writes = 0;
      // Força PRG mode para 3 (fix high), como nos docs
      this.control |= 0x0C;
      this.applyControlSideEffects();
      this.updateBanks();
      return;
    }

    // Carrega LSB no topo do shift (MMC1: bits entram como LSB-first)
    // Implementação clássica: shift = (shift >> 1) | ((value & 1) << 4)
    const inBit = value & 1;
    this.shift = (this.shift >> 1) | (inBit << 4);
    this.writes++;

    if (this.writes === 5) {
      // Commit para o registrador selecionado por A14..A13:
      // $8000–$9FFF → CONTROL
      // $A000–$BFFF → CHR bank 0
      // $C000–$DFFF → CHR bank 1
      // $E000–$FFFF → PRG bank
      const regVal = this.shift & 0x1F;

      if ((addr & 0x6000) === 0x0000) {
        // CONTROL
        this.control = regVal;
        this.applyControlSideEffects();
      } else if ((addr & 0x6000) === 0x2000) {
        // CHR bank 0 (4KB base)
        this.chrBank0 = regVal;
      } else if ((addr & 0x6000) === 0x4000) {
        // CHR bank 1 (4KB alta)
        this.chrBank1 = regVal;
      } else {
        // PRG bank (16KB)
        this.prgBank = regVal & 0x0F; // MMC1 clássico: 4 bits efetivos para PRG
      }

      // Recalcula bancos (CHR/PRG) após qualquer commit
      this.updateBanks();

      // Reseta shift/writes
      this.shift = 0x10;
      this.writes = 0;
    }
  }

  // PPU $0000–$1FFF (CHR)
  ppuRead(addr: number): number {
    addr &= 0x1FFF;

    // 0x0000–0x0FFF → chr4kLo (4KB)
    // 0x1000–0x1FFF → chr4kHi (4KB)
    if (addr < 0x1000) {
      const base = this.chr4kLo * 0x1000;
      return this.chr[(base + addr) & (this.chr.length - 1)];
    } else {
      const base = this.chr4kHi * 0x1000;
      return this.chr[(base + (addr - 0x1000)) & (this.chr.length - 1)];
    }
  }

  ppuWrite(addr: number, value: number): void {
    addr &= 0x1FFF;
    value &= 0xFF;

    // Só permite escrita se for CHR-RAM
    if (!this.hasChrRam) return;

    if (addr < 0x1000) {
      const base = this.chr4kLo * 0x1000;
      this.chr[(base + addr) & (this.chr.length - 1)] = value;
    } else {
      const base = this.chr4kHi * 0x1000;
      this.chr[(base + (addr - 0x1000)) & (this.chr.length - 1)] = value;
    }
  }

  // ============ Internals ============

  private readPrgFromBank(bank16k: number, offsetIn16k: number): number {
    const base = (bank16k & this.prgBankMask16k()) * 0x4000;
    const idx = base + (offsetIn16k & 0x3FFF);
    return this.prg[idx & (this.prg.length - 1)];
  }

  private prgBankCount16k(): number {
    return (this.prg.length / 0x4000) | 0;
  }

  private prgBankMask16k(): number {
    // Usa máscara para wrap adequado quando banks não são potência de 2
    return this.prgBankCount16k() - 1;
  }

  private chrBankCount4k(): number {
    return (this.chr.length / 0x1000) | 0; // 4KB units
  }

  private chrBankMask4k(): number {
    return this.chrBankCount4k() - 1;
  }

  /** Aplica efeitos do CONTROL: modos e mirroring. */
  private applyControlSideEffects(): void {
    // Mirroring (bits 0..1)
    const mir = this.control & 0x03;
    switch (mir) {
      case 2: this.mirroring = Mirroring.Vertical; break;
      case 3: this.mirroring = Mirroring.Horizontal; break;
      // OneScreen A/B — aproximamos:
      case 0: this.mirroring = Mirroring.Horizontal; break; // OneScreen A ≈ Horizontal
      case 1: this.mirroring = Mirroring.Vertical;   break; // OneScreen B ≈ Vertical
    }
  }

  /** Recalcula janelas PRG (16KB) e CHR (4KB) com base nos registradores. */
  private updateBanks(): void {
    // -------- CHR --------
    const chrMode = (this.control >> 4) & 0x01; // 0: 8KB, 1: 4KB+4KB
    const chrMask = this.chrBankMask4k();

    if (chrMode === 0) {
      // 8KB: usa chrBank0 & ~1 como base para 0..1
      const base = (this.chrBank0 & ~1) & chrMask;
      this.chr4kLo = base & chrMask;
      this.chr4kHi = (base + 1) & chrMask;
    } else {
      // 4KB+4KB independentes
      this.chr4kLo = this.chrBank0 & chrMask;
      this.chr4kHi = this.chrBank1 & chrMask;
    }

    // -------- PRG --------
    const prgMode = (this.control >> 2) & 0x03;
    const prgMask = this.prgBankMask16k();
    const last = (this.prgBankCount16k() - 1) & prgMask;

    switch (prgMode) {
      case 0:
      case 1: {
        // 32KB: ignora bit0 do prgBank → par/ímpar vira par
        const base = (this.prgBank & ~1) & prgMask;
        this.prgBankLo = base & prgMask;
        this.prgBankHi = (base + 1) & prgMask;
        break;
      }
      case 2: {
        // 16KB: fixa banco 0 em $8000; comuta $C000
        this.prgBankLo = 0;
        this.prgBankHi = this.prgBank & prgMask;
        break;
      }
      case 3: {
        // 16KB: comuta $8000; fixa último banco em $C000
        this.prgBankLo = this.prgBank & prgMask;
        this.prgBankHi = last;
        break;
      }
    }
  }
}

export default Mapper1;
