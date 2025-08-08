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

    // Avança ~1 quadro para chegar em scanline 241 (início do VBlank).
    // 262 scanlines * 341 ciclos ~ 892... ciclos, mas step() só incrementa ciclo e fecha a cada 341.
    for (let s = 0; s < 262; s++) {
      // força “final do scanline”
      for (let c = 0; c < 341; c++) ppu.step();
    }

    expect(ppu.registers.ppustatus & 0x80).toBe(0x80);
  });

  it("leitura de PPUSTATUS limpa VBlank e writeToggle", () => {
    const ppu = new Ppu(new Memory());
    // Simula VBlank setado
    ppu.registers.ppustatus |= 0x80;

    // Marca writeToggle como true simulando 1ª escrita prévia
    (ppu as any)["writeToggle"] = true;

    const status = ppu.readRegister(0x2002);
    expect(status & 0xE0).toBe(0x80); // leu com VBlank setado nos bits altos
    expect(ppu.registers.ppustatus & 0x80).toBe(0); // VBlank limpo
    // writeToggle deve ter sido limpo
    // não temos acesso direto, mas podemos inferir via próxima escrita em $2005 começar "primeira parte"
    ppu.writeRegister(0x2005, 0x12); // 1ª write: X
    ppu.writeRegister(0x2005, 0x34); // 2ª write: Y
    expect(ppu.registers.ppuscroll).toBe((0x34 << 8) | 0x12);
  });
});
