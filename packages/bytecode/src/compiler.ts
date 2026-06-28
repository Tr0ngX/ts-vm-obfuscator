import type {
  IRModule,
  IRFunction,
  BytecodeModule,
  VMBuildConfig,
  BytecodeFunction,
  Instruction,
  Operand,
  ConstantPoolEntry,
} from '@tsvm/shared';
import { FunctionAttribute, OpCode, OperandKind, SeededRandom, ImmediateEncodingScheme, isVariableLengthOpcode, isTerminator } from '@tsvm/shared';
import { generateRemappedOpcodes } from './opcodes.js';
import { encodeBytecode, encodeConstantPool } from './encoder.js';

function collectMaxRegisterIndex(irFn: IRFunction): number {
  let maxRegister = -1;
  const consider = (value: unknown) => {
    if (typeof value !== 'string') {
      return;
    }
    const match = /^r(\d+)$/.exec(value);
    if (!match) {
      return;
    }
    maxRegister = Math.max(maxRegister, Number.parseInt(match[1]!, 10));
  };

  for (const param of irFn.params) {
    consider(param.register);
  }
  for (const local of irFn.locals) {
    consider(local.register);
  }
  for (const block of irFn.blocks) {
    if (block.phiNodes) {
      for (const phi of block.phiNodes) {
        consider(phi.result);
        for (const incoming of phi.incoming) {
          consider(incoming.register);
        }
      }
    }
    for (const inst of block.instructions) {
      consider(inst.result);
      for (const operand of inst.operands) {
        if (operand.kind === OperandKind.Register) {
          consider(operand.value);
        }
      }
    }
    consider(block.terminator.condition);
    consider(block.terminator.returnValue);
  }

  return maxRegister + 1;
}

function computeSourceHash(irModule: IRModule): string {
  let hash = 0x811c9dc5; // FNV offset basis
  const update = (val: number) => {
    hash ^= val & 0xff;
    hash = Math.imul(hash, 0x01000193); // FNV prime
  };
  for (const fn of irModule.functions) {
    for (const block of fn.blocks) {
      for (const inst of block.instructions) {
        update(inst.opcode);
        for (const op of inst.operands) {
          if (typeof op.kind === 'number') update(op.kind);
          if (typeof op.value === 'number') {
            update(op.value & 0xff);
            update((op.value >> 8) & 0xff);
            update((op.value >> 16) & 0xff);
            update((op.value >> 24) & 0xff);
          }
        }
      }
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function fuseInstructions(insts: Instruction[], config: VMBuildConfig): Instruction[] {
  if (!config.superInstructions) return insts;

  const rng = new SeededRandom(config.seed);
  const ids = rng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const loadConstMulId = ids[0]!;
  const getEntropyMulId = ids[1]!;
  const loadConstAddId = ids[2]!;

  const fused: Instruction[] = [];
  let i = 0;
  while (i < insts.length) {
    const inst1 = insts[i]!;
    const inst2 = insts[i + 1];

    if (inst2) {
      // Pattern 1: LoadConst + Mul
      if (
        inst1.opcode === OpCode.LoadConst &&
        inst2.opcode === OpCode.Mul &&
        inst1.operands[0]?.kind === OperandKind.ConstantIndex &&
        inst1.result &&
        inst2.result
      ) {
        let matched = false;
        let regX: any;
        if (inst2.operands[0]?.kind === OperandKind.Register && inst2.operands[0].value === inst1.result) {
          regX = inst2.operands[1];
          matched = true;
        } else if (inst2.operands[1]?.kind === OperandKind.Register && inst2.operands[1].value === inst1.result) {
          regX = inst2.operands[0];
          matched = true;
        }
        if (matched && regX) {
          fused.push({
            opcode: OpCode.SuperInstruction,
            operands: [
              { kind: OperandKind.Immediate, value: loadConstMulId },
              inst1.operands[0], // constIdx
              { kind: OperandKind.Register, value: inst1.result }, // regT
              regX, // regX
              { kind: OperandKind.Register, value: inst2.result }, // regR
            ],
          });
          i += 2;
          continue;
        }
      }

      // Pattern 2: GetEntropy + Mul (entropy * entropy)
      if (
        inst1.opcode === OpCode.GetEntropy &&
        inst2.opcode === OpCode.Mul &&
        inst1.result &&
        inst2.operands[0]?.kind === OperandKind.Register &&
        inst2.operands[0].value === inst1.result &&
        inst2.operands[1]?.kind === OperandKind.Register &&
        inst2.operands[1].value === inst1.result &&
        inst2.result
      ) {
        fused.push({
          opcode: OpCode.SuperInstruction,
          operands: [
            { kind: OperandKind.Immediate, value: getEntropyMulId },
            { kind: OperandKind.Register, value: inst1.result }, // regT
            { kind: OperandKind.Register, value: inst2.result }, // regR
          ],
        });
        i += 2;
        continue;
      }

      // Pattern 3: LoadConst + Add
      if (
        inst1.opcode === OpCode.LoadConst &&
        inst2.opcode === OpCode.Add &&
        inst1.operands[0]?.kind === OperandKind.ConstantIndex &&
        inst1.result &&
        inst2.operands[0]?.kind === OperandKind.Register &&
        inst2.operands[0].value === inst1.result &&
        inst2.operands[1]?.kind === OperandKind.Register &&
        inst2.result
      ) {
        fused.push({
          opcode: OpCode.SuperInstruction,
          operands: [
            { kind: OperandKind.Immediate, value: loadConstAddId },
            inst1.operands[0], // constIdx
            { kind: OperandKind.Register, value: inst1.result }, // regT
            inst2.operands[1], // regX (second operand)
            { kind: OperandKind.Register, value: inst2.result }, // regR
          ],
        });
        i += 2;
        continue;
      }
    }

    fused.push(inst1);
    i++;
  }
  return fused;
}

export function compileToBytecode(irModule: IRModule, config: VMBuildConfig): BytecodeModule {
  const mapping = generateRemappedOpcodes(config.seed);
  const functions: BytecodeFunction[] = [];
  const rng = new SeededRandom(config.seed);

  const duplicatedCP: ConstantPoolEntry[] = [];
  const tempFunctions: {
    irFn: IRFunction;
    flatInsts: Instruction[];
    blockInstIndices: Map<string, number>;
    maxRegs: number;
  }[] = [];

  // Pass 1: Build flatInsts, pre-resolve mapped opcodes, duplicate constant pool entries
  for (const irFn of irModule.functions) {
    if (irFn.isVirtualized) {
      const paramCount = irFn.params.length;
      const maxRegs = Math.max(collectMaxRegisterIndex(irFn), paramCount);
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
          const origId = Number.parseInt(match[1]!, 10);
          if (origId < paramCount) {
            return regStr;
          }
          const newId = originalToShuffledReg.get(origId) ?? origId;
          return `r${newId}`;
        }
        return regStr;
      };

      const blockInstIndices = new Map<string, number>();
      const flatInsts: Instruction[] = [];

      for (const block of irFn.blocks) {
        blockInstIndices.set(block.id, flatInsts.length);

        const mappedInstructions = block.instructions.map((inst) => {
          const mappedOperands = inst.operands.map((op) => {
            if (op.kind === OperandKind.Register) {
              return { ...op, value: mapReg(op.value) };
            }
            return { ...op };
          });

          return {
            ...inst,
            result: inst.result ? mapReg(inst.result) : undefined,
            operands: mappedOperands,
          };
        });

        const fusedInstructions = fuseInstructions(mappedInstructions, config);
        flatInsts.push(...fusedInstructions);

        if (block.terminator) {
          if (block.terminator.kind === 'jump') {
            flatInsts.push({
              opcode: OpCode.Jmp,
              operands: [{ kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! }],
            });
          } else if (block.terminator.kind === 'branch') {
            flatInsts.push({
              opcode: OpCode.JmpIf,
              operands: [
                { kind: OperandKind.Register, value: mapReg(block.terminator.condition!) },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[1]! },
              ],
            });
          } else if (block.terminator.kind === 'return') {
            if (block.terminator.returnValue) {
              flatInsts.push({
                opcode: OpCode.Return,
                operands: [{ kind: OperandKind.Register, value: mapReg(block.terminator.returnValue) }],
              });
            } else {
              flatInsts.push({
                opcode: OpCode.ReturnVoid,
                operands: [],
              });
            }
          } else if (block.terminator.kind === 'throw') {
            if (block.terminator.returnValue) {
              flatInsts.push({
                opcode: OpCode.Throw,
                operands: [{ kind: OperandKind.Register, value: mapReg(block.terminator.returnValue) }],
              });
            } else {
              flatInsts.push({
                opcode: OpCode.ReturnVoid,
                operands: [],
              });
            }
          } else if (block.terminator.kind === 'unreachable') {
            flatInsts.push({
              opcode: OpCode.Halt,
              operands: [],
            });
          } else if (block.terminator.kind === 'switch') {
            flatInsts.push({
              opcode: OpCode.Halt,
              operands: [],
            });
          } else if (block.terminator.kind === 'dynamic_jmp') {
            flatInsts.push({
              opcode: OpCode.Halt,
              operands: [],
            });
          }
        }
      }

      // Pre-resolve mapped opcodes to make them available for expectedPathHash calculation
      for (const inst of flatInsts) {
        let mappedOp = inst.opcode;
        const forward = mapping.forward.get(inst.opcode);
        if (Array.isArray(forward)) {
          mappedOp = (forward as readonly OpCode[])[Math.floor(rng.next() * forward.length)]!;
        } else if (forward !== undefined) {
          mappedOp = forward as OpCode;
        }
        inst.mappedOp = mappedOp;
      }

      // Duplicate constant pool entries, mapping expected path hash values
      let expectedPathHash = 0;
      for (const inst of flatInsts) {
        expectedPathHash = (Math.imul(expectedPathHash, 31) + inst.mappedOp!) & 0xffffffff;
        for (const op of inst.operands) {
          if (op.kind === OperandKind.ConstantIndex) {
            const origIdx = op.value as number;
            const origEntry = irModule.constantPool[origIdx]!;
            const newIdx = duplicatedCP.length;
            duplicatedCP.push({
              ...origEntry,
              index: newIdx,
              expectedPathHash: config.rollingKeys ? expectedPathHash : undefined,
            });
            op.value = newIdx;
          }
        }
        if (isTerminator(inst.opcode)) {
          expectedPathHash = 0;
        }
      }

      tempFunctions.push({
        irFn,
        flatInsts,
        blockInstIndices,
        maxRegs,
      });
    }
  }

  // Pass 2: Shuffle duplicated constant pool
  const cpLength = duplicatedCP.length;
  const originalIndices = Array.from({ length: cpLength }, (_, i) => i);
  const shuffledIndices = rng.shuffle([...originalIndices]);

  const duplicatedToShuffled = new Map<number, number>();
  shuffledIndices.forEach((origIdx, shuffledIdx) => {
    duplicatedToShuffled.set(origIdx, shuffledIdx);
  });

  const shuffledCP: ConstantPoolEntry[] = new Array(cpLength);
  shuffledIndices.forEach((origIdx, shuffledIdx) => {
    shuffledCP[shuffledIdx] = {
      ...duplicatedCP[origIdx]!,
      index: shuffledIdx,
    };
  });

  // Pass 3: Update indices, resolve block label offsets, build final functions
  for (const temp of tempFunctions) {
    const { irFn, flatInsts, blockInstIndices, maxRegs } = temp;

    // Update ConstantIndex operands with shuffled indices
    for (const inst of flatInsts) {
      for (const op of inst.operands) {
        if (op.kind === OperandKind.ConstantIndex) {
          const dupIdx = op.value as number;
          op.value = duplicatedToShuffled.get(dupIdx) ?? dupIdx;
        }
      }
    }

    // Resolve block label offsets using Fixed-Point Iteration (Two-Pass)
    const instByteOffset: number[] = new Array(flatInsts.length).fill(0);
    let changed = true;
    let iterations = 0;
    const MAX_ITERATIONS = 100;

    while (changed && iterations < MAX_ITERATIONS) {
      iterations++;
      changed = false;
      let currentOffset = 0;

      for (let i = 0; i < flatInsts.length; i++) {
        if (instByteOffset[i] !== currentOffset) {
          instByteOffset[i] = currentOffset;
          changed = true;
        }

        const inst = flatInsts[i]!;

        let mappedOp: number = inst.mappedOp ?? inst.opcode;
        if (inst.mappedOp === undefined) {
          const forward = mapping.forward.get(inst.opcode);
          if (Array.isArray(forward)) mappedOp = forward[0]!;
          else if (typeof forward === 'number') mappedOp = forward;
        }

        let size = 1; // opcode
        if (config.junkInsertion) {
          const numJunk = (inst.opcode * 7 + config.seed) % 4;
          size += numJunk; // junk bytes
        }

        const ops: Operand[] = [...(inst.operands || [])];
        if (inst.result && inst.opcode !== OpCode.Nop) {
          ops.push({ kind: OperandKind.Register, value: inst.result });
        }

        const isVarLength = isVariableLengthOpcode(inst.opcode);
        if (isVarLength) {
          size += 1; // argCount
        }

        for (let opIdx = 0; opIdx < ops.length; opIdx++) {
          const op = ops[opIdx]!;
          size += 1; // kindNum

          let val = 0;
          if (op.kind === OperandKind.BlockLabel) {
            const targetIdx = blockInstIndices.get(op.value as string)!;
            val = instByteOffset[targetIdx] ?? 0;
          } else if (typeof op.value === 'string' && op.value.startsWith('r')) {
            val = Number.parseInt(op.value.substring(1), 10);
          } else if (typeof op.value === 'number') {
            val = op.value;
          }

          if (config.immediateEncoding === ImmediateEncodingScheme.VariableLength) {
            // VariableLength
            let v = val;
            do {
              v >>>= 7;
              size++;
            } while (v !== 0);
          } else {
            size += 4;
          }
        }
        currentOffset += size;
      }
    }

    // Patch block labels definitively
    for (const inst of flatInsts) {
      if (inst.opcode === OpCode.Jmp || inst.opcode === OpCode.JmpIf || inst.opcode === OpCode.JmpIfNot) {
        const ops = inst.operands!;
        if (inst.opcode === OpCode.Jmp) {
          if (ops[0]!.kind === OperandKind.BlockLabel || (typeof ops[0]!.value === 'string' && blockInstIndices.has(ops[0]!.value))) {
            const targetIdx = blockInstIndices.get(ops[0]!.value as string)!;
            ops[0]!.value = instByteOffset[targetIdx]!;
            ops[0]!.kind = OperandKind.Immediate;
          }
        } else if (inst.opcode === OpCode.JmpIf || inst.opcode === OpCode.JmpIfNot) {
          const targetTrueIdx = blockInstIndices.get(ops[1]!.value as string)!;
          const targetFalseIdx = blockInstIndices.get(ops[2]!.value as string)!;
          ops[1]!.value = instByteOffset[targetTrueIdx]!;
          ops[1]!.kind = OperandKind.Immediate;
          ops[2]!.value = instByteOffset[targetFalseIdx]!;
          ops[2]!.kind = OperandKind.Immediate;
        }
      } else {
        for (const op of inst.operands) {
          if (op.kind === OperandKind.BlockLabel) {
            const targetIdx = blockInstIndices.get(op.value as string)!;
            op.value = instByteOffset[targetIdx]!;
            op.kind = OperandKind.Immediate;
          }
        }
      }
    }

    const bytecode = encodeBytecode(flatInsts, mapping, config, rng);

    functions.push({
      id: irFn.id,
      name: irFn.name,
      bytecode,
      paramCount: irFn.params.length,
      localCount: irFn.locals.length,
      maxRegisters: maxRegs,
      attributes: irFn.attributes,
      isEntryPoint: !irFn.attributes.includes(FunctionAttribute.Nested) && (irFn.isVirtualized || irFn.isExported),
    });
  }

  const shuffledFunctions = rng.shuffle([...functions]);

  const constantPool = encodeConstantPool(shuffledCP, config.constantPoolEncoding, config.seed);

  const sourceFileName =
    irModule.sourceFile
      .split(/[\\/]/)
      .pop()
      ?.replace(/[^a-zA-Z0-9]/g, '_') ?? 'unknown';

  return {
    magic: 0x54534f42,
    version: 1,
    buildId: `build_${config.seed}_${sourceFileName}`,
    functions: shuffledFunctions,
    constantPool,
    opcodeMapping: mapping,
    entryPointIndex: shuffledFunctions.findIndex((f) => f.isEntryPoint),
    metadata: {
      buildTimestamp: Date.now(),
      buildId: `build_${config.seed}`,
      sourceHash: computeSourceHash(irModule),
      profile: config.profile ?? 'generic',
      deterministicSeed: config.seed,
    },
  };
}
