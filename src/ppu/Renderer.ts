// src/ppu/Renderer.ts
import { Ppu } from './Ppu';
import { NES_PALETTE, NES_PALETTE_RGBA } from './types';

export class Renderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private buffer: ImageData;
  private pixels: Uint32Array;

  // Máscara com o "patternBits" do BG (0..3) por pixel para resolver prioridade com sprites
  // 0 => BG transparente; 1..3 => BG opaco naquele pixel
  private bgMask: Uint8Array;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('CanvasRenderingContext2D não disponível');
    this.ctx = ctx;

    // NES: 256x240 pixels
    this.buffer = this.ctx.createImageData(256, 240);
    this.pixels = new Uint32Array(this.buffer.data.buffer);
    this.bgMask = new Uint8Array(256 * 240);
  }

  renderFrame(ppu: Ppu): void {
    // Zera a máscara do BG a cada quadro
    this.bgMask.fill(0);

    this.renderBackground(ppu);
    this.renderSprites(ppu);
    this.ctx.putImageData(this.buffer, 0, 0);
  }

  clear(): void {
    this.pixels.fill(0);
    this.bgMask.fill(0);
    this.ctx.putImageData(this.buffer, 0, 0);
  }

  // ===================== Background com loopy v/t/x =====================

  private renderBackground(ppu: Ppu): void {
    const showBackground = (ppu.registers.ppumask & 0x08) !== 0; // PPUMASK bit 3
    if (!showBackground) return;

    // Estados loopy capturados no início do frame
    // v0 é a origem (top-left) atual; fineX controla deslocamento fino horizontal
    const v0 = ppu.registers.v & 0x7FFF;
    const fineX = ppu.registers.x & 0x07;

    // Decomposição de v0
    const baseCoarseX = v0 & 0x1F;               // 0..31
    const baseCoarseY = (v0 >> 5) & 0x1F;        // 0..31
    const baseNT      = (v0 >> 10) & 0x03;       // 0..3
    const baseFineY   = (v0 >> 12) & 0x07;       // 0..7

    // Pattern table base do BG via PPUCTRL bit 4
    const patternBase = (ppu.registers.ppuctrl & 0x10) ? 0x1000 : 0x0000;

    for (let y = 0; y < 240; y++) {
      // Y total levando em conta fineY e coarseY
      const totY = ((baseCoarseY << 3) | baseFineY) + y;
      let tileY = (totY >> 3) & 0x1F;        // 0..31 (nametable tem 32 linhas; 30 visíveis)
      const pixelInTileY = totY & 0x07;      // 0..7
      const ntYToggle = (totY >> 3) >= 30 ? 1 : 0; // passou da linha 239 → alterna NT vertical

      for (let x = 0; x < 256; x++) {
        // X total levando em conta fineX e coarseX; cruza 256 → alterna NT horizontal
        const totX = ((baseCoarseX << 3) | fineX) + x;
        const tileX = (totX >> 3) & 0x1F;    // 0..31
        const pixelInTileX = totX & 0x07;    // 0..7
        const ntXToggle = (totX >> 8) & 1;   // cruzou 256px? 0→1

        // Seleção da nametable final a partir da base e toggles
        const ntH = (baseNT & 1) ^ ntXToggle;
        const ntV = ((baseNT >> 1) & 1) ^ ntYToggle;
        const ntSel = (ntV << 1) | ntH;
        const ntBase = 0x2000 + (ntSel * 0x400);

        // Endereço do tile na nametable
        const ntAddr = ntBase + (tileY * 32) + tileX;
        const tileIndex = ppu.readPpuMemory(ntAddr) & 0xFF;

        // Attribute table:
        //  base = (ntBase & 0x2C00) | 0x03C0
        //  offset = ((tileY >> 2) << 3) | (tileX >> 2)
        const atAddr = (ntBase & 0x2C00) | 0x03C0 | ((tileY >> 2) << 3) | (tileX >> 2);
        const atByte = ppu.readPpuMemory(atAddr) & 0xFF;

        // Seleção do quadrante 2x2 dentro do attribute byte
        // (tileX&2) → bit, (tileY&2) → outro; mapeia em deslocamentos 0,2,4,6
        const shift = ((tileY & 2) ? 4 : 0) | ((tileX & 2) ? 2 : 0);
        const attr = (atByte >> shift) & 0x03; // 0..3

        // Fetch de pattern (2bpp)
        const tileAddr = patternBase + (tileIndex * 16);
        const low  = ppu.readPpuMemory(tileAddr + pixelInTileY);
        const high = ppu.readPpuMemory(tileAddr + pixelInTileY + 8);
        const bit0 = (low  >> (7 - pixelInTileX)) & 1;
        const bit1 = (high >> (7 - pixelInTileX)) & 1;
        const patternBits = (bit1 << 1) | bit0; // 0..3

        // Índice de paleta 0..15 para BG
        const palIndex = (attr << 2) | patternBits;

        // $3F00 + palIndex → cor NES (0..63)
        const nesColorIndex = ppu.readPpuMemory(0x3F00 + palIndex) & 0x3F;

        // Grava pixel e também a máscara (patternBits) para prioridade com sprites
        this.setPixelFromPalette(x, y, nesColorIndex);
        this.bgMask[y * 256 + x] = patternBits & 0x03;
      }
    }
  }

  // ===================== Sprites (8x8, 8x16, palettes) =====================

  private renderSprites(ppu: Ppu): void {
    const showSprites = (ppu.registers.ppumask & 0x10) !== 0; // PPUMASK bit 4
    if (!showSprites) return;

    const spriteHeight = (ppu.registers.ppuctrl & 0x20) ? 16 : 8; // bit 5: 8x16 mode

    // Pattern table de sprites (apenas para 8x8; em 8x16, depende do tileIndex bit0)
    const patternBase8x8 = (ppu.registers.ppuctrl & 0x08) ? 0x1000 : 0x0000;

    for (let i = 0; i < 64; i++) {
      const base = i * 4;
      const spriteY = (ppu.oam[base] + 1) & 0xFF; // no NES, OAM Y é +1
      const tileIndex = ppu.oam[base + 1];
      const attributes = ppu.oam[base + 2];
      const spriteX = ppu.oam[base + 3];

      if (spriteY >= 240 || spriteX >= 256) continue;

      const flipVertical = (attributes & 0x80) !== 0;
      const flipHorizontal = (attributes & 0x40) !== 0;
      const paletteSel = attributes & 0x03; // 0..3
      const priorityFront = (attributes & 0x20) === 0; // 0: em frente ao BG

      for (let y = 0; y < spriteHeight; y++) {
        const srcY = flipVertical ? (spriteHeight - 1 - y) : y;

        for (let x = 0; x < 8; x++) {
          const srcX = flipHorizontal ? (7 - x) : x;

          // 2bpp do sprite no NES
          const patternBits = this.getSpritePatternBits(
            ppu,
            patternBase8x8,
            tileIndex,
            srcX,
            srcY,
            spriteHeight === 16
          );

          // Transparência: patternBits==0 não desenha
          if ((patternBits & 0x03) === 0) continue;

          const screenX = spriteX + x;
          const screenY = spriteY + y;
          if (screenX >= 256 || screenY >= 240) continue;

          const dstIndex = screenY * 256 + screenX;

          // Paleta de sprite: $3F10 + paletteSel*4 + patternBits
          const palBase = 0x3F10 + (paletteSel * 4);
          const nesColorIndex = ppu.readPpuMemory(palBase + (patternBits & 0x03)) & 0x3F;

          // Prioridade: se atrás do BG, só desenha se BG "transparente" (patternBits==0 no BG)
          if (priorityFront || this.bgMask[dstIndex] === 0) {
            this.setPixelFromPalette(screenX, screenY, nesColorIndex);
          }
        }
      }
    }
  }

  // Retorna os 2 bits de cor (0..3) do sprite na coordenada interna (x,y)
  private getSpritePatternBits(
    ppu: Ppu,
    patternBase8x8: number,
    tileIndex: number,
    x: number,
    y: number,
    is8x16: boolean
  ): number {
    if (!is8x16) {
      // 8x8: pattern table vem de PPUCTRL bit 3
      const tileAddr = patternBase8x8 + (tileIndex * 16) + (y & 7);
      const low  = ppu.readPpuMemory(tileAddr);
      const high = ppu.readPpuMemory(tileAddr + 8);
      const bit0 = (low  >> (7 - x)) & 1;
      const bit1 = (high >> (7 - x)) & 1;
      return (bit1 << 1) | bit0;
    }

    // 8x16: pattern table depende do bit0 do tileIndex
    // baseTable = (tileIndex & 1) ? 0x1000 : 0x0000
    // o tileIndex efetivo (8x8) é (tileIndex & 0xFE) para a metade de cima e (|1) para a metade de baixo
    const tableBase = (tileIndex & 1) ? 0x1000 : 0x0000;

    const topOrBottom = (y >> 3) & 1; // 0 para topo (0..7), 1 para baixo (8..15)
    const subTileIndex = (tileIndex & 0xFE) | topOrBottom; // par/ímpar

    const tileAddr = tableBase + (subTileIndex * 16) + (y & 7);
    const low  = ppu.readPpuMemory(tileAddr);
    const high = ppu.readPpuMemory(tileAddr + 8);
    const bit0 = (low  >> (7 - x)) & 1;
    const bit1 = (high >> (7 - x)) & 1;
    return (bit1 << 1) | bit0;
  }

  // ===================== Helpers =====================

  private setPixelFromPalette(x: number, y: number, nesColorIndex: number): void {
    const idx = (y * 256 + x) >>> 0;
    // Usa a versão empacotada pra velocidade; fallback se não existir
    if (NES_PALETTE_RGBA) {
      this.pixels[idx] = NES_PALETTE_RGBA[nesColorIndex & 0x3F];
    } else {
      const c = NES_PALETTE[nesColorIndex & 0x3F] || { r: 0, g: 0, b: 0, a: 255 };
      this.pixels[idx] = (c.a << 24) | (c.b << 16) | (c.g << 8) | c.r;
    }
  }
}
