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
  
  const opcodes: OpCode[] = [];
  for (const key in OpCode) {
    if (!isNaN(Number(key))) {
      opcodes.push(Number(key) as OpCode);
    }
  }

  const availableSlots: number[] = [];
  for (let i = 0; i < 256; i++) {
    availableSlots.push(i);
  }

  rng.shuffle(availableSlots);

  // Distribute 256 slots across the available opcodes (1-to-N aliasing)
  for (let i = 0; i < opcodes.length; i++) {
    const canonical = opcodes[i]!;
    // Assign at least 1, up to 5 aliases depending on remaining slots
    const aliasCount = i === opcodes.length - 1 ? availableSlots.length : Math.max(1, rng.nextRange(1, 5));
    const mapped: number[] = [];
    
    for (let j = 0; j < aliasCount; j++) {
      if (availableSlots.length > 0) {
        const slot = availableSlots.pop()!;
        mapped.push(slot);
        (mapping.reverse as Map<number, OpCode>).set(slot, canonical);
      }
    }
    
    (mapping.forward as Map<OpCode, number | readonly number[]>).set(canonical, mapped);
  }

  return mapping;
}
