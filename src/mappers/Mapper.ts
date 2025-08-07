export interface Mapper {
  readonly mapperId: number

  /** Leituras/escritas do espaço de endereços da CPU (0x0000–0xFFFF). */
  cpuRead(addr: number): number
  cpuWrite(addr: number, value: number): void

  /** Leituras/escritas do espaço da PPU (0x0000–0x3FFF). Mantemos stub por ora. */
  ppuRead(addr: number): number
  ppuWrite(addr: number, value: number): void

  reset(): void
}
