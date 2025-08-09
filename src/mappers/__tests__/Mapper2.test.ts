import { describe, it, expect, beforeEach } from 'vitest';
import { Mapper2 } from '../Mapper2';
import { Mirroring } from '../Mirroring';

/** PRG em bancos de 16KB, cada banco preenchido com seu índice (0x00, 0x01, …). */
function makePrg16kBanks(banks: number): Uint8Array {
  const size = banks * 16 * 1024;
  const prg = new Uint8Array(size);
  const bankSize = 16 * 1024;
  for (let b = 0; b < banks; b++) {
    prg.fill(b & 0xff, b * bankSize, (b + 1) * bankSize);
  }
  return prg;
}

/** CHR de 8KB preenchida com um valor fixo (para testar ROM) */
function makeChr8k(fill = 0x77): Uint8Array {
  return new Uint8Array(8 * 1024).fill(fill & 0xff);
}

/** Leitura CPU helper */
function r8cpu(mapper: Mapper2, addr: number): number {
  return mapper.cpuRead(addr & 0xffff) & 0xff;
}

/** Escrita CPU helper */
function w8cpu(mapper: Mapper2, addr: number, value: number) {
  mapper.cpuWrite(addr & 0xffff, value & 0xff);
}

/** Leitura PPU helper (CHR/pal) */
function r8ppu(mapper: Mapper2, addr: number): number {
  return mapper.ppuRead(addr & 0x3fff) & 0xff;
}

/** Escrita PPU helper (CHR-RAM quando presente) */
function w8ppu(mapper: Mapper2, addr: number, value: number) {
  mapper.ppuWrite(addr & 0x3fff, value & 0xff);
}

describe('Mapper2 (UxROM / UNROM)', () => {
  let mapper: Mapper2;

  describe('PRG banking e layout', () => {
    beforeEach(() => {
      // 4 bancos de 16KB = 64KB; último banco (3) deve ficar fixo em $C000-$FFFF
      const prg = makePrg16kBanks(4);
      const chr = makeChr8k(0x55); // CHR-ROM (não usada para PRG testes)
      mapper = new Mapper2(prg, chr, Mirroring.Horizontal);
      mapper.reset();
    });

    it('$8000-$BFFF: janela selecionável; $C000-$FFFF: último banco fixo', () => {
      // Reset: banco selecionável = 0
      expect(r8cpu(mapper, 0x8000)).toBe(0x00); // low window → banco 0
      expect(r8cpu(mapper, 0xBFFF)).toBe(0x00);

      // High window sempre banco fixo (último = 3)
      expect(r8cpu(mapper, 0xC000)).toBe(0x03);
      expect(r8cpu(mapper, 0xE000)).toBe(0x03);

      // Seleciona banco 1 escrevendo em $8000-$FFFF
      w8cpu(mapper, 0x8000, 0x01);
      expect(r8cpu(mapper, 0x8000)).toBe(0x01);
      expect(r8cpu(mapper, 0x9ABC)).toBe(0x01);

      // Seleciona banco 2 escrevendo em $FFFF
      w8cpu(mapper, 0xFFFF, 0x02);
      expect(r8cpu(mapper, 0x8000)).toBe(0x02);

      // Alta permanece fixa no último banco
      expect(r8cpu(mapper, 0xC000)).toBe(0x03);
      expect(r8cpu(mapper, 0xFFFF)).toBe(0x03);
    });

    it('seleção de banco usa módulo pelo total de bancos (robustez)', () => {
      // 4 bancos → 9 % 4 = 1
      w8cpu(mapper, 0x8000, 0x09);
      expect(r8cpu(mapper, 0x8000)).toBe(0x01);
      // 0xFF % 4 = 3
      w8cpu(mapper, 0x9000, 0xFF);
      expect(r8cpu(mapper, 0x8000)).toBe(0x03);
    });

    it('PRG-RAM $6000-$7FFF lê/escreve', () => {
      w8cpu(mapper, 0x6000, 0x5A);
      w8cpu(mapper, 0x7FFF, 0xA5);
      expect(r8cpu(mapper, 0x6000)).toBe(0x5A);
      expect(r8cpu(mapper, 0x7FFF)).toBe(0xA5);
    });
  });

  describe('CHR behavior', () => {
    it('CHR-RAM (quando CHR ausente) aceita escrita/leitura em $0000-$1FFF', () => {
      // CHR ausente → CHR-RAM 8KB
      const prg = makePrg16kBanks(2);
      const chrEmpty = new Uint8Array(0);
      mapper = new Mapper2(prg, chrEmpty, Mirroring.Vertical);
      mapper.reset();

      // Escreve alguns bytes
      w8ppu(mapper, 0x0000, 0x12);
      w8ppu(mapper, 0x1FFF, 0x34);
      expect(r8ppu(mapper, 0x0000)).toBe(0x12);
      expect(r8ppu(mapper, 0x1FFF)).toBe(0x34);
    });

    it('CHR-ROM ignora escritas (somente leitura)', () => {
      const prg = makePrg16kBanks(2);
      const chr = makeChr8k(0x77); // ROM
      mapper = new Mapper2(prg, chr, Mirroring.Vertical);
      mapper.reset();

      // Tenta escrever e verifica que permanece 0x77
      const before = r8ppu(mapper, 0x0005);
      expect(before).toBe(0x77);
      w8ppu(mapper, 0x0005, 0x99);
      const after = r8ppu(mapper, 0x0005);
      expect(after).toBe(0x77);
    });
  });

  describe('Mirroring', () => {
    it('usa mirroring do header e não muda com writes de banco', () => {
      const prg = makePrg16kBanks(2);
      const chr = makeChr8k(0x33);
      mapper = new Mapper2(prg, chr, Mirroring.Vertical);
      mapper.reset();

      expect(mapper.getMirroring()).toBe(Mirroring.Vertical);

      // Faz várias escritas de banco — não deve afetar mirroring
      w8cpu(mapper, 0x8000, 0x01);
      w8cpu(mapper, 0xC123, 0x02);
      w8cpu(mapper, 0xFFFF, 0x03);

      expect(mapper.getMirroring()).toBe(Mirroring.Vertical);
    });
  });
});
