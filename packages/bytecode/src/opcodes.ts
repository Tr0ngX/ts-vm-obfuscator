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

  // 1. Assign exactly 1 slot to each canonical opcode to ensure coverage
  for (let i = 0; i < opcodes.length; i++) {
    const canonical = opcodes[i]!;
    const slot = availableSlots.pop()!;
    const mapped = [slot];
    (mapping.reverse as Map<number, OpCode>).set(slot, canonical);
    (mapping.forward as Map<OpCode, number[]>).set(canonical, mapped);
  }

  // 2. Distribute any remaining slots as additional aliases
  while (availableSlots.length > 0) {
    const slot = availableSlots.pop()!;
    const randomOpcode = opcodes[rng.nextRange(0, opcodes.length - 1)]!;
    const mapped = mapping.forward.get(randomOpcode) as number[];
    mapped.push(slot);
    (mapping.reverse as Map<number, OpCode>).set(slot, randomOpcode);
  }

  return mapping;
}
