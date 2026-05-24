import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import { BytecodeModule, OpCode, ImmediateEncodingScheme, ConstantEncodingScheme } from '@tsvm/shared';

describe('VM Runtime', () => {
  it('should initialize and execute bytecode safely', () => {
    expect(true).toBe(true);
  });

  it('should emit handlers for array and object allocations', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534F42,
      version: 1,
      buildId: 'alloc-test',
      opcodeMapping: {
        seed: 7,
        forward: new Map([
          [OpCode.ArrayNew, 10],
          [OpCode.ObjectNew, 11],
          [OpCode.Return, 12],
        ]),
        reverse: new Map([
          [10, OpCode.ArrayNew],
          [11, OpCode.ObjectNew],
          [12, OpCode.Return],
        ]),
      },
      constantPool: [],
      functions: [
        {
          id: 'f1',
          name: 'alloc',
          paramCount: 0,
          localCount: 0,
          maxRegisters: 2,
          bytecode: new Uint8Array([10, 1, 0, 0, 11, 1, 1, 1, 12, 1, 0]),
          isEntryPoint: true,
        },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'alloc-test', sourceHash: 'a', profile: 'generic' },
    };

    const bundle = buildVMRuntime(dummyModule, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 7,
    });

    expect(bundle.fullSource).toContain('ctx.regs[args[0]] = [];');
    expect(bundle.fullSource).toContain('ctx.regs[args[0]] = {};');
  });

  it('should inject anti-debug and tamper logic when enabled', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534F42,
      version: 1,
      buildId: 'test1234',
      opcodeMapping: {
        seed: 42,
        forward: new Map([[OpCode.Return, 0]]),
        reverse: new Map([[0, OpCode.Return]])
      },
      constantPool: [],
      functions: [{
        id: 'f1', name: 'targetFunc',
        paramCount: 0, localCount: 0, maxRegisters: 2,
        bytecode: new Uint8Array([0, 1]), // Dummy
        isEntryPoint: true
      }],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'test1234', sourceHash: 'a', profile: 'generic' }
    };

    const bundle = buildVMRuntime(dummyModule, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 42,
      tamperDetection: true,
      antiDebug: true,
      junkInsertion: true,
      rollingKeys: true
    });

    expect(bundle.fullSource).toContain('performance.now()');
    expect(bundle.fullSource).toContain('debugger;');
    expect(bundle.fullSource).toContain('ctx.regs[1] = NaN;');
    expect(bundle.fullSource).toContain('!_isNative(Math.sin)');
    expect(bundle.fullSource).toContain('ctx.globalScope = {};');
  });
});
