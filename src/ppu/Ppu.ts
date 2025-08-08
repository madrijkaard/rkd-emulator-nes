import { Memory } from '../memory/Memory';

export class Ppu {
    // Registradores da PPU
    public ppuctrl = 0;     // $2000
    public ppumask = 0;     // $2001
    public ppustatus = 0;   // $2002
    public oamaddr = 0;     // $2003
    public ppudata = 0;     // $2007

    // Memórias internas
    private vram = new Uint8Array(0x4000);  // 16KB VRAM (espelhada)
    private oam = new Uint8Array(256);      // OAM (Sprite RAM)
    private palettes = new Uint8Array(32);  // Paletas ($3F00-$3F1F)

    // Estado interno
    private scanline = 0;
    private cycle = 0;
    private nmiEnabled = false;
    private nmiOccurred = false;

    constructor(private memory: Memory) {}

    // Lê um registrador da PPU
    readRegister(addr: number): number {
        switch (addr) {
            case 0x2002: // PPUSTATUS
                const status = this.ppustatus;
                this.ppustatus &= 0x7F; // Limpa bit de VBlank
                this.nmiOccurred = false;
                return status;

            case 0x2007: // PPUDATA
                return this.readPpuData();

            default:
                return 0;
        }
    }

    // Escreve em um registrador da PPU
    writeRegister(addr: number, value: number): void {
        switch (addr) {
            case 0x2000: // PPUCTRL
                this.ppuctrl = value;
                this.nmiEnabled = (value & 0x80) !== 0;
                break;

            case 0x2001: // PPUMASK
                this.ppumask = value;
                break;

            case 0x2006: // PPUADDR
                this.writePpuAddr(value);
                break;

            case 0x2007: // PPUDATA
                this.writePpuData(value);
                break;
        }
    }

    private writePpuAddr(value: number): void {
        // Implementação simplificada - na prática precisa de 2 writes
        this.vramAddr = (this.vramAddr << 8) | (value & 0xFF);
    }

    private readPpuData(): number {
        // Implemente a lógica de leitura incremental
        return this.vram[this.vramAddr++ % 0x4000];
    }

    private writePpuData(value: number): void {
        // Implemente a lógica de escrita
        this.vram[this.vramAddr++ % 0x4000] = value;
    }

    // Executa um ciclo da PPU
    step(): void {
        this.cycle++;
        
        // Lógica simplificada de scanlines
        if (this.cycle >= 341) {
            this.cycle = 0;
            this.scanline++;
            
            if (this.scanline >= 261) {
                this.scanline = -1;
                this.startVBlank();
            }
        }
    }

    private startVBlank(): void {
        this.ppustatus |= 0x80; // Seta flag de VBlank
        this.nmiOccurred = true;
        
        if (this.nmiEnabled) {
            // Deveria gerar NMI na CPU
        }
    }
}