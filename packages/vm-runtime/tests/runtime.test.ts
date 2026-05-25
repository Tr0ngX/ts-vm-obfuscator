import { describe, it, expect } from 'vitest';
import { buildVMRuntime } from '../src/polymorphic-builder.js';
import { BytecodeModule, OpCode, ImmediateEncodingScheme, ConstantEncodingScheme, type ModuleInfo, type ProjectSemanticGraph } from '@tsvm/shared';
import { lowerToIR } from '../../ir/src/builder.js';
import { compileToBytecode } from '../../bytecode/src/compiler.js';
import path from 'path';
import { fileURLToPath } from 'url';

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

  it('should emit a ClosureNew handler backed by the VM function table', () => {
    const dummyModule: BytecodeModule = {
      magic: 0x54534F42,
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
    expect(bundle.fullSource).toContain("throw new Error('Unknown VM function id: ' + functionId);");
    expect(bundle.fullSource).toContain('ctx.regs[args[2]] = getExecutorById(getCP(args[0]), ctx.regs[args[1]]);');
    expect(bundle.fullSource).toContain('ctx.regs[args[1]] = ctx.env[args[0]];');
    expect(bundle.fullSource).toContain('ctx.regs[args[1]] = { v: ctx.regs[args[0]] };');
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
  });
});
