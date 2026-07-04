import { describe, it, expect } from 'vitest';
import { RegisterCompactingPass } from '../../src/passes/register-compacting.js';
import {
  type IRModule,
  type TransformContext,
  type ObfuscationProfile,
  type ProjectSemanticGraph,
  IRType,
  OpCode,
  OperandKind,
  SeededRandom,
} from '@tsvm/shared';

const mockProfile: ObfuscationProfile = {
  name: 'generic', target: 'generic',
  transforms: [],
  virtualization: { mode: 'annotated', annotations: ['@virtualize'], maxFunctionSize: 100, excludePatterns: [] },
  vm: { opcodeRemapping: true, immediateEncoding: 1, superInstructions: false, handlerLayoutRandom: false, constantPoolEncoding: 0, traceMode: false, deterministicReplay: false, seed: 7 },
  preservePatterns: [], preserveExports: true, preserveDecorators: false, reactSafe: false, electronHarden: false, deterministic: true, seed: 7,
};

function createCtx(module: IRModule): TransformContext {
  return {
    module,
    profile: mockProfile,
    semanticGraph: { rootDir: '', modules: new Map(), dependencyEdges: [], entryPoints: [], symbolTable: [], aliases: new Map(), compilerOptions: {}, diagnostics: [] } as ProjectSemanticGraph,
    symbolAliases: new Map(), diagnostics: [], rng: new SeededRandom(42), phase: 0,
  };
}

describe('RegisterCompactingPass', () => {
  it('compacts registers with gaps', () => {
    const pass = new RegisterCompactingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc',
        params: [{ name: 'p0', register: 'r0', type: IRType.Number, isRest: false }],
        returnType: IRType.Void,
        locals: [{ name: 'x', register: 'r5', type: IRType.Number, isCaptured: false }],
        isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [], returnValue: 'r5' },
          instructions: [
            { opcode: OpCode.Move, operands: [{ kind: OperandKind.Register, value: 'r0' }, { kind: OperandKind.Register, value: 'r5' }] },
          ],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    const func = result.module.functions[0]!;
    expect(func.params[0]!.register).toBe('r0');
    expect(func.locals[0]!.register).toBe('r1');
    expect(result.nodesTransformed).toBe(1);
  });

  it('does not modify already-compact registers', () => {
    const pass = new RegisterCompactingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [{ name: 'x', register: 'r0', type: IRType.Number, isCaptured: false }],
        isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.nodesTransformed).toBe(0);
    expect(result.module.functions[0]!.locals[0]!.register).toBe('r0');
  });

  it('skips non-virtualized functions', () => {
    const pass = new RegisterCompactingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [{ name: 'x', register: 'r5', type: IRType.Number, isCaptured: false }],
        isVirtualized: false, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 0, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.nodesTransformed).toBe(0);
    expect(result.module.functions[0]!.locals[0]!.register).toBe('r5');
  });

  it('rewrites instruction operands', () => {
    const pass = new RegisterCompactingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [{ name: 'x', register: 'r0', type: IRType.Number, isCaptured: false }],
        isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [], returnValue: 'r3' },
          instructions: [
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: 'r0' }, { kind: OperandKind.Register, value: 'r3' }], result: 'r3' },
          ],
        }],
      }],
      globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    const inst = result.module.functions[0]!.blocks[0]!.instructions[0]!;
    expect(inst.operands[0]!.value).toBe('r0');
    expect(inst.operands[1]!.value).toBe('r1');
    expect(inst.result).toBe('r1');
  });

  it('returns empty diagnostics', () => {
    const pass = new RegisterCompactingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts', functions: [], globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 0, instructionCount: 0, originalByteSize: 0 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics).toEqual([]);
  });
});
