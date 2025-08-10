import { describe, it, expect } from "vitest";
import { Ppu } from "../Ppu";
import { Memory } from "../../memory/Memory";

describe("PPU", () => {
  it("grava PPUCTRL e reflete nmiEnabled corretamente", () => {
    const ppu = new Ppu(new Memory());
    ppu.writeRegister(0x2000, 0x90); // bit 7 ligado → NMI enable
    expect(ppu.registers.ppuctrl).toBe(0x90);
    expect(ppu.registers.nmiEnabled).toBe(true);
  });

  it("sinaliza VBlank em PPUSTATUS após varredura", () => {
    const ppu = new Ppu(new Memory());

    // Avança até o bit 7 (VBlank) acender, com limite de segurança
    const maxCycles = 341 * 262 * 3; // até ~3 frames
    let cycles = 0;
    while ((ppu.registers.ppustatus & 0x80) === 0 && cycles < maxCycles) {
      ppu.step();
      cycles++;
    }

    expect(ppu.registers.ppustatus & 0x80).toBe(0x80);
  });

  it("leitura de PPUSTATUS limpa VBlank e writeToggle", () => {
    const ppu = new Ppu(new Memory());
    // Simula VBlank setado
    ppu.registers.ppustatus |= 0x80;

    // Marca writeToggle como true simulando 1ª escrita prévia
    // (não precisamos acessar internals — a leitura de $2002 deve limpar w)
    (ppu as any)["writeToggle"] = true;

    const status = ppu.readRegister(0x2002);
    expect(status & 0xE0).toBe(0x80); // leu com VBlank setado nos bits altos
    expect(ppu.registers.ppustatus & 0x80).toBe(0); // VBlank limpo

    // Próximas duas escritas em $2005 devem ser tratadas como 1ª e 2ª (w resetado)
    ppu.writeRegister(0x2005, 0x12); // 1ª write: X
    ppu.writeRegister(0x2005, 0x34); // 2ª write: Y
    expect(ppu.registers.ppuscroll).toBe((0x34 << 8) | 0x12);
  });
});
