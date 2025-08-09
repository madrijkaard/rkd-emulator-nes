// src/main.ts
import { RomLoader } from './rom/RomLoader';
import { Memory } from './memory/Memory';
import { Cpu6502 } from './cpu/Cpu6502';
import { Mapper0 } from './mappers/Mapper0';
import { Mapper2 } from './mappers/Mapper2';
import { Mapper4 } from './mappers/Mapper4';
import { Mirroring } from './mappers/Mirroring';
import { disassemble6502 } from './cpu/Disassembler';
import { Flags6502 } from './cpu/Flags6502';
import { Renderer } from './ppu/Renderer';
import { Ppu } from './ppu/Ppu';
import { ControllerButton } from './io/Controller';

// ===================== Config =====================

const ENABLE_TEST_ROM = false; // manter false para ROMs reais

// Sem contagem real de ciclos ainda — heurística prática:
const CPU_STEPS_PER_FRAME = 800;
const MAX_STEPS_PER_FRAME = 1000;

// Aproximação de 6 steps PPU por step CPU
const PPU_STEPS_PER_CPU_STEP = 6;

// ===================== Estado =====================

let cpu: Cpu6502 | null = null;
let ppu: Ppu | null = null;
let ppuRenderer: Renderer | null = null;
let memoryRef: Memory | null = null;

let running = false;
let animationFrameId: number | null = null;
let lastFpsUpdate = 0;
let frameCount = 0;
let fps = 0;

// ===================== UI =====================

const el = {
  romInput: document.getElementById('romInput') as HTMLInputElement,
  resetBtn: document.getElementById('resetBtn') as HTMLButtonElement,
  stepBtn: document.getElementById('stepBtn') as HTMLButtonElement,
  runBtn: document.getElementById('runBtn') as HTMLButtonElement,
  pauseBtn: document.getElementById('pauseBtn') as HTMLButtonElement,
  output: document.getElementById('output') as HTMLDivElement,
  canvas: document.getElementById('nesCanvas') as HTMLCanvasElement,
  regA: document.getElementById('regA') as HTMLDivElement,
  regX: document.getElementById('regX') as HTMLDivElement,
  regY: document.getElementById('regY') as HTMLDivElement,
  regSP: document.getElementById('regSP') as HTMLDivElement,
  regPC: document.getElementById('regPC') as HTMLDivElement,
  regP: document.getElementById('regP') as HTMLDivElement,
  disassembly: document.getElementById('disassembly') as HTMLDivElement,
  fpsCounter: document.getElementById('fpsCounter') as HTMLDivElement,
};

// ===================== Bootstrap =====================

function init() {
  hookUI();
  hookKeyboardShortcuts();
  hookKeyboardController();
  initRenderer();
  clearScreen();
  updateUI();
  showMessage('Nenhum arquivo carregado.', 'info');

  if (ENABLE_TEST_ROM) {
    // Você pode plugar um builder de ROM sintética se quiser
    // bootWithRomBytes(buildTestRom()).catch(handleError);
  }
}

function initRenderer() {
  ppuRenderer = new Renderer(el.canvas);
  el.canvas.style.imageRendering = 'pixelated';
}

function hookUI() {
  el.romInput.addEventListener('change', async () => {
    const file = el.romInput.files?.[0];
    if (!file) return;
    try {
      showMessage('Carregando ROM...', 'info');
      const bytes = new Uint8Array(await file.arrayBuffer());
      await bootWithRomBytes(bytes);
      showMessage(`ROM "${file.name}" carregada. Iniciando...`, 'success');

      // >>> AJUSTE #1: começa a rodar automaticamente após o load <<<
      startRunning();
    } catch (e) {
      handleError(e as Error);
    }
  });

  el.stepBtn.addEventListener('click', stepExecution);
  el.runBtn.addEventListener('click', startRunning);
  el.pauseBtn.addEventListener('click', pauseExecution);
  el.resetBtn.addEventListener('click', resetExecution);

  window.addEventListener('blur', clearControllerStates);
}

// ===================== Teclado → Controller 1 =====================

function hookKeyboardController() {
  const pressed = new Set<string>();

  const setBtn = (btn: ControllerButton, down: boolean) => {
    const c1 = memoryRef?.getController1();
    if (!c1) return;
    c1.setButton(btn, down);
  };

  const onKeyChange = (e: KeyboardEvent, down: boolean) => {
    // evita repetir flood
    if (down) {
      if (pressed.has(e.code)) return;
      pressed.add(e.code);
    } else {
      pressed.delete(e.code);
    }

    switch (e.code) {
      // Direções
      case 'ArrowUp': setBtn(ControllerButton.Up, down); break;
      case 'ArrowDown': setBtn(ControllerButton.Down, down); break;
      case 'ArrowLeft': setBtn(ControllerButton.Left, down); break;
      case 'ArrowRight': setBtn(ControllerButton.Right, down); break;

      // Botões — layout "FCEUX-like"
      // Z = A, X = B (também ofereço J/K como alternativa)
      case 'KeyZ':
      case 'KeyJ': setBtn(ControllerButton.A, down); break;
      case 'KeyX':
      case 'KeyK': setBtn(ControllerButton.B, down); break;

      // Start / Select
      case 'Enter': setBtn(ControllerButton.Start, down); break;
      case 'ShiftRight':
      case 'ShiftLeft': setBtn(ControllerButton.Select, down); break;

      default: break;
    }
  };

  document.addEventListener('keydown', (e) => onKeyChange(e, true));
  document.addEventListener('keyup', (e) => onKeyChange(e, false));
}

function clearControllerStates() {
  const c1 = memoryRef?.getController1();
  const c2 = memoryRef?.getController2();
  if (!c1) return;
  for (const b of [
    ControllerButton.A, ControllerButton.B, ControllerButton.Select, ControllerButton.Start,
    ControllerButton.Up, ControllerButton.Down, ControllerButton.Left, ControllerButton.Right,
  ]) {
    c1.setButton(b, false);
    c2?.setButton(b, false);
  }
}

// ===================== Atalhos de execução =====================

function hookKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!cpu) return;

    switch (e.key) {
      case 'F1': resetExecution(); break;
      case 'F5': startRunning(); break;
      case 'F6': pauseExecution(); break;
      case 'F8': stepExecution(); break;
      case ' ': running ? pauseExecution() : startRunning(); break;
    }
  });
}

// ===================== Boot / Attach ROM =====================

async function bootWithRomBytes(romBytes: Uint8Array) {
  const loader = new RomLoader(romBytes);

  // Suporte: 0 (NROM), 2 (UxROM), 4 (MMC3)
  const mapperId = loader.header.mapper;
  if (![0, 2, 4].includes(mapperId)) {
    throw new Error(`Mapper não suportado: ${mapperId}. (Suportados: 0, 2, 4)`);
  }

  const mirroring = loader.header.fourScreen
    ? Mirroring.FourScreen
    : loader.header.verticalMirroring
    ? Mirroring.Vertical
    : Mirroring.Horizontal;

  const memory = new Memory();
  memoryRef = memory;

  if (mapperId === 0) {
    memory.attachMapper(new Mapper0(loader.prgRom, loader.chrRom, mirroring));
  } else if (mapperId === 2) {
    memory.attachMapper(new Mapper2(loader.prgRom, loader.chrRom, mirroring));
  } else if (mapperId === 4) {
    memory.attachMapper(new Mapper4(loader.prgRom, loader.chrRom, mirroring));
  }

  cpu = new Cpu6502(memory);
  ppu = memory.getPpu();

  ensureVectors(memory);

  cpu.reset();
  ppu.reset();

  updateUI();
  enableControls(true);
  clearScreen();
  showMessage('Pronto.', 'success');
}

/** Garante vetores de NMI/RESET/IRQ quando ROM sintética não os coloca. */
function ensureVectors(memory: Memory) {
  const read = (a: number) => memory.read(a) & 0xff;
  const vec = (lo: number, hi: number) => ((read(hi) << 8) | read(lo)) & 0xffff;

  const reset = vec(0xfffc, 0xfffd);
  if (reset === 0x0000) {
    memory.write(0xfffc, 0x00);
    memory.write(0xfffd, 0x80);
  }

  const nmi = vec(0xfffa, 0xfffb);
  if (nmi === 0x0000) {
    memory.write(0xfffa, 0x03);
    memory.write(0xfffb, 0x80);
    if (memory.read(0x8003) === 0x00) memory.write(0x8003, 0x40); // RTI
  }

  const irq = vec(0xfffe, 0xffff);
  if (irq === 0x0000) {
    memory.write(0xfffe, 0x03);
    memory.write(0xffff, 0x80);
    if (memory.read(0x8003) === 0x00) memory.write(0x8003, 0x40); // RTI
  }
}

// ===================== Execução =====================

function ppuStepMany(steps: number) {
  if (!ppu) return;
  for (let i = 0; i < steps; i++) {
    ppu.step();

    // NMI (VBlank) → CPU
    if (ppu.isNmiOccurred() && cpu) {
      cpu.nmi();
      ppu.clearNmi();
    }

    // IRQ do Mapper4 (MMC3)
    serviceMapperIrq();
  }
}

function serviceMapperIrq() {
  const mapper = memoryRef?.getMapper();
  const m4 = mapper && (mapper as any).consumeIrq ? (mapper as any) : null;
  if (m4 && cpu && m4.consumeIrq()) {
    cpu.irq?.();
  }
}

function stepExecution() {
  if (!cpu || !ppu || running) return;
  try {
    cpu.step();
    ppuStepMany(PPU_STEPS_PER_CPU_STEP * 4);
    renderFrame();
    updateUI();
    showMessage('Step executado.', 'info');
  } catch (e) {
    handleError(e as Error);
  }
}

function startRunning() {
  if (running || !cpu || !ppu) return;

  running = true;
  frameCount = 0;
  lastFpsUpdate = performance.now();
  enableControls();
  showMessage('Execução contínua iniciada.', 'info');

  const runFrame = (now: number) => {
    if (!running || !cpu || !ppu) return;

    try {
      const budget = Math.min(CPU_STEPS_PER_FRAME, MAX_STEPS_PER_FRAME);
      for (let i = 0; i < budget; i++) {
        cpu.step();
        ppuStepMany(PPU_STEPS_PER_CPU_STEP);
      }

      renderFrame();
      updateUI();

      frameCount++;
      if (now - lastFpsUpdate >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsUpdate = now;
        updateFpsCounter();
      }

      animationFrameId = requestAnimationFrame(runFrame);
    } catch (e) {
      handleError(e as Error);
      pauseExecution();
    }
  };

  animationFrameId = requestAnimationFrame(runFrame);
}

function renderFrame() {
  if (ppu && ppuRenderer) {
    ppuRenderer.renderFrame(ppu);
  }
}

function pauseExecution() {
  running = false;
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  enableControls();
  showMessage('Execução pausada.', 'info');
}

function resetExecution() {
  if (!cpu || !ppu) return;
  pauseExecution();
  cpu.reset();
  ppu.reset();
  clearControllerStates();
  updateUI();
  clearScreen();
  showMessage('Reset concluído.', 'success');
}

// ===================== UI helpers =====================

function updateUI() {
  if (!cpu) {
    clearUI();
    return;
  }
  updateRegisters();
  updateDisassembly();
}

function updateRegisters() {
  if (!cpu) return;
  const hx = (v: number, w: number) => v.toString(16).toUpperCase().padStart(w, '0');

  el.regA.textContent = `$${hx(cpu.A, 2)}`;
  el.regX.textContent = `$${hx(cpu.X, 2)}`;
  el.regY.textContent = `$${hx(cpu.Y, 2)}`;
  el.regSP.textContent = `$${hx(cpu.SP, 2)}`;
  el.regPC.textContent = `$${hx(cpu.PC, 4)}`;
  el.regP.innerHTML = formatFlags(cpu.P);
}

function updateDisassembly() {
  if (!cpu || !el.disassembly) return;

  const startAddr = Math.max(0, cpu.PC - 5);
  const endAddr = Math.min(0xffff, cpu.PC + 5);
  let html = '';

  for (let addr = startAddr; addr <= endAddr; addr++) {
    const opcode = cpu.read(addr);
    const instruction = disassemble6502(opcode, addr, cpu);
    const isCurrent = addr === cpu.PC;

    html += `<div class="${isCurrent ? 'current' : ''}">
      $${addr.toString(16).padStart(4, '0')}: ${instruction}
    </div>`;
  }

  el.disassembly.innerHTML = html;

  const currentLine = el.disassembly.querySelector('.current');
  if (currentLine) currentLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function updateFpsCounter() {
  if (el.fpsCounter) {
    el.fpsCounter.textContent = `FPS: ${fps}`;
  }
}

function formatFlags(p: number): string {
  const flags = [
    { bit: Flags6502.Negative, label: 'N' },
    { bit: Flags6502.Overflow, label: 'V' },
    { bit: Flags6502.Unused, label: 'U' },
    { bit: Flags6502.Break, label: 'B' },
    { bit: Flags6502.Decimal, label: 'D' },
    { bit: Flags6502.InterruptDisable, label: 'I' },
    { bit: Flags6502.Zero, label: 'Z' },
    { bit: Flags6502.Carry, label: 'C' },
  ];

  return flags
    .map((f) => {
      const set = (p & f.bit) !== 0;
      return `<span class="flag-${set ? 'on' : 'off'}" title="${f.label}">${f.label}</span>`;
    })
    .join('');
}

function clearScreen() {
  if (ppuRenderer) ppuRenderer.clear();
}

function clearUI() {
  el.regA.textContent = '--';
  el.regX.textContent = '--';
  el.regY.textContent = '--';
  el.regSP.textContent = '--';
  el.regPC.textContent = '--';
  el.regP.textContent = 'NVUBDIZC';
  el.disassembly.innerHTML = '';
  if (el.fpsCounter) el.fpsCounter.textContent = 'FPS: 0';
}

/** Mostra mensagem no painel e alterna classes de status (info/success/error). */
function showMessage(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  el.output.textContent = message;
  el.output.classList.remove('success', 'error');
  if (kind === 'success') el.output.classList.add('success');
  if (kind === 'error') el.output.classList.add('error');
}

function enableControls(_enabled = false) {
  const hasCpu = !!cpu;
  el.stepBtn.disabled = !hasCpu || running;
  el.runBtn.disabled = !hasCpu || running;
  el.pauseBtn.disabled = !hasCpu || !running;
  el.resetBtn.disabled = !hasCpu;
}

function handleError(err: Error) {
  console.error(err);
  showMessage(`Erro: ${err.message}`, 'error');
  pauseExecution();
}

// ===================== Start =====================

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
