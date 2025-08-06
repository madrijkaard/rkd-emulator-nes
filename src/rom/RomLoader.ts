/** Lógica de carregamento e parsing da ROM */

import { RomHeader } from './RomHeader'

export class RomLoader {
  header: RomHeader
  prgRom: Uint8Array
  chrRom: Uint8Array

  constructor(private romData: Uint8Array) {
    if (romData.length < 16) {
      throw new Error('ROM muito pequena.')
    }

    this.header = new RomHeader(romData.slice(0, 16))

    const { prgRomSize, chrRomSize } = this.header
    const prgStart = 16
    const chrStart = prgStart + prgRomSize

    if (romData.length < chrStart + chrRomSize) {
      throw new Error('ROM truncada: tamanhos inconsistentes.')
    }

    this.prgRom = romData.slice(prgStart, chrStart)
    this.chrRom = romData.slice(chrStart, chrStart + chrRomSize)
  }

  static async fromFile(file: File): Promise<RomLoader> {
    const arrayBuffer = await file.arrayBuffer()
    return new RomLoader(new Uint8Array(arrayBuffer))
  }

  static async fromUrl(url: string): Promise<RomLoader> {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new RomLoader(new Uint8Array(arrayBuffer))
  }
}

