// src/ppu/Ppu.ts
import { Memory } from '../memory/Memory';
import { PpuRegisters } from './PpuRegisters';
import type { Mapper } from '../mappers/Mapper';
import { Mirroring } from '../mappers/Mirroring';

export class Ppu {
  // Registradores e RAMs internas da PPU
  registers = new PpuRegisters();

  // CIRAM (nametables internas): 2KB
  private ciram = new Uint8Array(0x800);

  // OAM (sprites): 256 bytes
  oam = new Uint8Array(256);

  // Palette RAM: 32 bytes em $3F00–$3F1F
  palettes = new Uint8Array(32);

  // Estado de varredura
  private scanline = 0; // -1 (pre-render), 0..239 (visível), 240 (post), 241..260 (VBlank)
  private cycle = 0;    // 0..340

  // Buffer de leitura “atrasada” para PPUDATA (VRAM read buffer)
  private vramBuffer = 0;

  // Latch para PPUSCROLL/PPUADDR: alterna entre primeira e segunda escrita
  private writeToggle = false;

  constructor(private memory: Memory) {}

  // Mapper atual (cartucho)
  private mapper(): Mapper | null {
    return this.memory.getMapper();
  }

  // ===================== Acesso aos registradores mapeados em 0x2000–0x2007 =====================

  readRegister(addr: number): number {
    // A Memory já normaliza 0x2000..0x3FFF → 0x2000..0x2007; mantemos por segurança:
    const reg = 0x2000 | (addr & 0x0007);

    switch (reg) {
      case 0x2002: { // PPUSTATUS
        // Leitura retorna o status atual; limpa VBlank e o latch (writeToggle)
        const status = this.registers.ppustatus;
        // Clear VBlank (bit 7)
        this.registers.ppustatus &= 0x7F;
        // A leitura do status zera o latch de escrita ($2005/$2006)
        this.writeToggle = false;
        // Ler PPUSTATUS também limpa o flag nmiOccurred (sinal consumido)
        this.registers.nmiOccurred = false;
        return status & 0xE0; // Geralmente somente bits 7..5 são significativos na leitura
      }

      case 0x2004: { // OAMDATA
        return this.oam[this.registers.oamaddr & 0xFF];
      }

      case 0x2007: { // PPUDATA (VRAM)
        return this.readPpuData();
      }

      // $2000/$2001/$2003/$2005/$2006 não têm leitura significativa
      default:
        return 0;
    }
  }

  writeRegister(addr: number, value: number): void {
    const reg = 0x2000 | (addr & 0x0007);
    value &= 0xFF;

    switch (reg) {
      case 0x2000: { // PPUCTRL
        this.registers.ppuctrl = value;
        // Bit 7: NMI enable em VBlank
        this.registers.nmiEnabled = (value & 0x80) !== 0;
        break;
      }

      case 0x2001: { // PPUMASK
        this.registers.ppumask = value;
        break;
      }

      case 0x2003: { // OAMADDR
        this.registers.oamaddr = value;
        break;
      }

      case 0x2004: { // OAMDATA
        this.oam[this.registers.oamaddr & 0xFF] = value;
        this.registers.oamaddr = (this.registers.oamaddr + 1) & 0xFF;
        break;
      }

      case 0x2005: { // PPUSCROLL
        // Mantemos o comportamento atual (primeira/segunda escrita), mesmo que não seja loopy completo ainda.
        if (!this.writeToggle) {
          // 1ª write: X scroll (low)
          this.registers.ppuscroll = (this.registers.ppuscroll & 0xFF00) | value;
        } else {
          // 2ª write: Y scroll (high)
          this.registers.ppuscroll = (this.registers.ppuscroll & 0x00FF) | (value << 8);
        }
        this.writeToggle = !this.writeToggle;
        break;
      }

      case 0x2006: { // PPUADDR
        // Mantemos seu padrão anterior (low depois high), apesar do comportamento real ser high→low.
        if (!this.writeToggle) {
          // 1ª write: low
          this.registers.ppuaddr = (this.registers.ppuaddr & 0xFF00) | value;
        } else {
          // 2ª write: high
          this.registers.ppuaddr = (this.registers.ppuaddr & 0x00FF) | (value << 8);
        }
        this.writeToggle = !this.writeToggle;
        break;
      }

      case 0x2007: { // PPUDATA
        this.writePpuData(value);
        break;
      }
    }
  }

  // ===================== Acesso ao espaço PPU 0x0000–0x3FFF (VRAM space) =====================

  /**
   * Le o espaço da PPU:
   * - 0x0000–0x1FFF: CHR (pattern tables) → via mapper
   * - 0x2000–0x2FFF: nametables → via CIRAM com mirroring
   * - 0x3F00–0x3F1F: palette RAM (espelhos em 0x3F20–0x3FFF)
   */
  readPpuMemory(addr: number): number {
    addr &= 0x3FFF;

    if (addr < 0x2000) {
      const m = this.mapper();
      return m ? m.ppuRead(addr) : 0;
    }

    if (addr < 0x3F00) {
      const ciramAddr = this.resolveNametableAddr(addr);
      return this.ciram[ciramAddr];
    }

    // Palette RAM
    const pal = this.resolvePaletteAddr(addr);
    return this.palettes[pal];
  }

  writePpuMemory(addr: number, value: number): void {
    addr &= 0x3FFF;
    value &= 0xFF;

    if (addr < 0x2000) {
      const m = this.mapper();
      if (m) m.ppuWrite(addr, value);
      return;
    }

    if (addr < 0x3F00) {
      const ciramAddr = this.resolveNametableAddr(addr);
      this.ciram[ciramAddr] = value;
      return;
    }

    // Palette RAM: espelhamentos especiais
    const pal = this.resolvePaletteAddr(addr);
    this.palettes[pal] = value;

    // Espelha entradas de fundo ($3F10==$3F00, $3F14==$3F04, etc.)
    if ((pal & 0x03) === 0x00) {
      // indices 0x00, 0x04, 0x08, 0x0C também espelham para 0x10.. (BG universal)
      this.palettes[(pal + 0x10) & 0x1F] = value;
    }
  }

  private readPpuData(): number {
    const addr = this.registers.ppuaddr & 0x3FFF;
    let value = 0;

    if (addr < 0x3F00) {
      // Leitura bufferizada (lê o buffer anterior; busca novo da VRAM/CHR)
      value = this.vramBuffer;
      this.vramBuffer = this.readPpuMemory(addr);
    } else {
      // Leitura de palette não é bufferizada
      value = this.readPpuMemory(addr);
      // Mantemos o buffer com o dado do mesmo endereço “espelhado” como muitos emus fazem
      this.vramBuffer = this.readPpuMemory((addr - 0x1000) & 0x3FFF);
    }

    // Incremento de endereço: bit 2 de PPUCTRL → +32 (vertical) senão +1
    const increment = (this.registers.ppuctrl & 0x04) ? 32 : 1;
    this.registers.ppuaddr = (this.registers.ppuaddr + increment) & 0xFFFF;

    return value;
  }

  private writePpuData(value: number): void {
    const addr = this.registers.ppuaddr & 0x3FFF;
    this.writePpuMemory(addr, value);

    const increment = (this.registers.ppuctrl & 0x04) ? 32 : 1;
    this.registers.ppuaddr = (this.registers.ppuaddr + increment) & 0xFFFF;
  }

  // ===================== Mirroring de nametables (CIRAM) =====================

  /**
   * Converte endereços 0x2000–0x2FFF para o índice dentro da CIRAM (0..0x7FF),
   * aplicando o mirroring atual do cartucho (consulta ao mapper).
   */
  private resolveNametableAddr(addr: number): number {
    // 0x2000–0x2FFF → 0..0xFFF (4 nametables de 1KB)
    const base = (addr - 0x2000) & 0x0FFF; // 0..4095
    const table = base >> 10;              // 0..3 (cada 1KB)
    const offset = base & 0x03FF;          // 0..1023 (dentro da nametable)
    const mode = this.mapper()?.getMirroring();

    switch (mode) {
      case Mirroring.Vertical:
        // [A B][A B] → tables 0 & 2 → A(0), 1 & 3 → B(1)
        return ((table & 1) * 0x400) | offset; // 0x000..0x3FF ou 0x400..0x7FF
      case Mirroring.Horizontal:
        // [A A][B B] → tables 0 & 1 → A(0), 2 & 3 → B(1)
        return ((table >> 1) * 0x400) | offset; // 0x000..0x3FF ou 0x400..0x7FF
      case Mirroring.FourScreen:
        // Exigiria 4KB de CIRAM; por ora mapear como vertical para não quebrar
        return ((table & 1) * 0x400) | offset;
      default:
        // fallback: vertical
        return ((table & 1) * 0x400) | offset;
    }
  }

  /**
   * Resolve o índice da palette RAM ($3F00–$3F1F) com espelhos e exceções:
   * - $3F10 == $3F00, $3F14 == $3F04, $3F18 == $3F08, $3F1C == $3F0C
   * - $3F20–$3FFF: espelhos de $3F00–$3F1F
   */
  private resolvePaletteAddr(addr: number): number {
    let a = 0x3F00 + ((addr - 0x3F00) & 0x1F);
    if (a === 0x3F10) a = 0x3F00;
    if (a === 0x3F14) a = 0x3F04;
    if (a === 0x3F18) a = 0x3F08;
    if (a === 0x3F1C) a = 0x3F0C;
    return a & 0x1F; // índice 0..31 no array palettes
    // (No array palettes, usamos índices 0..31; cores reais ficam a cargo do Renderer)
  }

  // ===================== Temporização / VBlank / NMI =====================

  /**
   * Avança um “ciclo” da PPU (3× para cada ciclo da CPU).
   * Neste estágio, simulamos apenas a janela de VBlank e a geração de NMI.
   */
  step(): void {
    this.cycle++;
    if (this.cycle >= 341) {
      this.cycle = 0;
      this.scanline++;

      // Início do VBlank (scanline 241)
      if (this.scanline === 241) {
        // Seta VBlank em PPUSTATUS
        this.registers.ppustatus |= 0x80;

        // Dispara NMI se habilitado em PPUCTRL
        if (this.registers.nmiEnabled) {
          this.registers.nmiOccurred = true;
        }
      }

      // Pre-render (scanline -1 → representado aqui ao fechar 261 e voltar pra -1)
      if (this.scanline >= 261) {
        this.scanline = -1;
        // Limpa VBlank
        this.registers.ppustatus &= ~0x80;
        // sprite 0 hit e overflow (não implementados ainda) também seriam limpos aqui
      }
    }
  }

  // API usada pelo main.ts para detectar/limpar NMI
  isNmiOccurred(): boolean {
    return this.registers.nmiOccurred;
  }

  clearNmi(): void {
    this.registers.nmiOccurred = false;
  }

  // ===================== Reset =====================

  reset(): void {
    this.cycle = 0;
    this.scanline = 0;
    this.vramBuffer = 0;
    this.writeToggle = false;

    this.registers.ppuctrl = 0;
    this.registers.ppumask = 0;
    this.registers.ppustatus = 0;
    this.registers.oamaddr = 0;
    this.registers.ppuscroll = 0;
    this.registers.ppuaddr = 0;
    this.registers.ppudata = 0;
    this.registers.nmiOccurred = false;
    this.registers.nmiEnabled = false;

    this.ciram.fill(0);
    this.oam.fill(0);
    this.palettes.fill(0);
  }
}
