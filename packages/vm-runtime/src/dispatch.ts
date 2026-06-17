import type { OpcodeMapping } from '@tsvm/shared';
import { OpCode } from '@tsvm/shared';
import { VMRuntime } from './runtime.js';

export type DispatchHandler = (vm: VMRuntime, bytecode: Uint8Array) => void;
export type DispatchTable = DispatchHandler[];

// Helper to decode a register index or immediate value from the bytecode stream
function readOperand(vm: VMRuntime, bytecode: Uint8Array): { kind: number; value: number } {
  const kind = bytecode[vm.pc++] as number;
  let val = 0;
  
  // Decodes LEB128 / Variable-length or Fallback fixed 4-byte integers based on encoding scheme
  // By default, supporting dynamic decoding matching bytecode/encoder logic
  let shift = 0;
  let b = 0;
  do {
    b = bytecode[vm.pc++] as number;
    val |= (b & 0x7F) << shift;
    shift += 7;
  } while (b & 0x80);

  return { kind, value: val };
}

// Concrete execution handlers for every core register machine instruction
const canonicalHandlers: Record<number, DispatchHandler> = {
  [OpCode.Nop]: () => {
    // No operation
  },
  [OpCode.Halt]: (vm) => {
    vm.halted = true;
  },
  [OpCode.LoadConst]: (vm, bytecode) => {
    const constIdx = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.constantPool[constIdx];
  },
  [OpCode.LoadLocal]: (vm, bytecode) => {
    const srcReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.registers[srcReg];
  },
  [OpCode.StoreLocal]: (vm, bytecode) => {
    const destReg = readOperand(vm, bytecode).value;
    const srcReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.registers[srcReg];
  },
  [OpCode.Move]: (vm, bytecode) => {
    const srcReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.registers[srcReg];
  },
  [OpCode.Add]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    const leftVal = vm.registers[leftReg];
    const rightVal = vm.registers[rightReg];
    
    // Polyfill type-safe addition logic (supports strings and numbers natively)
    if (typeof leftVal === 'string' || typeof rightVal === 'string') {
      vm.registers[destReg] = (leftVal as any) + (rightVal as any);
    } else {
      vm.registers[destReg] = (Number(leftVal) + Number(rightVal)) | 0;
    }
  },
  [OpCode.Sub]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (Number(vm.registers[leftReg]) - Number(vm.registers[rightReg])) | 0;
  },
  [OpCode.Mul]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (Number(vm.registers[leftReg]) * Number(vm.registers[rightReg])) | 0;
  },
  [OpCode.Div]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (Number(vm.registers[leftReg]) / Number(vm.registers[rightReg])) | 0;
  },
  [OpCode.Mod]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (Number(vm.registers[leftReg]) % Number(vm.registers[rightReg])) | 0;
  },
  [OpCode.Eq]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.registers[leftReg] == vm.registers[rightReg];
  },
  [OpCode.StrictEq]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = vm.registers[leftReg] === vm.registers[rightReg];
  },
  [OpCode.Lt]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (vm.registers[leftReg] as any) < (vm.registers[rightReg] as any);
  },
  [OpCode.LtEq]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (vm.registers[leftReg] as any) <= (vm.registers[rightReg] as any);
  },
  [OpCode.Gt]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (vm.registers[leftReg] as any) > (vm.registers[rightReg] as any);
  },
  [OpCode.GtEq]: (vm, bytecode) => {
    const leftReg = readOperand(vm, bytecode).value;
    const rightReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = (vm.registers[leftReg] as any) >= (vm.registers[rightReg] as any);
  },
  [OpCode.Not]: (vm, bytecode) => {
    const srcReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = !vm.registers[srcReg];
  },
  [OpCode.TypeOf]: (vm, bytecode) => {
    const srcReg = readOperand(vm, bytecode).value;
    const destReg = readOperand(vm, bytecode).value;
    vm.registers[destReg] = typeof vm.registers[srcReg];
  },
  [OpCode.Jmp]: (vm, bytecode) => {
    const targetPc = readOperand(vm, bytecode).value;
    vm.pc = targetPc;
  },
  [OpCode.JmpIf]: (vm, bytecode) => {
    const condReg = readOperand(vm, bytecode).value;
    const truePc = readOperand(vm, bytecode).value;
    const falsePc = readOperand(vm, bytecode).value;
    vm.pc = vm.registers[condReg] ? truePc : falsePc;
  },
  [OpCode.JmpIfNot]: (vm, bytecode) => {
    const condReg = readOperand(vm, bytecode).value;
    const truePc = readOperand(vm, bytecode).value;
    const falsePc = readOperand(vm, bytecode).value;
    vm.pc = !vm.registers[condReg] ? truePc : falsePc;
  },
  [OpCode.Return]: (vm, bytecode) => {
    const valReg = readOperand(vm, bytecode).value;
    vm.registers[0] = vm.registers[valReg];
    vm.halted = true;
  },
  [OpCode.GetEntropy]: (vm, bytecode) => {
    const destReg = readOperand(vm, bytecode).value;
    // Fast entropy: derive from VM internal state without calling external APIs
    const raw = (vm.pc * 2654435761) >>> 0; // Knuth multiplicative hash
    vm.registers[destReg] = (raw ^ (vm.pc << 13)) & 0xFF;
  }
};

export function createDispatchTable(mapping: OpcodeMapping): DispatchTable {
  const table: DispatchTable = new Array(256);
  const trapHandler: DispatchHandler = (vm, bc) => {
    throw new Error(`VM Integrity Violation: Unmapped instruction opcode at PC ${vm.pc - 1}`);
  };
  table.fill(trapHandler);

  // Map each decoded virtual opcode to its canonical execution handler
  for (const [canonical, mapped] of (mapping.forward as Map<number, number | number[]>).entries()) {
    const handler = canonicalHandlers[canonical];
    if (!handler) continue;
    
    const mappedOps = Array.isArray(mapped) ? mapped : [mapped];
    for (const vOp of mappedOps) {
      if (vOp >= 0 && vOp < 256) {
        table[vOp] = handler;
      }
    }
  }

  return table;
}

export function dispatchLoop(vm: VMRuntime, bytecode: Uint8Array, table: DispatchTable) {
  while (!vm.halted && vm.pc < bytecode.length) {
    const opcode = bytecode[vm.pc++] as number;
    const handler = table[opcode];
    if (handler) {
      // Direct array-indexed function call (switchless direct threaded dispatch)
      handler(vm, bytecode);
    } else {
      throw new Error(`VM Integrity Violation: Unmapped instruction opcode ${opcode} at PC ${vm.pc - 1}`);
    }
  }
}
