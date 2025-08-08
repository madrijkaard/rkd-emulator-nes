// src/mappers/Mapper.ts
import { Mirroring } from './Mirroring';

/**
 * Contrato base para mappers de cartucho do NES.
 *
 * Responsabilidades do mapper:
 *  - Expor leituras/escritas do espaço da CPU (0x6000–0xFFFF tipicamente)
 *  - Expor leituras/escritas do espaço da PPU para CHR/pattern tables (0x0000–0x1FFF)
 *  - Informar o modo de mirroring aplicado às nametables (CIRAM)
 *  - Resetar estado interno quando necessário
 *
 * Observação:
 *  - As nametables (0x2000–0x2FFF) e a palette RAM (0x3F00–0x3F1F) são resolvidas pela PPU.
 *  - O mapper deve cuidar apenas de CHR (0x0000–0x1FFF) no espaço PPU.
 */
export interface Mapper {
  /** Identificador numérico do mapper (ex.: 0=NROM, 4=MMC3). */
  readonly mapperId: number;

  // ===================== CPU space (0x0000–0xFFFF) =====================

  /**
   * Leitura do espaço da CPU endereçado ao cartucho (ex.: PRG-ROM/PRG-RAM).
   * A Memory delega para o mapper quando o endereço estiver na faixa do cartucho.
   */
  cpuRead(addr: number): number;

  /**
   * Escrita no espaço da CPU endereçado ao cartucho (ex.: PRG-RAM ou registradores do mapper).
   */
  cpuWrite(addr: number, value: number): void;

  // ===================== PPU space (0x0000–0x3FFF) =====================

  /**
   * Leitura do espaço da PPU que é responsabilidade do mapper:
   * - 0x0000–0x1FFF → CHR (pattern tables), possivelmente com bank switching.
   * As nametables (0x2000–0x2FFF) e palettes (0x3F00–0x3F1F) são tratadas pela PPU.
   */
  ppuRead(addr: number): number;

  /**
   * Escrita no espaço da PPU que é responsabilidade do mapper:
   * - 0x0000–0x1FFF → CHR-RAM (quando presente). CHR-ROM ignora escrita.
   */
  ppuWrite(addr: number, value: number): void;

  // ===================== Controle / Estado =====================

  /** Reset do estado interno do mapper (PRG-RAM, CHR-RAM, registradores, etc.). */
  reset(): void;

  /**
   * Modo de mirroring para as nametables da PPU (CIRAM):
   *  - Horizontal: [A A][B B]
   *  - Vertical:   [A B][A B]
   *  - FourScreen: cartucho com 4KB extras (opcional)
   */
  getMirroring(): Mirroring;
}
