import { RomLoader } from './rom/RomLoader'
import { Memory } from './memory/Memory'
import { Cpu6502 } from './cpu/Cpu6502'
import { Mapper0 } from './mappers/Mapper0'
import { buildTestRom } from './rom/TestRomBuilder'

const ENABLE_TEST_ROM = false  // deixe true para verificar rapidamente

function init() {
  const input = document.getElementById('romInput') as HTMLInputElement
  const stepBtn = document.getElementById('stepBtn') as HTMLButtonElement
  const output = document.getElementById('output') as HTMLDivElement

  let cpu: Cpu6502 | null = null

  async function bootWithRomBytes(romBytes: Uint8Array) {
    console.log('[BOOT] Iniciando bootWithRomBytes...')
    const loader = new RomLoader(romBytes)

    const mapperId = loader.header.mapper
    const mapperName =
      mapperId === 0 ? 'Mapper 0 (NROM)' :
      mapperId === 4 ? 'Mapper 4 (MMC3)' :
      `Mapper ${mapperId}`

    if (mapperId !== 0) {
      output.textContent = [
        'ROM carregada, mas este mapper não é suportado ainda.',
        `Detectado: ${mapperName}`,
        mapperId === 4
          ? 'Ex.: Super Mario Bros. 3 usa MMC3 (troca de bancos PRG/CHR + IRQ de scanline).'
          : 'Por enquanto apenas NROM (Mapper 0) é suportado.'
      ].join('\n')
      stepBtn.disabled = true
      clearDebug()
      cpu = null
      return
    }

    const memory = new Memory()
    memory.attachMapper(new Mapper0(loader.prgRom, loader.chrRom))

    cpu = new Cpu6502(memory)
    cpu.reset()
    updateDebug(cpu)

    output.textContent = `
ROM carregada com sucesso:
PRG ROM: ${loader.header.prgRomSize} bytes
CHR ROM: ${loader.header.chrRomSize} bytes
Flags 6: ${loader.header.flags6.toString(2).padStart(8, '0')}
Flags 7: ${loader.header.flags7.toString(2).padStart(8, '0')}
Mapper: ${mapperName}
PC Inicial: $${cpu.PC.toString(16).padStart(4, '0')}
`.trim()

    stepBtn.disabled = false
    console.log('[BOOT] Pronto. Step habilitado.')
  }

  async function bootWithFile(file: File) {
    try {
      const arrayBuffer = await file.arrayBuffer()
      await bootWithRomBytes(new Uint8Array(arrayBuffer))
    } catch (err) {
      console.error('Erro ao carregar ROM:', err)
      output.textContent = `Erro: ${(err as Error).message}`
      stepBtn.disabled = true
      clearDebug()
      cpu = null
    }
  }

  // Auto-boot ROM de teste
  ;(async () => {
    try {
      if (ENABLE_TEST_ROM) {
        console.log('[BOOT] Criando ROM de teste…')
        const rom = buildTestRom()
        await bootWithRomBytes(rom)
      } else {
        output.textContent = 'Nenhum arquivo escolhido'
      }
    } catch (e) {
      console.error(e)
      output.textContent = `Erro ao inicializar ROM de teste: ${(e as Error).message}`
    }
  })()

  // Upload manual
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) {
      output.textContent = 'Nenhum arquivo escolhido'
      stepBtn.disabled = true
      clearDebug()
      cpu = null
      return
    }
    await bootWithFile(file)
  })

  stepBtn.addEventListener('click', () => {
    if (!cpu) return
    try {
      cpu.step()
      updateDebug(cpu)
      output.textContent += `\nInstrução executada. Novo PC: $${cpu.PC.toString(16).padStart(4, '0')}`
    } catch (err) {
      output.textContent += `\nErro durante execução: ${(err as Error).message}`
      stepBtn.disabled = true
    }
  })

  function updateDebug(cpu: Cpu6502) {
    const setText = (id: string, text: string) => {
      const el = document.getElementById(id)
      if (el) el.textContent = text
    }
    const setHtml = (id: string, html: string) => {
      const el = document.getElementById(id)
      if (el) el.innerHTML = html
    }
    const hx = (v: number, w: number) => v.toString(16).toUpperCase().padStart(w, '0')

    setText('regA', `$${hx(cpu.A, 2)}`)
    setText('regX', `$${hx(cpu.X, 2)}`)
    setText('regY', `$${hx(cpu.Y, 2)}`)
    setText('regSP', `$${hx(cpu.SP, 2)}`)
    setText('regPC', `$${hx(cpu.PC, 4)}`)
    setHtml('regP', formatFlagsHtml(cpu.P))
  }

  function clearDebug() {
    const blanks: Record<string, string> = {
      regA: '--', regX: '--', regY: '--', regSP: '--', regPC: '--', regP: '--------'
    }
    Object.entries(blanks).forEach(([id, val]) => {
      const el = document.getElementById(id)
      if (!el) return
      el.textContent = val
    })
  }

  function formatFlagsHtml(p: number): string {
    type FlagDef = { bit: number; label: string; title: string }
    const defs: FlagDef[] = [
      { bit: 7, label: 'N', title: 'Negative' },
      { bit: 6, label: 'V', title: 'Overflow' },
      { bit: 5, label: 'U', title: 'Unused' },
      { bit: 4, label: 'B', title: 'Break' },
      { bit: 3, label: 'D', title: 'Decimal (unused no NES)' },
      { bit: 2, label: 'I', title: 'Interrupt Disable' },
      { bit: 1, label: 'Z', title: 'Zero' },
      { bit: 0, label: 'C', title: 'Carry' },
    ]
    return defs.map(def => {
      const on = ((p >> def.bit) & 1) !== 0
      const base = 'display:inline-block;margin-right:2px;padding:0 3px;border-radius:4px;font-weight:600;'
      const styleOn = 'color:#0f0;background:#214d21;border:1px solid #2e7d32;'
      const styleOff = 'color:#9aa0a6;background:#222;border:1px solid #333;opacity:0.7;'
      return `<span title="${def.title}" style="${base + (on ? styleOn : styleOff)}">${def.label}</span>`
    }).join('')
  }
}

// ✅ roda já se o DOM estiver pronto; caso contrário, espera o evento
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init)
} else {
  init()
}
