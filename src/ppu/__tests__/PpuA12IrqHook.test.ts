// src/ppu/__tests__/PpuA12IrqHook.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Memory } from '../../memory/Memory';
import { Mapper4 } from '../../mappers/Mapper4';
import { Mirroring } from '../../mappers/Mirroring';
import { Ppu } from '../Ppu';

/**
 * Este teste valida a “borda A12 sintetizada por scanline” adicionada em Ppu.step(),
 * garantindo que o IRQ do MMC3 (Mapper4) arma no timing de scanline quando:
 *  - o BG está ligado (PPUMASK bit 3)
 *  - latch/reload/enable foram configurados.
 *
 * Observação: não estamos emulando os fetches reais do PPU por ciclo; a PPU apenas
 * sintetiza uma borda 0→1 de A12 por scanline visível, suficiente para SMB3/smoke tests.
 */

// Helpers para montar PRG/CHR de teste
function makePrg(size = 32 * 1024): Uint8Array {
  // 32KB de PRG é suficiente; conteúdo irrelevante
  return new Uint8Array(size).fill(0xEA); // NOPs
}

function makeChr(size = 8 * 1024): Uint8Array {
  // 8KB de CHR; conteúdo irrelevante para o clock de IRQ
  return new Uint8Array(size).fill(0x00);
}

// Roda a PPU por N scanlines (cada uma com 341 ciclos)
function stepScanlines(ppu: Ppu, n: number) {
  for (let s = 0; s < n; s++) {
    for (let c = 0; c < 341; c++) {
      ppu.step();
    }
  }
}

describe('PPU + Mapper4 (MMC3) — IRQ por A12 sintetizado por scanline', () => {
  let memory: Memory;
  let ppu: Ppu;
  let mapper: Mapper4;

  beforeEach(() => {
    memory = new Memory();

    // Anexa Mapper4 com PRG/CHR simples
    mapper = new Mapper4(makePrg(), makeChr(), Mirroring.Horizontal);
    memory.attachMapper(mapper);

    // Obtém a PPU ligada a esta Memory
    ppu = memory.getPpu();

    // Reset inicial
    ppu.reset();

    // Garante que começamos em scanline 0 (visível) e cycle 0 como no reset
    // (o reset da PPU atual já deixa scanline=0, cycle=0)
  });

  it('latch=2 — IRQ fica pendente após 3 scanlines visíveis (reload → 1 → 0)', () => {
    // Liga BG (PPUMASK bit 3)
    memory.write(0x2001, 0x08);

    // Configura IRQ do MMC3:
    // $C000 latch=2, $C001 reload pending, $E001 enable
    memory.write(0xC000, 0x02);
    memory.write(0xC001, 0x00);
    memory.write(0xE001, 0x00);

    // Após reload, a 1ª borda coloca counter=latch(2) (sem IRQ),
    // 2ª borda → 1 (sem IRQ), 3ª borda → 0 (arma IRQ).
    // Como sintetizamos UMA borda por scanline, precisamos de 3 scanlines.
    stepScanlines(ppu, 1);
    expect(mapper.consumeIrq()).toBe(false); // counter=2

    stepScanlines(ppu, 1);
    expect(mapper.consumeIrq()).toBe(false); // counter=1

    stepScanlines(ppu, 1);
    expect(mapper.consumeIrq()).toBe(true); // counter=0 → IRQ pendente

    // O nível permanece até ACK ($E000)
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    memory.write(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('latch=0 — IRQ arma já na 1ª scanline após reload', () => {
    // Liga BG
    memory.write(0x2001, 0x08);

    // latch=0, reload, enable
    memory.write(0xC000, 0x00);
    memory.write(0xC001, 0x00);
    memory.write(0xE001, 0x00);

    // Primeira borda após reload já arma IRQ (caso especial do MMC3)
    stepScanlines(ppu, 1);
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    memory.write(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('com BG desligado (PPUMASK bit 3 = 0), nenhuma borda A12 sintetizada → sem IRQ', () => {
    // BG OFF
    memory.write(0x2001, 0x00);

    // latch=1, reload, enable
    memory.write(0xC000, 0x01);
    memory.write(0xC001, 0x00);
    memory.write(0xE001, 0x00);

    // Avança várias scanlines visíveis; sem BG, não sintetizamos bordas → sem IRQ
    stepScanlines(ppu, 8);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('após ACK/disable em E000, re-enable em E001 exige novas bordas para rearmar', () => {
    // BG ON
    memory.write(0x2001, 0x08);

    // latch=2, reload, enable
    memory.write(0xC000, 0x02);
    memory.write(0xC001, 0x00);
    memory.write(0xE001, 0x00);

    // Chega em IRQ pendente após 3 scanlines
    stepScanlines(ppu, 3);
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    memory.write(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);

    // Re-enable (sem reload ainda)
    memory.write(0xE001, 0x00);
    // A prática comum é dar reload novamente; vamos fazê-lo para comportamento determinístico
    memory.write(0xC001, 0x00); // reload pendente

    // Precisa novamente de 3 scanlines para armar IRQ
    stepScanlines(ppu, 2);
    expect(mapper.consumeIrq()).toBe(false);
    stepScanlines(ppu, 1);
    expect(mapper.consumeIrq()).toBe(true);
  });
});
