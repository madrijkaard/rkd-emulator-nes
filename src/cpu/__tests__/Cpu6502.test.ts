import { describe, it, expect } from 'vitest'
import { Cpu6502 } from '../Cpu6502'
import { Flags6502 } from '../Flags6502'
import { Memory } from '../../memory/Memory'

function createCpuWithProgram(program: number[], startAddr: number = 0x8000): Cpu6502 {
  const memory = new Memory()
  const programBytes = new Uint8Array(program)
  memory.loadProgram(programBytes, startAddr)
  
  // Configura vetor de reset
  memory.write(0xFFFC, startAddr & 0xFF)
  memory.write(0xFFFD, (startAddr >> 8) & 0xFF)

  const cpu = new Cpu6502(memory)
  cpu.reset()
  return cpu
}

describe('CPU6502', () => {
  it('LDA immediate carrega valor no acumulador', () => {
    const cpu = createCpuWithProgram([0xA9, 0x42]) // LDA #$42
    cpu.step()
    expect(cpu.A).toBe(0x42)
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false)
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false)
  })

  it('LDX immediate carrega valor no registrador X', () => {
    const cpu = createCpuWithProgram([0xA2, 0x10]) // LDX #$10
    cpu.step()
    expect(cpu.X).toBe(0x10)
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false)
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false)
  })

  it('TAX transfere A para X e atualiza flags', () => {
    const cpu = createCpuWithProgram([0xA9, 0x00, 0xAA]) // LDA #$00, TAX
    cpu.step() // LDA
    cpu.step() // TAX
    expect(cpu.X).toBe(0x00)
    expect(cpu.getFlag(Flags6502.Zero)).toBe(true)
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false)
  })

  it('INX incrementa X e atualiza flags', () => {
    const cpu = createCpuWithProgram([0xA2, 0xFF, 0xE8]) // LDX #$FF, INX
    cpu.step() // LDX
    cpu.step() // INX
    expect(cpu.X).toBe(0x00)
    expect(cpu.getFlag(Flags6502.Zero)).toBe(true)
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false)
  })

  it('JMP absoluto salta corretamente para novo endereço', () => {
    const cpu = createCpuWithProgram([0x4C, 0x00, 0x90]) // JMP $9000
    cpu.step()
    expect(cpu.PC).toBe(0x9000)
  })

  it('STA zeropage armazena A na memória', () => {
    const cpu = createCpuWithProgram([0xA9, 0x55, 0x85, 0x10]) // LDA #$55, STA $10
    cpu.step() // LDA
    cpu.step() // STA
    expect(cpu.read(0x0010)).toBe(0x55)
  })

  it('NOP avança o PC sem efeitos colaterais', () => {
    const cpu = createCpuWithProgram([0xEA]) // NOP
    const initialPC = cpu.PC
    cpu.step()
    expect(cpu.PC).toBe(initialPC + 1)
  })

  it('BRK lança erro', () => {
    const cpu = createCpuWithProgram([0x00]) // BRK
    expect(() => cpu.step()).toThrow('BRK encontrado - interrupção não implementada')
  })
})