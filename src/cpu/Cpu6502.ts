// src/cpu/Cpu6502.ts
import { Memory } from '../memory/Memory'
import { Flags6502 } from './Flags6502'

/**
 * Implementação completa do 6502:
 * - Todos os opcodes oficiais
 * - NOPs não-oficiais comuns (DOP/TOP) tratados como NOP (consomem operandos corretos)
 * - Ilegais SLO (ASL em memória + ORA com A) implementados
 * - Sem contagem de ciclos (o NES 2A03 ignora modo decimal; ADC/SBC binários)
 *
 * Observações:
 * - BRK/IRQ/NMI empilham PC e P corretamente (B=1 apenas em BRK/PHP push; U=1 sempre no stack)
 * - RTI restaura P e PC (garantindo Unused=1)
 * - JMP (indirect) tem o "page wrap bug" do 6502 real
 */
export class Cpu6502 {
  A = 0 // Acumulador
  X = 0 // Registrador X
  Y = 0 // Registrador Y
  P = 0x24 // Flags (IRQ Disable e Unused ativados após reset)
  SP = 0xfd // Stack Pointer
  PC = 0x0000 // Program Counter

  constructor(public memory: Memory) {}

  // ===================== Reset / Interrupções =====================

  reset(): void {
    const lo = this.memory.read(0xfffc)
    const hi = this.memory.read(0xfffd)
    this.PC = ((hi << 8) | lo) & 0xffff
    this.SP = 0xfd
    // I=1, D=0, U=1 garantido
    this.P |= Flags6502.Unused | Flags6502.InterruptDisable
  }

  /** NMI de VBlank (vetor $FFFA/$FFFB). */
  nmi(): void {
    // Empilha PC (hi, lo) e status (B=0, U=1)
    this.push((this.PC >> 8) & 0xff)
    this.push(this.PC & 0xff)
    const p = (this.P & ~Flags6502.Break) | Flags6502.Unused
    this.push(p)
    // Inibe IRQ
    this.setFlag(Flags6502.InterruptDisable, true)
    // Lê vetor NMI
    const lo = this.memory.read(0xfffa)
    const hi = this.memory.read(0xfffb)
    this.PC = ((hi << 8) | lo) & 0xffff
  }

  /** IRQ/BRK (vetor $FFFE/$FFFF). Ignorado se I=1 (exceto BRK). */
  irq(): void {
    if (this.getFlag(Flags6502.InterruptDisable)) return
    this._doIrqEntry()
  }

  private _doIrqEntry(isBrk = false): void {
    // Empilha PC e status; BRK empilha com B=1, IRQ/NMI com B=0
    this.push((this.PC >> 8) & 0xff)
    this.push(this.PC & 0xff)
    const toPush =
      ((this.P | Flags6502.Unused) & ~Flags6502.Break) |
      (isBrk ? Flags6502.Break : 0)
    this.push(toPush)
    this.setFlag(Flags6502.InterruptDisable, true)
    const lo = this.memory.read(0xfffe)
    const hi = this.memory.read(0xffff)
    this.PC = ((hi << 8) | lo) & 0xffff
  }

  // ===================== Flags / Stack helpers =====================

  getFlag(flag: Flags6502): boolean {
    return (this.P & flag) !== 0
  }

  setFlag(flag: Flags6502, value: boolean): void {
    if (value) this.P |= flag
    else this.P &= ~flag
  }

  private push(value: number): void {
    this.memory.write(0x0100 + (this.SP & 0xff), value & 0xff)
    this.SP = (this.SP - 1) & 0xff
  }

  private pull(): number {
    this.SP = (this.SP + 1) & 0xff
    return this.memory.read(0x0100 + (this.SP & 0xff)) & 0xff
  }

  private setZN(v: number): void {
    this.setFlag(Flags6502.Zero, (v & 0xff) === 0)
    this.setFlag(Flags6502.Negative, (v & 0x80) !== 0)
  }

  // ===================== Addressing helpers =====================

  private fetchByte(): number {
    const v = this.memory.read(this.PC) & 0xff
    this.PC = (this.PC + 1) & 0xffff
    return v
  }

  private fetchWord(): number {
    const lo = this.fetchByte()
    const hi = this.fetchByte()
    return ((hi << 8) | lo) & 0xffff
  }

  private zp(): number {
    return this.fetchByte() & 0xff
  }

  private zpX(): number {
    return (this.fetchByte() + this.X) & 0xff
  }

  private zpY(): number {
    return (this.fetchByte() + this.Y) & 0xff
  }

  private abs(): number {
    return this.fetchWord()
  }

  private absX(): number {
    const base = this.fetchWord()
    return (base + this.X) & 0xffff
  }

  private absY(): number {
    const base = this.fetchWord()
    return (base + this.Y) & 0xffff
  }

  private indX(): number {
    const zp = (this.fetchByte() + this.X) & 0xff
    const lo = this.memory.read(zp) & 0xff
    const hi = this.memory.read((zp + 1) & 0xff) & 0xff
    return ((hi << 8) | lo) & 0xffff
  }

  private indY(): number {
    const zp = this.fetchByte() & 0xff
    const lo = this.memory.read(zp) & 0xff
    const hi = this.memory.read((zp + 1) & 0xff) & 0xff
    return (((hi << 8) | lo) + this.Y) & 0xffff
  }

  private jmpIndirectAddr(): number {
    // Bug do 6502 real: se low byte é 0xFF, o high lê na mesma página
    const ptr = this.fetchWord()
    const lo = this.memory.read(ptr) & 0xff
    const hiAddr = (ptr & 0xff00) | ((ptr + 1) & 0x00ff)
    const hi = this.memory.read(hiAddr) & 0xff
    return ((hi << 8) | lo) & 0xffff
  }

  private branch(cond: boolean): void {
    const off = this.fetchByte()
    if (!cond) return
    const rel = off < 0x80 ? off : off - 0x100
    this.PC = (this.PC + rel) & 0xffff
  }

  // ===================== ALU helpers =====================

  /** ADC binário (modo decimal ignorado no 2A03) */
  private ADC(value: number): void {
    const a = this.A
    const c = this.getFlag(Flags6502.Carry) ? 1 : 0
    const sum = a + value + c
    const result = sum & 0xff
    this.setFlag(Flags6502.Carry, sum > 0xff)
    // overflow: (~(a ^ v) & (a ^ r) & 0x80) != 0
    this.setFlag(
      Flags6502.Overflow,
      ((~(a ^ value) & (a ^ result)) & 0x80) !== 0
    )
    this.A = result
    this.setZN(this.A)
  }

  /** SBC binário implementado como ADC com (~value) */
  private SBC(value: number): void {
    this.ADC((value ^ 0xff) & 0xff)
  }

  private CMP(reg: number, value: number): void {
    const t = (reg - value) & 0xff
    this.setFlag(Flags6502.Carry, reg >= value)
    this.setZN(t)
  }

  private BIT(value: number): void {
    const t = (this.A & value) & 0xff
    this.setFlag(Flags6502.Zero, t === 0)
    this.setFlag(Flags6502.Negative, (value & 0x80) !== 0)
    this.setFlag(Flags6502.Overflow, (value & 0x40) !== 0)
  }

  private ASL_A(): void {
    const c = (this.A >> 7) & 1
    this.A = (this.A << 1) & 0xff
    this.setFlag(Flags6502.Carry, c === 1)
    this.setZN(this.A)
  }
  private LSR_A(): void {
    const c = this.A & 1
    this.A = (this.A >> 1) & 0xff
    this.setFlag(Flags6502.Carry, c === 1)
    this.setZN(this.A)
  }
  private ROL_A(): void {
    const c = this.getFlag(Flags6502.Carry) ? 1 : 0
    const newC = (this.A >> 7) & 1
    this.A = ((this.A << 1) | c) & 0xff
    this.setFlag(Flags6502.Carry, newC === 1)
    this.setZN(this.A)
  }
  private ROR_A(): void {
    const c = this.getFlag(Flags6502.Carry) ? 1 : 0
    const newC = this.A & 1
    this.A = ((c << 7) | (this.A >> 1)) & 0xff
    this.setFlag(Flags6502.Carry, newC === 1)
    this.setZN(this.A)
  }

  private ASL_M(addr: number): void {
    const v = this.memory.read(addr) & 0xff
    const c = (v >> 7) & 1
    const r = (v << 1) & 0xff
    this.memory.write(addr, r)
    this.setFlag(Flags6502.Carry, c === 1)
    this.setZN(r)
  }
  private LSR_M(addr: number): void {
    const v = this.memory.read(addr) & 0xff
    const c = v & 1
    const r = (v >> 1) & 0xff
    this.memory.write(addr, r)
    this.setFlag(Flags6502.Carry, c === 1)
    this.setZN(r)
  }
  private ROL_M(addr: number): void {
    const v = this.memory.read(addr) & 0xff
    const c = this.getFlag(Flags6502.Carry) ? 1 : 0
    const newC = (v >> 7) & 1
    const r = ((v << 1) | c) & 0xff
    this.memory.write(addr, r)
    this.setFlag(Flags6502.Carry, newC === 1)
    this.setZN(r)
  }
  private ROR_M(addr: number): void {
    const v = this.memory.read(addr) & 0xff
    const c = this.getFlag(Flags6502.Carry) ? 1 : 0
    const newC = v & 1
    const r = ((c << 7) | (v >> 1)) & 0xff
    this.memory.write(addr, r)
    this.setFlag(Flags6502.Carry, newC === 1)
    this.setZN(r)
  }

  /** Ilegal: SLO — ASL em memória + ORA com A (C do ASL; Z/N do novo A) */
  private SLO(addr: number): void {
    const v = this.memory.read(addr) & 0xff
    const carry = (v & 0x80) !== 0
    const shifted = (v << 1) & 0xff
    this.memory.write(addr, shifted)
    this.setFlag(Flags6502.Carry, carry)
    this.A = (this.A | shifted) & 0xff
    this.setZN(this.A)
  }

  // ===================== Execução =====================

  step(): void {
    const opcode = this.fetchByte()

    switch (opcode) {
      // --------- Loads ---------
      case 0xA9: this.A = this.fetchByte(); this.setZN(this.A); break // LDA #
      case 0xA5: this.A = this.memory.read(this.zp()) & 0xff; this.setZN(this.A); break
      case 0xB5: this.A = this.memory.read(this.zpX()) & 0xff; this.setZN(this.A); break
      case 0xAD: this.A = this.memory.read(this.abs()) & 0xff; this.setZN(this.A); break
      case 0xBD: this.A = this.memory.read(this.absX()) & 0xff; this.setZN(this.A); break
      case 0xB9: this.A = this.memory.read(this.absY()) & 0xff; this.setZN(this.A); break
      case 0xA1: this.A = this.memory.read(this.indX()) & 0xff; this.setZN(this.A); break
      case 0xB1: this.A = this.memory.read(this.indY()) & 0xff; this.setZN(this.A); break

      case 0xA2: this.X = this.fetchByte(); this.setZN(this.X); break // LDX #
      case 0xA6: this.X = this.memory.read(this.zp()) & 0xff; this.setZN(this.X); break
      case 0xB6: this.X = this.memory.read(this.zpY()) & 0xff; this.setZN(this.X); break
      case 0xAE: this.X = this.memory.read(this.abs()) & 0xff; this.setZN(this.X); break
      case 0xBE: this.X = this.memory.read(this.absY()) & 0xff; this.setZN(this.X); break

      case 0xA0: this.Y = this.fetchByte(); this.setZN(this.Y); break // LDY #
      case 0xA4: this.Y = this.memory.read(this.zp()) & 0xff; this.setZN(this.Y); break
      case 0xB4: this.Y = this.memory.read(this.zpX()) & 0xff; this.setZN(this.Y); break
      case 0xAC: this.Y = this.memory.read(this.abs()) & 0xff; this.setZN(this.Y); break
      case 0xBC: this.Y = this.memory.read(this.absX()) & 0xff; this.setZN(this.Y); break

      // --------- Stores ---------
      case 0x85: this.memory.write(this.zp(), this.A); break // STA
      case 0x95: this.memory.write(this.zpX(), this.A); break
      case 0x8D: this.memory.write(this.abs(), this.A); break
      case 0x9D: this.memory.write(this.absX(), this.A); break
      case 0x99: this.memory.write(this.absY(), this.A); break
      case 0x81: this.memory.write(this.indX(), this.A); break
      case 0x91: this.memory.write(this.indY(), this.A); break

      case 0x86: this.memory.write(this.zp(), this.X); break // STX
      case 0x96: this.memory.write(this.zpY(), this.X); break
      case 0x8E: this.memory.write(this.abs(), this.X); break

      case 0x84: this.memory.write(this.zp(), this.Y); break // STY
      case 0x94: this.memory.write(this.zpX(), this.Y); break
      case 0x8C: this.memory.write(this.abs(), this.Y); break

      // --------- Transfers ---------
      case 0xAA: this.X = this.A & 0xff; this.setZN(this.X); break // TAX
      case 0xA8: this.Y = this.A & 0xff; this.setZN(this.Y); break // TAY
      case 0x8A: this.A = this.X & 0xff; this.setZN(this.A); break // TXA
      case 0x98: this.A = this.Y & 0xff; this.setZN(this.A); break // TYA
      case 0xBA: this.X = this.SP & 0xff; this.setZN(this.X); break // TSX
      case 0x9A: this.SP = this.X & 0xff; break // TXS

      // --------- Stack ---------
      case 0x48: this.push(this.A); break // PHA
      case 0x68: this.A = this.pull() & 0xff; this.setZN(this.A); break // PLA
      case 0x08: this.push(this.P | Flags6502.Break | Flags6502.Unused); break // PHP
      case 0x28: this.P = (this.pull() | Flags6502.Unused) & 0xff; break // PLP

      // --------- Increments/Decrements ---------
      case 0xE8: this.X = (this.X + 1) & 0xff; this.setZN(this.X); break // INX
      case 0xC8: this.Y = (this.Y + 1) & 0xff; this.setZN(this.Y); break // INY
      case 0xCA: this.X = (this.X - 1) & 0xff; this.setZN(this.X); break // DEX
      case 0x88: this.Y = (this.Y - 1) & 0xff; this.setZN(this.Y); break // DEY
      case 0xE6: { const a = this.zp(); const v = (this.memory.read(a)+1)&0xff; this.memory.write(a,v); this.setZN(v); break } // INC zp
      case 0xF6: { const a = this.zpX(); const v = (this.memory.read(a)+1)&0xff; this.memory.write(a,v); this.setZN(v); break } // INC zp,X
      case 0xEE: { const a = this.abs(); const v = (this.memory.read(a)+1)&0xff; this.memory.write(a,v); this.setZN(v); break } // INC abs
      case 0xFE: { const a = this.absX(); const v = (this.memory.read(a)+1)&0xff; this.memory.write(a,v); this.setZN(v); break } // INC abs,X
      case 0xC6: { const a = this.zp(); const v = (this.memory.read(a)-1)&0xff; this.memory.write(a,v); this.setZN(v); break } // DEC zp
      case 0xD6: { const a = this.zpX(); const v = (this.memory.read(a)-1)&0xff; this.memory.write(a,v); this.setZN(v); break } // DEC zp,X
      case 0xCE: { const a = this.abs(); const v = (this.memory.read(a)-1)&0xff; this.memory.write(a,v); this.setZN(v); break } // DEC abs
      case 0xDE: { const a = this.absX(); const v = (this.memory.read(a)-1)&0xff; this.memory.write(a,v); this.setZN(v); break } // DEC abs,X

      // --------- Lógicas / Aritméticas ---------
      case 0x29: this.A &= this.fetchByte(); this.setZN(this.A); break // AND #
      case 0x25: this.A &= this.memory.read(this.zp()); this.setZN(this.A); break
      case 0x35: this.A &= this.memory.read(this.zpX()); this.setZN(this.A); break
      case 0x2D: this.A &= this.memory.read(this.abs()); this.setZN(this.A); break
      case 0x3D: this.A &= this.memory.read(this.absX()); this.setZN(this.A); break
      case 0x39: this.A &= this.memory.read(this.absY()); this.setZN(this.A); break
      case 0x21: this.A &= this.memory.read(this.indX()); this.setZN(this.A); break
      case 0x31: this.A &= this.memory.read(this.indY()); this.setZN(this.A); break

      case 0x09: this.A |= this.fetchByte(); this.setZN(this.A); break // ORA #
      case 0x05: this.A |= this.memory.read(this.zp()); this.setZN(this.A); break
      case 0x15: this.A |= this.memory.read(this.zpX()); this.setZN(this.A); break
      case 0x0D: this.A |= this.memory.read(this.abs()); this.setZN(this.A); break
      case 0x1D: this.A |= this.memory.read(this.absX()); this.setZN(this.A); break
      case 0x19: this.A |= this.memory.read(this.absY()); this.setZN(this.A); break
      case 0x01: this.A |= this.memory.read(this.indX()); this.setZN(this.A); break
      case 0x11: this.A |= this.memory.read(this.indY()); this.setZN(this.A); break

      case 0x49: this.A ^= this.fetchByte(); this.setZN(this.A); break // EOR #
      case 0x45: this.A ^= (this.memory.read(this.zp()) & 0xff); this.setZN(this.A); break
      case 0x55: this.A ^= (this.memory.read(this.zpX()) & 0xff); this.setZN(this.A); break
      case 0x4D: this.A ^= (this.memory.read(this.abs()) & 0xff); this.setZN(this.A); break
      case 0x5D: this.A ^= (this.memory.read(this.absX()) & 0xff); this.setZN(this.A); break
      case 0x59: this.A ^= (this.memory.read(this.absY()) & 0xff); this.setZN(this.A); break
      case 0x41: this.A ^= (this.memory.read(this.indX()) & 0xff); this.setZN(this.A); break
      case 0x51: this.A ^= (this.memory.read(this.indY()) & 0xff); this.setZN(this.A); break

      case 0x69: this.ADC(this.fetchByte()); break // ADC
      case 0x65: this.ADC(this.memory.read(this.zp()) & 0xff); break
      case 0x75: this.ADC(this.memory.read(this.zpX()) & 0xff); break
      case 0x6D: this.ADC(this.memory.read(this.abs()) & 0xff); break
      case 0x7D: this.ADC(this.memory.read(this.absX()) & 0xff); break
      case 0x79: this.ADC(this.memory.read(this.absY()) & 0xff); break
      case 0x61: this.ADC(this.memory.read(this.indX()) & 0xff); break
      case 0x71: this.ADC(this.memory.read(this.indY()) & 0xff); break

      case 0xE9: this.SBC(this.fetchByte()); break // SBC
      case 0xE5: this.SBC(this.memory.read(this.zp()) & 0xff); break
      case 0xF5: this.SBC(this.memory.read(this.zpX()) & 0xff); break
      case 0xED: this.SBC(this.memory.read(this.abs()) & 0xff); break
      case 0xFD: this.SBC(this.memory.read(this.absX()) & 0xff); break
      case 0xF9: this.SBC(this.memory.read(this.absY()) & 0xff); break
      case 0xE1: this.SBC(this.memory.read(this.indX()) & 0xff); break
      case 0xF1: this.SBC(this.memory.read(this.indY()) & 0xff); break

      case 0x24: this.BIT(this.memory.read(this.zp()) & 0xff); break // BIT
      case 0x2C: this.BIT(this.memory.read(this.abs()) & 0xff); break

      case 0xC9: this.CMP(this.A, this.fetchByte()); break // CMP
      case 0xC5: this.CMP(this.A, this.memory.read(this.zp()) & 0xff); break
      case 0xD5: this.CMP(this.A, this.memory.read(this.zpX()) & 0xff); break
      case 0xCD: this.CMP(this.A, this.memory.read(this.abs()) & 0xff); break
      case 0xDD: this.CMP(this.A, this.memory.read(this.absX()) & 0xff); break
      case 0xD9: this.CMP(this.A, this.memory.read(this.absY()) & 0xff); break
      case 0xC1: this.CMP(this.A, this.memory.read(this.indX()) & 0xff); break
      case 0xD1: this.CMP(this.A, this.memory.read(this.indY()) & 0xff); break

      case 0xE0: this.CMP(this.X, this.fetchByte()); break // CPX
      case 0xE4: this.CMP(this.X, this.memory.read(this.zp()) & 0xff); break
      case 0xEC: this.CMP(this.X, this.memory.read(this.abs()) & 0xff); break

      case 0xC0: this.CMP(this.Y, this.fetchByte()); break // CPY
      case 0xC4: this.CMP(this.Y, this.memory.read(this.zp()) & 0xff); break
      case 0xCC: this.CMP(this.Y, this.memory.read(this.abs()) & 0xff); break

      // --------- Shifts / Rotates ---------
      case 0x0A: this.ASL_A(); break
      case 0x06: this.ASL_M(this.zp()); break
      case 0x16: this.ASL_M(this.zpX()); break
      case 0x0E: this.ASL_M(this.abs()); break
      case 0x1E: this.ASL_M(this.absX()); break

      case 0x4A: this.LSR_A(); break
      case 0x46: this.LSR_M(this.zp()); break
      case 0x56: this.LSR_M(this.zpX()); break
      case 0x4E: this.LSR_M(this.abs()); break
      case 0x5E: this.LSR_M(this.absX()); break

      case 0x2A: this.ROL_A(); break
      case 0x26: this.ROL_M(this.zp()); break
      case 0x36: this.ROL_M(this.zpX()); break
      case 0x2E: this.ROL_M(this.abs()); break
      case 0x3E: this.ROL_M(this.absX()); break

      case 0x6A: this.ROR_A(); break
      case 0x66: this.ROR_M(this.zp()); break
      case 0x76: this.ROR_M(this.zpX()); break
      case 0x6E: this.ROR_M(this.abs()); break
      case 0x7E: this.ROR_M(this.absX()); break

      // --------- Jumps / Subroutines / Returns ---------
      case 0x4C: this.PC = this.abs(); break // JMP abs
      case 0x6C: this.PC = this.jmpIndirectAddr(); break // JMP (ind)
      case 0x20: { // JSR
        const addr = this.abs()
        const returnAddr = (this.PC - 1) & 0xffff
        this.push((returnAddr >> 8) & 0xff)
        this.push(returnAddr & 0xff)
        this.PC = addr
        break
      }
      case 0x60: { // RTS
        const lo = this.pull()
        const hi = this.pull()
        this.PC = (((hi << 8) | lo) + 1) & 0xffff
        break
      }
      case 0x40: { // RTI
        this.P = (this.pull() | Flags6502.Unused) & 0xff
        const lo = this.pull()
        const hi = this.pull()
        this.PC = ((hi << 8) | lo) & 0xffff
        break
      }

      // --------- Branches ---------
      case 0x90: this.branch(!this.getFlag(Flags6502.Carry)); break // BCC
      case 0xB0: this.branch(this.getFlag(Flags6502.Carry)); break  // BCS
      case 0xF0: this.branch(this.getFlag(Flags6502.Zero)); break   // BEQ
      case 0x30: this.branch(this.getFlag(Flags6502.Negative)); break // BMI
      case 0xD0: this.branch(!this.getFlag(Flags6502.Zero)); break  // BNE
      case 0x10: this.branch(!this.getFlag(Flags6502.Negative)); break // BPL
      case 0x50: this.branch(!this.getFlag(Flags6502.Overflow)); break // BVC
      case 0x70: this.branch(this.getFlag(Flags6502.Overflow)); break  // BVS

      // --------- Flags ---------
      case 0x18: this.setFlag(Flags6502.Carry, false); break // CLC
      case 0x38: this.setFlag(Flags6502.Carry, true); break  // SEC
      case 0x58: this.setFlag(Flags6502.InterruptDisable, false); break // CLI
      case 0x78: this.setFlag(Flags6502.InterruptDisable, true); break  // SEI
      case 0xB8: this.setFlag(Flags6502.Overflow, false); break // CLV
      case 0xD8: this.setFlag(Flags6502.Decimal, false); break  // CLD (no 2A03 é sempre 0 mesmo)
      case 0xF8: this.setFlag(Flags6502.Decimal, true); break   // SED (sem efeito prático no 2A03)

      // --------- BRK / NOP ---------
      case 0x00: { // BRK
        // PC já aponta para o byte seguinte (fetchByte avançou), comportamento ok
        this._doIrqEntry(true)
        break
      }
      case 0xEA: break // NOP oficial 1 byte

      // --------- Ilegais: SLO (ASL mem + ORA A) ---------
      case 0x07: this.SLO(this.zp()); break       // SLO zp
      case 0x17: this.SLO(this.zpX()); break      // SLO zp,X
      case 0x0F: this.SLO(this.abs()); break      // SLO abs
      case 0x1F: this.SLO(this.absX()); break     // SLO abs,X
      case 0x1B: this.SLO(this.absY()); break     // SLO abs,Y
      case 0x03: this.SLO(this.indX()); break     // SLO (zp,X)
      case 0x13: this.SLO(this.indY()); break     // SLO (zp),Y

      // --------- NOPs não-oficiais (consumir operandos corretos) ---------
      // 1 byte
      case 0x1A: case 0x3A: case 0x5A: case 0x7A: case 0xDA: case 0xFA:
        break
      // 2 bytes (zp)
      case 0x04: case 0x44: case 0x64: this.fetchByte(); break
      // 2 bytes (imm) – TOP/DOP variantes
      case 0x80: case 0x82: case 0x89: case 0xC2: case 0xE2: this.fetchByte(); break
      // 2 bytes (zp,X)
      case 0x14: case 0x34: case 0x54: case 0x74: case 0xD4: case 0xF4: this.fetchByte(); break
      // 3 bytes (abs)
      case 0x0C: this.fetchWord(); break
      // 3 bytes (abs,X)
      case 0x1C: case 0x3C: case 0x5C: case 0x7C: case 0xDC: case 0xFC: this.fetchWord(); break

      // --------- KIL/JAM (não-oficiais) → travam CPU; preferimos lançar erro explícito ---------
      case 0x02: case 0x12: case 0x22: case 0x32:
      case 0x42: case 0x52: case 0x62: case 0x72:
      case 0x92: case 0xB2: case 0xD2: case 0xF2:
        throw new Error(`KIL/JAM encontrado: opcode 0x${opcode.toString(16)}`)

      // --------- Desconhecido ---------
      default:
        throw new Error(`Opcode desconhecido: 0x${opcode.toString(16)}`)
    }
  }

  // ===================== Utilidade para o disassembler =====================

  read(addr: number): number {
    return this.memory.read(addr & 0xffff) & 0xff
  }
}
