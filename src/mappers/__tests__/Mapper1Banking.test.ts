// src/mappers/__tests__/Mapper1Banking.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Mapper1 } from '../Mapper1';
import { Mirroring } from '../Mirroring';

/**
 * Helpers para gerar PRG/CHR com padrões reconhecíveis:
 * - PRG em bancos de 16KB → cada banco preenchido com seu índice (0..N-1)
 * - CHR em bancos de 4KB  → cada banco preenchido com seu índice (0..M-1)
 */

function makePrg(size = 64 * 1024): Uint8Array {
  const prg = new Uint8Array(size);
  const bankSize = 16 * 1024;
  const banks = size / bankSize;
  for (let b = 0; b < banks; b++) {
    prg.fill(b & 0xff, b * bankSize, (b + 1) * bankSize);
  }
  return prg;
}

function makeChr(size = 32 * 1024): Uint8Array {
  const chr = new Uint8Array(size);
  const bankSize = 4 * 1024;
  const banks = size / bankSize;
  for (let b = 0; b < banks; b++) {
    chr.fill(b & 0xff, b * bankSize, (b + 1) * bankSize);
  }
  return chr;
}

/** Lê um endereço de CPU e retorna o byte. */
function r8cpu(mapper: Mapper1, addr: number): number {
  return mapper.cpuRead(addr & 0xffff) & 0xff;
}

/** Lê um endereço de PPU (CHR) e retorna o byte. */
function r8ppu(mapper: Mapper1, addr: number): number {
  return mapper.ppuRead(addr & 0x1fff) & 0xff;
}

/**
 * Escreve um valor de 5 bits em um registrador MMC1 ($8000..$FFFF),
 * fazendo as 5 escritas LSB-first conforme o protocolo do shift-register.
 */
function write5(mapper: Mapper1, addr: number, value: number) {
  for (let i = 0; i < 5; i++) {
    const bit = (value >> i) & 1;
    mapper.cpuWrite(addr, bit);
  }
}

describe('Mapper1 (MMC1) - PRG/CHR Banking e Mirroring', () => {
  let mapper: Mapper1;

  beforeEach(() => {
    // PRG 64KB (4 bancos de 16KB: 0..3) → último = 3
    // CHR 32KB (8 bancos de 4KB: 0..7)
    const prg = makePrg(64 * 1024);
    const chr = makeChr(32 * 1024);
    mapper = new Mapper1(prg, chr, Mirroring.Horizontal);
    mapper.reset();
  });

  it('Reset padrão: PRG mode=3 (comuta $8000; $C000 fixo no último), CHR mode=0 (8KB)', () => {
    // Por reset, CONTROL=0x0C → PRG mode=3, CHR mode=0
    // PRG: $8000- BFFF → banco 0; $C000-FFFF → banco 3 (último)
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);

    // Se mudarmos o PRG bank (registrador $E000) para 2,
    // no mode 3 a janela $8000 passa a mostrar 2 e $C000 continua 3 (fixo).
    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);
  });

  it('PRG mode 2: $8000 fixo no banco 0; $C000 comuta via PRG', () => {
    // CONTROL: prgMode=2 (bits 3..2 = 10), chrMode=0, mirroring livre → valor 0x08
    write5(mapper, 0x8000, 0x08);

    // PRG bank=1 → $C000=1, $8000=0 fixo
    write5(mapper, 0xE000, 0x01);
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x01);

    // PRG bank=2 → $C000=2
    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x02);
  });

  it('PRG mode 0 (32KB): usa (PRG & ~1) → janelas sequenciais 16KB+16KB', () => {
    // CONTROL: prgMode=0, chrMode=0 → 0x00
    write5(mapper, 0x8000, 0x00);

    // PRG=1 → base=(1&~1)=0 → $8000=0, $C000=1
    write5(mapper, 0xE000, 0x01);
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x01);

    // PRG=2 → base=2 → $8000=2, $C000=3
    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);
  });

  it('PRG mode 3 (16KB): $8000 comutável; $C000 fixo no último', () => {
    // CONTROL: prgMode=3 → 0x0C (é o default de reset, mas reforce no teste)
    write5(mapper, 0x8000, 0x0C);

    write5(mapper, 0xE000, 0x00);
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);

    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);
  });

  it('CHR mode 0 (8KB): CHR0 & ~1 define par de 4KB em $0000 e $1000', () => {
    // CONTROL: chrMode=0 (bit4=0), prgMode=3 → 0x0C
    write5(mapper, 0x8000, 0x0C);

    // CHR0=4 → $0000 usa banco 4, $1000 usa banco 5
    write5(mapper, 0xA000, 0x04); // CHR bank 0
    // CHR1 é ignorado no modo 8KB, mas podemos escrever algo
    write5(mapper, 0xC000, 0x07);

    expect(r8ppu(mapper, 0x0000)).toBe(0x04);
    expect(r8ppu(mapper, 0x1000)).toBe(0x05);
  });

  it('CHR mode 1 (4KB+4KB): CHR0 em $0000..$0FFF, CHR1 em $1000..$1FFF', () => {
    // CONTROL: chrMode=1 (bit4=1), prgMode=3 → 0x1C
    write5(mapper, 0x8000, 0x1C);

    write5(mapper, 0xA000, 0x02); // CHR0=2
    write5(mapper, 0xC000, 0x07); // CHR1=7

    expect(r8ppu(mapper, 0x0000)).toBe(0x02);
    expect(r8ppu(mapper, 0x0FFF)).toBe(0x02);
    expect(r8ppu(mapper, 0x1000)).toBe(0x07);
    expect(r8ppu(mapper, 0x1FFF)).toBe(0x07);
  });

  it('bit7 em writes ($8000–$FFFF) reseta shift e força CONTROL|=0x0C (PRG mode=3)', () => {
    // Primeiro vamos colocar em mode 0 (32KB) para depois verificar o reset
    write5(mapper, 0x8000, 0x00);
    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03); // ainda 32KB (2,3)

    // Agora, write com bit7=1 em qualquer endereço $8000+ → reset/force mode=3
    mapper.cpuWrite(0x8000, 0x80);

    // No mode 3, $C000 é fixo no último e $8000 usa prgBank (que foi 2)
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);
  });

  it('CONTROL controla mirroring: 2=Vertical, 3=Horizontal', () => {
    // mirror = 2 (Vertical), demais bits mantidos (ex.: prgMode=3 → 0x0C)
    write5(mapper, 0x8000, 0x0C | 0x02);
    expect(mapper.getMirroring()).toBe(Mirroring.Vertical);

    // mirror = 3 (Horizontal)
    write5(mapper, 0x8000, 0x0C | 0x03);
    expect(mapper.getMirroring()).toBe(Mirroring.Horizontal);
  });
});
