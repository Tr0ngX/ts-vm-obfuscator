import type { IRModule, BytecodeModule, VMBuildConfig, BytecodeFunction, Instruction, ConstantPoolEntry } from '@tsvm/shared';
import { OpCode, OperandKind, SeededRandom } from '@tsvm/shared';
import { generateRemappedOpcodes } from './opcodes.js';
import { encodeBytecode, encodeConstantPool } from './encoder.js';

export function compileToBytecode(irModule: IRModule, config: VMBuildConfig): BytecodeModule {
  const mapping = generateRemappedOpcodes(config.seed);
  const functions: BytecodeFunction[] = [];
  const rng = new SeededRandom(config.seed);

  // 1. Shuffle constant pool index if enabled
  const originalCP = [...irModule.constantPool];
  const cpLength = originalCP.length;
  
  const originalIndices = Array.from({ length: cpLength }, (_, i) => i);
  const shuffledIndices = rng.shuffle([...originalIndices]);
  
  const originalToShuffled = new Map<number, number>();
  shuffledIndices.forEach((origIdx, shuffledIdx) => {
    originalToShuffled.set(origIdx, shuffledIdx);
  });
  
  const shuffledCP: ConstantPoolEntry[] = new Array(cpLength);
  shuffledIndices.forEach((origIdx, shuffledIdx) => {
    shuffledCP[shuffledIdx] = {
      ...originalCP[origIdx]!,
      index: shuffledIdx
    };
  });

  for (const irFn of irModule.functions) {
    if (irFn.isVirtualized) {
      // 2. Local symbol / Register ID Shuffle
      const paramCount = irFn.params.length;
      const maxRegs = irFn.locals.length + paramCount + 150;
      const regIds = Array.from({ length: maxRegs - paramCount }, (_, i) => i + paramCount);
      const shuffledRegIds = rng.shuffle([...regIds]);

      const originalToShuffledReg = new Map<number, number>();
      regIds.forEach((origId, shuffledIdx) => {
        originalToShuffledReg.set(origId, shuffledRegIds[shuffledIdx]!);
      });

      const mapReg = (regStr: any): any => {
        if (typeof regStr !== 'string') return regStr;
        const match = /^r(\d+)$/.exec(regStr);
        if (match) {
          const origId = parseInt(match[1]!, 10);
          if (origId < paramCount) {
            return regStr;
          }
          const newId = originalToShuffledReg.get(origId) ?? origId;
          return `r${newId}`;
        }
        return regStr;
      };

      // Flatten blocks into a linear instruction stream
      const flatInsts: Instruction[] = [];
      const blockOffsets = new Map<string, number>();

      for (const block of irFn.blocks) {
        blockOffsets.set(block.id, flatInsts.length);
        
        // Map instruction registers and constant pool indices
        const mappedInstructions = block.instructions.map(inst => {
          const mappedOperands = inst.operands.map(op => {
            if (op.kind === OperandKind.Register) {
              return { ...op, value: mapReg(op.value) };
            }
            if (op.kind === OperandKind.ConstantIndex) {
              const origIdx = op.value as number;
              return { ...op, value: originalToShuffled.get(origIdx) ?? origIdx };
            }
            return op;
          });

          return {
            ...inst,
            result: inst.result ? mapReg(inst.result) : undefined,
            operands: mappedOperands
          };
        });

        flatInsts.push(...mappedInstructions);
        
        // Convert terminators to pseudo-instructions
        if (block.terminator) {
          if (block.terminator.kind === 'jump') {
            flatInsts.push({
              opcode: OpCode.Jmp,
              operands: [{ kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! }]
            });
          } else if (block.terminator.kind === 'branch') {
            flatInsts.push({
              opcode: OpCode.JmpIf,
              operands: [
                { kind: OperandKind.Register, value: mapReg(block.terminator.condition!) },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[1]! }
              ]
            });
          } else if (block.terminator.kind === 'return') {
            const ops = block.terminator.returnValue
              ? [{ kind: OperandKind.Register, value: mapReg(block.terminator.returnValue) }]
              : [];
            flatInsts.push({
              opcode: OpCode.Return,
              operands: ops
            });
          }
        }
      }

      // Compute byte offsets for each instruction
      const instByteOffset: number[] = [];
      let currentOffset = 0;

      for (const inst of flatInsts) {
        instByteOffset.push(currentOffset);
        let argsLen = inst.operands?.length || 0;
        if (inst.result) argsLen++;
        currentOffset += 1 + 1 + (argsLen * 5); // op(1) + argCount(1) + args * (kind(1) + val(4))
      }

      // Patch block labels in jump/branch instructions to byte offsets
      for (const inst of flatInsts) {
        if (inst.opcode === OpCode.Jmp || inst.opcode === OpCode.JmpIf) {
          for (const op of inst.operands) {
            if (typeof op.value === 'string' && blockOffsets.has(op.value)) {
              const instIndex = blockOffsets.get(op.value)!;
              (op as any).value = instByteOffset[instIndex]!;
              (op as any).kind = OperandKind.Immediate;
            }
          }
        }
      }

      // Encode instructions to bytecode
      const bytecode = encodeBytecode(flatInsts, mapping, config);

      functions.push({
        id: irFn.id,
        name: irFn.name,
        bytecode,
        paramCount: irFn.params.length,
        localCount: irFn.locals.length,
        maxRegisters: maxRegs,
        isEntryPoint: irFn.isExported
      });
    }
  }

  // Shuffle functions order deterministic based on seed
  const shuffledFunctions = rng.shuffle([...functions]);

  const constantPool = encodeConstantPool(shuffledCP, config.constantPoolEncoding, config.seed);

  return {
    magic: 0x54534F42,
    version: 1,
    buildId: `build_${config.seed}_${Date.now()}`,
    functions: shuffledFunctions,
    constantPool,
    opcodeMapping: mapping,
    entryPointIndex: shuffledFunctions.findIndex(f => f.isEntryPoint),
    metadata: {
      buildTimestamp: Date.now(),
      buildId: `build_${config.seed}`,
      sourceHash: 'TODO',
      profile: 'generic',
      deterministicSeed: config.seed
    }
  };
}
