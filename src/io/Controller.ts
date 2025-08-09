// src/io/Controller.ts

export enum ControllerButton {
  A = 0,
  B = 1,
  Select = 2,
  Start = 3,
  Up = 4,
  Down = 5,
  Left = 6,
  Right = 7,
}

export type ButtonName =
  | 'A'
  | 'B'
  | 'Select'
  | 'Start'
  | 'Up'
  | 'Down'
  | 'Left'
  | 'Right';

export type ButtonsState = Record<ButtonName, boolean>;

/** Ordem de bits/shift do protocolo do NES: A, B, Select, Start, Up, Down, Left, Right. */
const BUTTON_ORDER: readonly ButtonName[] = [
  'A',
  'B',
  'Select',
  'Start',
  'Up',
  'Down',
  'Left',
  'Right',
] as const;

function toButtonName(btn: ButtonName | ControllerButton): ButtonName {
  if (typeof btn === 'number') {
    // Converte enum -> string usando a ordem canônica
    return BUTTON_ORDER[btn] ?? 'A';
  }
  return btn;
}

/**
 * Controlador de NES (pad de 8 botões) com protocolo strobe/shift.
 *
 * Protocolo resumido:
 * - Escrever em $4016 (bit0):
 *   - 1 → strobe ON: o controle fica relatchando o estado; leituras retornam sempre o botão A (bit0 atual).
 *   - 0 → strobe OFF: o controle "latcha" (tira um snapshot) e começa a deslocar 1 bit a cada leitura
 *     na ordem: A, B, Select, Start, Up, Down, Left, Right.
 * - Ler $4016/$4017:
 *   - Se strobe=1: retorna o estado atual do A (bit0) sempre.
 *   - Se strobe=0: retorna o próximo bit do snapshot e avança o índice (0..7). Após 8 leituras,
 *     retorna 1 (comportamento comum de emuladores).
 */
export class Controller {
  private strobe = false;
  private shiftIndex = 0; // 0..7 durante o shift; depois "satura"
  private latchedByte = 0x00; // Snapshot dos 8 botões (bit0=A ... bit7=Right)

  private buttons: ButtonsState = {
    A: false,
    B: false,
    Select: false,
    Start: false,
    Up: false,
    Down: false,
    Left: false,
    Right: false,
  };

  /** Zera estados e protocolo (não mexe no estado "pressionado" dos botões). */
  reset(): void {
    this.strobe = false;
    this.shiftIndex = 0;
    this.latchedByte = this.packButtons();
  }

  /** Atualiza o estado de um botão (pressionado/solto). Aceita string ou enum ControllerButton. */
  setButton(name: ButtonName | ControllerButton, pressed: boolean): void {
    const key = toButtonName(name);
    this.buttons[key] = !!pressed;

    // Enquanto strobe=1, o hardware fica relatchando — manter o A atualizado ajuda compat.
    if (this.strobe) {
      this.latchedByte = this.packButtons();
      this.shiftIndex = 0;
    }
  }

  /** Estado atual (útil para UI). */
  getButtons(): ButtonsState {
    return { ...this.buttons };
  }

  /**
   * Escreve o strobe ($4016 bit0).
   * - Quando escrito 1: ativa strobe e relatcha continuamente; shiftIndex volta a 0.
   * - Transição 1→0: latch do snapshot e inicia a sequência de shift.
   */
  writeStrobe(value: number): void {
    const newStrobe = (value & 1) !== 0;

    // Se entrou em strobe=1, mantém snapshot sempre atualizado
    if (newStrobe) {
      this.strobe = true;
      this.latchedByte = this.packButtons();
      this.shiftIndex = 0;
      return;
    }

    // Se houve transição 1→0, tira snapshot para iniciar o shift
    if (this.strobe && !newStrobe) {
      this.latchedByte = this.packButtons();
      this.shiftIndex = 0;
    }

    this.strobe = false;
  }

  /**
   * Leitura do próximo bit do controle (para $4016/$4017).
   * Retorna 0/1 no bit0.
   */
  readBit(): number {
    if (this.strobe) {
      // Em strobe=1, retorna SEMPRE o estado atual de A
      return this.buttons.A ? 1 : 0;
    }

    // strobe=0 → desloca bits do snapshot
    if (this.shiftIndex < 8) {
      const bit = (this.latchedByte >> this.shiftIndex) & 1;
      this.shiftIndex++;
      return bit;
    }

    // Após 8 leituras, comportamento comum é retornar 1
    return 1;
  }

  // ===================== Helpers =====================

  /** Empacota os 8 botões em um byte: bit0=A, 1=B, 2=Select, 3=Start, 4=Up, 5=Down, 6=Left, 7=Right. */
  private packButtons(): number {
    let b = 0;
    if (this.buttons.A) b |= 1 << 0;
    if (this.buttons.B) b |= 1 << 1;
    if (this.buttons.Select) b |= 1 << 2;
    if (this.buttons.Start) b |= 1 << 3;
    if (this.buttons.Up) b |= 1 << 4;
    if (this.buttons.Down) b |= 1 << 5;
    if (this.buttons.Left) b |= 1 << 6;
    if (this.buttons.Right) b |= 1 << 7;
    return b & 0xff;
  }
}
