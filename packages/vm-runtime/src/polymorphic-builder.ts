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

function mutateArithmeticExpression(op: 'add' | 'sub', a: string, b: string, seed: number): string {
  const rng = new SeededRandom(seed ^ 0x93b2a5);
  const choice = rng.nextRange(0, 3);

  if (op === 'add') {
    switch (choice) {
      case 0:
        return `(((${a}) ^ (${b})) + 2 * ((${a}) & (${b})))`;
      case 1:
        return `(((${a}) | (${b})) + ((${a}) & (${b})))`;
      default:
        return `((${a}) - (-(${b})))`;
    }
  } else {
    switch (choice) {
      case 0:
        return `(((${a}) ^ ~(${b})) + 2 * ((${a}) & ~(${b})) + 1)`;
      case 1:
        return `(((${a}) & ~(${b})) - (~(${a}) & (${b})))`;
      default:
        return `((${a}) + (-(${b})))`;
    }
  }
}

function generateJunkStatements(seed: number, id: number): string {
  const rng = new SeededRandom(seed ^ id ^ 0x7c2a11);
  const numJunk = rng.nextRange(1, 3);
  let junk = '';
  for (let i = 0; i < numJunk; i++) {
    const choice = rng.nextRange(0, 3);
    const varName = `_j${id}_${i}`;
    switch (choice) {
      case 0:
        junk += `  var ${varName} = (${seed} ^ ${rng.nextRange(10, 100)}) | 0;\n`;
        junk += `  ${varName} = (${varName} + 12) & 0xFF;\n`;
        break;
      case 1:
        junk += `  var ${varName} = Math.sin(${rng.nextRange(1, 10)}) * ${rng.nextRange(2, 5)};\n`;
        junk += `  if (${varName} > 100) { ${varName} = 0; }\n`;
        break;
      default:
        junk += `  var ${varName} = (${seed} % ${rng.nextRange(3, 9)}) | 0;\n`;
        junk += `  ${varName} = (${varName} * ${varName}) | 0;\n`;
        break;
    }
  }
  return junk;
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
        runtimeStrings: 'runtimeStrings',
        runtimeStringCache: 'runtimeStringCache',
        getRuntimeString: 'getRuntimeString',
        weakMapCtor: 'VMWeakMap',
        weakMapGet: 'VMWeakMapGet',
        weakMapSet: 'VMWeakMapSet',
        reflectObj: 'VMReflect',
        objectObj: 'VMObject',
        nativeToString: 'VMNativeToString',
        nativeMathSin: 'VMNativeMathSin',
        arraySlice: 'sliceArgs',
        promiseResolve: 'resolvePromise',
        iteratorSymbol: 'iteratorSymbol',
        asyncIteratorSymbol: 'asyncIteratorSymbol',
        functionArena: 'functionArena',
        functionBytecodes: 'functionBytecodes',
        executorCache: 'executorCache',
        getExecutorById: 'getExecutorById',
        createExecutor: 'createExecutor',
        handlers: 'handlers',
        result: 'result',
        vmFunctions: 'vmFunctions',
        privateData: 'privateData',
        opaquePredicate: 'opaquePredicate',
        junkSink: 'junkSink',
        readByte: 'readByte',
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
        xorLog: 'xorLog',
        executionNonce: 'executionNonce',
        currentOpcode: 'currentOpcode',
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
      runtimeStrings: next(),
      runtimeStringCache: next(),
      getRuntimeString: next(),
      weakMapCtor: next(),
      weakMapGet: next(),
      weakMapSet: next(),
      reflectObj: next(),
      objectObj: next(),
      nativeToString: next(),
      nativeMathSin: next(),
      arraySlice: next(),
      promiseResolve: next(),
      iteratorSymbol: next(),
      asyncIteratorSymbol: next(),
      functionArena: next(),
      functionBytecodes: next(),
      executorCache: next(),
      getExecutorById: next(),
      createExecutor: next(),
      handlers: next(),
      result: next(),
      vmFunctions: next(),
      privateData: next(),
      opaquePredicate: next(),
      junkSink: next(),
      readByte: next(),
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
      xorLog: next(),
      executionNonce: 'executionNonce',
      currentOpcode: 'currentOpcode',
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
  const buildRng = new SeededRandom(config.seed ^ 0xbad1a);
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
  const concealRuntimeStrings = !!config.stealthDispatch || !!config.tamperDetection || !!config.junkInsertion;
  const runtimeStringKey = (config.seed ^ 0xa7) & 0xff;
  const runtimeStringEntries = [
    'VM Integrity Violation at PC ',
    ', raw op: ',
    'Unknown VM function id: ',
    'Cannot read private member',
    '@@iterator',
  ];
  const runtimeStringIndex = new Map(runtimeStringEntries.map((value, index) => [value, index]));
  const encodedRuntimeStrings = runtimeStringEntries.map((value) => {
    let encoded = '';
    for (let i = 0; i < value.length; i++) {
      encoded += String.fromCharCode(value.charCodeAt(i) ^ ((runtimeStringKey + i) & 0xff));
    }
    return encoded;
  });
  const runtimeStringRef = (value: string) => {
    if (!concealRuntimeStrings) {
      return JSON.stringify(value);
    }
    const index = runtimeStringIndex.get(value);
    if (index === undefined) {
      throw new Error(`Missing runtime string entry: ${value}`);
    }
    return `${top.getRuntimeString}(${index})`;
  };
  const runtimeStringBootstrap = concealRuntimeStrings ? `
  const ${top.runtimeStrings} = ${JSON.stringify(encodedRuntimeStrings)};
  const ${top.runtimeStringCache} = Object.create(null);
  function ${top.getRuntimeString}(index) {
    if (${top.runtimeStringCache}[index] !== undefined) return ${top.runtimeStringCache}[index];
    var encoded = ${top.runtimeStrings}[index];
    var decoded = '';
    for (var i = 0; i < encoded.length; i++) {
      decoded += String.fromCharCode(encoded.charCodeAt(i) ^ ((${runtimeStringKey} + i) & 0xFF));
    }
    return ${top.runtimeStringCache}[index] = decoded;
  }
  function ${top.opaquePredicate}(value) {
    value = (value ^ 0x51ed) | 0;
    var steps = 0;
    var n = value;
    if (n < 0) n = -n;
    while (n > 1 && steps < 12) {
      if ((n & 1) === 0) {
        n = (n >>> 1) | 0;
      } else {
        n = (Math.imul(n, 3) + 1) | 0;
      }
      steps++;
    }
    return (n | 0) !== -9999;
  }
  function ${top.junkSink}(value) {
    var acc = value ^ ${config.seed};
    for (var i = 0; i < 3; i++) acc = ((acc << 5) - acc + i) | 0;
    return acc;
  }
  if (!${top.opaquePredicate}(${top.seed})) {
    ${top.junkSink}(${top.seed});
  }
  ` : '';

  function isVariableLengthOpcode(opcode: number): boolean {
    return (
      opcode === 0x40 || // OpCode.Call
      opcode === 0x41 || // OpCode.CallMethod
      opcode === 0x42 || // OpCode.New
      opcode === 0x54 || // OpCode.ArrayNew
      opcode === 0x55 || // OpCode.ObjectNew
      opcode === 0x56 || // OpCode.Spread
      opcode === 0x57 || // OpCode.SpreadIntoArray
      opcode === 0x5E    // OpCode.SuperCall
    );
  }

  const handlerDeclarations: string[] = [];
  const handlerNames = new Map<OpCode, string>();
  const declaredOpcodes: OpCode[] = [];
  const allHandlerVariants = new Map<OpCode, string[]>();

  const declareHandler = (canonical: OpCode, body: string) => {
    const isParanoid = config.runtimeHardening === 'paranoid' && canonical !== OpCode.Trap;
    const numVariants = isParanoid ? 2 : 1;
    const fnNames: string[] = [];

    for (let vIdx = 0; vIdx < numVariants; vIdx++) {
      const fnName = isParanoid 
        ? `${names.nextHandlerName(canonical)}_${vIdx}`
        : names.nextHandlerName(canonical);
      fnNames.push(fnName);

      // Randomize junk skip & junk statements per variant
      const mySeed = config.seed ^ canonical ^ vIdx;
      const myRng = new SeededRandom(mySeed);
      const numJunk = canonical % 3;
      let junkSkip = '';
      for (let i = 0; i < numJunk; i++) {
        junkSkip += `  let __junk_${vIdx}_${i} = ${top.readByte}(ctx);\n`;
      }

      // Read args
      const isVarLength = isVariableLengthOpcode(canonical);
      let myReadArgs = '';
      const argsVar = isParanoid ? `_args_${vIdx}` : 'args';
      const valVar = isParanoid ? `_val_${vIdx}` : 'val';
      const kindNumVar = isParanoid ? `_kind_${vIdx}` : 'kindNum';
      
      const myAdvanceArg = config.rollingKeys ? `
        let ${kindNumVar} = ${top.readByte}(ctx);
        let ${valVar} = 0;
        ${config.immediateEncoding === ImmediateEncodingScheme.VariableLength ? `
          let shift = 0;
          let b;
          do {
            b = ${top.readByte}(ctx);
            ${valVar} |= (b & 0x7F) << shift;
            shift += 7;
          } while (b & 0x80);
        ` : `
          let b0 = ${top.readByte}(ctx);
          let b1 = ${top.readByte}(ctx);
          let b2 = ${top.readByte}(ctx);
          let b3 = ${top.readByte}(ctx);
          ${valVar} = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
        `}
      ` : `
        let ${kindNumVar} = ${top.readByte}(ctx);
        let ${valVar} = 0;
        ${config.immediateEncoding === ImmediateEncodingScheme.VariableLength ? `
          let shift = 0;
          let b;
          do {
            b = ${top.readByte}(ctx);
            ${valVar} |= (b & 0x7F) << shift;
            shift += 7;
          } while (b & 0x80);
        ` : `
          let b0 = ${top.readByte}(ctx);
          let b1 = ${top.readByte}(ctx);
          let b2 = ${top.readByte}(ctx);
          let b3 = ${top.readByte}(ctx);
          ${valVar} = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
        `}
      `;

      if (isVarLength) {
        myReadArgs = `
          let argCount = ${top.readByte}(ctx);
          const ${argsVar} = [];
          for (let i = 0; i < argCount; i++) {
            ${myAdvanceArg}
            ${argsVar}.push(${valVar});
          }
        `;
      } else {
        const matches = body.match(/args\[(\d+)\]/g);
        let operandCount = 0;
        if (matches) {
          for (const m of matches) {
            const idx = parseInt(m.match(/\d+/)![0], 10);
            if (idx + 1 > operandCount) {
              operandCount = idx + 1;
            }
          }
        }
        myReadArgs = `
          const ${argsVar} = [];
          for (let i = 0; i < ${operandCount}; i++) {
            ${myAdvanceArg}
            ${argsVar}.push(${valVar});
          }
        `;
      }

      const junkLogic = config.stealthDispatch ? generateJunkStatements(mySeed, canonical) : '';
      
      // Threaded VM dispatch
      let nextOpLogic = '';
      if (canonical !== OpCode.Halt && canonical !== OpCode.Return && canonical !== OpCode.ReturnVoid && canonical !== OpCode.Throw && canonical !== OpCode.Trap && canonical !== OpCode.Await && canonical !== OpCode.Yield && canonical !== OpCode.YieldStar) {
        if (config.runtimeHardening === 'paranoid') {
          nextOpLogic = `
            if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) return null;
            let nextOp = ${top.readByte}(ctx);
            return makeRouteToken(ctx, nextOp);
          `;
        } else {
          nextOpLogic = `
            if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) return null;
            let nextOp = ${top.readByte}(ctx);
            return ${locals.dispatchBank}[nextOp];
          `;
        }
      } else {
        nextOpLogic = `return null;`;
      }

      // Replace args with our variant-specific args variable in the body
      let variantBody = body.replace(/\${readArgs}/g, () => myReadArgs);
      if (isParanoid) {
        variantBody = variantBody.replace(/\bargs\b/g, argsVar);
        // also replace array accesses if any remain
        variantBody = variantBody.replace(/args\[/g, `${argsVar}[`);
      }

      // track current opcode in paranoid
      let currentOpcodeTracker = '';
      if (config.runtimeHardening === 'paranoid') {
        currentOpcodeTracker = `ctx.currentOpcode = ${canonical};\n`;
      }

      handlerDeclarations.push(`function ${fnName}(ctx) {\n${currentOpcodeTracker}${junkSkip}\n${junkLogic}\n${variantBody}\n${nextOpLogic}\n}`);
    }

    declaredOpcodes.push(canonical);
    handlerNames.set(canonical, fnNames[0]!);
    allHandlerVariants.set(canonical, fnNames);
  };

  const readArgs = '${readArgs}';

  declareHandler(OpCode.Trap, `
    ctx.regs = [];
    ctx.pc = 999999;
    ctx.running = false;
    debugger;
    throw new Error(${runtimeStringRef('VM Integrity Violation at PC ')} + (${ctxRef('pc')} - 1));
  `);

  declareHandler(OpCode.LoadConst, `
    ${readArgs}
    ${regRef('args[1]')} = ${top.getCP}(args[0]);
  `);
  declareHandler(OpCode.LoadLocal, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.StoreLocal, `${readArgs} ctx.regs[args[0]] = ctx.regs[args[1]];`);
  declareHandler(OpCode.Move, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.LoadGlobal, `
    ${readArgs}
    var propName = ctx.regs[args[0]];
    ${regRef('args[1]')} = (typeof ${top.result} !== 'undefined' && ${top.result}[propName] !== undefined)
      ? ${top.result}[propName]
      : ${ctxRef('globalScope')}[propName];
  `);
  declareHandler(OpCode.StoreGlobal, `
    ${readArgs}
    var propName = ctx.regs[args[0]];
    ${ctxRef('globalScope')}[propName] = ${regRef('args[1]')};
  `);
  declareHandler(OpCode.LoadThis, `${readArgs} ${regRef('args[0]')} = ${ctxRef('thisArg')};`);
  declareHandler(OpCode.LoadNewTarget, `${readArgs} ${regRef('args[0]')} = ${ctxRef('newTarget')};`);
  
  const addExpr = `(typeof ctx.regs[args[0]] === 'string' || typeof ctx.regs[args[1]] === 'string') ? (ctx.regs[args[0]] + ctx.regs[args[1]]) : ${mutateArithmeticExpression('add', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', config.seed)}`;
  declareHandler(OpCode.Add, `${readArgs} ctx.regs[args[2]] = ${addExpr};`);
  const subExpr = `(typeof ctx.regs[args[0]] === 'number' && typeof ctx.regs[args[1]] === 'number') ? ${mutateArithmeticExpression('sub', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', config.seed)} : (ctx.regs[args[0]] - ctx.regs[args[1]])`;
  declareHandler(OpCode.Sub, `${readArgs} ctx.regs[args[2]] = ${subExpr};`);
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
  declareHandler(OpCode.In, `${readArgs} ctx.regs[args[2]] = ctx.regs[args[0]] in ctx.regs[args[1]];`);
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
  
  declareHandler(OpCode.Jmp, `${readArgs} ${ctxRef('pc')} = args[0];`);
  declareHandler(OpCode.JmpIf, `${readArgs} ${ctxRef('pc')} = ${regRef('args[0]')} ? args[1] : args[2];`);
  declareHandler(OpCode.JmpIfNot, `${readArgs} ${ctxRef('pc')} = !${regRef('args[0]')} ? args[1] : args[2];`);
  
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
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
    if (!p || !(key in p)) throw new TypeError(${runtimeStringRef('Cannot read private member')});
    ctx.regs[args[2]] = p[key];
  `);
  declareHandler(OpCode.PrivateSet, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
    if (!p) { p = {}; ${top.weakMapSet}.call(${top.privateData}, obj, p); }
    p[key] = ctx.regs[args[2]];
  `);
  declareHandler(OpCode.PrivateIn, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
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
    // Anti-Debug DevTools & Trace Protection (Self-Destruct Trap)
    var _dbg_start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    debugger;
    var _dbg_end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'} && _dbg_end - _dbg_start > 100) { 
       selfDestruct(ctx);
    }
    // Opaque getter trap to detect automated inspect / DevTools formatting
    var _rTrap = /./;
    Object.defineProperty(_rTrap, 'source', {
      get: function() {
        selfDestruct(ctx);
        return 'trap';
      }
    });
  ` : '';

  const tamperDetectionLogic = config.tamperDetection ? `
    // Premium JS-Confuser-inspired native intrinsics verification
    var _isNative = function(fn) {
      try { 
        var s = ${top.nativeToString}.call(fn);
        return /^\\s*function\\s*[a-zA-Z0-9_$]*\\s*\\(\\s*\\)\\s*\\{\\s*\\[native code\\]\\s*\\}\\s*$/.test(s) || 
               (s.indexOf('[native code]') !== -1 && s.indexOf('function') !== -1);
      }
      catch (_) { return false; }
    };
    var fnStr = ${top.nativeToString}.call(__runVm);
    var hasDbg = 0;
    for (var i = 0; i < fnStr.length - 7; i++) {
       if (fnStr.charCodeAt(i) === 100 && fnStr.charCodeAt(i+1) === 101 && fnStr.charCodeAt(i+2) === 98 && fnStr.charCodeAt(i+3) === 117) {
           hasDbg = 1; break;
       }
    }
    
    // Intrinsic verification for descriptor descriptors and identity
    var verifyIntrinsic = function(obj, prop, expectedNative) {
      if (!obj || !prop) return false;
      var desc = Object.getOwnPropertyDescriptor(obj, prop);
      if (!desc) return false;
      if (expectedNative && !_isNative(desc.value || desc.get)) return false;
      return true;
    };

    // Active hook probes: call native methods on controlled inputs and verify expected behavior
    var probeActive = function() {
      try {
        var map = new WeakMap();
        var key = {};
        map.set(key, 42);
        if (map.get(key) !== 42) return false;
        var sliceRes = Array.prototype.slice.call([1, 2], 1);
        if (!sliceRes || sliceRes[0] !== 2 || sliceRes.length !== 1) return false;
        return true;
      } catch (_) { return false; }
    };

    if (
      (!hasDbg && ${config.antiDebug}) || 
      fnStr.length < 50 || 
      !_isNative(${top.nativeMathSin}) ||
      !_isNative(${top.weakMapGet}) ||
      !_isNative(${top.weakMapSet}) ||
      !_isNative(${top.nativeToString}) ||
      !verifyIntrinsic(Function.prototype, 'toString', true) ||
      !verifyIntrinsic(Array.prototype, 'slice', true) ||
      !verifyIntrinsic(Object, 'defineProperty', true) ||
      !verifyIntrinsic(Promise, 'resolve', true) ||
      !verifyIntrinsic(Reflect, 'construct', true) ||
      !probeActive()
    ) {
      selfDestruct(ctx);
    }
  ` : '';

  const runtimeDispatch = (() => {
    const vOpToHandlerName = new Array(256);
    const trapFnName = handlerNames.get(OpCode.Trap)!;
    vOpToHandlerName.fill(trapFnName);

    for (const [canonical, mapped] of opToMapped.entries()) {
      const fnNames = allHandlerVariants.get(canonical);
      if (!fnNames) continue;
      for (const vOp of mapped) {
        if (vOp >= 0 && vOp < 256) {
          const varIdx = (vOp ^ config.seed) % fnNames.length;
          vOpToHandlerName[vOp] = fnNames[varIdx];
        }
      }
    }

    return {
      declarations: `const ${locals.dispatchBank} = [\n    ${vOpToHandlerName.join(',\n    ')}\n  ];`,
      invoke: `${locals.dispatchBank}[${locals.opByte}](ctx);`,
    };
  })();

  const allBytecodes: number[] = [];
  const functionTable: { [id: string]: { o: number; l: number; a: string[]; r: number; s: number } } = {};
  let currentOffset = 0;

  for (const fn of module.functions) {
    const fnSalt = buildRng.nextRange(1, 0xFFFFFFFF);
    functionTable[fn.id] = {
      o: currentOffset,
      l: fn.bytecode.length,
      a: fn.attributes ? [...fn.attributes] : [],
      r: fn.maxRegisters,
      s: fnSalt
    };
    allBytecodes.push(...fn.bytecode);
    currentOffset += fn.bytecode.length;
  }

  const arenaArray = allBytecodes.join(',');
  const fnTableStr = Object.entries(functionTable).map(([id, info]) => {
    return `'${id}': { o: ${info.o}, l: ${info.l}, a: ${JSON.stringify(info.a)}, r: ${info.r}, s: ${info.s} }`;
  }).join(',\n    ');

  const handlerVariantsEntries = Array.from(allHandlerVariants.entries()).map(([canonical, names]) => {
    return `[${canonical}]: [${names.join(', ')}]`;
  }).join(',\n    ');
  const handlerVariantsStr = `const handlerVariants = {\n    ${handlerVariantsEntries}\n  };`;

  const sourceCode = `
// Polymorphic Threaded VM Engine - Build: ${module.buildId}
const ${top.vmFunctions} = (function() {
  const ${top.seed} = ${config.seed};
  const ${top.rawCP} = ${cp};
  const ${top.weakMapCtor} = WeakMap;
  const ${top.weakMapGet} = ${top.weakMapCtor}.prototype.get;
  const ${top.weakMapSet} = ${top.weakMapCtor}.prototype.set;
  const ${top.reflectObj} = typeof Reflect !== 'undefined' ? Reflect : undefined;
  const ${top.objectObj} = Object;
  const ${top.nativeToString} = Function.prototype.toString;
  const ${top.nativeMathSin} = Math.sin;
  const ${top.arraySlice} = Array.prototype.slice;
  const ${top.promiseResolve} = Promise.resolve.bind(Promise);
  const ${top.iteratorSymbol} = typeof Symbol !== 'undefined' ? Symbol.iterator : '@@iterator';
  const ${top.asyncIteratorSymbol} = typeof Symbol !== 'undefined' && Symbol.asyncIterator ? Symbol.asyncIterator : null;
  const ${top.privateData} = new ${top.weakMapCtor}();
  let executionCounter = 0;

  function selfDestruct(ctx) {
    ctx.${ctx.regs} = [];
    ctx.${ctx.pc} = 999999;
    ctx.${ctx.running} = false;
    if (ctx.${ctx.bytecode}) {
      for (var i = 0; i < ctx.${ctx.bytecode}.length; i++) {
        ctx.${ctx.bytecode}[i] = 0;
      }
    }
    if (ctx.${ctx.xorLog}) {
      for (var i = 0; i < ctx.${ctx.xorLog}.length; i++) {
        ctx.${ctx.xorLog}[i] = 0;
      }
    }
    ctx.${ctx.env} = [];
    ctx.${ctx.tryFrames} = [];
    ctx.${ctx.returnValue} = undefined;
    ctx.${ctx.globalScope} = {};
    throw new Error('VM Integrity Violation');
  }

  ${runtimeStringBootstrap}
  
  // Lazy Decryption
  function ${top.getCP}(index) {
    var c = ${top.rawCP}[index];
    if (!c) return undefined;
    if (c.kind === 'string' && ${config.constantPoolEncoding === ConstantEncodingScheme.XorRotate}) {
      var val = c.value;
      var decoded = '';
      var stringSeed = (${top.seed} ^ (index * 0x9E3779B9)) | 0;
      
      // Deriving 16-byte key using LCG
      var keyBytes = [];
      var s = stringSeed;
      for (var i = 0; i < 16; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) | 0;
        keyBytes.push((s >>> 16) & 0xff);
      }
      
      // KSA
      var S = [];
      for (var i = 0; i < 256; i++) S.push(i);
      var j = 0;
      for (var i = 0; i < 256; i++) {
        j = (j + S[i] + keyBytes[i % 16]) & 0xff;
        var temp = S[i];
        S[i] = S[j];
        S[j] = temp;
      }
      
      // PRGA with drop-256
      var ri = 0;
      j = 0;
      for (var skip = 0; skip < 256; skip++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]) & 0xff;
        var temp = S[ri];
        S[ri] = S[j];
        S[j] = temp;
      }
      
      for (var i = 0; i < val.length; i++) {
        ri = (ri + 1) & 0xff;
        j = (j + S[ri]) & 0xff;
        var temp = S[ri];
        S[ri] = S[j];
        S[j] = temp;
        var keystreamByte = S[(S[ri] + S[j]) & 0xff];
        decoded += String.fromCharCode(val.charCodeAt(i) ^ keystreamByte);
      }
      
      return decoded;
    }
    return c.kind === 'undefined' ? undefined : c.value;
  }

  function mixRollingState(ctx, pos, decoded) {
    var salt = ctx.salt || 0;
    var nonce = ctx.executionNonce || 0;
    var op = ctx.currentOpcode || 0;
    var mixed = (pos ^ decoded ^ op ^ salt ^ nonce) & 0xFF;
    ctx.${ctx.rollingState} = (Math.imul(ctx.${ctx.rollingState} ^ mixed, 1664525) + 1013904223) | 0;
  }

  function corruptByteNear(ctx, at, mask) {
    if (at >= 0 && at < ctx.bytecode.length) {
      ctx.bytecode[at] ^= mask;
      ctx.${ctx.xorLog}[at] ^= mask;
    }
  }

  function makeRouteToken(ctx, nextOp) {
    return (nextOp ^ ctx.${ctx.rollingState}) & 0xFFFF;
  }

  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    return ${locals.dispatchBank}[nextOp];
  }

  function ${top.readByte}(ctx) {
    var pos = ${ctxRef('pc')}++;
    if (pos >= ${ctxRef('bytecode')}.length) return 0;
    var byte = ${ctxRef('bytecode')}[pos];
    ${config.rollingKeys ? `
      byte ^= ${ctxRef('xorLog')}[pos];
      var decoded = byte ^ ((${top.seed} ^ pos) & 0xFF);
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
        mixRollingState(ctx, pos, decoded);
      } else {
        ctx.${ctx.rollingState} = (Math.imul(ctx.${ctx.rollingState}, 1664525) + 1013904223) | 0;
      }
      var mask = ((ctx.${ctx.rollingState} >>> 16) & 0xFF) | 1;
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
        corruptByteNear(ctx, pos, mask);
        corruptByteNear(ctx, pos - 1, (mask * 3) & 0xFF);
        corruptByteNear(ctx, pos + 1, (mask * 7) & 0xFF);
        var stride = ((ctx.${ctx.rollingState} >>> 8) & 3) + 2;
        corruptByteNear(ctx, pos + stride, (mask * 13) & 0xFF);
      } else {
        ctx.${ctx.bytecode}[pos] ^= mask;
        ctx.${ctx.xorLog}[pos] ^= mask;
      }
      return decoded;
    ` : `
      return byte;
    `}
  }

  ${handlerDeclarations.join('\n\n')}

  ${handlerVariantsStr}

  ${runtimeDispatch.declarations}

  const ${top.functionArena} = new Uint8Array([${arenaArray}]);
  const ${top.functionBytecodes} = {
    ${fnTableStr}
  };
  const ${top.executorCache} = Object.create(null);

  function ${top.getExecutorById}(functionId, env) {
    if ((!env || env.length === 0) && ${top.executorCache}[functionId]) {
      return ${top.executorCache}[functionId];
    }
    const functionMeta = ${top.functionBytecodes}[functionId];
    if (!functionMeta) {
      throw new Error(${runtimeStringRef('Unknown VM function id: ')} + functionId);
    }
    const bytecodeSegment = ${top.functionArena}.subarray(functionMeta.o, functionMeta.o + functionMeta.l);
    const executor = ${top.createExecutor}(bytecodeSegment, env || [], functionMeta.a || [], functionMeta.r || 0, functionMeta.s || 0);
    if (!env || env.length === 0) {
      ${top.executorCache}[functionId] = executor;
    }
    return executor;
  }

  function __createVmContext(bytecodeArr, envArr, thisArg, newTarget, argsArr, registerCount, salt) {
    const ctx = {
      ${ctx.pc}: 0,
      ${ctx.bytecode}: ${config.rollingKeys ? 'Uint8Array.from(bytecodeArr)' : 'bytecodeArr'},
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
      ${ctx.rollingState}: ${config.rollingKeys ? `${top.seed} & 0xFF` : '0'},
      ${ctx.xorLog}: ${config.rollingKeys ? `new Uint8Array(bytecodeArr.length)` : 'null'},
      ${ctx.executionNonce}: ${config.rollingKeys ? `(++executionCounter)` : '0'},
      salt: ${config.rollingKeys ? 'salt' : '0'},
      currentOpcode: 0
    };
    for (let i = 0; i < argsArr.length; i++) {
      ${regRef('i')} = argsArr[i];
    }
    return ctx;
  }

  function __runVm(ctx) {
    ${antiDebugLogic}
    ${tamperDetectionLogic}
    if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) return { kind: 'return', value: ${ctxRef('returnValue')} };
    let ${locals.opByte} = ${top.readByte}(ctx);
    let handler = ${locals.dispatchBank}[${locals.opByte}];
    
    while(handler && ${ctxRef('running')}) {
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
        
        if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
          handler = resolveRoute(ctx, handler(ctx));
        } else {
          handler = handler(ctx);
        }
      } catch (error) {
        if (${ctxRef('tryFrames')}.length === 0) {
          throw error;
        }
        const handlerFrame = ${ctxRef('tryFrames')}.pop();
        ${regRef(frameRef('handlerFrame', 'exceptionReg'))} = error;
        ${ctxRef('running')} = true;
        ${ctxRef('pc')} = ${frameRef('handlerFrame', 'catchPc')};
        
        if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) {
          handler = null;
        } else {
          let nextOp = ${top.readByte}(ctx);
          if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
            handler = resolveRoute(ctx, makeRouteToken(ctx, nextOp));
          } else {
            handler = ${locals.dispatchBank}[nextOp];
          }
        }
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

  function ${top.createExecutor}(bytecodeArr, envArr, attributes, registerCount, salt) {
    const isAsync = attributes && attributes.indexOf('async') >= 0;
    const isGenerator = attributes && attributes.indexOf('generator') >= 0;
    if (isAsync && isGenerator) {
      return function execute() {
        const ${ctx.fnArgs} = ${top.arraySlice}.call(arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt);
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
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt);
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
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt);
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
      const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt);
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
