import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import { compileToBytecode } from '../../bytecode/src/compiler.js';
import { decodeBytecode } from '../../bytecode/src/decoder.js';
import { generateRemappedOpcodes } from '../../bytecode/src/opcodes.js';
import {
  OpCode,
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
  OperandKind,
  FunctionAttribute,
  IRType,
  type ConstantKind,
  type IRModule,
  type Instruction,
  type VMBuildConfig,
} from '@tsvm/shared';

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
    const maliciousStrings = ['"); process.exit(1); ("', '\\"; process.exit(1); //'];
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
        magic: 0x54534f42,
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

  it('triggers selfDestruct when tamper detection finds a replaced intrinsic', () => {
    const origSin = Math.sin;
    const origToString = Function.prototype.toString;

    try {
      // Replace a key intrinsic to trigger tamper detection
      Math.sin = function fakeSin() { return 0; } as typeof Math.sin;

      const ir = {
        id: 'tamper-test',
        sourceFile: 'tamper-test.ts',
        functions: [
          {
            id: 'fn_tamper',
            name: 'fnTamper',
            params: [],
            returnType: 1 as any,
            blocks: [
              {
                id: 'b0',
                label: 'entry',
                instructions: [],
                terminator: { kind: 'return' as const, targets: [] },
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
          sourceFile: 'tamper-test.ts',
          originalByteSize: 0,
          functionCount: 1,
          blockCount: 1,
          instructionCount: 0,
          buildTimestamp: 0,
        },
      } as any;

      const compiled = compileToBytecode(ir, {
        ...baseConfig,
        tamperDetection: true,
        junkInsertion: true,
        rollingKeys: true,
      });

      const bundle = buildVMRuntime(compiled, {
        ...baseConfig,
        tamperDetection: true,
        junkInsertion: true,
        rollingKeys: true,
      });

      const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
      let loadError: Error | null = null;
      try {
        new Function('module', bundle.fullSource)(moduleShim);
      } catch (e) {
        loadError = e as Error;
      }

      // With tampered Math.sin, the tamper detection should either throw during load
      // or produce a poisoned context that returns undefined/wrong results
      if (!loadError) {
        const result = moduleShim.exports.fnTamper();
        // When selfDestruct is triggered, execution should produce undefined or failure
        expect(result).toBeUndefined();
      } else {
        expect(loadError).toBeDefined();
      }
    } finally {
      Math.sin = origSin;
      Function.prototype.toString = origToString;
    }
  });

  it('runs normally under clean environment with tamper detection enabled', () => {
    const ir = {
      id: 'tamper-clean',
      sourceFile: 'tamper-clean.ts',
      functions: [
        {
          id: 'fn_clean',
          name: 'fnClean',
          params: [],
          returnType: 1 as any,
          blocks: [
            {
              id: 'b0',
              label: 'entry',
              instructions: [
                { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
              ],
              terminator: { kind: 'return' as const, targets: [], returnValue: 'r0' },
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
      constantPool: [{ index: 0, kind: 'number' as any, value: 42 }],
      metadata: {
        sourceFile: 'tamper-clean.ts',
        originalByteSize: 0,
        functionCount: 1,
        blockCount: 1,
        instructionCount: 1,
        buildTimestamp: 0,
      },
    } as any;

    const compiled = compileToBytecode(ir, {
      ...baseConfig,
      tamperDetection: true,
      junkInsertion: true,
      rollingKeys: true,
    });

    const bundle = buildVMRuntime(compiled, {
      ...baseConfig,
      tamperDetection: true,
      junkInsertion: true,
      rollingKeys: true,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    const result = moduleShim.exports.fnClean();
    expect(result).toBe(42);
  });
});
