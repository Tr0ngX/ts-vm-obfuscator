import type { IRModule, BytecodeModule, VMBuildConfig, BytecodeFunction, Instruction } from '@tsvm/shared';
import { OpCode, OperandKind } from '@tsvm/shared';
import { generateRemappedOpcodes } from './opcodes.js';
import { encodeBytecode, encodeConstantPool } from './encoder.js';

export function compileToBytecode(irModule: IRModule, config: VMBuildConfig): BytecodeModule {
  const mapping = generateRemappedOpcodes(config.seed);
  const functions: BytecodeFunction[] = [];

  for (const irFn of irModule.functions) {
    if (irFn.isVirtualized) {
      // Flatten blocks into a linear instruction stream
      const flatInsts: Instruction[] = [];
      const blockOffsets = new Map<string, number>();

      for (const block of irFn.blocks) {
        blockOffsets.set(block.id, flatInsts.length);
        flatInsts.push(...block.instructions);
        
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
                { kind: OperandKind.Register, value: block.terminator.condition! },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[0]! },
                { kind: OperandKind.BlockLabel, value: block.terminator.targets[1]! }
              ]
            });
          } else if (block.terminator.kind === 'return') {
            const ops = block.terminator.returnValue
              ? [{ kind: OperandKind.Register, value: block.terminator.returnValue }]
              : [];
            flatInsts.push({
              opcode: OpCode.Return,
              operands: ops
            });
          }
          // 'unreachable' terminators produce no instruction — execution should never reach them
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
        maxRegisters: irFn.locals.length + irFn.params.length + 50,
        isEntryPoint: irFn.isExported
      });
    }
  }

  const constantPool = encodeConstantPool(irModule.constantPool, config.constantPoolEncoding, config.seed);

  return {
    magic: 0x54534F42,
    version: 1,
    buildId: `build_${config.seed}_${Date.now()}`,
    functions,
    constantPool,
    opcodeMapping: mapping,
    entryPointIndex: functions.findIndex(f => f.isEntryPoint),
    metadata: {
      buildTimestamp: Date.now(),
      buildId: `build_${config.seed}`,
      sourceHash: 'hash',
      profile: 'profile'
    }
  };
}
