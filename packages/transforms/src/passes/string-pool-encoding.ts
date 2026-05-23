import type { TransformPass, TransformContext, TransformResult, IRModule, ConstantPoolEntry, IRFunction, Instruction, BasicBlock } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind } from '@tsvm/shared';

export class StringPoolEncodingPass implements TransformPass {
  readonly name = 'StringPoolEncodingPass';
  readonly priority = 70;

  execute(ctx: TransformContext): TransformResult {
    const config = ctx.profile.transforms.find(t => t.name === this.name);
    const fragmentStrings = config?.options?.['fragmentStrings'] ?? true;
    const minLength = (config?.options?.['minLength'] as number) ?? 3;

    if (!fragmentStrings) {
      return {
        module: ctx.module,
        symbolsRenamed: 0,
        nodesTransformed: 0,
        diagnostics: []
      };
    }

    let nextConstantIndex = ctx.module.constantPool.length;
    const newConstantPool = [...ctx.module.constantPool];

    // Helper to find or add a string constant
    const getOrAddStringConstant = (val: string): number => {
      const existing = newConstantPool.find(c => c.kind === ConstantKind.String && c.value === val);
      if (existing) {
        return existing.index;
      }
      const newIdx = nextConstantIndex++;
      newConstantPool.push({
        index: newIdx,
        kind: ConstantKind.String,
        value: val
      });
      return newIdx;
    };

    let nodesTransformed = 0;

    const newFunctions = ctx.module.functions.map(fn => {
      // Find maximum register ID in function
      let maxRegId = 0;
      const regPattern = /^r(\d+)$/;
      const checkReg = (r: string | undefined) => {
        if (!r) return;
        const match = regPattern.exec(r);
        if (match) {
          const id = parseInt(match[1]!, 10);
          if (id > maxRegId) maxRegId = id;
        }
      };

      fn.params.forEach(p => checkReg(p.register));
      fn.locals.forEach(l => checkReg(l.register));

      fn.blocks.forEach(block => {
        block.instructions.forEach(inst => {
          checkReg(inst.result);
          inst.operands.forEach(op => {
            if (op.kind === OperandKind.Register) {
              checkReg(op.value as string);
            }
          });
        });
        if (block.terminator.condition) checkReg(block.terminator.condition);
        if (block.terminator.returnValue) checkReg(block.terminator.returnValue);
      });

      let nextTempRegId = maxRegId + 1;

      const newBlocks = fn.blocks.map(block => {
        const newInstructions: Instruction[] = [];

        block.instructions.forEach(inst => {
          if (inst.opcode === OpCode.LoadConst && inst.operands.length > 0 && inst.result) {
            const op = inst.operands[0]!;
            if (op.kind === OperandKind.ConstantIndex) {
              const constIndex = op.value as number;
              const constant = ctx.module.constantPool[constIndex];

              if (constant && constant.kind === ConstantKind.String && typeof constant.value === 'string' && constant.value.length >= minLength) {
                const fullStr = constant.value;
                const mid = Math.floor(fullStr.length / 2);
                const part1 = fullStr.substring(0, mid);
                const part2 = fullStr.substring(mid);

                const part1Idx = getOrAddStringConstant(part1);
                const part2Idx = getOrAddStringConstant(part2);

                const tempReg1 = `r${nextTempRegId++}` as any;
                const tempReg2 = `r${nextTempRegId++}` as any;

                // 1. LoadConst part1 into tempReg1
                newInstructions.push({
                  opcode: OpCode.LoadConst,
                  operands: [{ kind: OperandKind.ConstantIndex, value: part1Idx }],
                  result: tempReg1,
                  sourceLocation: inst.sourceLocation
                });

                // 2. LoadConst part2 into tempReg2
                newInstructions.push({
                  opcode: OpCode.LoadConst,
                  operands: [{ kind: OperandKind.ConstantIndex, value: part2Idx }],
                  result: tempReg2,
                  sourceLocation: inst.sourceLocation
                });

                // 3. Add tempReg1 + tempReg2 -> original result register
                newInstructions.push({
                  opcode: OpCode.Add,
                  operands: [
                    { kind: OperandKind.Register, value: tempReg1 },
                    { kind: OperandKind.Register, value: tempReg2 }
                  ],
                  result: inst.result,
                  sourceLocation: inst.sourceLocation
                });

                nodesTransformed++;
                return;
              }
            }
          }

          newInstructions.push(inst);
        });

        return {
          ...block,
          instructions: newInstructions
        };
      });

      return {
        ...fn,
        blocks: newBlocks
      };
    });

    const newModule: IRModule = {
      ...ctx.module,
      constantPool: newConstantPool,
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
