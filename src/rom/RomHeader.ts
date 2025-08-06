/** Classe utilitária para representar o cabeçalho iNES */

export class RomHeader {
  readonly prgRomSize: number
  readonly chrRomSize: number
  readonly flags6: number
  readonly flags7: number

  constructor(private buffer: Uint8Array) {
    if (
      buffer[0] !== 0x4e || // 'N'
      buffer[1] !== 0x45 || // 'E'
      buffer[2] !== 0x53 || // 'S'
      buffer[3] !== 0x1a
    ) {
      throw new Error("Arquivo .nes inválido: cabeçalho iNES não encontrado.")
    }

    this.prgRomSize = buffer[4] * 16 * 1024
    this.chrRomSize = buffer[5] * 8 * 1024
    this.flags6 = buffer[6]
    this.flags7 = buffer[7]
  }
}
