// src/mappers/MapperFactory.ts
import type { Mapper } from './Mapper';
import { Mapper0 } from './Mapper0';
import { Mapper2 } from './Mapper2';
import { Mapper4 } from './Mapper4';
import { Mirroring } from './Mirroring';

export function createMapper(
  mapperId: number,
  prg: Uint8Array,
  chr: Uint8Array,
  mirroring: Mirroring
): Mapper {
  switch (mapperId) {
    case 0: return new Mapper0(prg, chr, mirroring);
    case 2: return new Mapper2(prg, chr, mirroring);   // <<–– AQUI
    case 4: return new Mapper4(prg, chr, mirroring);
    default:
      throw new Error(`Mapper ${mapperId} não suportado ainda.`);
  }
}
