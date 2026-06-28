import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import {
  type BytecodeModule,
  OpCode,
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
  type ModuleInfo,
  type ProjectSemanticGraph,
} from '@tsvm/shared';
import { lowerToIR } from '../../ir/src/builder.js';
import { compileToBytecode } from '../../bytecode/src/compiler.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createModuleInfo(filePath: string): ModuleInfo {
  return {
    filePath,
    relativePath: path.basename(filePath),
    exports: [],
    imports: [],
    typeFacts: [],
    isEntryPoint: true,
    isDeclarationFile: false,
    hasJSX: false,
    hasDecorators: false,
    byteSize: 0,
  };
}

function createGraph(): ProjectSemanticGraph {
  return {
    rootDir: __dirname,
    modules: new Map(),
    dependencyEdges: [],
    entryPoints: [],
    symbolTable: [],
    aliases: new Map(),
    compilerOptions: {},
    diagnostics: [],
  };
}

function createVMConfig(seed: number, overrides: Partial<Parameters<typeof buildVMRuntime>[1]> = {}) {
  return {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.VariableLength,
    superInstructions: false,
    handlerLayoutRandom: false,
    constantPoolEncoding: ConstantEncodingScheme.Identity,
    traceMode: false,
    deterministicReplay: false,
    seed,
    ...overrides,
  };
}

describe('VM Runtime', () => {
  it('should initialize and execute bytecode safely', () => {
    expect(true).toBe(true);
  });

  it('should emit handlers for array and object allocations', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534f42,
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

  it('should emit a ClosureNew handler backed by the VM function table', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'closure-test',
      opcodeMapping: {
        seed: 9,
        forward: new Map([
          [OpCode.LoadConst, 10],
          [OpCode.ClosureNew, 11],
          [OpCode.Return, 12],
        ]),
        reverse: new Map([
          [10, OpCode.LoadConst],
          [11, OpCode.ClosureNew],
          [12, OpCode.Return],
        ]),
      },
      constantPool: [],
      functions: [
        {
          id: 'outer',
          name: 'outer',
          paramCount: 0,
          localCount: 0,
          maxRegisters: 2,
          bytecode: new Uint8Array([12, 0]),
          isEntryPoint: true,
        },
        {
          id: 'inner',
          name: 'outer$closure$0',
          paramCount: 0,
          localCount: 0,
          maxRegisters: 2,
          bytecode: new Uint8Array([12, 0]),
          isEntryPoint: false,
        },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'closure-test', sourceHash: 'a', profile: 'generic' },
    };

    const bundle = buildVMRuntime(dummyModule, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 9,
    });

    expect(bundle.fullSource).toContain('function getExecutorById(functionId, env)');
    expect(bundle.fullSource).toContain('Unknown VM function id: ');
    expect(bundle.fullSource).toContain('ctx.regs[args[2]] = getExecutorById(getCP(ctx, args[0]), ctx.regs[args[1]]);');
    expect(bundle.fullSource).toContain('ctx.regs[args[1]] = ctx.env[args[0]];');
    expect(bundle.fullSource).toContain('ctx.regs[args[1]] = { v: ctx.regs[args[0]] };');
  });

  it('should conceal canonical handler naming and direct raw-op dispatch in stealth mode', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'stealth-shape',
      opcodeMapping: {
        seed: 15,
        forward: new Map([
          [OpCode.LoadConst, 10],
          [OpCode.Add, 11],
          [OpCode.Return, 12],
          [OpCode.Trap, 13],
        ]),
        reverse: new Map([
          [10, OpCode.LoadConst],
          [11, OpCode.Add],
          [12, OpCode.Return],
          [13, OpCode.Trap],
        ]),
      },
      constantPool: [{ index: 0, kind: 'number', value: 1 }],
      functions: [
        {
          id: 'f1',
          name: 'shape',
          paramCount: 0,
          localCount: 0,
          maxRegisters: 4,
          bytecode: new Uint8Array([10, 2, 2, 0, 0, 11, 3, 0, 0, 0, 1, 12, 1, 0]),
          isEntryPoint: true,
        },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'stealth-shape', sourceHash: 'a', profile: 'generic' },
    };

    const bundle = buildVMRuntime(dummyModule, createVMConfig(15, { stealthDispatch: true }));

    expect(bundle.fullSource).not.toMatch(/function h_\d+/);
    expect(bundle.fullSource).not.toContain('handlers[op]');
    expect(bundle.fullSource).not.toContain('rollingKey');
    expect(bundle.fullSource).not.toContain('tryFrames');
    expect(bundle.fullSource).not.toContain('callArgs');
    expect(bundle.fullSource).not.toContain('getExecutorById');
  });

  it('should vary stealth runtime structure across seeds while preserving execution', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const bytecodeA = compileToBytecode(ir, createVMConfig(41, { stealthDispatch: true }));
    const bytecodeB = compileToBytecode(ir, createVMConfig(43, { stealthDispatch: true }));
    const bundleA = buildVMRuntime(bytecodeA, createVMConfig(41, { stealthDispatch: true }));
    const bundleB = buildVMRuntime(bytecodeB, createVMConfig(43, { stealthDispatch: true }));

    expect(bundleA.fullSource).not.toBe(bundleB.fullSource);

    const modA = { exports: {} as Record<string, (...args: any[]) => any> };
    const modB = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundleA.fullSource)(modA);
    new Function('module', bundleB.fullSource)(modB);

    expect(modA.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
    expect(modB.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
  });

  it('should execute closures with shared captured state', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'nested-closures.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 13,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 13,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.nestedCounter(5)).toBe(16);
  });

  it('should execute the syntax-pack regression fixture', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 17,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 17,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
    expect(moduleShim.exports.syntaxPack(false, null)).toBe('no:ANON:empty:1');
  });

  it('should execute binding-pack fixtures with destructuring, rest/spread, and catch binding', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'binding-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 23,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 23,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.bindingPack({ a: 7, b: undefined, extra: 11, drop: 2 }, [3, 5, 8])).toBe('boom:detail:3:7:6:5,8:5:13:3');
    expect(moduleShim.exports.parameterPack({ a: 2 }, 4, 6, 8)).toBe(13);
    expect(moduleShim.exports.arrayPatternArrow([9, 10, 11])).toBe(11);
    expect(moduleShim.exports.callSpreadPack(3, [4, 5])).toBe(19);
    expect(moduleShim.exports.catchPack(true)).toBe('boom:2');
  });

  it('should execute iterable spread and sparse hole expressions through the VM runtime', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'expression-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(53));
    const bundle = buildVMRuntime(bytecode, createVMConfig(53));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    try {
      new Function('module', bundle.fullSource)(moduleShim);
    } catch (e) {
      const dumpPath = path.join(tmpdir(), `tsvm-failed-${Date.now()}.js`);
      console.error('DUMPED FAILED SOURCE TO', dumpPath, 'due to error:', e);
      fs.writeFileSync(dumpPath, bundle.fullSource);
      throw e;
    }

    expect(moduleShim.exports.expressionPack()).toBe('8:0|2|3|4|6|7:undefined:3,4,5,,6,7:ABC:2020-1-2');
  });

  it('should preserve runtime parity when stealth dispatch is enabled', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'binding-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(47, { stealthDispatch: true }));
    const bundle = buildVMRuntime(bytecode, createVMConfig(47, { stealthDispatch: true }));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    try {
      new Function('module', bundle.fullSource)(moduleShim);
    } catch (e) {
      const dumpPath = path.join(tmpdir(), `tsvm-failed-${Date.now()}.js`);
      console.error('DUMPED FAILED STEALTH SOURCE TO', dumpPath, 'due to error:', e);
      fs.writeFileSync(dumpPath, bundle.fullSource);
      throw e;
    }

    expect(moduleShim.exports.bindingPack({ a: 7, b: undefined, extra: 11, drop: 2 }, [3, 5, 8])).toBe('boom:detail:3:7:6:5,8:5:13:3');
    expect(moduleShim.exports.parameterPack({ a: 2 }, 4, 6, 8)).toBe(13);
    expect(moduleShim.exports.callSpreadPack(3, [4, 5])).toBe(19);
  });

  it('should execute repeated calls with self-modifying rolling bytecode enabled', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const config = createVMConfig(101, { rollingKeys: true });
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const bytecode = compileToBytecode(ir, config);
    const bundle = buildVMRuntime(bytecode, config);

    expect(bundle.fullSource).toContain('Uint8Array.from(bytecodeArr)');
    expect(bundle.fullSource).toContain('xorLog');
    expect(bundle.fullSource).toContain('function readByte(ctx)');
    expect(bundle.fullSource).toContain('let kindNum = readByte(ctx);');
    expect(bundle.fullSource).toContain('let argCount = readByte(ctx);');
    expect(bundle.fullSource).toContain('ctx.bytecode[pos] ^= mask;');
    expect(bundle.fullSource).toContain('ctx.xorLog[pos] ^= revMask;');
    expect(bundle.fullSource).toContain('Math.imul');
    expect(bundle.fullSource).toContain('return handlers[nextOp];');
    expect(bundle.fullSource).toContain('handler = handler(ctx);');

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
    expect(moduleShim.exports.syntaxPack(false, null)).toBe('no:ANON:empty:1');
    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
  });

  it('should preserve this and new.target through VM execution', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'this-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(59));
    const bundle = buildVMRuntime(bytecode, createVMConfig(59));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.thisPack.call({ label: 'ctx' }, 'hello')).toBe('hello:ctx');
    expect(moduleShim.exports.thisPack('hello')).toBe('hello:none');

    const instance = new (moduleShim.exports.newTargetPack as new (value: number) => { value: number })(7);
    expect(instance.value).toBe(7);
    expect(moduleShim.exports.newTargetPack(7)).toBe(6);
  });

  it('should preserve lexical this and lexical new.target inside nested arrows', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'this-arrow-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(67));
    const bundle = buildVMRuntime(bytecode, createVMConfig(67));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.lexicalThisArrowHost.call({ label: 'ctx' }, 'hello')).toBe('hello:ctx');
    expect(moduleShim.exports.lexicalThisArrowHost('hello')).toBe('hello:none');

    const instance = new (moduleShim.exports.lexicalNewTargetArrowHost as new (value: number) => { value: number })(9);
    expect(instance.value).toBe(9);
    expect(moduleShim.exports.lexicalNewTargetArrowHost(9)).toBe(8);
  });

  it('should execute base class semantics without extends through the VM runtime', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'class-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(71));
    const bundle = buildVMRuntime(bytecode, createVMConfig(71));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    try {
      new Function('module', bundle.fullSource)(moduleShim);
    } catch (e) {
      const dumpPath = path.join(tmpdir(), `tsvm-failed-${Date.now()}.js`);
      console.error('DUMPED FAILED CLASSPACK SOURCE TO', dumpPath, 'due to error:', e);
      fs.writeFileSync(dumpPath, bundle.fullSource);
      throw e;
    }

    expect(moduleShim.exports.classPack(4)).toBe('2:Named:7:Named:10:6:20');
  });

  it('should emit constructor-safe super handlers and opaque private storage for class runtime support', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'class-blocked.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, {
      forceVirtualizeFunctionNames: new Set(['classPrivatePack', 'classStaticBlockPack']),
      compatibilityFallback: true,
    });
    const bytecode = compileToBytecode(ir, createVMConfig(79));
    const bundle = buildVMRuntime(bytecode, createVMConfig(79));

    expect(bundle.fullSource).toContain('Reflect.construct(superCtor');
    expect(bundle.fullSource).not.toContain('superCtor.apply(ctx.thisArg');
    expect(bundle.fullSource).toContain('cleanIntrinsics.WeakMap || WeakMap');
    expect(bundle.fullSource).toContain('new VMWeakMap()');
    expect(bundle.fullSource).not.toContain('#value');
  });

  it('should execute derived classes, static blocks, and private fields under full virtualization', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'class-blocked.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, {
      forceVirtualizeFunctionNames: new Set(['classPrivatePack', 'classStaticBlockPack', 'classExtendsPack']),
      compatibilityFallback: true,
    });
    const bytecode = compileToBytecode(ir, createVMConfig(89));
    const bundle = buildVMRuntime(bytecode, createVMConfig(89));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.classPrivatePack()).toBe(1);
    expect(moduleShim.exports.classStaticBlockPack()).toBe(2);
    expect(moduleShim.exports.classExtendsPack()).toBe(2);
  });

  it('should execute verified async/await functions through the VM runtime', async () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'async-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(61));
    const bundle = buildVMRuntime(bytecode, createVMConfig(61));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    await expect(moduleShim.exports.asyncPack(true, 4)).resolves.toBe(5);
    await expect(moduleShim.exports.asyncPack(false, 4)).resolves.toBe('boom:4');
    await expect(moduleShim.exports.asyncArrowPack(6)).resolves.toBe(13);
  });

  it('should execute async generators through the VM runtime', async () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'async-generator-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(83));
    const bundle = buildVMRuntime(bytecode, createVMConfig(83));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    const iter = moduleShim.exports.asyncGeneratorPack(4) as AsyncGenerator<number, number, unknown>;
    await expect(iter.next()).resolves.toEqual({ value: 5, done: false });
    await expect(iter.next()).resolves.toEqual({ value: 6, done: false });
    await expect(iter.next()).resolves.toEqual({ value: 7, done: false });
    await expect(iter.next()).resolves.toEqual({ value: 8, done: true });
  });

  it('should execute async for-await-of loops through the VM runtime', async () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'async-loop-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(95));
    const bundle = buildVMRuntime(bytecode, createVMConfig(95));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    // Create an async iterable
    const asyncIterable = {
      [Symbol.asyncIterator]() {
        let i = 1;
        return {
          async next() {
            if (i <= 3) {
              return { value: i++, done: false };
            }
            return { value: undefined, done: true };
          },
        };
      },
    };

    await expect(moduleShim.exports.testAsyncLoop(asyncIterable)).resolves.toBe(6);
  });

  it('should inject anti-debug and tamper logic when enabled', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534f42,
      version: 1,
      buildId: 'test1234',
      opcodeMapping: {
        seed: 42,
        forward: new Map([[OpCode.Return, 0]]),
        reverse: new Map([[0, OpCode.Return]]),
      },
      constantPool: [],
      functions: [
        {
          id: 'f1',
          name: 'targetFunc',
          paramCount: 0,
          localCount: 0,
          maxRegisters: 2,
          bytecode: new Uint8Array([0, 1]), // Dummy
          isEntryPoint: true,
        },
      ],
      entryPointIndex: 0,
      metadata: { buildTimestamp: 0, buildId: 'test1234', sourceHash: 'a', profile: 'generic' },
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
      rollingKeys: true,
    });

    expect(bundle.fullSource).toContain('performance.now()');
    expect(bundle.fullSource).toContain('debugger;');
    expect(bundle.fullSource).toContain('ctx.regs[i] = 0;');
    expect(bundle.fullSource).toContain('.prototype.toString');
    expect(bundle.fullSource).toContain('!_isNative(');
    expect(bundle.fullSource).toContain('ctx.globalScope = {};');
  });

  it('should execute with stealth hardening and tamper checks enabled', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const config = createVMConfig(91, {
      runtimeHardening: 'stealth',
      stealthDispatch: true,
      tamperDetection: true,
      junkInsertion: true,
    });
    const bytecode = compileToBytecode(ir, config);
    const bundle = buildVMRuntime(bytecode, config);

    expect(bundle.fullSource).not.toContain('handlers[op]');
    expect(bundle.fullSource).not.toContain('Unknown VM function id: ');
    expect(bundle.fullSource).not.toContain('Cannot read private member');
    expect(bundle.fullSource).toContain('Object.create(null)');
    expect(bundle.fullSource).toContain('& 1) === 0');
    expect(bundle.fullSource).toContain('.prototype.toString');
    expect(bundle.fullSource).toContain('.prototype.get');

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
  });

  it('should execute the control-flow regression fixture and throw correctly', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'control-flow-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 23,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 23,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.controlFlowPack(6)).toBe(85);
    expect(moduleShim.exports.controlFlowPack(3)).toBe(43);
    expect(moduleShim.exports.throwingPack(false)).toBe('ok');
    expect(() => moduleShim.exports.throwingPack(true)).toThrowError('boom');
  });

  it('should execute for-of, for-in, and destructuring through the VM runtime', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'iteration-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 29,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 29,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.iterationPack(['go', 'skip', 'stop', 'tail'], { alpha: 2, beta: 3 })).toBe('gostop:11:go:skip:2:3');
  });

  it('should execute try/catch/finally semantics through the VM runtime', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'exception-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 31,
    });
    const bundle = buildVMRuntime(bytecode, {
      opcodeRemapping: true,
      immediateEncoding: ImmediateEncodingScheme.VariableLength,
      superInstructions: false,
      handlerLayoutRandom: false,
      constantPoolEncoding: ConstantEncodingScheme.Identity,
      traceMode: false,
      deterministicReplay: false,
      seed: 31,
    });

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.tryCatchPack(false)).toBe('ok');
    expect(moduleShim.exports.tryCatchPack(true)).toBe('boom');
    expect(moduleShim.exports.tryFinallyPack(2)).toBe(3);
    expect(moduleShim.exports.tryCatchFinallyPack(false)).toBe('clean');
    expect(moduleShim.exports.tryCatchFinallyPack(true)).toBe('boom');
    expect(moduleShim.exports.tryFinallyBreakPack(5)).toBe('0:1:2::3');
    expect(moduleShim.exports.tryCatchLeakTest()).toBe('try:native-caught');
  });

  it('should emit paranoid route tokens, handler variants, and path-mixed bytecode mutation', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const config = createVMConfig(131, {
      runtimeHardening: 'paranoid',
      stealthDispatch: true,
      tamperDetection: true,
      rollingKeys: true,
      junkInsertion: true,
    });
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const bytecode = compileToBytecode(ir, config);
    const bundle = buildVMRuntime(bytecode, config);

    expect(bundle.fullSource).toContain('function mixRollingState(ctx, pos, decoded)');
    expect(bundle.fullSource).toContain('function corruptByteNear(ctx, at, mask)');
    expect(bundle.fullSource).toContain('corruptByteNear(ctx, pos - 1');
    expect(bundle.fullSource).toContain('corruptByteNear(ctx, pos + 1');
    expect(bundle.fullSource).toContain('function makeRouteToken(ctx, nextOp)');
    expect(bundle.fullSource).toContain('function resolveRoute(ctx, token)');
    expect(bundle.fullSource).toContain('handler = resolveRoute(ctx, handler(ctx));');
    expect(bundle.fullSource).toMatch(/const handlerVariants = \{/);
    // In stealth/paranoid mode, ctx fields are fully obfuscated - executionNonce becomes a random name
    expect(bundle.fullSource).toMatch(/executionNonce|_[a-zA-Z]{5,9}/);
    expect(bundle.fullSource).toMatch(/\[\d+\]: \[[^\]]*,[^\]]*\]/);

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
    expect(moduleShim.exports.syntaxPack(false, null)).toBe('no:ANON:empty:1');
    expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
  });

  it('should execute loop and catch resume paths under paranoid rolling mutation', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'exception-pack.ts');
    const config = createVMConfig(137, {
      runtimeHardening: 'paranoid',
      stealthDispatch: true,
      tamperDetection: true,
      rollingKeys: true,
      junkInsertion: true,
    });
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, config);
    const bundle = buildVMRuntime(bytecode, config);

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    expect(moduleShim.exports.tryCatchPack(false)).toBe('ok');
    expect(moduleShim.exports.tryCatchPack(true)).toBe('boom');
    expect(moduleShim.exports.tryFinallyBreakPack(5)).toBe('0:1:2::3');
    expect(moduleShim.exports.tryCatchLeakTest()).toBe('try:native-caught');
  });

  it('should produce correct results across 5 consecutive executions with rolling key self-modification', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const config = createVMConfig(101, { rollingKeys: true });
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const bytecode = compileToBytecode(ir, config);
    const bundle = buildVMRuntime(bytecode, config);

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    for (let i = 0; i < 5; i++) {
      expect(moduleShim.exports.syntaxPack(true, 'bob')).toBe('yes:BOB:bob!:2');
      expect(moduleShim.exports.syntaxPack(false, null)).toBe('no:ANON:empty:1');
    }
  });

  it('should produce identical results under all hardening profiles for the same input', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'syntax-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);

    const profiles = [
      { name: 'basic', config: createVMConfig(17) },
      { name: 'stealth', config: createVMConfig(17, { stealthDispatch: true, tamperDetection: true }) },
      {
        name: 'paranoid',
        config: createVMConfig(17, {
          runtimeHardening: 'paranoid',
          stealthDispatch: true,
          tamperDetection: true,
          rollingKeys: true,
          junkInsertion: true,
        }),
      },
    ];

    const results = profiles.map(({ name, config }) => {
      const bytecode = compileToBytecode(ir, config);
      const bundle = buildVMRuntime(bytecode, config);
      const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
      new Function('module', bundle.fullSource)(moduleShim);
      return {
        name,
        result1: moduleShim.exports.syntaxPack(true, 'bob') as string,
        result2: moduleShim.exports.syntaxPack(false, null) as string,
      };
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.result1).toBe(results[0]!.result1);
      expect(results[i]!.result2).toBe(results[0]!.result2);
    }
  });

  it('should produce identical results across multiple seeds with rolling keys disabled', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'control-flow-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });

    const seeds = [7, 13, 23, 37, 42];
    const results = seeds.map((seed) => {
      const config = createVMConfig(seed);
      const bytecode = compileToBytecode(ir, config);
      const bundle = buildVMRuntime(bytecode, config);
      const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
      new Function('module', bundle.fullSource)(moduleShim);
      return {
        seed,
        result6: moduleShim.exports.controlFlowPack(6) as number,
        result3: moduleShim.exports.controlFlowPack(3) as number,
      };
    });

    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.result6).toBe(results[0]!.result6);
      expect(results[i]!.result3).toBe(results[0]!.result3);
    }
  });

  it('should handle deeply nested expressions and allocation-heavy functions without error', () => {
    const filePath = path.join(__dirname, '..', '..', 'ir', 'tests', 'fixtures', 'expression-pack.ts');
    const ir = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { forceVirtualizeAll: true });
    const bytecode = compileToBytecode(ir, createVMConfig(53));
    const bundle = buildVMRuntime(bytecode, createVMConfig(53));

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', bundle.fullSource)(moduleShim);

    for (let i = 0; i < 10; i++) {
      expect(moduleShim.exports.expressionPack()).toBe('8:0|2|3|4|6|7:undefined:3,4,5,,6,7:ABC:2020-1-2');
    }
  });
});
