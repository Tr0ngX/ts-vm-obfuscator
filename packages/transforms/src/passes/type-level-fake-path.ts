import type { TransformPass, TransformContext, TransformResult, IRModule, IRFunction, Instruction, BasicBlock, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind } from '@tsvm/shared';

/**
 * 1) Invariant đầu vào: Các hàm thực thi logic bình thường.
 * 2) Invariant đầu ra: Tạo ra các block mã chết (dead code) chứa logic phức tạp (fake path)
 *    nhưng được kết nối qua opaque predicates (điều kiện luôn sai nhưng khó phân tích tĩnh).
 * 3) Node kinds đụng tới: BasicBlock, Instruction (JmpIf).
 * 4) Edge cases: Cần cẩn thận không làm tăng overhead quá mức, hoặc phá vỡ register allocation.
 */
export class TypeLevelFakePathPass implements TransformPass {
  readonly name = 'TypeLevelFakePathPass';
  readonly priority = 30;

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
      if (func.blocks.length < 3) return func;

      // Apply 25% of the time per eligible function
      if (ctx.rng.nextFloat() >= 0.25) {
        return func;
      }

      const eligibleBlocks = func.blocks.filter(b => b.terminator.kind === 'jump');
      if (eligibleBlocks.length === 0) {
        return func;
      }

      const blockToModify = ctx.rng.pick(eligibleBlocks);
      if (!blockToModify.terminator.targets || blockToModify.terminator.targets.length === 0) {
        return func;
      }

      nodesTransformed++;

      const maxReg = getMaxRegister(func);
      const tempA = `r${maxReg + 1}` as Register;
      const tempB = `r${maxReg + 2}` as Register;
      const tempC = `r${maxReg + 3}` as Register;
      const junkTemp1 = `r${maxReg + 4}` as Register;
      const junkTemp2 = `r${maxReg + 5}` as Register;

      const regX = func.params.length > 0 ? func.params[0]!.register : ('r0' as Register);

      let zeroIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 0);
      if (zeroIdx === -1) {
        zeroIdx = newCP.length;
        newCP.push({ index: zeroIdx, kind: ConstantKind.Number, value: 0 });
      }

      let fortyTwoIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 42);
      if (fortyTwoIdx === -1) {
        fortyTwoIdx = newCP.length;
        newCP.push({ index: fortyTwoIdx, kind: ConstantKind.Number, value: 42 });
      }

      const opaqueInsts: Instruction[] = [
        {
          opcode: OpCode.Mul,
          operands: [
            { kind: OperandKind.Register, value: regX },
            { kind: OperandKind.Register, value: regX }
          ],
          result: tempA
        },
        {
          opcode: OpCode.LoadConst,
          operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }],
          result: tempB
        },
        {
          opcode: OpCode.Lt,
          operands: [
            { kind: OperandKind.Register, value: tempA },
            { kind: OperandKind.Register, value: tempB }
          ],
          result: tempC
        }
      ];

      const fakeBlockId = `__fake_path_${ctx.rng.identifier(6)}`;

      const fakeBlock: BasicBlock = {
        id: fakeBlockId,
        label: 'fake_path',
        instructions: [
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: fortyTwoIdx }],
            result: junkTemp1
          },
          {
            opcode: OpCode.Add,
            operands: [
              { kind: OperandKind.Register, value: junkTemp1 },
              { kind: OperandKind.Register, value: regX }
            ],
            result: junkTemp2
          },
          {
            opcode: OpCode.Move,
            operands: [
              { kind: OperandKind.Register, value: junkTemp2 },
              { kind: OperandKind.Register, value: junkTemp1 }
            ]
          }
        ],
        terminator: {
          kind: 'return',
          targets: []
        },
        predecessors: [blockToModify.id],
        successors: [],
        phiNodes: []
      };

      const originalTarget = blockToModify.terminator.targets[0]!;

      const newBlocks = func.blocks.flatMap(block => {
        if (block.id === blockToModify.id) {
          const updatedBlock: BasicBlock = {
            ...block,
            instructions: [...block.instructions, ...opaqueInsts],
            terminator: {
              kind: 'branch',
              targets: [fakeBlock.id, originalTarget],
              condition: tempC
            },
            successors: [fakeBlock.id, originalTarget]
          };
          return [updatedBlock, fakeBlock];
        }
        return [block];
      });

      return {
        ...func,
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
