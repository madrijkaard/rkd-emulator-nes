// src/mappers/__tests__/Mapper1PrgRam.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { Mapper1 } from '../Mapper1';
import { Mirroring } from '../Mirroring';

/**
 * Helpers:
 * - PRG: bancos de 16KB preenchidos com o índice do banco (0..N-1)
 * - CHR: bancos de 4KB preenchidos com o índice do banco (0..M-1)
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

/** Lê um endereço de CPU via mapper. */
function r8cpu(mapper: Mapper1, addr: number): number {
  return mapper.cpuRead(addr & 0xffff) & 0xff;
}

/** Escreve um byte na CPU via mapper. */
function w8cpu(mapper: Mapper1, addr: number, value: number) {
  mapper.cpuWrite(addr & 0xffff, value & 0xff);
}

/** Lê um endereço de PPU (CHR) via mapper. */
function r8ppu(mapper: Mapper1, addr: number): number {
  return mapper.ppuRead(addr & 0x1fff) & 0xff;
}

/**
 * Escreve um valor de 5 bits em um registrador MMC1 ($8000..$FFFF),
 * realizando as 5 escritas LSB-first no mesmo endereço (protocolo do shift-register).
 */
function write5(mapper: Mapper1, addr: number, value: number) {
  for (let i = 0; i < 5; i++) {
    const bit = (value >> i) & 1;
    mapper.cpuWrite(addr, bit);
  }
}

describe('Mapper1 (MMC1) — PRG-RAM ($6000–$7FFF)', () => {
  let mapper: Mapper1;

  beforeEach(() => {
    const prg = makePrg(64 * 1024);  // 4 bancos de 16KB → índices 0..3
    const chr = makeChr(32 * 1024);  // 8 bancos de 4KB → índices 0..7
    mapper = new Mapper1(prg, chr, Mirroring.Horizontal);
    mapper.reset();
  });

  it('permite leitura/escrita básicas em $6000–$7FFF', () => {
    // escreve alguns bytes na PRG-RAM e lê de volta
    w8cpu(mapper, 0x6000, 0x11);
    w8cpu(mapper, 0x6001, 0x22);
    w8cpu(mapper, 0x7FFF, 0xAB);

    expect(r8cpu(mapper, 0x6000)).toBe(0x11);
    expect(r8cpu(mapper, 0x6001)).toBe(0x22);
    expect(r8cpu(mapper, 0x7FFF)).toBe(0xAB);
  });

  it('conteúdo da PRG-RAM é independente do PRG/CHR banking', () => {
    // grava um padrão na PRG-RAM
    const pairs: Array<[number, number]> = [
      [0x6000, 0x55],
      [0x6010, 0xAA],
      [0x7F00, 0x5A],
      [0x7FFF, 0xA5],
    ];
    for (const [a, v] of pairs) w8cpu(mapper, a, v);

    // mexe em CONTROL/CHR/PRG para trocar modos e bancos
    // CONTROL: chrMode=1 (4KB), prgMode=3 (16KB com último fixo) → 0x1C
    write5(mapper, 0x8000, 0x1C);
    // CHR0=6, CHR1=7
    write5(mapper, 0xA000, 0x06);
    write5(mapper, 0xC000, 0x07);
    // PRG=2 (vai para a janela comutável em $8000 no modo 3)
    write5(mapper, 0xE000, 0x02);

    // verifica que a PRG-RAM manteve os valores
    for (const [a, v] of pairs) {
      expect(r8cpu(mapper, a)).toBe(v);
    }

    // muda de novo: PRG mode 0 (32KB) e PRG bank=1
    write5(mapper, 0x8000, 0x00);
    write5(mapper, 0xE000, 0x01);

    for (const [a, v] of pairs) {
      expect(r8cpu(mapper, a)).toBe(v);
    }
  });

  it('escrever na PRG-RAM não altera a PRG ROM mapeada em $8000/$C000', () => {
    // estado atual após reset: PRG mode = 3 (padrão), $8000 comutável (inicial 0), $C000 fixo último (3)
    // confirma a ROM mapeada antes de tocar na PRG-RAM
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);

    // escreve bytes “ruído” na RAM
    for (let i = 0; i < 16; i++) {
      w8cpu(mapper, 0x6000 + i, (i * 7) & 0xff);
    }

    // PRG ROM permanece conforme os bancos, não os dados da RAM
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);
    expect(r8cpu(mapper, 0xC000)).toBe(0x03);

    // troca o banco PRG comutável para 2 e verifica de novo
    write5(mapper, 0xE000, 0x02);
    expect(r8cpu(mapper, 0x8000)).toBe(0x02); // janela $8000 agora mostra banco 2
    expect(r8cpu(mapper, 0xC000)).toBe(0x03); // janela $C000 continua último
  });

  it('acessos fora de $6000–$7FFF continuam indo para PRG ROM', () => {
    // escreve na RAM
    w8cpu(mapper, 0x6000, 0x99);
    w8cpu(mapper, 0x6ABC, 0x77);

    // vizinhança ROM $5FFF e $8000 NÃO são RAM
    // $5FFF: fora da faixa — muitos mappers retornam 0 (não PRG-RAM)
    // aqui só assertamos que NÃO retornam os valores que gravamos na RAM
    const below = r8cpu(mapper, 0x5FFF);
    expect(below).not.toBe(0x99);

    // $8000 é PRG ROM mapeada — deve trazer o byte do banco atual (não 0x77)
    expect(r8cpu(mapper, 0x8000)).not.toBe(0x77);
  });

  it('reset do mapper não deve quebrar a área de PRG-RAM (endereçamento mantém-se)', () => {
    // grava algo na RAM
    w8cpu(mapper, 0x6000, 0xDE);
    w8cpu(mapper, 0x7FFF, 0xAD);

    // muda bancos e depois reseta o mapper
    write5(mapper, 0x8000, 0x1C);
    write5(mapper, 0xE000, 0x02);
    mapper.reset();

    // após reset, a área $6000–$7FFF continua sendo PRG-RAM acessível
    // (não afirmamos persistência do conteúdo, que pode ser zerado dependendo da impl)
    w8cpu(mapper, 0x6000, 0x12);
    w8cpu(mapper, 0x7FFF, 0x34);
    expect(r8cpu(mapper, 0x6000)).toBe(0x12);
    expect(r8cpu(mapper, 0x7FFF)).toBe(0x34);
  });

  it('leituras/ escritas na PRG-RAM não dependem do CHR mode (8KB vs 4KB)', () => {
    // grava um valor conhecido
    w8cpu(mapper, 0x6123, 0xFE);

    // CHR mode 0 (8KB) → CONTROL=0x0C
    write5(mapper, 0x8000, 0x0C);
    expect(r8cpu(mapper, 0x6123)).toBe(0xFE);

    // CHR mode 1 (4KB+4KB) → CONTROL=0x1C; define CHR0/CHR1
    write5(mapper, 0x8000, 0x1C);
    write5(mapper, 0xA000, 0x03);
    write5(mapper, 0xC000, 0x07);

    // acessos CHR mostram bancos escolhidos…
    expect(r8ppu(mapper, 0x0000)).toBe(0x03);
    expect(r8ppu(mapper, 0x1000)).toBe(0x07);

    // …mas PRG-RAM segue intacta
    expect(r8cpu(mapper, 0x6123)).toBe(0xFE);
  });
});
