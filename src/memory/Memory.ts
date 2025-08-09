// src/memory/Memory.ts
import { Controller, ControllerButton } from '../io/Controller';
import { Ppu } from '../ppu/Ppu';
import type { Mapper } from '../mappers/Mapper';

export class Memory {
  private ram: Uint8Array;
  private ppu: Ppu;
  private mapper: Mapper | null = null;

  private controller1: Controller;
  private controller2: Controller;

  constructor() {
    this.ram = new Uint8Array(0x0800); // 2KB internal RAM
    this.ppu = new Ppu(this);
    this.controller1 = new Controller();
    this.controller2 = new Controller();
  }

  /** Liga um mapper (depois do carregamento da ROM) */
  attachMapper(mapper: Mapper) {
    this.mapper = mapper;
    // NÃO chame this.ppu.setMapper(mapper); a PPU consulta via memory.getMapper()
    // Opcional: reset do mapper ao anexar
    this.mapper.reset?.();
  }

  /** Retorna a PPU principal */
  getPpu(): Ppu {
    return this.ppu;
  }

  /** Retorna o Mapper ativo */
  getMapper(): Mapper | null {
    return this.mapper;
  }

  /** Controller 1 (Player 1) */
  getController1(): Controller {
    return this.controller1;
  }

  /** Controller 2 (Player 2) */
  getController2(): Controller {
    return this.controller2;
  }

  /** Leitura da memória CPU $0000-$FFFF */
  read(addr: number): number {
    addr &= 0xFFFF;

    // RAM interna espelhada até $1FFF
    if (addr < 0x2000) {
      return this.ram[addr & 0x07FF];
    }

    // PPU registers espelhados $2000-$3FFF
    if (addr < 0x4000) {
      // Normaliza espelhos para $2000-$2007
      const reg = 0x2000 | (addr & 0x0007);
      return this.ppu.readRegister(reg);
    }

    // APU/IO não implementados: tratamos apenas controles e DMA
    // Controllers
    if (addr === 0x4016) {
      return this.controller1.readBit();
    }
    if (addr === 0x4017) {
      return this.controller2.readBit();
    }

    // Mapper / PRG ROM / cart
    if (addr >= 0x4020 && this.mapper) {
      return this.mapper.cpuRead(addr);
    }

    return 0;
  }

  /** Escrita na memória CPU $0000-$FFFF */
  write(addr: number, value: number): void {
    addr &= 0xFFFF;
    value &= 0xFF;

    // RAM interna
    if (addr < 0x2000) {
      this.ram[addr & 0x07FF] = value;
      return;
    }

    // PPU registers
    if (addr < 0x4000) {
      const reg = 0x2000 | (addr & 0x0007);
      this.ppu.writeRegister(reg, value);
      return;
    }

    // OAM DMA ($4014): copia 256 bytes da página $XX00..$XXFF para a OAM
    if (addr === 0x4014) {
      this.ppu.oamDma(value);
      return;
    }

    // Controller strobe ($4016)
    if (addr === 0x4016) {
      this.controller1.writeStrobe(value);
      this.controller2.writeStrobe(value);
      return;
    }

    // Mapper / PRG RAM / registradores do cart ($4020+)
    if (addr >= 0x4020 && this.mapper) {
      this.mapper.cpuWrite(addr, value);
      return;
    }

    // Demais endereços (APU etc.) ainda não implementados
  }

  /** Reseta os controladores e PPU */
  reset(): void {
    this.ppu.reset();
    this.controller1.reset();
    this.controller2.reset();
    this.ram.fill(0);
  }

  /** Helpers para simular input via código */
  pressButtonOnController1(btn: ControllerButton | string): void {
    this.controller1.setButton(btn as any, true);
  }

  releaseButtonOnController1(btn: ControllerButton | string): void {
    this.controller1.setButton(btn as any, false);
  }
}
