export class Renderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private buffer: ImageData;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.buffer = this.ctx.createImageData(256, 240);
    }

    renderFrame(ppu: Ppu): void {
        // Renderização simplificada - apenas mostra tiles básicos
        for (let y = 0; y < 240; y++) {
            for (let x = 0; x < 256; x++) {
                const tileX = Math.floor(x / 8);
                const tileY = Math.floor(y / 8);
                const tileIndex = tileY * 32 + tileX;
                const color = ppu.vram[tileIndex] % 64; // Cores básicas
                
                this.setPixel(x, y, color);
            }
        }
        
        this.ctx.putImageData(this.buffer, 0, 0);
    }

    private setPixel(x: number, y: number, color: number): void {
        const index = (y * 256 + x) * 4;
        const rgb = this.getColorFromPalette(color);
        
        this.buffer.data[index] = rgb.r;
        this.buffer.data[index + 1] = rgb.g;
        this.buffer.data[index + 2] = rgb.b;
        this.buffer.data[index + 3] = 255;
    }

    private getColorFromPalette(index: number): { r: number; g: number; b: number } {
        // Implementação simplificada - paleta básica NES
        const nesColors = [
            /* 0x00 */ { r: 84, g: 84, b: 84 }, /* 0x01 */ { r: 0, g: 30, b: 116 },
            /* ... */ // Complete com todas as cores NES
        ];
        return nesColors[index % nesColors.length];
    }
}