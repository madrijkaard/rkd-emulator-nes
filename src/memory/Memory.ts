import type { Mapper } from '../mappers/Mapper'

export class Memory {
  private ram = new Uint8Array(0x0800) // 2KB de RAM (0x0000–0x07FF) + espelhos
  private program = new Uint8Array(0x10000) // fallback para seus testes atuais
  private mapper: Mapper | null = null

  constructor() {}

  attachMapper(mapper: Mapper) {
    this.mapper = mapper
    this.mapper.reset()
  }

  /**
   * Carrega um programa na memória a partir de um endereço (por padrão 0x8000)
   * e preenche o restante da memória com NOPs.
   * (mantido para seus testes unitários)
   */
  loadProgram(program: Uint8Array, startAddr: number = 0x8000) {
    this.program.fill(0xEA) // Preenche com NOPs
    for (let i = 0; i < program.length; i++) {
      this.program[startAddr + i] = program[i]
    }
  }

  /**
   * Carrega a PRG ROM da ROM iNES e configura o vetor de reset.
   * (mantido para seus testes unitários)
   */
  loadRom(prgRom: Uint8Array, startAddr: number = 0x8000) {
    for (let i = 0; i < prgRom.length; i++) {
      this.write(startAddr + i, prgRom[i])
    }
    // Define o vetor de reset para o início da PRG ROM
    this.write(0xFFFC, startAddr & 0xFF)        // Low byte
    this.write(0xFFFD, (startAddr >> 8) & 0xFF) // High byte
  }

  read(addr: number): number {
    // RAM principal (0x0000–0x1FFF) com espelhamento
    if (addr < 0x2000) {
      return this.ram[addr % 0x0800]
    }

    // Mapas da CPU (PPU/APU/IO) ficariam aqui (0x2000–0x5FFF) — fora do escopo agora

    // Se houver mapper, delega 0x6000–0xFFFF
    if (this.mapper && addr >= 0x6000) {
      return this.mapper.cpuRead(addr) & 0xff
    }

    // Fallback para seus testes
    return this.program[addr] || 0
  }

  write(addr: number, value: number): void {
    value &= 0xff

    // RAM principal (0x0000–0x1FFF) com espelhamento
    if (addr < 0x2000) {
      this.ram[addr % 0x0800] = value
      return
    }

    // Mapas da CPU (PPU/APU/IO) ficariam aqui (0x2000–0x5FFF)

    // Se houver mapper, delega 0x6000–0xFFFF
    if (this.mapper && addr >= 0x6000) {
      this.mapper.cpuWrite(addr, value)
      return
    }

    // Fallback para seus testes
    this.program[addr] = value
  }
}
