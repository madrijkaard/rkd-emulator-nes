import { describe, test, expect } from 'vitest'
import { Memory } from '../Memory'

describe('Memory', () => {
  test('escreve e lê na RAM principal (0x0000–0x07FF)', () => {
    const mem = new Memory()
    mem.write(0x0005, 0x42)
    expect(mem.read(0x0005)).toBe(0x42)
  })

  test('espelhamento de RAM até 0x1FFF funciona corretamente', () => {
    const mem = new Memory()
    mem.write(0x0000, 0x99)

    // Deve refletir em todos os espelhos de 0x0800 em 0x0800 em 0x0800...
    expect(mem.read(0x0800)).toBe(0x99)
    expect(mem.read(0x1000)).toBe(0x99)
    expect(mem.read(0x1800)).toBe(0x99)

    // Mudando o espelho, deve refletir no original
    mem.write(0x1800, 0x55)
    expect(mem.read(0x0000)).toBe(0x55)
  })

  test('endereços fora da RAM retornam 0 por padrão', () => {
    const mem = new Memory()
    expect(mem.read(0x2000)).toBe(0)
    expect(mem.read(0x4020)).toBe(0)
    expect(mem.read(0x8000)).toBe(0)
  })

  test('loadRom carrega PRG ROM e define vetor de reset', () => {
    const mem = new Memory()

    // PRG ROM de exemplo
    const prgRom = new Uint8Array([0xAA, 0xBB, 0xCC])
    mem.loadRom(prgRom)

    // Verifica se os dados foram gravados corretamente a partir de 0x8000
    expect(mem.read(0x8000)).toBe(0xAA)
    expect(mem.read(0x8001)).toBe(0xBB)
    expect(mem.read(0x8002)).toBe(0xCC)

    // Verifica se o vetor de reset foi configurado corretamente para 0x8000
    const lo = mem.read(0xFFFC)
    const hi = mem.read(0xFFFD)
    const resetVector = (hi << 8) | lo

    expect(resetVector).toBe(0x8000)
  })
})
