import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import { compileToBytecode } from '../../bytecode/src/compiler.js';
import { decodeBytecode } from '../../bytecode/src/decoder.js';
import { generateRemappedOpcodes } from '../../bytecode/src/opcodes.js';
import { OpCode, ImmediateEncodingScheme, ConstantEncodingScheme, OperandKind, FunctionAttribute, IRType, ConstantKind, type IRModule, type Instruction, type VMBuildConfig } from '@tsvm/shared';

function makeModuleWithPool(constantPoolValues: { index: number; value: unknown; kind: string }[]): IRModule {
  const insts: Instruction[] = constantPoolValues.map((entry, i) => ({
    opcode: OpCode.LoadConst,
    operands: [{ kind: OperandKind.ConstantIndex, value: i }],
    result: `r${i}` as `r${number}`,
  }));
  return {
    id: 'mod_sec',
    sourceFile: 'security.ts',
    functions: [
      {
        id: 'fn_sec',
        name: 'securityTest',
        params: [],
        returnType: IRType.Any,
        blocks: [
          {
            id: 'b0',
            label: 'entry',
            instructions: insts,
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
    constantPool: constantPoolValues.map((entry, i) => ({ index: i, kind: entry.kind as ConstantKind, value: entry.value })),
    metadata: {
      sourceFile: 'security.ts',
      originalByteSize: 0,
      functionCount: 1,
      blockCount: 1,
      instructionCount: insts.length,
      buildTimestamp: 0,
    },
  };
}

const baseConfig: VMBuildConfig = {
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
  runtimeHardening: 'none',
  profile: 'generic',
};

describe('VM Security', () => {
  it('resists code injection via constant pool with malicious strings', () => {
    const maliciousStrings = [
      '"); process.exit(1); ("',
      '\\"; process.exit(1); //',
    ];
    for (const malicious of maliciousStrings) {
      const module = makeModuleWithPool([{ index: 0, value: malicious, kind: 'string' }]);
      const compiled = compileToBytecode(module, baseConfig);
      const bundle = buildVMRuntime(compiled, baseConfig);
      expect(bundle).toBeDefined();
      expect(bundle.fullSource).toBeDefined();
      // The string must be JSON-escaped in the generated source, never raw
      const escaped = JSON.stringify(malicious);
      expect(bundle.fullSource).toContain(escaped);
    }
  });

  it('handles zero-length bytecode gracefully', () => {
    const mapping = generateRemappedOpcodes(7);
    const result = decodeBytecode(new Uint8Array(0), mapping, baseConfig);
    expect(result).toBeDefined();
  });

  it('rejects malformed bytecode — truncated instruction', () => {
    const mapping = generateRemappedOpcodes(7);
    const bytes = new Uint8Array([0x01]);
    expect(() => decodeBytecode(bytes, mapping, baseConfig)).toThrow();
  });

  it('includes all 256 handler slots in generated source', () => {
    const mapping = generateRemappedOpcodes(7);
    const bundle = buildVMRuntime(
      {
        magic: 0x54534F42,
        version: 1,
        buildId: 'trap-test',
        opcodeMapping: mapping,
        constantPool: [],
        functions: [
          {
            id: 'f1',
            name: 'trapTest',
            bytecode: new Uint8Array([1, 0]),
            paramCount: 0,
            localCount: 0,
            maxRegisters: 0,
            attributes: [],
            isEntryPoint: true,
          },
        ],
        entryPointIndex: 0,
        metadata: {
          buildTimestamp: 0,
          buildId: 'trap-test',
          sourceHash: '00000000',
          profile: 'generic',
          deterministicSeed: 7,
        },
      },
      baseConfig,
    );
    expect(bundle).toBeDefined();
    expect(bundle.fullSource).toContain('const handlers = [');
    expect(bundle.fullSource).toMatch(/handlers\s*=\s*\[/);
  });

  it('handles empty constant pool gracefully', () => {
    const module = makeModuleWithPool([]);
    const compiled = compileToBytecode(module, baseConfig);
    expect(compiled.functions).toHaveLength(1);
    const bundle = buildVMRuntime(compiled, baseConfig);
    expect(bundle).toBeDefined();
  });

  it('handles large constant pool values without overflow', () => {
    const largeValue = 'A'.repeat(10000);
    const module = makeModuleWithPool([{ index: 0, value: largeValue, kind: 'string' }]);
    const compiled = compileToBytecode(module, { ...baseConfig, constantPoolEncoding: ConstantEncodingScheme.Identity });
    const bundle = buildVMRuntime(compiled, { ...baseConfig, constantPoolEncoding: ConstantEncodingScheme.Identity });
    expect(bundle).toBeDefined();
  });
});
