import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction } from '@tsvm/shared';
import { OpCode, OperandKind, IRType } from '@tsvm/shared';

/**
 * 1) Invariant đầu vào: IRModule chứa hàm có gọi tới generic functions hoặc có type parameters (qua semantic graph).
 * 2) Invariant đầu ra: Tạo các branch giả mạo (phi/dispatch) kiểm tra type object ở runtime 
 *    để mô phỏng generic instantiation tĩnh của TypeScript.
 * 3) Node kinds đụng tới: Call, FunctionRef, BasicBlock.
 * 4) Edge cases: Bỏ qua các hàm không thể trace type rõ ràng.
 * 5) Pseudo-code:
 *    For each call instruction:
 *      if it calls a generic function (using typeFacts):
 *         replace call with a dynamic type-check dispatch wrapper
 */
export class GenericConfusionPass implements TransformPass {
  readonly name = 'GenericConfusionPass';
  readonly priority = 20;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    
    const newFunctions = ctx.module.functions.map(func => {
      let changed = false;
      const newBlocks = func.blocks.map(block => {
        const newInstructions: Instruction[] = [];
        for (const inst of block.instructions) {
          if (inst.opcode === OpCode.Call || inst.opcode === OpCode.CallMethod) {
            // Find if this is a call to a generic function
            // In a full implementation, we'd look up the function in semanticGraph
            // For now, we simulate confusion by injecting a Nop with metadata
            
            // Randomly apply generic confusion 10% of the time for demonstration
            if (ctx.rng.nextFloat() < 0.1) {
              changed = true;
              nodesTransformed++;
              
              // Inject a confusion preamble before the call
              // We use high registers to avoid colliding with locals/args temporarily
              const tempReg1 = `r250`;
              const tempReg2 = `r251`;
              const tempReg3 = `r252`;
              
              // 1. Copy the function reference (inst.operands[0]) to tempReg1
              newInstructions.push({
                opcode: OpCode.Move,
                operands: [
                  inst.operands[0]!,
                  { kind: OperandKind.Register, value: tempReg1 }
                ],
                metadata: { genericConfusion: true }
              });
              
              // 2. TypeOf tempReg1 -> tempReg2
              newInstructions.push({
                opcode: OpCode.TypeOf,
                operands: [
                  { kind: OperandKind.Register, value: tempReg1 },
                  { kind: OperandKind.Register, value: tempReg2 }
                ]
              });
              
              // 3. Eq tempReg1, tempReg2 -> tempReg3 (dummy comparison)
              newInstructions.push({
                opcode: OpCode.Eq,
                operands: [
                  { kind: OperandKind.Register, value: tempReg1 },
                  { kind: OperandKind.Register, value: tempReg2 },
                  { kind: OperandKind.Register, value: tempReg3 }
                ]
              });
              
              // We just push the original call
              newInstructions.push(inst);
            } else {
              newInstructions.push(inst);
            }
          } else {
            newInstructions.push(inst);
          }
        }
        
        return changed ? { ...block, instructions: newInstructions } : block;
      });
      
      return changed ? { ...func, blocks: newBlocks } : func;
    });

    const newModule: IRModule = {
      ...ctx.module,
      functions: newFunctions
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
