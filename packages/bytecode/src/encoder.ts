import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry } from '@tsvm/shared';
import { ImmediateEncodingScheme, ConstantEncodingScheme, OperandKind } from '@tsvm/shared';

import type { VMBuildConfig } from '@tsvm/shared';

export function encodeBytecode(instructions: Instruction[], mapping: any, config: VMBuildConfig): Uint8Array {
  const bytes: number[] = [];
  let rollingKey = config.rollingKeys ? config.seed & 0xFF : 0;

  for (const inst of instructions) {
    let mappedOp = inst.opcode;
    const forward = mapping.forward.get(inst.opcode);
    if (Array.isArray(forward)) {
      // Pick random alias if 1-to-N
      mappedOp = forward[Math.floor(Math.random() * forward.length)];
    } else if (forward !== undefined) {
      mappedOp = forward;
    }

    if (config.rollingKeys) {
      bytes.push(mappedOp ^ rollingKey);
      rollingKey = (rollingKey + mappedOp) & 0xFF;
    } else {
      bytes.push(mappedOp);
    }

    const ops = [...(inst.operands || [])];
    if (inst.result) {
      ops.push({ kind: OperandKind.Register, value: inst.result } as any);
    }

    if (config.rollingKeys) {
      bytes.push(ops.length ^ rollingKey);
      rollingKey = (rollingKey + ops.length) & 0xFF;
    } else {
      bytes.push(ops.length); // arg count
    }

    for (const op of ops) {
      const kindNum = operandKindToNum(op.kind);
      if (config.rollingKeys) {
        bytes.push(kindNum ^ rollingKey);
        rollingKey = (rollingKey + kindNum) & 0xFF;
      } else {
        bytes.push(kindNum);
      }
      
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
          if (config.rollingKeys) {
            bytes.push(byte ^ rollingKey);
            rollingKey = (rollingKey + byte) & 0xFF;
          } else {
            bytes.push(byte);
          }
        } while (v !== 0);
      } else {
        // Fixed 4-byte
        const b0 = val & 0xFF;
        const b1 = (val >> 8) & 0xFF;
        const b2 = (val >> 16) & 0xFF;
        const b3 = (val >> 24) & 0xFF;
        
        if (config.rollingKeys) {
          bytes.push(b0 ^ rollingKey); rollingKey = (rollingKey + b0) & 0xFF;
          bytes.push(b1 ^ rollingKey); rollingKey = (rollingKey + b1) & 0xFF;
          bytes.push(b2 ^ rollingKey); rollingKey = (rollingKey + b2) & 0xFF;
          bytes.push(b3 ^ rollingKey); rollingKey = (rollingKey + b3) & 0xFF;
        } else {
          bytes.push(b0, b1, b2, b3);
        }
      }
    }
  }

  return new Uint8Array(bytes);
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
      let encoded = '';
      for (let i = 0; i < c.value.length; i++) {
        encoded += String.fromCharCode(c.value.charCodeAt(i) ^ (seed & 0xFF));
      }
      return { index, kind: c.kind, value: encoded, encodedBytes: new Uint8Array(), decodingKey: 0 } as EncodedConstant;
    }
    return { index, kind: c.kind, value: c.value, encodedBytes: new Uint8Array(), decodingKey: 0 } as EncodedConstant;
  });
}
