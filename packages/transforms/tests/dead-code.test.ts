import { describe, it, expect } from 'vitest';
import { DeadCodeInjectionPass } from '../src/passes/dead-code-injection.js';
import {
  type IRModule,
  IRType,
  OperandKind,
  OpCode,
  SeededRandom,
  type TransformContext,
  type ObfuscationProfile,
  ConstantKind,
  type ProjectSemanticGraph,
} from '@tsvm/shared';

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
  transforms: [{ name: 'DeadCodeInjectionPass', enabled: true }],
};

describe('DeadCodeInjectionPass', () => {
  it('should inject junk instructions into virtualized functions', () => {
    const pass = new DeadCodeInjectionPass();
    const rng = new SeededRandom(42);

    const mod: IRModule = {
      id: 'dead-code-test',
      sourceFile: 'dead-code-test.ts',
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
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [{ index: 0, kind: ConstantKind.Number, value: 42 }],
      metadata: {
        sourceFile: 'dead-code-test.ts',
        buildTimestamp: 0,
        blockCount: 1,
        functionCount: 1,
        instructionCount: 10,
        originalByteSize: 100,
      },
    };

    const ctx: TransformContext = {
      module: mod,
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

    expect(result.nodesTransformed).toBeGreaterThan(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('should skip non-virtualized functions', () => {
    const pass = new DeadCodeInjectionPass();
    const rng = new SeededRandom(42);

    const mod: IRModule = {
      id: 'dead-code-skip',
      sourceFile: 'dead-code-skip.ts',
      functions: [
        {
          id: 'func1',
          name: 'func1',
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
              instructions: [
                { opcode: 0x01, operands: [] },
                { opcode: 0x01, operands: [] },
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'dead-code-skip.ts',
        buildTimestamp: 0,
        blockCount: 1,
        functionCount: 1,
        instructionCount: 2,
        originalByteSize: 100,
      },
    };

    const ctx: TransformContext = {
      module: mod,
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

    expect(result.nodesTransformed).toBe(0);
    expect(result.module.functions[0].blocks).toHaveLength(1);
  });

  it('should produce a structurally valid module after injection', () => {
    const pass = new DeadCodeInjectionPass();
    const rng = new SeededRandom(42);

    const mod: IRModule = {
      id: 'dead-code-struct',
      sourceFile: 'dead-code-struct.ts',
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
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'dead-code-struct.ts',
        buildTimestamp: 0,
        blockCount: 1,
        functionCount: 1,
        instructionCount: 2,
        originalByteSize: 100,
      },
    };

    const ctx: TransformContext = {
      module: mod,
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
    const func = result.module.functions[0];

    expect(func.blocks.length).toBeGreaterThanOrEqual(1);

    for (const block of func.blocks) {
      expect(block.id).toBeTruthy();
      expect(block.label).toBeTruthy();
      expect(block.predecessors).toBeDefined();
      expect(block.successors).toBeDefined();
      expect(block.phiNodes).toBeDefined();

      for (const inst of block.instructions) {
        expect(inst.opcode).toBeGreaterThanOrEqual(0);
        expect(inst.operands).toBeDefined();
      }

      const term = block.terminator;
      expect(['jump', 'branch', 'return', 'throw', 'switch', 'unreachable']).toContain(term.kind);
      expect(term.targets).toBeDefined();
    }
  });

  it('should inject dead code with varying patterns using different seeds', () => {
    for (const seed of [0, 1, 7, 42, 99, 256]) {
      const pass = new DeadCodeInjectionPass();
      const rng = new SeededRandom(seed);

      const mod: IRModule = {
        id: `dead-code-seed-${seed}`,
        sourceFile: 'dead-code-seed.ts',
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
                ],
              },
            ],
          },
        ],
        globals: [],
        imports: [],
        exports: [],
        constantPool: [{ index: 0, kind: ConstantKind.Number, value: 0 }],
        metadata: {
          sourceFile: 'dead-code-seed.ts',
          buildTimestamp: 0,
          blockCount: 1,
          functionCount: 1,
          instructionCount: 5,
          originalByteSize: 100,
        },
      };

      const ctx: TransformContext = {
        module: mod,
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
      const func = result.module.functions[0];

      expect(result.diagnostics).toHaveLength(0);
      expect(func.blocks.length).toBeGreaterThanOrEqual(1);

      const totalInsts = func.blocks.reduce((sum, b) => sum + b.instructions.length, 0);
      expect(totalInsts).toBeGreaterThanOrEqual(5);
    }
  });

  it('should handle constant pool modifications correctly', () => {
    const pass = new DeadCodeInjectionPass();
    const rng = new SeededRandom(7);

    const mod: IRModule = {
      id: 'dead-code-cp',
      sourceFile: 'dead-code-cp.ts',
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
              ],
            },
          ],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'dead-code-cp.ts',
        buildTimestamp: 0,
        blockCount: 1,
        functionCount: 1,
        instructionCount: 2,
        originalByteSize: 100,
      },
    };

    const ctx: TransformContext = {
      module: mod,
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

    expect(result.module.constantPool).toBeDefined();
  });
});
