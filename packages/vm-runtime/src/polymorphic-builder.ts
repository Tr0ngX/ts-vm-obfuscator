import type { BytecodeModule, VMBuildConfig, VMRuntimeBundle } from '@tsvm/shared';
import { OpCode, ConstantEncodingScheme, ImmediateEncodingScheme, SeededRandom, isVariableLengthOpcode, isTerminator } from '@tsvm/shared';

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

function materializeConstant(value: number, seed: number): string {
  const rng = new SeededRandom(seed ^ value ^ 0x1f8e9a);
  const offset = rng.nextRange(1000, 99999);
  const choice = rng.nextRange(0, 3);
  switch (choice) {
    case 0:
      return `(((${value - offset}) + ${offset}) | 0)`;
    case 1:
      return `(((${value ^ offset}) ^ ${offset}) | 0)`;
    default:
      return `(((${value + offset}) - ${offset}) | 0)`;
  }
}

function mutateArithmeticExpression(op: 'add' | 'sub' | 'and' | 'or' | 'xor', a: string, b: string, seed: number): string {
  const rng = new SeededRandom(seed ^ 0x93b2a5);
  const choice = rng.nextRange(0, 9);

  let expr = '';
  if (op === 'add') {
    // All verified: a+b identity variants
    switch (choice) {
      case 0:
        expr = `(((${a}) ^ (${b})) + 2 * ((${a}) & (${b})))`;
        break; // a+b = (a^b) + 2*(a&b)
      case 1:
        expr = `(((${a}) | (${b})) + ((${a}) & (${b})))`;
        break; // a+b = (a|b) + (a&b)
      case 2:
        expr = `(2 * ((${a}) | (${b})) - ((${a}) ^ (${b})))`;
        break; // a+b = 2*(a|b) - (a^b)
      case 3:
        expr = `(((${a}) ^ ~(${b})) + 2 * ((${a}) | (${b})) + 1)`;
        break; // a+b = (a^~b) + 2*(a|b) + 1
      case 4:
        expr = `(((${a}) - (-(${b}))))`;
        break; // a+b = a - (-b)
      case 5:
        expr = `(((${a}) - ~(${b})) - 1)`;
        break; // a+b = a - ~b - 1, since ~b = -(b+1)
      case 6:
        expr = `(~(~(${a}) - (${b})))`;
        break; // a+b = ~(~a - b), since ~(~a-b) = a+b
      case 7:
        expr = `((((${a}) + (${b})) | 0))`;
        break; // a+b with int coercion
      case 8:
        expr = `((${a}) * 2 - (${a}) + (${b}))`;
        break; // 2a - a + b = a + b
      default:
        expr = `((${a}) + (${b}))`;
        break;
    }
  } else if (op === 'sub') {
    // All verified: a-b identity variants
    switch (choice) {
      case 0:
        expr = `(((${a}) ^ ~(${b})) + 2 * ((${a}) & ~(${b})) + 1)`;
        break; // a-b via complement add
      case 1:
        expr = `(((${a}) & ~(${b})) - (~(${a}) & (${b})))`;
        break; // a-b = (a&~b) - (~a&b)
      case 2:
        expr = `(((${a}) | ~(${b})) - (~(${a}) | (${b})))`;
        break; // a-b via complement or
      case 3:
        expr = `(((${a}) ^ (${b})) - 2 * (~(${a}) & (${b})))`;
        break; // a-b = (a^b) - 2*(~a&b)
      case 4:
        expr = `((${a}) + (-(${b})))`;
        break; // a-b = a + (-b)
      case 5:
        expr = `(~((${b}) - (${a}) - 1))`;
        break; // a-b = ~(b-a-1), since ~x = -(x+1)
      case 6:
        expr = `((${a}) + (~(${b})) + 1)`;
        break; // a-b = a + ~b + 1 (two's complement)
      case 7:
        expr = `(((${a}) | 0) - ((${b}) | 0))`;
        break; // a-b with int coercion
      case 8:
        expr = `(~(~(${a}) + (${b})))`;
        break; // a-b = ~(~a+b), since ~(~a+b) = -(~a+b+1) = a-b
      default:
        expr = `((${a}) - (${b}))`;
        break;
    }
  } else if (op === 'and') {
    // All verified: a&b identity variants
    switch (choice) {
      case 0:
        expr = `(((${a}) | (${b})) - ((${a}) ^ (${b})))`;
        break; // a&b = (a|b) - (a^b)
      case 1:
        expr = `((((${a}) + (${b})) - ((${a}) ^ (${b}))) >> 1)`;
        break; // a&b = ((a+b) - (a^b)) / 2
      case 2:
        expr = `(~(~(${a}) | ~(${b})))`;
        break; // De Morgan: a&b = ~(~a|~b)
      case 3:
        expr = `((${a}) & (${b}))`;
        break; // identity
      case 4:
        expr = `(((${a}) | (${b})) & ~((${a}) ^ (${b})))`;
        break; // a&b = (a|b) & ~(a^b)
      case 5:
        expr = `(((${a}) + (${b}) - ((${a}) | (${b}))))`;
        break; // a&b = a+b - (a|b)
      case 6:
        expr = `((${a}) - ((${a}) & ~(${b})))`;
        break; // a&b = a - (a&~b)
      case 7:
        expr = `((${b}) - (~(${a}) & (${b})))`;
        break; // a&b = b - (~a&b)
      case 8:
        expr = `((${a}) ^ ((${a}) ^ ((${a}) & (${b}))))`;
        break; // a ^ a ^ (a&b) = a&b
      default:
        expr = `((${a}) & (${b}))`;
        break;
    }
  } else if (op === 'or') {
    // All verified: a|b identity variants
    switch (choice) {
      case 0:
        expr = `(((${a}) & (${b})) + ((${a}) ^ (${b})))`;
        break; // a|b = (a&b) + (a^b)
      case 1:
        expr = `(((${a}) ^ (${b})) | ((${a}) & (${b})))`;
        break; // a|b = (a^b) | (a&b) (disjoint)
      case 2:
        expr = `(~(~(${a}) & ~(${b})))`;
        break; // De Morgan: a|b = ~(~a&~b)
      case 3:
        expr = `((${a}) | (${b}))`;
        break; // identity
      case 4:
        expr = `(((${a}) + (${b})) - ((${a}) & (${b})))`;
        break; // a|b = a+b - (a&b)
      case 5:
        expr = `(((${a}) ^ (${b})) + ((${a}) & (${b})))`;
        break; // a|b = (a^b) + (a&b) (same as case 0)
      case 6:
        expr = `((${a}) + ((${b}) & ~(${a})))`;
        break; // a|b = a + (b&~a)
      case 7:
        expr = `((${b}) + ((${a}) & ~(${b})))`;
        break; // a|b = b + (a&~b)
      case 8:
        expr = `((${a}) ^ ((${a}) ^ ((${a}) | (${b}))))`;
        break; // a ^ a ^ (a|b) = a|b
      default:
        expr = `((${a}) | (${b}))`;
        break;
    }
  } else {
    // XOR: All verified via bit-level truth tables
    switch (choice) {
      case 0:
        expr = `(((${a}) | (${b})) - ((${a}) & (${b})))`;
        break; // a^b = (a|b) - (a&b)
      case 1:
        expr = `(((${a}) + (${b})) - 2 * ((${a}) & (${b})))`;
        break; // a^b = a+b - 2*(a&b)
      case 2:
        expr = `(~(((${a}) | ~(${b})) & (~(${a}) | (${b}))))`;
        break; // FIX: ~XNOR = XOR
      case 3:
        expr = `((${a}) ^ (${b}))`;
        break; // identity
      case 4:
        expr = `(~(${a}) ^ ~(${b}))`;
        break; // ~a ^ ~b = a ^ b
      case 5:
        expr = `(2 * ((${a}) | (${b})) - (${a}) - (${b}))`;
        break; // 2*(a|b) - a - b = a^b
      case 6:
        expr = `(((${a}) | (${b})) ^ ((${a}) & (${b})))`;
        break; // (a|b) ^ (a&b) = a^b
      case 7:
        expr = `((~(${a}) & (${b})) | ((${a}) & ~(${b})))`;
        break; // textbook XOR definition
      case 8:
        expr = `((${a}) - (${b}) + 2 * (~(${a}) & (${b})))`;
        break; // a^b = (a-b) + 2*(~a&b)
      default:
        expr = `((${a}) ^ (${b}))`;
        break;
    }
  }

  if (op === 'and' || op === 'or' || op === 'xor') {
    return `((${expr}) | 0)`;
  }
  return expr;
}

/**
 * Generates opaque predicates — expressions that always evaluate to a known
 * boolean value but are hard for symbolic execution to prove statically.
 * Uses number-theoretic invariants that hold for all integers.
 */
function generateOpaquePredicate(seed: number, varIdx: number): { expr: string; alwaysTrue: boolean } {
  const rng = new SeededRandom(seed ^ varIdx ^ 0xdead);
  const choice = rng.nextRange(0, 7);
  // Local variable name to avoid collisions
  const pVar = `_op${rng.nextRange(100, 999)}`;
  // Use a runtime value that's always available (pc is always a non-negative integer)
  const runtimeVal = 'ctx.pc';

  switch (choice) {
    case 0:
      return {
        expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return (${pVar} * ${pVar} + ${pVar}) % 2 === 0; })()`,
        alwaysTrue: true,
      };
    case 1:
      return { expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return (${pVar} * ${pVar}) % 4 !== 2; })()`, alwaysTrue: true };
    case 2:
      return {
        expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return (${pVar} | (${pVar} - 1)) >= (${pVar} - 1); })()`,
        alwaysTrue: true,
      };
    case 3:
      return { expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return (${pVar} * ${pVar}) >= 0; })()`, alwaysTrue: true };
    case 4:
      return {
        expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return ((${pVar} & 1) + ((${pVar} >> 1) & 1)) < 3; })()`,
        alwaysTrue: true,
      };
    case 5:
      return { expr: `(function(){ var ${pVar} = (${runtimeVal} & 255); return (${pVar} * ${pVar} & 3) !== 3; })()`, alwaysTrue: true };
    case 6:
      return {
        expr: `(function(){ var ${pVar} = (${runtimeVal} & 255) * 31; return (${pVar} * ${pVar}) % 3 !== 2; })()`,
        alwaysTrue: true,
      };
    default:
      return { expr: `(function(){ var ${pVar} = ${runtimeVal} | 0; return (${pVar} | 0) === ${pVar}; })()`, alwaysTrue: true };
  }
}

/**
 * Generates fake handler body code that mimics real register operations
 * but is guarded by an opaque predicate that ensures it never executes.
 * This forces symbolic execution engines to explore dead branches.
 */
function generateOpaqueDeadCode(seed: number, varIdx: number, regAlias: string, ctx: any): string {
  const rng = new SeededRandom(seed ^ varIdx ^ 0xcafe);
  const numBlocks = rng.nextRange(1, 2);
  let code = '';

  for (let i = 0; i < numBlocks; i++) {
    const pred = generateOpaquePredicate(seed ^ i, varIdx);
    const fakeReg1 = rng.nextRange(0, 15);
    const fakeReg2 = rng.nextRange(0, 15);
    const fakeConst = rng.nextRange(1, 255);
    const trapVar = `_dt${rng.nextRange(100, 999)}`;

    // The predicate is always true, so we negate it for the dead block
    // Dead code mimics real handler logic to confuse pattern analysis
    code += [
      `  if (!${pred.expr}) {\n`,
      `    var ${trapVar} = ${regAlias}[${fakeReg1}];\n`,
      `    ${regAlias}[${fakeReg2}] = ${trapVar} ^ ${fakeConst};\n`,
      `    ctx.${ctx.rollingState} = (ctx.${ctx.rollingState} ^ ${trapVar}) | 0;\n`,
      '  }\n',
    ].join('');
  }

  return code;
}

/**
 * Generates handler signature pollution — unique dead variable declarations
 * and fake computations that make each handler variant structurally unique.
 * This defeats signature-based handler matching across builds.
 */
function generateSignaturePollution(seed: number, varIdx: number): string {
  const rng = new SeededRandom(seed ^ varIdx ^ 0xb0b0);
  const numDecls = rng.nextRange(2, 4);
  const parts: string[] = [];

  for (let i = 0; i < numDecls; i++) {
    const varName = `_sp${rng.nextRange(100, 999)}_${i}`;
    const choice = rng.nextRange(0, 3);
    switch (choice) {
      case 0:
        parts.push(`  var ${varName} = (${rng.nextRange(1, 0xffff)} ^ ctx.pc) | 0;\n`);
        break;
      case 1:
        parts.push(`  var ${varName} = (ctx.pc * ${rng.nextRange(2, 7)} + ${rng.nextRange(1, 100)}) & 0xFF;\n`);
        break;
      case 2:
        parts.push(`  var ${varName} = ~(ctx.pc ^ ${rng.nextRange(1, 0xffff)}) >>> 0;\n`);
        break;
      default:
        parts.push(`  var ${varName} = ((ctx.pc >> ${rng.nextRange(1, 4)}) + ${rng.nextRange(1, 50)}) | 0;\n`);
        break;
    }
  }
  return parts.join('');
}

function generateJunkStatements(seed: number, id: number, names: any, mulConst = '1664525', addConst = '1013904223'): string {
  const rng = new SeededRandom(seed ^ id ^ 0x7c2a11);
  const numJunk = rng.nextRange(1, 3);
  const parts: string[] = [];
  const ctx = names.ctx;
  for (let i = 0; i < numJunk; i++) {
    const choice = rng.nextRange(0, 3);
    const varName = `_j${id}_${i}`;
    switch (choice) {
      case 0:
        parts.push(`  var ${varName} = (${seed} ^ ${rng.nextRange(10, 100)}) | 0;\n`);
        parts.push(`  ctx.${ctx.rollingState} = (Math.imul(ctx.${ctx.rollingState} ^ ${varName}, ${mulConst}) + ${addConst}) | 0;\n`);
        break;
      case 1:
        parts.push(`  var ${varName} = Math.sin(${rng.nextRange(1, 10)}) * ${rng.nextRange(2, 5)};\n`);
        parts.push(`  ctx.${ctx.rollingState} = (ctx.${ctx.rollingState} + (${varName} | 0)) & 0xFFFFFFFF;\n`);
        break;
      default:
        parts.push(`  var ${varName} = (${seed} % ${rng.nextRange(3, 9)}) | 0;\n`);
        parts.push(`  ctx.${ctx.rollingState} = (ctx.${ctx.rollingState} ^ (${varName} * ${varName})) | 0;\n`);
        break;
    }
  }
  return parts.join('');
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
        nativeDefineProperty: 'VMDefineProperty',
        nativeGetOwnPropertyDescriptor: 'VMGetOwnPropertyDescriptor',
        nativeApply: 'VMNativeApply',
        nativeCall: 'VMNativeCall',
        performanceNow: 'VMPerformanceNow',
        mathRandom: 'VMMathRandom',
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
        onDetection: 'onDetection',
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
        currentHandlerIdx: 'currentHandlerIdx',
        pathHash: 'pathHash',
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
      nativeDefineProperty: next(),
      nativeGetOwnPropertyDescriptor: next(),
      nativeApply: next(),
      nativeCall: next(),
      performanceNow: next(),
      mathRandom: next(),
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
      onDetection: next(),
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
      currentOpcode: next(),
      currentHandlerIdx: next(),
      pathHash: next(),
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
  const mulConst = materializeConstant(1664525, config.seed);
  const addConst = materializeConstant(1013904223, config.seed ^ 0x18ab3e);
  const seedConst = materializeConstant(config.seed, config.seed ^ 0x3e17ac);
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

  const exportedFunctions = module.functions.filter((f) => f.isEntryPoint);
  const hiddenAPIs = module.metadata?.hiddenAPIs ?? [];
  const apiXorKey = (config.seed ^ 0xbeefface) & 0xff || 0x5a;
  const encodedAPIs = hiddenAPIs.map((api) => {
    let enc = '';
    for (let i = 0; i < api.length; i++) {
      enc += String.fromCharCode(api.charCodeAt(i) ^ apiXorKey);
    }
    return enc;
  });
  const concealRuntimeStrings = !!config.stealthDispatch || !!config.tamperDetection || !!config.junkInsertion;
  const stringRng = new SeededRandom(config.seed ^ 0x3d7f19);
  const keyBytes: number[] = [];
  for (let i = 0; i < 16; i++) {
    keyBytes.push(stringRng.nextRange(1, 255));
  }
  const runtimeStringEntries = [
    'VM Integrity Violation at PC ',
    ', raw op: ',
    'Unknown VM function id: ',
    'Cannot read private member',
    '@@iterator',
  ];
  const runtimeStringIndex = new Map(runtimeStringEntries.map((value, index) => [value, index]));
  const encodedRuntimeStrings = runtimeStringEntries.map((value) => {
    const encodedParts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      const keyByte = keyBytes[i % 16]!;
      const nextKeyByte = keyBytes[(i + 1) % 16]!;
      encodedParts.push(String.fromCharCode(value.charCodeAt(i) ^ keyByte ^ nextKeyByte));
    }
    return encodedParts.join('');
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
  const runtimeStringBootstrap = concealRuntimeStrings
    ? `
  const ${top.runtimeStrings} = ${JSON.stringify(encodedRuntimeStrings)};
  const ${top.runtimeStringCache} = Object.create(null);
  const _strKey = ${JSON.stringify(keyBytes)};
  function ${top.getRuntimeString}(index) {
    if (${top.runtimeStringCache}[index] !== undefined) return ${top.runtimeStringCache}[index];
    var encoded = ${top.runtimeStrings}[index];
    var decoded = '';
    for (var i = 0; i < encoded.length; i++) {
      var keyByte = _strKey[i % 16];
      var nextKeyByte = _strKey[(i + 1) % 16];
      decoded += String.fromCharCode(encoded.charCodeAt(i) ^ keyByte ^ nextKeyByte);
    }
    return ${top.runtimeStringCache}[index] = decoded;
  }
  function ${top.opaquePredicate}(value) {
    if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
      var x = (((value & 0xFFFF) / 65536) * 2 - 1) || 0.1;
      var y = ((((value >>> 16) & 0xFFFF) / 65536) * 2 - 1) || 0.1;
      for (var i = 0; i < 8; i++) {
        var nextX = 1 - 1.4 * x * x + y;
        var nextY = 0.3 * x;
        x = nextX;
        y = nextY;
      }
      return x >= -2.0 && x <= 2.0 && y >= -0.6 && y <= 0.6;
    }
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
  `
    : '';

  const handlerDeclarations: string[] = [];
  const handlerNames = new Map<OpCode, string>();
  const declaredOpcodes: OpCode[] = [];
  const allHandlerVariants = new Map<OpCode, string[]>();

  const declareHandler = (canonical: OpCode, body: string) => {
    const isParanoid = config.runtimeHardening === 'paranoid' && canonical !== OpCode.Trap;
    // Semantic DNA: 4 variants in paranoid, 1 otherwise
    const numVariants = isParanoid ? 4 : 1;
    const fnNames: string[] = [];

    // Pre-compute operand count from handler body (single pass, not per-variant)
    const isVarLength = isVariableLengthOpcode(canonical);
    let operandCount = 0;
    if (!isVarLength) {
      const matches = body.match(/args\[(\d+)\]/g);
      if (matches) {
        for (const m of matches) {
          const idx = Number.parseInt(m.match(/\d+/)![0], 10);
          if (idx + 1 > operandCount) operandCount = idx + 1;
        }
      }
    }

    for (let vIdx = 0; vIdx < numVariants; vIdx++) {
      const fnName = isParanoid ? `${names.nextHandlerName(canonical)}_${vIdx}` : names.nextHandlerName(canonical);
      fnNames.push(fnName);

      // Randomize junk skip & junk statements per variant
      const mySeed = config.seed ^ canonical ^ vIdx;
      const myRng = new SeededRandom(mySeed);
      let junkSkip = '';
      if (config.junkInsertion) {
        const numJunk = (canonical * 7 + config.seed) % 4;
        for (let i = 0; i < numJunk; i++) {
          junkSkip += config.rollingKeys ? `  let __junk_${vIdx}_${i} = ${top.readByte}(ctx);\n` : '  ctx.pc++;\n';
        }
      }

      // Read args
      let myReadArgs = '';
      const argsVar = isParanoid ? `_args_${vIdx}` : 'args';
      const valVar = isParanoid ? `_val_${vIdx}` : 'val';
      const kindNumVar = isParanoid ? `_kind_${vIdx}` : 'kindNum';

      const myAdvanceArg = config.rollingKeys
        ? `
        let ${kindNumVar} = ${top.readByte}(ctx);
        let ${valVar} = 0;
        ${
          config.immediateEncoding === ImmediateEncodingScheme.VariableLength
            ? `
          let shift = 0;
          let b;
          do {
            b = ${top.readByte}(ctx);
            ${valVar} |= (b & 0x7F) << shift;
            shift += 7;
          } while (b & 0x80);
        `
            : `
          let b0 = ${top.readByte}(ctx);
          let b1 = ${top.readByte}(ctx);
          let b2 = ${top.readByte}(ctx);
          let b3 = ${top.readByte}(ctx);
          ${valVar} = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
        `
        }
      `
        : `
        let ${kindNumVar} = ctx.bytecode[ctx.pc++];
        let ${valVar} = 0;
        ${
          config.immediateEncoding === ImmediateEncodingScheme.VariableLength
            ? `
          let shift = 0;
          let b;
          do {
            b = ctx.bytecode[ctx.pc++];
            ${valVar} |= (b & 0x7F) << shift;
            shift += 7;
          } while (b & 0x80);
        `
            : `
          let b0 = ctx.bytecode[ctx.pc];
          let b1 = ctx.bytecode[ctx.pc + 1];
          let b2 = ctx.bytecode[ctx.pc + 2];
          let b3 = ctx.bytecode[ctx.pc + 3];
          ctx.pc += 4;
          ${valVar} = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
        `
        }
      `;

      if (isVarLength) {
        myReadArgs = `
          let argCount = ${config.rollingKeys ? `${top.readByte}(ctx)` : 'ctx.bytecode[ctx.pc++]'};
          const ${argsVar} = [];
          const kinds = [];
          for (let i = 0; i < argCount; i++) {
            ${myAdvanceArg}
            ${argsVar}.push(${valVar});
            kinds.push(${kindNumVar});
          }
        `;
      } else {
        myReadArgs = `
          const ${argsVar} = [];
          const kinds = [];
          for (let i = 0; i < ${operandCount}; i++) {
            ${myAdvanceArg}
            ${argsVar}.push(${valVar});
            kinds.push(${kindNumVar});
          }
        `;
      }

      const junkLogic = config.stealthDispatch ? generateJunkStatements(mySeed, canonical, names, mulConst, addConst) : '';

      // Threaded VM dispatch
      let nextOpLogic = '';
      if (
        canonical !== OpCode.Halt &&
        canonical !== OpCode.Return &&
        canonical !== OpCode.ReturnVoid &&
        canonical !== OpCode.Throw &&
        canonical !== OpCode.Trap &&
        canonical !== OpCode.Await &&
        canonical !== OpCode.Yield &&
        canonical !== OpCode.YieldStar
      ) {
        if (config.runtimeHardening === 'paranoid') {
          nextOpLogic = `
            if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) return null;
            let nextOp = ${top.readByte}(ctx);
            ${
              config.stealthDispatch
                ? `
              nextOp = (ctx.${ctx.currentHandlerIdx} + nextOp) % 256;
              ctx.${ctx.currentHandlerIdx} = nextOp;
            `
                : ''
            }
            ${
              config.rollingKeys
                ? `
              ctx.${ctx.pathHash} = (Math.imul(ctx.${ctx.pathHash}, 31) + nextOp) & 0xFFFFFFFF;
            `
                : ''
            }
            return makeRouteToken(ctx, nextOp);
          `;
        } else {
          nextOpLogic = `
            if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) return null;
            let nextOp = ${top.readByte}(ctx);
            ${
              config.stealthDispatch
                ? `
              nextOp = (ctx.${ctx.currentHandlerIdx} + nextOp) % 256;
              ctx.${ctx.currentHandlerIdx} = nextOp;
            `
                : ''
            }
            ${
              config.rollingKeys
                ? `
              ctx.${ctx.pathHash} = (Math.imul(ctx.${ctx.pathHash}, 31) + nextOp) & 0xFFFFFFFF;
            `
                : ''
            }
            return ${locals.dispatchBank}[nextOp];
          `;
        }
      } else {
        nextOpLogic = 'return null;';
      }

      // Replace args and evaluate semantic cloning markers (single pass)
      const markerMap: Record<string, () => string> = {
        '${readArgs}': () => myReadArgs,
        __ADD_EXPR__: () => mutateArithmeticExpression('add', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', mySeed),
        __SUB_EXPR__: () => mutateArithmeticExpression('sub', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', mySeed),
        __AND_EXPR__: () => mutateArithmeticExpression('and', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', mySeed),
        __OR_EXPR__: () => mutateArithmeticExpression('or', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', mySeed),
        __XOR_EXPR__: () => mutateArithmeticExpression('xor', 'ctx.regs[args[0]]', 'ctx.regs[args[1]]', mySeed),
      };
      let variantBody = body.replace(/\$\{readArgs\}|__ADD_EXPR__|__SUB_EXPR__|__AND_EXPR__|__OR_EXPR__|__XOR_EXPR__/g, (match) =>
        markerMap[match]!(),
      );

      if (isParanoid) {
        variantBody = variantBody.replace(/\bargs\b/g, argsVar);
        variantBody = variantBody.replace(/args\[/g, `${argsVar}[`);
      }

      // Register Alias Layer
      const regAlias = isParanoid ? `_r${myRng.nextRange(1000, 9999)}` : `ctx.${ctx.regs}`;
      const regSetup = isParanoid ? `  var ${regAlias} = ctx.${ctx.regs};\n` : '';
      if (isParanoid) {
        variantBody = variantBody.replace(/\bctx\.regs\[/g, `${regAlias}[`);
        variantBody = variantBody.replace(/\bctx\.regs\b/g, regAlias);
      }

      if (config.stealthDispatch && isTerminator(canonical)) {
        variantBody += `\nctx.${ctx.currentHandlerIdx} = 0;\n`;
      }

      // track current opcode in paranoid
      let currentOpcodeTracker = '';
      if (config.runtimeHardening === 'paranoid') {
        currentOpcodeTracker = `ctx.${ctx.currentOpcode} = ${canonical};\n`;
      }

      // Anti-analysis hardening layers (paranoid only)
      let opaqueDeadCode = '';
      let sigPollution = '';
      if (isParanoid) {
        // Opaque predicate network: dead branches with realistic register ops
        opaqueDeadCode = generateOpaqueDeadCode(mySeed, vIdx, regAlias, ctx);
        // Signature pollution: unique dead variable declarations per variant
        sigPollution = generateSignaturePollution(mySeed, vIdx);
      }

      handlerDeclarations.push(
        `function ${fnName}(ctx) {\n${currentOpcodeTracker}${junkSkip}\n${regSetup}${sigPollution}${junkLogic}\n${opaqueDeadCode}${variantBody}\n${nextOpLogic}\n}`,
      );
    }

    declaredOpcodes.push(canonical);
    handlerNames.set(canonical, fnNames[0]!);
    allHandlerVariants.set(canonical, fnNames);
  };

  const readArgs = '${readArgs}';

  declareHandler(
    OpCode.Trap,
    `
    ctx.regs = [];
    ctx.pc = 999999;
    ctx.running = false;
    debugger;
    throw new Error(${runtimeStringRef('VM Integrity Violation at PC ')} + (${ctxRef('pc')} - 1));
  `,
  );

  declareHandler(
    OpCode.LoadConst,
    `
    ${readArgs}
    ${regRef('args[1]')} = (kinds[0] === 2) ? ${top.getCP}(ctx, args[0]) : args[0];
  `,
  );
  declareHandler(OpCode.LoadLocal, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.StoreLocal, `${readArgs} ctx.regs[args[0]] = ctx.regs[args[1]];`);
  declareHandler(OpCode.Move, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(
    OpCode.LoadGlobal,
    `
    ${readArgs}
    var propName = ctx.regs[args[0]];
    if (propName === '__resolveAPI') {
      ${regRef('args[1]')} = __resolveAPI;
    } else {
      var globalVal = ${ctxRef('globalScope')}[propName];
      ${regRef('args[1]')} = (typeof ${top.result} !== 'undefined' && ${top.result}[propName] !== undefined)
        ? ${top.result}[propName]
        : globalVal;
    }
  `,
  );
  declareHandler(
    OpCode.StoreGlobal,
    `
    ${readArgs}
    var propName = ctx.regs[args[0]];
    ${ctxRef('globalScope')}[propName] = ${regRef('args[1]')};
  `,
  );
  declareHandler(OpCode.LoadThis, `${readArgs} ${regRef('args[0]')} = ${ctxRef('thisArg')};`);
  declareHandler(OpCode.LoadNewTarget, `${readArgs} ${regRef('args[0]')} = ${ctxRef('newTarget')};`);

  declareHandler(
    OpCode.Add,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      if (typeof a === 'string' || typeof b === 'string') {
        ctx.regs[args[2]] = a + b;
      } else {
        var T = ctx.integrityState ^ 0x7F;
        ctx.regs[args[2]] = a + b + T * 1e-7 * (a - b);
      }
    }`,
  );
  declareHandler(
    OpCode.Sub,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      if (typeof a === 'number' && typeof b === 'number') {
        var T = ctx.integrityState ^ 0x7F;
        ctx.regs[args[2]] = (__SUB_EXPR__) - T * 1e-7 * (a + b);
      } else {
        ctx.regs[args[2]] = a - b;
      }
    }`,
  );
  declareHandler(
    OpCode.Mul,
    `${readArgs} {
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = ctx.regs[args[0]] * ctx.regs[args[1]] * (1 + T * 1e-8);
    }`,
  );
  declareHandler(
    OpCode.Div,
    `${readArgs} {
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = ctx.regs[args[0]] / (ctx.regs[args[1]] * (1 + T * 1e-8));
    }`,
  );
  declareHandler(
    OpCode.Mod,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (Number.isInteger(a) && Number.isInteger(b)) 
        ? ((a % (b + (T & 1))) | 0) 
        : (a % (b + T * 1e-7));
    }`,
  );
  declareHandler(OpCode.Neg, `${readArgs} ctx.regs[args[1]] = -ctx.regs[args[0]];`);

  declareHandler(
    OpCode.BitAnd,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (a & b) ^ (T & (a | b));
    }`,
  );
  declareHandler(
    OpCode.BitOr,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (a | b) ^ (T & (a ^ b));
    }`,
  );
  declareHandler(
    OpCode.BitXor,
    `${readArgs} {
      var a = ctx.regs[args[0]];
      var b = ctx.regs[args[1]];
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (a ^ b) ^ (T & (a & b));
    }`,
  );
  declareHandler(
    OpCode.Shl,
    `${readArgs} {
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (ctx.regs[args[0]] << (ctx.regs[args[1]] + (T & 1))) ^ T;
    }`,
  );
  declareHandler(
    OpCode.Shr,
    `${readArgs} {
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (ctx.regs[args[0]] >> (ctx.regs[args[1]] + (T & 1))) ^ T;
    }`,
  );
  declareHandler(
    OpCode.UShr,
    `${readArgs} {
      var T = ctx.integrityState ^ 0x7F;
      ctx.regs[args[2]] = (ctx.regs[args[0]] >>> (ctx.regs[args[1]] + (T & 1))) ^ T;
    }`,
  );
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
  declareHandler(
    OpCode.PropGet,
    `${readArgs} {
    var key = ctx.regs[args[1]];
    var keyStr = String(key);
    if (keyStr === '__proto__' || keyStr === 'constructor') {
      throw new TypeError('Prototype/constructor access blocked');
    }
    ctx.regs[args[2]] = ctx.regs[args[0]][key];
  }`,
  );
  declareHandler(
    OpCode.PropSet,
    `${readArgs} {
    var key = ctx.regs[args[1]];
    var keyStr = String(key);
    if (keyStr === '__proto__' || keyStr === 'constructor') {
      throw new TypeError('Prototype mutation blocked');
    }
    ctx.regs[args[0]][key] = ctx.regs[args[2]];
  }`,
  );
  declareHandler(
    OpCode.ComputedGet,
    `${readArgs} {
    var key = ctx.regs[args[1]];
    var keyStr = String(key);
    if (keyStr === '__proto__' || keyStr === 'constructor') {
      throw new TypeError('Prototype/constructor access blocked');
    }
    ctx.regs[args[2]] = ctx.regs[args[0]][key];
  }`,
  );
  declareHandler(
    OpCode.ComputedSet,
    `${readArgs} {
    var key = ctx.regs[args[1]];
    var keyStr = String(key);
    if (keyStr === '__proto__' || keyStr === 'constructor') {
      throw new TypeError('Prototype mutation blocked');
    }
    ctx.regs[args[0]][key] = ctx.regs[args[2]];
  }`,
  );
  declareHandler(OpCode.ArrayNew, `${readArgs} ctx.regs[args[0]] = [];`);
  declareHandler(OpCode.ObjectNew, `${readArgs} ctx.regs[args[0]] = {};`);
  declareHandler(
    OpCode.Delete,
    `${readArgs} {
    var key = ctx.regs[args[1]];
    var keyStr = String(key);
    if (keyStr === '__proto__' || keyStr === 'constructor') {
      throw new TypeError('Prototype/constructor deletion blocked');
    }
    delete ctx.regs[args[0]][key];
  }`,
  );
  declareHandler(OpCode.CellNew, `${readArgs} ctx.regs[args[1]] = { v: ctx.regs[args[0]] };`);
  declareHandler(OpCode.CellGet, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]].v;`);
  declareHandler(OpCode.CellSet, `${readArgs} ctx.regs[args[0]].v = ctx.regs[args[1]];`);
  declareHandler(OpCode.EnvGet, `${readArgs} ${regRef('args[1]')} = ${ctxRef('env')}[args[0]];`);
  declareHandler(OpCode.RestArgs, `${readArgs} ${regRef('args[1]')} = ${ctxRef('fnArgs')}.slice(${regRef('args[0]')});`);
  declareHandler(
    OpCode.ClosureNew,
    `
    ${readArgs}
    ${regRef('args[2]')} = ${top.getExecutorById}(${top.getCP}(ctx, args[0]), ${regRef('args[1]')});
  `,
  );
  declareHandler(
    OpCode.Spread,
    `
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
        var spreadKey = String(spreadKeys[ski]);
        if (spreadKey === '__proto__' || spreadKey === 'constructor') {
          continue;
        }
        spreadTarget[spreadKey] = spreadSource[spreadKey];
      }
    }
  `,
  );
  declareHandler(
    OpCode.SpreadIntoArray,
    `
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
  `,
  );

  declareHandler(
    OpCode.CallMethod,
    `
    ${readArgs}
    var obj = ${regRef('args[0]')};
    var methodKey = ctx.regs[args[1]];
    var method = obj[methodKey];
    if (typeof method === 'function' && tsvmSensitiveKeys[methodKey] && !tsvmExecutors.has(method)) {
      try {
        var str = ${top.nativeToString}.call(method);
        if (str.indexOf('[native code]') === -1) {
          ${top.onDetection}(ctx, 0x08);
        }
      } catch(e) {}
    }
    var aa = [];
    for (var ci = 2; ci < args.length - 1; ci++) {
      aa.push(${regRef('args[ci]')});
    }
    ${regRef('args[args.length - 1]')} = ${top.nativeApply}.call(method, obj, aa);
  `,
  );
  declareHandler(
    OpCode.Call,
    `
    ${readArgs}
    var fn = ${regRef('args[0]')};
    if (typeof fn === 'undefined' || fn === null) {
      throw new TypeError('VM Call target is undefined or null');
    }
    if (typeof fn !== 'function') {
      var isSensitiveObj = false;
      try {
        if (fn && (fn.send || fn.invoke || fn.on || fn.nodeIntegration !== undefined || fn.contextIsolation !== undefined)) {
          isSensitiveObj = true;
        }
      } catch(e) {}
      if (isSensitiveObj) {
        ${regRef('args[args.length - 1]')} = fn;
        return;
      }
      throw new TypeError('VM Call target is not a function');
    }
    var fnName = fn.name;
    if (fnName && tsvmSensitiveKeys[fnName] && !tsvmExecutors.has(fn)) {
      try {
        var str = ${top.nativeToString}.call(fn);
        if (str.indexOf('[native code]') === -1) {
          ${top.onDetection}(ctx, 0x08);
        }
      } catch(e) {}
    }
    var ab = [];
    for (var ci2 = 1; ci2 < args.length - 1; ci2++) {
      ab.push(${regRef('args[ci2]')});
    }
    ${regRef('args[args.length - 1]')} = ${top.nativeApply}.call(fn, null, ab);
  `,
  );
  declareHandler(
    OpCode.CallWithArray,
    `
    ${readArgs}
    var fnArray = ctx.regs[args[0]];
    if (typeof fnArray === 'function' && fnArray.name && tsvmSensitiveKeys[fnArray.name] && !tsvmExecutors.has(fnArray)) {
      try {
        var str = ${top.nativeToString}.call(fnArray);
        if (str.indexOf('[native code]') === -1) {
          ${top.onDetection}(ctx, 0x08);
        }
      } catch(e) {}
    }
    var res = ${top.nativeApply}.call(fnArray, null, ctx.regs[args[1]]);
    ctx.regs[args[2]] = res;
  `,
  );
  declareHandler(
    OpCode.CallMethodWithArray,
    `
    ${readArgs}
    var methodObj = ctx.regs[args[0]];
    var methodKey = ctx.regs[args[1]];
    var methodFn = methodObj[methodKey];
    if (typeof methodFn === 'function' && tsvmSensitiveKeys[methodKey] && !tsvmExecutors.has(methodFn)) {
      try {
        var str = ${top.nativeToString}.call(methodFn);
        if (str.indexOf('[native code]') === -1) {
          ${top.onDetection}(ctx, 0x08);
        }
      } catch(e) {}
    }
    ctx.regs[args[3]] = ${top.nativeApply}.call(methodFn, methodObj, ctx.regs[args[2]]);
  `,
  );
  declareHandler(
    OpCode.New,
    `
    ${readArgs}
    var ctor = ctx.regs[args[0]];
    var ctorArgs = [];
    for (var ni = 1; ni < args.length - 1; ni++) {
      ctorArgs.push(ctx.regs[args[ni]]);
    }
    ctx.regs[args[args.length - 1]] = typeof Reflect !== 'undefined' && Reflect.construct
      ? Reflect.construct(ctor, ctorArgs)
      : new (${top.nativeApply}.call((cleanIntrinsics.Function || Function).prototype.bind, ctor, [null].concat(ctorArgs)))();
  `,
  );
  declareHandler(
    OpCode.NewWithArray,
    `
    ${readArgs}
    var ctorArray = ctx.regs[args[0]];
    var ctorArrayArgs = ctx.regs[args[1]];
    ctx.regs[args[2]] = typeof Reflect !== 'undefined' && Reflect.construct
      ? Reflect.construct(ctorArray, ctorArrayArgs)
      : new (${top.nativeApply}.call((cleanIntrinsics.Function || Function).prototype.bind, ctorArray, [null].concat(ctorArrayArgs)))();
  `,
  );

  declareHandler(
    OpCode.Jmp,
    `${readArgs} ${ctxRef('pc')} = (kinds[0] === 0) ? ctx.regs[args[0]] : args[0];${config.rollingKeys ? ` ctx.${ctx.pathHash} = 0;` : ''}`,
  );
  declareHandler(
    OpCode.JmpIf,
    `${readArgs} {
      var cond = ${regRef('args[0]')};
      if (ctx.integrityState !== 0x7F) cond = !cond;
      ${ctxRef('pc')} = cond ? args[1] : args[2];
      ${config.rollingKeys ? ` ctx.${ctx.pathHash} = 0;` : ''}
    }`,
  );
  declareHandler(
    OpCode.JmpIfNot,
    `${readArgs} {
      var cond = !${regRef('args[0]')};
      if (ctx.integrityState !== 0x7F) cond = !cond;
      ${ctxRef('pc')} = cond ? args[1] : args[2];
      ${config.rollingKeys ? ` ctx.${ctx.pathHash} = 0;` : ''}
    }`,
  );

  declareHandler(
    OpCode.Return,
    `${readArgs} ${ctxRef('returnValue')} = args.length > 0 ? ${regRef('args[0]')} : undefined; ${ctxRef('running')} = false;`,
  );
  declareHandler(OpCode.ReturnVoid, `${readArgs} ${ctxRef('returnValue')} = undefined; ${ctxRef('running')} = false;`);
  declareHandler(OpCode.Throw, `${readArgs} throw (args.length > 0 ? ${regRef('args[0]')} : undefined);`);
  declareHandler(
    OpCode.TryCatchBegin,
    `
    ${readArgs}
    ${ctxRef('tryFrames')}.push({
      ${frame.catchPc}: args[0],
      ${frame.endPc}: args[1],
      ${frame.exceptionReg}: args[2],
    });
  `,
  );
  declareHandler(OpCode.TryCatchEnd, `${readArgs} if (${ctxRef('tryFrames')}.length > 0) { ${ctxRef('tryFrames')}.pop(); }`);
  declareHandler(
    OpCode.Await,
    `
    ${readArgs}
    ${ctxRef('awaitPromise')} = Promise.resolve(${regRef('args[0]')});
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'await';
    ${ctxRef('running')} = false;
    ${config.rollingKeys ? `ctx.${ctx.pathHash} = 0;` : ''}
  `,
  );
  declareHandler(OpCode.Nop, `${readArgs} /* Junk */`);
  declareHandler(OpCode.Halt, `${ctxRef('running')} = false;`);

  declareHandler(
    OpCode.PrivateGet,
    `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
    if (!p || !(key in p)) throw new TypeError(${runtimeStringRef('Cannot read private member')});
    ctx.regs[args[2]] = p[key];
  `,
  );
  declareHandler(
    OpCode.PrivateSet,
    `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
    if (!p) { p = {}; ${top.weakMapSet}.call(${top.privateData}, obj, p); }
    p[key] = ctx.regs[args[2]];
  `,
  );
  declareHandler(
    OpCode.PrivateIn,
    `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var key = ctx.regs[args[1]];
    var p = ${top.weakMapGet}.call(${top.privateData}, obj);
    ctx.regs[args[2]] = p ? (key in p) : false;
  `,
  );

  declareHandler(
    OpCode.SuperPropGet,
    `
    ${readArgs}
    var isStatic = typeof ${ctxRef('thisArg')} === 'function';
    var superProto = isStatic 
      ? ${top.objectObj}.getPrototypeOf(${ctxRef('thisArg')})
      : ${top.objectObj}.getPrototypeOf(${top.objectObj}.getPrototypeOf(${ctxRef('thisArg')}));
    ctx.regs[args[1]] = superProto[ctx.regs[args[0]]];
  `,
  );
  declareHandler(
    OpCode.SuperPropSet,
    `
    ${readArgs}
    var isStatic = typeof ${ctxRef('thisArg')} === 'function';
    var superProto = isStatic 
      ? ${top.objectObj}.getPrototypeOf(${ctxRef('thisArg')})
      : ${top.objectObj}.getPrototypeOf(${top.objectObj}.getPrototypeOf(${ctxRef('thisArg')}));
    superProto[ctx.regs[args[0]]] = ctx.regs[args[1]];
  `,
  );
  declareHandler(
    OpCode.SuperCall,
    `
    ${readArgs}
    if (!${top.reflectObj} || !${top.reflectObj}.construct) {
      throw new TypeError('Reflect.construct is required for super()');
    }
    var superCtor = ${top.objectObj}.getPrototypeOf(${ctxRef('newTarget')});
    var aa = [];
    for (var ci = 0; ci < args.length - 1; ci++) {
      aa.push(ctx.regs[args[ci]]);
    }
    ${ctxRef('thisArg')} = ${top.reflectObj}.construct(superCtor, aa, ${ctxRef('newTarget')});
    ctx.regs[args[args.length - 1]] = ${ctxRef('thisArg')};
  `,
  );
  declareHandler(
    OpCode.SuperCallWithArray,
    `
    ${readArgs}
    if (!${top.reflectObj} || !${top.reflectObj}.construct) {
      throw new TypeError('Reflect.construct is required for super()');
    }
    var superCtor = ${top.objectObj}.getPrototypeOf(${ctxRef('newTarget')});
    ${ctxRef('thisArg')} = ${top.reflectObj}.construct(superCtor, ctx.regs[args[0]], ${ctxRef('newTarget')});
    ctx.regs[args[1]] = ${ctxRef('thisArg')};
  `,
  );

  declareHandler(
    OpCode.Yield,
    `
    ${readArgs}
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'yield';
    ${ctxRef('resumeValue')} = ctx.regs[args[0]];
    ${ctxRef('running')} = false;
    ${config.rollingKeys ? `ctx.${ctx.pathHash} = 0;` : ''}
  `,
  );
  declareHandler(
    OpCode.YieldStar,
    `
    ${readArgs}
    ${ctxRef('resumeReg')} = args[1];
    ${ctxRef('resumeMode')} = 'yieldStar';
    ${ctxRef('resumeValue')} = ctx.regs[args[0]];
    ${ctxRef('running')} = false;
    ${config.rollingKeys ? `ctx.${ctx.pathHash} = 0;` : ''}
  `,
  );

  // GetEntropy: Fast VM-internal entropy source (replaces expensive Date.now() reflection)
  // Derives entropy from rolling VM state blended with environmental sources securely
  declareHandler(
    OpCode.GetEntropy,
    `
    ${readArgs}
    var t = 0;
    try {
      if (${top.performanceNow}) {
        t = ${top.performanceNow}();
      } else if (typeof Date !== 'undefined' && typeof Date.now === 'function') {
        t = Date.now();
      }
    } catch(e) {}
    var r = 0;
    try {
      r = ${top.mathRandom}() * 1000;
    } catch(e) {}
    var tBits = (t * 1000) & 0xFFFFFFFF;
    var rBits = r & 0xFFFFFFFF;
    var entropy = (ctx.${ctx.rollingState} ^ (${ctxRef('pc')} * 2654435761) ^ tBits ^ rBits) >>> 0;
    entropy = (entropy ^ (entropy >>> 16)) & 0xFF;
    ctx.regs[args[0]] = entropy;
  `,
  );

  const superRng = new SeededRandom(config.seed);
  const superIds = superRng.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const loadConstMulId = superIds[0]!;
  const getEntropyMulId = superIds[1]!;
  const loadConstAddId = superIds[2]!;

  declareHandler(
    OpCode.SuperInstruction,
    `
    ${readArgs}
    var patternId = args[0];
    if (patternId === ${loadConstMulId}) {
      var val = (kinds[1] === 2) ? ${top.getCP}(ctx, args[1]) : args[1];
      ctx.regs[args[2]] = val;
      ctx.regs[args[4]] = val * ctx.regs[args[3]];
    } else if (patternId === ${getEntropyMulId}) {
      var entropy = (ctx.${ctx.rollingState} ^ (${ctxRef('pc')} * 2654435761)) >>> 0;
      entropy = (entropy ^ (entropy >>> 16)) & 0xFF;
      ctx.regs[args[1]] = entropy;
      ctx.regs[args[2]] = entropy * entropy;
    } else if (patternId === ${loadConstAddId}) {
      var val = (kinds[1] === 2) ? ${top.getCP}(ctx, args[1]) : args[1];
      ctx.regs[args[2]] = val;
      ctx.regs[args[4]] = val + ctx.regs[args[3]];
    } else {
      throw new Error('Invalid Super-Instruction Pattern: ' + patternId);
    }
  `,
  );

  const antiDebugLogic = config.antiDebug
    ? `
    // Anti-Debug DevTools & Trace Protection (Silent Integrity Skew)
    var _dbg_start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    debugger;
    var _dbg_end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (_dbg_end - _dbg_start > 100) {
       ${top.onDetection}(ctx, 0x01);
    }
    // Opaque getter trap to detect automated inspect / DevTools formatting
    var _rTrap = /./;
    ${top.nativeDefineProperty}(_rTrap, 'source', {
      get: function() {
        ${top.onDetection}(ctx, 0x02);
        return 'trap';
      }
    });
  `
    : '';

  const tamperDetectionLogic = config.tamperDetection
    ? `
    // Multi-layer native intrinsics verification (hardened against toString spoofing)
    var _isNative = function(fn) {
      try { 
        if (typeof fn !== 'function') return false;
        var s = ${top.nativeCall}.call(${top.nativeToString}, fn);
        var regexPass = ${top.nativeCall}.call(RegExp.prototype.test, /^\\s*function\\s*[a-zA-Z0-9_$]*\\s*\\(\\s*\\)\\s*\\{\\s*\\[native code\\]\\s*\\}\\s*$/, s);
        if (!regexPass) return false;
        // Cross-check: verify our toString reports native
        var selfCheck = ${top.nativeCall}.call(${top.nativeToString}, ${top.nativeToString});
        if (${top.nativeCall}.call(String.prototype.indexOf, selfCheck, '[native code]') === -1) return false;
        var protoDesc = ${top.nativeGetOwnPropertyDescriptor}(fn, 'prototype');
        if (protoDesc && protoDesc.configurable && protoDesc.writable && fn.length === 0) return false;
        var nameDesc = ${top.nativeGetOwnPropertyDescriptor}(fn, 'name');
        if (nameDesc && nameDesc.writable) return false;
        return true;
      }
      catch (_) { return false; }
    };
    var fnStr = ${top.nativeCall}.call(${top.nativeToString}, __runVm);
    var hasDbg = ${top.nativeCall}.call(String.prototype.indexOf, fnStr, 'debugger') !== -1 ? 1 : 0;
    var verifyIntrinsic = function(obj, prop, expectedNative) {
      if (!obj || !prop) return false;
      var desc = ${top.nativeGetOwnPropertyDescriptor}(obj, prop);
      if (!desc) return false;
      if (expectedNative && !_isNative(desc.value || desc.get)) return false;
      return true;
    };
    var probeActive = function() {
      try {
        var map = new ${top.weakMapCtor}();
        var key = {};
        ${top.nativeCall}.call(${top.weakMapSet}, map, key, 42);
        if (${top.nativeCall}.call(${top.weakMapGet}, map, key) !== 42) return false;
        var sliceRes = ${top.nativeCall}.call(${top.arraySlice}, [1, 2], 1);
        if (!sliceRes || sliceRes[0] !== 2 || sliceRes.length !== 1) return false;
        return true;
      } catch (_) { return false; }
    };
    if (
      (!hasDbg && ${config.antiDebug}) || 
      fnStr.length < 50 || 
      !${top.onDetection} || 
      !_isNative(${top.nativeMathSin}) ||
      !_isNative(${top.weakMapGet}) ||
      !_isNative(${top.weakMapSet}) ||
      !_isNative(${top.nativeToString}) ||
      !verifyIntrinsic((cleanIntrinsics.Function || Function).prototype, 'toString', true) ||
      !verifyIntrinsic((cleanIntrinsics.Array || Array).prototype, 'slice', true) ||
      !verifyIntrinsic(${top.objectObj}, 'defineProperty', true) ||
      !verifyIntrinsic(cleanIntrinsics.Promise || Promise, 'resolve', true) ||
      !verifyIntrinsic(${top.reflectObj}, 'construct', true) ||
      !probeActive()
    ) {
      ${top.onDetection}(ctx, 0x04);
    }
  `
    : '';

  const runtimeDispatch = (() => {
    const vOpToHandlerName = new Array(256);
    const vOpToVariants = new Array(256);
    const trapFnName = handlerNames.get(OpCode.Trap)!;
    vOpToHandlerName.fill(trapFnName);
    vOpToVariants.fill(`[${trapFnName}]`);

    for (const [canonical, mapped] of opToMapped.entries()) {
      const fnNames = allHandlerVariants.get(canonical);
      if (!fnNames) continue;
      for (const vOp of mapped) {
        if (vOp >= 0 && vOp < 256) {
          const varIdx = (vOp ^ config.seed) % fnNames.length;
          vOpToHandlerName[vOp] = fnNames[varIdx];
          vOpToVariants[vOp] = `[${fnNames.join(', ')}]`;
        }
      }
    }

    if (config.runtimeHardening === 'paranoid') {
      // Semantic DNA: Select dispatch architecture based on seed DNA (5 architectures)
      const dispatchArch = config.seed % 5;

      if (dispatchArch === 0) {
        // Architecture 0: Nested Switch-in-Switch (16x16 buckets)
        let casesStr = '';
        for (let b = 0; b < 16; b++) {
          let subCases = '';
          for (let offset = 0; offset < 16; offset++) {
            const vOp = (b << 4) | offset;
            const variants = vOpToVariants[vOp];
            subCases += `        case ${offset}: var va = ${variants}; return va[(((ctx.${ctx.rollingState} >>> 16) ^ (ctx.${ctx.rollingState} & 0xFFFF)) & 0x7FFF) % va.length];\n`;
          }
          casesStr += `      case ${b}:\n        switch (nextOp & 0xF) {\n${subCases}        }\n        break;\n`;
        }
        return {
          declarations: `
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    var bucket = (nextOp >> 4) & 0xF;
    switch (bucket) {
${casesStr}
    }
    return ${trapFnName};
  }
          `,
          invoke: `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}));`,
        };
      }
      if (dispatchArch === 1) {
        // Architecture 1: Bijective Nibble-Swap Permutation Table
        const saltByte = (config.seed ^ 0xa5f3) & 0xff;
        const saltByte2 = ((config.seed >>> 8) ^ 0xc2b1) & 0xff;
        const permTable = new Array(256).fill(`[${trapFnName}]`);
        for (let vOp = 0; vOp < 256; vOp++) {
          const nibSwap = ((vOp >> 4) | ((vOp & 0xf) << 4)) & 0xff;
          const permuted = (nibSwap ^ saltByte ^ saltByte2) & 0xff;
          permTable[permuted] = vOpToVariants[vOp];
        }
        return {
          declarations: `
  var _hcVT = [
    ${permTable.join(',\n    ')}
  ];
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    var nibSwap = ((nextOp >> 4) | ((nextOp & 0xF) << 4)) & 0xFF;
    var h = (nibSwap ^ ${saltByte} ^ ${saltByte2}) & 0xFF;
    var variants = _hcVT[h];
    if (!variants || !variants.length) return ${trapFnName};
    return variants[(((ctx.${ctx.rollingState} >>> 16) ^ (ctx.${ctx.rollingState} & 0xFFFF)) & 0x7FFF) % variants.length];
  }
          `,
          invoke: `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}));`,
        };
      }
      if (dispatchArch === 2) {
        // Architecture 2: XOR-Scrambled Index Table (bijective XOR permutation)
        const xorScramble = (config.seed ^ 0x7e3d9f2c) & 0xff;
        const scrambledTable = new Array(256).fill(`[${trapFnName}]`);
        for (let vOp = 0; vOp < 256; vOp++) {
          const idx = (vOp ^ xorScramble) & 0xff;
          scrambledTable[idx] = vOpToVariants[vOp];
        }
        return {
          declarations: `
  var _tfVT = [
    ${scrambledTable.join(',\n    ')}
  ];
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    var scrambled = (nextOp ^ ${xorScramble}) & 0xFF;
    var variants = _tfVT[scrambled];
    if (!variants || !variants.length) return ${trapFnName};
    return variants[(((ctx.${ctx.rollingState} >>> 16) ^ (ctx.${ctx.rollingState} & 0xFFFF)) & 0x7FFF) % variants.length];
  }
          `,
          invoke: `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}));`,
        };
      }
      if (dispatchArch === 3) {
        // Architecture 3: Bit-Reversal Permutation Table
        // reverse8(x) reverses the 8 bits of x — bijective on [0,255]
        const bitRevSalt = (config.seed ^ 0x4b7d) & 0xff;
        const bitRevTable = new Array(256).fill(`[${trapFnName}]`);
        for (let vOp = 0; vOp < 256; vOp++) {
          let rev = 0;
          for (let bit = 0; bit < 8; bit++) {
            if (vOp & (1 << bit)) rev |= 1 << (7 - bit);
          }
          const idx = (rev ^ bitRevSalt) & 0xff;
          bitRevTable[idx] = vOpToVariants[vOp];
        }
        return {
          declarations: `
  var _brVT = [
    ${bitRevTable.join(',\n    ')}
  ];
  function _rev8(x) {
    x = ((x & 0xF0) >> 4) | ((x & 0x0F) << 4);
    x = ((x & 0xCC) >> 2) | ((x & 0x33) << 2);
    x = ((x & 0xAA) >> 1) | ((x & 0x55) << 1);
    return x & 0xFF;
  }
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    var h = (_rev8(nextOp) ^ ${bitRevSalt}) & 0xFF;
    var variants = _brVT[h];
    if (!variants || !variants.length) return ${trapFnName};
    return variants[(((ctx.${ctx.rollingState} >>> 16) ^ (ctx.${ctx.rollingState} & 0xFFFF)) & 0x7FFF) % variants.length];
  }
          `,
          invoke: `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}));`,
        };
      }
      // Architecture 4: Affine Transform (multiply by odd constant + add, mod 256)
      // f(x) = (x * oddMul + addConst) & 0xFF — bijective since oddMul is coprime to 256
      const oddMul = (config.seed & 0x7f) | 1 | 2; // ensure odd and >= 3
      const addConst4 = (config.seed >>> 16) & 0xff;
      const affineTable = new Array(256).fill(`[${trapFnName}]`);
      for (let vOp = 0; vOp < 256; vOp++) {
        const idx = (vOp * oddMul + addConst4) & 0xff;
        affineTable[idx] = vOpToVariants[vOp];
      }
      return {
        declarations: `
  var _afVT = [
    ${affineTable.join(',\n    ')}
  ];
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    var h = ((nextOp * ${oddMul}) + ${addConst4}) & 0xFF;
    var variants = _afVT[h];
    if (!variants || !variants.length) return ${trapFnName};
    return variants[(((ctx.${ctx.rollingState} >>> 16) ^ (ctx.${ctx.rollingState} & 0xFFFF)) & 0x7FFF) % variants.length];
  }
          `,
        invoke: `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}));`,
      };
    }
    return {
      declarations: `
  const ${locals.dispatchBank} = [\n    ${vOpToHandlerName.join(',\n    ')}\n  ];
  function resolveRoute(ctx, token) {
    if (token === null) return null;
    var nextOp = (token ^ ctx.${ctx.rollingState}) & 0xFF;
    return ${locals.dispatchBank}[nextOp];
  }
        `,
      invoke: `${locals.dispatchBank}[${locals.opByte}](ctx);`,
    };
  })();

  const allBytecodes: number[] = [];
  const functionTable: { [id: string]: { o: number; l: number; a: string[]; r: number; s: number } } = {};
  let currentOffset = 0;

  for (const fn of module.functions) {
    const fnSalt = buildRng.nextRange(1, 0xffffffff);
    functionTable[fn.id] = {
      o: currentOffset,
      l: fn.bytecode.length,
      a: fn.attributes ? [...fn.attributes] : [],
      r: fn.maxRegisters,
      s: fnSalt,
    };
    for (let i = 0; i < fn.bytecode.length; i++) {
      allBytecodes.push(fn.bytecode[i]!);
    }
    currentOffset += fn.bytecode.length;
  }

  const arenaArray = allBytecodes.join(',');
  const fnTableStr = Object.entries(functionTable)
    .map(([id, info]) => {
      return `${JSON.stringify(id)}: { o: ${info.o}, l: ${info.l}, a: ${JSON.stringify(info.a)}, r: ${info.r}, s: ${info.s} }`;
    })
    .join(',\n    ');

  const handlerVariantsEntries = Array.from(allHandlerVariants.entries())
    .map(([canonical, names]) => {
      return `[${canonical}]: [${names.join(', ')}]`;
    })
    .join(',\n    ');
  const handlerVariantsStr = `const handlerVariants = {\n    ${handlerVariantsEntries}\n  };`;

  if (config.runtimeHardening === 'paranoid') {
    handlerDeclarations.push(`function _fakeHandler_A(ctx) {
    var _r192 = ctx.regs;
    var a = _r192[0] ^ 0x3d2;
    var b = (a * 9172) | 0;
    _r192[1] = b ^ 0xdead;
    return (ctx.${ctx.rollingState} ^ 0xab) & 0xffff;
  }
  function _fakeHandler_B(ctx) {
    var _r928 = ctx.regs;
    var a = _r928[1] & 0xff;
    var b = Math.sin(a) * 4;
    _r928[2] = b | 0;
    return (ctx.${ctx.rollingState} ^ 0x3e) & 0xffff;
  }`);
  }

  const sourceCode = `
// Polymorphic Threaded VM Engine - Build: ${module.buildId}
const ${top.vmFunctions} = (function() {
  "use strict";
  const ${top.seed} = ${config.seed};
  const ${top.rawCP} = ${cp};

  // Grab clean intrinsics from a secure isolated context.
  // Uses iframe (browser) ONLY — require('vm') is deliberately excluded
  // due to known sandbox escape vulnerabilities (CVE-2023-37903, etc.).
  // For Node.js environments, pre-sealed intrinsics should be provided via config.
  var cleanIntrinsics = (function() {
    var win;
    try {
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        var iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.documentElement.appendChild(iframe);
        win = iframe.contentWindow;
        try {
          if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        } catch(e) {}
      }
    } catch (e) {}
    return win || {};
  })();

  const ${top.weakMapCtor} = cleanIntrinsics.WeakMap || WeakMap;
  const ${top.weakMapGet} = ${top.weakMapCtor}.prototype.get;
  const ${top.weakMapSet} = ${top.weakMapCtor}.prototype.set;
  const ${top.reflectObj} = cleanIntrinsics.Reflect || (typeof Reflect !== 'undefined' ? Reflect : undefined);
  const ${top.objectObj} = cleanIntrinsics.Object || Object;
  const ${top.nativeToString} = (cleanIntrinsics.Function || Function).prototype.toString;
  const ${top.nativeMathSin} = (cleanIntrinsics.Math || Math).sin;
  const ${top.arraySlice} = (cleanIntrinsics.Array || Array).prototype.slice;
  const ${top.promiseResolve} = (cleanIntrinsics.Promise || Promise).resolve.bind(cleanIntrinsics.Promise || Promise);
  const ${top.iteratorSymbol} = typeof Symbol !== 'undefined' ? Symbol.iterator : '@@iterator';
  const ${top.asyncIteratorSymbol} = typeof Symbol !== 'undefined' && Symbol.asyncIterator ? Symbol.asyncIterator : null;
  const ${top.privateData} = new ${top.weakMapCtor}();
  const tsvmExecutors = typeof WeakSet !== 'undefined' ? new WeakSet() : { add: function(){}, has: function(){ return false; } };
  const tsvmSensitiveKeys = { fetch: 1, XMLHttpRequest: 1, sendSync: 1, postMessage: 1 };

  // Secure local caches of essential operations
  const ${top.nativeDefineProperty} = ${top.objectObj}.defineProperty;
  const ${top.nativeGetOwnPropertyDescriptor} = ${top.objectObj}.getOwnPropertyDescriptor;
  const ${top.nativeApply} = (cleanIntrinsics.Function || Function).prototype.apply;
  const ${top.nativeCall} = (cleanIntrinsics.Function || Function).prototype.call;
  const pristineFetch = cleanIntrinsics.fetch || (typeof fetch !== 'undefined' ? fetch : undefined);
  const pristineXHR = cleanIntrinsics.XMLHttpRequest || (typeof XMLHttpRequest !== 'undefined' ? XMLHttpRequest : undefined);
  const pristineHeaders = cleanIntrinsics.Headers || (typeof Headers !== 'undefined' ? Headers : undefined);
  const pristineRequest = cleanIntrinsics.Request || (typeof Request !== 'undefined' ? Request : undefined);
  const pristineResponse = cleanIntrinsics.Response || (typeof Response !== 'undefined' ? Response : undefined);
  const ${top.performanceNow} = (cleanIntrinsics.performance && cleanIntrinsics.performance.now) ? cleanIntrinsics.performance.now.bind(cleanIntrinsics.performance) : (typeof performance !== 'undefined' && performance.now) ? performance.now.bind(performance) : null;
  const ${top.mathRandom} = (cleanIntrinsics.Math || Math).random;
  let executionCounter = 0;

  function djb2(str) {
    var hash = 5381;
    for (var i = 0; i < str.length; i++) {
      hash = ((hash * 33) + str.charCodeAt(i)) & 0xFFFFFFFF;
    }
    return hash >>> 0;
  }

  var __resolvedAPICache = {};

  function __resolveAPI(hash) {
    if (__resolvedAPICache[hash]) {
      return __resolvedAPICache[hash];
    }
    var g = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
    var encoded = ${JSON.stringify(encodedAPIs)};
    for (var i = 0; i < encoded.length; i++) {
      var enc = encoded[i];
      var api = '';
      for (var k = 0; k < enc.length; k++) {
        api += String.fromCharCode(enc.charCodeAt(k) ^ ${apiXorKey});
      }
      if (djb2(api) === hash) {
        var parts = api.split('.');
        var curr = g;
        for (var j = 0; j < parts.length; j++) {
          if (j === 0 && (parts[j] === 'window' || parts[j] === 'globalThis' || parts[j] === 'self' || parts[j] === 'global')) {
            curr = g;
          } else {
            curr = curr[parts[j]];
          }
          if (curr === undefined || curr === null) {
            break;
          }
        }
        if (typeof curr === 'function') {
          var parent = g;
          if (parts.length > 1) {
            parent = g;
            for (var m = 0; m < parts.length - 1; m++) {
              if (m === 0 && (parts[m] === 'window' || parts[m] === 'globalThis' || parts[m] === 'self' || parts[m] === 'global')) {
                parent = g;
              } else {
                parent = parent[parts[m]];
              }
            }
          }
          var bound = curr.bind(parent);
          __resolvedAPICache[hash] = bound;
          return bound;
        }
        __resolvedAPICache[hash] = curr;
        return curr;
      }
    }
    return undefined;
  }

  function selfDestruct(ctx) {
    if (!ctx) return;
    ctx.poisoned = true;
    ctx.${ctx.running} = false;
    ctx.${ctx.pc} = 999999;
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
    try {
      for (var i = 0; i < ctx.regCount; i++) {
        ctx.${ctx.regs}[i] = 0;
      }
    } catch(e) {}
    ctx.${ctx.env} = [];
    ctx.${ctx.tryFrames} = [];
    ctx.${ctx.returnValue} = undefined;
    ctx.${ctx.globalScope} = {};
  }

  function ${top.onDetection}(ctx, mask) {
    if (!ctx) return;
    ${config.tamperDetection ? 'ctx.integrityState ^= (mask || 0x1A);' : ''}
  }

  ${runtimeStringBootstrap}
  
  // Lazy Decryption
  function ${top.getCP}(ctx, index) {
    var c = ${top.rawCP}[index];
    if (!c) return undefined;
    if (c.kind === 'string' && ${config.constantPoolEncoding === ConstantEncodingScheme.XorRotate}) {
      var val = c.value;
      var decoded = '';
      var stringSeed = (${top.seed} ^ (index * 0x9E3779B9)) & 0xFFFFFFFF;
      ${
        config.rollingKeys
          ? `
      if (ctx && ctx.${ctx.pathHash} !== undefined) {
        stringSeed = (stringSeed ^ ctx.${ctx.pathHash}) & 0xFFFFFFFF;
      }
      `
          : ''
      }
      
      // Deriving 16-byte key using LCG
      var keyBytes = [];
      var s = stringSeed;
      var T = (ctx && ctx.integrityState !== undefined) ? (ctx.integrityState ^ 0x7F) : 0;
      for (var i = 0; i < 16; i++) {
        var currentMul = ${mulConst} + (T * 2);
        var currentAdd = ${addConst} + T;
        s = (Math.imul(s, currentMul) + currentAdd) | 0;
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
      
      c.value = decoded;
      c.kind = 'raw_string';
      return decoded;
    }
    return c.kind === 'undefined' ? undefined : c.value;
  }

  function mixRollingState(ctx, pos, decoded) {
    var salt = ctx.salt || 0;
    var nonce = ctx.executionNonce || 0;
    var op = ctx.${ctx.currentOpcode} || 0;
    var trace = ctx.traceChecksum || 0;
    var mixed = (pos ^ decoded ^ op ^ salt ^ nonce ^ (trace & 0xFF)) & 0xFF;
    // MurmurHash3-inspired non-linear mixing (replaces reversible LCG)
    var s = ctx.${ctx.rollingState} ^ mixed;
    var T = ctx.integrityState ^ 0x7F;
    var m1 = 0xcc9e2d51 + T;
    var m2 = 0x1b873593 + T;
    var m3 = 0xc2b2ae35 + T;
    var sh1 = 15 - (T & 1);
    var sh2 = 17 + (T & 1);
    s = Math.imul(s, m1);
    s = ((s << sh1) | (s >>> sh2));
    s = Math.imul(s, m2);
    s ^= (s >>> 13);
    s = Math.imul(s, m3);
    s ^= (s >>> 16);
    ctx.${ctx.rollingState} = s;
  }

  function corruptByteNear(ctx, at, mask) {
    if (at >= 0 && at < ctx.bytecode.length) {
      // Asymmetric masking: xorLog gets bit-reversed mask (linear over XOR, prevents cancellation)
      var rev = ((mask & 0xF0) >>> 4) | ((mask & 0x0F) << 4);
      rev = ((rev & 0xCC) >>> 2) | ((rev & 0x33) << 2);
      rev = ((rev & 0xAA) >>> 1) | ((rev & 0x55) << 1);
      ctx.bytecode[at] ^= mask;
      ctx.${ctx.xorLog}[at] ^= rev;
    }
  }

  function makeRouteToken(ctx, nextOp) {
    return (nextOp ^ ctx.${ctx.rollingState}) & 0xFFFF;
  }



  function ${top.readByte}(ctx) {
    var pos = ${ctxRef('pc')}++;
    if (pos >= ${ctxRef('bytecode')}.length) return 0;
    var byte = ${ctxRef('bytecode')}[pos];
    if (ctx && ctx.traceChecksum !== undefined) {
      ctx.traceChecksum = (((ctx.traceChecksum * 33) ^ byte) ^ pos) | 0;
    }
    ${
      config.rollingKeys
        ? `
      var xorVal = ${ctxRef('xorLog')}[pos];
      var rev = ((xorVal & 0xF0) >>> 4) | ((xorVal & 0x0F) << 4);
      rev = ((rev & 0xCC) >>> 2) | ((rev & 0x33) << 2);
      rev = ((rev & 0xAA) >>> 1) | ((rev & 0x55) << 1);
      byte ^= rev;
      var rawDecoded = byte ^ (((${top.seed} ^ (pos * 0x9E3779B9)) >>> 8) & 0xFF);
      var decoded = (rawDecoded - pos) & 0xFF;
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
        mixRollingState(ctx, pos, decoded);
      } else {
        // Non-linear state advancement (replaces reversible LCG)
        var s_nr = ctx.${ctx.rollingState} ^ pos;
        var T = ctx.integrityState ^ 0x7F;
        var m1 = 0xcc9e2d51 + T;
        var m2 = 0x1b873593 + T;
        var sh1 = 15 - (T & 1);
        var sh2 = 17 + (T & 1);
        s_nr = Math.imul(s_nr, m1);
        s_nr = ((s_nr << sh1) | (s_nr >>> sh2));
        s_nr = Math.imul(s_nr, m2);
        s_nr ^= (s_nr >>> 13);
        ctx.${ctx.rollingState} = s_nr;
      }
      var mask = ((ctx.${ctx.rollingState} >>> 16) & 0xFF) | 1;
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
        corruptByteNear(ctx, pos, mask);
        corruptByteNear(ctx, pos - 1, (mask * 3) & 0xFF);
        corruptByteNear(ctx, pos + 1, (mask * 7) & 0xFF);
        var stride = ((ctx.${ctx.rollingState} >>> 8) & 3) + 2;
        corruptByteNear(ctx, pos + stride, (mask * 13) & 0xFF);
      } else {
         var revMask = ((mask & 0xF0) >>> 4) | ((mask & 0x0F) << 4);
         revMask = ((revMask & 0xCC) >>> 2) | ((revMask & 0x33) << 2);
         revMask = ((revMask & 0xAA) >>> 1) | ((revMask & 0x55) << 1);
         ctx.${ctx.bytecode}[pos] ^= mask;
         ctx.${ctx.xorLog}[pos] ^= revMask;
      }
      return decoded;
    `
        : `
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
        var mask = (pos * 31 + ${config.seed}) & 0xFF;
        return byte ^ mask;
      }
      return byte;
    `
    }
  }

  ${buildRng.shuffle([...handlerDeclarations]).join('\n\n')}

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

  function __createVmContext(bytecodeArr, envArr, thisArg, newTarget, argsArr, registerCount, salt, isAsync) {
    var rawRegs = new Array(registerCount > 0 ? registerCount : argsArr.length + 8).fill(undefined);
    var regCount = rawRegs.length;
    var ctx;
    var rawGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};
    var isTainted = false;
    ${
      config.tamperDetection
        ? `
    if (rawGlobal.__tsvm_integrity_override__ === 'tainted' || rawGlobal.__tsvm_taint__ || rawGlobal.__VM_TAINT__) {
      isTainted = true;
    }
    try {
      if (rawGlobal.process && rawGlobal.process.env && (rawGlobal.process.env.TSVM_TAINT || rawGlobal.process.env.TSVM_INTEGRITY_OVERRIDE === 'tainted')) {
        isTainted = true;
      }
    } catch (e) {}
    try {
      if (typeof window !== 'undefined' && window.process && window.process.type) {
        isTainted = true;
      }
    } catch (e) {}
    try {
      if (typeof navigator !== 'undefined') {
        if (navigator.webdriver) {
          isTainted = true;
        }
        if (navigator.userAgent && (navigator.userAgent.indexOf('HeadlessChrome') !== -1 || navigator.userAgent.indexOf('Selenium') !== -1)) {
          isTainted = true;
        }
      }
    } catch (e) {}
    try {
      if (typeof document !== 'undefined' && document.documentElement) {
        if (document.documentElement.getAttribute('webdriver') || document.documentElement.getAttribute('selenium')) {
          isTainted = true;
        }
      }
      if (typeof window !== 'undefined') {
        if (window.callPhantom || window._phantom || window.__phantom_eval || window.__selenium_evaluate || window.__selenium_unwrapped || window.domAutomation || window.domAutomationController) {
          isTainted = true;
        }
      }
    } catch (e) {}
    `
        : ''
    }
    var initialIntegrityState = isTainted ? 0xAA : 0x7F;
    var applyTaintDrift = function(val, idx, pc) {
      if (val === undefined || val === null) return val;
      var type = typeof val;
      if (type === 'number') {
        if (val === (val | 0)) {
          var shift = ((idx * 37 + pc) % 3) - 1;
          return val + shift;
        } else {
          var scale = 1 + (((idx * 37 + pc) % 5) - 2) * 1e-6;
          return val * scale;
        }
      }
      if (type === 'string') {
        if (val.length === 0) return val;
        if ((idx + pc) % 3 === 0) {
          return val + '\u200b';
        }
        var charIdx = (idx + pc) % val.length;
        var code = val.charCodeAt(charIdx);
        var newCode = code + (((idx + pc) % 2 === 0) ? 1 : -1);
        if (newCode >= 32 && newCode <= 126) {
          return val.substring(0, charIdx) + String.fromCharCode(newCode) + val.substring(charIdx + 1);
        }
        return val;
      }
      if (type === 'boolean') {
        if ((idx + pc) % 10 === 0) {
          return !val;
        }
        return val;
      }
      return val;
    };
    var regsProxy = new Proxy(rawRegs, {
      get: function(target, prop) {
        if (typeof prop === 'string') {
          var idx = +prop;
          if (idx === idx) {
            if (idx < 0 ? idx < -128 : idx >= regCount) {
              throw new Error('Register out of bounds (get): ' + idx + ', regCount: ' + regCount);
            }
            var val = target[prop];
            if (ctx && ctx.integrityState !== 0x7F) {
              return applyTaintDrift(val, idx, ctx.${ctx.pc});
            }
            return val;
          }
        }
        return target[prop];
      },
      set: function(target, prop, val) {
        if (typeof prop === 'string') {
          var idx = +prop;
          if (idx === idx) {
            if (idx < 0 ? idx < -128 : idx >= regCount) {
              throw new Error('Register out of bounds (set): ' + idx + ', regCount: ' + regCount + ', val: ' + val);
            }
            if (ctx && ctx.integrityState !== 0x7F) {
              val = applyTaintDrift(val, idx, ctx.${ctx.pc});
            }
          }
        }
        target[prop] = val;
        return true;
      }
    });
    var rawGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global;
    var virtualGlobalScope = {};
    var allowedGlobals = {
      'Math': 1, 'JSON': 1, 'Date': 1, 'parseInt': 1, 'parseFloat': 1,
      'isNaN': 1, 'isFinite': 1, 'decodeURI': 1, 'decodeURIComponent': 1,
      'encodeURI': 1, 'encodeURIComponent': 1, 'String': 1, 'Number': 1,
      'Boolean': 1, 'Array': 1, 'Object': 1, 'RegExp': 1, 'Error': 1, 'Function': 1,
      'TypeError': 1, 'RangeError': 1, 'ReferenceError': 1, 'SyntaxError': 1,
      'Map': 1, 'Set': 1, 'WeakMap': 1, 'WeakSet': 1, 'Symbol': 1,
      'Promise': 1, 'setTimeout': 1, 'clearTimeout': 1, 'setInterval': 1,
      'clearInterval': 1, 'console': 1, 'undefined': 1, 'Infinity': 1, 'NaN': 1
    };
    var secureGlobalProxy = new Proxy(virtualGlobalScope, {
      get: function(target, prop) {
        if (typeof prop === 'string') {
          if (prop in target) {
            return target[prop];
          }
          if (allowedGlobals[prop]) {
            return rawGlobal[prop];
          }
          if (prop === 'fetch') {
            if (pristineFetch) {
              try {
                var str = ${top.nativeToString}.call(pristineFetch);
                if (str.indexOf('[native code]') !== -1) {
                  return pristineFetch;
                }
              } catch (e) {}
            }
            return undefined;
          }
          if (prop === 'XMLHttpRequest') {
            if (pristineXHR) {
              try {
                var str = ${top.nativeToString}.call(pristineXHR);
                if (str.indexOf('[native code]') !== -1) {
                  return pristineXHR;
                }
              } catch (e) {}
            }
            return undefined;
          }
          if (prop === 'Headers') return pristineHeaders;
          if (prop === 'Request') return pristineRequest;
          if (prop === 'Response') return pristineResponse;
        }
        return undefined;
      },
      set: function(target, prop, val) {
        if (typeof prop === 'string') {
          if (
            prop === '__proto__' ||
            prop === 'constructor' ||
            prop === 'prototype' ||
            prop === 'process' ||
            prop === 'require' ||
            prop === 'child_process' ||
            prop === 'fs' ||
            prop === 'eval' ||
            prop === 'Function' ||
            prop === 'fetch' ||
            prop === 'XMLHttpRequest'
          ) {
            throw new TypeError('Access Denied');
          }
          target[prop] = val;
        }
        return true;
      },
      has: function(target, prop) {
        if (typeof prop === 'string') {
          return (prop in target) || !!allowedGlobals[prop] || prop === 'fetch' || prop === 'XMLHttpRequest';
        }
        return prop in target;
      }
    });
    ctx = {
      ${ctx.pc}: 0,
      ${ctx.bytecode}: ${config.rollingKeys ? 'Uint8Array.from(bytecodeArr)' : 'bytecodeArr'},
      ${ctx.regs}: regsProxy,
      ${ctx.fnArgs}: argsArr,
      ${ctx.env}: envArr || [],
      ${ctx.globalScope}: secureGlobalProxy,
      ${ctx.thisArg}: thisArg,
      ${ctx.newTarget}: newTarget,
      ${ctx.resumeMode}: 'normal',
      ${ctx.resumeValue}: undefined,
      ${ctx.resumeReg}: -1,
      ${ctx.awaitPromise}: null,
      ${ctx.running}: true,
      ${ctx.returnValue}: undefined,
      ${ctx.tryFrames}: [],
      ${ctx.rollingState}: ${config.rollingKeys ? `${top.seed} & 0xFFFFFFFF` : '0'},
      ${ctx.xorLog}: ${config.rollingKeys ? 'new Uint8Array(bytecodeArr.length)' : 'null'},
      ${ctx.executionNonce}: ${config.rollingKeys ? '(++executionCounter)' : '0'},
      salt: ${config.rollingKeys ? 'salt' : '0'},
      ${ctx.currentOpcode}: 0,
      poisoned: false,
      integrityState: initialIntegrityState,
      isAsync: !!isAsync,
      sliceStepCount: 0,
      savedHandler: null,
      regCount: regCount,
      ${ctx.currentHandlerIdx}: 0,
      ${ctx.pathHash}: 0,
      traceChecksum: 0,
      shred: function() {
        // Zero per-execution register backing array
        if (rawRegs) {
          for (var i = 0; i < rawRegs.length; i++) rawRegs[i] = 0;
        }
        ${
          config.rollingKeys
            ? `
        if (ctx.${ctx.bytecode} && ctx.${ctx.bytecode}.fill) {
          try { ctx.${ctx.bytecode}.fill(0); } catch(e) {}
        }
        `
            : ''
        }
        ctx.${ctx.bytecode} = new Uint8Array(0);
        // Detach env reference without destroying shared envArr
        ctx.${ctx.env} = [];
        // Zero per-execution args (these are cloned per call via arraySlice)
        if (argsArr) {
          for (var i = 0; i < argsArr.length; i++) argsArr[i] = 0;
        }
        if (ctx.${ctx.tryFrames}) {
          ctx.${ctx.tryFrames} = [];
        }
        ctx.${ctx.xorLog} = null;
        ctx.${ctx.returnValue} = undefined;
        ctx.${ctx.globalScope} = {};
        ctx.savedHandler = null;
        ctx.${ctx.running} = false;
      }
    };
    for (let i = 0; i < argsArr.length; i++) {
      ${regRef('i')} = argsArr[i];
    }
    return ctx;
  }

  function __runVm(ctx) {
    if ((ctx.${ctx.pc} & 0xF) === 0) {
      ctx.${ctx.regs}._jitDeopt = ctx.${ctx.pc};
      delete ctx.${ctx.regs}._jitDeopt;
    }
    ${antiDebugLogic}
    ${tamperDetectionLogic}
    if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length && !ctx.savedHandler) return { kind: 'return', value: ${ctxRef('returnValue')} };
    let handler;
    if (ctx.savedHandler) {
      handler = ctx.savedHandler;
      ctx.savedHandler = null;
    } else {
      let ${locals.opByte} = ${top.readByte}(ctx);
      ${
        config.stealthDispatch
          ? `
        ${locals.opByte} = (ctx.${ctx.currentHandlerIdx} + ${locals.opByte}) % 256;
        ctx.${ctx.currentHandlerIdx} = ${locals.opByte};
      `
          : ''
      }
      ${
        config.rollingKeys
          ? `
        ctx.${ctx.pathHash} = (Math.imul(ctx.${ctx.pathHash}, 31) + ${locals.opByte}) & 0xFFFFFFFF;
      `
          : ''
      }
      handler = ${config.runtimeHardening === 'paranoid' ? `resolveRoute(ctx, makeRouteToken(ctx, ${locals.opByte}))` : `${locals.dispatchBank}[${locals.opByte}]`};
    }
    
    while(handler && ${ctxRef('running')} && !ctx.poisoned) {
      if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'} && ctx.isAsync) {
        ctx.sliceStepCount++;
        if (ctx.sliceStepCount >= 32) {
          ctx.sliceStepCount = 0;
          ctx.savedHandler = handler;
          return { kind: 'yieldMicrotask' };
        }
      }
      // Timing Jitter Injection to mitigate Timing Side-Channels
      var jitterLimit = (ctx.${ctx.rollingState} ^ ${ctxRef('pc')}) & 0x3;
      var jitterVal = 0;
      for (var j = 0; j < jitterLimit; j++) {
        jitterVal = (Math.imul(jitterVal + j, 31) + ctx.${ctx.rollingState}) | 0;
      }
      if (jitterVal === 0xdeadbeef) {
        ctx._j = jitterVal;
      }
      if (${ctxRef('tryFrames')}.length > 0) {
        while (${ctxRef('tryFrames')}.length > 0 && ${ctxRef('pc')} >= ${ctxRef('tryFrames')}[${ctxRef('tryFrames')}.length - 1].${frame.endPc}) {
          ${ctxRef('tryFrames')}.pop();
        }
        if (${ctxRef('tryFrames')}.length === 0) {
          continue;
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
          const handlerFrame = ${ctxRef('tryFrames')}.pop();
          ${regRef(frameRef('handlerFrame', 'exceptionReg'))} = error;
          ${ctxRef('running')} = true;
          ${ctxRef('pc')} = ${frameRef('handlerFrame', 'catchPc')};
          ${config.stealthDispatch ? `ctx.${ctx.currentHandlerIdx} = 0;` : ''}
          ${config.rollingKeys ? `ctx.${ctx.pathHash} = 0;` : ''}
          if (${ctxRef('pc')} >= ${ctxRef('bytecode')}.length) {
            handler = null;
          } else {
            let nextOp = ${top.readByte}(ctx);
            ${
              config.stealthDispatch
                ? `
              nextOp = (ctx.${ctx.currentHandlerIdx} + nextOp) % 256;
              ctx.${ctx.currentHandlerIdx} = nextOp;
            `
                : ''
            }
            ${
              config.rollingKeys
                ? `
              ctx.${ctx.pathHash} = (Math.imul(ctx.${ctx.pathHash}, 31) + nextOp) & 0xFFFFFFFF;
            `
                : ''
            }
            if (${config.runtimeHardening === 'paranoid' ? 'true' : 'false'}) {
              handler = resolveRoute(ctx, makeRouteToken(ctx, nextOp));
            } else {
              handler = ${locals.dispatchBank}[nextOp];
            }
          }
        }
      } else {
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
      var exec = function execute() {
        const ${ctx.fnArgs} = ${top.nativeCall}.call(${top.arraySlice}, arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt, true);
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
        var iter = {
          [${top.asyncIteratorSymbol} || ${top.iteratorSymbol}]: function() { return this; },
          next: async function(v) {
            if (finished) return { value: undefined, done: true };
            try {
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
                if (outcome.kind === 'yieldMicrotask') {
                  await Promise.resolve();
                  continue;
                }
                if (outcome.kind === 'await') {
                  await resumeAwait(outcome.promise, 'await');
                  v = undefined;
                  continue;
                }
                if (outcome.kind === 'return') {
                  finished = true;
                  ctx.shred();
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
            } catch(e) {
              finished = true;
              ctx.shred();
              throw e;
            }
          },
          return: async function(v) {
            finished = true;
            ctx.${ctx.running} = false;
            ctx.shred();
            return { value: v, done: true };
          },
          throw: async function(e) {
            ctx.${ctx.resumeMode} = 'throw';
            ctx.${ctx.resumeValue} = e;
            ctx.${ctx.running} = true;
            try {
              return await this.next();
            } catch(err) {
              ctx.shred();
              throw err;
            }
          }
        };
        tsvmExecutors.add(iter.next);
        tsvmExecutors.add(iter.return);
        tsvmExecutors.add(iter.throw);
        return iter;
      };
      tsvmExecutors.add(exec);
      return exec;
    }
    if (isAsync) {
      var exec = async function execute() {
        const ${ctx.fnArgs} = ${top.nativeCall}.call(${top.arraySlice}, arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt, true);
        try {
          while (true) {
            const outcome = __runVm(ctx);
            if (outcome.kind === 'return') {
              return outcome.value;
            }
            if (outcome.kind === 'yieldMicrotask') {
              await Promise.resolve();
              continue;
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
        } finally {
          ctx.shred();
        }
      };
      tsvmExecutors.add(exec);
      return exec;
    }
    if (isGenerator) {
      var exec = function execute() {
        const ${ctx.fnArgs} = ${top.nativeCall}.call(${top.arraySlice}, arguments);
        const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt, false);
        let delegateIterator = null;
        let finished = false;
        var iter = {
          [${top.iteratorSymbol}]: function() { return this; },
          next: function(v) {
            if (finished) return { value: undefined, done: true };
            try {
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
                  ctx.shred();
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
            } catch(e) {
              finished = true;
              ctx.shred();
              throw e;
            }
          },
          return: function(v) {
             finished = true;
             ctx.${ctx.running} = false;
             ctx.shred();
             return { value: v, done: true };
          },
          throw: function(e) {
             ctx.${ctx.resumeMode} = 'throw';
             ctx.${ctx.resumeValue} = e;
             ctx.${ctx.running} = true;
             try {
               return this.next();
             } catch(err) {
               ctx.shred();
               throw err;
             }
          }
        };
        tsvmExecutors.add(iter.next);
        tsvmExecutors.add(iter.return);
        tsvmExecutors.add(iter.throw);
        return iter;
      };
      tsvmExecutors.add(exec);
      return exec;
    }
    var exec = function execute() {
      const ${ctx.fnArgs} = ${top.nativeCall}.call(${top.arraySlice}, arguments);
      const ctx = __createVmContext(bytecodeArr, envArr, this, new.target, ${ctx.fnArgs}, registerCount, salt, false);
      try {
        const outcome = __runVm(ctx);
        if (outcome.kind === 'await') {
          throw new Error('VM await suspension reached sync executor');
        }
        var retVal = outcome.value;
        if (new.target) {
          if (retVal === undefined || (typeof retVal !== 'object' && typeof retVal !== 'function')) {
            return ctx.${ctx.thisArg};
          }
        }
        return retVal;
      } finally {
        ctx.shred();
      }
    };
    tsvmExecutors.add(exec);
    return exec;
  }

  var ${top.result} = {};
${exportedFunctions.map((fn) => `  ${top.result}[${JSON.stringify(fn.name)}] = ${top.getExecutorById}(${JSON.stringify(fn.id)});`).join('\n')}
  if (typeof Object.freeze === 'function') {
    Object.freeze(${top.result});
  }
  return ${top.result};
})();

if (typeof module !== 'undefined' && module.exports) {
${exportedFunctions.map((fn) => `  module.exports[${JSON.stringify(fn.name)}] = ${top.vmFunctions}[${JSON.stringify(fn.name)}];`).join('\n')}
}
  `.trim();

  return {
    buildId: module.buildId,
    dispatchLoop: 'function dispatch() {}',
    handlers: [],
    constantDecoder: 'function decode() {}',
    bytecodePayload: targetFn.bytecode,
    entryBootstrap: 'function boot() {}',
    fullSource: sourceCode,
  };
}
