import { describe, it, expect, beforeEach } from 'vitest';
import { Mapper4 } from '../Mapper4';
import { Mirroring } from '../Mirroring';

/**
 * Helpers para simular bordas de A12 (bit 12 do endereço PPU).
 * No Mapper4, a contagem de IRQ é clockada em bordas 0→1 de A12,
 * com um filtro simples: precisa ter um "tempo" em A12=0 (low streak >= 8)
 * e ainda há um cooldown interno (decrementa por acesso).
 *
 * Portanto, para forçar uma borda válida, fazemos:
 *  - várias leituras CHR em 0x0000..0x0FFF (A12=0) para acumular lowStreak
 *  - uma leitura CHR em 0x1000..0x1FFF (A12=1) para gerar a borda
 */

function doA12Rising(mapper: Mapper4) {
  // Acumula low streak e também gasta cooldown
  for (let i = 0; i < 16; i++) {
    mapper.ppuRead(0x0000 + ((i * 2) & 0x0FFE)); // A12=0
  }
  // Agora faz a borda subindo A12
  mapper.ppuRead(0x1000); // A12=1 → borda 0→1 deve clockar
}

function doA12RisingNTimes(mapper: Mapper4, times: number) {
  for (let i = 0; i < times; i++) {
    doA12Rising(mapper);
  }
}

describe('Mapper4 (MMC3) - IRQ por A12', () => {
  let mapper: Mapper4;

  beforeEach(() => {
    // PRG 32KB (4 bancos de 8KB), CHR 8KB (8 bancos de 1KB)
    const prg = new Uint8Array(32 * 1024).fill(0xEA);
    const chr = new Uint8Array(8 * 1024).fill(0x00);
    mapper = new Mapper4(prg, chr, Mirroring.Horizontal);
    mapper.reset();
  });

  it('latch=2: IRQ pendente apenas após 3 bordas A12 válidas (reload, 1, 0)', () => {
    // C000 = latch, C001 = reload (aplica no próximo A12↑)
    mapper.cpuWrite(0xC000, 0x02); // latch=2
    mapper.cpuWrite(0xC001, 0x00); // marcar reload
    // E001 = IRQ enable
    mapper.cpuWrite(0xE001, 0x00);

    // 1ª borda após reload → counter = latch (=2), não arma IRQ
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(false);

    // 2ª borda → counter = 1
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(false);

    // 3ª borda → counter = 0 → IRQ pendente (nível)
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(true);

    // Como é nível, continua pendente até ACK ($E000), mesmo se consultar várias vezes
    expect(mapper.consumeIrq()).toBe(true);
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable: E000 (even)
    mapper.cpuWrite(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('latch=0: IRQ dispara imediatamente na 1ª borda após reload', () => {
    mapper.cpuWrite(0xC000, 0x00); // latch=0
    mapper.cpuWrite(0xC001, 0x00); // reload pendente
    mapper.cpuWrite(0xE001, 0x00); // enable

    // 1ª borda: counter recebe 0 e já arma IRQ (caso especial)
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(true);

    // Permanece pendente até ACK
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    mapper.cpuWrite(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('após ACK/disable em E000, re-enable em E001 exige novas bordas para rearmar', () => {
    // Configura latch=2, reload, enable
    mapper.cpuWrite(0xC000, 0x02);
    mapper.cpuWrite(0xC001, 0x00);
    mapper.cpuWrite(0xE001, 0x00);

    // Chega em IRQ pendente
    doA12RisingNTimes(mapper, 3);
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    mapper.cpuWrite(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);

    // Re-enable
    mapper.cpuWrite(0xE001, 0x00);

    // Sem reload explícito, o comportamento clássico: o contador continua de onde está (0),
    // mas a maioria dos jogos faz um novo reload. Vamos simular reload para ser determinístico:
    mapper.cpuWrite(0xC001, 0x00); // reload pendente novamente

    // Agora, 1ª borda → counter=latch(2)
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(false);

    // 2ª borda → 1
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(false);

    // 3ª borda → 0 → IRQ pendente de novo
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(true);
  });

  it('escrita em A000 (mirroring) e A001 (PRG-RAM ctrl) não interferem no nível da IRQ', () => {
    // Prepara latch=1 para disparar após 2 bordas (reload→1→0)
    mapper.cpuWrite(0xC000, 0x01);
    mapper.cpuWrite(0xC001, 0x00);
    mapper.cpuWrite(0xE001, 0x00); // enable

    // Mexe em mirroring e PRG-RAM no meio do caminho
    mapper.cpuWrite(0xA000, 0x01); // Vertical
    mapper.cpuWrite(0xA001, 0x80); // PRG-RAM enable
    mapper.cpuWrite(0xA001, 0xC0); // write-protect + enable

    // 1ª borda → counter=latch(1)
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(false);

    // 2ª borda → counter=0 → IRQ pendente
    doA12Rising(mapper);
    expect(mapper.consumeIrq()).toBe(true);

    // ACK + disable
    mapper.cpuWrite(0xE000, 0x00);
    expect(mapper.consumeIrq()).toBe(false);
  });

  it('desabilitar IRQ (E000) impede armar pendente mesmo com bordas subsequentes', () => {
    mapper.cpuWrite(0xC000, 0x01);
    mapper.cpuWrite(0xC001, 0x00);
    mapper.cpuWrite(0xE001, 0x00); // enable

    // Desabilita antes das bordas
    mapper.cpuWrite(0xE000, 0x00); // disable + ack (sem efeito pois ainda não estava pendente)

    // Gera bordas suficientes; como está desabilitado, não deve armar IRQ
    doA12RisingNTimes(mapper, 3);
    expect(mapper.consumeIrq()).toBe(false);

    // Re-enable e reload
    mapper.cpuWrite(0xE001, 0x00);
    mapper.cpuWrite(0xC001, 0x00);

    // Agora deve voltar a funcionar
    doA12RisingNTimes(mapper, 2);
    expect(mapper.consumeIrq()).toBe(true);
  });
});
