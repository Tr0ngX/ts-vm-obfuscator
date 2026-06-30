import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction, BasicBlock, Register } from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

export class DeadCodeInjectionPass implements TransformPass {
  readonly name = 'DeadCodeInjectionPass';
  readonly priority = 25;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;

    // We must clone the constant pool if we want to modify it, because it is readonly
    const newCP = [...ctx.module.constantPool];

    const newFunctions = ctx.module.functions.map((func) => {
      // Don't inject dead code into unvirtualized functions to save space
      if (!func.isVirtualized) return func;

      let changed = false;
      const newBlocks: BasicBlock[] = [];
      const addedLocals: any[] = [];

      const maxReg = getMaxRegister(func) - 1;

      for (const block of func.blocks) {
        let currentBlockId = block.id;
        let currentLabel = block.label;
        let currentInstructions: Instruction[] = [];
        let currentPredecessors = [...block.predecessors];
        let isFirstSubBlock = true;

        for (const inst of block.instructions) {
          // Inject junk 20% of the time before non-terminator instructions
          if (ctx.rng.nextFloat() < 0.2) {
            changed = true;
            nodesTransformed++;

            // Allocate junk registers near live range
            const rStart = maxReg + 5;
            const junkReg1 = `r${ctx.rng.nextRange(rStart, rStart + 2)}` as Register;
            const junkReg2 = `r${ctx.rng.nextRange(rStart + 3, rStart + 5)}` as Register;
            const junkReg3 = `r${ctx.rng.nextRange(rStart + 6, rStart + 8)}` as Register;
            addedLocals.push(
              { name: `dci_junk_${junkReg1}`, register: junkReg1, type: 0, isCaptured: false },
              { name: `dci_junk_${junkReg2}`, register: junkReg2, type: 0, isCaptured: false },
              { name: `dci_junk_${junkReg3}`, register: junkReg3, type: 0, isCaptured: false },
            );

            // Ensure there is at least one constant
            if (newCP.length === 0) {
              newCP.push({ index: 0, kind: ConstantKind.Number, value: 0 });
            }
            const cpMax = newCP.length - 1;
            const randCpIdx = ctx.rng.nextRange(0, cpMax);

            // Vary patterns: A, B, C, D
            const patternChoice = ctx.rng.nextRange(0, 3);
            const deadCodeInsts: Instruction[] = [];

            if (patternChoice === 0) {
              // Pattern A: LoadConst + Move (2 instructions)
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: randCpIdx }],
                result: junkReg1,
              });
              deadCodeInsts.push({
                opcode: OpCode.Move,
                operands: [
                  { kind: OperandKind.Register, value: junkReg1 },
                  { kind: OperandKind.Register, value: junkReg2 },
                ],
              });
            } else if (patternChoice === 1) {
              // Pattern B: LoadConst + LoadConst + MathOp (3 instructions)
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: randCpIdx }],
                result: junkReg1,
              });
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: ctx.rng.nextRange(0, cpMax) }],
                result: junkReg2,
              });

              const mathOps = [OpCode.Add, OpCode.Sub, OpCode.Mul, OpCode.BitXor, OpCode.BitAnd];
              const randomOp = mathOps[ctx.rng.nextRange(0, mathOps.length - 1)]!;

              deadCodeInsts.push({
                opcode: randomOp,
                operands: [
                  { kind: OperandKind.Register, value: junkReg1 },
                  { kind: OperandKind.Register, value: junkReg2 },
                ],
                result: junkReg3,
              });
            } else if (patternChoice === 2) {
              // Pattern C: Move + TypeOf + Move (3 instructions, mimics real code)
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: randCpIdx }],
                result: junkReg1,
              });
              deadCodeInsts.push({
                opcode: OpCode.Move,
                operands: [
                  { kind: OperandKind.Register, value: junkReg1 },
                  { kind: OperandKind.Register, value: junkReg2 },
                ],
              });
              deadCodeInsts.push({
                opcode: OpCode.TypeOf,
                operands: [{ kind: OperandKind.Register, value: junkReg2 }],
                result: junkReg3,
              });
              deadCodeInsts.push({
                opcode: OpCode.Move,
                operands: [
                  { kind: OperandKind.Register, value: junkReg3 },
                  { kind: OperandKind.Register, value: junkReg1 },
                ],
              });
            } else {
              // Pattern D: LoadConst + LoadConst + comparison op (Lt/Gt/Eq) (3 instructions)
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: randCpIdx }],
                result: junkReg1,
              });
              deadCodeInsts.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: ctx.rng.nextRange(0, cpMax) }],
                result: junkReg2,
              });

              const compOps = [OpCode.Lt, OpCode.Gt, OpCode.Eq, OpCode.StrictEq, OpCode.LtEq, OpCode.GtEq];
              const compOp = compOps[ctx.rng.nextRange(0, compOps.length - 1)]!;

              deadCodeInsts.push({
                opcode: compOp,
                operands: [
                  { kind: OperandKind.Register, value: junkReg1 },
                  { kind: OperandKind.Register, value: junkReg2 },
                ],
                result: junkReg3,
              });
            }

            // Occasionally (10% of injections), wrap in opaque predicate
            if (ctx.rng.nextFloat() < 0.1) {
              let zeroIdx = newCP.findIndex((cp) => cp.kind === ConstantKind.Number && cp.value === 0);
              if (zeroIdx === -1) {
                zeroIdx = newCP.length;
                newCP.push({ index: zeroIdx, kind: ConstantKind.Number, value: 0 });
              }

              const randIdx = ctx.rng.nextRange(0, cpMax);
              const condReg = `r${maxReg + 14}` as Register;
              addedLocals.push({ name: `dci_cond_${condReg}`, register: condReg, type: 0, isCaptured: false });

              currentInstructions.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: randIdx }],
                result: junkReg1,
              });
              currentInstructions.push({
                opcode: OpCode.Mul,
                operands: [
                  { kind: OperandKind.Register, value: junkReg1 },
                  { kind: OperandKind.Register, value: junkReg1 },
                ],
                result: junkReg2,
              });
              currentInstructions.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }],
                result: junkReg3,
              });
              currentInstructions.push({
                opcode: OpCode.Lt,
                operands: [
                  { kind: OperandKind.Register, value: junkReg2 },
                  { kind: OperandKind.Register, value: junkReg3 },
                ],
                result: condReg,
              });

              const deadBlockId = `__dci_opaque_dead_${ctx.rng.identifier(6)}`;
              const nextBlockId = `__dci_opaque_next_${ctx.rng.identifier(6)}`;

              newBlocks.push({
                id: currentBlockId,
                label: currentLabel,
                instructions: currentInstructions,
                terminator: {
                  kind: 'branch',
                  targets: [deadBlockId, nextBlockId],
                  condition: condReg,
                },
                predecessors: currentPredecessors,
                successors: [deadBlockId, nextBlockId],
                phiNodes: isFirstSubBlock ? block.phiNodes : [],
              });
              isFirstSubBlock = false;

              newBlocks.push({
                id: deadBlockId,
                label: 'opaque_dead',
                instructions: deadCodeInsts,
                terminator: { kind: 'jump', targets: [nextBlockId] },
                predecessors: [currentBlockId],
                successors: [nextBlockId],
                phiNodes: [],
              });

              const origBlockId = currentBlockId;
              currentBlockId = nextBlockId;
              currentLabel = `${currentLabel}_opaque`;
              currentInstructions = [];
              currentPredecessors = [origBlockId, deadBlockId];
            } else {
              // Normal injection directly into currentInstructions
              currentInstructions.push(...deadCodeInsts);
            }
          }

          currentInstructions.push(inst);
        }

        newBlocks.push({
          id: currentBlockId,
          label: currentLabel,
          instructions: currentInstructions,
          terminator: block.terminator,
          predecessors: currentPredecessors,
          successors: block.successors,
          phiNodes: isFirstSubBlock ? block.phiNodes : [],
        });
      }

      return changed ? { ...func, blocks: newBlocks, locals: [...func.locals, ...addedLocals] } : func;
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool: newCP },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
