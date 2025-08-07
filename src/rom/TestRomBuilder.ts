// Gera uma ROM iNES mínima (Mapper 0) com um programinha de 5 bytes.
// Programa: LDA #$42 ; TAX ; INX ; NOP ; BRK
// Vetor de RESET em $FFFC/$FFFD aponta para $8000.

export function buildTestRom(): Uint8Array {
  const header = new Uint8Array(16)
  header[0] = 0x4e // 'N'
  header[1] = 0x45 // 'E'
  header[2] = 0x53 // 'S'
  header[3] = 0x1a
  header[4] = 1 // PRG: 16KB
  header[5] = 1 // CHR: 8KB
  header[6] = 0x00 // flags6
  header[7] = 0x00 // flags7

  const prg = new Uint8Array(16 * 1024).fill(0xEA) // preenche com NOP
  const chr = new Uint8Array(8 * 1024) // zerado

  // Programa em $8000 (offset 0x0000 no banco PRG)
  const program = [0xA9, 0x42, 0xAA, 0xE8, 0xEA, 0x00] // LDA #$42; TAX; INX; NOP; BRK
  prg.set(program, 0x0000)

  // Vetor de RESET ($FFFC/$FFFD) dentro do PRG (offsets 0x3FFC/0x3FFD num PRG de 16KB)
  prg[0x3FFC] = 0x00 // low byte
  prg[0x3FFD] = 0x80 // high byte -> $8000

  return new Uint8Array([...header, ...prg, ...chr])
}
