import type { OpcodeMapping } from '@tsvm/shared';
import { VMRuntime } from './runtime.js';

export type DispatchHandler = (vm: VMRuntime, bytecode: Uint8Array) => void;
export type DispatchTable = Map<number, DispatchHandler>;

export function createDispatchTable(mapping: OpcodeMapping): DispatchTable {
  const table: DispatchTable = new Map();
  // In a real implementation we would populate this table with handlers 
  // for all OpCodes mapped by mapping.encodedToCanonical
  return table;
}

export function dispatchLoop(vm: VMRuntime, bytecode: Uint8Array, table: DispatchTable) {
  while (!vm.halted && vm.pc < bytecode.length) {
    const opcode = bytecode[vm.pc++] as number;
    const handler = table.get(opcode);
    if (handler) {
      handler(vm, bytecode);
    } else {
      throw new Error(`Unknown opcode: ${opcode} at pc ${vm.pc - 1}`);
    }
  }
}
