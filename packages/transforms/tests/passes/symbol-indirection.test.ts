import { describe, it, expect } from 'vitest';
import { SymbolIndirectionPass } from '../../src/passes/symbol-indirection.js';
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
  vm: { opcodeRemapping: true, immediateEncoding: 1, superInstructions: false, handlerLayoutRandom: false, constantPoolEncoding: 0, traceMode: false, deterministicReplay: false, seed: 7 },
  preservePatterns: [],
  preserveExports: true,
  preserveDecorators: false,
  reactSafe: false,
  electronHarden: false,
  deterministic: true,
  seed: 7,
};

function createBaseModule(overrides?: Partial<IRModule>): IRModule {
  return {
    id: 'test',
    sourceFile: 'test.ts',
    functions: [
      {
        id: 'fn1',
        name: 'internalFunc',
        params: [],
        returnType: IRType.Void,
        locals: [{ name: 'x', register: 'r0', type: IRType.Number, isCaptured: false }],
        isVirtualized: false,
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
    ...overrides,
  };
}

function createCtx(module: IRModule, rng = new SeededRandom(42)): TransformContext {
  return {
    module,
    profile: mockProfile,
    semanticGraph: { rootDir: '', modules: new Map(), dependencyEdges: [], entryPoints: [], symbolTable: [], aliases: new Map(), compilerOptions: {}, diagnostics: [] } as ProjectSemanticGraph,
    symbolAliases: new Map(),
    diagnostics: [],
    rng,
    phase: 0,
  };
}

describe('SymbolIndirectionPass', () => {
  it('renames non-exported, non-virtualized functions', () => {
    const pass = new SymbolIndirectionPass();
    const result = pass.execute(createCtx(createBaseModule()));
    const func = result.module.functions[0]!;
    expect(func.name).toMatch(/^fn_[a-zA-Z][a-zA-Z0-9_$]{7}$/);
    expect(func.locals[0]!.name).toMatch(/^v_[a-zA-Z][a-zA-Z0-9_$]{5}$/);
    expect(result.symbolsRenamed).toBeGreaterThan(0);
  });

  it('preserves exported functions', () => {
    const pass = new SymbolIndirectionPass();
    const mod = createBaseModule({
      functions: [
        {
          id: 'fn1', name: 'exportedFunc', params: [], returnType: IRType.Void,
          locals: [], isVirtualized: false, isExported: true, attributes: [], capturedVariables: [],
          blocks: [{ id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [], terminator: { kind: 'return', targets: [] }, instructions: [] }],
        },
      ],
    });
    const result = pass.execute(createCtx(mod));
    expect(result.module.functions[0]!.name).toBe('exportedFunc');
    expect(result.symbolsRenamed).toBe(0);
  });

  it('preserves virtualized functions', () => {
    const pass = new SymbolIndirectionPass();
    const mod = createBaseModule({
      functions: [
        {
          id: 'fn1', name: 'vmFunc', params: [], returnType: IRType.Void,
          locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
          blocks: [{ id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [], terminator: { kind: 'return', targets: [] }, instructions: [] }],
        },
      ],
    });
    const result = pass.execute(createCtx(mod));
    expect(result.module.functions[0]!.name).toBe('vmFunc');
    expect(result.symbolsRenamed).toBe(0);
  });

  it('preserves React hooks when reactSafe is enabled', () => {
    const pass = new SymbolIndirectionPass();
    const mod = createBaseModule({
      functions: [
        {
          id: 'fn1', name: 'useState', params: [], returnType: IRType.Void,
          locals: [{ name: 'x', register: 'r0', type: IRType.Number, isCaptured: false }],
          isVirtualized: false, isExported: false, attributes: [], capturedVariables: [],
          blocks: [{ id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [], terminator: { kind: 'return', targets: [] }, instructions: [] }],
        },
      ],
    });
    const ctx = createCtx(mod);
    ctx.profile = { ...mockProfile, reactSafe: true };
    const result = pass.execute(ctx);
    expect(result.module.functions[0]!.name).toBe('useState');
  });

  it('is deterministic for same seed', () => {
    const pass = new SymbolIndirectionPass();
    const a = pass.execute(createCtx(createBaseModule(), new SeededRandom(42)));
    const b = pass.execute(createCtx(createBaseModule(), new SeededRandom(42)));
    expect(a.module.functions[0]!.name).toBe(b.module.functions[0]!.name);
  });

  it('returns empty diagnostics', () => {
    const pass = new SymbolIndirectionPass();
    const result = pass.execute(createCtx(createBaseModule()));
    expect(result.diagnostics).toEqual([]);
  });
});
