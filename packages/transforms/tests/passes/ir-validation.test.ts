import { describe, it, expect } from 'vitest';
import { IRValidationPass } from '../../src/passes/ir-validation.js';
import {
  type IRModule,
  type TransformContext,
  type ObfuscationProfile,
  type ProjectSemanticGraph,
  IRType,
  OperandKind,
  OpCode,
  SeededRandom,
  DiagnosticSeverity,
} from '@tsvm/shared';

const mockProfile: ObfuscationProfile = {
  name: 'generic',
  target: 'generic',
  transforms: [],
  virtualization: { mode: 'annotated', annotations: ['@virtualize'], maxFunctionSize: 100, excludePatterns: [] },
  vm: {
    opcodeRemapping: true,
    immediateEncoding: 1,
    superInstructions: false,
    handlerLayoutRandom: false,
    constantPoolEncoding: 0,
    traceMode: false,
    deterministicReplay: false,
    seed: 7,
  },
  preservePatterns: [],
  preserveExports: true,
  preserveDecorators: false,
  reactSafe: false,
  electronHarden: false,
  deterministic: true,
  seed: 7,
};

function createCtx(module: IRModule): TransformContext {
  return {
    module,
    profile: mockProfile,
    semanticGraph: {
      rootDir: '',
      modules: new Map(),
      dependencyEdges: [],
      entryPoints: [],
      symbolTable: [],
      aliases: new Map(),
      compilerOptions: {},
      diagnostics: [],
    } as ProjectSemanticGraph,
    symbolAliases: new Map(),
    diagnostics: [],
    rng: new SeededRandom(42),
    phase: 0,
  };
}

describe('IRValidationPass', () => {
  it('validates a well-formed function produces no diagnostics', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: [],
              terminator: { kind: 'return', targets: [] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics).toHaveLength(0);
  });

  it('detects non-existent predecessor', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: ['nonexistent'],
              successors: [],
              terminator: { kind: 'return', targets: [] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.some((d) => d.code === 'IR_INVALID_PREDECESSOR')).toBe(true);
  });

  it('detects non-existent successor', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: ['nonexistent'],
              terminator: { kind: 'return', targets: [] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics.some((d) => d.code === 'IR_INVALID_SUCCESSOR')).toBe(true);
  });

  it('detects non-existent terminator target', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: [],
              terminator: { kind: 'jump', targets: ['ghost'] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics.some((d) => d.code === 'IR_INVALID_TARGET')).toBe(true);
  });

  it('detects phi node incoming block not in function', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [
                {
                  result: 'r0',
                  incoming: [{ blockId: 'nonexistent', register: 'r1' }],
                },
              ],
              predecessors: [],
              successors: [],
              terminator: { kind: 'return', targets: [] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics.some((d) => d.code === 'IR_INVALID_PHI_BLOCK')).toBe(true);
  });

  it('detects inconsistent bidirectional edges', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: ['b2'],
              terminator: { kind: 'jump', targets: ['b2'] },
              instructions: [],
            },
            {
              id: 'b2',
              label: 'exit',
              phiNodes: [],
              predecessors: [],
              successors: [],
              terminator: { kind: 'return', targets: [] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 2, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics.some((d) => d.code === 'IR_INCONSISTENT_EDGE')).toBe(true);
  });

  it('skips non-virtualized functions', () => {
    const pass = new IRValidationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'testFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: false,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              phiNodes: [],
              predecessors: ['ghost'],
              successors: ['ghost2'],
              terminator: { kind: 'jump', targets: ['ghost3'] },
              instructions: [],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics).toHaveLength(0);
  });
});
