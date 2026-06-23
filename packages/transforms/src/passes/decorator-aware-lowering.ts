import type {
  TransformPass,
  TransformContext,
  TransformResult,
  IRModule,
  IRFunction,
  BasicBlock,
  Instruction,
  Register,
} from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind, IRType } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

export class DecoratorAwareLoweringPass implements TransformPass {
  readonly name = 'DecoratorAwareLoweringPass';
  readonly priority = 30;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;

    const newFunctions = ctx.module.functions.map((func) => {
      if (!func.isVirtualized) return func;

      const nextReg = getMaxRegister(func);
      let tempIndex = 0;
      const addedLocals: any[] = [];

      const newBlocks = func.blocks.map((block) => {
        const newInsts = block.instructions.flatMap((inst) => {
          if ((inst.opcode === OpCode.Call || inst.opcode === OpCode.CallMethod) && inst.operands.length > 0) {
            const firstOp = inst.operands[0]!;
            if (firstOp.kind === OperandKind.Register && ctx.rng.nextFloat() < 0.15) {
              const tempReg = `r${nextReg + tempIndex}` as Register;
              tempIndex++;
              nodesTransformed++;

              addedLocals.push({
                name: `decorator_temp_${tempReg}`,
                register: tempReg,
                type: IRType.Any,
                isCaptured: false,
              });

              const moveInst: Instruction = {
                opcode: OpCode.Move,
                operands: [
                  { kind: OperandKind.Register, value: firstOp.value },
                  { kind: OperandKind.Register, value: tempReg },
                ],
              };

              const updatedInst: Instruction = {
                ...inst,
                operands: [{ kind: OperandKind.Register, value: tempReg }, ...inst.operands.slice(1)],
              };

              return [moveInst, updatedInst];
            }
          }
          return [inst];
        });

        return {
          ...block,
          instructions: newInsts,
        };
      });

      return {
        ...func,
        locals: [...func.locals, ...addedLocals],
        blocks: newBlocks,
      };
    });

    return {
      module: { ...ctx.module, functions: newFunctions },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
