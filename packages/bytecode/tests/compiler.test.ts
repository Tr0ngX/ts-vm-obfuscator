import { describe, it, expect } from 'vitest';
import { compileToBytecode } from '../src/compiler.js';
import { ConstantEncodingScheme, FunctionAttribute, ImmediateEncodingScheme, IRType, type IRModule } from '@tsvm/shared';

describe('Bytecode Compiler', () => {
  it('does not expose nested functions as VM entry points', () => {
    const module: IRModule = {
      id: 'mod_test',
      sourceFile: 'test.ts',
      functions: [
        {
          id: 'fn_outer',
          name: 'outer',
          params: [],
          returnType: IRType.Any,
          blocks: [
            {
              id: 'b0',
              label: 'entry',
              instructions: [],
              terminator: { kind: 'return', targets: [] },
              predecessors: [],
              successors: [],
              phiNodes: [],
            },
          ],
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [],
          capturedVariables: [],
        },
        {
          id: 'fn_inner',
          name: 'outer$closure$0',
          params: [],
          returnType: IRType.Any,
          blocks: [
            {
              id: 'b1',
              label: 'entry',
              instructions: [],
              terminator: { kind: 'return', targets: [] },
              predecessors: [],
              successors: [],
              phiNodes: [],
            },
          ],
          locals: [],
          isVirtualized: true,
          isExported: false,
          attributes: [FunctionAttribute.Nested],
          capturedVariables: [],
        },
      ],
      globals: [],
      imports: [],
      exports: [],
      constantPool: [],
      metadata: {
        sourceFile: 'test.ts',
        originalByteSize: 0,
        functionCount: 2,
        blockCount: 2,
        instructionCount: 0,
        buildTimestamp: 0,
      },
    };

    const bytecode = compileToBytecode(module, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 7,
    });

    expect(bytecode.functions).toHaveLength(2);
    expect(bytecode.functions.filter((fn) => fn.isEntryPoint)).toHaveLength(1);
    expect(bytecode.functions.find((fn) => fn.id === 'fn_inner')!.isEntryPoint).toBe(false);
    expect(bytecode.functions.find((fn) => fn.id === 'fn_inner')!.attributes).toContain(FunctionAttribute.Nested);
  });
});
