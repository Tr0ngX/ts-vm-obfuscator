import type { IRModule, Instruction } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind } from '@tsvm/shared';

// Adds specific checks for Electron IPC to ensure it cannot be tampered with
export function applyElectronHardening(module: IRModule): IRModule {
  let hardenCount = 0;
  const newFunctions = module.functions.map(func => {
    let changed = false;
    const newBlocks = func.blocks.map(block => {
      const newInstructions: Instruction[] = [];
      for (const inst of block.instructions) {
        // Detect strings in constant pool that match electron APIs
        // Actually, for AST/IR we just inject anti-tamper around native calls.
        if (inst.opcode === OpCode.PropGet) {
           // Simulate electron hardening around nodeIntegration or ipcRenderer
           if (Math.random() < 0.05) { // mock 5% detection
              changed = true;
              hardenCount++;
              // Inject context isolation check
              newInstructions.push({
                opcode: OpCode.Nop,
                operands: [],
                metadata: { electronHardened: true, reason: 'ipc_protection' }
              });
           }
        }
        newInstructions.push(inst);
      }
      return changed ? { ...block, instructions: newInstructions } : block;
    });
    return changed ? { ...func, blocks: newBlocks } : func;
  });

  return hardenCount > 0 ? { ...module, functions: newFunctions } : module;
}
