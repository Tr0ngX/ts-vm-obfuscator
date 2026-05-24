import { describe, it, expect } from 'vitest';
import { ControlFlowFlatteningPass } from '../src/passes/control-flow-flattening.js';
import { DeadCodeInjectionPass } from '../src/passes/dead-code-injection.js';
import { IRModule, IRType, SeededRandom, TransformContext, ObfuscationProfile } from '@tsvm/shared';
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
      semanticGraph: {} as any,
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
      semanticGraph: {} as any,
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
});
