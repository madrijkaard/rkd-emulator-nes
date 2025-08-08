import { describe, it, expect, beforeEach } from 'vitest';
import { Mapper4 } from '../Mapper4';
import { Mirroring } from '../Mirroring';

/**
 * Preenche PRG (32KB = 4 bancos de 8KB) e CHR (8KB = 8 bancos de 1KB)
 * com padrões facilmente identificáveis, para validarmos mapeamentos.
 *
 * - PRG: cada banco de 8KB é preenchido com o índice do banco (0..3)
 *   Assim: ler 0x8000 (window 0) devolve 0 se mapado ao banco 0, etc.
 *
 * - CHR: cada banco de 1KB é preenchido com o índice do banco (0..7)
 *   Assim: ler 0x0000 devolve 2 se o 1KB escolhido for o banco 2, etc.
 */

function makePrg(size = 32 * 1024): Uint8Array {
  const prg = new Uint8Array(size);
  const bankSize = 8 * 1024;
  const banks = size / bankSize;
  for (let b = 0; b < banks; b++) {
    prg.fill(b & 0xFF, b * bankSize, (b + 1) * bankSize);
  }
  return prg;
}

function makeChr(size = 8 * 1024): Uint8Array {
  const chr = new Uint8Array(size);
  const bankSize = 1 * 1024;
  const banks = size / bankSize;
  for (let b = 0; b < banks; b++) {
    chr.fill(b & 0xFF, b * bankSize, (b + 1) * bankSize);
  }
  return chr;
}

/** Helpers para escrever Rn via $8000/$8001 */
function writeBankReg(mapper: Mapper4, regIndex: number, value: number, prgMode = 0, chrMode = 0) {
  // $8000 even: bank select
  const control = (regIndex & 0x07) | ((prgMode & 1) << 6) | ((chrMode & 1) << 7);
  mapper.cpuWrite(0x8000, control);
  // $8001 odd: bank data
  mapper.cpuWrite(0x8001, value & 0xFF);
}

/** Lê um endereço de CPU e retorna o byte. */
function r8cpu(mapper: Mapper4, addr: number): number {
  return mapper.cpuRead(addr & 0xFFFF) & 0xFF;
}

/** Lê um endereço de PPU (CHR) e retorna o byte. */
function r8ppu(mapper: Mapper4, addr: number): number {
  return mapper.ppuRead(addr & 0x3FFF) & 0xFF;
}

describe('Mapper4 (MMC3) - PRG/CHR Banking', () => {
  let mapper: Mapper4;

  beforeEach(() => {
    const prg = makePrg(32 * 1024); // 4 bancos de 8KB
    const chr = makeChr(8 * 1024);  // 8 bancos de 1KB
    mapper = new Mapper4(prg, chr, Mirroring.Horizontal);
    mapper.reset();
  });

  it('PRG mode 0: $8000=R6, $A000=R7, $C000=second-last, $E000=last', () => {
    // prgBankCount=4 → second-last=2, last=3
    // Configure R6=0 e R7=1 para obter mapeamento sequencial 0,1,2,3 nos 4 windows.
    writeBankReg(mapper, 6, 0, /*prgMode=*/0, /*chrMode=*/0); // R6=0
    writeBankReg(mapper, 7, 1, 0, 0); // R7=1

    // Janela $8000-9FFF → banco 0
    expect(r8cpu(mapper, 0x8000)).toBe(0x00);

    // Janela $A000-BFFF → banco 1
    expect(r8cpu(mapper, 0xA000)).toBe(0x01);

    // Janela $C000-DFFF → segundo a partir do fim = 2
    expect(r8cpu(mapper, 0xC000)).toBe(0x02);

    // Janela $E000-FFFF → último = 3
    expect(r8cpu(mapper, 0xE000)).toBe(0x03);
  });

  it('PRG mode 1: $8000=second-last, $A000=R7, $C000=R6, $E000=last', () => {
    // Configure R6=0, R7=1; set prgMode=1 (bit6 em $8000)
    writeBankReg(mapper, 6, 0, /*prgMode=*/1, /*chrMode=*/0);
    writeBankReg(mapper, 7, 1, 1, 0);

    // Janela $8000-9FFF → second-last = 2
    expect(r8cpu(mapper, 0x8000)).toBe(0x02);

    // Janela $A000-BFFF → R7 = 1
    expect(r8cpu(mapper, 0xA000)).toBe(0x01);

    // Janela $C000-DFFF → R6 = 0
    expect(r8cpu(mapper, 0xC000)).toBe(0x00);

    // Janela $E000-FFFF → last = 3
    expect(r8cpu(mapper, 0xE000)).toBe(0x03);
  });

  it('CHR mode 0: R0/R1 em 2KB no início; R2..R5 em 1KB no final', () => {
    // chrMode=0 (bit7=0)
    // R0 deve ser par (alinhado 2KB), R1 também.
    // Mapeamento esperado:
    //  0x0000-0x03FF -> R0
    //  0x0400-0x07FF -> R0+1
    //  0x0800-0x0BFF -> R1
    //  0x0C00-0x0FFF -> R1+1
    //  0x1000-0x13FF -> R2
    //  0x1400-0x17FF -> R3
    //  0x1800-0x1BFF -> R4
    //  0x1C00-0x1FFF -> R5

    // Set: R0=2, R1=4 (pares); R2=6, R3=7, R4=0, R5=1
    writeBankReg(mapper, 0, 2, /*prgMode=*/0, /*chrMode=*/0);
    writeBankReg(mapper, 1, 4, 0, 0);
    writeBankReg(mapper, 2, 6, 0, 0);
    writeBankReg(mapper, 3, 7, 0, 0);
    writeBankReg(mapper, 4, 0, 0, 0);
    writeBankReg(mapper, 5, 1, 0, 0);

    expect(r8ppu(mapper, 0x0000)).toBe(0x02); // R0
    expect(r8ppu(mapper, 0x0400)).toBe(0x03); // R0+1
    expect(r8ppu(mapper, 0x0800)).toBe(0x04); // R1
    expect(r8ppu(mapper, 0x0C00)).toBe(0x05); // R1+1
    expect(r8ppu(mapper, 0x1000)).toBe(0x06); // R2
    expect(r8ppu(mapper, 0x1400)).toBe(0x07); // R3
    expect(r8ppu(mapper, 0x1800)).toBe(0x00); // R4
    expect(r8ppu(mapper, 0x1C00)).toBe(0x01); // R5
  });

  it('CHR mode 1: R2..R5 no início; R0/R1 (2KB) no final', () => {
    // chrMode=1 (bit7=1)
    // Mapeamento esperado:
    //  0x0000-0x03FF -> R2
    //  0x0400-0x07FF -> R3
    //  0x0800-0x0BFF -> R4
    //  0x0C00-0x0FFF -> R5
    //  0x1000-0x13FF -> R0
    //  0x1400-0x17FF -> R0+1
    //  0x1800-0x1BFF -> R1
    //  0x1C00-0x1FFF -> R1+1

    // Set: R0=2, R1=4 (pares); R2=6, R3=7, R4=0, R5=1, com chrMode=1
    writeBankReg(mapper, 0, 2, /*prgMode=*/0, /*chrMode=*/1);
    writeBankReg(mapper, 1, 4, 0, 1);
    writeBankReg(mapper, 2, 6, 0, 1);
    writeBankReg(mapper, 3, 7, 0, 1);
    writeBankReg(mapper, 4, 0, 0, 1);
    writeBankReg(mapper, 5, 1, 0, 1);

    expect(r8ppu(mapper, 0x0000)).toBe(0x06); // R2
    expect(r8ppu(mapper, 0x0400)).toBe(0x07); // R3
    expect(r8ppu(mapper, 0x0800)).toBe(0x00); // R4
    expect(r8ppu(mapper, 0x0C00)).toBe(0x01); // R5
    expect(r8ppu(mapper, 0x1000)).toBe(0x02); // R0
    expect(r8ppu(mapper, 0x1400)).toBe(0x03); // R0+1
    expect(r8ppu(mapper, 0x1800)).toBe(0x04); // R1
    expect(r8ppu(mapper, 0x1C00)).toBe(0x05); // R1+1
  });

  it('A000 (mirroring): 0=Horizontal, 1=Vertical', () => {
    // Começa Horizontal (construtor)
    expect(mapper.getMirroring()).toBe(Mirroring.Horizontal);
    // Write 1 → Vertical
    mapper.cpuWrite(0xA000, 0x01);
    expect(mapper.getMirroring()).toBe(Mirroring.Vertical);
    // Write 0 → Horizontal
    mapper.cpuWrite(0xA000, 0x00);
    expect(mapper.getMirroring()).toBe(Mirroring.Horizontal);
  });
});
