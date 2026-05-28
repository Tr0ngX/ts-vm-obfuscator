import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry } from '@tsvm/shared';
import { ImmediateEncodingScheme, ConstantEncodingScheme, OperandKind, SeededRandom, OpCode } from '@tsvm/shared';

import type { VMBuildConfig } from '@tsvm/shared';

function isVariableLengthOpcode(opcode: number): boolean {
  return (
    opcode === 0x40 || // OpCode.Call
    opcode === 0x41 || // OpCode.CallMethod
    opcode === 0x42 || // OpCode.New
    opcode === 0x54 || // OpCode.ArrayNew
    opcode === 0x55 || // OpCode.ObjectNew
    opcode === 0x56 || // OpCode.Spread
    opcode === 0x57 || // OpCode.SpreadIntoArray
    opcode === 0x5E    // OpCode.SuperCall
  );
}

export function encodeBytecode(instructions: Instruction[], mapping: any, config: VMBuildConfig, rng?: SeededRandom): Uint8Array {
  const bytes: number[] = [];

  for (const inst of instructions) {
    let mappedOp = inst.opcode;
    const forward = mapping.forward.get(inst.opcode);
    if (Array.isArray(forward)) {
      if (!rng) throw new Error('SeededRandom required when opcodeMap is provided');
      // Pick random alias if 1-to-N
      mappedOp = forward[Math.floor(rng.next() * forward.length)];
    } else if (forward !== undefined) {
      mappedOp = forward;
    }

    bytes.push(mappedOp);

    const numJunk = inst.opcode % 3;
    for (let j = 0; j < numJunk; j++) {
      if (!rng) throw new Error('SeededRandom required for junk byte injection');
      const junk = Math.floor(rng.next() * 256);
      bytes.push(junk);
    }

    const ops = [...(inst.operands || [])];
    if (inst.result) {
      ops.push({ kind: OperandKind.Register, value: inst.result } as any);
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
        val = parseInt(op.value.substring(1), 10);
      } else if (typeof op.value === 'number') {
        val = op.value;
      }
      
      if (config.immediateEncoding === ImmediateEncodingScheme.VariableLength) {
        // LEB128 Encoding
        let v = val;
        do {
          let byte = v & 0x7F;
          v >>>= 7;
          if (v !== 0) byte |= 0x80;
          bytes.push(byte);
        } while (v !== 0);
      } else {
        // Fixed 4-byte
        const b0 = val & 0xFF;
        const b1 = (val >> 8) & 0xFF;
        const b2 = (val >> 16) & 0xFF;
        const b3 = (val >> 24) & 0xFF;
        bytes.push(b0, b1, b2, b3);
      }
    }
  }

  const resultBytes = new Uint8Array(bytes);
  if (config.rollingKeys) {
    for (let pc = 0; pc < resultBytes.length; pc++) {
      const rollingKey = (config.seed ^ pc) & 0xFF;
      resultBytes[pc] = (resultBytes[pc] || 0) ^ rollingKey;
    }
  }
  return resultBytes;
}

function operandKindToNum(kind: any): number {
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
      return 0;
  }
}

export function encodeConstantPool(constants: readonly ConstantPoolEntry[], scheme: ConstantEncodingScheme, seed: number): EncodedConstant[] {
  return constants.map((c, index) => {
    if (scheme === ConstantEncodingScheme.XorRotate && typeof c.value === 'string') {
      const stringSeed = (seed ^ (index * 0x9E3779B9)) & 0xffffffff;
      
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
      
      return { index, kind: c.kind, value: encoded, encodedBytes: new Uint8Array(), decodingKey: 0 } as EncodedConstant;
    }
    return { index, kind: c.kind, value: c.value, encodedBytes: new Uint8Array(), decodingKey: 0 } as EncodedConstant;
  });
}
