import type { BytecodeModule, VMBuildConfig, VMRuntimeBundle } from '@tsvm/shared';
import { OpCode, ConstantEncodingScheme } from '@tsvm/shared';

export function buildVMRuntime(module: BytecodeModule, config: VMBuildConfig): VMRuntimeBundle {
  const opToMapped = new Map<OpCode, number>();
  for (const [canonical, mapped] of (module.opcodeMapping.forward as Map<OpCode, number>).entries()) {
    opToMapped.set(canonical, mapped);
  }

  const cp = JSON.stringify(module.constantPool);

  const getMapped = (op: OpCode) => opToMapped.get(op) ?? op;

  // Find the exported/entry-point function — not just functions[0]
  const targetFnIndex = module.entryPointIndex >= 0 ? module.entryPointIndex : 0;
  const targetFn = module.functions[targetFnIndex];
  if (!targetFn) {
    throw new Error(`No target function found at index ${targetFnIndex}`);
  }

  // Collect all exported function names for module.exports
  const exportedFunctions = module.functions.filter(f => f.isEntryPoint);

  const sourceCode = `
// Polymorphic VM Runtime - Build: ${module.buildId}
const vmFunctions = (function() {
  const seed = ${config.seed};
  const rawCP = ${cp};
  const cp = rawCP.map(c => {
    if (c.kind === 'string' && ${config.constantPoolEncoding === ConstantEncodingScheme.XorRotate}) {
      let decoded = '';
      for (let i = 0; i < c.value.length; i++) {
        decoded += String.fromCharCode(c.value.charCodeAt(i) ^ (seed & 0xFF));
      }
      return decoded;
    }
    return c.value;
  });

  function createExecutor(bytecodeArr) {
    return function execute() {
      const fnArgs = Array.prototype.slice.call(arguments);
      let pc = 0;
      const bytecode = bytecodeArr;
      const regs = new Array(256).fill(undefined);
      for (let i = 0; i < fnArgs.length; i++) {
        regs[i] = fnArgs[i];
      }
      
      const globalScope = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global;
      
      while(pc < bytecode.length) {
        const op = bytecode[pc++];
        const argCount = bytecode[pc++];
        const args = [];
        for (let i = 0; i < argCount; i++) {
          const kind = bytecode[pc++];
          const b0 = bytecode[pc++];
          const b1 = bytecode[pc++];
          const b2 = bytecode[pc++];
          const b3 = bytecode[pc++];
          var val = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
          args.push({ kind: kind, val: val });
        }

        switch(op) {
          case ${getMapped(OpCode.LoadConst)}:
            regs[args[1].val] = cp[args[0].val];
            break;
          case ${getMapped(OpCode.LoadLocal)}:
            regs[args[1].val] = regs[args[0].val];
            break;
          case ${getMapped(OpCode.StoreLocal)}:
            regs[args[0].val] = regs[args[1].val];
            break;
          case ${getMapped(OpCode.Move)}:
            regs[args[1].val] = regs[args[0].val];
            break;
          case ${getMapped(OpCode.LoadGlobal)}:
            regs[args[1].val] = globalScope[regs[args[0].val]];
            break;
          case ${getMapped(OpCode.StoreGlobal)}:
            globalScope[regs[args[0].val]] = regs[args[1].val];
            break;
          case ${getMapped(OpCode.Add)}:
            regs[args[2].val] = regs[args[0].val] + regs[args[1].val];
            break;
          case ${getMapped(OpCode.Sub)}:
            regs[args[2].val] = regs[args[0].val] - regs[args[1].val];
            break;
          case ${getMapped(OpCode.Mul)}:
            regs[args[2].val] = regs[args[0].val] * regs[args[1].val];
            break;
          case ${getMapped(OpCode.Div)}:
            regs[args[2].val] = regs[args[0].val] / regs[args[1].val];
            break;
          case ${getMapped(OpCode.Mod)}:
            regs[args[2].val] = regs[args[0].val] % regs[args[1].val];
            break;
          case ${getMapped(OpCode.Neg)}:
            regs[args[1].val] = -regs[args[0].val];
            break;
          case ${getMapped(OpCode.BitAnd)}:
            regs[args[2].val] = regs[args[0].val] & regs[args[1].val];
            break;
          case ${getMapped(OpCode.BitOr)}:
            regs[args[2].val] = regs[args[0].val] | regs[args[1].val];
            break;
          case ${getMapped(OpCode.BitXor)}:
            regs[args[2].val] = regs[args[0].val] ^ regs[args[1].val];
            break;
          case ${getMapped(OpCode.Shl)}:
            regs[args[2].val] = regs[args[0].val] << regs[args[1].val];
            break;
          case ${getMapped(OpCode.Shr)}:
            regs[args[2].val] = regs[args[0].val] >> regs[args[1].val];
            break;
          case ${getMapped(OpCode.UShr)}:
            regs[args[2].val] = regs[args[0].val] >>> regs[args[1].val];
            break;
          case ${getMapped(OpCode.Not)}:
            regs[args[1].val] = !regs[args[0].val];
            break;
          case ${getMapped(OpCode.Eq)}:
            regs[args[2].val] = regs[args[0].val] == regs[args[1].val];
            break;
          case ${getMapped(OpCode.StrictEq)}:
            regs[args[2].val] = regs[args[0].val] === regs[args[1].val];
            break;
          case ${getMapped(OpCode.Lt)}:
            regs[args[2].val] = regs[args[0].val] < regs[args[1].val];
            break;
          case ${getMapped(OpCode.LtEq)}:
            regs[args[2].val] = regs[args[0].val] <= regs[args[1].val];
            break;
          case ${getMapped(OpCode.Gt)}:
            regs[args[2].val] = regs[args[0].val] > regs[args[1].val];
            break;
          case ${getMapped(OpCode.GtEq)}:
            regs[args[2].val] = regs[args[0].val] >= regs[args[1].val];
            break;
          case ${getMapped(OpCode.TypeOf)}:
            regs[args[1].val] = typeof regs[args[0].val];
            break;
          case ${getMapped(OpCode.InstanceOf)}:
            regs[args[2].val] = regs[args[0].val] instanceof regs[args[1].val];
            break;
          case ${getMapped(OpCode.PropGet)}:
            regs[args[2].val] = regs[args[0].val][regs[args[1].val]];
            break;
          case ${getMapped(OpCode.PropSet)}:
            regs[args[0].val][regs[args[1].val]] = regs[args[2].val];
            break;
          case ${getMapped(OpCode.ComputedGet)}:
            regs[args[2].val] = regs[args[0].val][regs[args[1].val]];
            break;
          case ${getMapped(OpCode.ComputedSet)}:
            regs[args[0].val][regs[args[1].val]] = regs[args[2].val];
            break;
          case ${getMapped(OpCode.CallMethod)}: {
            var obj = regs[args[0].val];
            var method = obj[regs[args[1].val]];
            var callArgs = [];
            for (var ci = 2; ci < args.length - 1; ci++) {
              callArgs.push(regs[args[ci].val]);
            }
            regs[args[args.length - 1].val] = method.apply(obj, callArgs);
            break;
          }
          case ${getMapped(OpCode.Call)}: {
            var fn = regs[args[0].val];
            var callArgs2 = [];
            for (var ci2 = 1; ci2 < args.length - 1; ci2++) {
              callArgs2.push(regs[args[ci2].val]);
            }
            regs[args[args.length - 1].val] = fn.apply(null, callArgs2);
            break;
          }
          case ${getMapped(OpCode.Jmp)}:
            pc = args[0].val;
            break;
          case ${getMapped(OpCode.JmpIf)}:
            if (regs[args[0].val]) {
              pc = args[1].val;
            } else {
              pc = args[2].val;
            }
            break;
          case ${getMapped(OpCode.JmpIfNot)}:
            if (!regs[args[0].val]) {
              pc = args[1].val;
            } else {
              pc = args[2].val;
            }
            break;
          case ${getMapped(OpCode.Return)}:
            if (args.length > 0) {
              return regs[args[0].val];
            }
            return;
          case ${getMapped(OpCode.ReturnVoid)}:
            return;
          case ${getMapped(OpCode.Nop)}:
            break;
          case ${getMapped(OpCode.Halt)}:
            return;
          case ${getMapped(OpCode.Trap)}:
            throw new Error('VM trap reached — unreachable code executed');
          default:
            break;
        }
      }
    };
  }

  var result = {};
${exportedFunctions.map(fn => `  result['${fn.name}'] = createExecutor(new Uint8Array([${fn.bytecode.join(',')}]));`).join('\n')}
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
