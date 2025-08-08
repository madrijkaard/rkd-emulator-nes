// src/ppu/Renderer.ts
import { Ppu } from './Ppu';
import { NES_PALETTE, Pixel } from './types';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: ImageData;
  private pixels: Uint32Array;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CanvasRenderingContext2D não disponível');
    this.ctx = ctx;

    // NES: 256x240 pixels
    this.buffer = this.ctx.createImageData(256, 240);
    this.pixels = new Uint32Array(this.buffer.data.buffer);
  }

  renderFrame(ppu: Ppu): void {
    this.renderBackground(ppu);
    this.renderSprites(ppu);
    this.ctx.putImageData(this.buffer, 0, 0);
  }

  clear(): void {
    this.pixels.fill(0);
    this.ctx.putImageData(this.buffer, 0, 0);
  }

  // ===================== Background =====================

  private renderBackground(ppu: Ppu): void {
    const showBackground = (ppu.registers.ppumask & 0x08) !== 0; // bit 3: show background
    if (!showBackground) return;

    // Scroll “simplificado” conforme passo 1 (vamos corrigir com loopy regs no passo 2)
    const scrollX = ppu.registers.ppuscroll & 0xFF;
    const scrollY = (ppu.registers.ppuscroll >> 8) & 0xFF;

    // Base da nametable via PPUCTRL bits 0–1
    const baseNametable = 0x2000 + ((ppu.registers.ppuctrl & 0x03) * 0x400);

    // Pattern table base de background via PPUCTRL bit 4
    const patternTableAddr = (ppu.registers.ppuctrl & 0x10) ? 0x1000 : 0x0000;

    for (let y = 0; y < 240; y++) {
      for (let x = 0; x < 256; x++) {
        // Scroll com wrap (simplificado; mirroring de nametable é tratado pela PPU)
        const pixelX = (x + scrollX) % 512; // 2 nametables lado a lado
        const pixelY = (y + scrollY) % 480; // 2 nametables verticalmente

        const tileX = Math.floor(pixelX / 8);
        const tileY = Math.floor(pixelY / 8);

        const nametableAddr = baseNametable + (tileY * 32) + tileX;
        const tileIndex = ppu.readPpuMemory(nametableAddr) & 0xFF;

        const tileAddr = patternTableAddr + (tileIndex * 16);

        const tileRow = pixelY % 8;
        const tileCol = pixelX % 8;

        const colorIndex = this.getTilePixelColor(ppu, tileAddr, tileRow, tileCol);
        this.setPixel(x, y, colorIndex);
      }
    }
  }

  // ===================== Sprites =====================

  private renderSprites(ppu: Ppu): void {
    const showSprites = (ppu.registers.ppumask & 0x10) !== 0; // bit 4: show sprites
    if (!showSprites) return;

    const spriteHeight = (ppu.registers.ppuctrl & 0x20) ? 16 : 8; // bit 5: 8x16 mode

    for (let i = 0; i < 64; i++) {
      const base = i * 4;
      const spriteY = (ppu.oam[base] + 1) & 0xFF; // NES adiciona 1 à coordenada Y
      const tileIndex = ppu.oam[base + 1];
      const attributes = ppu.oam[base + 2];
      const spriteX = ppu.oam[base + 3];

      if (spriteY >= 240 || spriteX >= 256) continue;

      const flipVertical = (attributes & 0x80) !== 0;
      const flipHorizontal = (attributes & 0x40) !== 0;
      const paletteBase = 0x10 + ((attributes & 0x03) * 4); // (próximo passo usará isso corretamente)
      const priorityFront = (attributes & 0x20) === 0; // 0: sprite em frente ao BG

      for (let y = 0; y < spriteHeight; y++) {
        const actualY = flipVertical ? (spriteHeight - 1 - y) : y;

        for (let x = 0; x < 8; x++) {
          const actualX = flipHorizontal ? (7 - x) : x;

          let colorIndex = 0;

          if (spriteHeight === 8) {
            colorIndex = this.getSpritePixelColor(ppu, tileIndex, actualX, actualY);
          } else {
            // 8x16: cada tile ocupa dois índices (par/ímpar), pattern table fixa
            // Implementação completa virá depois; por ora, desenhamos como 8x8 do índice base
            colorIndex = this.getSpritePixelColor(ppu, tileIndex & 0xFE, actualX, actualY & 7);
          }

          // Índice 0 do tile é transparente
          if ((colorIndex & 0x03) !== 0) {
            const screenX = spriteX + x;
            const screenY = spriteY + y;

            if (screenX < 256 && screenY < 240) {
              const dstIndex = screenY * 256 + screenX;
              // Priority simples: se priorityFront, pinta por cima; senão, só se pixel fundo estiver vazio
              if (priorityFront || this.pixels[dstIndex] === 0) {
                // No próximo passo, combinaremos (paletteBase + colorIndex) para escolher cor
                this.setPixel(screenX, screenY, colorIndex + paletteBase);
              }
            }
          }
        }
      }
    }
  }

  // ===================== Helpers de acesso a pattern/tiles =====================

  private getTilePixelColor(ppu: Ppu, tileAddr: number, row: number, col: number): number {
    const lowByte  = ppu.readPpuMemory(tileAddr + row);
    const highByte = ppu.readPpuMemory(tileAddr + row + 8);

    const bit0 = (lowByte  >> (7 - col)) & 1;
    const bit1 = (highByte >> (7 - col)) & 1;

    // 2bpp → 0..3 (sem paleta ainda)
    return (bit1 << 1) | bit0;
  }

  private getSpritePixelColor(ppu: Ppu, tileIndex: number, x: number, y: number): number {
    // Pattern table de sprites via PPUCTRL bit 3 (0x08)
    const patternTableAddr = (ppu.registers.ppuctrl & 0x08) ? 0x1000 : 0x0000;
    const tileAddr = patternTableAddr + (tileIndex * 16) + (y & 7);

    const lowByte  = ppu.readPpuMemory(tileAddr);
    const highByte = ppu.readPpuMemory(tileAddr + 8);

    const bit0 = (lowByte  >> (7 - x)) & 1;
    const bit1 = (highByte >> (7 - x)) & 1;

    return (bit1 << 1) | bit0;
  }

  // ===================== Escrita de pixel =====================

  private setPixel(x: number, y: number, colorIndex: number): void {
    // Neste passo, colorIndex ∈ [0..3] (ou 0..15 para sprites com paletteBase).
    // O próximo passo vai mapear (palettes $3F00–$3F1F + attribute table) → NES_PALETTE[0..63].
    const nesColor = NES_PALETTE[Math.abs(colorIndex) % 64] || { r: 0, g: 0, b: 0, a: 255 };
    const pos = y * 256 + x;
    this.pixels[pos] =
      (nesColor.a << 24) |
      (nesColor.b << 16) |
      (nesColor.g << 8)  |
      (nesColor.r);
  }
}
