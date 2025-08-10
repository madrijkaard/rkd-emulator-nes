# 🎮 NES Emulator (Nintendo Entertainment System) — Emulador em TypeScript

Este é um **emulador de NES** (Nintendinho) escrito em **TypeScript**, com **Vite** para desenvolvimento rápido e interface em **HTML5 Canvas**.  
O objetivo é recriar fielmente o comportamento do console original de 8 bits da Nintendo, permitindo carregar e executar ROMs no formato **iNES** diretamente no navegador.

---

## 📸 Preview
![NES Emulator](https://upload.wikimedia.org/wikipedia/commons/5/5d/NES-Console-Set.jpg)
> *Interface atual: permite carregar ROMs `.nes`, visualizar registradores, estado da CPU e disassembly em tempo real.*

---

## 🛠️ Tecnologias Utilizadas
- **TypeScript** — Linguagem principal
- **Vite** — Build e hot reload
- **HTML5 Canvas API** — Renderização gráfica (PPU)
- **Vitest** — Testes unitários
- **CSS** — UI simples de debug
- **Arquitetura modular** — CPU, PPU, memória e mappers separados

---

## 📜 Contexto Rápido — O NES
O **Nintendo Entertainment System** (1983/1985) popularizou os videogames domésticos com clássicos como **Super Mario Bros.**, **Zelda** e **Metroid**.

**Especificações chave**
- **CPU**: Ricoh 2A03 (MOS 6502 custom) — ~1.79 MHz (NTSC)
- **PPU**: 256×240 px, tiles/sprites, paletas
- **RAM**: 2 KB internos (+ expansão no cartucho)
- **Cartuchos**: PRG-ROM (código) e CHR-ROM/RAM (gráficos) + **mappers** (bank switching)

---

## 🧩 Arquitetura do Projeto (alto nível)

| Componente | Papel |
|---|---|
| **CPU 6502** | Executa o código do jogo (PRG), manipula memória e I/O. |
| **PPU** | Gera a imagem: BG, sprites, paletas, scroll, VBlank/NMI. |
| **Memory** | Barramento da CPU (RAM, registradores PPU/APU/DMA/controles, mapper). |
| **Mapper (cartucho)** | Troca de bancos PRG/CHR, controle de mirroring, IRQs (ex.: MMC3). |
| **ROM Loader** | Lê cabeçalho iNES / NES 2.0 e fatia PRG/CHR (+ trainer). |
| **UI/Renderer** | Canvas 2D, teclado→controle, HUD de debug (regs/disassembly/FPS). |

---

## ✅ Implementação Atual (resumo)

- **Carregamento iNES/NES 2.0** (PRG/CHR, trainer opcional, mapper id, mirroring)
- **Mappers suportados**: **0 (NROM)**, **1 (MMC1)**, **2 (UxROM)**, **4 (MMC3)**
  - MMC3 com **IRQ por scanline (A12)** sintetizado, PRG/CHR banking e mirroring runtime
- **CPU 6502**: registradores/flags, stack, interrupções (RESET/NMI/IRQ), modos de endereçamento, ALU, branches, JSR/RTS/RTI/BRK, NOPs comuns e opcodes “ilegais” selecionados
- **PPU**: registradores `$2000–$2007`, VRAM/CHR, nametables com **mirroring**, paletas com espelhos, **loopy (v/t/x/w)**, **VBlank/NMI**, **sprite 0 hit**, **OAM DMA ($4014)** e **scanline hook** para MMC3
- **Renderer**: BG + sprites (8×8/8×16), prioridade, clipping inicial de 8 px, paleta NTSC
- **UI**: carregar ROM, **Step / Run / Pause / Reset**, FPS, disassembly ao redor do PC
- **Testes**: CPU, Memory (DMA, espelhos), PPU (VBlank, sprite0, A12), Mappers (UxROM/MMC3/MMC1)

---

## 🗂️ O que cada arquivo faz (guia rápido)

> **Observação**: caminhos com `\` aparecem assim porque foram listados a partir de um ambiente Windows. A estrutura real no repo usa `/`.

### Raiz
- **`src/counter.ts`** — *Snippet do Vite* de contador; não faz parte do emulador.
- **`src/main.ts`** — *Entrada do app web*. Carrega ROM, usa `MapperFactory` (0/1/2/4), instancia `Memory`, `Cpu6502`, `Ppu` e `Renderer`, integra teclado/controle, executa o loop de frames e trata NMI/IRQ do MMC3.

### CPU
- **`src/cpu/Cpu6502.ts`** — Implementação da CPU 6502: registradores/flags, modos de endereçamento, opcodes (oficiais + alguns ilegais), interrupções, `step()` e `read()` para o disassembler.
- **`src/cpu/Disassembler.ts`** — Tabela de opcodes/modes e função `disassemble6502()` (formata operandos e instrução para debug).
- **`src/cpu/Flags6502.ts`** — Enum dos bits de flag (C,Z,I,D,B,U,V,N).
- **`src/cpu/tests/Cpu6502.test.ts`** — Testes unitários da CPU (loads/lógicas/stack/JSR/RTS/flags/etc.).

### I/O (controles)
- **`src/io/Controller.ts`** — Controle do NES (A, B, Select, Start, Up, Down, Left, Right) com protocolo `$4016/$4017` (strobe/latch/shift).

### Memory (barramento)
- **`src/memory/Memory.ts`** — RAM 2 KB + espelhos; registradores da PPU; **DMA $4014**; leitura/escrita dos controles; delega PRG/CHR ao **mapper**; `reset()` e helpers para simular input.
- **`src/memory_tests_/Dma4014.test.ts`** — Garante que o DMA copia **256 bytes** para a OAM (inclui páginas `0x00` e `0xFF`).
- **`src/memory_tests_/Memory.test.ts`** — RAM + espelhamento até `0x1FFF`, leitura default fora da RAM, integração com `Mapper0` e vetor de reset.

### PPU
- **`src/ppu/Ppu.ts`** — PPU com registradores, VRAM/CHR, nametables (mirroring), paletas (espelhos e casos `$3F10` etc.), **loopy v/t/x/w**, VBlank/NMI, **OAM DMA**, e **borda A12 por scanline** para IRQ do MMC3.
- **`src/ppu/PpuRegisters.ts`** — Estrutura dos regs e do estado loopy.
- **`src/ppu/Renderer.ts`** — Renderização 2D: BG + sprites, prioridade, paletas, **sprite 0 hit** e clipping de 8 px.
- **`src/ppu/types.ts`** — Paleta NTSC (64 cores) em RGB e **RGBA empacotado**.
- **`src/ppu_tests_/Ppu.test.ts`** — PPUCTRL/NMI, VBlank e efeitos da leitura de PPUSTATUS (limpa VBlank e toggle).
- **`src/ppu_tests_/PpuA12IrqHook.test.ts`** — Integração PPU+MMC3: a borda A12 sintetizada arma IRQ por **scanline** (BG ON).
- **`src/ppu_tests_/Sprite0Hit.test.ts`** — Regras de **sprite 0 hit**, clipping da esquerda e limpeza na pre-render; usa canvas fake + `Renderer`.

### Mappers (cartuchos)
- **`src/mappers/Mapper.ts`** — Interface base (CPU/PPU read/write, `getMirroring()`, `reset()`).  
- **`src/mappers/Mirroring.ts`** — Enum: `Horizontal`, `Vertical`, `FourScreen`.
- **`src/mappers/Mapper0.ts`** — **NROM** (sem bank switching). PRG 16/32 KB; PRG-RAM em `$6000–$7FFF`; CHR-ROM ou CHR-RAM; mirroring fixo.
- **`src/mappers/Mapper2.ts`** — **UxROM**. Janela `$8000–$BFFF` com banco selecionável (16 KB) e `$C000–$FFFF` fixo (último); PRG-RAM; CHR-*ROM/RAM* sem banking; mirroring do header.
- **`src/mappers/Mapper4.ts`** — **MMC3**. R0..R7 para **CHR (1 KB/2 KB)** e PRG (8 KB), `$A000` mirroring, `$A001` PRG-RAM ctrl, **IRQ por A12** (latch/reload/enable/ack) com filtro de borda.
- **`src/mappers/Mapper1.ts`** — **MMC1**. Shift register de 5 bits, **PRG banking** (16/32 KB), **CHR banking** 4/8 KB (CHR-RAM suportada), controle de mirroring e PRG-RAM enable/protect.
- **`src/mappers/MapperFactory.ts`** — Fábrica de mappers: `createMapper(id, prg, chr, mirroring)` com **0/1/2/4**.
- **`src/mappers/tests/Mapper2.test.ts`** — UxROM: layout/prg-window, seleção de bancos, PRG-RAM e CHR-RAM/ROM.
- **`src/mappers/__tests__/Mapper4Banking.test.ts`** *(ou `src\mappers_tests_\Mapper4Banking.test.ts`)* — MMC3: modos de **PRG/CHR** e `$A000` (mirroring).
- **`src/mappers/__tests__/Mapper4Irq.test.ts`** *(ou `src\mappers_tests_\Mapper4Irq.test.ts`)* — MMC3: **IRQ por A12** (latch/reload/enable/ack, ACK/disable/re-enable).
- **`src/mappers/__tests__/Mapper1Banking.test.ts`** — MMC1: PRG/CHR banking (16/32 KB, 4/8 KB) e mirroring.
- **`src/mappers/__tests__/Mapper1PrgRam.test.ts`** — MMC1: PRG-RAM enable/protect (leituras/escritas controladas).

### ROM
- **`src/rom/RomHeader.ts`** — Parser do cabeçalho **iNES/NES 2.0**: tamanhos PRG/CHR, flags (trainer, mirroring, four-screen), mapper id e offsets.
- **`src/rom/RomLoader.ts`** — Carrega a ROM completa: fatia PRG/CHR considerando trainer, valida truncamentos; `fromFile()`/`fromUrl()`.
- **`src/rom/TestRomBuilder.ts`** — ROM iNES mínima (Mapper 0) com programa simples e vetor de reset em `$8000`.
- **`src/rom_tests_/RomLoader.test.ts`** — Casos com/sem trainer, cálculo de mapper, cabeçalho inválido e truncamentos de PRG/CHR.

### UI
- **`src/ui/InputHandler.ts`** — Mapeia teclado → Controle 1 (setas, **Space=Select**, **Enter=Start**, **A=KeyA**, **B=KeyZ**), solta teclas ao perder foco/aba oculta.

---

## 🧪 Testes (Vitest)

- **CPU**: instruções, pilha, flags, JSR/RTS/RTI, ilegais selecionados
- **Memory**: RAM/espelhos, **DMA $4014**
- **PPU**: VBlank/NMI, **sprite 0 hit**, **A12 IRQ hook**
- **Mappers**: UxROM, MMC3 (**banking + IRQ**), MMC1 (**banking + PRG-RAM**)

```bash
npm run test
```

---

## 🚀 Executando

```bash
npm install
npm run dev    # Vite (http://localhost:5173)
# build
npm run build
```

Abra no navegador: **http://localhost:5173**

---

## 🗺️ Roadmap (próximos passos)

- Precisão de **timing** (CPU/PPU/APU)
- **APU** (5 canais)
- PPU: pipeline por ciclo, sprites secundários/OAM2, overflow/hit precisos
- Mais mappers populares (CNROM, MMC2/5, VRCs…)
- Save states e suporte a baterias (PRG-RAM persistente)

---

## 📜 Licença
Projeto para fins **educacionais**. Nintendo, NES e seus jogos são propriedade da Nintendo Co., Ltd.

---

## 💡 Referências
- [NesDev Wiki](https://www.nesdev.org/wiki/Nesdev_Wiki)
- Documentação MOS 6502
- Emuladores open‑source da comunidade
