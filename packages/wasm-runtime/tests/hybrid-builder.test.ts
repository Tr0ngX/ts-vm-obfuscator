import { describe, expect, it } from 'vitest';
import { buildWasmHybridRuntime } from '../src/hybrid-builder.js';
import { ConstantEncodingScheme, ImmediateEncodingScheme, OpCode, type BytecodeModule } from '@tsvm/shared';

function createReturnUndefinedModule(): BytecodeModule {
  return {
    magic: 0x54534F42,
    version: 1,
    buildId: 'wasm-hybrid-test',
    opcodeMapping: {
      seed: 1,
      forward: new Map([[OpCode.Return, 12]]),
      reverse: new Map([[12, OpCode.Return]]),
    },
    constantPool: [],
    functions: [
      {
        id: 'f1',
        name: 'noop',
        paramCount: 0,
        localCount: 0,
        maxRegisters: 1,
        bytecode: new Uint8Array([12, 0]),
        isEntryPoint: true,
      },
    ],
    entryPointIndex: 0,
    metadata: { buildTimestamp: 0, buildId: 'wasm-hybrid-test', sourceHash: 'a', profile: 'generic' },
  };
}

describe('WASM hybrid runtime builder', () => {
  it('embeds a WebAssembly bootstrap while preserving the JS VM export API', () => {
    const bundle = buildWasmHybridRuntime(createReturnUndefinedModule(), {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 1,
      runtimeBackend: 'wasm_hybrid',
    });

    const moduleShim = { exports: {} as Record<string, () => unknown> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(bundle.buildId).toContain('wasm_hybrid');
    expect(bundle.fullSource).toContain('WebAssembly.Module');
    expect(moduleShim.exports.noop()).toBeUndefined();
  });
});
