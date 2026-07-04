import type {
  TransformPass,
  TransformContext,
  TransformResult,
  IRModule,
  Instruction,
  BasicBlock,
  TerminatorInstruction,
  Operand,
  Register,
} from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind, IRType } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

export class ControlFlowFlatteningPass implements TransformPass {
  readonly name = 'ControlFlowFlatteningPass';
  readonly priority = 26;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const constantPool = [...ctx.module.constantPool];

    const newFunctions = ctx.module.functions.map((func) => {
      if (!func.isVirtualized || func.blocks.length < 3) return func;

      const hasTryCatch = func.blocks.some((block) =>
        block.instructions.some((inst) => inst.opcode === OpCode.TryCatchBegin || inst.opcode === OpCode.TryCatchEnd),
      );
      if (hasTryCatch) return func;

      // 50% chance to apply per function (avoid predictability)
      if (ctx.rng.nextFloat() < 0.4) return func;

      nodesTransformed++;

      // 1. Assign random state IDs to each block
      const originalEntry = func.blocks[0]!;
      const stateMap = new Map<string, number>();
      const blockOrder = ctx.rng.shuffle(func.blocks.filter((b) => b.id !== originalEntry.id));
      for (const block of func.blocks) {
        stateMap.set(block.id, ctx.rng.nextRange(1000, 0x7fffffff));
      }

      // 2. Find max register to allocate state register beyond current usage
      const maxReg = getMaxRegister(func) - 1;
      const stateReg = `r${maxReg + 1}` as Register;
      const tempReg = `r${maxReg + 2}` as Register;
      const tableReg = `r${maxReg + 3}` as Register;
      const primeReg = `r${maxReg + 4}` as Register;
      const xorReg = `r${maxReg + 5}` as Register;
      const fnvReg = `r${maxReg + 6}` as Register;
      const mulReg = `r${maxReg + 7}` as Register;
      const maskReg = `r${maxReg + 8}` as Register;
      const hashReg = `r${maxReg + 9}` as Register;
      const sizeReg = `r${maxReg + 10}` as Register;
      const idxReg = `r${maxReg + 11}` as Register;
      const targetReg = `r${maxReg + 12}` as Register;
      const constIdxReg = `r${maxReg + 13}` as Register;
      const constLblReg = `r${maxReg + 14}` as Register;

      // 3. Add state constants to constant pool
      const stateConstants = new Map<number, number>(); // stateId -> cpIndex
      for (const [blockId, stateId] of stateMap) {
        const cpIdx = constantPool.length;
        constantPool.push({ index: cpIdx, kind: ConstantKind.Number, value: stateId });
        stateConstants.set(stateId, cpIdx);
      }

      const numberCache = new Map<number, number>();
      const stringCache = new Map<string, number>();

      const getOrAddNumberConstant = (val: number): number => {
        const cached = numberCache.get(val);
        if (cached !== undefined) return cached;
        const idx = constantPool.findIndex((c) => c.kind === ConstantKind.Number && c.value === val);
        if (idx !== -1) {
          numberCache.set(val, idx);
          return idx;
        }
        const newIdx = constantPool.length;
        constantPool.push({ index: newIdx, kind: ConstantKind.Number, value: val });
        numberCache.set(val, newIdx);
        return newIdx;
      };

      const getOrAddStringConstant = (val: string): number => {
        const cached = stringCache.get(val);
        if (cached !== undefined) return cached;
        const idx = constantPool.findIndex((c) => c.kind === ConstantKind.String && c.value === val);
        if (idx !== -1) {
          stringCache.set(val, idx);
          return idx;
        }
        const newIdx = constantPool.length;
        constantPool.push({ index: newIdx, kind: ConstantKind.String, value: val });
        stringCache.set(val, newIdx);
        return newIdx;
      };

      // 4. Build the dispatcher block
      const dispatcherId = `__cff_dispatch_${ctx.rng.identifier(6)}`;
      const exitId = `__cff_exit_${ctx.rng.identifier(4)}`;
      const entryStateId = stateMap.get(originalEntry.id)!;

      // 5. Transform each original block into a case block
      // Each block ends by setting stateReg to the next state and jumping back to dispatcher
      const caseBlocks: BasicBlock[] = [];

      const translateBlockTerminator = (
        block: BasicBlock,
        currentBlockId: string,
      ): { instructions: Instruction[]; terminator: TerminatorInstruction } => {
        const insts: Instruction[] = [];
        let term: TerminatorInstruction;

        if (block.terminator.kind === 'return' || block.terminator.kind === 'throw') {
          term = block.terminator;
        } else if (block.terminator.kind === 'jump') {
          const sourceState = stateMap.get(block.id)!;
          const targetState = stateMap.get(block.terminator.targets[0]!)!;
          const transitionKey = sourceState ^ targetState;
          const keyIdx = getOrAddNumberConstant(transitionKey);
          insts.push(
            {
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: keyIdx }],
              result: tempReg,
            },
            {
              opcode: OpCode.BitXor,
              operands: [
                { kind: OperandKind.Register, value: stateReg },
                { kind: OperandKind.Register, value: tempReg },
              ],
              result: stateReg,
            },
          );
          term = { kind: 'jump', targets: [dispatcherId] };
        } else if (block.terminator.kind === 'branch') {
          const trueState = stateMap.get(block.terminator.targets[0]!)!;
          const falseState = stateMap.get(block.terminator.targets[1]!)!;

          const trueBlockId = `__cff_br_t_${ctx.rng.identifier(4)}`;
          const falseBlockId = `__cff_br_f_${ctx.rng.identifier(4)}`;

          const sourceState = stateMap.get(block.id)!;
          const trueKey = sourceState ^ trueState;
          const falseKey = sourceState ^ falseState;

          caseBlocks.push({
            id: trueBlockId,
            label: 'cff_br_true',
            instructions: [
              {
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(trueKey) }],
                result: tempReg,
              },
              {
                opcode: OpCode.BitXor,
                operands: [
                  { kind: OperandKind.Register, value: stateReg },
                  { kind: OperandKind.Register, value: tempReg },
                ],
                result: stateReg,
              },
            ],
            terminator: { kind: 'jump', targets: [dispatcherId] },
            predecessors: [currentBlockId],
            successors: [dispatcherId],
            phiNodes: [],
          });
          caseBlocks.push({
            id: falseBlockId,
            label: 'cff_br_false',
            instructions: [
              {
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(falseKey) }],
                result: tempReg,
              },
              {
                opcode: OpCode.BitXor,
                operands: [
                  { kind: OperandKind.Register, value: stateReg },
                  { kind: OperandKind.Register, value: tempReg },
                ],
                result: stateReg,
              },
            ],
            terminator: { kind: 'jump', targets: [dispatcherId] },
            predecessors: [currentBlockId],
            successors: [dispatcherId],
            phiNodes: [],
          });

          term = {
            kind: 'branch',
            targets: [trueBlockId, falseBlockId],
            condition: block.terminator.condition,
          };
        } else {
          term = block.terminator;
        }

        return { instructions: insts, terminator: term };
      };

      for (const block of blockOrder) {
        const caseLabelId = `__cff_case_${block.id}_${ctx.rng.identifier(4)}`;
        const { instructions: termInsts, terminator: caseTerminator } = translateBlockTerminator(block, caseLabelId);

        caseBlocks.push({
          id: caseLabelId,
          label: `cff_case_${block.id}`,
          instructions: [...block.instructions, ...termInsts],
          terminator: caseTerminator,
          predecessors: [dispatcherId],
          successors: caseTerminator.targets || [],
          phiNodes: block.phiNodes || [],
        });
      }

      // Build perfect hashing table
      const orderedCases = [...caseBlocks.filter((b) => b.label?.startsWith('cff_case_'))];

      let tableSize = 1;
      while (tableSize < orderedCases.length) {
        tableSize *= 2;
      }

      // Find a prime that results in a collision-free mapping
      const primes = [
        31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97, 101, 103, 107, 109, 113, 127, 131, 137, 139, 149, 151, 157, 163, 167,
        173, 179, 181, 191, 193, 197, 199, 211, 223, 227, 229, 233, 239, 241, 251, 257, 263, 269, 271, 277, 281, 283, 293, 307, 311, 313,
        317, 331, 337, 347, 349, 353, 359, 367, 373, 379, 383, 389, 397,
      ];

      let selectedPrime = 31;
      let collisionFree = false;

      while (!collisionFree) {
        for (const prime of primes) {
          const seen = new Set<number>();
          let collision = false;
          for (const block of orderedCases) {
            const stateId = stateMap.get(block.label!.replace('cff_case_', '')!)!;
            const hash = Math.imul(stateId ^ prime, 16777619) & 0x7fffffff;
            const idx = hash % tableSize;
            if (seen.has(idx)) {
              collision = true;
              break;
            }
            seen.add(idx);
          }
          if (!collision) {
            selectedPrime = prime;
            collisionFree = true;
            break;
          }
        }
        if (!collisionFree) {
          tableSize *= 2;
        }
      }

      const tableSlots = new Map<number, string>();
      for (const caseBlock of orderedCases) {
        const stateId = stateMap.get(caseBlock.label!.replace('cff_case_', '')!)!;
        const hash = Math.imul(stateId ^ selectedPrime, 16777619) & 0x7fffffff;
        const slotIdx = hash % tableSize;
        tableSlots.set(slotIdx, caseBlock.id);
      }

      // Entry block: execute original entry block instructions, initialize jump table array, set next state (or return/throw), then jump to dispatcher
      const entryBlockId = `__cff_entry_${ctx.rng.identifier(4)}`;
      const entryBlockInstructions: Instruction[] = [
        // Initialize jump table array
        {
          opcode: OpCode.ArrayNew,
          operands: [],
          result: tableReg,
        },
        // Initialize state register to entryStateId
        {
          opcode: OpCode.LoadConst,
          operands: [{ kind: OperandKind.ConstantIndex, value: stateConstants.get(entryStateId)! }],
          result: stateReg,
        },
      ];

      // Populating the table array
      for (let i = 0; i < tableSize; i++) {
        const targetBlockId = tableSlots.get(i) || exitId;
        const valIdx = getOrAddNumberConstant(i);
        entryBlockInstructions.push(
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.BlockLabel, value: targetBlockId }],
            result: constLblReg,
          },
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: valIdx }],
            result: constIdxReg,
          },
          {
            opcode: OpCode.ComputedSet,
            operands: [
              { kind: OperandKind.Register, value: tableReg },
              { kind: OperandKind.Register, value: constIdxReg },
              { kind: OperandKind.Register, value: constLblReg },
            ],
          },
        );
      }

      // Append original entry instructions
      entryBlockInstructions.push(...originalEntry.instructions);

      // Translate original entry terminator
      const { instructions: entryTermInsts, terminator: entryTerminator } = translateBlockTerminator(originalEntry, entryBlockId);
      entryBlockInstructions.push(...entryTermInsts);

      const entryBlock: BasicBlock = {
        id: entryBlockId,
        label: 'cff_entry',
        instructions: entryBlockInstructions,
        terminator: entryTerminator,
        predecessors: [],
        successors: entryTerminator.targets || [],
        phiNodes: originalEntry.phiNodes || [],
      };

      // Real dispatcher block performing perfect hashing modulo jump table
      const dispatcherBlock: BasicBlock = {
        id: dispatcherId,
        label: 'cff_dispatcher',
        instructions: [
          // 1. Load prime
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(selectedPrime) }],
            result: primeReg,
          },
          // 2. BitXor: stateReg ^ primeReg
          {
            opcode: OpCode.BitXor,
            operands: [
              { kind: OperandKind.Register, value: stateReg },
              { kind: OperandKind.Register, value: primeReg },
            ],
            result: xorReg,
          },
          // 3. Load FNV-1a constant 16777619
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(16777619) }],
            result: fnvReg,
          },
          // 4. Call Math.imul(xorReg, fnvReg) -> mulReg
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddStringConstant('Math') }],
            result: constLblReg,
          },
          {
            opcode: OpCode.LoadGlobal,
            operands: [{ kind: OperandKind.Register, value: constLblReg }],
            result: constLblReg,
          },
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddStringConstant('imul') }],
            result: constIdxReg,
          },
          {
            opcode: OpCode.PropGet,
            operands: [
              { kind: OperandKind.Register, value: constLblReg },
              { kind: OperandKind.Register, value: constIdxReg },
            ],
            result: constIdxReg,
          },
          {
            opcode: OpCode.Call,
            operands: [
              { kind: OperandKind.Register, value: constIdxReg },
              { kind: OperandKind.Register, value: xorReg },
              { kind: OperandKind.Register, value: fnvReg },
            ],
            result: mulReg,
          },
          // 5. Load mask 0x7FFFFFFF
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(0x7fffffff) }],
            result: maskReg,
          },
          // 6. BitAnd: mulReg & maskReg
          {
            opcode: OpCode.BitAnd,
            operands: [
              { kind: OperandKind.Register, value: mulReg },
              { kind: OperandKind.Register, value: maskReg },
            ],
            result: hashReg,
          },
          // 7. Load table size
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(tableSize) }],
            result: sizeReg,
          },
          // 8. Mod: hashReg % sizeReg
          {
            opcode: OpCode.Mod,
            operands: [
              { kind: OperandKind.Register, value: hashReg },
              { kind: OperandKind.Register, value: sizeReg },
            ],
            result: idxReg,
          },
          // 9. ComputedGet: tableReg[idxReg] -> targetReg
          {
            opcode: OpCode.ComputedGet,
            operands: [
              { kind: OperandKind.Register, value: tableReg },
              { kind: OperandKind.Register, value: idxReg },
            ],
            result: targetReg,
          },
          // 6. Jmp targetReg
          {
            opcode: OpCode.Jmp,
            operands: [{ kind: OperandKind.Register, value: targetReg }],
          },
        ],
        terminator: { kind: 'dynamic_jmp', targets: [] },
        predecessors: [...(entryTerminator.targets?.includes(dispatcherId) ? [entryBlockId] : []), ...caseBlocks.map((b) => b.id)],
        successors: [],
        phiNodes: [],
      };

      // 6. Build decoy comparison chains as noise to confuse pattern scanners
      const decoyBlocks: BasicBlock[] = [];
      for (let i = 0; i < 2; i++) {
        const decoyCmpBlockId = `__cff_decoy_cmp_${i}_${ctx.rng.identifier(4)}`;
        const decoyCaseBlockId = `__cff_decoy_case_${i}_${ctx.rng.identifier(4)}`;
        const decoyNextBlockId = i === 0 ? `__cff_decoy_cmp_1_${ctx.rng.identifier(4)}` : exitId;
        const decoyStateId = ctx.rng.nextRange(1000, 0x7fffffff);
        const decoyStateIdx = getOrAddNumberConstant(decoyStateId);

        decoyBlocks.push(
          {
            id: decoyCmpBlockId,
            label: `cff_decoy_cmp_${i}`,
            instructions: [
              {
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: decoyStateIdx }],
                result: tempReg,
              },
              {
                opcode: OpCode.Eq,
                operands: [
                  { kind: OperandKind.Register, value: stateReg },
                  { kind: OperandKind.Register, value: tempReg },
                ],
                result: tempReg,
              },
            ],
            terminator: {
              kind: 'branch',
              targets: [decoyCaseBlockId, decoyNextBlockId],
              condition: tempReg,
            },
            predecessors: [],
            successors: [decoyCaseBlockId, decoyNextBlockId],
            phiNodes: [],
          },
          {
            id: decoyCaseBlockId,
            label: `cff_decoy_case_${i}`,
            instructions: [
              {
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(decoyStateId ^ 0x12345678) }],
                result: tempReg,
              },
              {
                opcode: OpCode.BitXor,
                operands: [
                  { kind: OperandKind.Register, value: stateReg },
                  { kind: OperandKind.Register, value: tempReg },
                ],
                result: stateReg,
              },
            ],
            terminator: {
              kind: 'jump',
              targets: [dispatcherId],
            },
            predecessors: [decoyCmpBlockId],
            successors: [dispatcherId],
            phiNodes: [],
          },
        );
      }

      // Exit block (trap / unreachable)
      const exitBlock: BasicBlock = {
        id: exitId,
        label: 'cff_exit',
        instructions: [],
        terminator: { kind: 'return', targets: [] },
        predecessors: [],
        successors: [],
        phiNodes: [],
      };

      // 7. Assemble all blocks in shuffled order
      const allBlocks = ctx.rng.shuffle([entryBlock, dispatcherBlock, ...decoyBlocks, ...caseBlocks, exitBlock]);

      // Entry must be first
      const entryIdx = allBlocks.findIndex((b) => b.id === entryBlockId);
      if (entryIdx > 0) {
        [allBlocks[0], allBlocks[entryIdx]] = [allBlocks[entryIdx]!, allBlocks[0]!];
      }

      const newLocals = [
        { name: 'cff_state', register: stateReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_temp', register: tempReg, type: IRType.Any, isCaptured: false },
        { name: 'cff_table', register: tableReg, type: IRType.Any, isCaptured: false },
        { name: 'cff_prime', register: primeReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_xor', register: xorReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_fnv', register: fnvReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_mul', register: mulReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_mask', register: maskReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_hash', register: hashReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_size', register: sizeReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_idx', register: idxReg, type: IRType.Number, isCaptured: false },
        { name: 'cff_target', register: targetReg, type: IRType.Any, isCaptured: false },
        { name: 'cff_const_idx', register: constIdxReg, type: IRType.Any, isCaptured: false },
        { name: 'cff_const_lbl', register: constLblReg, type: IRType.Any, isCaptured: false },
      ];

      return {
        ...func,
        blocks: allBlocks,
        locals: [...func.locals, ...newLocals],
      };
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
