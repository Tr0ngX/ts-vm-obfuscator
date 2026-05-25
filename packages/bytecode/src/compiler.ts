import type { IRModule, BytecodeModule, VMBuildConfig, BytecodeFunction, Instruction, ConstantPoolEntry } from '@tsvm/shared';
import { FunctionAttribute, OpCode, OperandKind, SeededRandom } from '@tsvm/shared';
import { generateRemappedOpcodes } from './opcodes.js';
import { encodeBytecode, encodeConstantPool } from './encoder.js';

export function compileToBytecode(irModule: IRModule, config: VMBuildConfig): BytecodeModule {
  const bcFunctions: BytecodeFunction[] = [];
  let entryPointIndex = -1;

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

      // 1. Resolve block instruction indices
      const blockInstIndices = new Map<string, number>();
      const flatInsts: Instruction[] = [];

      for (const block of irFn.blocks) {
        blockInstIndices.set(block.id, flatInsts.length);
        
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
              operands: [
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! },
                ...(config.rollingKeys ? [{ kind: OperandKind.Immediate, value: 0 }] : [])
              ]
            });
          } else if (block.terminator.kind === 'branch') {
            flatInsts.push({
              opcode: OpCode.JmpIf,
              operands: [
                { kind: OperandKind.Register, value: mapReg(block.terminator.condition!) },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[1]! },
                ...(config.rollingKeys ? [{ kind: OperandKind.Immediate, value: 0 }, { kind: OperandKind.Immediate, value: 0 }] : [])
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
          } else if (block.terminator.kind === 'throw') {
            const ops = block.terminator.returnValue
              ? [{ kind: OperandKind.Register, value: mapReg(block.terminator.returnValue) }]
              : [];
            flatInsts.push({
              opcode: OpCode.Throw,
              operands: ops,
            });
          }
        }
      }

      // 2. Compute byte offsets using Fixed-Point Iteration (Two-Pass)
      const instByteOffset: number[] = new Array(flatInsts.length).fill(0);
      const instRollingKey: number[] = new Array(flatInsts.length).fill(0);
      let changed = true;

      // Helper to calculate LEB128 size
      const getLeb128Size = (val: number) => {
        let size = 0;
        let v = val;
        do {
          v >>>= 7;
          size++;
        } while (v !== 0);
        return size;
      };

      while (changed) {
        changed = false;
        let currentOffset = 0;
        let currentRollingKey = config.rollingKeys ? config.seed & 0xFF : 0;

        for (let i = 0; i < flatInsts.length; i++) {
          if (instByteOffset[i] !== currentOffset) {
            instByteOffset[i] = currentOffset;
            changed = true;
          }
          if (instRollingKey[i] !== currentRollingKey) {
            instRollingKey[i] = currentRollingKey;
            changed = true;
          }

          const inst = flatInsts[i]!;
          
          // Determine mapped opcode for rolling key trace
          let mappedOp = inst.opcode;
          const forward = mapping.forward.get(inst.opcode);
          if (Array.isArray(forward)) mappedOp = forward[0]!;
          else if (forward !== undefined) mappedOp = forward as number;

          let size = 1; // opcode
          if (config.rollingKeys) currentRollingKey = (currentRollingKey + mappedOp) & 0xFF;

          const ops = [...(inst.operands || [])];
          if (inst.result) {
            ops.push({ kind: OperandKind.Register, value: inst.result } as any);
          }

          size += 1; // argCount
          if (config.rollingKeys) currentRollingKey = (currentRollingKey + ops.length) & 0xFF;

          for (let opIdx = 0; opIdx < ops.length; opIdx++) {
            const op = ops[opIdx]!;
            size += 1; // kindNum
            let kindNum = op.kind;
            if (typeof kindNum === 'string') {
              if (kindNum === 'register') kindNum = 0 as any;
              else if (kindNum === 'immediate') kindNum = 1 as any;
              else if (kindNum === 'constant_index') kindNum = 2 as any;
              else if (kindNum === 'block_label') kindNum = 3 as any;
              else kindNum = 0 as any;
            }
            if (config.rollingKeys) currentRollingKey = (currentRollingKey + (kindNum as unknown as number)) & 0xFF;

            let val = 0;
            if (op.kind === OperandKind.BlockLabel || op.kind === 'block_label' as any) {
              const targetIdx = blockInstIndices.get(op.value as string)!;
              val = instByteOffset[targetIdx] || 0;
            } else if (typeof op.value === 'string' && op.value.startsWith('r')) {
              val = parseInt(op.value.substring(1), 10);
            } else if (typeof op.value === 'number') {
              val = op.value;
            }

            // Sync rolling key for jumps
            if (config.rollingKeys && inst.opcode === OpCode.Jmp && opIdx === 1) {
              const targetIdx = blockInstIndices.get(ops[0]!.value as string)!;
              val = instRollingKey[targetIdx] || 0;
            } else if (config.rollingKeys && inst.opcode === OpCode.JmpIf && opIdx === 3) {
              const targetIdx = blockInstIndices.get(ops[1]!.value as string)!;
              val = instRollingKey[targetIdx] || 0;
            } else if (config.rollingKeys && inst.opcode === OpCode.JmpIf && opIdx === 4) {
              const targetIdx = blockInstIndices.get(ops[2]!.value as string)!;
              val = instRollingKey[targetIdx] || 0;
            }

            if (config.immediateEncoding === 1) { // VariableLength
              let v = val;
              do {
                let byte = v & 0x7F;
                v >>>= 7;
                if (v !== 0) byte |= 0x80;
                size++;
                if (config.rollingKeys) currentRollingKey = (currentRollingKey + byte) & 0xFF;
              } while (v !== 0);
            } else {
              size += 4;
              if (config.rollingKeys) {
                currentRollingKey = (currentRollingKey + (val & 0xFF)) & 0xFF;
                currentRollingKey = (currentRollingKey + ((val >> 8) & 0xFF)) & 0xFF;
                currentRollingKey = (currentRollingKey + ((val >> 16) & 0xFF)) & 0xFF;
                currentRollingKey = (currentRollingKey + ((val >> 24) & 0xFF)) & 0xFF;
              }
            }
          }
          currentOffset += size;
        }
      }

      // 3. Patch block labels and sync keys definitively
      for (const inst of flatInsts) {
        if (inst.opcode === OpCode.Jmp || inst.opcode === OpCode.JmpIf) {
          const ops = inst.operands!;
          if (inst.opcode === OpCode.Jmp) {
             const targetIdx = blockInstIndices.get(ops[0]!.value as string)!;
             (ops[0] as any).value = instByteOffset[targetIdx]!;
             (ops[0] as any).kind = OperandKind.Immediate;
             if (config.rollingKeys) {
               (ops[1] as any).value = instRollingKey[targetIdx]!;
             }
          } else if (inst.opcode === OpCode.JmpIf) {
             const targetTrueIdx = blockInstIndices.get(ops[1]!.value as string)!;
             const targetFalseIdx = blockInstIndices.get(ops[2]!.value as string)!;
             (ops[1] as any).value = instByteOffset[targetTrueIdx]!;
             (ops[1] as any).kind = OperandKind.Immediate;
             (ops[2] as any).value = instByteOffset[targetFalseIdx]!;
             (ops[2] as any).kind = OperandKind.Immediate;
             if (config.rollingKeys) {
               (ops[3] as any).value = instRollingKey[targetTrueIdx]!;
               (ops[4] as any).value = instRollingKey[targetFalseIdx]!;
             }
          }
        } else {
          for (const op of inst.operands) {
            if (op.kind === OperandKind.BlockLabel || op.kind === 'block_label' as any) {
              const targetIdx = blockInstIndices.get(op.value as string)!;
              (op as any).value = instByteOffset[targetIdx]!;
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
        isEntryPoint: !irFn.attributes.includes(FunctionAttribute.Nested) && (irFn.isVirtualized || irFn.isExported)
      });
    }
  }

  // Shuffle functions order deterministic based on seed
  const shuffledFunctions = rng.shuffle([...functions]);

  const constantPool = encodeConstantPool(shuffledCP, config.constantPoolEncoding, config.seed);

  return {
    magic: 0x54534F42,
    version: 1,
    buildId: `build_${config.seed}_${Date.now()}_${irModule.sourceFile.split(/[\\/]/).pop()?.replace(/[^a-zA-Z0-9]/g, '_')}`,
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
