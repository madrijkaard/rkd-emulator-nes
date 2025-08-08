import type { Mapper } from '../mappers/Mapper';
import { Ppu } from '../ppu/Ppu';

export class Memory {
    private ram = new Uint8Array(0x0800); // 2KB de RAM
    private ppu: Ppu;
    private mapper: Mapper | null = null;

    constructor() {
        this.ppu = new Ppu(this);
    }

    attachMapper(mapper: Mapper): void {
        this.mapper = mapper;
        this.mapper.reset();
    }

    read(addr: number): number {
        addr &= 0xFFFF; // Garante 16-bit

        // RAM principal (0x0000-0x1FFF) com espelhamento
        if (addr < 0x2000) {
            return this.ram[addr % 0x0800];
        }

        // PPU (0x2000-0x3FFF) com espelhamento
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            return this.ppu.readRegister(addr & 0x2007);
        }

        // APU e I/O (0x4000-0x4017)
        if (addr >= 0x4000 && addr <= 0x4017) {
            // Implementação básica - retorna 0 para I/O não implementado
            return 0;
        }

        // Mapper (0x6000-0xFFFF)
        if (this.mapper && addr >= 0x6000) {
            return this.mapper.cpuRead(addr);
        }

        // Espaço não mapeado
        return 0;
    }

    write(addr: number, value: number): void {
        addr &= 0xFFFF;
        value &= 0xFF;

        // RAM principal (0x0000-0x1FFF)
        if (addr < 0x2000) {
            this.ram[addr % 0x0800] = value;
            return;
        }

        // PPU (0x2000-0x3FFF)
        if (addr >= 0x2000 && addr <= 0x3FFF) {
            this.ppu.writeRegister(addr & 0x2007, value);
            return;
        }

        // APU e I/O (0x4000-0x4017)
        if (addr >= 0x4000 && addr <= 0x4017) {
            // Implementação básica - ignora writes para I/O não implementado
            return;
        }

        // Mapper (0x6000-0xFFFF)
        if (this.mapper && addr >= 0x6000) {
            this.mapper.cpuWrite(addr, value);
            return;
        }
    }

    // Métodos auxiliares para testes
    loadProgram(program: Uint8Array, startAddr: number = 0x8000): void {
        for (let i = 0; i < program.length; i++) {
            this.write(startAddr + i, program[i]);
        }
    }

    loadRom(prgRom: Uint8Array, startAddr: number = 0x8000): void {
        for (let i = 0; i < prgRom.length; i++) {
            this.write(startAddr + i, prgRom[i]);
        }
        this.write(0xFFFC, startAddr & 0xFF);
        this.write(0xFFFD, (startAddr >> 8) & 0xFF);
    }
}