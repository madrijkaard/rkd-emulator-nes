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

  test('externalRead e externalWrite são usados se definidos', () => {
    const readMap: Record<number, number> = { 0x8000: 0xAB }
    const writes: [number, number][] = []

    const mem = new Memory(
      addr => readMap[addr] ?? 0,
      (addr, val) => writes.push([addr, val])
    )

    expect(mem.read(0x8000)).toBe(0xAB)
    mem.write(0x9000, 0x77)
    expect(writes).toContainEqual([0x9000, 0x77])
  })
})
