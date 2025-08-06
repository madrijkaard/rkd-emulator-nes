import { describe, it, expect } from 'vitest'
import { RomLoader } from '../RomLoader'

function createValidRom(): Uint8Array {
  const header = new Uint8Array(16)
  header[0] = 0x4e // 'N'
  header[1] = 0x45 // 'E'
  header[2] = 0x53 // 'S'
  header[3] = 0x1a
  header[4] = 1 // PRG: 16KB
  header[5] = 1 // CHR: 8KB

  const prg = new Uint8Array(16 * 1024).fill(0xaa)
  const chr = new Uint8Array(8 * 1024).fill(0xbb)

  const rom = new Uint8Array(16 + prg.length + chr.length)
  rom.set(header, 0)
  rom.set(prg, 16)
  rom.set(chr, 16 + prg.length)
  return rom
}

describe('RomLoader', () => {
  it('carrega ROM válida', () => {
    const rom = createValidRom()
    const loader = new RomLoader(rom)

    expect(loader.header.prgRomSize).toBe(16 * 1024)
    expect(loader.header.chrRomSize).toBe(8 * 1024)
    expect(loader.prgRom.length).toBe(16 * 1024)
    expect(loader.chrRom.length).toBe(8 * 1024)
  })

  it('falha com cabeçalho inválido', () => {
    const rom = createValidRom()
    rom[0] = 0x00 // quebra o cabeçalho

    expect(() => new RomLoader(rom)).toThrow()
  })
})
