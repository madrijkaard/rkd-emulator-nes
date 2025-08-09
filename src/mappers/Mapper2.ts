// src/mappers/Mapper2.ts
import type { Mapper } from './Mapper';
import { Mirroring } from './Mirroring';

/**
 * Mapper 2 — UxROM / UNROM (PRG 16KB com banco selecionável + último banco fixo, CHR-RAM/ROM sem banking)
 *
 * Características:
 * - CPU:
 *   - $6000-$7FFF: PRG-RAM (8KB, leitura/escrita)
 *   - $8000-$BFFF: PRG-ROM 16KB selecionável (banco baixo)
 *   - $C000-$FFFF: PRG-ROM 16KB fixo (último banco)
 *   - Escrever em $8000-$FFFF seleciona o banco de 16KB do range $8000-$BFFF.
 *     Convencionalmente usam 4 ou 5 bits; aqui normalizamos com `% prgBankCount16k`.
 *
 * - PPU:
 *   - $0000-$1FFF: CHR — se a ROM não trouxer CHR, alocamos CHR-RAM 8KB (read/write).
 *     Não há troca de bancos de CHR no Mapper 2.
 *
 * - Mirroring:
 *   - Fixo pelo cabeçalho (Horizontal/Vertical/FourScreen). Não há registrador de mirroring aqui.
 */
export class Mapper2 implements Mapper {
  readonly mapperId = 2;

  // ---- PRG/CHR ----
  private prgRom: Uint8Array;
  private prgRam = new Uint8Array(8 * 1024); // $6000-$7FFF (algumas placas não têm; aqui mantemos para compat)
  private chr: Uint8Array;                    // CHR-ROM ou CHR-RAM (8KB se CHR ausente)
  private chrIsRam: boolean;

  // ---- Bancos PRG (16KB) ----
  private prgBankCount16k: number;
  private selectedBank = 0;        // banco de 16KB para $8000-$BFFF
  private fixedLastBank: number;   // banco fixo de 16KB para $C000-$FFFF

  // ---- Mirroring ----
  private mirroring: Mirroring;

  constructor(prgRom: Uint8Array, chrRom: Uint8Array, mirroring: Mirroring) {
    this.prgRom = prgRom;

    // PRG em bancos de 16KB (0x4000)
    this.prgBankCount16k = this.prgRom.length >> 14; // / 16384
    this.fixedLastBank = Math.max(0, this.prgBankCount16k - 1);

    // CHR: se a ROM não trouxe CHR, alocamos CHR-RAM de 8KB
    this.chrIsRam = chrRom.length === 0;
    this.chr = this.chrIsRam ? new Uint8Array(8 * 1024) : chrRom;

    this.mirroring = mirroring;
  }

  // ===================== Controle / Estado =====================

  reset(): void {
    // PRG-RAM limpa
    this.prgRam.fill(0);

    // CHR-RAM (se existir) limpa
    if (this.chrIsRam) this.chr.fill(0);

    // Banco selecionável volta para 0 (com proteção caso a ROM seja minúscula)
    this.selectedBank = 0;
    if (this.prgBankCount16k > 0) {
      this.selectedBank %= this.prgBankCount16k;
    } else {
      this.selectedBank = 0;
    }
  }

  getMirroring(): Mirroring {
    return this.mirroring;
  }

  // ===================== CPU space (0x0000–0xFFFF) =====================

  cpuRead(addr: number): number {
    addr &= 0xFFFF;

    // $6000-$7FFF: PRG-RAM (quando presente — aqui sempre exposta)
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      return this.prgRam[addr - 0x6000];
    }

    // $8000-$FFFF: PRG-ROM (duas janelas de 16KB)
    if (addr >= 0x8000) {
      if (this.prgBankCount16k === 0) return 0;

      const inner = addr & 0x3FFF; // offset dentro da janela de 16KB
      const isHighWindow = addr >= 0xC000;

      const bank = isHighWindow ? this.fixedLastBank
                                : (this.selectedBank % this.prgBankCount16k);

      const offset = (bank << 14) | inner; // bank * 16KB + inner
      return this.prgRom[offset] ?? 0;
    }

    // Fora do escopo do mapper
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    addr &= 0xFFFF;
    value &= 0xFF;

    // $6000-$7FFF: PRG-RAM write
    if (addr >= 0x6000 && addr <= 0x7FFF) {
      this.prgRam[addr - 0x6000] = value;
      return;
    }

    // $8000-$FFFF: selecionar banco de 16KB para $8000-$BFFF
    if (addr >= 0x8000) {
      if (this.prgBankCount16k > 0) {
        this.selectedBank = value % this.prgBankCount16k;
        // Observação: UxROM tradicional deixa o último banco fixo em $C000-$FFFF,
        // mas o valor escrito pode endereçar qualquer banco para a janela baixa.
        // Alguns boards usam apenas 4 ou 5 bits; o % já normaliza qualquer valor.
      } else {
        this.selectedBank = 0;
      }
      return;
    }

    // Demais áreas não-controladas pelo mapper: ignorar
  }

  // ===================== PPU space (0x0000–0x3FFF) =====================

  ppuRead(addr: number): number {
    addr &= 0x3FFF;

    // $0000-$1FFF: CHR (pattern tables)
    if (addr < 0x2000) {
      // Sem banking de CHR no mapper 2
      return this.chr[addr] ?? 0;
    }

    // Nametables/palette são resolvidos pela PPU
    return 0;
  }

  ppuWrite(addr: number, value: number): void {
    addr &= 0x3FFF;
    value &= 0xFF;

    // $0000-$1FFF: CHR-RAM (se presente)
    if (addr < 0x2000) {
      if (this.chrIsRam) {
        this.chr[addr] = value;
      }
      // Se CHR-ROM, ignora (somente leitura)
      return;
    }

    // Nametables/palette são resolvidos pela PPU
  }
}
