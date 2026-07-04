import { describe, it, expect } from 'vitest';
import { FunctionVirtualizationPass } from '../../src/passes/function-virtualization.js';
import {
  type IRModule,
  type TransformContext,
  type ObfuscationProfile,
  type ProjectSemanticGraph,
  IRType,
  FunctionAttribute,
  SeededRandom,
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

describe('FunctionVirtualizationPass', () => {
  it('preserves isVirtualized flag for normal functions', () => {
    const pass = new FunctionVirtualizationPass();
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
          blocks: [],
          globals: [],
          imports: [],
          exports: [],
          constantPool: [],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.module.functions[0]!.isVirtualized).toBe(true);
  });

  it('disables virtualization for React components', () => {
    const pass = new FunctionVirtualizationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'MyComponent',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [FunctionAttribute.ReactComponent],
          capturedVariables: [],
          blocks: [],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.module.functions[0]!.isVirtualized).toBe(false);
  });

  it('handles multiple functions with mixed attributes', () => {
    const pass = new FunctionVirtualizationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn1',
          name: 'normalFunc',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [],
        },
        {
          id: 'fn2',
          name: 'MyComponent',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [FunctionAttribute.ReactComponent],
          capturedVariables: [],
          blocks: [],
        },
        {
          id: 'fn3',
          name: 'alreadyJs',
          params: [],
          returnType: IRType.Void,
          locals: [],
          isVirtualized: false,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 3, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.module.functions[0]!.isVirtualized).toBe(true);
    expect(result.module.functions[1]!.isVirtualized).toBe(false);
    expect(result.module.functions[2]!.isVirtualized).toBe(false);
  });

  it('returns zero for all counters', () => {
    const pass = new FunctionVirtualizationPass();
    const mod: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 0, instructionCount: 0, originalByteSize: 0 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.symbolsRenamed).toBe(0);
    expect(result.nodesTransformed).toBe(0);
    expect(result.diagnostics).toEqual([]);
  });
});
