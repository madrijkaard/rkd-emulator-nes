import { describe, it, expect } from "vitest";
import { Ppu } from "../Ppu";
import { Memory } from "../../memory/Memory";

describe("PPU", () => {
    it("should handle PPUCTRL writes", () => {
        const ppu = new Ppu(new Memory());
        ppu.writeRegister(0x2000, 0x90);
        expect(ppu.ppuctrl).toBe(0x90);
        expect(ppu.nmiEnabled).toBe(true);
    });

    it("should set VBlank flag correctly", () => {
        const ppu = new Ppu(new Memory());
        ppu.startVBlank();
        expect(ppu.ppustatus & 0x80).toBe(0x80);
    });
});