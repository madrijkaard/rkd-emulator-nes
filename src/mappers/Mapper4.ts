import type { Mapper } from './Mapper'
/**
 * Mapper 4 (MMC3) — STUB:
 * Apenas para detectar e recusar execução com mensagem amigável.
 * Implementação real envolve:
 * - Registradores 0–7 (seletor de banco e dados de banco)
 * - Seleção dinâmica PRG e CHR em blocos de 8KB/2KB/1KB
 * - IRQ baseado em contagem de linhas/scanline (PPU A12)
 */
export class Mapper4 implements Mapper {
  readonly mapperId = 4

  constructor(_prgRom: Uint8Array, _chrRom: Uint8Array) {}

  reset(): void {}

  cpuRead(_addr: number): number {
    throw new Error('Mapper 4 (MMC3) ainda não implementado.')
  }

  cpuWrite(_addr: number, _value: number): void {
    throw new Error('Mapper 4 (MMC3) ainda não implementado.')
  }

  ppuRead(_addr: number): number {
    throw new Error('Mapper 4 (MMC3) ainda não implementado.')
  }

  ppuWrite(_addr: number, _value: number): void {
    throw new Error('Mapper 4 (MMC3) ainda não implementado.')
  }
}
