import type { Instruction, OpcodeMapping, EncodedConstant, ConstantPoolEntry } from '@tsvm/shared';
import { ImmediateEncodingScheme, ConstantEncodingScheme, OperandKind } from '@tsvm/shared';

export function encodeBytecode(instructions: Instruction[], mapping: any, encoding: ImmediateEncodingScheme): Uint8Array {
  const bytes: number[] = [];

  for (const inst of instructions) {
    const mappedOp = mapping.forward.get(inst.opcode) ?? inst.opcode;
    bytes.push(mappedOp);

    const ops = [...(inst.operands || [])];
    if (inst.result) {
      ops.push({ kind: OperandKind.Register, value: inst.result } as any);
    }

    bytes.push(ops.length); // arg count

    for (const op of ops) {
      // Encode the kind as a numeric byte
      const kindNum = operandKindToNum(op.kind);
      bytes.push(kindNum);
      
      // Encode the value as a 32-bit little-endian integer
      let val = 0;
      if (typeof op.value === 'string' && op.value.startsWith('r')) {
        val = parseInt(op.value.substring(1), 10);
      } else if (typeof op.value === 'number') {
        val = op.value;
      }
      
      bytes.push(val & 0xFF);
      bytes.push((val >> 8) & 0xFF);
      bytes.push((val >> 16) & 0xFF);
      bytes.push((val >> 24) & 0xFF);
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
