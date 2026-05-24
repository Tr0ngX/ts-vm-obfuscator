import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction, BasicBlock } from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind } from '@tsvm/shared';

export class DeadCodeInjectionPass implements TransformPass {
  readonly name = 'DeadCodeInjectionPass';
  readonly priority = 25;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    
    // We must clone the constant pool if we want to modify it, because it is readonly
    const newCP = [...ctx.module.constantPool];

    const newFunctions = ctx.module.functions.map(func => {
      // Don't inject dead code into unvirtualized functions to save space
      if (!func.isVirtualized) return func;

      let changed = false;
      const newBlocks = func.blocks.map(block => {
        const newInstructions: Instruction[] = [];
        for (const inst of block.instructions) {
          // Inject junk 20% of the time before non-terminator instructions
          if (ctx.rng.nextFloat() < 0.20 && inst.opcode !== OpCode.Phi) {
            changed = true;
            nodesTransformed++;
            
            // Generate some junk math operations writing to high unused registers
            const junkReg1 = `r${ctx.rng.nextRange(200, 240)}`;
            const junkReg2 = `r${ctx.rng.nextRange(200, 240)}`;
            const junkReg3 = `r${ctx.rng.nextRange(200, 240)}`;

            // Ensure there is at least one constant
            if (newCP.length === 0) {
              newCP.push({ index: 0, kind: ConstantKind.Number, value: 0 });
            }
            const cpMax = newCP.length - 1;

            // e.g. LoadConst junk, Math operation, etc.
            newInstructions.push({
              opcode: OpCode.LoadConst,
              operands: [
                { kind: OperandKind.ConstantIndex, value: ctx.rng.nextRange(0, cpMax) },
                { kind: OperandKind.Register, value: junkReg1 }
              ]
            });
            newInstructions.push({
              opcode: OpCode.LoadConst,
              operands: [
                { kind: OperandKind.ConstantIndex, value: ctx.rng.nextRange(0, cpMax) },
                { kind: OperandKind.Register, value: junkReg2 }
              ]
            });
            
            // Random Math OP
            const mathOps = [OpCode.Add, OpCode.Sub, OpCode.Mul, OpCode.BitXor, OpCode.BitAnd];
            const randomOp = mathOps[ctx.rng.nextRange(0, mathOps.length - 1)]!;
            
            newInstructions.push({
              opcode: randomOp,
              operands: [
                { kind: OperandKind.Register, value: junkReg1 },
                { kind: OperandKind.Register, value: junkReg2 },
                { kind: OperandKind.Register, value: junkReg3 }
              ],
              metadata: { deadCode: true }
            });
          }
          
          newInstructions.push(inst);
        }
        
        return changed ? { ...block, instructions: newInstructions } : block;
      });
      
      return changed ? { ...func, blocks: newBlocks } : func;
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool: newCP },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
