# 🎮 NES Emulator (Nintendo Entertainment System) — Emulador em TypeScript

Este é um **emulador de NES** (Nintendinho) escrito em **TypeScript**, com **Vite** para desenvolvimento rápido e interface em **HTML5 Canvas**.  
O objetivo é recriar fielmente o comportamento do console original de 8 bits da Nintendo, permitindo carregar e executar ROMs no formato **iNES** diretamente no navegador.

---

## 📸 Preview
![NES Emulator](https://upload.wikimedia.org/wikipedia/commons/5/5d/NES-Console-Set.jpg)
> *Interface atual: permite carregar ROMs `.nes`, visualizar registradores, estado da CPU e disassembly em tempo real.*

---

## 🛠️ Tecnologias Utilizadas
- **TypeScript** — linguagem principal
- **Vite** — build e hot reload rápido
- **HTML5 Canvas API** — renderização gráfica da PPU
- **Vitest** — testes unitários
- **CSS** — interface minimalista estilo debug
- **Arquitetura modular** — separação clara de CPU, PPU, memória e mappers

---

## 📜 Contexto Histórico — O Nintendinho (NES)
O **Nintendo Entertainment System** foi lançado no Japão em **1983** como **Famicom** e chegou ao ocidente em **1985**.  
Foi o console que **revitalizou a indústria dos videogames** após a crise de 1983, com títulos icônicos como:
- **Super Mario Bros.**
- **The Legend of Zelda**
- **Metroid**
- **Castlevania**

⚙️ Especificações originais (NTSC):
- **CPU**: Ricoh 2A03 (MOS 6502 customizado) — ~1.79 MHz
- **Memória**: 2 KB RAM + expansões via cartucho
- **PPU**: 256×240 pixels, até 25 cores simultâneas na tela
- **Áudio**: 5 canais sonoros
- **Cartuchos**: PRG-ROM + CHR-ROM/CHR-RAM, com ou sem **mappers** (bank switching)

---

## 🧩 Arquitetura do NES — Componentes Principais

| Componente | Função |
|---|---|
| **CPU 6502** | Executa o código do jogo, manipula RAM e periféricos. |
| **PPU (Picture Processing Unit)** | Gera o quadro 256×240, processa tiles/sprites e paletas. |
| **APU (Audio Processing Unit)** | Produz som (não implementado aqui). |
| **RAM Principal** | 2 KB internos (espelhados em `0x0000–0x1FFF`). |
| **Mappers** | Circuitos no cartucho que trocam bancos de PRG/CHR e, às vezes, geram IRQs. |
| **PRG-ROM** | Código do jogo. |
| **CHR-ROM/CHR-RAM** | Gráficos 2bpp de tiles/sprites. |

---

## ✅ Implementação Atual (resumo)
- **Carregamento de ROMs iNES/NES 2.0** com parsing de cabeçalho e *trainer* (quando houver).
- **Mappers suportados**: **0 (NROM)**, **1 (MMC1)**, **2 (UxROM)**, **4 (MMC3)** com IRQ por A12.
- **CPU 6502** completa o bastante para jogos e testes (ALU, stack, branches, JSR/RTS/RTI, NOPs, ilegais comuns, IRQ/NMI).
- **PPU**:
  - Registradores `$2000–$2007` (PPUCTRL/PPUMASK/PPUSTATUS, OAMADDR/OAMDATA, PPUSCROLL/PPUADDR/PPUDATA)
  - VRAM/CHR e **nametables com mirroring** (Horizontal/Vertical/FourScreen)
  - **VBlank/NMI**, **OAM DMA ($4014)**, **sprite 0 hit**, **render de BG e sprites (8×8/8×16)**  
  - **Scroll real (loopy v/t/x/w)**, cópias horizontais/verticais simplificadas
  - **Borda A12 sintetizada por scanline** p/ IRQ do MMC3
- **Renderer (Canvas 2D)** com paleta NES (64 cores) e composição BG/Sprites.

---

## 🗂️ O que cada arquivo faz (guia rápido)

> Dica: caminhos com `__tests__` são testes de unidade (Vitest).

### Núcleo de Execução
- `src/main.ts` — **Entrada do app**. Carrega ROM, instancia `Memory`, `Cpu6502`, `Ppu` e `Renderer`. Usa `MapperFactory` para criar o mapper (0/1/2/4). Loop de execução (step/run/pause/reset), coleta FPS, renderiza frame, trata **NMI** e **IRQ do MMC3**, conecta o **InputHandler** (teclado → controle).
- `src/vite-env.d.ts` — Tipos de suporte do Vite.
- `src/counter.ts` — Snippet de exemplo do Vite (não faz parte do emulador).

### CPU
- `src/cpu/Cpu6502.ts` — Emulação do **MOS 6502**: registradores/flags, modos de endereçamento, ALU (ADC/SBC/AND/ORA/EOR/BIT…), shifts/rotates, branches, JSR/RTS/RTI/BRK, NMI/IRQ, NOPs “ilegais” e KIL/JAM (erro).
- `src/cpu/Disassembler.ts` — **Disassembler** do 6502; tabela de opcodes e formatação.
- `src/cpu/Flags6502.ts` — Enum dos bits de flag (**C Z I D B U V N**).
- `src/cpu/tests/Cpu6502.test.ts` — Testes da CPU (instruções, pilha, flags, subrotinas, resets, etc.).

### Memória e I/O
- `src/memory/Memory.ts` — **Barramento da CPU**: RAM 2 KB + espelhos, PPU registers, DMA `$4014`, controles `$4016/$4017`, delegação ao mapper (PRG/CHR). Expõe `getPpu()` e controladores para a UI.
- `src/memory/__tests__/Dma4014.test.ts` — Testa **OAM DMA `$4014`** → copia 256 bytes para OAM (páginas `0x00`, `0x02`, `0xFF`).
- `src/memory/__tests__/Memory.test.ts` — Testa RAM e espelhamento até `0x1FFF`, leitura padrão fora da RAM e integração com **Mapper0** (vetor de reset).

### PPU e Renderização
- `src/ppu/Ppu.ts` — PPU: regs `$2000–$2007`, VRAM/CHR, **nametables com mirroring**, **paleta `$3F00–$3F1F`**, **loopy (v/t/x/w)**, **VBlank/NMI**, **A12** p/ MMC3, **OAM DMA**.
- `src/ppu/PpuRegisters.ts` — Estrutura dos registradores e estado interno (loopy).
- `src/ppu/Renderer.ts` — **Canvas 2D**: desenha background (tiles + attributes), sprites (8×8/8×16), prioridade BG/sprite, **sprite 0 hit**, paleta NES.
- `src/ppu/types.ts` — Tipos e **paleta NES** (RGB e RGBA empacotada).
- `src/ppu/__tests__/Ppu.test.ts` — Testa PPUCTRL (NMI), VBlank e efeitos da leitura de PPUSTATUS.
- `src/ppu/__tests__/PpuA12IrqHook.test.ts` — Integração **PPU + Mapper4**: borda A12 sintetizada arma IRQ por scanline.
- `src/ppu/__tests__/Sprite0Hit.test.ts` — Regras de **sprite 0 hit** + clipping dos 8 px à esquerda.

### Mappers
- `src/mappers/Mapper.ts` — **Interface** comum (API CPU/PPU, mirroring e `reset()`).
- `src/mappers/Mirroring.ts` — Enum de mirroring (**Horizontal/Vertical/FourScreen**).
- `src/mappers/Mapper0.ts` — **NROM**: sem banking. PRG 16/32 KB, CHR-ROM/RAM, mirroring fixo. PRG‑RAM em `$6000–$7FFF`.
- `src/mappers/Mapper2.ts` — **UxROM**: janela `$8000–$BFFF` (16 KB) selecionável + `$C000–$FFFF` fixo (último banco). CHR fixa. PRG‑RAM em `$6000–$7FFF`.
- `src/mappers/Mapper4.ts` — **MMC3**: registradores `$8000/$8001` (PRG/CHR banking 8 KB/1 KB), `$A000` mirroring, `$A001` PRG‑RAM ctrl, **IRQ por A12** com latch/reload/enable/ack.
- `src/mappers/Mapper1.ts` — **MMC1**: shift‑register (5 bits) aplicando writes a cada 5º write. **Control** (mirroring/PRG/CHR mode), **CHR banking 4 KB/8 KB**, **PRG banking 16 KB/32 KB**, **PRG‑RAM enable/protect**.
- `src/mappers/MapperFactory.ts` — Fábrica: cria mappers **0, 1, 2, 4** com PRG/CHR e mirroring do header.
- `src/mappers/__tests__/Mapper1Banking.test.ts` — Testes de **banking PRG/CHR** do MMC1.
- `src/mappers/__tests__/Mapper1PrgRam.test.ts` — Testes de **PRG‑RAM** do MMC1 (enable/disable, write‑protect).
- `src/mappers/__tests__/Mapper4Banking.test.ts` — Testes de **mapeamento PRG/CHR** (PRG/CHR modes, mirroring A000).
- `src/mappers/__tests__/Mapper4Irq.test.ts` — Testes de **IRQ do MMC3** via bordas A12 (latch/reload/enable/ack).

### ROM
- `src/rom/RomHeader.ts` — Parser iNES/NES 2.0 (tamanhos PRG/CHR, mapper, *trainer*, mirroring, offsets).
- `src/rom/RomLoader.ts` — Carregador: fatia PRG/CHR considerando *trainer*; valida truncamentos; helpers `fromFile()`/`fromUrl()`.
- `src/rom/TestRomBuilder.ts` — Constrói ROM iNES mínima (**Mapper0**) com programa de teste e vetor de reset.
- `src/rom/__tests__/RomLoader.test.ts` — Testes do loader (com/sem trainer, mapper, cabeçalho inválido, truncamentos).

### UI / Input
- `src/ui/InputHandler.ts` — **Teclado → Controle 1** (Up/Down/Left/Right, Select, Start, A, B); strobe/shift `$4016/$4017`; limpa entradas ao perder foco.

---

## 🚀 Executando o Projeto

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento (Vite + HMR)
npm run dev

# Build para produção
npm run build
```

Abra no navegador: **http://localhost:5173**

---

## 🎮 Controles (teclado → Controle 1)
- **Setas**: D‑Pad (↑ ↓ ← →)
- **A**: `KeyA`
- **B**: `KeyZ`
- **Select**: `Space`
- **Start**: `Enter`

---

## 🧪 Testes (Vitest) — usando `npx`

> Você pode rodar os testes sem scripts do `package.json`, chamando o Vitest direto via `npx`.

### Rodar **todos os testes**
```bash
npx vitest run
```

### Rodar **um arquivo de teste específico**
```bash
# Exemplo: executar apenas o teste do MMC3 IRQ
npx vitest run src/ppu/__tests__/PpuA12IrqHook.test.ts

# Dica: você também pode filtrar por nome de teste/suite
npx vitest run -t "IRQ por A12"
```

### Rodar **todos os testes com cobertura**
```bash
npx vitest run --coverage
```

> Observação: se você preferir modo *watch* durante o desenvolvimento, use apenas `npx vitest` (sem `run`).

---

## 📂 Estrutura do Projeto (alto nível)
```
src/
 ├── cpu/         # Emulação da CPU 6502
 ├── memory/      # Barramento + DMA + controles
 ├── mappers/     # Mapper0/1/2/4 + fábrica
 ├── ppu/         # PPU + Renderer (Canvas 2D)
 ├── rom/         # Loader e parsing iNES/NES 2.0
 ├── ui/          # InputHandler (teclado → controle)
 └── main.ts      # Loop principal + UI
```

---

## 📜 Licença
Projeto para fins **educacionais**.  
Nintendo, NES e seus jogos são propriedade da Nintendo Co., Ltd.

---

## 💡 Créditos
- [NesDev Wiki](https://www.nesdev.org/wiki/Nesdev_Wiki)
- Documentação da CPU MOS 6502
- Emuladores open-source e artigos técnicos da comunidade
