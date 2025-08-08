export class PpuRegisters {
  ppuctrl = 0;     // $2000
  ppumask = 0;     // $2001
  ppustatus = 0;   // $2002
  oamaddr = 0;     // $2003
  ppuscroll = 0;   // $2005 (temporário)
  ppuaddr = 0;     // $2006 (temporário)
  ppudata = 0;     // $2007

  // Flags específicas
  nmiOccurred = false;
  nmiEnabled = false;
}