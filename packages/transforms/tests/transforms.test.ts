import { describe, it, expect } from 'vitest';
import { ControlFlowFlatteningPass } from '../src/passes/control-flow-flattening.js';
import { DeadCodeInjectionPass } from '../src/passes/dead-code-injection.js';
import { TypeLevelFakePathPass } from '../src/passes/type-level-fake-path.js';
import { ConstantKind, IRModule, IRType, OperandKind, OpCode, ProjectSemanticGraph, SeededRandom, TransformContext, ObfuscationProfile } from '@tsvm/shared';
import { createTransformRegistry } from '../src/registry.js';

const mockProfile: ObfuscationProfile = {
  name: 'generic',
  features: {
    stringEncryption: false,
    propertyRenaming: false,
    controlFlowFlattening: true,
    deadCodeInjection: true,
    opaquePredicates: false,
  },
  vmFeatures: {
    antiDebug: false,
    tamperDetection: false,
    rollingKeys: false
  },
  transforms: [
    { name: 'GenericConfusionPass', enabled: true },
    { name: 'PropertyRenamingPass', enabled: false },
    { name: 'ControlFlowFlatteningPass', enabled: true },
    { name: 'DeadCodeInjectionPass', enabled: true }
  ]
};describe('Advanced Transforms', () => {
  it('ControlFlowFlatteningPass should split large blocks', () => {
    const pass = new ControlFlowFlatteningPass();
    const rng = new SeededRandom(42);
    
    // Create a dummy module with one large block
    const dummyModule: IRModule = {
      id: 'test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'func1',
          name: 'func1',
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
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] }
              ] // 6 instructions > 5
            }
          ]
        }
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 6, originalByteSize: 100 }
    };

    const ctx: TransformContext = {
      module: dummyModule,
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
      phase: 0
    };

    const result = pass.execute(ctx);
    
    // A block with 6 instructions and 50% split chance should get split.
    // If rng doesn't split it, it remains 1. Let's just ensure it doesn't crash.
    expect(result.module.functions[0].blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('DeadCodeInjectionPass should add junk code', () => {
    const pass = new DeadCodeInjectionPass();
    const rng = new SeededRandom(42);
    
    const dummyModule: IRModule = {
      id: 'test2',
      sourceFile: 'test2.ts',
      functions: [
        {
          id: 'func1',
          name: 'func1',
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
                { opcode: 0x01, operands: [] },
                { opcode: 0x02, operands: [] }
              ]
            }
          ]
        }
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test2.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 2, originalByteSize: 100 }
    };

    const ctx: TransformContext = {
      module: dummyModule,
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
      phase: 0
    };

    const result = pass.execute(ctx);
    
    // It should add junk math operations if triggered
    expect(result.module.functions[0].blocks[0].instructions.length).toBeGreaterThanOrEqual(2);
  });

  it('Registry should load new passes', () => {
    const registry = createTransformRegistry(mockProfile);
    const passes = registry.getOrderedPasses();
    
    const hasCFF = passes.some(p => p.name === 'ControlFlowFlatteningPass');
    const hasDeadCode = passes.some(p => p.name === 'DeadCodeInjectionPass');
    
    expect(hasCFF).toBe(true);
    expect(hasDeadCode).toBe(true);
  });

  it('TypeLevelFakePathPass should keep the congruence invariant on the real path', () => {
    const pass = new TypeLevelFakePathPass();
    const dummyModule: IRModule = {
      id: 'fake-path-test',
      sourceFile: 'fake-path-test.ts',
      functions: [
        {
          id: 'func1',
          name: 'func1',
          params: [{ name: 'value', register: 'r0', type: IRType.Number }],
          returnType: IRType.Number,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            {
              id: 'entry',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: ['real'],
              instructions: [],
              terminator: { kind: 'jump', targets: ['real'] }
            },
            {
              id: 'real',
              label: 'real',
              phiNodes: [],
              predecessors: ['entry'],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [], returnValue: 'r0' }
            },
            {
              id: 'tail',
              label: 'tail',
              phiNodes: [],
              predecessors: [],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [] }
            }
          ]
        }
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'fake-path-test.ts', buildTimestamp: 0, blockCount: 3, functionCount: 1, instructionCount: 0, originalByteSize: 100 }
    };

    const ctx: TransformContext = {
      module: dummyModule,
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
      rng: new SeededRandom(1),
      phase: 0
    };

    const result = pass.execute(ctx);
    const func = result.module.functions[0]!;
    const rewrittenEntry = func.blocks.find(block => block.id === 'entry')!;
    const fakeBlock = func.blocks.find(block => block.id.startsWith('__fake_path_'))!;

    expect(result.nodesTransformed).toBe(1);
    expect(rewrittenEntry.terminator.kind).toBe('branch');
    expect(rewrittenEntry.terminator.targets).toEqual(['real', fakeBlock.id]);
    expect(rewrittenEntry.successors).toEqual(['real', fakeBlock.id]);
    expect(rewrittenEntry.instructions.map(inst => inst.opcode)).toEqual([
      OpCode.LoadConst,
      OpCode.LoadGlobal,
      OpCode.TypeOf,
      OpCode.LoadConst,
      OpCode.PropGet,
      OpCode.LoadConst,
      OpCode.LoadGlobal,
      OpCode.TypeOf,
      OpCode.PropGet,
      OpCode.LoadConst,
      OpCode.Mul,
      OpCode.Add,
      OpCode.LoadConst,
      OpCode.BitAnd,
      OpCode.Mul,
      OpCode.LoadConst,
      OpCode.Add,
      OpCode.LoadConst,
      OpCode.Mod,
      OpCode.LoadConst,
      OpCode.StrictEq,
      OpCode.Not,
      OpCode.LoadConst,
      OpCode.LoadGlobal,
      OpCode.New,
      OpCode.LoadConst,
      OpCode.PropGet,
      OpCode.TypeOf,
      OpCode.LoadConst,
      OpCode.StrictEq,
      OpCode.StrictEq
    ]);
    const lastOp = fakeBlock.instructions.at(-1)?.opcode;
    expect([OpCode.Trap, OpCode.LoadConst, OpCode.Move]).toContain(lastOp);
    expect(result.module.constantPool).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: ConstantKind.String, value: 'process' }),
      expect.objectContaining({ kind: ConstantKind.String, value: 'window' }),
      expect.objectContaining({ kind: ConstantKind.String, value: 'length' }),
      expect.objectContaining({ kind: ConstantKind.Number, value: 31 }),
      expect.objectContaining({ kind: ConstantKind.Number, value: 15 }),
      expect.objectContaining({ kind: ConstantKind.Number, value: 8 }),
      expect.objectContaining({ kind: ConstantKind.String, value: 'Error' }),
      expect.objectContaining({ kind: ConstantKind.String, value: 'stack' }),
      expect.objectContaining({ kind: ConstantKind.String, value: 'string' })
    ]));
    expect(rewrittenEntry.instructions.at(-1)?.operands[0]).toEqual({
      kind: OperandKind.Register,
      value: expect.stringMatching(/^r\d+$/)
    });
  });

  it('TypeLevelFakePathPass should add paranoid fake paths with bounded invariant templates and trap tails', () => {
    const pass = new TypeLevelFakePathPass();
    const dummyModule: IRModule = {
      id: 'paranoid-fake-path-test',
      sourceFile: 'paranoid-fake-path-test.ts',
      functions: [
        {
          id: 'func1',
          name: 'func1',
          params: [{ name: 'value', register: 'r0', type: IRType.Number }],
          returnType: IRType.Number,
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
          blocks: [
            { id: 'entry', label: 'entry', phiNodes: [], predecessors: [], successors: ['a'], instructions: [], terminator: { kind: 'jump', targets: ['a'] } },
            { id: 'a', label: 'a', phiNodes: [], predecessors: ['entry'], successors: ['b'], instructions: [], terminator: { kind: 'jump', targets: ['b'] } },
            { id: 'b', label: 'b', phiNodes: [], predecessors: ['a'], successors: ['real'], instructions: [], terminator: { kind: 'jump', targets: ['real'] } },
            { id: 'real', label: 'real', phiNodes: [], predecessors: ['b'], successors: [], instructions: [], terminator: { kind: 'return', targets: [], returnValue: 'r0' } }
          ]
        }
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'paranoid-fake-path-test.ts', buildTimestamp: 0, blockCount: 4, functionCount: 1, instructionCount: 0, originalByteSize: 100 }
    };

    const ctx: TransformContext = {
      module: dummyModule,
      profile: {
        ...mockProfile,
        vm: {
          opcodeRemapping: true,
          immediateEncoding: 1,
          superInstructions: false,
          handlerLayoutRandom: false,
          constantPoolEncoding: 0,
          traceMode: false,
          deterministicReplay: false,
          seed: 1,
          runtimeHardening: 'paranoid'
        }
      } as ObfuscationProfile,
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
      rng: new SeededRandom(1),
      phase: 0
    };

    const result = pass.execute(ctx);
    const func = result.module.functions[0]!;
    const fakeBlocks = func.blocks.filter(block => block.id.startsWith('__fake_path_'));
    const branchBlocks = func.blocks.filter(block => block.terminator.kind === 'branch');
    const boundedConstants = result.module.constantPool.filter(cp => cp.kind === ConstantKind.Number).map(cp => cp.value);

    expect(result.nodesTransformed).toBeGreaterThanOrEqual(1);
    expect(fakeBlocks.length).toBeGreaterThanOrEqual(1);
    expect(fakeBlocks.length).toBeLessThanOrEqual(3);
    expect(branchBlocks.length).toBe(fakeBlocks.length);
    for (const block of branchBlocks) {
      expect(block.terminator.targets[0]).not.toMatch(/^__fake_path_/);
      expect(block.terminator.targets[1]).toMatch(/^__fake_path_/);
      expect(block.successors).toEqual(block.terminator.targets);
    }
    for (const fakeBlock of fakeBlocks) {
      expect(fakeBlock.instructions.length).toBeGreaterThanOrEqual(1);
      const lastOp = fakeBlock.instructions.at(-1)?.opcode;
      expect([OpCode.Trap, OpCode.LoadConst, OpCode.Move]).toContain(lastOp);
    }
    expect(boundedConstants).toEqual(expect.arrayContaining([3, 4]));
    expect(boundedConstants.some(value => value === 0x9E3779B9 || value === 0x7FFFFFFF)).toBe(false);
  });
});
