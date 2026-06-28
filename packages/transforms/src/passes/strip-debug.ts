import type { TransformPass, TransformContext, TransformResult, Instruction, Register } from '@tsvm/shared';
import { OpCode, ConstantKind } from '@tsvm/shared';

export class StripDebugPass implements TransformPass {
  readonly name = 'StripDebugPass';
  readonly priority = 5; // Run very early

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;

    const newFunctions = ctx.module.functions.map((func) => {
      if (!func.isVirtualized) return func;

      let changed = false;
      const newBlocks = func.blocks.map((block) => {
        const stringRegs = new Map<Register, string>();
        const globalRegs = new Map<Register, string>();
        const newInstructions: Instruction[] = [];

        for (const inst of block.instructions) {
          if (inst.opcode === OpCode.LoadConst) {
            const cpIdx = inst.operands[0]!.value as number;
            const cpEntry = ctx.module.constantPool.find((c) => c.index === cpIdx);
            if (cpEntry && cpEntry.kind === ConstantKind.String) {
              stringRegs.set(inst.result!, cpEntry.value as string);
            }
          } else if (inst.opcode === OpCode.LoadGlobal) {
            const propReg = inst.operands[0]!.value as Register;
            const propName = stringRegs.get(propReg);
            if (propName) {
              globalRegs.set(inst.result!, propName);
            }
          } else if (inst.opcode === OpCode.CallMethod) {
            const objReg = inst.operands[0]!.value as Register;
            if (globalRegs.get(objReg) === 'console') {
              // Strip this console call
              changed = true;
              nodesTransformed++;

              newInstructions.push({
                ...inst,
                opcode: OpCode.Nop,
                operands: [],
              });
              continue;
            }
          }

          newInstructions.push(inst);
        }

        return changed ? { ...block, instructions: newInstructions } : block;
      });

      return changed ? { ...func, blocks: newBlocks } : func;
    });

    return {
      module: { ...ctx.module, functions: newFunctions },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
