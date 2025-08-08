// src/main.ts
import { RomLoader } from './rom/RomLoader';
import { Memory } from './memory/Memory';
import { Cpu6502 } from './cpu/Cpu6502';
import { Mapper0 } from './mappers/Mapper0';
import { Mapper4 } from './mappers/Mapper4';
import { Mirroring } from './mappers/Mirroring';
import { buildTestRom } from './rom/TestRomBuilder';
import { disassemble6502 } from './cpu/Disassembler';
import { Flags6502 } from './cpu/Flags6502';
import { Renderer } from './ppu/Renderer';
import { Ppu } from './ppu/Ppu';

// ===================== Configuração =====================

const ENABLE_TEST_ROM = false;

// Como ainda não contamos ciclos por instrução na CPU, rodamos N instruções por frame.
const CPU_STEPS_PER_FRAME = 800; // ajuste prático para manter animação responsiva
const MAX_STEPS_PER_FRAME = 1000; // teto de segurança

// Quantos passos de PPU por instrução de CPU (aproximação)
const PPU_STEPS_PER_CPU_STEP = 6; // ~3 ciclos PPU por ciclo CPU * ~2 ciclos médios por instrução

// ===================== Estado do emulador =====================

let cpu: Cpu6502 | null = null;
let ppu: Ppu | null = null;
let ppuRenderer: Renderer | null = null;
let memoryRef: Memory | null = null; // <- referência p/ consultar mapper (IRQ MMC3)

let running = false;
let animationFrameId: number | null = null;
let lastFpsUpdate = 0;
let frameCount = 0;
let fps = 0;

// ===================== UI =====================

const elements = {
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
  setupEventListeners();
  setupKeyboardShortcuts();
  initRenderer();
  clearScreen();
  updateUI();
  showMessage('Nenhum arquivo carregado.', 'info');

  if (ENABLE_TEST_ROM) {
    bootWithRomBytes(buildTestRom())
      .then(() => showMessage('ROM de teste carregada.', 'success'))
      .catch(handleError);
  }
}

function initRenderer() {
  ppuRenderer = new Renderer(elements.canvas);
  elements.canvas.style.imageRendering = 'pixelated';
}

function setupEventListeners() {
  elements.romInput.addEventListener('change', async () => {
    const file = elements.romInput.files?.[0];
    if (!file) return;

    try {
      showMessage('Carregando ROM...', 'info');
      const arrayBuffer = await file.arrayBuffer();
      await bootWithRomBytes(new Uint8Array(arrayBuffer));
      showMessage(`ROM "${file.name}" carregada com sucesso.`, 'success');
    } catch (err) {
      handleError(err as Error);
    }
  });

  elements.stepBtn.addEventListener('click', stepExecution);
  elements.runBtn.addEventListener('click', startRunning);
  elements.pauseBtn.addEventListener('click', pauseExecution);
  elements.resetBtn.addEventListener('click', resetExecution);
}

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (!cpu) return;

    switch (e.key) {
      case 'F1':
        resetExecution();
        break;
      case 'F5':
        startRunning();
        break;
      case 'F6':
        pauseExecution();
        break;
      case 'F8':
        stepExecution();
        break;
      case ' ':
        running ? pauseExecution() : startRunning();
        break;
    }
  });
}

// ===================== Boot / Attach ROM =====================

async function bootWithRomBytes(romBytes: Uint8Array) {
  try {
    const loader = new RomLoader(romBytes);

    if (loader.header.mapper !== 0 && loader.header.mapper !== 4) {
      throw new Error(`Mapper não suportado: ${loader.header.mapper}`);
    }

    // Seleciona o mirroring inicial com base no header
    const mirroring = loader.header.fourScreen
      ? Mirroring.FourScreen
      : loader.header.verticalMirroring
      ? Mirroring.Vertical
      : Mirroring.Horizontal;

    const memory = new Memory();
    memoryRef = memory;

    if (loader.header.mapper === 0) {
      memory.attachMapper(new Mapper0(loader.prgRom, loader.chrRom, mirroring));
    } else if (loader.header.mapper === 4) {
      memory.attachMapper(new Mapper4(loader.prgRom, loader.chrRom, mirroring));
    }

    cpu = new Cpu6502(memory);
    ppu = memory.getPpu();

    // Vetores obrigatórios (para ROMs sintéticas)
    ensureVectors(memory);

    cpu.reset();
    ppu.reset();

    updateUI();
    enableControls(true);
    clearScreen();
    showMessage('Pronto.', 'success');
  } catch (err) {
    handleError(err as Error);
  }
}

/** Garante que os vetores de NMI/RESET/IRQ tenham algum valor útil quando ausentes. */
function ensureVectors(memory: Memory) {
  const read = (a: number) => memory.read(a) & 0xff;
  const vec = (lo: number, hi: number) => ((read(hi) << 8) | read(lo)) & 0xffff;

  const reset = vec(0xfffc, 0xfffd);
  if (reset === 0x0000) {
    // fallback para $8000
    memory.write(0xfffc, 0x00);
    memory.write(0xfffd, 0x80);
  }

  const nmi = vec(0xfffa, 0xfffb);
  if (nmi === 0x0000) {
    // aponta para um RTI seguro em $8003 caso necessário
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
  }
}

/** Checa IRQ do Mapper4 (MMC3) e dispara IRQ na CPU se necessário. */
function serviceMapperIrq() {
  const mapper = memoryRef?.getMapper();
  // só chama se o mapper expuser consumeIrq()
  const m4 = mapper && (mapper as any).consumeIrq ? (mapper as any) : null;
  if (m4 && cpu && m4.consumeIrq()) {
    cpu.irq?.();
  }
}

function stepExecution() {
  if (!cpu || !ppu || running) return;

  try {
    cpu.step(); // executa uma instrução (sem contagem de ciclos)
    ppuStepMany(PPU_STEPS_PER_CPU_STEP * 4); // avança a PPU um pouco para “andar” o quadro
    serviceMapperIrq(); // verifica IRQ do MMC3
    renderFrame();
    updateUI();
    showMessage('Step executado.', 'info');
  } catch (err) {
    handleError(err as Error);
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
      // instruções por frame (limitadas para não travar a UI)
      const budget = Math.min(CPU_STEPS_PER_FRAME, MAX_STEPS_PER_FRAME);
      for (let i = 0; i < budget; i++) {
        cpu.step();
        ppuStepMany(PPU_STEPS_PER_CPU_STEP);
        serviceMapperIrq(); // checa a cada micro passo p/ timing melhor
      }

      renderFrame();
      updateUI();

      // FPS
      frameCount++;
      if (now - lastFpsUpdate >= 1000) {
        fps = frameCount;
        frameCount = 0;
        lastFpsUpdate = now;
        updateFpsCounter();
      }

      animationFrameId = requestAnimationFrame(runFrame);
    } catch (err) {
      handleError(err as Error);
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

  elements.regA.textContent = `$${hx(cpu.A, 2)}`;
  elements.regX.textContent = `$${hx(cpu.X, 2)}`;
  elements.regY.textContent = `$${hx(cpu.Y, 2)}`;
  elements.regSP.textContent = `$${hx(cpu.SP, 2)}`;
  elements.regPC.textContent = `$${hx(cpu.PC, 4)}`;
  elements.regP.innerHTML = formatFlags(cpu.P);
}

function updateDisassembly() {
  if (!cpu || !elements.disassembly) return;

  let html = '';
  const startAddr = Math.max(0, cpu.PC - 5);
  const endAddr = Math.min(0xffff, cpu.PC + 5);

  for (let addr = startAddr; addr <= endAddr; addr++) {
    const opcode = cpu.read(addr);
    const instruction = disassemble6502(opcode, addr, cpu);
    const isCurrent = addr === cpu.PC;

    html += `<div class="${isCurrent ? 'current' : ''}">
      $${addr.toString(16).padStart(4, '0')}: ${instruction}
    </div>`;
  }

  elements.disassembly.innerHTML = html;

  const currentLine = elements.disassembly.querySelector('.current');
  if (currentLine) {
    currentLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

function updateFpsCounter() {
  if (elements.fpsCounter) {
    elements.fpsCounter.textContent = `FPS: ${fps}`;
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
  if (ppuRenderer) {
    ppuRenderer.clear();
  }
}

function clearUI() {
  elements.regA.textContent = '--';
  elements.regX.textContent = '--';
  elements.regY.textContent = '--';
  elements.regSP.textContent = '--';
  elements.regPC.textContent = '--';
  elements.regP.textContent = 'NVUBDIZC';
  elements.disassembly.innerHTML = '';
  if (elements.fpsCounter) elements.fpsCounter.textContent = 'FPS: 0';
}

/** Mostra mensagem no painel e alterna classes de status (info/success/error). */
function showMessage(message: string, kind: 'info' | 'success' | 'error' = 'info') {
  elements.output.textContent = message;
  elements.output.classList.remove('success', 'error');
  if (kind === 'success') elements.output.classList.add('success');
  if (kind === 'error') elements.output.classList.add('error');
}

function enableControls(_enabled = false) {
  const hasCpu = !!cpu;
  elements.stepBtn.disabled = !hasCpu || running;
  elements.runBtn.disabled = !hasCpu || running;
  elements.pauseBtn.disabled = !hasCpu || !running;
  elements.resetBtn.disabled = !hasCpu;
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
