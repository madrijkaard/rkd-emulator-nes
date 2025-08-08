// src/mappers/Mapper0.ts
import type { Mapper } from './Mapper';
import { Mirroring } from './Mirroring';

/**
 * Mapper 0 (NROM): não há bank switching.
 * - PRG-ROM: 16KB (NROM-128) ou 32KB (NROM-256)
 * - Se 16KB, espelha 0x8000–0xBFFF em 0xC000–0xFFFF
 * - Opcionalmente PRG-RAM em 0x6000–0x7FFF (8KB)
 * - CHR: pode ser ROM (8KB) ou RAM (8KB quando a ROM tem CHR=0)
 */
export class Mapper0 implements Mapper {
  readonly mapperId = 0;

  private prgRom: Uint8Array;
  private prgRam = new Uint8Array(8 * 1024); // 0x6000–0x7FFF

  private chr: Uint8Array;   // CHR-ROM ou CHR-RAM (8KB)
  private chrIsRam: boolean; // true quando a ROM não possui CHR (CHR=0)

  private mirroring: Mirroring;

  constructor(prgRom: Uint8Array, chrRom: Uint8Array, mirroring: Mirroring) {
    this.prgRom = prgRom;

    // Se a ROM não trouxe CHR, alocamos CHR-RAM de 8KB (comum em alguns carts)
    this.chrIsRam = chrRom.length === 0;
    this.chr = this.chrIsRam ? new Uint8Array(8 * 1024) : chrRom;

    this.mirroring = mirroring;
  }

  /** Retorna o modo de mirroring para as nametables (consultado pela PPU). */
  getMirroring(): Mirroring {
    return this.mirroring;
  }

  /** Limpa PRG-RAM e, se for CHR-RAM, zera também. */
  reset(): void {
    this.prgRam.fill(0);
    if (this.chrIsRam) this.chr.fill(0);
  }

  // ===================== CPU space (0x0000–0xFFFF) =====================

  cpuRead(addr: number): number {
    addr &= 0xffff;

    // PRG-RAM: 0x6000–0x7FFF
    if (addr >= 0x6000 && addr <= 0x7fff) {
      return this.prgRam[addr - 0x6000];
    }

    // PRG-ROM: 0x8000–0xFFFF
    if (addr >= 0x8000) {
      const prgSize = this.prgRom.length;
      if (prgSize === 0x4000) {
        // 16KB: espelhado em toda a faixa 0x8000–0xFFFF
        const offset = (addr - 0x8000) & 0x3fff;
        return this.prgRom[offset];
      } else {
        // 32KB: mapeamento direto
        const offset = (addr - 0x8000) & 0x7fff;
        return this.prgRom[offset];
      }
    }

    // Fora do espaço mapeado pelo mapper (RAM/PPU/APU são tratados pela Memory/PPU)
    return 0;
  }

  cpuWrite(addr: number, value: number): void {
    addr &= 0xffff;
    value &= 0xff;

    // PRG-RAM: 0x6000–0x7FFF (se existir; aqui consideramos sempre presente)
    if (addr >= 0x6000 && addr <= 0x7fff) {
      this.prgRam[addr - 0x6000] = value;
      return;
    }

    // NROM não possui registradores controláveis em 0x8000–0xFFFF; ignora writes.
  }

  // ===================== PPU space (0x0000–0x3FFF) =====================

  /**
   * Leitura do espaço da PPU que é responsabilidade do mapper:
   * - 0x0000–0x1FFF → CHR (pattern tables)
   * As nametables (0x2000–0x2FFF) e palettes (0x3F00–0x3F1F) são tratadas pela PPU.
   */
  ppuRead(addr: number): number {
    addr &= 0x3fff;
    if (addr < 0x2000) {
      // CHR-ROM/CHR-RAM
      return this.chr[addr];
    }
    // Fora da faixa do mapper (nametables/palettes): PPU resolve
    return 0;
  }

  /**
   * Escrita no espaço da PPU que é responsabilidade do mapper.
   * Só é efetiva quando há CHR-RAM (não ROM).
   */
  ppuWrite(addr: number, value: number): void {
    addr &= 0x3fff;
    value &= 0xff;

    if (addr < 0x2000 && this.chrIsRam) {
      this.chr[addr] = value;
    }
    // Se for CHR-ROM, ignora (somente leitura).
  }
}
