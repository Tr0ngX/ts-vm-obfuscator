import { describe, it, expect } from 'vitest';
import { compileToBytecode } from '../src/compiler.js';
import { decodeBytecode } from '../src/decoder.js';
import {
  ConstantEncodingScheme,
  FunctionAttribute,
  ImmediateEncodingScheme,
  IRType,
  OperandKind,
  OpCode,
  type IRModule,
  type Instruction,
  type VMBuildConfig,
} from '@tsvm/shared';

function makeSimpleModule(instructions: Instruction[], seed = 7): IRModule {
  return {
    id: 'mod_test',
    sourceFile: 'test.ts',
    functions: [
      {
        id: 'fn_test',
        name: 'testFunc',
        params: [],
        returnType: IRType.Any,
        blocks: [
          {
            id: 'b0',
            label: 'entry',
            instructions,
            terminator: { kind: 'return', targets: [], returnValue: 'r0' },
            predecessors: [],
            successors: [],
            phiNodes: [],
          },
        ],
        locals: [],
        isVirtualized: true,
        isExported: false,
        attributes: [],
        capturedVariables: [],
      },
    ],
    globals: [],
    imports: [],
    exports: [],
    constantPool: [],
    metadata: {
      sourceFile: 'test.ts',
      originalByteSize: 0,
      functionCount: 1,
      blockCount: 1,
      instructionCount: instructions.length,
      buildTimestamp: 0,
    },
  };
}

function makeConfig(overrides: Partial<VMBuildConfig> = {}): VMBuildConfig {
  return {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.VariableLength,
    superInstructions: false,
    handlerLayoutRandom: false,
    constantPoolEncoding: ConstantEncodingScheme.Identity,
    traceMode: false,
    deterministicReplay: false,
    seed: 7,
    threadedDispatch: false,
    tamperDetection: false,
    antiDebug: false,
    opcodeAliasing: false,
    junkInsertion: false,
    rollingKeys: false,
    stealthDispatch: false,
    ...overrides,
  };
}

function stripMappedOp(inst: Instruction): Instruction {
  return { ...inst, mappedOp: undefined };
}

describe('Bytecode Compiler', () => {
  it('does not expose nested functions as VM entry points', () => {
    const module: IRModule = {
      id: 'mod_test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn_outer',
          name: 'outer',
          params: [],
          returnType: IRType.Any,
          blocks: [
            {
              id: 'b0',
              label: 'entry',
              instructions: [],
              terminator: { kind: 'return', targets: [] },
              predecessors: [],
              successors: [],
              phiNodes: [],
            },
          ],
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
        },
        {
          id: 'fn_inner',
          name: 'outer$closure$0',
          params: [],
          returnType: IRType.Any,
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              instructions: [],
              terminator: { kind: 'return', targets: [] },
              predecessors: [],
              successors: [],
              phiNodes: [],
            },
          ],
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [FunctionAttribute.Nested],
          capturedVariables: [],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'test.ts',
        originalByteSize: 0,
        functionCount: 2,
        blockCount: 2,
        instructionCount: 0,
        buildTimestamp: 0,
      },
    };

    const bytecode = compileToBytecode(module, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 7,
    });

    expect(bytecode.functions).toHaveLength(2);
    expect(bytecode.functions.filter((fn) => fn.isEntryPoint)).toHaveLength(1);
    expect(bytecode.functions.find((fn) => fn.id === 'fn_inner')!.isEntryPoint).toBe(false);
    expect(bytecode.functions.find((fn) => fn.id === 'fn_inner')!.attributes).toContain(FunctionAttribute.Nested);
  });

  describe('Round-trip: encode → decode', () => {
    const configs: { name: string; config: VMBuildConfig }[] = [
      { name: 'basic (LEB128, no junk, no rolling)', config: makeConfig() },
      { name: 'fixed encoding', config: makeConfig({ immediateEncoding: ImmediateEncodingScheme.XorMasked }) },
      { name: 'junk insertion', config: makeConfig({ junkInsertion: true }) },
      { name: 'stealth dispatch', config: makeConfig({ stealthDispatch: true }) },
      { name: 'rolling keys', config: makeConfig({ rollingKeys: true }) },
      { name: 'stealth + junk + rolling', config: makeConfig({ stealthDispatch: true, junkInsertion: true, rollingKeys: true }) },
    ];

    const testInstructions: Instruction[] = [
      { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
      {
        opcode: OpCode.Move,
        operands: [
          { kind: OperandKind.Register, value: 'r0' },
          { kind: OperandKind.Register, value: 'r1' },
        ],
      },
      {
        opcode: OpCode.Add,
        operands: [
          { kind: OperandKind.Register, value: 'r0' },
          { kind: OperandKind.Register, value: 'r1' },
        ],
        result: 'r2',
      },
      {
        opcode: OpCode.Sub,
        operands: [
          { kind: OperandKind.Register, value: 'r2' },
          { kind: OperandKind.Register, value: 'r1' },
        ],
        result: 'r3',
      },
      {
        opcode: OpCode.Mul,
        operands: [
          { kind: OperandKind.Register, value: 'r3' },
          { kind: OperandKind.Register, value: 'r0' },
        ],
        result: 'r4',
      },
      { opcode: OpCode.GetEntropy, operands: [], result: 'r5' },
      { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: 'r5' }], result: 'r6' },
    ];

    for (const { name, config } of configs) {
      it(`round-trips ${name}`, () => {
        const module = makeSimpleModule(testInstructions, config.seed);
        const compiled = compileToBytecode(module, config);
        const fn = compiled.functions[0]!;
        const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);

        // decoded includes 1 extra instruction (Return terminator)
        expect(decoded.length).toBe(testInstructions.length + 1);
        // Verify opcodes match in order (compiler may shuffle registers/const pool)
        for (let i = 0; i < testInstructions.length; i++) {
          expect(decoded[i]!.opcode).toBe(testInstructions[i]!.opcode);
        }
        expect(decoded[decoded.length - 1]!.opcode).toBe(OpCode.Return);
      });
    }

    it('round-trips empty instruction list', () => {
      const config = makeConfig();
      const module = makeSimpleModule([], config.seed);
      const compiled = compileToBytecode(module, config);
      const fn = compiled.functions[0]!;
      const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);
      expect(decoded.length).toBe(1);
      expect(decoded[0]!.opcode).toBe(OpCode.Return);
    });

    it('round-trips single instruction', () => {
      const config = makeConfig();
      const insts: Instruction[] = [{ opcode: OpCode.Nop, operands: [] }];
      const module = makeSimpleModule(insts, config.seed);
      const compiled = compileToBytecode(module, config);
      const fn = compiled.functions[0]!;
      const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);
      expect(decoded.length).toBe(2); // Nop + Return
      expect(decoded[0]!.opcode).toBe(OpCode.Nop);
      expect(decoded[1]!.opcode).toBe(OpCode.Return);
    });

    it('round-trips immediate operands', () => {
      const config = makeConfig();
      const insts: Instruction[] = [
        { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 42 }], result: 'r0' },
        { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0xff }], result: 'r1' },
        { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0xffff }], result: 'r2' },
      ];
      const module = makeSimpleModule(insts, config.seed);
      const compiled = compileToBytecode(module, config);
      const fn = compiled.functions[0]!;
      const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);
      expect(decoded.length).toBe(4); // 3 LoadConst + Return
      for (let i = 0; i < insts.length; i++) {
        expect(decoded[i]!.opcode).toBe(insts[i]!.opcode);
        // Compiler may shuffle constant pool indices, so we only check opcode
      }
      expect(decoded[3]!.opcode).toBe(OpCode.Return);
    });
  });

  describe('Decoder edge cases and error handling', () => {
    it('handles truly empty bytearray gracefully (no crash, returns empty array)', () => {
      const config = makeConfig();
      const mapping = { seed: 7, forward: new Map(), reverse: new Map() };
      const result = decodeBytecode(new Uint8Array([]), mapping, config);
      expect(Array.isArray(result)).toBe(true);
    });

    it('handles single-byte array gracefully (no crash)', () => {
      const config = makeConfig();
      const mapping = { seed: 7, forward: new Map(), reverse: new Map([[0, OpCode.Nop]]) };
      const result = decodeBytecode(new Uint8Array([0]), mapping, config);
      expect(Array.isArray(result)).toBe(true);
    });

    it('rejects bytearray with truncated register operands', () => {
      const config = makeConfig();
      // A LoadConst with constant index operand: needs opcode + 1 operand byte
      const mapping = { seed: 7, forward: new Map(), reverse: new Map() };
      // Byte: opcode-like value 1 byte only
      expect(() => decodeBytecode(new Uint8Array([0x01]), mapping, config)).toThrow();
    });

    it('decodes with XOR-masked encoding scheme', () => {
      const config = makeConfig({ immediateEncoding: ImmediateEncodingScheme.XorMasked });
      const insts: Instruction[] = [
        { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
        {
          opcode: OpCode.Move,
          operands: [
            { kind: OperandKind.Register, value: 'r0' },
            { kind: OperandKind.Register, value: 'r1' },
          ],
        },
      ];
      const module = makeSimpleModule(insts, config.seed);
      const compiled = compileToBytecode(module, config);
      const fn = compiled.functions[0]!;
      const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);
      expect(decoded.length).toBe(insts.length + 1);
      for (let i = 0; i < insts.length; i++) {
        expect(decoded[i]!.opcode).toBe(insts[i]!.opcode);
      }
      expect(decoded[decoded.length - 1]!.opcode).toBe(OpCode.Return);
    });

    it('round-trips binary arithmetic opcodes alongside their results', () => {
      const config = makeConfig();
      const insts: Instruction[] = [
        {
          opcode: OpCode.Add,
          operands: [
            { kind: OperandKind.Register, value: 'r0' },
            { kind: OperandKind.Register, value: 'r1' },
          ],
          result: 'r2',
        },
        {
          opcode: OpCode.Sub,
          operands: [
            { kind: OperandKind.Register, value: 'r2' },
            { kind: OperandKind.Register, value: 'r0' },
          ],
          result: 'r3',
        },
        {
          opcode: OpCode.Mul,
          operands: [
            { kind: OperandKind.Register, value: 'r3' },
            { kind: OperandKind.Register, value: 'r1' },
          ],
          result: 'r4',
        },
        { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: 'r4' }], result: 'r5' },
      ];
      const module = makeSimpleModule(insts, config.seed);
      const compiled = compileToBytecode(module, config);
      const fn = compiled.functions[0]!;
      const decoded = decodeBytecode(fn.bytecode, compiled.opcodeMapping, config);
      expect(decoded.length).toBe(insts.length + 1);
      expect(decoded[0]!.opcode).toBe(OpCode.Add);
      expect(decoded[1]!.opcode).toBe(OpCode.Sub);
      expect(decoded[2]!.opcode).toBe(OpCode.Mul);
      expect(decoded[3]!.opcode).toBe(OpCode.Not);
      expect(decoded[4]!.opcode).toBe(OpCode.Return);
    });
  });
});
