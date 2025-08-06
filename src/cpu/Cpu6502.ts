import { Flags6502 } from './Flags6502'
import { Memory } from '../memory/Memory'

export class Cpu6502 {
  // Registradores
  A = 0x00
  X = 0x00
  Y = 0x00
  SP = 0xFD
  PC = 0x0000
  P = 0x24 // Status (com InterruptDisable e Unused ativados)

  constructor(private memory: Memory) {}

  reset() {
    // Lê o vetor de reset (0xFFFC/0xFFFD)
    const lo = this.read(0xFFFC)
    const hi = this.read(0xFFFD)
    this.PC = (hi << 8) | lo
    
    // Reinicia os registradores
    this.SP = 0xFD
    this.P = 0x24
    this.A = 0x00
    this.X = 0x00
    this.Y = 0x00
  }

  step() {
    const opcode = this.read(this.PC++)
    
    switch (opcode) {
      case 0xA9: // LDA Immediate
        this.A = this.read(this.PC++)
        this.updateZeroNegativeFlags(this.A)
        break
        
      case 0xA2: // LDX Immediate
        this.X = this.read(this.PC++)
        this.updateZeroNegativeFlags(this.X)
        break
        
      case 0xAA: // TAX
        this.X = this.A
        this.updateZeroNegativeFlags(this.X)
        break
        
      case 0xE8: // INX
        this.X = (this.X + 1) & 0xFF
        this.updateZeroNegativeFlags(this.X)
        break
        
      case 0x4C: // JMP Absolute
        const lo = this.read(this.PC++)
        const hi = this.read(this.PC++)
        this.PC = (hi << 8) | lo
        break
        
      case 0x85: // STA Zero Page
        const addr = this.read(this.PC++)
        this.write(addr, this.A)
        break
        
      case 0x00: // BRK
        throw new Error('BRK encontrado - interrupção não implementada')
        
      case 0xEA: // NOP
        break
        
      default:
        throw new Error(`Opcode desconhecido: ${opcode.toString(16)}`)
    }
  }

  private updateZeroNegativeFlags(value: number) {
    this.setFlag(Flags6502.Zero, value === 0)
    this.setFlag(Flags6502.Negative, (value & 0x80) !== 0)
  }

  read(addr: number): number {
    return this.memory.read(addr)
  }

  write(addr: number, value: number): void {
    this.memory.write(addr, value)
  }

  getFlag(flag: Flags6502): boolean {
    return (this.P & flag) !== 0
  }

  setFlag(flag: Flags6502, value: boolean): void {
    this.P = value ? (this.P | flag) : (this.P & ~flag)
  }
}