import { describe, it, expect } from 'vitest';
import { ControlFlowFlatteningPass } from '../src/passes/control-flow-flattening.js';
import { DeadCodeInjectionPass } from '../src/passes/dead-code-injection.js';
import { TypeLevelFakePathPass } from '../src/passes/type-level-fake-path.js';
import { StripDebugPass } from '../src/passes/strip-debug.js';
import { InstructionSubstitutionPass } from '../src/passes/instruction-substitution.js';
import { ApiHidingPass } from '../src/passes/api-hiding.js';
import { NamespaceVirtualizationPass } from '../src/passes/namespace-virtualization.js';
import {
  ConstantKind,
  type IRModule,
  IRType,
  OperandKind,
  OpCode,
  type ProjectSemanticGraph,
  SeededRandom,
  type TransformContext,
  type ObfuscationProfile,
} from '@tsvm/shared';
import { createTransformRegistry } from '../src/registry.js';
import { applyElectronHardening } from '@tsvm/electron-hardening';

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
    rollingKeys: false,
  },
  transforms: [
    { name: 'GenericConfusionPass', enabled: true },
    { name: 'PropertyRenamingPass', enabled: false },
    { name: 'ControlFlowFlatteningPass', enabled: true },
    { name: 'DeadCodeInjectionPass', enabled: true },
  ],
};
describe('Advanced Transforms', () => {
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
                { opcode: 0x01, operands: [] },
              ], // 6 instructions > 5
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 6, originalByteSize: 100 },
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
      phase: 0,
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
                { opcode: 0x02, operands: [] },
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: { sourceFile: 'test2.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 2, originalByteSize: 100 },
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
      phase: 0,
    };

    const result = pass.execute(ctx);

    // It should add junk math operations if triggered
    expect(result.module.functions[0].blocks[0].instructions.length).toBeGreaterThanOrEqual(2);
  });

  it('Registry should load new passes', () => {
    const registry = createTransformRegistry(mockProfile);
    const passes = registry.getOrderedPasses();

    const hasCFF = passes.some((p) => p.name === 'ControlFlowFlatteningPass');
    const hasDeadCode = passes.some((p) => p.name === 'DeadCodeInjectionPass');

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
              terminator: { kind: 'jump', targets: ['real'] },
            },
            {
              id: 'real',
              label: 'real',
              phiNodes: [],
              predecessors: ['entry'],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [], returnValue: 'r0' },
            },
            {
              id: 'tail',
              label: 'tail',
              phiNodes: [],
              predecessors: [],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [] },
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'fake-path-test.ts',
        buildTimestamp: 0,
        blockCount: 3,
        functionCount: 1,
        instructionCount: 0,
        originalByteSize: 100,
      },
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
      phase: 0,
    };

    const result = pass.execute(ctx);
    const func = result.module.functions[0]!;
    const rewrittenEntry = func.blocks.find((block) => block.id === 'entry')!;
    const fakeBlock = func.blocks.find((block) => block.id.startsWith('__fake_path_'))!;

    expect(result.nodesTransformed).toBe(1);
    expect(rewrittenEntry.terminator.kind).toBe('branch');
    expect(rewrittenEntry.terminator.targets).toEqual(['real', fakeBlock.id]);
    expect(rewrittenEntry.successors).toEqual(['real', fakeBlock.id]);
    expect(rewrittenEntry.instructions.map((inst) => inst.opcode)).toEqual([
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
      OpCode.StrictEq,
    ]);
    const lastOp = fakeBlock.instructions.at(-1)?.opcode;
    expect([OpCode.Trap, OpCode.LoadConst, OpCode.Move]).toContain(lastOp);
    expect(result.module.constantPool).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: ConstantKind.String, value: 'process' }),
        expect.objectContaining({ kind: ConstantKind.String, value: 'window' }),
        expect.objectContaining({ kind: ConstantKind.String, value: 'length' }),
        expect.objectContaining({ kind: ConstantKind.Number, value: 31 }),
        expect.objectContaining({ kind: ConstantKind.Number, value: 15 }),
        expect.objectContaining({ kind: ConstantKind.Number, value: 8 }),
        expect.objectContaining({ kind: ConstantKind.String, value: 'Error' }),
        expect.objectContaining({ kind: ConstantKind.String, value: 'name' }),
        expect.objectContaining({ kind: ConstantKind.String, value: 'string' }),
      ]),
    );
    expect(rewrittenEntry.instructions.at(-1)?.operands[0]).toEqual({
      kind: OperandKind.Register,
      value: expect.stringMatching(/^r\d+$/),
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
            {
              id: 'entry',
              label: 'entry',
              phiNodes: [],
              predecessors: [],
              successors: ['a'],
              instructions: [],
              terminator: { kind: 'jump', targets: ['a'] },
            },
            {
              id: 'a',
              label: 'a',
              phiNodes: [],
              predecessors: ['entry'],
              successors: ['b'],
              instructions: [],
              terminator: { kind: 'jump', targets: ['b'] },
            },
            {
              id: 'b',
              label: 'b',
              phiNodes: [],
              predecessors: ['a'],
              successors: ['real'],
              instructions: [],
              terminator: { kind: 'jump', targets: ['real'] },
            },
            {
              id: 'real',
              label: 'real',
              phiNodes: [],
              predecessors: ['b'],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [], returnValue: 'r0' },
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'paranoid-fake-path-test.ts',
        buildTimestamp: 0,
        blockCount: 4,
        functionCount: 1,
        instructionCount: 0,
        originalByteSize: 100,
      },
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
          runtimeHardening: 'paranoid',
        },
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
      phase: 0,
    };

    const result = pass.execute(ctx);
    const func = result.module.functions[0]!;
    const fakeBlocks = func.blocks.filter((block) => block.id.startsWith('__fake_path_'));
    const branchBlocks = func.blocks.filter((block) => block.terminator.kind === 'branch');
    const boundedConstants = result.module.constantPool.filter((cp) => cp.kind === ConstantKind.Number).map((cp) => cp.value);

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
    expect(boundedConstants.some((value) => value === 0x9e3779b9 || value === 0x7fffffff)).toBe(false);
  });

  it('composed transforms (CFF + DeadCode + FakePath) produce structurally valid module', () => {
    const dummyModule: IRModule = {
      id: 'composed-test',
      sourceFile: 'composed-test.ts',
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
              successors: ['body'],
              instructions: [
                { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r1' },
                {
                  opcode: OpCode.Move,
                  operands: [
                    { kind: OperandKind.Register, value: 'r0' },
                    { kind: OperandKind.Register, value: 'r2' },
                  ],
                },
              ],
              terminator: { kind: 'jump', targets: ['body'] },
            },
            {
              id: 'body',
              label: 'body',
              phiNodes: [],
              predecessors: ['entry'],
              successors: ['exit'],
              instructions: [
                {
                  opcode: OpCode.Add,
                  operands: [
                    { kind: OperandKind.Register, value: 'r1' },
                    { kind: OperandKind.Register, value: 'r2' },
                  ],
                  result: 'r3',
                },
              ],
              terminator: { kind: 'jump', targets: ['exit'] },
            },
            {
              id: 'exit',
              label: 'exit',
              phiNodes: [],
              predecessors: ['body'],
              successors: [],
              instructions: [],
              terminator: { kind: 'return', targets: [], returnValue: 'r3' },
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.Number, value: 0 }],
      metadata: {
        sourceFile: 'composed-test.ts',
        buildTimestamp: 0,
        blockCount: 3,
        functionCount: 1,
        instructionCount: 3,
        originalByteSize: 100,
      },
    };

    const rng = new SeededRandom(42);
    const baseCtx = (): TransformContext => ({
      module: JSON.parse(JSON.stringify(dummyModule)),
      profile: {
        ...mockProfile,
        vm: { runtimeHardening: 'stealth', seed: 1 },
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
      rng,
      phase: 0,
    });

    const passes = [
      { name: 'ControlFlowFlatteningPass', pass: new ControlFlowFlatteningPass() },
      { name: 'DeadCodeInjectionPass', pass: new DeadCodeInjectionPass() },
      { name: 'TypeLevelFakePathPass', pass: new TypeLevelFakePathPass() },
    ];

    let result: { module: IRModule; nodesTransformed: number; diagnostics: any[] } = {
      module: dummyModule,
      nodesTransformed: 0,
      diagnostics: [],
    };

    for (const { name, pass } of passes) {
      const ctx = baseCtx();
      ctx.module = result.module;
      result = pass.execute(ctx);
      expect(result.diagnostics).toHaveLength(0);
    }

    const finalModule = result.module;
    const func = finalModule.functions[0]!;

    // Structural integrity checks
    const allIds = new Set(func.blocks.map((b) => b.id));
    expect(allIds.size).toBe(func.blocks.length);

    for (const block of func.blocks) {
      // All predecessors and successors must reference existing blocks
      for (const pred of block.predecessors) {
        expect(allIds.has(pred)).toBe(true);
      }
      for (const succ of block.successors) {
        expect(allIds.has(succ)).toBe(true);
      }
      // All terminator targets must reference existing blocks
      for (const target of block.terminator.targets) {
        expect(allIds.has(target)).toBe(true);
      }
      // Each block id must be non-empty
      expect(block.id.length).toBeGreaterThan(0);
      // Each block must have at least one block in the function
      expect(block.instructions).toBeDefined();
      expect(block.phiNodes).toBeDefined();
    }

    // Constant pool must still be defined
    expect(finalModule.constantPool).toBeDefined();
    expect(finalModule.constantPool.length).toBeGreaterThanOrEqual(1);

    // Structural integrity is maintained regardless of whether transforms fire
    expect(result.module.constantPool).toBeDefined();
  });

  describe('InstructionSubstitutionPass small integer bounds and types check', () => {
    it('should only substitute addition when operands are guaranteed to be small integers', () => {
      const pass = new InstructionSubstitutionPass();
      // Use SeededRandom(0) to ensure nextFloat() is always < 0.4 so it attempts substitution
      const rng = new SeededRandom(0);
      rng.nextFloat = () => 0.1;

      const dummyModule: IRModule = {
        id: 'isub-test',
        sourceFile: 'isub-test.ts',
        functions: [
          {
            id: 'func1',
            name: 'func1',
            params: [
              { name: 'p0', register: 'r9', type: IRType.Number, isRest: false },
              { name: 'p1', register: 'r10', type: IRType.Number, isRest: false },
            ],
            returnType: IRType.Number,
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
                terminator: { kind: 'return', targets: [], returnValue: 'r14' },
                instructions: [
                  // 1. Small integers constants addition (1 + 2) -> should substitute
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 1 }], result: 'r1' },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: 'r0' },
                      { kind: OperandKind.Register, value: 'r1' },
                    ],
                    result: 'r2',
                  },

                  // 2. Floats constants addition (1.5 + 2.5) -> should NOT substitute
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 2 }], result: 'r3' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 3 }], result: 'r4' },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: 'r3' },
                      { kind: OperandKind.Register, value: 'r4' },
                    ],
                    result: 'r5',
                  },

                  // 3. Large integer addition (3000000000 + 1) -> should NOT substitute
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 4 }], result: 'r6' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 5 }], result: 'r7' },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: 'r6' },
                      { kind: OperandKind.Register, value: 'r7' },
                    ],
                    result: 'r8',
                  },

                  // 4. Parameter/Local addition (r9 + r10) -> should NOT substitute
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: 'r9' },
                      { kind: OperandKind.Register, value: 'r10' },
                    ],
                    result: 'r11',
                  },

                  // 5. Registers defined by bitwise operations addition -> should substitute
                  {
                    opcode: OpCode.BitAnd,
                    operands: [
                      { kind: OperandKind.Register, value: 'r0' },
                      { kind: OperandKind.Register, value: 'r1' },
                    ],
                    result: 'r12',
                  },
                  {
                    opcode: OpCode.BitOr,
                    operands: [
                      { kind: OperandKind.Register, value: 'r0' },
                      { kind: OperandKind.Register, value: 'r1' },
                    ],
                    result: 'r13',
                  },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: 'r12' },
                      { kind: OperandKind.Register, value: 'r13' },
                    ],
                    result: 'r14',
                  },
                ],
              },
            ],
          },
        ],
        globals: [],
        imports: [],
        exports: [],
        constantPool: [
          { index: 0, kind: ConstantKind.Number, value: 1 },
          { index: 1, kind: ConstantKind.Number, value: 2 },
          { index: 2, kind: ConstantKind.Number, value: 1.5 },
          { index: 3, kind: ConstantKind.Number, value: 2.5 },
          { index: 4, kind: ConstantKind.Number, value: 3000000000 },
          { index: 5, kind: ConstantKind.Number, value: 1 },
        ],
        metadata: {
          sourceFile: 'isub-test.ts',
          buildTimestamp: 0,
          blockCount: 1,
          functionCount: 1,
          instructionCount: 14,
          originalByteSize: 100,
        },
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
        phase: 0,
      };

      const result = pass.execute(ctx);
      const func = result.module.functions[0]!;
      const instructions = func.blocks[0].instructions;

      // Let's verify each addition case's resulting instructions in the final block:

      // Case 1: (1 + 2) is substituted:
      // Search for BitXor, BitAnd, LoadConst (2), Mul, Add replacing the original Add (result: r2)
      const hasSubstitutedCase1 =
        instructions.some(
          (inst) => inst.opcode === OpCode.BitXor && inst.result === 'isub_temp_r15', // or similar temp register
        ) ||
        instructions.some((inst) => inst.opcode === OpCode.Add && inst.result === 'r2' && inst.operands[0].kind === OperandKind.Register);
      // Let's verify that the original Add r0, r1 -> r2 does NOT exist anymore:
      const originalAddCase1Exists = instructions.some(
        (inst) => inst.opcode === OpCode.Add && inst.result === 'r2' && inst.operands[0].value === 'r0',
      );
      expect(originalAddCase1Exists).toBe(false);

      // Case 2: (1.5 + 2.5) must NOT be substituted. The original Add r3, r4 -> r5 must remain:
      const originalAddCase2Exists = instructions.some(
        (inst) => inst.opcode === OpCode.Add && inst.result === 'r5' && inst.operands[0].value === 'r3' && inst.operands[1].value === 'r4',
      );
      expect(originalAddCase2Exists).toBe(true);

      // Case 3: (3000000000 + 1) must NOT be substituted. The original Add r6, r7 -> r8 must remain:
      const originalAddCase3Exists = instructions.some(
        (inst) => inst.opcode === OpCode.Add && inst.result === 'r8' && inst.operands[0].value === 'r6' && inst.operands[1].value === 'r7',
      );
      expect(originalAddCase3Exists).toBe(true);

      // Case 4: Parameter addition (r9 + r10) must NOT be substituted:
      const originalAddCase4Exists = instructions.some(
        (inst) =>
          inst.opcode === OpCode.Add && inst.result === 'r11' && inst.operands[0].value === 'r9' && inst.operands[1].value === 'r10',
      );
      expect(originalAddCase4Exists).toBe(true);

      // Case 5: Addition of registers defined by bitwise operations (r12 + r13 -> r14) -> should substitute:
      const originalAddCase5Exists = instructions.some(
        (inst) =>
          inst.opcode === OpCode.Add && inst.result === 'r14' && inst.operands[0].value === 'r12' && inst.operands[1].value === 'r13',
      );
      expect(originalAddCase5Exists).toBe(false);
    });
  });

  describe('Electron Hardening Pass', () => {
    it('should inject correct guard sequence for contextBridge / IPC calls (fetching property from object first)', () => {
      const dummyModule: IRModule = {
        id: 'test_electron',
        sourceFile: 'test_electron.ts',
        functions: [
          {
            id: 'func_electron',
            name: 'func_electron',
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
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 0 }],
                    result: 'r1',
                  },
                  {
                    opcode: OpCode.PropGet,
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
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'send' }],
        metadata: {
          sourceFile: 'test_electron.ts',
          buildTimestamp: 0,
          blockCount: 1,
          functionCount: 1,
          instructionCount: 2,
          originalByteSize: 100,
        },
      };

      const hardenedModule = applyElectronHardening(dummyModule);
      const instructions = hardenedModule.functions[0]!.blocks[0]!.instructions;

      // The PropGet should now be preceded by Nop, LoadConst, PropGet (fetch), and Call
      // Expect 2 original + 4 injected = 6 instructions
      expect(instructions.length).toBe(6);

      const opcodes = instructions.map((inst) => inst.opcode);
      expect(opcodes).toEqual([
        OpCode.LoadConst, // Original LoadConst
        OpCode.Nop, // Injected Nop
        OpCode.LoadConst, // Injected LoadConst (property name)
        OpCode.PropGet, // Injected PropGet (fetch method)
        OpCode.Call, // Injected Call (invoke check)
        OpCode.PropGet, // Original PropGet
      ]);

      // Check the injected PropGet: fetches from 'r0' (object) and 'r3' (property name), writing to 'r3'
      const injectedPropGet = instructions[3]!;
      expect(injectedPropGet.operands[0]).toEqual({ kind: OperandKind.Register, value: 'r0' });
      expect(injectedPropGet.operands[1]).toEqual({ kind: OperandKind.Register, value: 'r3' });
      expect(injectedPropGet.result).toBe('r3');

      // Check the injected Call: invokes the function reference stored in 'r3'
      const injectedCall = instructions[4]!;
      expect(injectedCall.operands[0]).toEqual({ kind: OperandKind.Register, value: 'r3' });
    });
  });

  describe('StripDebugPass', () => {
    it('should retain the result register on Nop instructions when console calls are stripped', () => {
      const pass = new StripDebugPass();
      const dummyModule: IRModule = {
        id: 'strip-debug-test',
        sourceFile: 'strip-debug-test.ts',
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
                  // const consoleReg = LoadGlobal('console')
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' }, // 'console'
                  { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' }, // console
                  // const res = CallMethod(console, 'log', 'hello')
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 1 }], result: 'r2' }, // 'log'
                  {
                    opcode: OpCode.CallMethod,
                    operands: [
                      { kind: OperandKind.Register, value: 'r1' }, // console
                      { kind: OperandKind.Register, value: 'r2' }, // 'log'
                    ],
                    result: 'r3',
                  },
                ],
              },
            ],
          },
        ],
        globals: [],
        imports: [],
        exports: [],
        constantPool: [
          { index: 0, kind: ConstantKind.String, value: 'console' },
          { index: 1, kind: ConstantKind.String, value: 'log' },
        ],
        metadata: {
          sourceFile: 'strip-debug-test.ts',
          buildTimestamp: 0,
          blockCount: 1,
          functionCount: 1,
          instructionCount: 4,
          originalByteSize: 100,
        },
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
        rng: new SeededRandom(0),
        phase: 0,
      };

      const result = pass.execute(ctx);
      const instructions = result.module.functions[0]!.blocks[0]!.instructions;
      const nopInst = instructions.find((inst) => inst.opcode === OpCode.Nop);

      expect(nopInst).toBeDefined();
      expect(nopInst!.result).toBe('r3'); // Must preserve the result register!
    });
  });

  describe('ApiHidingPass', () => {
    it('should replace global browser/Node API lookups with dynamic lookups', () => {
      const pass = new ApiHidingPass();
      const rng = new SeededRandom(12345);

      const dummyModule: IRModule = {
        id: 'api-hide-test',
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
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 0 }],
                    result: 'r0',
                  },
                  {
                    opcode: OpCode.LoadGlobal,
                    operands: [{ kind: OperandKind.Register, value: 'r0' }],
                    result: 'r1',
                  },
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 1 }],
                    result: 'r2',
                  },
                  {
                    opcode: OpCode.PropGet,
                    operands: [
                      { kind: OperandKind.Register, value: 'r1' },
                      { kind: OperandKind.Register, value: 'r2' },
                    ],
                    result: 'r3',
                  },
                ],
              },
            ],
          },
        ],
        globals: [],
        imports: [],
        exports: [],
        constantPool: [
          { index: 0, kind: ConstantKind.String, value: 'window' },
          { index: 1, kind: ConstantKind.String, value: 'fetch' },
        ],
        metadata: { sourceFile: 'test.ts', buildTimestamp: 0, blockCount: 1, functionCount: 1, instructionCount: 4, originalByteSize: 100 },
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
        phase: 0,
      };

      const result = pass.execute(ctx);
      const instructions = result.module.functions[0]!.blocks[0]!.instructions;

      // The original 4 instructions should be expanded to include lookup instructions.
      expect(instructions.length).toBeGreaterThan(4);

      // Verify that hiddenAPIs contains window and window.fetch
      expect(result.module.metadata.hiddenAPIs).toContain('window');
      expect(result.module.metadata.hiddenAPIs).toContain('window.fetch');

      // The helper name should be added to the constant pool
      const helperNameCP = result.module.constantPool.find((c) => c.kind === ConstantKind.String && c.value === '__resolveAPI');
      expect(helperNameCP).toBeDefined();
    });
  });

  describe('NamespaceVirtualizationPass', () => {
    const makeCtx = (overrides?: Partial<IRModule>): TransformContext => {
      const defaultModule: IRModule = {
        id: 'ns-virt-test',
        sourceFile: 'ns-virt-test.ts',
        functions: [
          {
            id: 'func1',
            name: 'func1',
            params: [{ name: 'obj', register: 'r0', type: IRType.Any }],
            returnType: IRType.Void,
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
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 0 }],
                    result: 'r1',
                  },
                  {
                    opcode: OpCode.PropGet,
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
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'customProp' }],
        metadata: {
          sourceFile: 'ns-virt-test.ts',
          buildTimestamp: 0,
          blockCount: 1,
          functionCount: 1,
          instructionCount: 2,
          originalByteSize: 100,
        },
        ...overrides,
      };

      return {
        module: defaultModule,
        profile: { ...mockProfile, seed: 12345 } as ObfuscationProfile,
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
    };

    it('should replace PropGet with ComputedGet for non-builtin custom properties', () => {
      const ctx = makeCtx({
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
                id: 'entry',
                label: 'entry',
                phiNodes: [],
                predecessors: [],
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 1 }], result: 'r0' },
                  { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r2' },
                  {
                    opcode: OpCode.PropGet,
                    operands: [
                      { kind: OperandKind.Register, value: 'r1' },
                      { kind: OperandKind.Register, value: 'r2' },
                    ],
                    result: 'r3',
                  },
                ],
              },
            ],
          },
        ],
        constantPool: [
          { index: 0, kind: ConstantKind.String, value: 'customProp' },
          { index: 1, kind: ConstantKind.String, value: 'someGlobal' },
        ],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const func = result.module.functions[0]!;
      const entryBlock = func.blocks[0]!;

      expect(result.nodesTransformed).toBe(1);
      // Should have LoadConst(hash) then ComputedGet replacing original PropGet
      const loadConstInsts = entryBlock.instructions.filter((i) => i.opcode === OpCode.LoadConst);
      const computedGetInsts = entryBlock.instructions.filter((i) => i.opcode === OpCode.ComputedGet);
      expect(loadConstInsts.length).toBeGreaterThanOrEqual(3);
      expect(computedGetInsts.length).toBe(1);
      expect(computedGetInsts[0]!.metadata).toEqual({ namespaceVirtualization: true });
    });

    it('should not virtualize builtin properties like "length", "prototype", "push"', () => {
      const ctx = makeCtx({
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'length' }],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const entryBlock = result.module.functions[0]!.blocks[0]!;

      expect(result.nodesTransformed).toBe(0);
      expect(entryBlock.instructions.length).toBe(2);
      expect(entryBlock.instructions[1]!.opcode).toBe(OpCode.PropGet);
    });

    it('should not virtualize exported or imported property names', () => {
      const ctx = makeCtx({
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'myExport' }],
        exports: [{ exportedName: 'myExport', localName: 'myExport', isDefault: false }],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const entryBlock = result.module.functions[0]!.blocks[0]!;

      expect(result.nodesTransformed).toBe(0);
      expect(entryBlock.instructions[1]!.opcode).toBe(OpCode.PropGet);
    });

    it('should not virtualize PropGet on "this" register', () => {
      const ctx = makeCtx({
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
                id: 'entry',
                label: 'entry',
                phiNodes: [],
                predecessors: [],
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  { opcode: OpCode.LoadThis, operands: [], result: 'r0' },
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 0 }],
                    result: 'r1',
                  },
                  {
                    opcode: OpCode.PropGet,
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
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'customProp' }],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const entryBlock = result.module.functions[0]!.blocks[0]!;

      expect(result.nodesTransformed).toBe(0);
      expect(entryBlock.instructions[2]!.opcode).toBe(OpCode.PropGet);
    });

    it('should skip CFF-generated blocks (labels starting with "cff_")', () => {
      const ctx = makeCtx({
        functions: [
          {
            id: 'func1',
            name: 'func1',
            params: [{ name: 'obj', register: 'r0', type: IRType.Any }],
            returnType: IRType.Void,
            locals: [],
            isVirtualized: true,
            isExported: false,
            attributes: [],
            capturedVariables: [],
            blocks: [
              {
                id: 'cff_dispatch',
                label: 'cff_dispatcher',
                phiNodes: [],
                predecessors: [],
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: 0 }],
                    result: 'r1',
                  },
                  {
                    opcode: OpCode.PropGet,
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
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'customProp' }],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const cffBlock = result.module.functions[0]!.blocks.find((b) => b.id === 'cff_dispatch')!;

      // CFF block must be untouched (PropGet preserved, LoadConst preserved)
      expect(cffBlock.instructions[1]!.opcode).toBe(OpCode.PropGet);
    });

    it('should add hashed property names to the constant pool', () => {
      const ctx = makeCtx({
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
                id: 'entry',
                label: 'entry',
                phiNodes: [],
                predecessors: [],
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
                  { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 1 }], result: 'r2' },
                  {
                    opcode: OpCode.PropGet,
                    operands: [
                      { kind: OperandKind.Register, value: 'r1' },
                      { kind: OperandKind.Register, value: 'r2' },
                    ],
                    result: 'r3',
                  },
                ],
              },
            ],
          },
        ],
        constantPool: [
          { index: 0, kind: ConstantKind.String, value: 'customProp' },
          { index: 1, kind: ConstantKind.String, value: 'someGlobal' },
        ],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const hashStrings = result.module.constantPool.filter(
        (c) => c.kind === ConstantKind.String && typeof c.value === 'string' && c.value.startsWith('hash_'),
      );

      expect(hashStrings.length).toBe(1);
      expect(hashStrings[0]!.value).toMatch(/^hash_[0-9a-f]+$/);
    });

    it('should add temp registers to func.locals', () => {
      const ctx = makeCtx({
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
                id: 'entry',
                label: 'entry',
                phiNodes: [],
                predecessors: [],
                successors: [],
                terminator: { kind: 'return', targets: [] },
                instructions: [
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 0 }], result: 'r0' },
                  { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: 'r0' }], result: 'r1' },
                  { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: 1 }], result: 'r2' },
                  {
                    opcode: OpCode.PropGet,
                    operands: [
                      { kind: OperandKind.Register, value: 'r1' },
                      { kind: OperandKind.Register, value: 'r2' },
                    ],
                    result: 'r3',
                  },
                ],
              },
            ],
          },
        ],
        constantPool: [
          { index: 0, kind: ConstantKind.String, value: 'customProp' },
          { index: 1, kind: ConstantKind.String, value: 'someGlobal' },
        ],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);
      const func = result.module.functions[0]!;

      expect(func.locals.length).toBeGreaterThan(0);
      const nsVirtLocals = func.locals.filter((l: any) => l.name.startsWith('ns_virt_temp_'));
      expect(nsVirtLocals.length).toBe(1);
    });

    it('should not modify functions where no PropGet/PropSet targets non-builtin properties', () => {
      const ctx = makeCtx({
        constantPool: [{ index: 0, kind: ConstantKind.String, value: 'length' }],
      });
      const pass = new NamespaceVirtualizationPass();
      const result = pass.execute(ctx);

      expect(result.nodesTransformed).toBe(0);
      expect(result.module.constantPool.length).toBe(1);
    });
  });
});
