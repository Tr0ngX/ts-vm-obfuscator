import type { BytecodeModule, VMBuildConfig, VMRuntimeBundle } from '@tsvm/shared';
import { OpCode, ConstantEncodingScheme, ImmediateEncodingScheme, SeededRandom } from '@tsvm/shared';

function createOpaqueNameFactory(seed: number): () => string {
  const rng = new SeededRandom(seed ^ 0x51ed70);
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const used = new Set<string>();
  return () => {
    let value = '_';
    do {
      value = '_';
      const len = rng.nextRange(5, 9);
      for (let i = 0; i < len; i++) {
        value += alphabet[rng.nextRange(0, alphabet.length - 1)];
      }
    } while (used.has(value));
    used.add(value);
    return value;
  };
}

function createRuntimeNames(config: VMBuildConfig) {
  const stealth = !!config.stealthDispatch;
  if (!stealth) {
    return {
      stealth,
      nextHandlerName: (canonical: OpCode) => `h_${canonical}`,
      top: {
        seed: 'seed',
        rawCP: 'rawCP',
        cpCache: 'cpCache',
        getCP: 'getCP',
        functionBytecodes: 'functionBytecodes',
        executorCache: 'executorCache',
        getExecutorById: 'getExecutorById',
        createExecutor: 'createExecutor',
        handlers: 'handlers',
        result: 'result',
        vmFunctions: 'vmFunctions',
      },
      ctx: {
        pc: 'pc',
        bytecode: 'bytecode',
        regs: 'regs',
        fnArgs: 'fnArgs',
        env: 'env',
        globalScope: 'globalScope',
        running: 'running',
        returnValue: 'returnValue',
        tryFrames: 'tryStack',
        rollingState: 'rollingKey',
      },
      frame: {
        catchPc: 'catchPc',
        endPc: 'endPc',
        exceptionReg: 'exceptionReg',
      },
      locals: {
        opByte: 'op',
        dispatchBank: 'handlers',
        dispatchRoute: 'dispatchRoute',
      },
    };
  }

  const next = createOpaqueNameFactory(config.seed);
  return {
    stealth,
    nextHandlerName: () => next(),
    top: {
      seed: next(),
      rawCP: next(),
      cpCache: next(),
      getCP: next(),
      functionBytecodes: next(),
      executorCache: next(),
      getExecutorById: next(),
      createExecutor: next(),
      handlers: next(),
      result: next(),
      vmFunctions: next(),
    },
    ctx: {
      pc: 'pc',
      bytecode: 'bytecode',
      regs: 'regs',
      fnArgs: 'fnArgs',
      env: 'env',
      globalScope: 'globalScope',
      running: 'running',
      returnValue: 'returnValue',
      tryFrames: next(),
      rollingState: next(),
    },
    frame: {
      catchPc: next(),
      endPc: next(),
      exceptionReg: next(),
    },
    locals: {
      opByte: next(),
      dispatchBank: next(),
      dispatchRoute: next(),
    },
  };
}

export function buildVMRuntime(module: BytecodeModule, config: VMBuildConfig): VMRuntimeBundle {
  const names = createRuntimeNames(config);
  const ctx = names.ctx;
  const top = names.top;
  const frame = names.frame;
  const locals = names.locals;
  const regRef = (idx: string) => `ctx.${ctx.regs}[${idx}]`;
  const ctxRef = (key: keyof typeof ctx) => `ctx.${ctx[key]}`;
  const frameRef = (target: string, key: keyof typeof frame) => `${target}.${frame[key]}`;

  const opToMapped = new Map<OpCode, number[]>();
  for (const [canonical, mapped] of (module.opcodeMapping.forward as Map<OpCode, number | readonly number[]>).entries()) {
    opToMapped.set(canonical, Array.isArray(mapped) ? [...mapped] : [mapped as number]);
  }

  const cp = JSON.stringify(module.constantPool);

  const targetFnIndex = module.entryPointIndex >= 0 ? module.entryPointIndex : 0;
  const targetFn = module.functions[targetFnIndex];
  if (!targetFn) {
    throw new Error(`No target function found at index ${targetFnIndex}`);
  }

  const exportedFunctions = module.functions.filter(f => f.isEntryPoint);

  const handlerDeclarations: string[] = [];
  const handlerNames = new Map<OpCode, string>();
  const declaredOpcodes: OpCode[] = [];
  const declareHandler = (canonical: OpCode, body: string) => {
    const fnName = names.nextHandlerName(canonical);
    declaredOpcodes.push(canonical);
    handlerNames.set(canonical, fnName);
    handlerDeclarations.push(`function ${fnName}(ctx) {\n${body}\n}`);
  };

  declareHandler(OpCode.Trap, `throw new Error('VM Integrity Violation at PC ' + (${ctxRef('pc')} - 1) + ', raw op: ' + ${ctxRef('bytecode')}[${ctxRef('pc')} - 1]);`);

  const advanceArg = `
    let kindNum = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
    ${config.rollingKeys ? `kindNum ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + kindNum) & 0xFF;` : ''}
    let val = 0;
    ${config.immediateEncoding === ImmediateEncodingScheme.VariableLength ? `
      let shift = 0;
      let b;
      do {
        b = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
        ${config.rollingKeys ? `b ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + b) & 0xFF;` : ''}
        val |= (b & 0x7F) << shift;
        shift += 7;
      } while (b & 0x80);
    ` : `
      let b0 = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
      ${config.rollingKeys ? `b0 ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + b0) & 0xFF;` : ''}
      let b1 = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
      ${config.rollingKeys ? `b1 ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + b1) & 0xFF;` : ''}
      let b2 = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
      ${config.rollingKeys ? `b2 ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + b2) & 0xFF;` : ''}
      let b3 = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
      ${config.rollingKeys ? `b3 ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + b3) & 0xFF;` : ''}
      val = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    `}
  `;

  const readArgs = `
    let argCount = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
    ${config.rollingKeys ? `argCount ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + argCount) & 0xFF;` : ''}
    const args = [];
    for (let i = 0; i < argCount; i++) {
      ${advanceArg}
      args.push(val);
    }
  `;

  declareHandler(OpCode.LoadConst, `
    ${readArgs}
    ${regRef('args[1]')} = ${top.getCP}(args[0]);
  `);
  declareHandler(OpCode.LoadLocal, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.StoreLocal, `${readArgs} ctx.regs[args[0]] = ctx.regs[args[1]];`);
  declareHandler(OpCode.Move, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.LoadGlobal, `
    ${readArgs}
    const propName = ${regRef('args[0]')};
    ${regRef('args[1]')} = (typeof ${top.result} !== 'undefined' && ${top.result}[propName] !== undefined)
      ? ${top.result}[propName]
      : ${ctxRef('globalScope')}[propName];
  `);
  declareHandler(OpCode.StoreGlobal, `${readArgs} ${ctxRef('globalScope')}[${regRef('args[0]')}] = ${regRef('args[1]')};`);
  
  declareHandler(OpCode.Add, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] + ctx.regs[args[1]];`);
  declareHandler(OpCode.Sub, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] - ctx.regs[args[1]];`);
  declareHandler(OpCode.Mul, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] * ctx.regs[args[1]];`);
  declareHandler(OpCode.Div, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] / ctx.regs[args[1]];`);
  declareHandler(OpCode.Mod, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] % ctx.regs[args[1]];`);
  declareHandler(OpCode.Neg, `${readArgs} ctx.regs[args[1]] = -ctx.regs[args[0]];`);
  
  declareHandler(OpCode.BitAnd, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] & ctx.regs[args[1]];`);
  declareHandler(OpCode.BitOr, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] | ctx.regs[args[1]];`);
  declareHandler(OpCode.BitXor, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] ^ ctx.regs[args[1]];`);
  declareHandler(OpCode.Shl, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] << ctx.regs[args[1]];`);
  declareHandler(OpCode.Shr, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] >> ctx.regs[args[1]];`);
  declareHandler(OpCode.UShr, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] >>> ctx.regs[args[1]];`);
  declareHandler(OpCode.Not, `${readArgs} ctx.regs[args[1]] = !ctx.regs[args[0]];`);
  
  declareHandler(OpCode.Eq, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] == ctx.regs[args[1]];`);
  declareHandler(OpCode.StrictEq, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] === ctx.regs[args[1]];`);
  declareHandler(OpCode.Lt, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] < ctx.regs[args[1]];`);
  declareHandler(OpCode.LtEq, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] <= ctx.regs[args[1]];`);
  declareHandler(OpCode.Gt, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] > ctx.regs[args[1]];`);
  declareHandler(OpCode.GtEq, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] >= ctx.regs[args[1]];`);
  
  declareHandler(OpCode.TypeOf, `${readArgs} ctx.regs[args[1]] = typeof ctx.regs[args[0]];`);
  declareHandler(OpCode.InstanceOf, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] instanceof ctx.regs[args[1]];`);
  declareHandler(OpCode.PropGet, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]][ctx.regs[args[1]]];`);
  declareHandler(OpCode.PropSet, `${readArgs} ctx.regs[args[0]][ctx.regs[args[1]]] = ctx.regs[args[2]];`);
  declareHandler(OpCode.ComputedGet, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]][ctx.regs[args[1]]];`);
  declareHandler(OpCode.ComputedSet, `${readArgs} ctx.regs[args[0]][ctx.regs[args[1]]] = ctx.regs[args[2]];`);
  declareHandler(OpCode.ArrayNew, `${readArgs} ctx.regs[args[0]] = [];`);
  declareHandler(OpCode.ObjectNew, `${readArgs} ctx.regs[args[0]] = {};`);
  declareHandler(OpCode.Delete, `${readArgs} delete ctx.regs[args[0]][ctx.regs[args[1]]];`);
  declareHandler(OpCode.CellNew, `${readArgs} ctx.regs[args[1]] = { v: ctx.regs[args[0]] };`);
  declareHandler(OpCode.CellGet, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]].v;`);
  declareHandler(OpCode.CellSet, `${readArgs} ctx.regs[args[0]].v = ctx.regs[args[1]];`);
  declareHandler(OpCode.EnvGet, `${readArgs} ${regRef('args[1]')} = ${ctxRef('env')}[args[0]];`);
  declareHandler(OpCode.RestArgs, `${readArgs} ${regRef('args[1]')} = ${ctxRef('fnArgs')}.slice(${regRef('args[0]')});`);
  declareHandler(OpCode.ClosureNew, `
    ${readArgs}
    ${regRef('args[2]')} = ${top.getExecutorById}(${top.getCP}(args[0]), ${regRef('args[1]')});
  `);
  declareHandler(OpCode.Spread, `
    ${readArgs}
    var spreadTarget = ${regRef('args[0]')};
    var spreadSource = ${regRef('args[1]')};
    if (Array.isArray(spreadTarget)) {
      if (spreadSource == null || typeof spreadSource[Symbol.iterator] !== 'function') {
        throw new TypeError('VM spread source is not iterable');
      }
      var spreadIterator = spreadSource[Symbol.iterator]();
      var spreadStep;
      while (!(spreadStep = spreadIterator.next()).done) {
        spreadTarget.push(spreadStep.value);
      }
    } else if (spreadSource != null) {
      var spreadKeys = Object.keys(spreadSource);
      for (var ski = 0; ski < spreadKeys.length; ski++) {
        var spreadKey = spreadKeys[ski];
        spreadTarget[spreadKey] = spreadSource[spreadKey];
      }
    }
  `);
  declareHandler(OpCode.SpreadIntoArray, `
    ${readArgs}
    var indexedSpreadTarget = ${regRef('args[0]')};
    var indexedSpreadSource = ${regRef('args[1]')};
    var indexedSpreadStart = ${regRef('args[2]')};
    if (indexedSpreadSource == null || typeof indexedSpreadSource[Symbol.iterator] !== 'function') {
      throw new TypeError('VM spread source is not iterable');
    }
    var indexedSpreadIterator = indexedSpreadSource[Symbol.iterator]();
    var indexedSpreadStep;
    var indexedSpreadCount = 0;
    while (!(indexedSpreadStep = indexedSpreadIterator.next()).done) {
      indexedSpreadTarget[indexedSpreadStart + indexedSpreadCount] = indexedSpreadStep.value;
      indexedSpreadCount++;
    }
    ${regRef('args[3]')} = indexedSpreadCount;
  `);
  
  declareHandler(OpCode.CallMethod, `
    ${readArgs}
    var obj = ${regRef('args[0]')};
    var method = obj[ctx.regs[args[1]]];
    var aa = [];
    for (var ci = 2; ci < args.length - 1; ci++) {
      aa.push(${regRef('args[ci]')});
    }
    ${regRef('args[args.length - 1]')} = method.apply(obj, aa);
  `);
  declareHandler(OpCode.Call, `
    ${readArgs}
    var fn = ${regRef('args[0]')};
    var ab = [];
    for (var ci2 = 1; ci2 < args.length - 1; ci2++) {
      ab.push(${regRef('args[ci2]')});
    }
    ${regRef('args[args.length - 1]')} = fn.apply(null, ab);
  `);
  declareHandler(OpCode.CallWithArray, `
    ${readArgs}
    var fnArray = ctx.regs[args[0]];
    ctx.regs[args[2]] = fnArray.apply(null, ctx.regs[args[1]]);
  `);
  declareHandler(OpCode.CallMethodWithArray, `
    ${readArgs}
    var methodObj = ctx.regs[args[0]];
    var methodFn = methodObj[ctx.regs[args[1]]];
    ctx.regs[args[3]] = methodFn.apply(methodObj, ctx.regs[args[2]]);
  `);
  declareHandler(OpCode.New, `
    ${readArgs}
    var ctor = ctx.regs[args[0]];
    var ctorArgs = [];
    for (var ni = 1; ni < args.length - 1; ni++) {
      ctorArgs.push(ctx.regs[args[ni]]);
    }
    ctx.regs[args[args.length - 1]] = typeof Reflect !== 'undefined' && Reflect.construct
      ? Reflect.construct(ctor, ctorArgs)
      : new (Function.prototype.bind.apply(ctor, [null].concat(ctorArgs)))();
  `);
  declareHandler(OpCode.NewWithArray, `
    ${readArgs}
    var ctorArray = ctx.regs[args[0]];
    var ctorArrayArgs = ctx.regs[args[1]];
    ctx.regs[args[2]] = typeof Reflect !== 'undefined' && Reflect.construct
      ? Reflect.construct(ctorArray, ctorArrayArgs)
      : new (Function.prototype.bind.apply(ctorArray, [null].concat(ctorArrayArgs)))();
  `);
  
  declareHandler(OpCode.Jmp, `${readArgs} ${ctxRef('pc')} = args[0]; ${config.rollingKeys ? `${ctxRef('rollingState')} = args[1];` : ''}`);
  declareHandler(OpCode.JmpIf, `${readArgs} ${ctxRef('pc')} = ${regRef('args[0]')} ? args[1] : args[2]; ${config.rollingKeys ? `${ctxRef('rollingState')} = ${regRef('args[0]')} ? args[3] : args[4];` : ''}`);
  declareHandler(OpCode.JmpIfNot, `${readArgs} ${ctxRef('pc')} = !${regRef('args[0]')} ? args[1] : args[2]; ${config.rollingKeys ? `${ctxRef('rollingState')} = !${regRef('args[0]')} ? args[3] : args[4];` : ''}`);
  
  declareHandler(OpCode.Return, `${readArgs} ${ctxRef('returnValue')} = args.length > 0 ? ${regRef('args[0]')} : undefined; ${ctxRef('running')} = false;`);
  declareHandler(OpCode.ReturnVoid, `${readArgs} ${ctxRef('returnValue')} = undefined; ${ctxRef('running')} = false;`);
  declareHandler(OpCode.Throw, `${readArgs} throw (args.length > 0 ? ${regRef('args[0]')} : undefined);`);
  declareHandler(OpCode.TryCatchBegin, `
    ${readArgs}
    ${ctxRef('tryFrames')}.push({
      ${frame.catchPc}: args[0],
      ${frame.endPc}: args[1],
      ${frame.exceptionReg}: args[2],
    });
  `);
  declareHandler(OpCode.TryCatchEnd, `${readArgs} if (${ctxRef('tryFrames')}.length > 0) { ${ctxRef('tryFrames')}.pop(); }`);
  declareHandler(OpCode.Nop, `${readArgs} /* Junk */`);
  declareHandler(OpCode.Halt, `${ctxRef('running')} = false;`);

  const antiDebugLogic = config.antiDebug ? `
    // Anti-Debug Heuristics
    var _dbg_start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    debugger;
    var _dbg_end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (_dbg_end - _dbg_start > 100) { 
       // Corrupt state silently
       ${regRef('1')} = NaN; 
       ${ctxRef('pc')} = Math.max(0, ${ctxRef('pc')} - 2); 
    }
  ` : '';

  const tamperDetectionLogic = config.tamperDetection ? `
    // Integrity checks for native functions and self
    var _isNative = function(fn) { return /\\{\\s*\\[native code\\]\\s*\\}/.test('' + fn); };
    var fnStr = execute.toString();
    if (
      (fnStr.indexOf('debugger') === -1 && ${config.antiDebug}) || 
      fnStr.length < 100 || 
      !_isNative(Math.sin)
    ) {
      // Data corruption on tamper
      ${ctxRef('globalScope')} = {}; 
      ${regRef('0')} = null; 
    }
  ` : '';

  const runtimeDispatch = (() => {
    if (!names.stealth) {
      const handlerArrayItems: string[] = new Array(256).fill(handlerNames.get(OpCode.Trap)!);
      for (const [canonical, mapped] of opToMapped.entries()) {
        const fnName = handlerNames.get(canonical)!;
        for (const vOp of mapped) {
          handlerArrayItems[vOp] = fnName;
        }
      }
      return {
        declarations: `const ${top.handlers} = [\n    ${handlerArrayItems.join(',\n    ')}\n  ];`,
        invoke: `${top.handlers}[${locals.opByte}](ctx);`,
      };
    }

    const rng = new SeededRandom(config.seed ^ 0x2e57f0);
    const bankOrder = rng.shuffle([...declaredOpcodes]);
    const slotByCanonical = new Map(bankOrder.map((canonical, index) => [canonical, index]));
    const trapSlot = slotByCanonical.get(OpCode.Trap) ?? 0;
    const route = new Array(256).fill(trapSlot);
    for (const [canonical, mapped] of opToMapped.entries()) {
      const slot = slotByCanonical.get(canonical);
      if (slot === undefined) {
        continue;
      }
      for (const vOp of mapped) {
        route[vOp] = slot;
      }
    }

    return {
      declarations: `const ${locals.dispatchBank} = [\n    ${bankOrder.map((canonical) => handlerNames.get(canonical)!).join(',\n    ')}\n  ];\n  const ${locals.dispatchRoute} = new Uint8Array([${route.join(',')}]);`,
      invoke: `${locals.dispatchBank}[${locals.dispatchRoute}[${locals.opByte}]](ctx);`,
    };
  })();

  const sourceCode = `
// Polymorphic Threaded VM Engine - Build: ${module.buildId}
const ${top.vmFunctions} = (function() {
  const ${top.seed} = ${config.seed};
  const ${top.rawCP} = ${cp};
  const ${top.cpCache} = new Map();
  
  // Lazy Decryption
  function ${top.getCP}(index) {
    if (${top.cpCache}.has(index)) return ${top.cpCache}.get(index);
    let c = ${top.rawCP}[index];
    let val = c.kind === 'undefined' ? undefined : c.value;
    if (c.kind === 'string' && ${config.constantPoolEncoding === ConstantEncodingScheme.XorRotate}) {
      let decoded = '';
      for (let i = 0; i < val.length; i++) {
        decoded += String.fromCharCode(val.charCodeAt(i) ^ (${top.seed} & 0xFF));
      }
      val = decoded;
    }
    ${top.cpCache}.set(index, val);
    return val;
  }

  ${handlerDeclarations.join('\n\n')}

  ${runtimeDispatch.declarations}

  const ${top.functionBytecodes} = {
${module.functions.map(fn => `    '${fn.id}': new Uint8Array([${fn.bytecode.join(',')}])`).join(',\n')}
  };
  const ${top.executorCache} = Object.create(null);

  function ${top.getExecutorById}(functionId, env) {
    if ((!env || env.length === 0) && ${top.executorCache}[functionId]) {
      return ${top.executorCache}[functionId];
    }
    const bytecode = ${top.functionBytecodes}[functionId];
    if (!bytecode) {
      throw new Error('Unknown VM function id: ' + functionId);
    }
    const executor = ${top.createExecutor}(bytecode, env || []);
    if (!env || env.length === 0) {
      ${top.executorCache}[functionId] = executor;
    }
    return executor;
  }

  function ${top.createExecutor}(bytecodeArr, envArr) {
    return function execute() {
      const ${ctx.fnArgs} = Array.prototype.slice.call(arguments);
      const ctx = {
        ${ctx.pc}: 0,
        ${ctx.bytecode}: bytecodeArr,
        ${ctx.regs}: new Array(256).fill(undefined),
        ${ctx.fnArgs},
        ${ctx.env}: envArr || [],
        ${ctx.globalScope}: typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
        ${ctx.running}: true,
        ${ctx.returnValue}: undefined,
        ${ctx.tryFrames}: [],
        ${ctx.rollingState}: ${config.rollingKeys ? `${top.seed} & 0xFF` : '0'}
      };

      ${antiDebugLogic}
      ${tamperDetectionLogic}

      for (let i = 0; i < ${ctx.fnArgs}.length; i++) {
        ${regRef('i')} = ${ctx.fnArgs}[i];
      }
      
      // Threaded Dispatch Loop
      while(${ctxRef('running')} && ${ctxRef('pc')} < ${ctxRef('bytecode')}.length) {
        while (${ctxRef('tryFrames')}.length > 0 && ${ctxRef('pc')} >= ${ctxRef('tryFrames')}[${ctxRef('tryFrames')}.length - 1].${frame.endPc}) {
          ${ctxRef('tryFrames')}.pop();
        }
        let ${locals.opByte} = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
        ${config.rollingKeys ? `${locals.opByte} ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + ${locals.opByte}) & 0xFF;` : ''}
        try {
          ${runtimeDispatch.invoke}
        } catch (error) {
          if (${ctxRef('tryFrames')}.length === 0) {
            throw error;
          }
          const handler = ${ctxRef('tryFrames')}.pop();
          ${regRef(frameRef('handler', 'exceptionReg'))} = error;
          ${ctxRef('running')} = true;
          ${ctxRef('pc')} = ${frameRef('handler', 'catchPc')};
        }
      }
      
      return ${ctxRef('returnValue')};
    };
  }

  var ${top.result} = {};
${exportedFunctions.map(fn => `  ${top.result}['${fn.name}'] = ${top.getExecutorById}('${fn.id}');`).join('\n')}
  return ${top.result};
})();

if (typeof module !== 'undefined' && module.exports) {
${exportedFunctions.map(fn => `  module.exports.${fn.name} = ${top.vmFunctions}['${fn.name}'];`).join('\n')}
}
  `.trim();

  return {
    buildId: module.buildId,
    dispatchLoop: 'function dispatch() {}',
    handlers: [],
    constantDecoder: 'function decode() {}',
    bytecodePayload: targetFn.bytecode,
    entryBootstrap: 'function boot() {}',
    fullSource: sourceCode
  };
}
