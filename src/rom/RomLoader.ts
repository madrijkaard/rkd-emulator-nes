/** Lógica de carregamento e parsing da ROM */
import { RomHeader } from './RomHeader'

export class RomLoader {
  header: RomHeader
  prgRom: Uint8Array
  chrRom: Uint8Array
  trainer?: Uint8Array

  constructor(private romData: Uint8Array) {
    // Precisa ao menos do cabeçalho
    if (romData.length < 16) {
      throw new Error('ROM muito pequena: cabeçalho ausente.')
    }

    // Lê apenas os 16 bytes do cabeçalho (RomHeader só usa esse bloco)
    this.header = new RomHeader(romData.slice(0, 16))

    // Opcionalmente capture o trainer (512 bytes logo após o header)
    if (this.header.hasTrainer) {
      const tStart = this.header.headerSize
      const tEnd = tStart + this.header.trainerSize
      if (romData.length < tEnd) {
        throw new Error('ROM truncada: trainer declarado mas incompleto.')
      }
      this.trainer = romData.slice(tStart, tEnd)
    }

    // Offsets corretos considerando trainer
    const prgStart = this.header.prgStart
    const prgEnd = prgStart + this.header.prgRomSize
    const chrStart = this.header.chrStart
    const chrEnd = chrStart + this.header.chrRomSize

    // Valida tamanhos
    if (romData.length < prgEnd) {
      throw new Error('ROM truncada: PRG ROM incompleta.')
    }
    if (romData.length < chrEnd) {
      throw new Error('ROM truncada: CHR ROM incompleta.')
    }

    // Fatia PRG/CHR corretamente
    this.prgRom = romData.slice(prgStart, prgEnd)
    this.chrRom = romData.slice(chrStart, chrEnd)
  }

  static async fromFile(file: File): Promise<RomLoader> {
    const arrayBuffer = await file.arrayBuffer()
    return new RomLoader(new Uint8Array(arrayBuffer))
  }

  static async fromUrl(url: string): Promise<RomLoader> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Falha ao baixar ROM: ${response.status} ${response.statusText}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return new RomLoader(new Uint8Array(arrayBuffer))
  }
}
