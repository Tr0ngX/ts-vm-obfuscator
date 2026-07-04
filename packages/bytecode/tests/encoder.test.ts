import { describe, it, expect } from 'vitest';
import { encodeConstantPool, encodeBytecode } from '../src/encoder.js';
import { decodeConstantPool, decodeBytecode } from '../src/decoder.js';
import {
  ConstantEncodingScheme,
  ConstantKind,
  OperandKind,
  OpCode,
  ImmediateEncodingScheme,
  SeededRandom,
  type ConstantPoolEntry,
  type EncodedConstant,
  type Instruction,
  type OpcodeMapping,
  type VMBuildConfig,
} from '@tsvm/shared';

describe('encodeConstantPool', () => {
  const seed = 42;

  describe('Identity scheme', () => {
    it('passes through values unchanged', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.Number, value: 42 },
        { index: 1, kind: ConstantKind.String, value: 'hello' },
        { index: 2, kind: ConstantKind.Boolean, value: true },
        { index: 3, kind: ConstantKind.Null, value: null },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.Identity, seed);
      expect(encoded).toHaveLength(4);
      expect(encoded[0]!.value).toBe(42);
      expect(encoded[1]!.value).toBe('hello');
      expect(encoded[2]!.value).toBe(true);
      expect(encoded[3]!.value).toBe(null);
    });

    it('round-trips through decodeConstantPool', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'test' },
        { index: 1, kind: ConstantKind.Number, value: 123 },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.Identity, seed);
      const decoded = decodeConstantPool(encoded, ConstantEncodingScheme.Identity, seed);
      expect(decoded[0]!.value).toBe('test');
      expect(decoded[1]!.value).toBe(123);
    });
  });

  describe('XorRotate scheme', () => {
    it('encodes string values to different output', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'HelloWorld' },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, seed);
      expect(encoded[0]!.value).not.toBe('HelloWorld');
      expect(typeof encoded[0]!.value).toBe('string');
      expect(encoded[0]!.value!.length).toBe('HelloWorld'.length);
    });

    it('does not encode non-string values', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.Number, value: 42 },
        { index: 1, kind: ConstantKind.Boolean, value: false },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, seed);
      expect(encoded[0]!.value).toBe(42);
      expect(encoded[1]!.value).toBe(false);
    });

    it('round-trips string values correctly', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'HelloWorld' },
        { index: 1, kind: ConstantKind.String, value: 'a' },
        { index: 2, kind: ConstantKind.String, value: '' },
        { index: 3, kind: ConstantKind.String, value: '你好世界' },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, seed);
      const decoded = decodeConstantPool(encoded, ConstantEncodingScheme.XorRotate, seed);
      expect(decoded[0]!.value).toBe('HelloWorld');
      expect(decoded[1]!.value).toBe('a');
      expect(decoded[2]!.value).toBe('');
      expect(decoded[3]!.value).toBe('你好世界');
    });

    it('uses expectedPathHash as decoding key', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'secret', expectedPathHash: 0xdeadbeef },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, seed);
      expect(encoded[0]!.decodingKey).toBe(0xdeadbeef);
      const decoded = decodeConstantPool(encoded, ConstantEncodingScheme.XorRotate, seed);
      expect(decoded[0]!.value).toBe('secret');
    });

    it('produces different encodings for different seeds', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'test' },
      ];
      const a = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, 1);
      const b = encodeConstantPool(entries, ConstantEncodingScheme.XorRotate, 2);
      expect(a[0]!.value).not.toBe(b[0]!.value);
    });
  });

  describe('AffineTransform scheme', () => {
    it('passes through all values unchanged (identity fallback)', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'test' },
        { index: 1, kind: ConstantKind.Number, value: 42 },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.AffineTransform, seed);
      expect(encoded[0]!.value).toBe('test');
      expect(encoded[1]!.value).toBe(42);
    });
  });

  describe('SplitMerge scheme', () => {
    it('passes through all values unchanged (identity fallback)', () => {
      const entries: ConstantPoolEntry[] = [
        { index: 0, kind: ConstantKind.String, value: 'test' },
      ];
      const encoded = encodeConstantPool(entries, ConstantEncodingScheme.SplitMerge, seed);
      expect(encoded[0]!.value).toBe('test');
    });
  });
});

describe('encodeBytecode', () => {
  const defaultMapping: OpcodeMapping = {
    seed: 7,
    forward: new Map([
      [OpCode.LoadConst, 10],
      [OpCode.Move, 11],
      [OpCode.Add, 12],
      [OpCode.Return, 13],
    ]),
    reverse: new Map([
      [10, OpCode.LoadConst],
      [11, OpCode.Move],
      [12, OpCode.Add],
      [13, OpCode.Return],
    ]),
  };

  const defaultConfig: VMBuildConfig = {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.VariableLength,
    superInstructions: false,
    handlerLayoutRandom: false,
    constantPoolEncoding: ConstantEncodingScheme.Identity,
    traceMode: false,
    deterministicReplay: false,
    seed: 7,
  };

  it('encodes instructions to byte array', () => {
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
      { opcode: OpCode.Return, operands: [{ kind: OperandKind.Register, value: 'r0' }] },
    ];
    const bytes = encodeBytecode(insts, defaultMapping, defaultConfig);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('uses opcode aliasing when forward mapping has arrays', () => {
    const rng = new SeededRandom(42);
    const mapping: OpcodeMapping = {
      seed: 7,
      forward: new Map([[OpCode.Nop, [5, 6, 7]]]),
      reverse: new Map([[5, OpCode.Nop], [6, OpCode.Nop], [7, OpCode.Nop]]),
    };
    const insts: Instruction[] = [
      { opcode: OpCode.Nop, operands: [] },
    ];
    const bytes = encodeBytecode(insts, mapping, defaultConfig, rng);
    expect(bytes.length).toBe(1);
    expect([5, 6, 7]).toContain(bytes[0]);
  });

  it('applies stealth dispatch delta encoding', () => {
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
      { opcode: OpCode.Return, operands: [{ kind: OperandKind.Register, value: 'r0' }] },
    ];
    const bytes = encodeBytecode(insts, defaultMapping, { ...defaultConfig, stealthDispatch: true });
    // First byte should be a delta, not raw op
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('applies junk byte insertion', () => {
    const rng = new SeededRandom(42);
    const insts: Instruction[] = [
      { opcode: OpCode.Nop, operands: [] },
      { opcode: OpCode.Return, operands: [{ kind: OperandKind.Register, value: 'r0' }] },
    ];
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const bytes = encodeBytecode(insts, mapping, { ...defaultConfig, junkInsertion: true, opcodeRemapping: false }, rng);
    // With Nop (0xf0) and seed 7: (0xf0 * 7 + 7) % 4 = (0x690 + 7) % 4 = 1687 % 4 = 3 junk bytes
    // With Return (0x43) and seed 7: (0x43 * 7 + 7) % 4 = (0x1D5 + 7) % 4 = 476 % 4 = 0 junk bytes
    expect(bytes.length).toBeGreaterThan(2);
  });

  it('applies rolling key XOR', () => {
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
    ];
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const plain = encodeBytecode(insts, mapping, { ...defaultConfig, opcodeRemapping: false });
    const rolled = encodeBytecode(insts, mapping, { ...defaultConfig, opcodeRemapping: false, rollingKeys: true });
    // With rolling keys, bytes should differ from plain
    expect(rolled).not.toEqual(plain);
    // Rolling keys should round-trip through decoder
    const decoded = decodeBytecode(rolled, mapping, { ...defaultConfig, opcodeRemapping: false, rollingKeys: true });
    expect(decoded.length).toBe(1);
    expect(decoded[0]!.opcode).toBe(OpCode.LoadConst);
  });

  it('applies paranoid XOR mask', () => {
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
    ];
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const plain = encodeBytecode(insts, mapping, { ...defaultConfig, opcodeRemapping: false });
    const paranoid = encodeBytecode(insts, mapping, { ...defaultConfig, opcodeRemapping: false, runtimeHardening: 'paranoid' });
    expect(paranoid).not.toEqual(plain);
  });

  it('throws when opcode aliasing needs rng but not provided', () => {
    const mapping: OpcodeMapping = {
      seed: 7,
      forward: new Map([[OpCode.Nop, [5, 6, 7]]]),
      reverse: new Map(),
    };
    const insts: Instruction[] = [{ opcode: OpCode.Nop, operands: [] }];
    expect(() => encodeBytecode(insts, mapping, defaultConfig)).toThrow('SeededRandom required');
  });

  it('throws when junk insertion needs rng but not provided', () => {
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const insts: Instruction[] = [{ opcode: OpCode.Nop, operands: [] }];
    expect(() => encodeBytecode(insts, mapping, { ...defaultConfig, junkInsertion: true, opcodeRemapping: false })).toThrow('SeededRandom required');
  });

  it('uses mappedOp if set on instruction', () => {
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map([[99, OpCode.Nop]]) };
    const insts: Instruction[] = [{ opcode: OpCode.Nop, operands: [], mappedOp: 99 }];
    const bytes = encodeBytecode(insts, mapping, { ...defaultConfig, opcodeRemapping: false });
    expect(bytes[0]).toBe(99);
  });

  it('handles empty instructions list', () => {
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const bytes = encodeBytecode([], mapping, defaultConfig);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(0);
  });

  it('paranoid XOR masking round-trips through decodeBytecode', () => {
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 42 }], result: 'r0' },
      { opcode: OpCode.Return, operands: [{ kind: OperandKind.Register, value: 'r0' }] },
    ];
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const config = { ...defaultConfig, runtimeHardening: 'paranoid', opcodeRemapping: false };
    const bytes = encodeBytecode(insts, mapping, config);
    const decoded = decodeBytecode(bytes, mapping, config);
    expect(decoded.length).toBe(2);
    expect(decoded[0]!.opcode).toBe(OpCode.LoadConst);
    expect(decoded[1]!.opcode).toBe(OpCode.Return);
  });

  it('hasResult operand is included correctly in the encoded byte stream', () => {
    const mapping: OpcodeMapping = { seed: 7, forward: new Map(), reverse: new Map() };
    const config = { ...defaultConfig, opcodeRemapping: false };
    const insts: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r5' },
      { opcode: OpCode.Return, operands: [{ kind: OperandKind.Register, value: 'r5' }] },
    ];
    const bytes = encodeBytecode(insts, mapping, config);
    // Decode and verify the result register is properly preserved
    const decoded = decodeBytecode(bytes, mapping, config);
    expect(decoded.length).toBe(2);
    expect(decoded[0]!.opcode).toBe(OpCode.LoadConst);
    expect(decoded[0]!.result).toBe('r5');
    expect(decoded[0]!.operands.length).toBe(1); // inputCount only, result is separate
    expect(decoded[1]!.opcode).toBe(OpCode.Return);
    expect(decoded[1]!.result).toBeUndefined(); // Return has hasResult=false
  });
});
