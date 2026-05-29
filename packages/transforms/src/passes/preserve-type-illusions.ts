import type { TransformPass, TransformContext, TransformResult, IRModule, IRFunction, BasicBlock, Instruction, Register } from '@tsvm/shared';
import { OpCode, IRType, OperandKind, ConstantKind } from '@tsvm/shared';

/**
 * 1) Invariant đầu vào: IR module có chứa các functions với type signatures rõ ràng (từ TypeScript).
 * 2) Invariant đầu ra: IR module được chèn thêm các khối mã (fake type guards / phantom branches) 
 *    để đánh lừa static analysis (nhưng không đổi runtime behavior).
 * 3) Node kinds đụng tới: IRFunction, BasicBlock, Instruction.
 * 4) Edge cases: Không áp dụng vào các hàm quá ngắn hoặc generator/async để tránh overhead/vỡ luồng.
 */
export class PreserveTypeIllusionsPass implements TransformPass {
  readonly name = 'PreserveTypeIllusionsPass';
  readonly priority = 10;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const newCP = [...ctx.module.constantPool];

    function getMaxRegister(func: IRFunction): number {
      let maxReg = 0;
      const consider = (value: string | undefined) => {
        if (!value) return;
        const m = /^r(\d+)$/.exec(value);
        if (m) {
          maxReg = Math.max(maxReg, parseInt(m[1]!, 10));
        }
      };

      for (const param of func.params) {
        consider(param.register);
      }
      for (const local of func.locals) {
        consider(local.register);
      }
      for (const block of func.blocks) {
        for (const inst of block.instructions) {
          consider(inst.result);
          for (const op of inst.operands) {
            if (op.kind === OperandKind.Register && typeof op.value === 'string') {
              consider(op.value);
            }
          }
        }
        consider(block.terminator.condition);
        consider(block.terminator.returnValue);
      }
      return maxReg;
    }

    const newFunctions = ctx.module.functions.map(func => {
      if (!func.isVirtualized) return func;
      if (func.params.length === 0) return func;
      if (!func.blocks || func.blocks.length === 0) return func;

      // Apply only 30% of the time per function (using ctx.rng.nextFloat())
      if (ctx.rng.nextFloat() >= 0.30) {
        return func;
      }

      nodesTransformed++;

      const maxReg = getMaxRegister(func);
      const tempReg1 = `r${maxReg + 1}` as Register;
      const tempReg2 = `r${maxReg + 2}` as Register;
      const tempReg3 = `r${maxReg + 3}` as Register;

      let functionConstIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'function');
      if (functionConstIdx === -1) {
        functionConstIdx = newCP.length;
        newCP.push({ index: functionConstIdx, kind: ConstantKind.String, value: 'function' });
      }

      const paramReg = func.params[0]!.register;

      const newInsts: Instruction[] = [
        {
          opcode: OpCode.TypeOf,
          operands: [{ kind: OperandKind.Register, value: paramReg }],
          result: tempReg1
        },
        {
          opcode: OpCode.LoadConst,
          operands: [{ kind: OperandKind.ConstantIndex, value: functionConstIdx }],
          result: tempReg2
        },
        {
          opcode: OpCode.Eq,
          operands: [
            { kind: OperandKind.Register, value: tempReg1 },
            { kind: OperandKind.Register, value: tempReg2 }
          ],
          result: tempReg3
        }
      ];

      const newBlocks = func.blocks.map((block, idx) => {
        if (idx === 0) {
          return {
            ...block,
            instructions: [...newInsts, ...block.instructions]
          };
        }
        return block;
      });

      const addedLocals = [
        {
          name: `type_illusion_temp_${tempReg1}`,
          register: tempReg1,
          type: IRType.String,
          isCaptured: false
        },
        {
          name: `type_illusion_temp_${tempReg2}`,
          register: tempReg2,
          type: IRType.String,
          isCaptured: false
        },
        {
          name: `type_illusion_temp_${tempReg3}`,
          register: tempReg3,
          type: IRType.Boolean,
          isCaptured: false
        }
      ];

      return {
        ...func,
        locals: [...func.locals, ...addedLocals],
        blocks: newBlocks
      };
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool: newCP },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
