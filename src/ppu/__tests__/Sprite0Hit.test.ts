import { describe, it, expect, beforeEach } from 'vitest';
import { Memory } from '../../memory/Memory';
import { Mapper0 } from '../../mappers/Mapper0';
import { Mirroring } from '../../mappers/Mirroring';
import { Renderer } from '../Renderer';

// -----------------------------
// Mocks mínimos de Canvas/2D
// -----------------------------
class FakeCtx2D {
  createImageData(w: number, h: number) {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
  putImageData(_img: ImageData, _x: number, _y: number) {}
}
class FakeCanvas {
  width = 256;
  height = 240;
  style: any = {};
  getContext(type: string) {
    if (type === '2d') return new FakeCtx2D() as unknown as CanvasRenderingContext2D;
    return null;
  }
}

// -----------------------------
// Helpers de dados CHR e paleta
// -----------------------------

/**
 * CHR de 8KB com:
 *  - Tile #0: vazio (todos zeros)
 *  - Tile #1: sólido (low-plane=0xFF por linha, high-plane=0x00)
 */
function makeChr(): Uint8Array {
  const chr = new Uint8Array(8 * 1024);
  for (let row = 0; row < 8; row++) {
    chr[16 * 1 + row] = 0xff;      // plano baixo
    chr[16 * 1 + 8 + row] = 0x00;  // plano alto
  }
  return chr;
}

/** Ajusta algumas entradas de paleta para valores != 0, evitando cor “transparente universal”. */
function primePalettesDirect(mem: Memory) {
  const ppu = mem.getPpu();
  // BG: $3F00..$3F03 (paleta 0)
  ppu.writePpuMemory(0x3F00, 0x21);
  ppu.writePpuMemory(0x3F01, 0x22);
  ppu.writePpuMemory(0x3F02, 0x23);
  ppu.writePpuMemory(0x3F03, 0x24);
  // Sprite: $3F10..$3F13 (paleta 0 de sprites)
  ppu.writePpuMemory(0x3F10, 0x21);
  ppu.writePpuMemory(0x3F11, 0x22);
  ppu.writePpuMemory(0x3F12, 0x23);
  ppu.writePpuMemory(0x3F13, 0x24);
}

/** Escreve tile #1 exatamente sob um pixel (x,y) na nametable base $2000. */
function paintSolidBgUnder(ppuMem: Memory, x: number, y: number) {
  const ppu = ppuMem.getPpu();
  const tileX = (x >>> 3) & 31; // 0..31
  const tileY = (y >>> 3) & 31; // 0..31
  const ntAddr = 0x2000 + tileY * 32 + tileX; // nametable 0 (superior-esquerda)
  ppu.writePpuMemory(ntAddr, 0x01); // tile #1 (sólido)
}

describe('PPU — Sprite 0 Hit', () => {
  let mem: Memory;
  let canvas: HTMLCanvasElement;
  let renderer: Renderer;

  beforeEach(() => {
    mem = new Memory();

    // Mapper0 com PRG dummy e CHR preparado
    const prg = new Uint8Array(16 * 1024).fill(0xEA);
    const chr = makeChr();
    const m0 = new Mapper0(prg, chr, Mirroring.Horizontal);
    mem.attachMapper(m0);

    canvas = new FakeCanvas() as any;
    renderer = new Renderer(canvas);
  });

  it('marca sprite0 hit (bit 6 de PPUSTATUS) quando BG e sprite0 são opacos no mesmo pixel', () => {
    const ppu = mem.getPpu();
    primePalettesDirect(mem);

    // BG e Sprites ON; clipping de BG e Sprites ON (b1=1, b2=1)
    // PPUMASK: 0001 1110 → b4=1 (sprites), b3=1 (bg), b2=1 (spr-left ON), b1=1 (bg-left ON)
    mem.write(0x2001, 0x1E);

    // PPUCTRL bit4 = 0 → BG em 0x0000; bit3 = 0 → Sprites em 0x0000
    mem.write(0x2000, 0x00);

    // Vamos testar colisão em (10,10)
    const sx = 10, sy = 10;
    paintSolidBgUnder(mem, sx, sy);

    // Sprite 0 em (10,10), tile #1 opaco
    ppu.oam[0] = (sy - 1) & 0xFF; // OAM Y = Y-1
    ppu.oam[1] = 1;               // tile #1
    ppu.oam[2] = 0x00;            // prioridade à frente, paleta 0
    ppu.oam[3] = sx;              // X

    renderer.renderFrame(ppu);

    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(true);
  });

  it('não há hit quando sprite está na faixa X<8 e spr-left clipping está DESLIGADO', () => {
    const ppu = mem.getPpu();
    primePalettesDirect(mem);

    // BG ON, Sprites ON, bg-left ON (b1=1) e spr-left OFF (b2=0)
    // PPUMASK: 0001 1010
    mem.write(0x2001, 0x1A);
    mem.write(0x2000, 0x00);

    // BG opaco sob (4,10) para garantir sobreposição geométrica
    const sx = 4, sy = 10;
    paintSolidBgUnder(mem, sx, sy);

    // Sprite 0 em X=4 (faixa esquerda), Y=10
    ppu.oam[0] = (sy - 1) & 0xFF;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x00;
    ppu.oam[3] = sx;

    renderer.renderFrame(ppu);

    // Como spr-left está OFF, o sprite é considerado "transparente" nos 8 primeiros pixels → sem hit
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(false);
  });

  it('hit acontece mesmo com prioridade do sprite atrás do BG (bit 5 = 1), se ambos forem opacos', () => {
    const ppu = mem.getPpu();
    primePalettesDirect(mem);

    // BG/Sprites ON e clipping ON
    mem.write(0x2001, 0x1E);
    mem.write(0x2000, 0x00);

    // BG opaco sob (10,10)
    const sx = 10, sy = 10;
    paintSolidBgUnder(mem, sx, sy);

    // Sprite 0 com prioridade atrás do BG
    ppu.oam[0] = (sy - 1) & 0xFF;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x20; // bit5=1 → atrás do BG
    ppu.oam[3] = sx;

    renderer.renderFrame(ppu);

    // A prioridade não impede o flag de sprite0 hit
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(true);
  });

  it('limpa automaticamente o bit de sprite0 hit no início da pre-render', () => {
    const ppu = mem.getPpu();
    primePalettesDirect(mem);

    // BG/Sprites ON com clipping ON
    mem.write(0x2001, 0x1E);
    mem.write(0x2000, 0x00);

    // BG opaco e sprite 0 colidindo em (10,10)
    const sx = 10, sy = 10;
    paintSolidBgUnder(mem, sx, sy);
    ppu.oam[0] = (sy - 1) & 0xFF;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x00;
    ppu.oam[3] = sx;

    // Seta o hit
    renderer.renderFrame(ppu);
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(true);

    // Avança a PPU até o início da pre-render (scanline -1)
    // Um frame NTSC tem 262 scanlines; avançar 262 limpa o bit na tua PPU (vide Ppu.step)
    stepScanlines(mem, 262);

    // O bit 6 deve ter sido limpo pelo ciclo de pre-render
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(false);
  });
});

/** Avança a PPU exatamente N scanlines (cada uma com 341 ciclos). */
function stepScanlines(mem: Memory, n: number) {
  const ppu = mem.getPpu();
  for (let s = 0; s < n; s++) {
    for (let c = 0; c < 341; c++) {
      ppu.step();
    }
  }
}
