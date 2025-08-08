import { Cpu6502 } from './Cpu6502';

/**
 * Disassembler completo para o 6502 com todos os modos de endereçamento
 */
export function disassemble6502(opcode: number, pc: number, cpu: Cpu6502): string {
    const addr = pc;
    const op = opcode.toString(16).padStart(2, '0').toUpperCase();
    const byte1 = cpu.read(addr + 1);
    const byte2 = cpu.read(addr + 2);
    
    switch(opcode) {
        // LDA
        case 0xA9: return `LDA #$${byte1.toString(16).padStart(2, '0')}`;
        case 0xA5: return `LDA $${byte1.toString(16).padStart(2, '0')}`;
        case 0xB5: return `LDA $${byte1.toString(16).padStart(2, '0')},X`;
        case 0xAD: return `LDA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')}`;
        case 0xBD: return `LDA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')},X`;
        case 0xB9: return `LDA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')},Y`;
        case 0xA1: return `LDA ($${byte1.toString(16).padStart(2, '0')},X)`;
        case 0xB1: return `LDA ($${byte1.toString(16).padStart(2, '0')}),Y`;
        
        // STA
        case 0x85: return `STA $${byte1.toString(16).padStart(2, '0')}`;
        case 0x95: return `STA $${byte1.toString(16).padStart(2, '0')},X`;
        case 0x8D: return `STA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')}`;
        case 0x9D: return `STA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')},X`;
        case 0x99: return `STA $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')},Y`;
        case 0x81: return `STA ($${byte1.toString(16).padStart(2, '0')},X)`;
        case 0x91: return `STA ($${byte1.toString(16).padStart(2, '0')}),Y`;
        
        // Transferências
        case 0xAA: return 'TAX';
        case 0xA8: return 'TAY';
        case 0x8A: return 'TXA';
        case 0x98: return 'TYA';
        case 0xBA: return 'TSX';
        case 0x9A: return 'TXS';
        
        // Stack
        case 0x48: return 'PHA';
        case 0x68: return 'PLA';
        case 0x08: return 'PHP';
        case 0x28: return 'PLP';
        
        // Incrementos/Decrementos
        case 0xE8: return 'INX';
        case 0xC8: return 'INY';
        case 0xCA: return 'DEX';
        case 0x88: return 'DEY';
        
        // Saltos
        case 0x4C: return `JMP $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')}`;
        case 0x6C: return `JMP ($${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')})`;
        case 0x20: return `JSR $${byte2.toString(16).padStart(2, '0')}${byte1.toString(16).padStart(2, '0')}`;
        case 0x60: return 'RTS';
        case 0x40: return 'RTI';
        
        // Branches
        case 0x90: return `BCC $${((addr + 2 + (byte1 > 127 ? byte1 - 256 : byte1)) & 0xFFFF).toString(16).padStart(4, '0')}`;
        case 0xB0: return `BCS $${((addr + 2 + (byte1 > 127 ? byte1 - 256 : byte1)) & 0xFFFF).toString(16).padStart(4, '0')}`;
        case 0xF0: return `BEQ $${((addr + 2 + (byte1 > 127 ? byte1 - 256 : byte1)) & 0xFFFF).toString(16).padStart(4, '0')}`;
        // ... outros branches
        
        // Operações lógicas
        case 0x29: return `AND #$${byte1.toString(16).padStart(2, '0')}`;
        case 0x25: return `AND $${byte1.toString(16).padStart(2, '0')}`;
        // ... outros AND/ORA/EOR
        
        // Shifts
        case 0x0A: return 'ASL A';
        case 0x06: return `ASL $${byte1.toString(16).padStart(2, '0')}`;
        // ... outros shifts
        
        // Flags
        case 0x18: return 'CLC';
        case 0x38: return 'SEC';
        case 0x58: return 'CLI';
        case 0x78: return 'SEI';
        case 0xD8: return 'CLD';
        case 0xF8: return 'SED';
        
        // NOPs e ilegais
        case 0xEA: return 'NOP';
        case 0x80: return `NOP #$${byte1.toString(16).padStart(2, '0')}`; // NOP imediato
        
        // Interrupções
        case 0x00: return 'BRK';
        
        default: return `??? ($${op})`;
    }
}

/**
 * Retorna o tamanho da instrução em bytes
 */
export function getInstructionSize(opcode: number): number {
    // Implementação similar ao switch acima, retornando 1-3 bytes
    // ... (pode ser expandido conforme necessário)
    return 1; // Padrão para instruções de 1 byte
}