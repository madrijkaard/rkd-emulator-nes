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

  // Sinalização auxiliar para emular uma borda A12 por scanline (MMC3)
  private a12EdgeDoneThisScanline = false;

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
        // Leitura retorna o status atual; limpa VBlank e o latch (w)
        const status = this.registers.ppustatus;
        // Clear VBlank (bit 7)
        this.registers.ppustatus &= 0x7F;
        // A leitura do status zera o latch de escrita ($2005/$2006)
        this.registers.w = false;
        // Ler PPUSTATUS também limpa o flag nmiOccurred (sinal consumido)
        this.registers.nmiOccurred = false;
        // Bits 7..5 costumam ser os significativos numa leitura real
        return status & 0xE0;
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
        // Bits 0–1: base nametable → escrevem em t (loopy)
        // t: ....AB........ = value & 0x03
        this.registers.t = (this.registers.t & ~0x0C00) | ((value & 0x03) << 10);
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

      case 0x2005: { // PPUSCROLL (loopy: primeira e segunda escrita com w)
        // Mantemos ppuscroll apenas como legado/depuração visual
        if (!this.registers.w) {
          // 1ª write: X scroll fino e coarse X
          // x = value & 7
          // t: .....XXXXX = value >> 3
          this.registers.x = value & 0x07;
          this.registers.t = (this.registers.t & ~0x001F) | ((value >> 3) & 0x1F);
          this.registers.ppuscroll = (this.registers.ppuscroll & 0xFF00) | value;
        } else {
          // 2ª write: fine Y e coarse Y
          // t: ...YYYYY..... = (value >> 3) & 0x1F
          // t: yyy.......... = value & 0x07 (fine Y)
          const coarseY = (value >> 3) & 0x1F;
          const fineY   = (value & 0x07);
          this.registers.t =
            (this.registers.t & ~0x73E0) | // 0b0111_0011_1110_0000
            ((coarseY & 0x1F) << 5) |
            ((fineY & 0x07) << 12);
          this.registers.ppuscroll = (this.registers.ppuscroll & 0x00FF) | (value << 8);
        }
        this.registers.w = !this.registers.w;
        break;
      }

      case 0x2006: { // PPUADDR (loopy: ordem correta é high → low)
        if (!this.registers.w) {
          // 1ª write (high): t: .HHHHHH........ = value & 0x3F (bit 14 força 0)
          this.registers.t = (this.registers.t & 0x00FF) | ((value & 0x3F) << 8);
          // zera bit 14 (garante 15 bits)
          this.registers.t &= 0x7FFF;
          this.registers.ppuaddr = (this.registers.ppuaddr & 0x00FF) | (value << 8);
        } else {
          // 2ª write (low): t: ........LLLLLLLL = value; v = t
          this.registers.t = (this.registers.t & 0x7F00) | value;
          this.registers.v = this.registers.t & 0x7FFF;
          this.registers.ppuaddr = (this.registers.ppuaddr & 0xFF00) | value;
        }
        this.registers.w = !this.registers.w;
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
   * Lê o espaço da PPU:
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
    const vAddr = this.registers.v & 0x3FFF;
    let value = 0;

    if (vAddr < 0x3F00) {
      // Leitura bufferizada (lê o buffer anterior; busca novo da VRAM/CHR)
      value = this.vramBuffer;
      this.vramBuffer = this.readPpuMemory(vAddr);
    } else {
      // Leitura de palette não é bufferizada
      value = this.readPpuMemory(vAddr);
      // Mantemos o buffer com o dado do mesmo endereço “espelhado” como muitos emus fazem
      this.vramBuffer = this.readPpuMemory((vAddr - 0x1000) & 0x3FFF);
    }

    this.incrementV();
    return value;
  }

  private writePpuData(value: number): void {
    const vAddr = this.registers.v & 0x3FFF;
    this.writePpuMemory(vAddr, value);
    this.incrementV();
  }

  /** Incrementa v após acesso a PPUDATA: +1 (horizontal) ou +32 (vertical) de acordo com PPUCTRL bit 2. */
  private incrementV(): void {
    const add = (this.registers.ppuctrl & 0x04) ? 32 : 1;
    this.registers.v = (this.registers.v + add) & 0x7FFF;
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

  // ===================== Helpers do loopy (incrementos e cópias) =====================

  /** Incrementa coarse X em v (com wrap e toggle de nametable horizontal). */
  private incrementCoarseX(): void {
    if ((this.registers.v & 0x001F) === 31) {
      // coarse X = 0, troca NT horizontal
      this.registers.v &= ~0x001F;
      this.registers.v ^= 0x0400;
    } else {
      this.registers.v += 1;
    }
    this.registers.v &= 0x7FFF;
  }

  /** Incrementa fine Y/coarse Y em v com regras 29/31 e troca de nametable vertical. */
  private incrementY(): void {
    let v = this.registers.v;

    if ((v & 0x7000) !== 0x7000) {
      // ainda dentro de fine Y (0..6) → ++fine Y
      v += 0x1000;
    } else {
      // fine Y vai de 7 para 0
      v &= ~0x7000;
      let coarseY = (v & 0x03E0) >> 5;
      if (coarseY === 29) {
        coarseY = 0;
        // troca NT vertical
        v ^= 0x0800;
      } else if (coarseY === 31) {
        // 31 → wrap para 0 (sem trocar NT)
        coarseY = 0;
      } else {
        coarseY += 1;
      }
      v = (v & ~0x03E0) | ((coarseY & 0x1F) << 5);
    }

    this.registers.v = v & 0x7FFF;
  }

  /** Copia coarse X e NT horizontal de t → v (no começo de cada scanline visível). */
  private copyHorizontalBits(): void {
    this.registers.v = (this.registers.v & ~0x041F) | (this.registers.t & 0x041F);
  }

  /** Copia fine Y, coarse Y e NT vertical de t → v (no início da pre-render). */
  private copyVerticalBits(): void {
    this.registers.v = (this.registers.v & ~0x7BE0) | (this.registers.t & 0x7BE0);
  }

  // ===================== Temporização / VBlank / NMI =====================

  /**
   * Avança um “ciclo” da PPU (3× para cada ciclo da CPU).
   * Neste estágio, simulamos a janela de VBlank e a geração de NMI.
   * Além disso, sintetizamos **uma borda A12 por scanline visível** quando o BG está ligado,
   * para clockar o IRQ do MMC3 (Mapper 4) com timing de scanline.
   *
   * Também aplicamos as cópias loopy simplificadas:
   *  - No início da pre-render (scanline -1): copia vertical (t→v: fineY/coarseY/NTv)
   *  - No início de cada scanline visível: copia horizontal (t→v: coarseX/NTh)
   */
  step(): void {
    this.cycle++;

    // Durante scanlines visíveis (0..239), sintetizar uma borda A12
    if (this.scanline >= 0 && this.scanline <= 239) {
      // bit 3 do PPUMASK: show background
      const bgOn = (this.registers.ppumask & 0x08) !== 0;
      if (bgOn && !this.a12EdgeDoneThisScanline) {
        // Síntese mínima compatível com filtro do Mapper4:
        // - várias leituras com A12=0 (< $1000) para acumular "low streak" e reduzir cooldown interno
        // - uma leitura com A12=1 (>= $1000) para gerar a borda 0→1
        const m = this.mapper();
        if (m) {
          for (let i = 0; i < 16; i++) {
            const lowAddr = 0x0000 + ((i * 2) & 0x0FFE);
            m.ppuRead(lowAddr & 0x1FFF);
          }
          m.ppuRead(0x1000);
          this.a12EdgeDoneThisScanline = true;
        }
      }
    }

    if (this.cycle >= 341) {
      this.cycle = 0;

      // Avança scanline
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

      // Ao entrar numa nova scanline (qualquer), reseta a flag de A12 da scanline
      this.a12EdgeDoneThisScanline = false;

      // Pre-render termina em 260 e volta pra -1; quando chegamos em 261 → volta pra -1
      if (this.scanline >= 261) {
        this.scanline = -1;
        // Limpa VBlank
        this.registers.ppustatus &= ~0x80;
        // sprite 0 hit e overflow (não implementados ainda) também seriam limpos aqui
      }

      // Cópias loopy simplificadas no início de linhas:
      const bgOn = (this.registers.ppumask & 0x08) !== 0;

      if (this.scanline === -1) {
        // Início da pre-render: copiar vertical (t→v)
        if (bgOn) this.copyVerticalBits();
      } else if (this.scanline >= 0 && this.scanline <= 239) {
        // Início de cada scanline visível: copiar horizontal (t→v)
        if (bgOn) this.copyHorizontalBits();
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
    this.a12EdgeDoneThisScanline = false;

    // Registradores
    this.registers.ppuctrl = 0;
    this.registers.ppumask = 0;
    this.registers.ppustatus = 0;
    this.registers.oamaddr = 0;

    // Legado/depuração (não usados pelo loopy real)
    this.registers.ppuscroll = 0;
    this.registers.ppuaddr = 0;
    this.registers.ppudata = 0;

    // Loopy state
    this.registers.v = 0;
    this.registers.t = 0;
    this.registers.x = 0;
    this.registers.w = false;

    this.registers.nmiOccurred = false;
    this.registers.nmiEnabled = false;

    this.ciram.fill(0);
    this.oam.fill(0);
    this.palettes.fill(0);
  }
}
