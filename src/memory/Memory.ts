export class Memory {
  private ram = new Uint8Array(0x0800) // 2KB de RAM
  private program = new Uint8Array(0x10000) // 64KB de espaço de endereçamento

  constructor() {}

  loadProgram(program: Uint8Array, startAddr: number = 0x8000) {
    // Limpa a memória do programa
    this.program.fill(0xEA) // Preenche com NOPs
    
    // Carrega o programa na posição especificada
    for (let i = 0; i < program.length; i++) {
      this.program[startAddr + i] = program[i]
    }
  }

  read(addr: number): number {
    // RAM principal (0x0000-0x1FFF) com espelhamento
    if (addr < 0x2000) {
      return this.ram[addr % 0x0800]
    }
    
    // Restante do espaço de endereçamento
    return this.program[addr]
  }

  write(addr: number, value: number): void {
    // RAM principal (0x0000-0x1FFF) com espelhamento
    if (addr < 0x2000) {
      this.ram[addr % 0x0800] = value
    }
    // Permite escrita no espaço do programa também
    else {
      this.program[addr] = value
    }
  }
}