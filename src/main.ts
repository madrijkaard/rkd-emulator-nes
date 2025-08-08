import { RomLoader } from './rom/RomLoader';
import { Memory } from './memory/Memory';
import { Cpu6502 } from './cpu/Cpu6502';
import { Mapper0 } from './mappers/Mapper0';
import { Mapper4 } from './mappers/Mapper4';
import { buildTestRom } from './rom/TestRomBuilder';
import { disassemble6502 } from './cpu/Disassembler';
import { Flags6502 } from './cpu/Flags6502';
import { Renderer } from './ppu/Renderer';

// Configuração
const ENABLE_TEST_ROM = false;
const FRAME_CYCLES = 29780; // Ciclos por frame NTSC
const MAX_STEPS_PER_FRAME = 1000;

// Estado do emulador
let cpu: Cpu6502 | null = null;
let ppuRenderer: Renderer | null = null;
let running = false;
let animationFrameId: number | null = null;
let lastFrameTime = 0;
let cycleCount = 0;

// Elementos UI
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
    disassembly: document.getElementById('disassembly') as HTMLDivElement
};

function init() {
    setupEventListeners();
    setupKeyboardShortcuts();
    clearScreen();
    updateUI();
    ppuRenderer = new Renderer(elements.canvas);
}

function setupEventListeners() {
    elements.romInput.addEventListener('change', async () => {
        const file = elements.romInput.files?.[0];
        if (!file) return;
        
        try {
            showMessage('Carregando ROM...');
            const arrayBuffer = await file.arrayBuffer();
            await bootWithRomBytes(new Uint8Array(arrayBuffer));
            showMessage(`ROM "${file.name}" carregada com sucesso`);
        } catch (err) {
            handleError(err as Error);
        }
    });

    elements.stepBtn.addEventListener('click', stepExecution);
    elements.runBtn.addEventListener('click', startRunning);
    elements.pauseBtn.addEventListener('click', pauseExecution);
    elements.resetBtn.addEventListener('click', resetExecution);

    if (ENABLE_TEST_ROM) {
        bootWithRomBytes(buildTestRom()).catch(handleError);
    }
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (!cpu) return;
        
        switch(e.key) {
            case 'F1': resetExecution(); break;
            case 'F5': startRunning(); break;
            case 'F6': pauseExecution(); break;
            case 'F8': stepExecution(); break;
        }
    });
}

async function bootWithRomBytes(romBytes: Uint8Array) {
    try {
        const loader = new RomLoader(romBytes);
        
        if (loader.header.mapper !== 0 && loader.header.mapper !== 4) {
            throw new Error(`Mapper não suportado: ${loader.header.mapper}`);
        }

        const memory = new Memory();
        
        if (loader.header.mapper === 0) {
            memory.attachMapper(new Mapper0(loader.prgRom, loader.chrRom));
        } else if (loader.header.mapper === 4) {
            memory.attachMapper(new Mapper4(loader.prgRom, loader.chrRom));
        }

        cpu = new Cpu6502(memory);
        cpu.reset();
        
        updateUI();
        enableControls(true);
        clearScreen();
        
    } catch (err) {
        handleError(err as Error);
    }
}

function stepExecution() {
    if (!cpu || running) return;
    
    try {
        const cycles = cpu.step();
        cycleCount += cycles;
        
        // Executa a PPU (3 ciclos PPU por ciclo CPU)
        for (let i = 0; i < cycles * 3; i++) {
            cpu.memory.read(0x2002); // Acesso falso para sincronização
        }
        
        // Renderiza a cada frame completo
        if (cycleCount >= FRAME_CYCLES) {
            if (ppuRenderer) {
                ppuRenderer.renderFrame();
            }
            cycleCount = 0;
        }
        
        updateUI();
    } catch (err) {
        handleError(err as Error);
    }
}

function startRunning() {
    if (running || !cpu) return;
    
    running = true;
    lastFrameTime = performance.now();
    cycleCount = 0;
    enableControls();
    
    function runFrame(currentTime: number) {
        if (!running || !cpu) return;
        
        try {
            const deltaTime = currentTime - lastFrameTime;
            lastFrameTime = currentTime;
            
            const targetCycles = Math.floor((deltaTime / 1000) * 1789773); // ~1.79MHz
            let executedCycles = 0;
            
            while (executedCycles < targetCycles && executedCycles < MAX_STEPS_PER_FRAME) {
                const cycles = cpu.step();
                executedCycles += cycles;
                cycleCount += cycles;
                
                // Executa a PPU
                for (let i = 0; i < cycles * 3; i++) {
                    cpu.memory.read(0x2002); // Acesso falso
                }
                
                if (cycleCount >= FRAME_CYCLES) {
                    if (ppuRenderer) {
                        ppuRenderer.renderFrame();
                    }
                    cycleCount = 0;
                    break;
                }
            }
            
            updateUI();
            animationFrameId = requestAnimationFrame(runFrame);
        } catch (err) {
            handleError(err as Error);
            pauseExecution();
        }
    }
    
    animationFrameId = requestAnimationFrame(runFrame);
}

function pauseExecution() {
    running = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    enableControls();
}

function resetExecution() {
    if (!cpu) return;
    
    pauseExecution();
    cpu.reset();
    cycleCount = 0;
    updateUI();
    clearScreen();
}

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
    const endAddr = Math.min(0xFFFF, cpu.PC + 5);

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
    
    return flags.map(f => {
        const set = (p & f.bit) !== 0;
        return `<span class="flag-${set ? 'on' : 'off'}" title="${f.label}">${f.label}</span>`;
    }).join('');
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
}

function enableControls(enabled = false) {
    const hasCpu = !!cpu;
    elements.stepBtn.disabled = !hasCpu || running;
    elements.runBtn.disabled = !hasCpu || running;
    elements.pauseBtn.disabled = !hasCpu || !running;
    elements.resetBtn.disabled = !hasCpu;
}

function showMessage(message: string) {
    elements.output.textContent = message;
}

function handleError(err: Error) {
    console.error(err);
    showMessage(`Erro: ${err.message}`);
    pauseExecution();
}

// Inicialização
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}