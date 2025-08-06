export enum Flags6502 {
  Carry = 1 << 0,             // C
  Zero = 1 << 1,              // Z
  InterruptDisable = 1 << 2,  // I
  Decimal = 1 << 3,           // D (não usado no NES)
  Break = 1 << 4,             // B
  Unused = 1 << 5,            // Sempre 1
  Overflow = 1 << 6,          // V
  Negative = 1 << 7,          // N
}
