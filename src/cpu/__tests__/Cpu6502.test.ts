import { describe, it, expect } from "vitest";
import { Cpu6502 } from "../Cpu6502";
import { Flags6502 } from "../Flags6502";
import { Memory } from "../../memory/Memory";

function createCpuWithProgram(
  program: number[],
  startAddr: number = 0x8000
): Cpu6502 {
  const memory = new Memory();
  memory.loadProgram(new Uint8Array(program), startAddr);

  // Configura vetor de reset
  memory.write(0xfffc, startAddr & 0xff);
  memory.write(0xfffd, (startAddr >> 8) & 0xff);

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
    cpu.memory.write(0x0010, 0b11001100); // Valor na memória zeropage

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

    const returnAddr = initialPC + 2; // Comportamento real do 6502
    expect(cpu.PC).toBe(0x1234);
    expect(cpu.read(0x01fd)).toBe((returnAddr >> 8) & 0xff); // High byte
    expect(cpu.read(0x01fc)).toBe(returnAddr & 0xff); // Low byte (PC+2)
    expect(cpu.SP).toBe(0xfb); // SP decrementado 2x
  });

  it("RTS retorna para endereço empilhado + 1", () => {
    const cpu = createCpuWithProgram([0x20, 0x05, 0x80], 0xc000);
    cpu.memory.write(0x8005, 0x60); // RTS

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
    const cpu = createCpuWithProgram([0x20, 0x05, 0x80], 0xc000);
    cpu.memory.loadProgram([0x20, 0x00, 0x90, 0x60], 0x8005);
    cpu.memory.write(0x9000, 0x60);

    cpu.step(); // JSR $8005
    cpu.step(); // JSR $9000
    cpu.step(); // RTS
    cpu.step(); // RTS

    expect(cpu.PC).toBe(0xc004);
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
      0xa9,
      0x11, // LDA #$11
      0x07,
      0x10, // SLO $10
    ]);

    cpu.memory.write(0x0010, 0b10000001); // valor original

    cpu.step(); // LDA
    expect(cpu.A).toBe(0x11);

    cpu.step(); // SLO
    // valor após ASL: 0b00000010 (shifted), com carry = 1
    // ORA com A = 0x11 → 0x11 | 0x02 = 0x13

    expect(cpu.read(0x0010)).toBe(0x02); // memória após ASL
    expect(cpu.A).toBe(0x13); // acumulador após ORA
    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });

  it("SLO absolute realiza ASL + ORA corretamente", () => {
    const cpu = createCpuWithProgram([
      0xa9,
      0x11, // LDA #$11
      0x0f,
      0x00,
      0x90, // SLO $9000
    ]);

    cpu.memory.write(0x9000, 0b10000001); // 0x81

    cpu.step(); // LDA
    expect(cpu.A).toBe(0x11);

    cpu.step(); // SLO absolute
    // ASL: 0x81 << 1 = 0x02 (carry = 1)
    // ORA: 0x11 | 0x02 = 0x13
    expect(cpu.read(0x9000)).toBe(0x02);
    expect(cpu.A).toBe(0x13);

    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });

  it("SLO (zp,X) realiza ASL + ORA corretamente", () => {
    const cpu = createCpuWithProgram([
      0xa9,
      0x11, // LDA #$11
      0xa2,
      0x04, // LDX #$04
      0x03,
      0x20, // SLO ($20,X) -> usa ponteiro em $24/$25
    ]);

    // Configura ponteiro na zeropage: ($20 + X=4) = $24/$25 -> $9000
    cpu.memory.write(0x0024, 0x00); // low
    cpu.memory.write(0x0025, 0x90); // high

    // Valor alvo em $9000
    cpu.memory.write(0x9000, 0x81); // 1000_0001

    cpu.step(); // LDA
    expect(cpu.A).toBe(0x11);

    cpu.step(); // LDX
    expect(cpu.X).toBe(0x04);

    cpu.step(); // SLO (zp,X)
    // ASL: 0x81 << 1 = 0x02 (carry=1)
    // ORA: 0x11 | 0x02 = 0x13
    expect(cpu.read(0x9000)).toBe(0x02);
    expect(cpu.A).toBe(0x13);
    expect(cpu.getFlag(Flags6502.Carry)).toBe(true);
    expect(cpu.getFlag(Flags6502.Zero)).toBe(false);
    expect(cpu.getFlag(Flags6502.Negative)).toBe(false);
  });
});
