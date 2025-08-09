import { describe, it, expect } from 'vitest';
import { Memory } from '../Memory';

/** Gera 256 bytes previsíveis para uma página (page << 8) */
function makePageData(page: number): Uint8Array {
  const buf = new Uint8Array(256);
  for (let i = 0; i < 256; i++) buf[i] = (page + i) & 0xff;
  return buf;
}

describe('DMA $4014 (OAMDMA) → cópia de 256 bytes para OAM', () => {
  it('copia exatamente 256 bytes da página indicada para ppu.oam', () => {
    const mem = new Memory();
    const ppu = mem.getPpu();

    // Preenche a página $0200..$02FF com um padrão conhecido
    const page = 0x02;
    const src = makePageData(page);
    for (let i = 0; i < 256; i++) {
      mem.write((page << 8) | i, src[i]);
    }

    // Garante OAM zerada antes
    ppu.oam.fill(0);

    // Dispara DMA: escrever no $4014 com o número da página
    mem.write(0x4014, page);

    // Verifica se os 256 bytes foram copiados para OAM
    for (let i = 0; i < 256; i++) {
      expect(ppu.oam[i]).toBe(src[i]);
    }
  });

  it('funciona com página 0x00 (copia de $0000..$00FF)', () => {
    const mem = new Memory();
    const ppu = mem.getPpu();

    // Preenche $0000..$00FF com 0..255
    for (let i = 0; i < 256; i++) {
      mem.write(i, i & 0xff);
    }

    // Dispara DMA da página 0x00
    mem.write(0x4014, 0x00);

    for (let i = 0; i < 256; i++) {
      expect(ppu.oam[i]).toBe(i & 0xff);
    }
  });

  it('não quebra com página 0xFF (copia de $FF00..$FFFF via leitura da CPU)', () => {
    const mem = new Memory();
    const ppu = mem.getPpu();

    // Para este teste, vamos escrever via Memory.write na faixa $FF00..$FFFF.
    // Em um NES real isso seria PRG/mapper; aqui o Memory delega ao mapper se houver.
    // Sem mapper anexado, reads dali retornam 0 — então a OAM deve ficar zerada.
    // (O objetivo é apenas garantir que a operação não lança erro.)
    ppu.oam.fill(0xAA); // lixo inicial

    mem.write(0x4014, 0xFF); // DMA a partir de $FF00

    // Sem mapper, esperamos zeros (read retorna 0)
    for (let i = 0; i < 256; i++) {
      expect(ppu.oam[i]).toBe(0x00);
    }
  });
});
