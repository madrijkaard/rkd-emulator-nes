// src/cpu/__tests__/Cpu6502.test.ts
import { describe, it, expect } from "vitest";
import { Cpu6502 } from "../Cpu6502";
import { Flags6502 } from "../Flags6502";
import { Memory } from "../../memory/Memory";
import { Mapper0 } from "../../mappers/Mapper0";
import { Mirroring } from "../../mappers/Mirroring";

/**
 * Cria uma CPU com PRG de 16KB (NROM-128) preenchido com NOP (0xEA),
 * injeta o programa a partir de startAddr e configura o vetor de RESET.
 * Suporta "patches" para pré-carregar bytes em endereços do PRG.
 * Lida com espelhamento do segundo banco (0xC000–0xFFFF) sobre 0x8000–0xBFFF.
 */
function createCpuWithProgram(
  program: number[],
  startAddr: number = 0x8000,
  patches?: Array<{ addr: number; bytes: number[] }>
): Cpu6502 {
  const prg = new Uint8Array(16 * 1024).fill(0xEA); // NOP
  const chr = new Uint8Array(8 * 1024);

  const toPrgOffset = (addr: number) => {
    // mapeia 0x8000–0xFFFF para 0x0000–0x3FFF (16KB), com espelhamento
    const off = (addr & 0xffff) - 0x8000;
    return ((off % prg.length) + prg.length) % prg.length;
  };

  // Copia o programa
  const prgOffset = toPrgOffset(startAddr);
  prg.set(program.map(b => b & 0xff), prgOffset);

  // Aplica patches
  if (patches) {
    for (const { addr, bytes } of patches) {
      const off = toPrgOffset(addr);
      prg.set(bytes.map(b => b & 0xff), off);
    }
  }

  // Vetor de RESET (0xFFFC/0xFFFD) → offsets 0x3FFC/0x3FFD no PRG de 16KB
  prg[0x3ffc] = startAddr & 0xff;
  prg[0x3ffd] = (startAddr >> 8) & 0xff;

  const memory = new Memory();
  const mapper = new Mapper0(prg, chr, Mirroring.Horizontal);
  memory.attachMapper(mapper);

  const cpu = new Cpu6502(memory);
  cpu.reset();
  return cpu;
}

describe("CPU6502 - Operações Básicas", () => {
  it("LDA immediate carrega valor no acumulador", () => {
    const cpu = createCpuWithProgram([0xa9, 0x42]); // LDA #$42
    cpu.step();
    expect(cpu.A).toBe(0x42);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });

  it("STA zeropage armazena A na memória", () => {
    const cpu = createCpuWithProgram([0xa9, 0x55, 0x85, 0x10]); // LDA #$55, STA $10
    cpu.step(); // LDA
    cpu.step(); // STA
    expect(cpu.read(0x0010)).toBe(0x55);
  });

  it("EOR zeropage realiza XOR entre A e memória", () => {
    const cpu = createCpuWithProgram([
      0xa9,
      0b10101010, // LDA #$AA
      0x45,
      0x10, // EOR $10
    ]);
    cpu.memory.write(0x0010, 0b11001100);

    cpu.step(); // LDA
    expect(cpu.A).toBe(0b10101010);

    cpu.step(); // EOR
    expect(cpu.A).toBe(0b01100110);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });
});

describe("CPU6502 - Operações de Stack", () => {
  it("PHA empilha o acumulador corretamente", () => {
    const cpu = createCpuWithProgram([0xa9, 0x42, 0x48]); // LDA #$42, PHA
    cpu.step(); // LDA
    const initialSP = cpu.SP;
    cpu.step(); // PHA

    expect(cpu.SP).toBe((initialSP - 1) & 0xff);
    expect(cpu.read(0x0100 + initialSP)).toBe(0x42);
  });

  it("PLA desempilha para o acumulador e atualiza flags", () => {
    const cpu = createCpuWithProgram([0xa9, 0xff, 0x48, 0xa9, 0x00, 0x68]); // LDA #$FF, PHA, LDA #$00, PLA
    cpu.step(); // LDA #$FF
    cpu.step(); // PHA
    cpu.step(); // LDA #$00

    const initialSP = cpu.SP;
    cpu.step(); // PLA

    expect(cpu.A).toBe(0xff);
    expect(cpu.SP).toBe((initialSP + 1) & 0xff);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(true);
  });

  it("PHP empilha os flags com Break e Unused setados", () => {
    const cpu = createCpuWithProgram([0xa9, 0x80, 0x08]); // LDA #$80, PHP
    cpu.step(); // LDA
    cpu.step(); // PHP

    const status = cpu.read(0x0100 + cpu.SP + 1);
    expect(status & Flags6502.Negative).toBe(Flags6502.Negative);
    expect(status & Flags6502.Break).toBe(Flags6502.Break);
    expect(status & Flags6502.Unused).toBe(Flags6502.Unused);
  });

  it("PLP restaura os flags corretamente", () => {
    const cpu = createCpuWithProgram([0xa9, 0x80, 0x08, 0xa9, 0x00, 0x28]); // LDA #$80, PHP, LDA #$00, PLP
    cpu.step(); // LDA
    const originalP = cpu.P;
    cpu.step(); // PHP
    cpu.step(); // LDA
    cpu.step(); // PLP

    expect(cpu.P & 0b11001111).toBe(originalP & 0b11001111);
    expect(cpu.getFlag(Flags6502.Unused)).toBe(true);
  });
});

describe("CPU6502 - Subrotinas", () => {
  it("JSR empilha endereço de retorno (PC+2) e salta", () => {
    const cpu = createCpuWithProgram([0x20, 0x34, 0x12]); // JSR $1234
    const initialPC = cpu.PC;
    cpu.step();

    const returnAddr = initialPC + 2; // comportamento real do 6502
    expect(cpu.PC).toBe(0x1234);
    expect(cpu.read(0x01fd)).toBe((returnAddr >> 8) & 0xff); // High
    expect(cpu.read(0x01fc)).toBe(returnAddr & 0xff);        // Low
    expect(cpu.SP).toBe(0xfb); // SP decrementado 2x
  });

  it("RTS retorna para endereço empilhado + 1", () => {
    // Programa começa em C000 com JSR $8005; em $8005 colocamos RTS (0x60)
    const cpu = createCpuWithProgram([0x20, 0x05, 0x80], 0xc000, [
      { addr: 0x8005, bytes: [0x60] },
    ]);

    cpu.step(); // JSR
    cpu.step(); // RTS
    expect(cpu.PC).toBe(0xc003);
  });

  it("Stack overflow/underflow causa wraparound", () => {
    const cpu = createCpuWithProgram([0xa9, 0x11, 0x48]); // LDA #$11, PHA
    cpu.SP = 0x00; // Força overflow
    cpu.step(); // LDA
    cpu.step(); // PHA

    expect(cpu.SP).toBe(0xff);
    expect(cpu.read(0x0100)).toBe(0x11);
  });
});

describe("CPU6502 - Casos Especiais", () => {
  it("Reset inicializa SP para 0xFD", () => {
    const cpu = new Cpu6502(new Memory());
    cpu.reset();
    expect(cpu.SP).toBe(0xfd);
  });

  it("Stack Pointer opera apenas na página 1", () => {
    const cpu = createCpuWithProgram([0xa9, 0x11, 0x48]); // LDA #$11, PHA
    cpu.step(); // LDA
    cpu.step(); // PHA

    expect(cpu.read(0x01fd)).toBe(0x11);
    expect(cpu.read(0x00fd)).toBe(0x00);
  });

  it("JSR/RTS aninhados funcionam corretamente", () => {
    // C000: JSR $8005
    // 8005: JSR $9000; RTS
    // 9000: RTS
    const cpu = createCpuWithProgram([0x20, 0x05, 0x80], 0xc000, [
      { addr: 0x8005, bytes: [0x20, 0x00, 0x90, 0x60] },
      { addr: 0x9000, bytes: [0x60] },
    ]);

    cpu.step(); // JSR $8005
    cpu.step(); // JSR $9000
    cpu.step(); // RTS (de $9000) -> retorna para $8008
    cpu.step(); // RTS (de $8005) -> retorna para $C003

    expect(cpu.PC).toBe(0xc003);
  });

  it("Flags são atualizados corretamente", () => {
    const cpu = createCpuWithProgram([0xa9, 0x00, 0xa9, 0x80, 0xa9, 0xff]);

    cpu.step(); // LDA #$00
    expect(cpu.getFlag(Flags6502.Zero)).toBe(true);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);

    cpu.step(); // LDA #$80
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(true);

    cpu.step(); // LDA #$FF
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(true);
  });
});

describe("CPU6502 - Instruções não oficiais", () => {
  it("SLO zeropage realiza ASL + ORA corretamente", () => {
    const cpu = createCpuWithProgram([
      0xa9, 0x11, // LDA #$11
      0x07, 0x10, // SLO $10
    ]);
    cpu.memory.write(0x0010, 0b10000001);
    cpu.step(); // LDA
    cpu.step(); // SLO (zp): mem << 1 => 0x02, C=1; A |= 0x02 => 0x13
    expect(cpu.read(0x0010)).toBe(0x02);
    expect(cpu.A).toBe(0x13);
    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });

  it("SLO absolute realiza ASL + ORA corretamente (usa RAM, não ROM)", () => {
    const cpu = createCpuWithProgram([
      0xa9, 0x11,       // LDA #$11
      0x0f, 0x00, 0x02, // SLO $0200
    ]);

    // inicializa RAM em $0200 com 0x81
    cpu.memory.write(0x0200, 0x81);

    cpu.step(); // LDA
    cpu.step(); // SLO absolute
    expect(cpu.read(0x0200)).toBe(0x02);
    expect(cpu.A).toBe(0x13);
    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });

  it("SLO (zp,X) realiza ASL + ORA corretamente (ponteiro para RAM)", () => {
    const cpu = createCpuWithProgram([
      0xa9, 0x11, // LDA #$11
      0xa2, 0x04, // LDX #$04
      0x03, 0x20, // SLO ($20,X)
    ]);

    // ponteiro na ZP ($20+X=4 -> $24/$25) apontando para $0200 (RAM)
    cpu.memory.write(0x0024, 0x00);
    cpu.memory.write(0x0025, 0x02);
    cpu.memory.write(0x0200, 0x81);

    cpu.step(); // LDA
    cpu.step(); // LDX
    cpu.step(); // SLO (zp,X)
    expect(cpu.read(0x0200)).toBe(0x02);
    expect(cpu.A).toBe(0x13);
    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });
});
