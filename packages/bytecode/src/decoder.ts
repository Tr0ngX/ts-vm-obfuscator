import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry, BytecodeModule } from '@tsvm/shared';
import {
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
  OperandKind,
  OpCode,
  ConstantKind,
  isVariableLengthOpcode,
  isTerminator,
} from '@tsvm/shared';

import type { VMBuildConfig } from '@tsvm/shared';

class DecoderError extends Error {
  constructor(message: string) {
    super(`[Decoder] ${message}`);
    this.name = 'DecoderError';
  }
}

function assertOpCode(value: number): OpCode {
  if (Object.values(OpCode).includes(value as OpCode)) {
    return value as OpCode;
  }
  throw new DecoderError(`Invalid opcode: ${value}`);
}

function numToOperandKind(kind: number): OperandKind {
  switch (kind) {
    case 0:
      return OperandKind.Register;
    case 1:
      return OperandKind.Immediate;
    case 2:
      return OperandKind.ConstantIndex;
    case 3:
      return OperandKind.BlockLabel;
    case 4:
      return OperandKind.FunctionRef;
    default:
      throw new DecoderError(`Unknown operand kind: ${kind}`);
  }
}

function unrollKeys(bytes: Uint8Array, seed: number): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let pc = 0; pc < bytes.length; pc++) {
    const encoded = bytes[pc]!;
    const rollingKey = ((seed ^ (pc * 0x9e3779b9)) >>> 8) & 0xff;
    const offsetVal = encoded ^ rollingKey;
    result[pc] = (offsetVal - pc) & 0xff;
  }
  return result;
}

function unrollParanoid(bytes: Uint8Array, seed: number): Uint8Array {
  const result = new Uint8Array(bytes.length);
  for (let pc = 0; pc < bytes.length; pc++) {
    const mask = (pc * 31 + seed) & 0xff;
    result[pc] = bytes[pc]! ^ mask;
  }
  return result;
}

function readLEB128(bytes: Uint8Array, offset: { pos: number }): number {
  if (offset.pos >= bytes.length) throw new DecoderError('Bytecode truncated (LEB128)');
  let val = 0;
  let shift = 0;
  let b = 0;
  do {
    if (offset.pos >= bytes.length) throw new DecoderError('Bytecode truncated (LEB128)');
    b = bytes[offset.pos++]!;
    val |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  return val;
}

function readFixed32(bytes: Uint8Array, offset: { pos: number }): number {
  if (offset.pos + 3 >= bytes.length) throw new DecoderError('Bytecode truncated (fixed32)');
  const b0 = bytes[offset.pos++]!;
  const b1 = bytes[offset.pos++]!;
  const b2 = bytes[offset.pos++]!;
  const b3 = bytes[offset.pos++]!;
  return (b3 << 24) | (b2 << 16) | (b1 << 8) | b0;
}

const OPCODE_DEFAULT_LAYOUT = { inputCount: 0, hasResult: false };

const opcodeLayout: Partial<Record<OpCode, { inputCount: number; hasResult: boolean }>> = {
  [OpCode.Nop]: { inputCount: 0, hasResult: false },
  [OpCode.Halt]: { inputCount: 0, hasResult: false },
  [OpCode.Trap]: { inputCount: 0, hasResult: false },
  [OpCode.LoadConst]: { inputCount: 1, hasResult: true },
  [OpCode.LoadLocal]: { inputCount: 1, hasResult: true },
  [OpCode.StoreLocal]: { inputCount: 2, hasResult: false },
  [OpCode.Move]: { inputCount: 2, hasResult: false },
  [OpCode.LoadGlobal]: { inputCount: 1, hasResult: true },
  [OpCode.StoreGlobal]: { inputCount: 2, hasResult: false },
  [OpCode.LoadThis]: { inputCount: 0, hasResult: true },
  [OpCode.LoadNewTarget]: { inputCount: 0, hasResult: true },
  [OpCode.Add]: { inputCount: 2, hasResult: true },
  [OpCode.Sub]: { inputCount: 2, hasResult: true },
  [OpCode.Mul]: { inputCount: 2, hasResult: true },
  [OpCode.Div]: { inputCount: 2, hasResult: true },
  [OpCode.Mod]: { inputCount: 2, hasResult: true },
  [OpCode.Neg]: { inputCount: 1, hasResult: true },
  [OpCode.BitAnd]: { inputCount: 2, hasResult: true },
  [OpCode.BitOr]: { inputCount: 2, hasResult: true },
  [OpCode.BitXor]: { inputCount: 2, hasResult: true },
  [OpCode.Shl]: { inputCount: 2, hasResult: true },
  [OpCode.Shr]: { inputCount: 2, hasResult: true },
  [OpCode.UShr]: { inputCount: 2, hasResult: true },
  [OpCode.Eq]: { inputCount: 2, hasResult: true },
  [OpCode.StrictEq]: { inputCount: 2, hasResult: true },
  [OpCode.Lt]: { inputCount: 2, hasResult: true },
  [OpCode.LtEq]: { inputCount: 2, hasResult: true },
  [OpCode.Gt]: { inputCount: 2, hasResult: true },
  [OpCode.GtEq]: { inputCount: 2, hasResult: true },
  [OpCode.Not]: { inputCount: 1, hasResult: true },
  [OpCode.TypeOf]: { inputCount: 1, hasResult: true },
  [OpCode.InstanceOf]: { inputCount: 2, hasResult: true },
  [OpCode.In]: { inputCount: 2, hasResult: true },
  [OpCode.Jmp]: { inputCount: 1, hasResult: false },
  [OpCode.JmpIf]: { inputCount: 3, hasResult: false },
  [OpCode.JmpIfNot]: { inputCount: 3, hasResult: false },
  [OpCode.Call]: { inputCount: 1, hasResult: true },
  [OpCode.CallMethod]: { inputCount: 2, hasResult: true },
  [OpCode.New]: { inputCount: 1, hasResult: true },
  [OpCode.Return]: { inputCount: 1, hasResult: false },
  [OpCode.ReturnVoid]: { inputCount: 0, hasResult: false },
  [OpCode.ClosureNew]: { inputCount: 1, hasResult: true },
  [OpCode.CellNew]: { inputCount: 1, hasResult: true },
  [OpCode.CellGet]: { inputCount: 1, hasResult: true },
  [OpCode.CellSet]: { inputCount: 2, hasResult: false },
  [OpCode.EnvGet]: { inputCount: 1, hasResult: true },
  [OpCode.CallWithArray]: { inputCount: 2, hasResult: true },
  [OpCode.CallMethodWithArray]: { inputCount: 3, hasResult: true },
  [OpCode.NewWithArray]: { inputCount: 2, hasResult: true },
  [OpCode.RestArgs]: { inputCount: 1, hasResult: true },
  [OpCode.PropGet]: { inputCount: 2, hasResult: true },
  [OpCode.PropSet]: { inputCount: 3, hasResult: false },
  [OpCode.ComputedGet]: { inputCount: 2, hasResult: true },
  [OpCode.ComputedSet]: { inputCount: 3, hasResult: false },
  [OpCode.ArrayNew]: { inputCount: 0, hasResult: true },
  [OpCode.ObjectNew]: { inputCount: 0, hasResult: true },
  [OpCode.Spread]: { inputCount: 2, hasResult: false },
  [OpCode.SpreadIntoArray]: { inputCount: 1, hasResult: true },
  [OpCode.Delete]: { inputCount: 2, hasResult: false },
  [OpCode.PrivateGet]: { inputCount: 2, hasResult: true },
  [OpCode.PrivateSet]: { inputCount: 3, hasResult: false },
  [OpCode.PrivateIn]: { inputCount: 2, hasResult: true },
  [OpCode.SuperPropGet]: { inputCount: 1, hasResult: true },
  [OpCode.SuperPropSet]: { inputCount: 2, hasResult: false },
  [OpCode.SuperCall]: { inputCount: 1, hasResult: true },
  [OpCode.SuperCallWithArray]: { inputCount: 1, hasResult: true },
  [OpCode.Throw]: { inputCount: 1, hasResult: false },
  [OpCode.TryCatchBegin]: { inputCount: 3, hasResult: false },
  [OpCode.TryCatchEnd]: { inputCount: 0, hasResult: false },
  [OpCode.Yield]: { inputCount: 1, hasResult: true },
  [OpCode.Await]: { inputCount: 1, hasResult: true },
  [OpCode.YieldStar]: { inputCount: 1, hasResult: true },
  [OpCode.GetEntropy]: { inputCount: 0, hasResult: true },
  [OpCode.SuperInstruction]: { inputCount: 1, hasResult: true },
};

export function decodeBytecode(bytes: Uint8Array, mapping: OpcodeMapping, config: VMBuildConfig): Instruction[] {
  let raw = config.rollingKeys ? unrollKeys(bytes, config.seed) : bytes;
  if (!config.rollingKeys && config.runtimeHardening === 'paranoid') {
    raw = unrollParanoid(raw, config.seed);
  }
  const instructions: Instruction[] = [];
  const offset = { pos: 0 };
  let currentHandlerIdx = 0;

  while (offset.pos < raw.length) {
    const opcodeStart = offset.pos;

    let mappedOp: number;
    if (config.stealthDispatch) {
      const delta = raw[offset.pos++]!;
      mappedOp = (delta + currentHandlerIdx) & 0xff;
    } else {
      mappedOp = raw[offset.pos++]!;
    }

    const canonicalOp = mapping.reverse.get(mappedOp);
    const opcode = canonicalOp ?? assertOpCode(mappedOp);

    const numJunk = config.junkInsertion ? (opcode * 7 + config.seed) % 4 : 0;
    offset.pos += numJunk;
    if (offset.pos > raw.length) throw new Error('Bytecode truncated (junk)');

    const layout = opcodeLayout[opcode] ?? OPCODE_DEFAULT_LAYOUT;
    const isVarLength = isVariableLengthOpcode(opcode);

    let totalOps: number;
    if (isVarLength) {
      totalOps = raw[offset.pos++]!;
      if (totalOps > 255) throw new Error('Invalid operand count');
    } else {
      totalOps = layout.inputCount + (layout.hasResult ? 1 : 0);
    }

    const allOperands: { kind: OperandKind; value: number | string }[] = [];

    for (let opsRead = 0; opsRead < totalOps; opsRead++) {
      const kindNum = raw[offset.pos++]!;
      let val: number;
      if (config.immediateEncoding === ImmediateEncodingScheme.VariableLength) {
        val = readLEB128(raw, offset);
      } else {
        val = readFixed32(raw, offset);
      }

      const kind = numToOperandKind(kindNum);

      if (kind === OperandKind.Register) {
        allOperands.push({ kind, value: `r${val}` });
      } else if (kind === OperandKind.BlockLabel) {
        allOperands.push({ kind, value: val });
      } else {
        allOperands.push({ kind, value: val });
      }
    }

    let result: string | undefined;
    const operands: { kind: OperandKind; value: number | string }[] = [];

    if (layout.hasResult && allOperands.length > layout.inputCount) {
      const lastOp = allOperands[allOperands.length - 1]!;
      result = lastOp.value as string;
      for (let i = 0; i < allOperands.length - 1; i++) {
        operands.push(allOperands[i]!);
      }
    } else {
      operands.push(...allOperands);
    }
    if (isTerminator(opcode)) {
      currentHandlerIdx = 0;
    } else {
      currentHandlerIdx = mappedOp;
    }

    instructions.push({
      opcode,
      result: result as `r${number}` | undefined,
      mappedOp,
      operands,
    });
  }

  return instructions;
}

export function decodeConstantPool(encoded: EncodedConstant[], scheme: ConstantEncodingScheme, seed: number): ConstantPoolEntry[] {
  return encoded.map((entry, index) => {
    if (scheme === ConstantEncodingScheme.XorRotate && entry.kind === ConstantKind.String && typeof entry.value === 'string') {
      let stringSeed = (seed ^ (index * 0x9e3779b9)) & 0xffffffff;
      if (entry.decodingKey !== 0) {
        stringSeed = (stringSeed ^ entry.decodingKey) & 0xffffffff;
      }

      const keyBytes = new Uint8Array(16);
      let s = stringSeed;
      for (let i = 0; i < 16; i++) {
        s = Math.imul(s, 1664525) + 1013904223;
        keyBytes[i] = (s >>> 16) & 0xff;
      }

      const S = new Uint8Array(256);
      for (let i = 0; i < 256; i++) S[i] = i;
      let j = 0;
      for (let i = 0; i < 256; i++) {
        j = (j + S[i]! + keyBytes[i % 16]!) & 0xff;
        const temp = S[i]!;
        S[i] = S[j]!;
        S[j] = temp;
      }

      let ri = 0;
      j = 0;
      for (let skip = 0; skip < 256; skip++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]!) & 0xff;
        const temp = S[ri]!;
        S[ri] = S[j]!;
        S[j] = temp;
      }

      const chars: number[] = [];
      for (let i = 0; i < entry.value.length; i++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]!) & 0xff;
        const temp = S[ri]!;
        S[ri] = S[j]!;
        S[j] = temp;
        const keystreamByte = S[(S[ri]! + S[j]!) & 0xff]!;
        chars.push(entry.value.charCodeAt(i) ^ keystreamByte);
      }
      let decoded = String.fromCharCode(...chars);

      return { index, kind: entry.kind, value: decoded };
    }

    return { index, kind: entry.kind, value: entry.value };
  });
}

const opcodeNames: Record<number, string> = {
  [OpCode.LoadConst]: 'LoadConst',
  [OpCode.LoadLocal]: 'LoadLocal',
  [OpCode.StoreLocal]: 'StoreLocal',
  [OpCode.Move]: 'Move',
  [OpCode.LoadGlobal]: 'LoadGlobal',
  [OpCode.StoreGlobal]: 'StoreGlobal',
  [OpCode.LoadThis]: 'LoadThis',
  [OpCode.LoadNewTarget]: 'LoadNewTarget',
  [OpCode.Add]: 'Add',
  [OpCode.Sub]: 'Sub',
  [OpCode.Mul]: 'Mul',
  [OpCode.Div]: 'Div',
  [OpCode.Mod]: 'Mod',
  [OpCode.Neg]: 'Neg',
  [OpCode.BitAnd]: 'BitAnd',
  [OpCode.BitOr]: 'BitOr',
  [OpCode.BitXor]: 'BitXor',
  [OpCode.Shl]: 'Shl',
  [OpCode.Shr]: 'Shr',
  [OpCode.UShr]: 'UShr',
  [OpCode.Eq]: 'Eq',
  [OpCode.StrictEq]: 'StrictEq',
  [OpCode.Lt]: 'Lt',
  [OpCode.LtEq]: 'LtEq',
  [OpCode.Gt]: 'Gt',
  [OpCode.GtEq]: 'GtEq',
  [OpCode.Not]: 'Not',
  [OpCode.TypeOf]: 'TypeOf',
  [OpCode.InstanceOf]: 'InstanceOf',
  [OpCode.In]: 'In',
  [OpCode.Jmp]: 'Jmp',
  [OpCode.JmpIf]: 'JmpIf',
  [OpCode.JmpIfNot]: 'JmpIfNot',
  [OpCode.Call]: 'Call',
  [OpCode.CallMethod]: 'CallMethod',
  [OpCode.New]: 'New',
  [OpCode.Return]: 'Return',
  [OpCode.ReturnVoid]: 'ReturnVoid',
  [OpCode.ClosureNew]: 'ClosureNew',
  [OpCode.CellNew]: 'CellNew',
  [OpCode.CellGet]: 'CellGet',
  [OpCode.CellSet]: 'CellSet',
  [OpCode.EnvGet]: 'EnvGet',
  [OpCode.CallWithArray]: 'CallWithArray',
  [OpCode.CallMethodWithArray]: 'CallMethodWithArray',
  [OpCode.NewWithArray]: 'NewWithArray',
  [OpCode.RestArgs]: 'RestArgs',
  [OpCode.PropGet]: 'PropGet',
  [OpCode.PropSet]: 'PropSet',
  [OpCode.ComputedGet]: 'ComputedGet',
  [OpCode.ComputedSet]: 'ComputedSet',
  [OpCode.ArrayNew]: 'ArrayNew',
  [OpCode.ObjectNew]: 'ObjectNew',
  [OpCode.Spread]: 'Spread',
  [OpCode.SpreadIntoArray]: 'SpreadIntoArray',
  [OpCode.Delete]: 'Delete',
  [OpCode.PrivateGet]: 'PrivateGet',
  [OpCode.PrivateSet]: 'PrivateSet',
  [OpCode.PrivateIn]: 'PrivateIn',
  [OpCode.SuperPropGet]: 'SuperPropGet',
  [OpCode.SuperPropSet]: 'SuperPropSet',
  [OpCode.SuperCall]: 'SuperCall',
  [OpCode.SuperCallWithArray]: 'SuperCallWithArray',
  [OpCode.Throw]: 'Throw',
  [OpCode.TryCatchBegin]: 'TryCatchBegin',
  [OpCode.TryCatchEnd]: 'TryCatchEnd',
  [OpCode.Yield]: 'Yield',
  [OpCode.Await]: 'Await',
  [OpCode.YieldStar]: 'YieldStar',
  [OpCode.Nop]: 'Nop',
  [OpCode.Halt]: 'Halt',
  [OpCode.Trap]: 'Trap',
  [OpCode.GetEntropy]: 'GetEntropy',
  [OpCode.SuperInstruction]: 'SuperInstruction',
};

export function disassemble(module: BytecodeModule): string {
  const config: VMBuildConfig = {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.XorMasked,
    superInstructions: true,
    handlerLayoutRandom: true,
    constantPoolEncoding: ConstantEncodingScheme.XorRotate,
    traceMode: false,
    deterministicReplay: false,
    seed: module.metadata.deterministicSeed ?? 0,
    profile: module.metadata.profile,
    threadedDispatch: true,
    tamperDetection: true,
    antiDebug: true,
    opcodeAliasing: true,
    junkInsertion: true,
    rollingKeys: true,
    stealthDispatch: true,
  };

  const lines: string[] = [];
  lines.push(`; Bytecode Module: ${module.buildId}`);
  lines.push(`; Version: ${module.version}, Functions: ${module.functions.length}`);
  lines.push(`; Profile: ${module.metadata.profile}, Seed: ${module.metadata.deterministicSeed}`);
  lines.push('');

  for (const fn of module.functions) {
    lines.push(`; --- Function: ${fn.name} (id: ${fn.id}) ---`);
    lines.push(`;   paramCount: ${fn.paramCount}, localCount: ${fn.localCount}, maxRegisters: ${fn.maxRegisters}`);
    lines.push(`;   bytecodeSize: ${fn.bytecode.length} bytes, entryPoint: ${fn.isEntryPoint}`);
    lines.push('');

    try {
      const instructions = decodeBytecode(fn.bytecode, module.opcodeMapping, config);
      let byteOffset = 0;
      for (let i = 0; i < instructions.length; i++) {
        const inst = instructions[i]!;
        const opName = opcodeNames[inst.opcode] ?? `OP_${inst.opcode.toString(16).toUpperCase().padStart(2, '0')}`;
        const mappedStr =
          inst.mappedOp !== undefined && inst.mappedOp !== inst.opcode
            ? ` (mapped: 0x${inst.mappedOp.toString(16).toUpperCase().padStart(2, '0')})`
            : '';
        const opsStr = inst.operands
          .map((op) => {
            const kindStr =
              op.kind === OperandKind.Register
                ? 'r' + op.value
                : op.kind === OperandKind.Immediate
                  ? '#' + op.value
                  : op.kind === OperandKind.ConstantIndex
                    ? '@' + op.value
                    : op.kind === OperandKind.BlockLabel
                      ? 'L' + op.value
                      : op.kind === OperandKind.FunctionRef
                        ? 'fn' + op.value
                        : String(op.value);
            return kindStr;
          })
          .join(', ');
        lines.push(`  ${byteOffset.toString(10).padStart(4, ' ')}: ${opName}${mappedStr} ${opsStr}`);
        byteOffset += estimateInstructionSize(inst, config, module.metadata.deterministicSeed ?? 0);
      }
    } catch (e) {
      const err = e as Error;
      lines.push(`  ; DECODE ERROR: ${err.message}\n  ; ${err.stack?.replace(/\n/g, '\n  ; ')}`);
    }
    lines.push('');
  }

  lines.push(`; Constant Pool (${module.constantPool.length} entries):`);
  for (const entry of module.constantPool) {
    const valStr = typeof entry.value === 'string' ? JSON.stringify(entry.value.substring(0, 40)) : String(entry.value);
    lines.push(`;   [${entry.index}] ${entry.kind}: ${valStr}`);
  }

  return lines.join('\n');
}

function estimateInstructionSize(inst: Instruction, config: VMBuildConfig, seed: number): number {
  let size = 1;
  const mappedOp = inst.mappedOp ?? inst.opcode;

  if (config.junkInsertion) {
    size += (inst.opcode * 7 + seed) % 4;
  }

  const ops: { kind: OperandKind; value: number | string }[] = [...(inst.operands || [])];
  if (inst.opcode !== OpCode.Nop && inst.result) {
    ops.push({ kind: OperandKind.Register, value: inst.result });
  }

  const isVarLength = isVariableLengthOpcode(inst.opcode);
  if (isVarLength) {
    size += 1;
  }

  for (const op of ops) {
    size += 1;
    let val = 0;
    if (typeof op.value === 'string' && op.value.startsWith('r')) {
      val = Number.parseInt(op.value.substring(1), 10);
    } else if (typeof op.value === 'number') {
      val = op.value;
    }
    if (config.immediateEncoding === ImmediateEncodingScheme.VariableLength) {
      let v = val;
      do {
        v >>>= 7;
        size++;
      } while (v !== 0);
    } else {
      size += 4;
    }
  }

  return size;
}
