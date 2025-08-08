// src/cpu/Cpu6502.ts
import { Memory } from '../memory/Memory'
import { Flags6502 } from './Flags6502'

export class Cpu6502 {
  A = 0 // Acumulador
  X = 0 // Registrador X
  Y = 0 // Registrador Y
  P = 0x24 // Flags (IRQ Disable e Unused ativados)
  SP = 0xfd // Stack Pointer
  PC = 0x0000 // Program Counter

  constructor(public memory: Memory) {}

  reset(): void {
    const lo = this.memory.read(0xfffc)
    const hi = this.memory.read(0xfffd)
    this.PC = (hi << 8) | lo
    this.SP = 0xfd
    this.P |= Flags6502.Unused
    console.log(
      `[CPU] Reset completo: PC=$${this.PC.toString(16).padStart(4, '0')} SP=${this.SP.toString(16)}`
    )
  }

  /** NMI de VBlank (vetor $FFFA/$FFFB). */
  nmi(): void {
    // Empilha PC (hi, lo) e status (com B=0 e U=1)
    this.push((this.PC >> 8) & 0xff)
    this.push(this.PC & 0xff)
    const p = (this.P & ~Flags6502.Break) | Flags6502.Unused
    this.push(p)
    // Inibe IRQ
    this.setFlag(Flags6502.InterruptDisable, true)
    // Lê vetor NMI
    const lo = this.memory.read(0xfffa)
    const hi = this.memory.read(0xfffb)
    this.PC = (hi << 8) | lo
    console.log(`[CPU] NMI → PC=$${this.PC.toString(16).padStart(4, '0')}`)
  }

  /** IRQ (vetor $FFFE/$FFFF). Ignorado se I=1. */
  irq(): void {
    if (this.getFlag(Flags6502.InterruptDisable)) return
    // Empilha PC e status (B=0, U=1), seta I
    this.push((this.PC >> 8) & 0xff)
    this.push(this.PC & 0xff)
    const p = (this.P & ~Flags6502.Break) | Flags6502.Unused
    this.push(p)
    this.setFlag(Flags6502.InterruptDisable, true)

    const lo = this.memory.read(0xfffe)
    const hi = this.memory.read(0xffff)
    this.PC = (hi << 8) | lo

    console.log(`[CPU] IRQ → PC=$${this.PC.toString(16).padStart(4, '0')}`)
  }

  getFlag(flag: Flags6502): boolean {
    return (this.P & flag) !== 0
  }

  setFlag(flag: Flags6502, value: boolean): void {
    if (value) this.P |= flag
    else this.P &= ~flag
  }

  push(value: number): void {
    this.memory.write(0x0100 + this.SP, value)
    this.SP = (this.SP - 1) & 0xff
  }

  pull(): number {
    this.SP = (this.SP + 1) & 0xff
    return this.memory.read(0x0100 + this.SP)
  }

  /** Lança um "halt" de CPU para instruções JAM/KIL (não oficiais). */
  private jam(opcode: number): never {
    throw new Error(`KIL/JAM encontrado: opcode 0x${opcode.toString(16)} — CPU travada`)
  }

  step(): void {
    const opcode = this.memory.read(this.PC)
    console.log(
      `[CPU] Executando PC=$${this.PC.toString(16).padStart(4, '0')} opcode=${opcode.toString(16)}`
    )
    this.PC++

    switch (opcode) {
      // ================= Instruções oficiais básicas =================
      case 0xA9: { // LDA immediate
        const value = this.memory.read(this.PC++)
        this.A = value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(`[CPU] LDA #$${value.toString(16).padStart(2, '0')}`)
        break
      }

      case 0xA2: { // LDX immediate
        const value = this.memory.read(this.PC++)
        this.X = value
        this.updateZeroAndNegativeFlags(this.X)
        console.log(`[CPU] LDX #$${value.toString(16).padStart(2, '0')}`)
        break
      }

      case 0xAA: { // TAX
        this.X = this.A
        this.updateZeroAndNegativeFlags(this.X)
        console.log('[CPU] TAX')
        break
      }

      case 0xE8: { // INX
        this.X = (this.X + 1) & 0xff
        this.updateZeroAndNegativeFlags(this.X)
        console.log('[CPU] INX')
        break
      }

      case 0x4C: { // JMP absolute
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const addr = (hi << 8) | lo
        this.PC = addr
        console.log(`[CPU] JMP $${addr.toString(16).padStart(4, '0')}`)
        break
      }

      case 0x85: { // STA zeropage
        const addr = this.memory.read(this.PC++)
        this.memory.write(addr, this.A)
        console.log(`[CPU] STA $${addr.toString(16).padStart(2, '0')}`)
        break
      }

      case 0xEA: { // NOP (oficial, 1 byte)
        console.log('[CPU] NOP')
        break
      }

      case 0x00: { // BRK
        throw new Error('BRK encontrado: interrupção não implementada')
      }

      // =================== Stack ===================
      case 0x48: { // PHA
        this.push(this.A)
        console.log('[CPU] PHA')
        break
      }

      case 0x68: { // PLA
        this.A = this.pull()
        this.updateZeroAndNegativeFlags(this.A)
        console.log('[CPU] PLA')
        break
      }

      case 0x08: { // PHP
        const flags = this.P | Flags6502.Break | Flags6502.Unused
        this.push(flags)
        console.log('[CPU] PHP')
        break
      }

      case 0x28: { // PLP
        this.P = this.pull() | Flags6502.Unused
        console.log('[CPU] PLP')
        break
      }

      // ================= Subrotinas =================
      case 0x20: { // JSR absolute
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const target = (hi << 8) | lo
        const returnAddr = this.PC - 1
        this.push((returnAddr >> 8) & 0xff)
        this.push(returnAddr & 0xff)
        this.PC = target
        console.log(`[CPU] JSR $${target.toString(16).padStart(4, '0')}`)
        break
      }

      case 0x60: { // RTS
        const lo = this.pull()
        const hi = this.pull()
        this.PC = ((hi << 8) | lo) + 1
        console.log(`[CPU] RTS → $${this.PC.toString(16).padStart(4, '0')}`)
        break
      }

      // ================= Comparações / Lógicas =================
      case 0xC0: { // CPY immediate
        const value = this.memory.read(this.PC++)
        const result = this.Y - value
        this.setFlag(Flags6502.Carry, this.Y >= value)
        this.setFlag(Flags6502.Zero, (result & 0xff) === 0)
        this.setFlag(Flags6502.Negative, (result & 0x80) !== 0)
        console.log(`[CPU] CPY #$${value.toString(16).padStart(2, '0')}`)
        break
      }

      case 0x45: { // EOR zeropage
        const addr = this.memory.read(this.PC++)
        const value = this.memory.read(addr)
        this.A ^= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] EOR $${addr.toString(16).padStart(2, '0')} → A ^= ${value.toString(16)} = ${this.A.toString(16)}`
        )
        break
      }

      // ================= ORA (oficiais) =================
      case 0x09: { // ORA immediate
        const value = this.memory.read(this.PC++)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(`[CPU] ORA #$${value.toString(16).padStart(2, '0')} → A=${this.A.toString(16)}`)
        break
      }

      case 0x05: { // ORA zeropage
        const zp = this.memory.read(this.PC++)
        const value = this.memory.read(zp)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(`[CPU] ORA $${zp.toString(16).padStart(2, '0')} → A=${this.A.toString(16)}`)
        break
      }

      case 0x0D: { // ORA absolute
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const addr = (hi << 8) | lo
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(`[CPU] ORA $${addr.toString(16).padStart(4, '0')} → A=${this.A.toString(16)}`)
        break
      }

      case 0x01: { // ORA (zp,X)
        const zp = this.memory.read(this.PC++) & 0xff
        const ptr = (zp + this.X) & 0xff
        const lo = this.memory.read(ptr)
        const hi = this.memory.read((ptr + 1) & 0xff)
        const addr = (hi << 8) | lo
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] ORA ($${zp.toString(16).padStart(2, '0')},X) → [${addr
            .toString(16)
            .padStart(4, '0')}] = ${value.toString(16)}, A=${this.A.toString(16)}`
        )
        break
      }

      case 0x11: { // ORA (zp),Y
        const zp = this.memory.read(this.PC++) & 0xff
        const lo = this.memory.read(zp)
        const hi = this.memory.read((zp + 1) & 0xff)
        const base = (hi << 8) | lo
        const addr = (base + this.Y) & 0xffff
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] ORA ($${zp.toString(16).padStart(2, '0')}),Y → base=${base.toString(
            16
          )}, addr=${addr.toString(16)}, A=${this.A.toString(16)}`
        )
        break
      }

      case 0x15: { // ORA zp,X
        const zp = this.memory.read(this.PC++) & 0xff
        const addr = (zp + this.X) & 0xff
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] ORA $${zp.toString(16).padStart(2, '0')},X → [${addr
            .toString(16)
            .padStart(2, '0')}] = ${value.toString(16)}, A=${this.A.toString(16)}`
        )
        break
      }

      case 0x19: { // ORA abs,Y
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const base = (hi << 8) | lo
        const addr = (base + this.Y) & 0xffff
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] ORA $${base.toString(16).padStart(4, '0')},Y → [${addr
            .toString(16)
            .padStart(4, '0')}] = ${value.toString(16)}, A=${this.A.toString(16)}`
        )
        break
      }

      case 0x1D: { // ORA abs,X
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const base = (hi << 8) | lo
        const addr = (base + this.X) & 0xffff
        const value = this.memory.read(addr)
        this.A |= value
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] ORA $${base.toString(16).padStart(4, '0')},X → [${addr
            .toString(16)
            .padStart(4, '0')}] = ${value.toString(16)}, A=${this.A.toString(16)}`
        )
        break
      }

      // ================= NOPs não-oficiais =================
      case 0x04: // NOP zeropage (DOP/SKB)
      case 0x44: // NOP zeropage
      case 0x64: { // NOP zeropage
        const zp = this.memory.read(this.PC++)
        console.log(`[CPU] NOP $${zp.toString(16).padStart(2, '0')} (zeropage)`)
        break
      }

      case 0x0C: { // NOP absolute (3 bytes, não-oficial)
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const addr = (hi << 8) | lo
        console.log(`[CPU] NOP $${addr.toString(16).padStart(4, '0')}`)
        break
      }

      // ================= Instruções ilegais: SLO (ASL + ORA) =================
      case 0x07: { // SLO zeropage
        const addr = this.memory.read(this.PC++)
        const value = this.memory.read(addr)
        const shifted = (value << 1) & 0xff
        this.memory.write(addr, shifted)
        this.setFlag(Flags6502.Carry, (value & 0x80) !== 0)
        this.A |= shifted
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] SLO $${addr.toString(16).padStart(2, '0')} → (${value.toString(16)} << 1 = ${shifted.toString(
            16
          )}), A |= ${shifted.toString(16)} = ${this.A.toString(16)}`
        )
        break
      }

      case 0x0F: { // SLO absolute
        const lo = this.memory.read(this.PC++)
        const hi = this.memory.read(this.PC++)
        const addr = (hi << 8) | lo
        const value = this.memory.read(addr)
        const shifted = (value << 1) & 0xff
        this.setFlag(Flags6502.Carry, (value & 0x80) !== 0)
        this.memory.write(addr, shifted)
        this.A |= shifted
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] SLO $${addr.toString(16).padStart(4, '0')} → (${value.toString(16)} << 1 = ${shifted.toString(
            16
          )}), A |= ${shifted.toString(16)} = ${this.A.toString(16)}`
        )
        break
      }

      case 0x03: { // SLO (zp,X)
        const zp = this.memory.read(this.PC++) & 0xff
        const ptr = (zp + this.X) & 0xff
        const lo = this.memory.read(ptr)
        const hi = this.memory.read((ptr + 1) & 0xff)
        const addr = (hi << 8) | lo

        const value = this.memory.read(addr)
        const shifted = (value << 1) & 0xff
        this.setFlag(Flags6502.Carry, (value & 0x80) !== 0)
        this.memory.write(addr, shifted)

        this.A |= shifted
        this.updateZeroAndNegativeFlags(this.A)
        console.log(
          `[CPU] SLO ($${zp.toString(16).padStart(2, '0')},X) → [${addr
            .toString(16)
            .padStart(4, '0')}] (${value.toString(16)}<<1=${shifted.toString(16)}), A=${this.A.toString(16)}`
        )
        break
      }

      // ================= JAM/KIL (não-oficiais, travam a CPU) =================
      case 0x02:
      case 0x12:
      case 0x22:
      case 0x32:
      case 0x42:
      case 0x52:
      case 0x62:
      case 0x72:
      case 0x92:
      case 0xB2:
      case 0xD2:
      case 0xF2: {
        this.jam(opcode)
      }

      // ================= Default =================
      default:
        throw new Error(`Opcode desconhecido: 0x${opcode.toString(16)}`)
    }
  }

  updateZeroAndNegativeFlags(value: number): void {
    this.setFlag(Flags6502.Zero, value === 0)
    this.setFlag(Flags6502.Negative, (value & 0x80) !== 0)
  }

  read(addr: number): number {
    return this.memory.read(addr)
  }
}
