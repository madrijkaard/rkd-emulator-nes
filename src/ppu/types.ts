export interface Pixel {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const NES_PALETTE: Pixel[] = [
  { r: 84, g: 84, b: 84, a: 255 },    // 0x00
  { r: 0, g: 30, b: 116, a: 255 },    // 0x01
  // ... Complete todas as 64 cores da paleta NES
  // Fonte: https://wiki.nesdev.org/w/index.php/PPU_palettes
];

export interface RendererOptions {
  scanlines?: boolean;
  overscan?: boolean;
}