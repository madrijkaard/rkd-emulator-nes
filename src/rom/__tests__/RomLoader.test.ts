import { describe, it, expect } from "vitest";
import { RomLoader } from "../RomLoader";

/**
 * Monta uma ROM iNES 1.0 sintética.
 * - prgBanks: número de bancos PRG de 16KB
 * - chrBanks: número de bancos CHR de 8KB
 * - flags6: define trainer/mirroring/etc. (bit 2 -> trainer)
 * - flags7: pode carregar high-nibble do mapper
 */
function buildINesRom({
  prgBanks = 1,
  chrBanks = 1,
  flags6 = 0x00,
  flags7 = 0x00,
  fillPrg = 0xaa,
  fillChr = 0xbb,
  withTrainerBytes = false,
}: {
  prgBanks?: number;
  chrBanks?: number;
  flags6?: number;
  flags7?: number;
  fillPrg?: number;
  fillChr?: number;
  withTrainerBytes?: boolean;
}): Uint8Array {
  const header = new Uint8Array(16);
  header[0] = 0x4e; // 'N'
  header[1] = 0x45; // 'E'
  header[2] = 0x53; // 'S'
  header[3] = 0x1a;

  header[4] = prgBanks & 0xff; // PRG banks (16KB)
  header[5] = chrBanks & 0xff; // CHR banks (8KB)

  header[6] = flags6 & 0xff;
  header[7] = flags7 & 0xff;

  // Conteúdos
  const trainerDeclared = (flags6 & 0x04) !== 0;
  const trainerSize = trainerDeclared ? 512 : 0;
  const trainer = trainerDeclared
    ? new Uint8Array(trainerSize).fill(0xcc)
    : new Uint8Array(0);

  const prgSize = prgBanks * 16 * 1024;
  const chrSize = chrBanks * 8 * 1024;
  const prg = new Uint8Array(prgSize).fill(fillPrg);
  const chr = new Uint8Array(chrSize).fill(fillChr);

  // 👉 Correção: só inclui os 512 bytes no arquivo quando withTrainerBytes === true
  const total =
    16 +
    (trainerDeclared && withTrainerBytes ? trainer.length : 0) +
    prg.length +
    chr.length;
  const rom = new Uint8Array(total);
  let offset = 0;
  rom.set(header, offset);
  offset += 16;

  if (trainerDeclared && withTrainerBytes) {
    rom.set(trainer, offset);
    offset += trainer.length;
  }

  rom.set(prg, offset);
  offset += prg.length;
  rom.set(chr, offset);
  offset += chr.length;

  return rom;
}

describe("RomLoader", () => {
  it("carrega ROM iNES válida (sem trainer) e calcula mapper", () => {
    // flags6=0, flags7 com high-nibble = 0x10 => mapper = 0x10
    const rom = buildINesRom({
      prgBanks: 1,
      chrBanks: 1,
      flags6: 0x00,
      flags7: 0x10, // high nibble contribui: mapper = 0x10 | 0x00 = 0x10
    });

    const loader = new RomLoader(rom);
    expect(loader.header.prgRomSize).toBe(16 * 1024);
    expect(loader.header.chrRomSize).toBe(8 * 1024);
    expect(loader.prgRom.length).toBe(16 * 1024);
    expect(loader.chrRom.length).toBe(8 * 1024);

    // Mapper = (flags7>>4)<<4 | (flags6>>4)
    expect(loader.header.mapper).toBe(0x10);

    // Sem trainer
    expect(loader.header.hasTrainer).toBe(false);
    expect(loader.trainer).toBeUndefined();
  });

  it("carrega ROM iNES válida com trainer (bit 2 de flags6) e usa offsets corretos", () => {
    // flags6 com bit 2 ligado (0x04) -> trainer presente
    const rom = buildINesRom({
      prgBanks: 2, // 32KB
      chrBanks: 1, // 8KB
      flags6: 0x04, // trainer
      flags7: 0x00,
      withTrainerBytes: true,
      fillPrg: 0xaa,
      fillChr: 0xbb,
    });

    const loader = new RomLoader(rom);
    expect(loader.header.hasTrainer).toBe(true);
    expect(loader.trainer).toBeInstanceOf(Uint8Array);
    expect(loader.trainer?.length).toBe(512);

    // PRG/CHR sizes
    expect(loader.header.prgRomSize).toBe(2 * 16 * 1024);
    expect(loader.header.chrRomSize).toBe(1 * 8 * 1024);
    expect(loader.prgRom.length).toBe(32 * 1024);
    expect(loader.chrRom.length).toBe(8 * 1024);

    // Conteúdo (amostragem)
    expect(loader.prgRom[0]).toBe(0xaa);
    expect(loader.chrRom[0]).toBe(0xbb);
  });

  it("falha com cabeçalho inválido", () => {
    const rom = buildINesRom({}); // válido
    rom[0] = 0x00; // quebra a assinatura
    expect(() => new RomLoader(rom)).toThrow(/cabeçalho.*não encontrado/i);
  });

  it("falha quando trainer é declarado mas os 512 bytes não existem", () => {
    // flags6 liga trainer, mas vamos *encurtar* o arquivo para ter menos que 16+512 bytes
    const rom = buildINesRom({
      prgBanks: 1,
      chrBanks: 1,
      flags6: 0x04, // trainer presente
      withTrainerBytes: false, // não adiciona trainer
    });

    // 👉 Garante que o arquivo total tem menos do que 16 + 512 bytes,
    // forçando o erro "trainer declarado mas incompleto".
    const truncated = rom.slice(0, 16 + 100);

    expect(() => new RomLoader(truncated)).toThrow(/trainer.*incompleto/i);
  });

  it("falha quando PRG está truncado", () => {
    const full = buildINesRom({ prgBanks: 1, chrBanks: 1 });
    // Remove alguns bytes do final para simular truncamento de PRG/CHR
    const truncated = full.slice(0, full.length - (8 * 1024 + 100));
    expect(() => new RomLoader(truncated)).toThrow(/PRG ROM incompleta/i);
  });

  it("falha quando CHR está truncado", () => {
    const full = buildINesRom({ prgBanks: 1, chrBanks: 1 });
    // Remove poucos bytes para cortar dentro da CHR
    const truncated = full.slice(0, full.length - 100);
    expect(() => new RomLoader(truncated)).toThrow(/CHR ROM incompleta/i);
  });
});
