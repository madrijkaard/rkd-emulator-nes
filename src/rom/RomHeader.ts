/** Classe utilitária para representar o cabeçalho iNES / NES 2.0 */
export class RomHeader {
  readonly prgRomSize: number
  readonly chrRomSize: number
  readonly flags6: number
  readonly flags7: number
  readonly mapper: number
  readonly hasTrainer: boolean
  readonly fourScreen: boolean
  readonly batteryBacked: boolean
  readonly verticalMirroring: boolean

  /** Offsets já considerando trainer (se houver) */
  readonly headerSize = 16
  readonly trainerSize: number
  readonly prgStart: number
  readonly chrStart: number

  /** Detecção simples de NES 2.0 (opcional, mantemos compatibilidade) */
  readonly isNES2: boolean

  constructor(private buffer: Uint8Array) {
    if (
      buffer.length < 16 ||
      buffer[0] !== 0x4e || // 'N'
      buffer[1] !== 0x45 || // 'E'
      buffer[2] !== 0x53 || // 'S'
      buffer[3] !== 0x1a
    ) {
      throw new Error('Arquivo .nes inválido: cabeçalho iNES não encontrado.')
    }

    this.flags6 = buffer[6]
    this.flags7 = buffer[7]

    // NES 2.0 é indicado por bits 2-3 de flags7 == 0b10 (valor 0x08 no mask 0x0C)
    this.isNES2 = (this.flags7 & 0x0c) === 0x08

    // Tamanhos PRG/CHR
    if (this.isNES2) {
      // NES 2.0: bits extras em bytes 9 (para PRG) e 10 (para CHR) — formato “exponent-multiplier” existe,
      // mas aqui usamos a forma base de 12-bit: lower 8 em [4]/[5] e upper 4 em [9] low-nibble/[10] low-nibble
      const prgLow = buffer[4]
      const chrLow = buffer[5]
      const upper = buffer[9] & 0x0f // high nibble compartilhado (4 bits)
      const prgBanks = (upper << 8) | prgLow
      const chrBanks = ((buffer[10] & 0x0f) << 8) | chrLow

      this.prgRomSize = prgBanks * 16 * 1024
      this.chrRomSize = chrBanks * 8 * 1024
    } else {
      // iNES 1.0
      this.prgRomSize = buffer[4] * 16 * 1024
      this.chrRomSize = buffer[5] * 8 * 1024
    }

    // Bits úteis do flags6
    this.verticalMirroring = (this.flags6 & 0x01) !== 0
    this.batteryBacked   = (this.flags6 & 0x02) !== 0
    this.hasTrainer      = (this.flags6 & 0x04) !== 0
    this.fourScreen      = (this.flags6 & 0x08) !== 0

    // Mapper ID
    if (this.isNES2) {
      // NES 2.0: mapper usa high-nibbles de flags6/flags7 + 4 bits extras em byte 8 low-nibble
      const lo = (this.flags6 >> 4) & 0x0f
      const mid = (this.flags7 >> 4) & 0x0f
      const hi = buffer[8] & 0x0f
      this.mapper = (hi << 8) | (mid << 4) | lo
    } else {
      // iNES 1.0: high nibble de flags7 + high nibble de flags6
      this.mapper = ((this.flags7 >> 4) << 4) | (this.flags6 >> 4)
    }

    // Offsets (considerando trainer opcional de 512 bytes logo após o header)
    this.trainerSize = this.hasTrainer ? 512 : 0
    this.prgStart = this.headerSize + this.trainerSize
    this.chrStart = this.prgStart + this.prgRomSize
  }
}
