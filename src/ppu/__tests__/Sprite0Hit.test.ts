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
    // Retorna algo com shape de ImageData
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) } as unknown as ImageData;
  }
  putImageData(_img: ImageData, _x: number, _y: number) {
    // noop
  }
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
 *  - Tile #1: sólido (patternBits=1 em todos os pixels),
 *             isto é, low-plane = 0xFF por linha e high-plane = 0x00
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

/** Avança a PPU exatamente N scanlines (cada uma com 341 ciclos). */
function stepScanlines(mem: Memory, n: number) {
  const ppu = mem.getPpu();
  for (let s = 0; s < n; s++) {
    for (let c = 0; c < 341; c++) {
      ppu.step();
    }
  }
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

    // Habilita BG e Sprites; habilita clipping de BG e Sprites (bits 1 e 2 ligados)
    // PPUMASK: 0001 1110 → BG ON (b3), SPR ON (b4), bg-left ON (b1), spr-left ON (b2)
    mem.write(0x2001, 0x1E);

    // PPUCTRL bit4 = 0 → pattern table do BG em 0x0000 (onde está nosso tile #1)
    mem.write(0x2000, 0x00);

    // Coloca tile #1 na primeira entrada da nametable (canto superior-esquerdo)
    ppu.writePpuMemory(0x2000, 0x01);

    // Sprite 0 posicionado sobre a região BG opaca (X=10, Y=10)
    // OAM: [Y, tileIndex, attributes, X]; lembrar que o Y real é OAM+1
    ppu.oam[0] = 9;     // Y (Y onscreen = 10)
    ppu.oam[1] = 1;     // tile #1 (sólido)
    ppu.oam[2] = 0x00;  // atributos: prioridade à frente, paleta 0
    ppu.oam[3] = 10;    // X

    // Renderiza o frame completo (Renderer seta o flag ao detectar colisão)
    renderer.renderFrame(ppu);

    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(true);
  });

  it('não há hit quando sprite está na faixa X<8 e spr-left clipping está DESLIGADO', () => {
    const ppu = mem.getPpu();
    primePalettesDirect(mem);

    // Liga BG e Sprites, mantém bg-left ON mas DESLIGA spr-left (bit 2 = 0)
    // PPUMASK: 0001 1010 → b4=1 (sprites), b3=1 (bg), b1=1 (bg-left ON), b2=0 (spr-left OFF)
    mem.write(0x2001, 0x1A);
    mem.write(0x2000, 0x00);

    // BG opaco no canto
    ppu.writePpuMemory(0x2000, 0x01);

    // Sprite 0 em X=4 (faixa esquerda), Y=10
    ppu.oam[0] = 9;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x00;
    ppu.oam[3] = 4;

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

    // BG opaco
    ppu.writePpuMemory(0x2000, 0x01);

    // Sprite 0 com prioridade atrás do BG
    ppu.oam[0] = 9;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x20; // bit5=1 → atrás do BG
    ppu.oam[3] = 10;

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

    // BG opaco e sprite 0 colidindo
    ppu.writePpuMemory(0x2000, 0x01);
    ppu.oam[0] = 9;
    ppu.oam[1] = 1;
    ppu.oam[2] = 0x00;
    ppu.oam[3] = 10;

    // Seta o hit
    renderer.renderFrame(ppu);
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(true);

    // Avança a PPU até o início da pre-render (scanline -1)
    // Um frame NTSC tem 262 scanlines; stepScanlines(262) garante a transição para -1
    stepScanlines(mem, 262);

    // O bit 6 deve ter sido limpo pelo ciclo de pre-render
    expect((ppu.registers.ppustatus & 0x40) !== 0).toBe(false);
  });
});
