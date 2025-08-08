// src/memory/Memory.ts
import type { Mapper } from '../mappers/Mapper';
import { Ppu } from '../ppu/Ppu';

/**
 * Mapa de memória da CPU do NES (visão simplificada):
 *
 * 0000-07FF: 2KB RAM interna
 * 0800-1FFF: espelhos da RAM (a cada 0x800)
 * 2000-2007: registradores da PPU
 * 2008-3FFF: espelhos dos registradores da PPU (a cada 8 bytes)
 * 4000-4017: APU e I/O (não implementado aqui; 0 nas leituras, ignora writes)
 * 4018-401F: testes do APU (normalmente não usados)
 * 4020-5FFF: expansão/cart (varia por mapper; aqui deixamos 0)
 * 6000-7FFF: PRG-RAM do cartucho (se existir; via mapper)
 * 8000-FFFF: PRG-ROM / registradores do mapper (via mapper)
 */
export class Memory {
  private ram = new Uint8Array(0x0800); // 2KB RAM interna
  private ppu: Ppu;
  private mapper: Mapper | null = null;

  constructor() {
    this.ppu = new Ppu(this);
  }

  attachMapper(mapper: Mapper): void {
    this.mapper = mapper;
    this.mapper.reset();
  }

  /** Leitura do espaço de endereços da CPU. */
  read(addr: number): number {
    addr &= 0xFFFF;

    // 0000-1FFF: RAM com espelhamento a cada 0x800
    if (addr < 0x2000) {
      return this.ram[addr % 0x0800];
    }

    // 2000-3FFF: PPU regs espelhados a cada 8 bytes
    if (addr >= 0x2000 && addr <= 0x3FFF) {
      const reg = 0x2000 | (addr & 0x0007); // 0x2000..0x2007
      return this.ppu.readRegister(reg);
    }

    // 4000-4017: APU/IO (stub)
    if (addr >= 0x4000 && addr <= 0x4017) {
      // 0 por padrão até implementarmos APU/IO
      return 0;
    }

    // 4018-401F: testes do APU (normalmente não usados)
    if (addr >= 0x4018 && addr <= 0x401F) {
      return 0;
    }

    // 6000-FFFF: cartucho (PRG-RAM/PRG-ROM/regs) via mapper
    if (this.mapper && addr >= 0x6000) {
      return this.mapper.cpuRead(addr);
    }

    // Espaço não mapeado
    return 0;
  }

  /** Escrita no espaço de endereços da CPU. */
  write(addr: number, value: number): void {
    addr &= 0xFFFF;
    value &= 0xFF;

    // 0000-1FFF: RAM com espelhamento a cada 0x800
    if (addr < 0x2000) {
      this.ram[addr % 0x0800] = value;
      return;
    }

    // 2000-3FFF: PPU regs espelhados a cada 8 bytes
    if (addr >= 0x2000 && addr <= 0x3FFF) {
      const reg = 0x2000 | (addr & 0x0007); // 0x2000..0x2007
      this.ppu.writeRegister(reg, value);
      return;
    }

    // 4000-4017: APU/IO (stub)
    if (addr >= 0x4000 && addr <= 0x4017) {
      // Ignora até implementarmos APU/IO (ex.: $4014 DMA de OAM)
      return;
    }

    // 4018-401F: testes do APU (ignorar)
    if (addr >= 0x4018 && addr <= 0x401F) {
      return;
    }

    // 6000-FFFF: cartucho via mapper
    if (this.mapper && addr >= 0x6000) {
      this.mapper.cpuWrite(addr, value);
      return;
    }

    // Espaço não mapeado: ignorar
  }

  // ===================== Helpers p/ testes e bootstrap =====================

  /**
   * Carrega um "programa" diretamente na PRG-ROM mapeada em 0x8000 (para testes).
   * Observação: isso escreve via visão da CPU; útil para unit tests simples.
   */
  loadProgram(program: Uint8Array | number[], startAddr: number = 0x8000): void {
    const data = program instanceof Uint8Array ? program : new Uint8Array(program);
    for (let i = 0; i < data.length; i++) {
      this.write(startAddr + i, data[i]);
    }
  }

  /**
   * Carrega bytes como se fossem a PRG em 0x8000 e ajusta o vetor de RESET.
   * Útil em testes de CPU sem mapper.
   */
  loadRom(prgRom: Uint8Array, startAddr: number = 0x8000): void {
    for (let i = 0; i < prgRom.length; i++) {
      this.write(startAddr + i, prgRom[i]);
    }
    // Vetor de RESET em FFFC/FFFD (little endian)
    this.write(0xFFFC, startAddr & 0xFF);
    this.write(0xFFFD, (startAddr >> 8) & 0xFF);
  }

  // ===================== Exposição para PPU/Mapper =====================

  /** A PPU usa para consultar o mapper (CHR/mirroring/IRQ etc.). */
  getMapper(): Mapper | null {
    return this.mapper;
  }

  /** O main.ts precisa obter a instância da PPU. */
  getPpu(): Ppu {
    return this.ppu;
  }
}
