// src/cpu/Disassembler.ts
import { Cpu6502 } from './Cpu6502'

type Mode =
  | 'IMP'  // Implied
  | 'ACC'  // Accumulator
  | 'IMM'  // #imm
  | 'ZP'   // zeropage
  | 'ZPX'  // zeropage,X
  | 'ZPY'  // zeropage,Y
  | 'ABS'  // absolute
  | 'ABSX' // absolute,X
  | 'ABSY' // absolute,Y
  | 'IND'  // (absolute)
  | 'IZX'  // (zp,X)
  | 'IZY'  // (zp),Y
  | 'REL'  // relative
  | 'KIL'  // jam/kill

interface OpInfo { mnem: string; mode: Mode }

// Tabela dos opcodes cobertos na sua CPU (oficiais + NOPs comuns + KIL)
const OP: Record<number, OpInfo> = {
  // === Loads ===
  0xA9:{mnem:'LDA',mode:'IMM'},0xA5:{mnem:'LDA',mode:'ZP'}, 0xB5:{mnem:'LDA',mode:'ZPX'},
  0xAD:{mnem:'LDA',mode:'ABS'},0xBD:{mnem:'LDA',mode:'ABSX'},0xB9:{mnem:'LDA',mode:'ABSY'},
  0xA1:{mnem:'LDA',mode:'IZX'},0xB1:{mnem:'LDA',mode:'IZY'},

  0xA2:{mnem:'LDX',mode:'IMM'},0xA6:{mnem:'LDX',mode:'ZP'}, 0xB6:{mnem:'LDX',mode:'ZPY'},
  0xAE:{mnem:'LDX',mode:'ABS'},0xBE:{mnem:'LDX',mode:'ABSY'},

  0xA0:{mnem:'LDY',mode:'IMM'},0xA4:{mnem:'LDY',mode:'ZP'}, 0xB4:{mnem:'LDY',mode:'ZPX'},
  0xAC:{mnem:'LDY',mode:'ABS'},0xBC:{mnem:'LDY',mode:'ABSX'},

  // === Stores ===
  0x85:{mnem:'STA',mode:'ZP'}, 0x95:{mnem:'STA',mode:'ZPX'}, 0x8D:{mnem:'STA',mode:'ABS'},
  0x9D:{mnem:'STA',mode:'ABSX'},0x99:{mnem:'STA',mode:'ABSY'},0x81:{mnem:'STA',mode:'IZX'},
  0x91:{mnem:'STA',mode:'IZY'},

  0x86:{mnem:'STX',mode:'ZP'}, 0x96:{mnem:'STX',mode:'ZPY'}, 0x8E:{mnem:'STX',mode:'ABS'},
  0x84:{mnem:'STY',mode:'ZP'}, 0x94:{mnem:'STY',mode:'ZPX'}, 0x8C:{mnem:'STY',mode:'ABS'},

  // === Transfers ===
  0xAA:{mnem:'TAX',mode:'IMP'},0xA8:{mnem:'TAY',mode:'IMP'},0x8A:{mnem:'TXA',mode:'IMP'},
  0x98:{mnem:'TYA',mode:'IMP'},0xBA:{mnem:'TSX',mode:'IMP'},0x9A:{mnem:'TXS',mode:'IMP'},

  // === Stack ===
  0x48:{mnem:'PHA',mode:'IMP'},0x68:{mnem:'PLA',mode:'IMP'},0x08:{mnem:'PHP',mode:'IMP'},
  0x28:{mnem:'PLP',mode:'IMP'},

  // === Increments/Decrements ===
  0xE8:{mnem:'INX',mode:'IMP'},0xC8:{mnem:'INY',mode:'IMP'},0xCA:{mnem:'DEX',mode:'IMP'},
  0x88:{mnem:'DEY',mode:'IMP'},

  0xE6:{mnem:'INC',mode:'ZP'}, 0xF6:{mnem:'INC',mode:'ZPX'}, 0xEE:{mnem:'INC',mode:'ABS'},
  0xFE:{mnem:'INC',mode:'ABSX'},
  0xC6:{mnem:'DEC',mode:'ZP'}, 0xD6:{mnem:'DEC',mode:'ZPX'}, 0xCE:{mnem:'DEC',mode:'ABS'},
  0xDE:{mnem:'DEC',mode:'ABSX'},

  // === Logical / Arithmetic ===
  // AND
  0x29:{mnem:'AND',mode:'IMM'},0x25:{mnem:'AND',mode:'ZP'}, 0x35:{mnem:'AND',mode:'ZPX'},
  0x2D:{mnem:'AND',mode:'ABS'},0x3D:{mnem:'AND',mode:'ABSX'},0x39:{mnem:'AND',mode:'ABSY'},
  0x21:{mnem:'AND',mode:'IZX'},0x31:{mnem:'AND',mode:'IZY'},
  // ORA
  0x09:{mnem:'ORA',mode:'IMM'},0x05:{mnem:'ORA',mode:'ZP'}, 0x15:{mnem:'ORA',mode:'ZPX'},
  0x0D:{mnem:'ORA',mode:'ABS'},0x1D:{mnem:'ORA',mode:'ABSX'},0x19:{mnem:'ORA',mode:'ABSY'},
  0x01:{mnem:'ORA',mode:'IZX'},0x11:{mnem:'ORA',mode:'IZY'},
  // EOR
  0x49:{mnem:'EOR',mode:'IMM'},0x45:{mnem:'EOR',mode:'ZP'}, 0x55:{mnem:'EOR',mode:'ZPX'},
  0x4D:{mnem:'EOR',mode:'ABS'},0x5D:{mnem:'EOR',mode:'ABSX'},0x59:{mnem:'EOR',mode:'ABSY'},
  0x41:{mnem:'EOR',mode:'IZX'},0x51:{mnem:'EOR',mode:'IZY'},
  // ADC
  0x69:{mnem:'ADC',mode:'IMM'},0x65:{mnem:'ADC',mode:'ZP'}, 0x75:{mnem:'ADC',mode:'ZPX'},
  0x6D:{mnem:'ADC',mode:'ABS'},0x7D:{mnem:'ADC',mode:'ABSX'},0x79:{mnem:'ADC',mode:'ABSY'},
  0x61:{mnem:'ADC',mode:'IZX'},0x71:{mnem:'ADC',mode:'IZY'},
  // SBC
  0xE9:{mnem:'SBC',mode:'IMM'},0xE5:{mnem:'SBC',mode:'ZP'}, 0xF5:{mnem:'SBC',mode:'ZPX'},
  0xED:{mnem:'SBC',mode:'ABS'},0xFD:{mnem:'SBC',mode:'ABSX'},0xF9:{mnem:'SBC',mode:'ABSY'},
  0xE1:{mnem:'SBC',mode:'IZX'},0xF1:{mnem:'SBC',mode:'IZY'},
  // BIT
  0x24:{mnem:'BIT',mode:'ZP'},0x2C:{mnem:'BIT',mode:'ABS'},
  // CMP/CPX/CPY
  0xC9:{mnem:'CMP',mode:'IMM'},0xC5:{mnem:'CMP',mode:'ZP'}, 0xD5:{mnem:'CMP',mode:'ZPX'},
  0xCD:{mnem:'CMP',mode:'ABS'},0xDD:{mnem:'CMP',mode:'ABSX'},0xD9:{mnem:'CMP',mode:'ABSY'},
  0xC1:{mnem:'CMP',mode:'IZX'},0xD1:{mnem:'CMP',mode:'IZY'},

  0xE0:{mnem:'CPX',mode:'IMM'},0xE4:{mnem:'CPX',mode:'ZP'},0xEC:{mnem:'CPX',mode:'ABS'},
  0xC0:{mnem:'CPY',mode:'IMM'},0xC4:{mnem:'CPY',mode:'ZP'},0xCC:{mnem:'CPY',mode:'ABS'},

  // === Shifts / Rotates ===
  0x0A:{mnem:'ASL',mode:'ACC'},0x06:{mnem:'ASL',mode:'ZP'}, 0x16:{mnem:'ASL',mode:'ZPX'},
  0x0E:{mnem:'ASL',mode:'ABS'},0x1E:{mnem:'ASL',mode:'ABSX'},

  0x4A:{mnem:'LSR',mode:'ACC'},0x46:{mnem:'LSR',mode:'ZP'}, 0x56:{mnem:'LSR',mode:'ZPX'},
  0x4E:{mnem:'LSR',mode:'ABS'},0x5E:{mnem:'LSR',mode:'ABSX'},

  0x2A:{mnem:'ROL',mode:'ACC'},0x26:{mnem:'ROL',mode:'ZP'}, 0x36:{mnem:'ROL',mode:'ZPX'},
  0x2E:{mnem:'ROL',mode:'ABS'},0x3E:{mnem:'ROL',mode:'ABSX'},

  0x6A:{mnem:'ROR',mode:'ACC'},0x66:{mnem:'ROR',mode:'ZP'}, 0x76:{mnem:'ROR',mode:'ZPX'},
  0x6E:{mnem:'ROR',mode:'ABS'},0x7E:{mnem:'ROR',mode:'ABSX'},

  // === Jumps / Subroutines / Returns ===
  0x4C:{mnem:'JMP',mode:'ABS'},0x6C:{mnem:'JMP',mode:'IND'},
  0x20:{mnem:'JSR',mode:'ABS'},0x60:{mnem:'RTS',mode:'IMP'},0x40:{mnem:'RTI',mode:'IMP'},

  // === Branches ===
  0x90:{mnem:'BCC',mode:'REL'},0xB0:{mnem:'BCS',mode:'REL'},0xF0:{mnem:'BEQ',mode:'REL'},
  0x30:{mnem:'BMI',mode:'REL'},0xD0:{mnem:'BNE',mode:'REL'},0x10:{mnem:'BPL',mode:'REL'},
  0x50:{mnem:'BVC',mode:'REL'},0x70:{mnem:'BVS',mode:'REL'},

  // === Flags ===
  0x18:{mnem:'CLC',mode:'IMP'},0x38:{mnem:'SEC',mode:'IMP'},0x58:{mnem:'CLI',mode:'IMP'},
  0x78:{mnem:'SEI',mode:'IMP'},0xB8:{mnem:'CLV',mode:'IMP'},0xD8:{mnem:'CLD',mode:'IMP'},
  0xF8:{mnem:'SED',mode:'IMP'},

  // === BRK / NOP ===
  0x00:{mnem:'BRK',mode:'IMP'},0xEA:{mnem:'NOP',mode:'IMP'},

  // === NOPs não-oficiais (consomem operandos corretos) ===
  // 1 byte
  0x1A:{mnem:'NOP',mode:'IMP'},0x3A:{mnem:'NOP',mode:'IMP'},0x5A:{mnem:'NOP',mode:'IMP'},
  0x7A:{mnem:'NOP',mode:'IMP'},0xDA:{mnem:'NOP',mode:'IMP'},0xFA:{mnem:'NOP',mode:'IMP'},
  // 2 bytes (zp / imm / zp,X)
  0x04:{mnem:'NOP',mode:'ZP'}, 0x44:{mnem:'NOP',mode:'ZP'}, 0x64:{mnem:'NOP',mode:'ZP'},
  0x80:{mnem:'NOP',mode:'IMM'},0x82:{mnem:'NOP',mode:'IMM'},0x89:{mnem:'NOP',mode:'IMM'},
  0xC2:{mnem:'NOP',mode:'IMM'},0xE2:{mnem:'NOP',mode:'IMM'},
  0x14:{mnem:'NOP',mode:'ZPX'},0x34:{mnem:'NOP',mode:'ZPX'},0x54:{mnem:'NOP',mode:'ZPX'},
  0x74:{mnem:'NOP',mode:'ZPX'},0xD4:{mnem:'NOP',mode:'ZPX'},0xF4:{mnem:'NOP',mode:'ZPX'},
  // 3 bytes (abs / abs,X)
  0x0C:{mnem:'NOP',mode:'ABS'},
  0x1C:{mnem:'NOP',mode:'ABSX'},0x3C:{mnem:'NOP',mode:'ABSX'},0x5C:{mnem:'NOP',mode:'ABSX'},
  0x7C:{mnem:'NOP',mode:'ABSX'},0xDC:{mnem:'NOP',mode:'ABSX'},0xFC:{mnem:'NOP',mode:'ABSX'},

  // === KIL/JAM (para debug) ===
  0x02:{mnem:'KIL',mode:'KIL'},0x12:{mnem:'KIL',mode:'KIL'},0x22:{mnem:'KIL',mode:'KIL'},
  0x32:{mnem:'KIL',mode:'KIL'},0x42:{mnem:'KIL',mode:'KIL'},0x52:{mnem:'KIL',mode:'KIL'},
  0x62:{mnem:'KIL',mode:'KIL'},0x72:{mnem:'KIL',mode:'KIL'},0x92:{mnem:'KIL',mode:'KIL'},
  0xB2:{mnem:'KIL',mode:'KIL'},0xD2:{mnem:'KIL',mode:'KIL'},0xF2:{mnem:'KIL',mode:'KIL'},
}

// Tamanho por modo
const MODE_SIZE: Record<Mode, number> = {
  IMP:1, ACC:1, IMM:2, ZP:2, ZPX:2, ZPY:2, ABS:3, ABSX:3, ABSY:3, IND:3, IZX:2, IZY:2, REL:2, KIL:1
}

function hex2(n: number) { return n.toString(16).toUpperCase().padStart(2,'0') }
function hex4(n: number) { return n.toString(16).toUpperCase().padStart(4,'0') }

function formatByMode(info: OpInfo, pc: number, cpu: Cpu6502): string {
  const op = info.mnem
  const m = info.mode
  const b1 = cpu.read((pc + 1) & 0xFFFF)
  const b2 = cpu.read((pc + 2) & 0xFFFF)
  const abs = ((b2 << 8) | b1) & 0xFFFF

  switch (m) {
    case 'IMP': return op
    case 'ACC': return `${op} A`
    case 'IMM': return `${op} #$${hex2(b1)}`
    case 'ZP':  return `${op} $${hex2(b1)}`
    case 'ZPX': return `${op} $${hex2(b1)},X`
    case 'ZPY': return `${op} $${hex2(b1)},Y`
    case 'ABS': return `${op} $${hex4(abs)}`
    case 'ABSX':return `${op} $${hex4(abs)},X`
    case 'ABSY':return `${op} $${hex4(abs)},Y`
    case 'IND': return `${op} ($${hex4(abs)})`
    case 'IZX': return `${op} ($${hex2(b1)},X)`
    case 'IZY': return `${op} ($${hex2(b1)}),Y`
    case 'REL': {
      const rel = b1 < 0x80 ? b1 : b1 - 0x100
      const target = (pc + 2 + rel) & 0xFFFF
      return `${op} $${hex4(target)}`
    }
    case 'KIL': return 'KIL'
  }
}

/**
 * Disassembler completo para o 6502 (oficiais + NOPs comuns + KIL)
 */
export function disassemble6502(opcode: number, pc: number, cpu: Cpu6502): string {
  const info = OP[opcode]
  if (!info) {
    return `??? ($${hex2(opcode)})`
  }
  return formatByMode(info, pc, cpu)
}

/**
 * Retorna o tamanho da instrução em bytes (1–3).
 */
export function getInstructionSize(opcode: number): number {
  const info = OP[opcode]
  if (!info) return 1
  return MODE_SIZE[info.mode] ?? 1
}
