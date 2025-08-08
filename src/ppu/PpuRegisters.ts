// src/ppu/PpuRegisters.ts

/**
 * Registradores “visíveis” da PPU + estado interno usado para scroll real (loopy v/t/x).
 *
 * Notas:
 * - v (current VRAM address, 15 bits)
 * - t (temporary VRAM address, 15 bits)
 * - x (fine X scroll, 3 bits)
 * - w (latch/toggle de escrita para $2005/$2006)
 *
 * Os campos ppuscroll/ppuaddr ficam como legado apenas para depuração/transição.
 * A lógica real de endereço/scroll deve usar v/t/x/w dentro da PPU.
 */
export class PpuRegisters {
  // ----------------------------
  // Registradores mapeados (CPU)
  // ----------------------------
  ppuctrl = 0;   // $2000
  ppumask = 0;   // $2001
  ppustatus = 0; // $2002
  oamaddr = 0;   // $2003
  // Legado (transitório): mantidos para debug/compat, mas o loopy não depende deles
  ppuscroll = 0; // $2005 (legacy; NÃO é o scroll real)
  ppuaddr  = 0;  // $2006 (legacy; NÃO é o endereço real)
  ppudata  = 0;  // $2007 (sem efeito real; leitura/escrita é via PPU)

  // ----------------------------
  // Flags auxiliares
  // ----------------------------
  nmiOccurred = false; // usado para sinalizar NMI ao fim do VBlank
  nmiEnabled  = false; // espelha bit 7 de $2000 (PPUCTRL)

  // ----------------------------
  // Loopy scroll state
  // ----------------------------
  /**
   * Endereço VRAM “current” (15 bits, formato: yyy NN YYYYY XXXXX)
   *   yyy: fine Y (3 bits)        → bits 12–14
   *   NN : nametable select (2b)  → bits 10–11
   *   YYYYY: coarse Y (5 bits)    → bits 5–9
   *   XXXXX: coarse X (5 bits)    → bits 0–4
   */
  v = 0;

  /**
   * Endereço VRAM “temporary” (15 bits, mesmo layout de v)
   * Recebe partes via $2000/$2005/$2006 e é copiado para v em momentos específicos.
   */
  t = 0;

  /**
   * Fine X scroll (3 bits: 0–7). Define o deslocamento fino horizontal.
   */
  x = 0;

  /**
   * Latch/toggle de escrita para $2005/$2006.
   * false → próxima escrita é a “primeira”; true → próxima é a “segunda”.
   */
  w = false;
}
