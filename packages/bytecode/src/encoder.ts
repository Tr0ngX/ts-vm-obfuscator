import type { Instruction, Operand, OpcodeMapping, EncodedConstant, ConstantPoolEntry } from '@tsvm/shared';
import {
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
  OperandKind,
  type SeededRandom,
  OpCode,
  isVariableLengthOpcode,
  isTerminator,
} from '@tsvm/shared';

import type { VMBuildConfig } from '@tsvm/shared';

export function encodeBytecode(instructions: Instruction[], mapping: OpcodeMapping, config: VMBuildConfig, rng?: SeededRandom): Uint8Array {
  const bytes: number[] = [];
  let currentHandlerIdx = 0;

  for (const inst of instructions) {
    let mappedOp: number = inst.mappedOp ?? inst.opcode;
    if (inst.mappedOp === undefined) {
      const forward = mapping.forward.get(inst.opcode);
      if (Array.isArray(forward)) {
        if (!rng) throw new Error('SeededRandom required when opcodeMap is provided');
        mappedOp = forward[Math.floor(rng.next() * forward.length)];
      } else if (typeof forward === 'number') {
        mappedOp = forward;
      }
    }

    if (config.stealthDispatch) {
      const delta = (mappedOp - currentHandlerIdx + 256) & 0xff;
      bytes.push(delta);
      currentHandlerIdx = isTerminator(inst.opcode) ? 0 : mappedOp;
    } else {
      bytes.push(mappedOp);
    }

    if (config.junkInsertion) {
      const numJunk = (inst.opcode * 7 + config.seed) % 4;
      for (let j = 0; j < numJunk; j++) {
        if (!rng) throw new Error('SeededRandom required for junk byte injection');
        const junk = Math.floor(rng.next() * 256);
        bytes.push(junk);
      }
    }

    const ops: Operand[] = [...(inst.operands || [])];
    if (inst.result && inst.opcode !== OpCode.Nop) {
      ops.push({ kind: OperandKind.Register, value: inst.result });
    }

    const isVarLength = isVariableLengthOpcode(inst.opcode);
    if (isVarLength) {
      bytes.push(ops.length); // arg count only for variable-length opcodes
    }

    for (const op of ops) {
      const kindNum = operandKindToNum(op.kind);
      bytes.push(kindNum);

      let val = 0;
      if (typeof op.value === 'string' && op.value.startsWith('r')) {
        val = Number.parseInt(op.value.substring(1), 10);
      } else if (typeof op.value === 'number') {
        val = op.value;
      }

      if (config.immediateEncoding === ImmediateEncodingScheme.VariableLength) {
        // LEB128 Encoding
        let v = val;
        do {
          let byte = v & 0x7f;
          v >>>= 7;
          if (v !== 0) byte |= 0x80;
          bytes.push(byte);
        } while (v !== 0);
      } else {
        // Fixed 4-byte
        const b0 = val & 0xff;
        const b1 = (val >> 8) & 0xff;
        const b2 = (val >> 16) & 0xff;
        const b3 = (val >> 24) & 0xff;
        bytes.push(b0, b1, b2, b3);
      }
    }
  }

  const resultBytes = new Uint8Array(bytes);
  if (config.rollingKeys) {
    for (let pc = 0; pc < resultBytes.length; pc++) {
      const rawVal = resultBytes[pc]!;
      const offsetVal = (rawVal + pc) & 0xff;
      const rollingKey = ((config.seed ^ (pc * 0x9e3779b9)) >>> 8) & 0xff;
      resultBytes[pc] = offsetVal ^ rollingKey;
    }
  } else if (config.runtimeHardening === 'paranoid') {
    for (let pc = 0; pc < resultBytes.length; pc++) {
      const mask = (pc * 31 + config.seed) & 0xff;
      resultBytes[pc] = resultBytes[pc]! ^ mask;
    }
  }
  return resultBytes;
}

function operandKindToNum(kind: OperandKind | number): number {
  if (typeof kind === 'number') return kind;
  switch (kind) {
    case OperandKind.Register:
    case 'register':
      return 0;
    case OperandKind.Immediate:
    case 'immediate':
      return 1;
    case OperandKind.ConstantIndex:
    case 'constant_index':
      return 2;
    case OperandKind.BlockLabel:
    case 'block_label':
      return 3;
    case OperandKind.FunctionRef:
    case 'function_ref':
      return 4;
    default:
      throw new Error(`Unrecognized operand kind: ${kind}`);
  }
}

export function encodeConstantPool(
  constants: readonly ConstantPoolEntry[],
  scheme: ConstantEncodingScheme,
  seed: number,
): EncodedConstant[] {
  return constants.map((c, index) => {
    if (scheme === ConstantEncodingScheme.XorRotate && typeof c.value === 'string') {
      let stringSeed = (seed ^ (index * 0x9e3779b9)) & 0xffffffff;
      if (c.expectedPathHash !== undefined) {
        stringSeed = (stringSeed ^ c.expectedPathHash) & 0xffffffff;
      }

      // Deriving 16-byte key using LCG
      const keyBytes = new Uint8Array(16);
      let s = stringSeed;
      for (let i = 0; i < 16; i++) {
        s = Math.imul(s, 1664525) + 1013904223;
        keyBytes[i] = (s >>> 16) & 0xff;
      }

      // KSA
      const S = new Uint8Array(256);
      for (let i = 0; i < 256; i++) S[i] = i;
      let j = 0;
      for (let i = 0; i < 256; i++) {
        j = (j + S[i]! + keyBytes[i % 16]!) & 0xff;
        const temp = S[i]!;
        S[i] = S[j]!;
        S[j] = temp;
      }

      // PRGA with drop-256 for stronger security
      let ri = 0;
      j = 0;
      for (let skip = 0; skip < 256; skip++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]!) & 0xff;
        const temp = S[ri]!;
        S[ri] = S[j]!;
        S[j] = temp;
      }

      let encoded = '';
      for (let i = 0; i < c.value.length; i++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]!) & 0xff;
        const temp = S[ri]!;
        S[ri] = S[j]!;
        S[j] = temp;
        const keystreamByte = S[(S[ri]! + S[j]!) & 0xff]!;
        encoded += String.fromCharCode(c.value.charCodeAt(i) ^ keystreamByte);
      }

      return { index, kind: c.kind, value: encoded, encodedBytes: new Uint8Array(), decodingKey: 0 };
    }
    return { index, kind: c.kind, value: c.value, encodedBytes: new Uint8Array(), decodingKey: 0 };
  });
}
