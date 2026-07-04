import { describe, it, expect } from 'vitest';
import { StringPoolEncodingPass } from '../../src/passes/string-pool-encoding.js';
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
  transforms: [{ name: 'StringPoolEncodingPass', enabled: true, options: { fragmentStrings: true, minLength: 3 } }],
  virtualization: { mode: 'annotated', annotations: ['@virtualize'], maxFunctionSize: 100, excludePatterns: [] },
  vm: { opcodeRemapping: true, immediateEncoding: 1, superInstructions: false, handlerLayoutRandom: false, constantPoolEncoding: 0, traceMode: false, deterministicReplay: false, seed: 7 },
  preservePatterns: [], preserveExports: true, preserveDecorators: false, reactSafe: false, electronHarden: false, deterministic: true, seed: 7,
};

function createCtx(module: IRModule, rng = new SeededRandom(42)): TransformContext {
  return {
    module,
    profile: mockProfile,
    semanticGraph: { rootDir: '', modules: new Map(), dependencyEdges: [], entryPoints: [], symbolTable: [], aliases: new Map(), compilerOptions: {}, diagnostics: [] } as ProjectSemanticGraph,
    symbolAliases: new Map(), diagnostics: [], rng, phase: 0,
  };
}

describe('StringPoolEncodingPass', () => {
  it('replaces long string LoadConst with fragment decoding instructions', () => {
    const pass = new StringPoolEncodingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
          ],
        }],
      }],
      globals: [], imports: [], exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.String, value: 'HelloWorld' }],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    const insts = result.module.functions[0]!.blocks[0]!.instructions;
    expect(insts.length).toBeGreaterThan(1);
    expect(result.nodesTransformed).toBe(1);
    expect(insts.some(i => i.opcode === OpCode.ArrayNew)).toBe(true);
    expect(insts.some(i => i.opcode === OpCode.CallWithArray)).toBe(true);
  });

  it('does not transform short strings below minLength threshold', () => {
    const pass = new StringPoolEncodingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
          ],
        }],
      }],
      globals: [], imports: [], exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.String, value: 'ab' }],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    const insts = result.module.functions[0]!.blocks[0]!.instructions;
    expect(insts.length).toBe(1);
    expect(insts[0]!.opcode).toBe(OpCode.LoadConst);
    expect(result.nodesTransformed).toBe(0);
  });

  it('adds String and fromCharCode to constant pool', () => {
    const pass = new StringPoolEncodingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
          ],
        }],
      }],
      globals: [], imports: [], exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.String, value: 'HelloWorld' }],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    const strings = result.module.constantPool.filter(c => c.kind === ConstantKind.String);
    expect(strings.some(s => s.value === 'String')).toBe(true);
    expect(strings.some(s => s.value === 'fromCharCode')).toBe(true);
  });

  it('skips non-const instructions', () => {
    const pass = new StringPoolEncodingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [{
        id: 'fn1', name: 'testFunc', params: [], returnType: IRType.Void,
        locals: [], isVirtualized: true, isExported: false, attributes: [], capturedVariables: [],
        blocks: [{
          id: 'b1', label: 'entry', phiNodes: [], predecessors: [], successors: [],
          terminator: { kind: 'return', targets: [] },
          instructions: [
            { opcode: OpCode.Move, operands: [{ kind: OperandKind.Register, value: 'r0' }, { kind: OperandKind.Register, value: 'r1' }] },
          ],
        }],
      }],
      globals: [], imports: [], exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.String, value: 'HelloWorld' }],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.nodesTransformed).toBe(0);
  });

  it('returns empty diagnostics', () => {
    const pass = new StringPoolEncodingPass();
    const mod: IRModule = {
      id: 'test', sourceFile: 'test.ts',
      functions: [], globals: [], imports: [], exports: [], constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 0, functionCount: 0, instructionCount: 0, originalByteSize: 0 },
    };
    const result = pass.execute(createCtx(mod));
    expect(result.diagnostics).toEqual([]);
  });
});
