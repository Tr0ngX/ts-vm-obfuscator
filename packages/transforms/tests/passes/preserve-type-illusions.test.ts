import { describe, it, expect } from 'vitest';
import { PreserveTypeIllusionsPass } from '../../src/passes/preserve-type-illusions.js';
import {
  type IRModule,
  type TransformContext,
  type ObfuscationProfile,
  type ProjectSemanticGraph,
  IRType,
  OpCode,
  OperandKind,
  ConstantKind,
  SeededRandom,
} from '@tsvm/shared';

const mockProfile: ObfuscationProfile = {
  name: 'generic', target: 'generic',
  transforms: [],
  virtualization: { mode: 'annotated', annotations: ['@virtualize'], maxFunctionSize: 100, excludePatterns: [] },
  vm: { opcodeRemapping: true, immediateEncoding: 1, superInstructions: false, handlerLayoutRandom: false, constantPoolEncoding: 0, traceMode: false, deterministicReplay: false, seed: 7 },
  preservePatterns: [], preserveExports: true, preserveDecorators: false, reactSafe: false, electronHarden: false, deterministic: true, seed: 7,
};

function createCtx(module: IRModule, rng = new SeededRandom(0)): TransformContext {
  return {
    module,
    profile: mockProfile,
    semanticGraph: { rootDir: '', modules: new Map(), dependencyEdges: [], entryPoints: [], symbolTable: [], aliases: new Map(), compilerOptions: {}, diagnostics: [] } as ProjectSemanticGraph,
    symbolAliases: new Map(), diagnostics: [], rng, phase: 0,
  };
}

describe('PreserveTypeIllusionsPass', () => {
  it('injects type guard instructions for virtualized functions with params', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new PreserveTypeIllusionsPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc',
        params: [{ name: 'x', register: 'r0', type: IRType.Number, isRest: false }],
        returnType: IRType.Void, locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    const insts = result.module.functions[0]!.blocks[0]!.instructions;
    expect(insts.length).toBeGreaterThanOrEqual(3);
    expect(insts[0]!.opcode).toBe(OpCode.TypeOf);
    expect(insts[1]!.opcode).toBe(OpCode.LoadConst);
    expect(insts[2]!.opcode).toBe(OpCode.Eq);
    expect(result.nodesTransformed).toBe(1);
  });

  it('adds "function" string to constant pool', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new PreserveTypeIllusionsPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc',
        params: [{ name: 'x', register: 'r0', type: IRType.Number, isRest: false }],
        returnType: IRType.Void, locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.String, value: 'something' }],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    const strings = result.module.constantPool.filter(c => c.kind === ConstantKind.String);
    expect(strings.some(s => s.value === 'function')).toBe(true);
  });

  it('skips functions with no parameters', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new PreserveTypeIllusionsPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.nodesTransformed).toBe(0);
  });

  it('skips non-virtualized functions', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new PreserveTypeIllusionsPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc',
        params: [{ name: 'x', register: 'r0', type: IRType.Number, isRest: false }],
        returnType: IRType.Void, locals: [], isVirtualized: false, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.nodesTransformed).toBe(0);
  });

  it('adds locals for temp registers', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new PreserveTypeIllusionsPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc',
        params: [{ name: 'x', register: 'r0', type: IRType.Number, isRest: false }],
        returnType: IRType.Void, locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.module.functions[0]!.locals.length).toBe(3);
  });
});
