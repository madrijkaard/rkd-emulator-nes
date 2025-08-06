import { RomLoader } from './rom/RomLoader'

const input = document.getElementById('romInput') as HTMLInputElement
const output = document.getElementById('output') as HTMLDivElement

input.addEventListener('change', async () => {
  const file = input.files?.[0]
  if (!file) {
    output.textContent = 'Nenhum arquivo escolhido'
    return
  }

  try {
    const loader = await RomLoader.fromFile(file)

    output.textContent = `
ROM carregada com sucesso:
PRG ROM: ${loader.header.prgRomSize} bytes
CHR ROM: ${loader.header.chrRomSize} bytes
Flags 6: ${loader.header.flags6.toString(2).padStart(8, '0')}
Flags 7: ${loader.header.flags7.toString(2).padStart(8, '0')}
    `.trim()
  } catch (err) {
    console.error('Erro ao carregar ROM:', err)
    output.textContent = `Erro: ${(err as Error).message}`
  }
})
