import { describe, it, expect } from 'vitest';
import { DecoratorAwareLoweringPass } from '../../src/passes/decorator-aware-lowering.js';
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

function createCtx(module: IRModule, rng = new SeededRandom(0)): TransformContext {
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
    rng,
    phase: 0,
  };
}

describe('DecoratorAwareLoweringPass', () => {
  it('inserts Move instruction before Call with temp register when rng triggers', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new DecoratorAwareLoweringPass();
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
              instructions: [{ opcode: OpCode.Call, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' }],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    const insts = result.module.functions[0]!.blocks[0]!.instructions;
    expect(insts.length).toBe(2);
    expect(insts[0]!.opcode).toBe(OpCode.Move);
    expect(insts[1]!.opcode).toBe(OpCode.Call);
    expect(insts[1]!.operands[0]!.value).not.toBe('r0');
    expect(result.nodesTransformed).toBe(1);
  });

  it('does not modify Call when rng does not trigger', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.5;
    const pass = new DecoratorAwareLoweringPass();
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
              instructions: [{ opcode: OpCode.Call, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' }],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.nodesTransformed).toBe(0);
    expect(result.module.functions[0]!.blocks[0]!.instructions.length).toBe(1);
  });

  it('processes CallMethod instructions', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new DecoratorAwareLoweringPass();
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
              instructions: [
                {
                  opcode: OpCode.CallMethod,
                  operands: [
                    { kind: OperandKind.Register, value: 'r0' },
                    { kind: OperandKind.Register, value: 'r1' },
                  ],
                  result: 'r2',
                },
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.nodesTransformed).toBe(1);
  });

  it('skips non-virtualized functions', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new DecoratorAwareLoweringPass();
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
              predecessors: [],
              successors: [],
              terminator: { kind: 'return', targets: [] },
              instructions: [{ opcode: OpCode.Call, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' }],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.nodesTransformed).toBe(0);
  });

  it('adds local for temp register', () => {
    const rng = new SeededRandom(0);
    rng.nextFloat = () => 0.1;
    const pass = new DecoratorAwareLoweringPass();
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
              instructions: [{ opcode: OpCode.Call, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' }],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 1, originalByteSize: 100 },
    };
    const result = pass.execute(createCtx(mod, rng));
    expect(result.module.functions[0]!.locals.length).toBe(1);
  });
});
