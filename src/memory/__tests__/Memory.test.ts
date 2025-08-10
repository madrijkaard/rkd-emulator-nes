import { describe, it, expect } from 'vitest'
import { Memory } from '../Memory'
import { Mapper0 } from '../../mappers/Mapper0'
import { Mirroring } from '../../mappers/Mirroring'

describe('Memory', () => {
  it('escreve e lê na RAM principal (0x0000–0x07FF)', () => {
    const mem = new Memory()
    mem.write(0x0000, 0x42)
    expect(mem.read(0x0000)).toBe(0x42)
  })

  it('espelhamento de RAM até 0x1FFF funciona corretamente', () => {
    const mem = new Memory()
    mem.write(0x0000, 0x99)
    expect(mem.read(0x0800)).toBe(0x99)
    expect(mem.read(0x1000)).toBe(0x99)
    expect(mem.read(0x1800)).toBe(0x99)
  })

  it('endereços fora da RAM retornam 0 por padrão', () => {
    const mem = new Memory()
    expect(mem.read(0x4020)).toBe(0)
  })

  it('carrega PRG ROM via Mapper0 e expõe vetor de reset', () => {
    const mem = new Memory()

    // PRG de 16KB: primeiros bytes = AA,BB,CC; vetor de reset aponta para $8000
    const prg = new Uint8Array(16 * 1024).fill(0x00)
    prg[0x0000] = 0xAA
    prg[0x0001] = 0xBB
    prg[0x0002] = 0xCC
    prg[0x3FFC] = 0x00 // low byte
    prg[0x3FFD] = 0x80 // high byte → $8000

    // CHR de 8KB zerado
    const chr = new Uint8Array(8 * 1024).fill(0x00)

    // Anexa mapper ao barramento
    mem.attachMapper(new Mapper0(prg, chr, Mirroring.Horizontal))

    // Lê PRG mapeado em $8000+
    expect(mem.read(0x8000)).toBe(0xAA)
    expect(mem.read(0x8001)).toBe(0xBB)
    expect(mem.read(0x8002)).toBe(0xCC)

    // Vetor de reset exposto pelo PRG ($FFFC/$FFFD)
    const lo = mem.read(0xFFFC)
    const hi = mem.read(0xFFFD)
    const resetVector = (hi << 8) | lo
    expect(resetVector).toBe(0x8000)
  })
})
