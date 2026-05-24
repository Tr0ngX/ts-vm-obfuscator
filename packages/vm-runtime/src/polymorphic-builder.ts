import type { BytecodeModule, VMBuildConfig, VMRuntimeBundle } from '@tsvm/shared';
import { OpCode, ConstantEncodingScheme, ImmediateEncodingScheme } from '@tsvm/shared';

export function buildVMRuntime(module: BytecodeModule, config: VMBuildConfig): VMRuntimeBundle {
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

  // Generate handlers for 0-255
  const handlerArrayItems: string[] = new Array(256).fill(`h_${OpCode.Trap}`);

  const getAlias = (op: OpCode) => {
    const list = opToMapped.get(op);
    return list && list.length > 0 ? list[0] : -1;
  };

  // We will declare handler functions:
  const handlerDeclarations: string[] = [];
  const declareHandler = (canonical: OpCode, body: string) => {
    const fnName = `h_${canonical}`;
    handlerDeclarations.push(`function ${fnName}(ctx) {\n${body}\n}`);
    const mapped = opToMapped.get(canonical) || [];
    for (const vOp of mapped) {
      handlerArrayItems[vOp] = fnName;
    }
  };

  declareHandler(OpCode.Trap, `throw new Error('VM Integrity Violation at PC ' + (ctx.pc - 1) + ', raw op: ' + ctx.bytecode[ctx.pc - 1]);`);

  const advanceArg = `
    let kindNum = ctx.bytecode[ctx.pc++];
    ${config.rollingKeys ? 'kindNum ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + kindNum) & 0xFF;' : ''}
    let val = 0;
    ${config.immediateEncoding === ImmediateEncodingScheme.VariableLength ? `
      let shift = 0;
      let b;
      do {
        b = ctx.bytecode[ctx.pc++];
        ${config.rollingKeys ? 'b ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + b) & 0xFF;' : ''}
        val |= (b & 0x7F) << shift;
        shift += 7;
      } while (b & 0x80);
    ` : `
      let b0 = ctx.bytecode[ctx.pc++];
      ${config.rollingKeys ? 'b0 ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + b0) & 0xFF;' : ''}
      let b1 = ctx.bytecode[ctx.pc++];
      ${config.rollingKeys ? 'b1 ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + b1) & 0xFF;' : ''}
      let b2 = ctx.bytecode[ctx.pc++];
      ${config.rollingKeys ? 'b2 ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + b2) & 0xFF;' : ''}
      let b3 = ctx.bytecode[ctx.pc++];
      ${config.rollingKeys ? 'b3 ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + b3) & 0xFF;' : ''}
      val = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    `}
  `;

  // Read arguments dynamically based on instruction encoding
  const readArgs = `
    let argCount = ctx.bytecode[ctx.pc++];
    ${config.rollingKeys ? 'argCount ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + argCount) & 0xFF;' : ''}
    const args = [];
    for (let i = 0; i < argCount; i++) {
      ${advanceArg}
      args.push(val);
    }
  `;

  declareHandler(OpCode.LoadConst, `
    ${readArgs}
    ctx.regs[args[1]] = getCP(args[0]);
  `);
  declareHandler(OpCode.LoadLocal, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.StoreLocal, `${readArgs} ctx.regs[args[0]] = ctx.regs[args[1]];`);
  declareHandler(OpCode.Move, `${readArgs} ctx.regs[args[1]] = ctx.regs[args[0]];`);
  declareHandler(OpCode.LoadGlobal, `
    ${readArgs}
    const propName = ctx.regs[args[0]];
    ctx.regs[args[1]] = (typeof result !== 'undefined' && result[propName] !== undefined)
      ? result[propName]
      : ctx.globalScope[propName];
  `);
  declareHandler(OpCode.StoreGlobal, `${readArgs} ctx.globalScope[ctx.regs[args[0]]] = ctx.regs[args[1]];`);
  
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
  declareHandler(OpCode.EnvGet, `${readArgs} ctx.regs[args[1]] = ctx.env[args[0]];`);
  declareHandler(OpCode.ClosureNew, `
    ${readArgs}
    ctx.regs[args[2]] = getExecutorById(getCP(args[0]), ctx.regs[args[1]]);
  `);
  
  declareHandler(OpCode.CallMethod, `
    ${readArgs}
    var obj = ctx.regs[args[0]];
    var method = obj[ctx.regs[args[1]]];
    var callArgs = [];
    for (var ci = 2; ci < args.length - 1; ci++) {
      callArgs.push(ctx.regs[args[ci]]);
    }
    ctx.regs[args[args.length - 1]] = method.apply(obj, callArgs);
  `);
  declareHandler(OpCode.Call, `
    ${readArgs}
    var fn = ctx.regs[args[0]];
    var callArgs2 = [];
    for (var ci2 = 1; ci2 < args.length - 1; ci2++) {
      callArgs2.push(ctx.regs[args[ci2]]);
    }
    ctx.regs[args[args.length - 1]] = fn.apply(null, callArgs2);
  `);
  
  declareHandler(OpCode.Jmp, `${readArgs} ctx.pc = args[0]; ${config.rollingKeys ? 'ctx.rollingKey = args[1];' : ''}`);
  declareHandler(OpCode.JmpIf, `${readArgs} ctx.pc = ctx.regs[args[0]] ? args[1] : args[2]; ${config.rollingKeys ? 'ctx.rollingKey = ctx.regs[args[0]] ? args[3] : args[4];' : ''}`);
  declareHandler(OpCode.JmpIfNot, `${readArgs} ctx.pc = !ctx.regs[args[0]] ? args[1] : args[2]; ${config.rollingKeys ? 'ctx.rollingKey = !ctx.regs[args[0]] ? args[3] : args[4];' : ''}`);
  
  declareHandler(OpCode.Return, `${readArgs} ctx.returnValue = args.length > 0 ? ctx.regs[args[0]] : undefined; ctx.running = false;`);
  declareHandler(OpCode.ReturnVoid, `${readArgs} ctx.returnValue = undefined; ctx.running = false;`);
  declareHandler(OpCode.Nop, `${readArgs} /* Junk */`);
  declareHandler(OpCode.Halt, `ctx.running = false;`);

  const antiDebugLogic = config.antiDebug ? `
    // Anti-Debug Heuristics
    var _dbg_start = typeof performance !== 'undefined' ? performance.now() : Date.now();
    debugger;
    var _dbg_end = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (_dbg_end - _dbg_start > 100) { 
       // Corrupt state silently
       ctx.regs[1] = NaN; 
       ctx.pc = Math.max(0, ctx.pc - 2); 
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
      ctx.globalScope = {}; 
      ctx.regs[0] = null; 
    }
  ` : '';

  const sourceCode = `
// Polymorphic Threaded VM Engine - Build: ${module.buildId}
const vmFunctions = (function() {
  const seed = ${config.seed};
  const rawCP = ${cp};
  const cpCache = new Map();
  
  // Lazy Decryption
  function getCP(index) {
    if (cpCache.has(index)) return cpCache.get(index);
    let c = rawCP[index];
    let val = c.value;
    if (c.kind === 'string' && ${config.constantPoolEncoding === ConstantEncodingScheme.XorRotate}) {
      let decoded = '';
      for (let i = 0; i < val.length; i++) {
        decoded += String.fromCharCode(val.charCodeAt(i) ^ (seed & 0xFF));
      }
      val = decoded;
    }
    cpCache.set(index, val);
    return val;
  }

  ${handlerDeclarations.join('\n\n')}

  const handlers = [
    ${handlerArrayItems.join(',\n    ')}
  ];

  const functionBytecodes = {
${module.functions.map(fn => `    '${fn.id}': new Uint8Array([${fn.bytecode.join(',')}])`).join(',\n')}
  };
  const executorCache = Object.create(null);

  function getExecutorById(functionId, env) {
    if ((!env || env.length === 0) && executorCache[functionId]) {
      return executorCache[functionId];
    }
    const bytecode = functionBytecodes[functionId];
    if (!bytecode) {
      throw new Error('Unknown VM function id: ' + functionId);
    }
    const executor = createExecutor(bytecode, env || []);
    if (!env || env.length === 0) {
      executorCache[functionId] = executor;
    }
    return executor;
  }

  function createExecutor(bytecodeArr, envArr) {
    return function execute() {
      const fnArgs = Array.prototype.slice.call(arguments);
      const ctx = {
        pc: 0,
        bytecode: bytecodeArr,
        regs: new Array(256).fill(undefined),
        env: envArr || [],
        globalScope: typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global,
        running: true,
        returnValue: undefined,
        rollingKey: ${config.rollingKeys ? 'seed & 0xFF' : '0'}
      };

      ${antiDebugLogic}
      ${tamperDetectionLogic}

      for (let i = 0; i < fnArgs.length; i++) {
        ctx.regs[i] = fnArgs[i];
      }
      
      // Threaded Dispatch Loop
      while(ctx.running && ctx.pc < ctx.bytecode.length) {
        let op = ctx.bytecode[ctx.pc++];
        ${config.rollingKeys ? 'op ^= ctx.rollingKey; ctx.rollingKey = (ctx.rollingKey + op) & 0xFF;' : ''}
        handlers[op](ctx);
      }
      
      return ctx.returnValue;
    };
  }

  var result = {};
${exportedFunctions.map(fn => `  result['${fn.name}'] = getExecutorById('${fn.id}');`).join('\n')}
  return result;
})();

if (typeof module !== 'undefined' && module.exports) {
${exportedFunctions.map(fn => `  module.exports.${fn.name} = vmFunctions['${fn.name}'];`).join('\n')}
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
