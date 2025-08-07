import type { Mapper } from './Mapper'
/**
 * Mapper 0 (NROM): sem bank switching.
 * - PRG-ROM: 16KB ou 32KB
 * - Se 16KB, espelha 0x8000–0xBFFF em 0xC000–0xFFFF
 * - Opcionalmente PRG-RAM em 0x6000–0x7FFF (8KB; aqui criamos sempre)
 */
export class Mapper0 implements Mapper {
  readonly mapperId = 0

  private prgRom: Uint8Array
  private chrRom: Uint8Array
  private prgRam = new Uint8Array(8 * 1024) // 0x6000–0x7FFF

  constructor(prgRom: Uint8Array, chrRom: Uint8Array) {
    this.prgRom = prgRom
    this.chrRom = chrRom
  }

  reset(): void {
    this.prgRam.fill(0)
  }

  cpuRead(addr: number): number {
    if (addr >= 0x6000 && addr <= 0x7fff) {
      return this.prgRam[addr - 0x6000]
    }
    if (addr >= 0x8000 && addr <= 0xffff) {
      const prgSize = this.prgRom.length
      if (prgSize === 0x4000) {
        // 16KB: espelhar
        const offset = (addr - 0x8000) % 0x4000
        return this.prgRom[offset]
      } else {
        // 32KB: direto
        const offset = addr - 0x8000
        return this.prgRom[offset]
      }
    }
    // Fora da área do mapper: devolver 0 (RAM/IO devem ser tratados fora)
    return 0
  }

  cpuWrite(addr: number, value: number): void {
    if (addr >= 0x6000 && addr <= 0x7fff) {
      this.prgRam[addr - 0x6000] = value & 0xff
      return
    }
    // NROM não tem registradores de controle de bancos; ignorar writes 0x8000–0xFFFF
  }

  ppuRead(addr: number): number {
    // Para NROM, CHR-ROM/CHR-RAM mapeada a partir de 0x0000
    if (addr >= 0x0000 && addr <= 0x1fff) {
      return this.chrRom.length ? this.chrRom[addr] : 0
    }
    return 0
  }

  ppuWrite(addr: number, value: number): void {
    // Se fosse CHR-RAM, permitir writes; se CHR-ROM, ignora.
    // Neste projeto, trate como ROM (ignora).
  }
}
