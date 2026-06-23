import type { OpcodeMapping } from '@tsvm/shared';
import { OpCode, SeededRandom } from '@tsvm/shared';

export function generateRemappedOpcodes(seed: number): OpcodeMapping {
  const forward = new Map<OpCode, number[]>();
  const reverse = new Map<number, OpCode>();

  const rng = new SeededRandom(seed);

  const opcodes = Object.values(OpCode).filter(
    (v): v is OpCode => typeof v === 'number'
  );

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
    reverse.set(slot, canonical);
    forward.set(canonical, mapped);
  }

  // 2. Distribute any remaining slots as additional aliases
  while (availableSlots.length > 0) {
    const slot = availableSlots.pop()!;
    const randomOpcode = opcodes[rng.nextRange(0, opcodes.length - 1)]!;
    const mapped = forward.get(randomOpcode)!;
    mapped.push(slot);
    reverse.set(slot, randomOpcode);
  }

  return { seed, forward, reverse };
}
