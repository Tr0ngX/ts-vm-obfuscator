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
        weakMapCtor: 'VMWeakMap',
        reflectObj: 'VMReflect',
        objectObj: 'VMObject',
        arraySlice: 'sliceArgs',
        promiseResolve: 'resolvePromise',
        iteratorSymbol: 'iteratorSymbol',
        asyncIteratorSymbol: 'asyncIteratorSymbol',
        functionBytecodes: 'functionBytecodes',
        executorCache: 'executorCache',
        getExecutorById: 'getExecutorById',
        createExecutor: 'createExecutor',
        handlers: 'handlers',
        result: 'result',
        vmFunctions: 'vmFunctions',
        privateData: 'privateData',
      },
      ctx: {
        pc: 'pc',
        bytecode: 'bytecode',
        regs: 'regs',
        fnArgs: 'fnArgs',
        env: 'env',
        globalScope: 'globalScope',
        thisArg: 'thisArg',
        newTarget: 'newTarget',
        resumeMode: 'resumeMode',
        resumeValue: 'resumeValue',
        resumeReg: 'resumeReg',
        awaitPromise: 'awaitPromise',
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
      weakMapCtor: next(),
      reflectObj: next(),
      objectObj: next(),
      arraySlice: next(),
      promiseResolve: next(),
      iteratorSymbol: next(),
      asyncIteratorSymbol: next(),
      functionBytecodes: next(),
      executorCache: next(),
      getExecutorById: next(),
      createExecutor: next(),
      handlers: next(),
      result: next(),
      vmFunctions: next(),
      privateData: next(),
    },
    ctx: {
      pc: 'pc',
      bytecode: 'bytecode',
      regs: 'regs',
      fnArgs: 'fnArgs',
      env: 'env',
      globalScope: 'globalScope',
      thisArg: next(),
      newTarget: next(),
      resumeMode: next(),
      resumeValue: next(),
      resumeReg: next(),
      awaitPromise: next(),
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
  declareHandler(OpCode.LoadThis, `${readArgs} ${regRef('args[0]')} = ${ctxRef('thisArg')};`);
  declareHandler(OpCode.LoadNewTarget, `${readArgs} ${regRef('args[0]')} = ${ctxRef('newTarget')};`);
  
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
  declareHandler(OpCode.Await, `
    ${readArgs}
    ${ctxRef('awaitPromise')} = Promise.resolve(${regRef('args[0]')});
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'await';
    ${ctxRef('running')} = false;
  `);
  declareHandler(OpCode.Nop, `${readArgs} /* Junk */`);
  declareHandler(OpCode.Halt, `${ctxRef('running')} = false;`);

  declareHandler(OpCode.PrivateGet, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.privateData}.get(obj);
    if (!p || !(key in p)) throw new TypeError('Cannot read private member');
    ctx.regs[args[2]] = p[key];
  `);
  declareHandler(OpCode.PrivateSet, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.privateData}.get(obj);
    if (!p) { p = {}; ${top.privateData}.set(obj, p); }
    p[key] = ctx.regs[args[2]];
  `);
  declareHandler(OpCode.PrivateIn, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.privateData}.get(obj);
    ctx.regs[args[2]] = p ? (key in p) : false;
  `);

  declareHandler(OpCode.SuperPropGet, `
    ${readArgs}
    var superProto = ${top.objectObj}.getPrototypeOf(${top.objectObj}.getPrototypeOf(ctx.thisArg));
    ctx.regs[args[1]] = superProto[ctx.regs[args[0]]];
  `);
  declareHandler(OpCode.SuperPropSet, `
    ${readArgs}
    var superProto = ${top.objectObj}.getPrototypeOf(${top.objectObj}.getPrototypeOf(ctx.thisArg));
    superProto[ctx.regs[args[0]]] = ctx.regs[args[1]];
  `);
  declareHandler(OpCode.SuperCall, `
    ${readArgs}
    if (!${top.reflectObj} || !${top.reflectObj}.construct) {
      throw new TypeError('Reflect.construct is required for super()');
    }
    var superCtor = ${top.objectObj}.getPrototypeOf(ctx.thisArg.constructor);
    var aa = [];
    for (var ci = 0; ci < args.length - 1; ci++) {
      aa.push(ctx.regs[args[ci]]);
    }
    ctx.thisArg = ${top.reflectObj}.construct(superCtor, aa, ctx.newTarget || ctx.thisArg.constructor);
    ctx.regs[args[args.length - 1]] = ctx.thisArg;
  `);
  declareHandler(OpCode.SuperCallWithArray, `
    ${readArgs}
    if (!${top.reflectObj} || !${top.reflectObj}.construct) {
      throw new TypeError('Reflect.construct is required for super()');
    }
    var superCtor = ${top.objectObj}.getPrototypeOf(ctx.thisArg.constructor);
    ctx.thisArg = ${top.reflectObj}.construct(superCtor, ctx.regs[args[0]], ctx.newTarget || ctx.thisArg.constructor);
    ctx.regs[args[1]] = ctx.thisArg;
  `);

  declareHandler(OpCode.Yield, `
    ${readArgs}
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'yield';
    ${ctxRef('resumeValue')} = ctx.regs[args[0]];
    ${ctxRef('running')} = false;
  `);
  declareHandler(OpCode.YieldStar, `
    ${readArgs}
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'yieldStar';
    ${ctxRef('resumeValue')} = ctx.regs[args[0]];
    ${ctxRef('running')} = false;
  `);

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
  const ${top.weakMapCtor} = WeakMap;
  const ${top.reflectObj} = typeof Reflect !== 'undefined' ? Reflect : undefined;
  const ${top.objectObj} = Object;
  const ${top.arraySlice} = Array.prototype.slice;
  const ${top.promiseResolve} = Promise.resolve.bind(Promise);
  const ${top.iteratorSymbol} = typeof Symbol !== 'undefined' ? Symbol.iterator : '@@iterator';
  const ${top.asyncIteratorSymbol} = typeof Symbol !== 'undefined' && Symbol.asyncIterator ? Symbol.asyncIterator : null;
  const ${top.privateData} = new ${top.weakMapCtor}();
  
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
${module.functions.map(fn => `    '${fn.id}': { bytecode: new Uint8Array([${fn.bytecode.join(',')}]), attributes: ${JSON.stringify(fn.attributes ?? [])}, registerCount: ${fn.maxRegisters} }`).join(',\n')}
  };
  const ${top.executorCache} = Object.create(null);

  function ${top.getExecutorById}(functionId, env) {
    if ((!env || env.length === 0) && ${top.executorCache}[functionId]) {
      return ${top.executorCache}[functionId];
    }
    const functionMeta = ${top.functionBytecodes}[functionId];
    if (!functionMeta) {
      throw new Error('Unknown VM function id: ' + functionId);
    }
    const executor = ${top.createExecutor}(functionMeta.bytecode, env || [], functionMeta.attributes || [], functionMeta.registerCount || 0);
    if (!env || env.length === 0) {
      ${top.executorCache}[functionId] = executor;
    }
    return executor;
  }

  function __createVmContext(bytecodeArr, envArr, thisArg, newTarget, argsArr, registerCount) {
    const ctx = {
      ${ctx.pc}: 0,
      ${ctx.bytecode}: bytecodeArr,
      ${ctx.regs}: new Array(registerCount > 0 ? registerCount : argsArr.length + 8).fill(undefined),
      ${ctx.fnArgs}: argsArr,
      ${ctx.env}: envArr || [],
      ${ctx.globalScope}: typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
      ${ctx.thisArg}: thisArg,
      ${ctx.newTarget}: newTarget,
      ${ctx.resumeMode}: 'normal',
      ${ctx.resumeValue}: undefined,
      ${ctx.resumeReg}: -1,
      ${ctx.awaitPromise}: null,
      ${ctx.running}: true,
      ${ctx.returnValue}: undefined,
      ${ctx.tryFrames}: [],
      ${ctx.rollingState}: ${config.rollingKeys ? `${top.seed} & 0xFF` : '0'}
    };
    for (let i = 0; i < argsArr.length; i++) {
      ${regRef('i')} = argsArr[i];
    }
    return ctx;
  }

  function __runVm(ctx) {
    ${antiDebugLogic}
    ${tamperDetectionLogic}
    while(${ctxRef('running')} && ${ctxRef('pc')} < ${ctxRef('bytecode')}.length) {
      while (${ctxRef('tryFrames')}.length > 0 && ${ctxRef('pc')} >= ${ctxRef('tryFrames')}[${ctxRef('tryFrames')}.length - 1].${frame.endPc}) {
        ${ctxRef('tryFrames')}.pop();
      }
      try {
        if (${ctxRef('resumeMode')} === 'store') {
          ctx.${ctx.regs}[ctx.${ctx.resumeReg}] = ctx.${ctx.resumeValue};
          ${ctxRef('resumeMode')} = 'normal';
          ${ctxRef('resumeValue')} = undefined;
          ${ctxRef('resumeReg')} = -1;
        } else if (${ctxRef('resumeMode')} === 'throw') {
          const pendingError = ctx.${ctx.resumeValue};
          ${ctxRef('resumeMode')} = 'normal';
          ${ctxRef('resumeValue')} = undefined;
          throw pendingError;
        }
        let ${locals.opByte} = ${ctxRef('bytecode')}[${ctxRef('pc')}++];
        ${config.rollingKeys ? `${locals.opByte} ^= ${ctxRef('rollingState')}; ${ctxRef('rollingState')} = (${ctxRef('rollingState')} + ${locals.opByte}) & 0xFF;` : ''}
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
    if (${ctxRef('resumeMode')} === 'await') {
      ${ctxRef('resumeMode')} = 'normal';
      return { kind: 'await', promise: ${ctxRef('awaitPromise')} };
    }
    if (${ctxRef('resumeMode')} === 'yield' || ${ctxRef('resumeMode')} === 'yieldStar') {
      return { kind: ${ctxRef('resumeMode')}, value: ${ctxRef('resumeValue')} };
    }
    return { kind: 'return', value: ${ctxRef('returnValue')} };
  }

  function ${top.createExecutor}(bytecodeArr, envArr, attributes, registerCount) {
    const isAsync = attributes && attributes.indexOf('async') >= 0;
    const isGenerator = attributes && attributes.indexOf('generator') >= 0;
    if (isAsync && isGenerator) {
      return function execute() {
        const ${ctx.fnArgs} = ${top.arraySlice}.call(arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount);
        let delegateIterator = null;
        let delegateIsAsync = false;
        let finished = false;
        const resumeAwait = async (promise, mode) => {
          try {
            ctx.${ctx.resumeMode} = 'store';
            ctx.${ctx.resumeValue} = await ${top.promiseResolve}(promise);
            ctx.${ctx.running} = true;
          } catch (error) {
            ctx.${ctx.resumeMode} = 'throw';
            ctx.${ctx.resumeValue} = error;
            ctx.${ctx.running} = true;
          }
          return mode;
        };
        return {
          [${top.asyncIteratorSymbol} || ${top.iteratorSymbol}]: function() { return this; },
          next: async function(v) {
            if (finished) return { value: undefined, done: true };
            while (true) {
              if (delegateIterator) {
                const step = delegateIsAsync ? await delegateIterator.next(v) : delegateIterator.next(v);
                if (step.done) {
                  v = step.value;
                  delegateIterator = null;
                  delegateIsAsync = false;
                } else {
                  return step;
                }
              }
              if (ctx.${ctx.resumeMode} === 'yield' || ctx.${ctx.resumeMode} === 'yieldStar') {
                ctx.${ctx.resumeMode} = 'normal';
                ctx.${ctx.regs}[ctx.${ctx.resumeReg}] = v;
                ctx.${ctx.resumeReg} = -1;
                ctx.${ctx.running} = true;
              }
              const outcome = __runVm(ctx);
              if (outcome.kind === 'await') {
                await resumeAwait(outcome.promise, 'await');
                v = undefined;
                continue;
              }
              if (outcome.kind === 'return') {
                finished = true;
                return { value: outcome.value, done: true };
              }
              if (outcome.kind === 'yield') {
                return { value: outcome.value, done: false };
              }
              if (outcome.kind === 'yieldStar') {
                if (${top.asyncIteratorSymbol} && outcome.value[${top.asyncIteratorSymbol}]) {
                  delegateIterator = outcome.value[${top.asyncIteratorSymbol}]();
                  delegateIsAsync = true;
                } else {
                  delegateIterator = outcome.value[${top.iteratorSymbol}]();
                  delegateIsAsync = false;
                }
                v = undefined;
              }
            }
          },
          return: async function(v) {
            finished = true;
            ctx.${ctx.running} = false;
            return { value: v, done: true };
          },
          throw: async function(e) {
            ctx.${ctx.resumeMode} = 'throw';
            ctx.${ctx.resumeValue} = e;
            ctx.${ctx.running} = true;
            return this.next();
          }
        };
      };
    }
    if (isAsync) {
      return async function execute() {
        const ${ctx.fnArgs} = ${top.arraySlice}.call(arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount);
        while (true) {
          const outcome = __runVm(ctx);
          if (outcome.kind === 'return') {
            return outcome.value;
          }
          try {
            ctx.${ctx.resumeMode} = 'store';
            ctx.${ctx.resumeValue} = await ${top.promiseResolve}(outcome.promise);
            ctx.${ctx.running} = true;
          } catch (error) {
            ctx.${ctx.resumeMode} = 'throw';
            ctx.${ctx.resumeValue} = error;
            ctx.${ctx.running} = true;
          }
        }
      };
    }
    if (isGenerator) {
      return function execute() {
        const ${ctx.fnArgs} = ${top.arraySlice}.call(arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount);
        let delegateIterator = null;
        let finished = false;
        return {
          [${top.iteratorSymbol}]: function() { return this; },
          next: function(v) {
            if (finished) return { value: undefined, done: true };
            while(true) {
              if (delegateIterator) {
                let step = delegateIterator.next(v);
                if (step.done) {
                  v = step.value;
                  delegateIterator = null;
                } else {
                  return step;
                }
              }
              if (ctx.${ctx.resumeMode} === 'yield' || ctx.${ctx.resumeMode} === 'yieldStar') {
                ctx.${ctx.resumeMode} = 'normal';
                ctx.${ctx.regs}[ctx.${ctx.resumeReg}] = v;
                ctx.${ctx.resumeReg} = -1;
                ctx.${ctx.running} = true;
              }
              const outcome = __runVm(ctx);
              if (outcome.kind === 'await') {
                throw new Error('VM await suspension reached sync generator');
              }
              if (outcome.kind === 'return') {
                finished = true;
                return { value: outcome.value, done: true };
              }
              if (outcome.kind === 'yield') {
                return { value: outcome.value, done: false };
              }
              if (outcome.kind === 'yieldStar') {
                delegateIterator = outcome.value[${top.iteratorSymbol}]();
                v = undefined;
                continue;
              }
            }
          },
          return: function(v) {
             finished = true;
             ctx.${ctx.running} = false;
             return { value: v, done: true };
          },
          throw: function(e) {
             ctx.${ctx.resumeMode} = 'throw';
             ctx.${ctx.resumeValue} = e;
             ctx.${ctx.running} = true;
             return this.next();
          }
        };
      };
    }
    return function execute() {
      const ${ctx.fnArgs} = ${top.arraySlice}.call(arguments);
      const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount);
      const outcome = __runVm(ctx);
      if (outcome.kind === 'await') {
        throw new Error('VM await suspension reached sync executor');
      }
      return outcome.value;
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
