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
- **Vite** — Build e hot reload rápido
- **HTML5 Canvas API** — Renderização gráfica da PPU
- **Vitest** — Testes unitários
- **CSS** — Interface minimalista estilo debug
- **Arquitetura modular** — Separação clara de CPU, PPU, memória e mapeadores

---

## 📜 Contexto Histórico — O Nintendinho (NES)
O **Nintendo Entertainment System** foi lançado em **1983** no Japão como **Famicom**, chegando aos EUA em **1985**.  
Foi o console que **revitalizou a indústria dos videogames** após a crise de 1983, com títulos icônicos como:
- **Super Mario Bros.**
- **The Legend of Zelda**
- **Metroid**
- **Castlevania**

⚙️ Especificações originais:
- **CPU**: Ricoh 2A03 (MOS 6502 customizado) — 1.79 MHz (NTSC)
- **Memória**: 2 KB RAM + expansões via cartucho
- **PPU**: 256x240 pixels, 25 cores simultâneas
- **Áudio**: 5 canais sonoros
- **Cartuchos**: PRG-ROM + CHR-ROM, com ou sem mapeadores (bank switching)

---

## 🏗️ Arquitetura do NES — Componentes Principais

| Componente | Função |
|------------|--------|
| **CPU 6502** | Processa instruções da ROM, controla lógica do jogo e interação com hardware. |
| **PPU (Picture Processing Unit)** | Gera a imagem em 256x240 pixels, processa sprites, paletas e tiles. |
| **APU (Audio Processing Unit)** | Gera áudio de 5 canais (2 pulse, 1 triangle, 1 noise, 1 DPCM). |
| **RAM Principal** | 2 KB internos, espelhados na faixa `0x0000–0x1FFF`. |
| **Mapper** | Circuito nos cartuchos para trocar bancos de memória (bank switching). |
| **CHR-ROM / CHR-RAM** | Armazena gráficos de tiles e sprites. |
| **PRG-ROM** | Contém o código do jogo (programa executável). |

---

## 📦 Implementação Atual

### ✅ Já Implementado
- **Carregamento de ROMs iNES** (com suporte a PRG-ROM e CHR-ROM)
- **Mapper 0 (NROM)** — Jogos simples sem bank switching
- **CPU 6502**:
  - Instruções básicas (LDA, LDX, TAX, INX, JMP, STA, NOP, BRK)
  - Stack (PHA, PLA, PHP, PLP)
  - Subrotinas (JSR, RTS)
  - Operações lógicas (EOR, ORA)
  - Instruções ilegais SLO
- **Memória**:
  - RAM com espelhamento
  - Acesso básico à PPU
- **PPU (parcial)**:
  - Estrutura base
  - Registros e VRAM interna
  - Sinal de VBlank
- **Interface de Debug**:
  - Registradores e flags
  - Disassembly ao redor do PC
  - Controles Step/Run/Pause/Reset
- **Testes Unitários**:
  - CPU (instruções, stack, flags, instruções ilegais)
  - Memória
  - Carregamento de ROM

---

## 🔡 Opcodes Implementados

| Opcode | Instrução | Descrição |
|--------|-----------|-----------|
| `A9` | **LDA #imediato** | Carrega valor no acumulador |
| `A2` | **LDX #imediato** | Carrega valor no registrador X |
| `AA` | **TAX** | Transfere A → X |
| `E8` | **INX** | Incrementa X |
| `4C` | **JMP absoluto** | Salta para endereço |
| `85` | **STA zeropage** | Armazena A na memória |
| `EA` | **NOP** | Não faz nada |
| `00` | **BRK** | Interrupção (não implementada) |
| `48/68` | **PHA / PLA** | Empilha / desempilha acumulador |
| `08/28` | **PHP / PLP** | Empilha / restaura flags |
| `20/60` | **JSR / RTS** | Chama / retorna de subrotina |
| `C0` | **CPY #imediato** | Compara Y com valor |
| `45` | **EOR zeropage** | XOR entre A e memória |
| `09/05/0D` | **ORA** | OR entre A e memória (vários modos) |
| `07/0F/03` | **SLO** | ASL + ORA (ilegal) |

---

## 🚧 O que Falta para 100% de Emulação

- **Mapper 4 (MMC3)**: Necessário para jogos como *Super Mario Bros. 3*
  - Bank switching de PRG/CHR
  - IRQ baseado em scanline (PPU A12)
- **Todos os opcodes do 6502** (oficiais e ilegais)
- **PPU completa**:
  - Renderização de background e sprites
  - Scroll horizontal/vertical
  - Paletas e atributos de cores
  - Sincronização precisa com a CPU
- **APU**:
  - Emulação de som de 5 canais
- **Controle de entrada** (gamepads)
- **Ciclos precisos**:
  - Sincronização de CPU, PPU e APU
- **Suporte a outros mappers**: MMC1, UxROM, CNROM, etc.

---

## 📂 Estrutura do Projeto
```
src/
 ├── cpu/         # Emulação da CPU 6502
 ├── memory/      # Memória principal + interface com mappers
 ├── mappers/     # Implementações de mapeadores (Mapper0, Mapper4 stub)
 ├── ppu/         # Estrutura e renderização PPU
 ├── rom/         # Carregamento e parsing de ROMs iNES
 └── main.ts      # Loop principal + UI
```

---

## 🚀 Executando o Projeto

```bash
# Instalar dependências
npm install

# Rodar em modo desenvolvimento
npm run dev

# Rodar testes
npm run test

# Build para produção
npm run build
```

Acesse no navegador: **http://localhost:5173**

---

## 📜 Licença
Este projeto é para fins **educacionais**.  
Nintendo, NES e seus jogos são propriedade da Nintendo Co., Ltd.

---

## 💡 Créditos
Inspirado por documentação oficial e não-oficial:
- [NesDev Wiki](https://www.nesdev.org/wiki/Nesdev_Wiki)
- Documentação da CPU MOS 6502
- Referências de outros emuladores open-source
