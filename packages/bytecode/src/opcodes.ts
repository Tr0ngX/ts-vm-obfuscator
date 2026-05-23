import type { OpcodeMapping } from '@tsvm/shared';
import { OpCode, SeededRandom } from '@tsvm/shared';

export class OpcodeRegistry {
  getOpcodeDescriptor(opcode: OpCode) {
    return { name: OpCode[opcode] || 'Unknown', operandCount: 0 };
  }
}

export function generateRemappedOpcodes(seed: number): OpcodeMapping {
  const mapping: OpcodeMapping = {
    seed,
    forward: new Map(),
    reverse: new Map()
  };

  const rng = new SeededRandom(seed);
  
  // Extract all valid opcode numbers
  const opcodes: OpCode[] = [];
  for (const key in OpCode) {
    if (!isNaN(Number(key))) {
      opcodes.push(Number(key) as OpCode);
    }
  }

  // Generate an array of numbers from 0 to 255 for available bytes
  const availableSlots: number[] = [];
  for (let i = 0; i < 256; i++) {
    availableSlots.push(i);
  }

  // Shuffle available slots using Fisher-Yates and the PRNG
  rng.shuffle(availableSlots);

  // Assign random slots to opcodes
  for (let i = 0; i < opcodes.length; i++) {
    const canonical = opcodes[i]!;
    // Ensure we have enough slots (we only have 256 byte values, which is enough for < 256 opcodes)
    const mapped = availableSlots[i]!;
    
    (mapping.forward as Map<OpCode, number>).set(canonical, mapped);
    (mapping.reverse as Map<number, OpCode>).set(mapped, canonical);
  }

  return mapping;
}
