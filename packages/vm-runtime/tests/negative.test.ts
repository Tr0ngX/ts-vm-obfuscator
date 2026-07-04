import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import {
  type BytecodeModule,
  OpCode,
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
} from '@tsvm/shared';

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.VariableLength,
    superInstructions: false,
    handlerLayoutRandom: false,
    constantPoolEncoding: ConstantEncodingScheme.Identity,
    traceMode: false,
    deterministicReplay: false,
    seed: 7,
    ...overrides,
  };
}

describe('VMRuntime negative tests', () => {
  it('throws for empty functions array', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'empty-test',
      opcodeMapping: { seed: 7, forward: new Map(), reverse: new Map() },
      constantPool: [],
      functions: [],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'empty-test', sourceHash: 'a', profile: 'generic' },
    };
    expect(() => buildVMRuntime(mod, makeConfig())).toThrow();
  });

  it('handles missing entry point index gracefully (falls back to first function)', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'no-entry',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'helper', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: false },
      ],
      entryPointIndex: -1,
      metadata: { buildTimestamp: 0, buildId: 'no-entry', sourceHash: 'a', profile: 'generic' },
    };
    const bundle = buildVMRuntime(mod, makeConfig());
    expect(bundle.fullSource).toBeDefined();
  });

  it('produces runnable output for a minimal valid module', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'minimal',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'minimal', sourceHash: 'a', profile: 'generic' },
    };
    const bundle = buildVMRuntime(mod, makeConfig());
    expect(bundle.fullSource).toBeDefined();
    expect(bundle.fullSource.length).toBeGreaterThan(100);
    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    expect(() => new Function('module', bundle.fullSource)(moduleShim)).not.toThrow();
  });

  it('handles module with no constant pool entries', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'no-cp',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'no-cp', sourceHash: 'a', profile: 'generic' },
    };
    const bundle = buildVMRuntime(mod, makeConfig());
    expect(bundle.fullSource).not.toContain('constantPool');
  });

  it('handles module with large constant pool', () => {
    const constantPool = Array.from({ length: 50 }, (_, i) => ({
      index: i,
      kind: 'number' as const,
      value: i * 100,
    }));
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'large-cp',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool,
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'large-cp', sourceHash: 'a', profile: 'generic' },
    };
    expect(() => buildVMRuntime(mod, makeConfig())).not.toThrow();
  });

  it('generates unique build IDs for different configs', () => {
    const baseMod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'unique-test',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'unique-test', sourceHash: 'a', profile: 'generic' },
    };
    const a = buildVMRuntime(baseMod, makeConfig({ seed: 1 }));
    const b = buildVMRuntime(baseMod, makeConfig({ seed: 2 }));
    expect(a.fullSource).not.toBe(b.fullSource);
  });

  it('outputs deterministic source for same seed', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'det-test',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'det-test', sourceHash: 'a', profile: 'generic' },
    };
    const a = buildVMRuntime(mod, makeConfig({ seed: 42 }));
    const b = buildVMRuntime(mod, makeConfig({ seed: 42 }));
    expect(a.fullSource).toBe(b.fullSource);
  });

  it('includes expected VM structure in output', () => {
    const mod: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'struct-test',
      opcodeMapping: { seed: 7, forward: new Map([[OpCode.Return, 0]]), reverse: new Map([[0, OpCode.Return]]) },
      constantPool: [],
      functions: [
        { id: 'f1', name: 'noop', paramCount: 0, localCount: 0, maxRegisters: 1, bytecode: new Uint8Array([0]), isEntryPoint: true },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'struct-test', sourceHash: 'a', profile: 'generic' },
    };
    const bundle = buildVMRuntime(mod, makeConfig({ runtimeHardening: 'stealth' }));
    expect(bundle.dispatchLoop).toBeDefined();
    expect(bundle.handlers).toBeDefined();
    expect(bundle.bytecodePayload).toBeDefined();
    expect(bundle.entryBootstrap).toBeDefined();
    expect(bundle.fullSource.length).toBeGreaterThan(100);
    expect(bundle.fullSource).toContain('function');
  });
});
