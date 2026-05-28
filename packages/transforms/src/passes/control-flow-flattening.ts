import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction, BasicBlock, TerminatorInstruction, Operand, Register } from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind } from '@tsvm/shared';

export class ControlFlowFlatteningPass implements TransformPass {
  readonly name = 'ControlFlowFlatteningPass';
  readonly priority = 26;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const constantPool = [...ctx.module.constantPool];

    const newFunctions = ctx.module.functions.map(func => {
      if (!func.isVirtualized || func.blocks.length < 3) return func;

      // 50% chance to apply per function (avoid predictability)
      if (ctx.rng.nextFloat() < 0.4) return func;

      nodesTransformed++;

      // 1. Assign random state IDs to each block
      const stateMap = new Map<string, number>();
      const blockOrder = ctx.rng.shuffle([...func.blocks]);
      for (const block of func.blocks) {
        stateMap.set(block.id, ctx.rng.nextRange(1000, 0x7FFFFFFF));
      }

      // 2. Find max register to allocate state register beyond current usage
      let maxReg = 0;
      for (const block of func.blocks) {
        for (const inst of block.instructions) {
          if (inst.result) {
            const m = /^r(\d+)$/.exec(inst.result);
            if (m) maxReg = Math.max(maxReg, parseInt(m[1]!, 10));
          }
          for (const op of inst.operands) {
            if (op.kind === OperandKind.Register && typeof op.value === 'string') {
              const m = /^r(\d+)$/.exec(op.value);
              if (m) maxReg = Math.max(maxReg, parseInt(m[1]!, 10));
            }
          }
        }
      }
      const stateReg = `r${maxReg + 1}` as Register;
      const tempReg = `r${maxReg + 2}` as Register;

      // 3. Add state constants to constant pool
      const stateConstants = new Map<number, number>(); // stateId -> cpIndex
      for (const [blockId, stateId] of stateMap) {
        const cpIdx = constantPool.length;
        constantPool.push({ index: cpIdx, kind: ConstantKind.Number, value: stateId });
        stateConstants.set(stateId, cpIdx);
      }

      // 4. Build the dispatcher block
      const dispatcherId = `__cff_dispatch_${ctx.rng.identifier(6)}`;
      const exitId = `__cff_exit_${ctx.rng.identifier(4)}`;
      const entryStateId = stateMap.get(func.blocks[0]!.id)!;

      // Entry block: set initial state, jump to dispatcher
      const entryBlockId = `__cff_entry_${ctx.rng.identifier(4)}`;
      const entryBlock: BasicBlock = {
        id: entryBlockId,
        label: 'cff_entry',
        instructions: [
          {
            opcode: OpCode.LoadConst,
            operands: [
              { kind: OperandKind.ConstantIndex, value: stateConstants.get(entryStateId)! }
            ],
            result: stateReg
          }
        ],
        terminator: { kind: 'jump', targets: [dispatcherId] },
        predecessors: [],
        successors: [dispatcherId],
        phiNodes: []
      };

      // 5. Transform each original block into a case block
      // Each block ends by setting stateReg to the next state and jumping back to dispatcher
      const caseBlocks: BasicBlock[] = [];
      for (const block of blockOrder) {
        const stateId = stateMap.get(block.id)!;
        const caseLabelId = `__cff_case_${block.id}_${ctx.rng.identifier(4)}`;

        // Determine next state based on terminator
        const caseInstructions: Instruction[] = [...block.instructions];
        let caseTerminator: TerminatorInstruction;

        if (block.terminator.kind === 'return' || block.terminator.kind === 'throw') {
          // Return/throw — keep original terminator, jump to exit
          caseTerminator = block.terminator;
        } else if (block.terminator.kind === 'jump') {
          // Set state to target's state, jump to dispatcher
          const targetState = stateMap.get(block.terminator.targets[0]!)!;
          caseInstructions.push({
            opcode: OpCode.LoadConst,
            operands: [
              { kind: OperandKind.ConstantIndex, value: stateConstants.get(targetState)! }
            ],
            result: stateReg
          });
          caseTerminator = { kind: 'jump', targets: [dispatcherId] };
        } else if (block.terminator.kind === 'branch') {
          // Branch: if condition, set true-state else set false-state, then jump to dispatcher
          const trueState = stateMap.get(block.terminator.targets[0]!)!;
          const falseState = stateMap.get(block.terminator.targets[1]!)!;
          
          const trueBlockId = `__cff_br_t_${ctx.rng.identifier(4)}`;
          const falseBlockId = `__cff_br_f_${ctx.rng.identifier(4)}`;

          // We need to split this into sub-blocks for the branch
          // true path block: set trueState, jump to dispatcher
          caseBlocks.push({
            id: trueBlockId,
            label: 'cff_br_true',
            instructions: [{
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: stateConstants.get(trueState)! }],
              result: stateReg
            }],
            terminator: { kind: 'jump', targets: [dispatcherId] },
            predecessors: [caseLabelId],
            successors: [dispatcherId],
            phiNodes: []
          });
          caseBlocks.push({
            id: falseBlockId,
            label: 'cff_br_false',
            instructions: [{
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: stateConstants.get(falseState)! }],
              result: stateReg
            }],
            terminator: { kind: 'jump', targets: [dispatcherId] },
            predecessors: [caseLabelId],
            successors: [dispatcherId],
            phiNodes: []
          });

          caseTerminator = {
            kind: 'branch',
            targets: [trueBlockId, falseBlockId],
            condition: block.terminator.condition
          };
        } else {
          caseTerminator = block.terminator;
        }

        caseBlocks.push({
          id: caseLabelId,
          label: `cff_case_${block.id}`,
          instructions: caseInstructions,
          terminator: caseTerminator,
          predecessors: [dispatcherId],
          successors: caseTerminator.targets || [],
          phiNodes: block.phiNodes || []
        });
      }

      // 6. Build dispatcher block with chained comparisons
      const dispatchInstructions: Instruction[] = [];
      // The dispatcher loads stateReg and compares with each case state
      // We use a chain of Eq + JmpIf checks
      // This gets compiled to a series of: LoadConst stateVal -> Eq stateReg, stateVal -> JmpIf

      // For now, build the dispatcher with direct terminator-based routing
      // The dispatcher is a chain block: compare state, branch to matching case or next comparison
      const comparisonBlocks: BasicBlock[] = [];
      const orderedCases = [...caseBlocks.filter(b => b.label?.startsWith('cff_case_'))];

      // Pre-generate comparison block IDs so they link correctly without random mismatch
      const cmpBlockIds: string[] = [];
      for (let i = 0; i < orderedCases.length; i++) {
        cmpBlockIds.push(`__cff_cmp_${i}_${ctx.rng.identifier(4)}`);
      }

      for (let i = 0; i < orderedCases.length; i++) {
        const caseBlock = orderedCases[i]!;
        const stateId = stateMap.get(caseBlock.label!.replace('cff_case_', '')!)!;
        const compBlockId = cmpBlockIds[i]!;
        const nextCompId = i < orderedCases.length - 1 ? cmpBlockIds[i + 1]! : exitId;

        const cmpTempReg = `r${maxReg + 3 + i}` as Register;

        comparisonBlocks.push({
          id: compBlockId,
          label: `cff_dispatch_${i}`,
          instructions: [
            {
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: stateConstants.get(stateId)! }],
              result: cmpTempReg
            },
            {
              opcode: OpCode.Eq,
              operands: [
                { kind: OperandKind.Register, value: stateReg },
                { kind: OperandKind.Register, value: cmpTempReg }
              ],
              result: tempReg
            }
          ],
          terminator: {
            kind: 'branch',
            targets: [caseBlock.id, nextCompId],
            condition: tempReg
          },
          predecessors: i === 0 ? [entryBlockId, dispatcherId] : [cmpBlockIds[i - 1]!],
          successors: [caseBlock.id, nextCompId],
          phiNodes: []
        });
      }

      // Dispatcher block just jumps to first comparison
      const dispatcherBlock: BasicBlock = {
        id: dispatcherId,
        label: 'cff_dispatcher',
        instructions: [],
        terminator: { kind: 'jump', targets: [comparisonBlocks[0]?.id || exitId] },
        predecessors: [entryBlockId],
        successors: [comparisonBlocks[0]?.id || exitId],
        phiNodes: []
      };

      // Exit block (trap / unreachable)
      const exitBlock: BasicBlock = {
        id: exitId,
        label: 'cff_exit',
        instructions: [],
        terminator: { kind: 'return', targets: [] },
        predecessors: [],
        successors: [],
        phiNodes: []
      };

      // 7. Assemble all blocks in shuffled order
      const allBlocks = ctx.rng.shuffle([
        entryBlock,
        dispatcherBlock,
        ...comparisonBlocks,
        ...caseBlocks,
        exitBlock
      ]);

      // Entry must be first
      const entryIdx = allBlocks.findIndex(b => b.id === entryBlockId);
      if (entryIdx > 0) {
        [allBlocks[0], allBlocks[entryIdx]] = [allBlocks[entryIdx]!, allBlocks[0]!];
      }

      return { ...func, blocks: allBlocks };
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}

