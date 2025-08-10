// src/ui/InputHandler.ts
import { Memory } from '../memory/Memory';

/**
 * Teclado → Controle do NES (Player 1)
 *
 * Setas: ArrowUp / ArrowDown / ArrowLeft / ArrowRight
 * Select: Space
 * Start : Enter
 * A     : KeyA
 * B     : KeyZ
 */
export class InputHandler {
  private memory: Memory;
  private target: Window | Document;
  private pressed = new Set<string>();

  // Mapa KeyboardEvent.code → nome do botão esperado por Memory.*Controller1()
  private keyToBtn: Record<string, string> = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Select',
    Enter: 'Start',
    KeyA: 'A',
    KeyZ: 'B',
  };

  // Guardar handlers para poder remover depois
  private visibilityHandler = () => {
    if (document.hidden) this.releaseAll();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    // Ignora quando o foco está em inputs (para não “roubar” digitação)
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    const btn = this.keyToBtn[e.code];
    if (!btn) return;

    // Evita scroll (setas/espaço) e repetição por auto-repeat
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (this.pressed.has(e.code)) return;

    this.pressed.add(e.code);
    this.memory.pressButtonOnController1(btn);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const btn = this.keyToBtn[e.code];
    if (!btn) return;

    e.preventDefault();
    e.stopPropagation();
    this.pressed.delete(e.code);
    this.memory.releaseButtonOnController1(btn);
  };

  // Solta todos os botões (perda de foco/aba oculta)
  private releaseAll() {
    for (const code of this.pressed) {
      const btn = this.keyToBtn[code];
      if (btn) this.memory.releaseButtonOnController1(btn);
    }
    this.pressed.clear();
  }

  private onBlur = () => this.releaseAll();

  constructor(memory: Memory, target: Window | Document = window) {
    this.memory = memory;
    this.target = target;
    this.attach();
  }

  attach() {
    this.target.addEventListener('keydown', this.onKeyDown as any, { passive: false });
    this.target.addEventListener('keyup', this.onKeyUp as any, { passive: false });

    // Suporte a “perdeu foco” (Window) e “aba oculta” (Document)
    (this.target as any).addEventListener?.('blur', this.onBlur);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  detach() {
    this.target.removeEventListener('keydown', this.onKeyDown as any);
    this.target.removeEventListener('keyup', this.onKeyUp as any);

    (this.target as any).removeEventListener?.('blur', this.onBlur);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
    }
  }

  dispose() {
    this.detach();
    this.releaseAll();
  }
}

export default InputHandler;
