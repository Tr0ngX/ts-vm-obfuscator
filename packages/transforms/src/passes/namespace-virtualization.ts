import type { TransformPass, TransformContext, TransformResult, IRModule, IRFunction, Instruction, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind, IRType, FunctionAttribute } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

/**
 * 1) Invariant đầu vào: Hàm truy cập các symbol thông qua namespace hoặc exported object (PropGet/PropSet).
 * 2) Invariant đầu ra: Các lookup namespace tĩnh bị biến thành lookup động trên một object graph ảo
 *    được quản lý ở runtime.
 * 3) Node kinds đụng tới: PropGet, PropSet, ComputedGet, ComputedSet.
 * 4) Edge cases: Bỏ qua các object native như window, document hoặc module của bên thứ ba không thể virtualize.
 * 5) Pseudo-code:
 *    For each instruction:
 *      if it is PropGet(obj, "propName"):
 *         replace with ComputedGet(virtual_namespace_map(obj), hash("propName"))
 */
export class NamespaceVirtualizationPass implements TransformPass {
  readonly name = 'NamespaceVirtualizationPass';
  readonly priority = 40;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const constantPool = [...ctx.module.constantPool];

    function isThisRegister(func: IRFunction, reg: string): boolean {
      for (const block of func.blocks) {
        for (const inst of block.instructions) {
          if (inst.result === reg && inst.opcode === OpCode.LoadThis) {
            return true;
          }
        }
      }
      return false;
    }

    function getPropertyNameOfRegister(func: IRFunction, reg: string, cp: readonly any[]): string | undefined {
      for (const block of func.blocks) {
        for (const inst of block.instructions) {
          if (inst.result === reg && inst.opcode === OpCode.LoadConst) {
            const op = inst.operands[0];
            if (op && op.kind === OperandKind.ConstantIndex) {
              const entry = cp[op.value as number];
              if (entry && entry.kind === ConstantKind.String) {
                return entry.value;
              }
            }
          }
        }
      }
      return undefined;
    }

    const standardBuiltins = new Set([
      'prototype',
      'constructor',
      'length',
      'name',
      // Array & Object methods
      'push',
      'pop',
      'shift',
      'unshift',
      'splice',
      'slice',
      'concat',
      'join',
      'forEach',
      'map',
      'filter',
      'reduce',
      'indexOf',
      'includes',
      'find',
      'findIndex',
      'keys',
      'values',
      'entries',
      'toString',
      'valueOf',
      'toLocaleString',
      'hasOwnProperty',
      'isPrototypeOf',
      'propertyIsEnumerable',
      'apply',
      'call',
      'bind',
      // Promise & Async / Iterator
      'then',
      'catch',
      'finally',
      'resolve',
      'reject',
      'next',
      'throw',
      'return',
      'value',
      'done',
      // Error standard properties
      'message',
      'stack',
      'cause',
      // Console & System
      'log',
      'error',
      'warn',
      'info',
      'dir',
      'clear',
      // NodeJS/Browser standard & VM
      'exports',
      'module',
      'require',
      'global',
      'window',
      'document',
      'process',
      'readFileSync',
      'writeFileSync',
      'readdirSync',
      'statSync',
      'mtime',
      'getTime',
      'exec',
      'test',
      'match',
      'replace',
      'split',
      'trim',
      'toLowerCase',
      'toUpperCase',
      // Symbol properties or other standard ones
      'Symbol',
      'iterator',
      'asyncIterator',
      'toStringTag',
      // Reflect and Object proxy trap builtins
      'setPrototypeOf',
      'getPrototypeOf',
      'defineProperty',
      'defineProperties',
      'getOwnPropertyDescriptor',
      'getOwnPropertyNames',
      'getOwnPropertySymbols',
      'create',
      'assign',
      'freeze',
      'seal',
      'preventExtensions',
      'isExtensible',
      'isFrozen',
      'isSealed',
      'construct',
      'has',
      'get',
      'set',
      'deleteProperty',
      'ownKeys',
      // Math methods (used by CFF dispatcher hash computation and user code)
      'imul',
      'abs',
      'floor',
      'ceil',
      'round',
      'min',
      'max',
      'pow',
      'sqrt',
      'random',
      'sign',
      'trunc',
      'log',
      'log2',
      'log10',
      'exp',
      'sin',
      'cos',
      'tan',
      'atan2',
      'clz32',
      'fround',
      'hypot',
      'cbrt',
      // String static methods
      'fromCharCode',
      'fromCodePoint',
      'raw',
      // Number methods
      'toFixed',
      'toPrecision',
      'isNaN',
      'isFinite',
      'parseInt',
      'parseFloat',
      'isInteger',
      'isSafeInteger',
      // Array static methods
      'isArray',
      'from',
      'of',
      'sort',
      'reverse',
      'fill',
      'copyWithin',
      'flat',
      'flatMap',
      'every',
      'some',
      'at',
      // Object static methods
      'is',
      // Date/JSON/RegExp
      'now',
      'parse',
      'stringify',
      'getDate',
      'getMonth',
      'getFullYear',
      'getTime',
      'setDate',
      'toISOString',
      'toJSON',
      'source',
      'flags',
      'lastIndex',
      // Map/Set
      'add',
      'delete',
      'clear',
      'size',
      'has',
      'forEach',
    ]);

    function hashString(str: string, seed: number): string {
      // FNV-1a with keyed initialization and output folding
      let hash = (seed ^ 0x811c9dc5) >>> 0;
      const prime = 0x01000193;
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, prime) >>> 0;
      }
      // XOR-fold and combine with rotated seed for wider hash space
      const folded = (hash >>> 16) ^ (hash & 0xffff) ^ ((seed >>> 8) & 0xffff);
      return folded.toString(16).padStart(4, '0') + ((hash ^ seed) >>> 0).toString(16);
    }

    const newFunctions = ctx.module.functions.map((func) => {
      let changed = false;
      const nextReg = getMaxRegister(func);
      let tempIndex = 0;
      const addedLocals: any[] = [];
      // 1. Advanced Data Flow Analysis to track all registers derived from parameters (including Move, StoreLocal/LoadLocal, and nested PropGets)
      const paramRegs = new Set<string>();
      const paramLocals = new Set<string>();
      for (const p of func.params) {
        paramRegs.add(p.register);
      }

      let sizeChanged = true;
      while (sizeChanged) {
        const oldRegSize = paramRegs.size;
        const oldLocalSize = paramLocals.size;

        for (const block of func.blocks) {
          for (const inst of block.instructions) {
            if (inst.opcode === OpCode.Move) {
              const srcOp = inst.operands[0];
              const destOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && paramRegs.has(srcOp.value)) {
                if (destOp && destOp.kind === OperandKind.Register && typeof destOp.value === 'string') {
                  paramRegs.add(destOp.value);
                }
              }
            } else if (inst.opcode === OpCode.StoreLocal) {
              const localOp = inst.operands[0];
              const srcOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && paramRegs.has(srcOp.value)) {
                if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                  paramLocals.add(localOp.value);
                }
              }
            } else if (inst.opcode === OpCode.LoadLocal && inst.result) {
              const localOp = inst.operands[0];
              if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                if (paramLocals.has(localOp.value) || paramRegs.has(localOp.value)) {
                  paramRegs.add(inst.result);
                }
              }
            } else if (inst.result) {
              const srcOp = inst.operands[0]!;
              if (
                (inst.opcode === OpCode.PropGet || inst.opcode === OpCode.ComputedGet) &&
                srcOp.kind === OperandKind.Register &&
                typeof srcOp.value === 'string' &&
                paramRegs.has(srcOp.value)
              ) {
                paramRegs.add(inst.result);
              } else if (
                inst.opcode === OpCode.Call ||
                inst.opcode === OpCode.CallMethod ||
                inst.opcode === OpCode.CallWithArray ||
                inst.opcode === OpCode.CallMethodWithArray
              ) {
                paramRegs.add(inst.result);
              } else if (inst.opcode === OpCode.RestArgs) {
                paramRegs.add(inst.result);
              }
            }
          }
        }
        sizeChanged = paramRegs.size !== oldRegSize || paramLocals.size !== oldLocalSize;
      }

      // 2. Data Flow Analysis to track all registers representing lexical "this" (from EnvGet, CellGet, CellNew, Move, etc.)
      const lexicalThisRegs = new Set<string>();
      const lexicalThisLocals = new Set<string>();

      for (const block of func.blocks) {
        for (const inst of block.instructions) {
          if (inst.opcode === OpCode.EnvGet && inst.result) {
            const op = inst.operands[0];
            if (op && op.kind === OperandKind.Immediate && typeof op.value === 'number') {
              const capVar = func.capturedVariables[op.value];
              if (capVar === '$$vm_lexical_this') {
                lexicalThisRegs.add(inst.result);
              }
            }
          }
        }
      }

      let lexicalSizeChanged = true;
      while (lexicalSizeChanged) {
        const oldRegSize = lexicalThisRegs.size;
        const oldLocalSize = lexicalThisLocals.size;

        for (const block of func.blocks) {
          for (const inst of block.instructions) {
            if (inst.opcode === OpCode.Move) {
              const srcOp = inst.operands[0];
              const destOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && lexicalThisRegs.has(srcOp.value)) {
                if (destOp && destOp.kind === OperandKind.Register && typeof destOp.value === 'string') {
                  lexicalThisRegs.add(destOp.value);
                }
              }
            } else if (inst.opcode === OpCode.StoreLocal) {
              const localOp = inst.operands[0];
              const srcOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && lexicalThisRegs.has(srcOp.value)) {
                if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                  lexicalThisLocals.add(localOp.value);
                }
              }
            } else if (inst.opcode === OpCode.LoadLocal && inst.result) {
              const localOp = inst.operands[0];
              if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                if (lexicalThisLocals.has(localOp.value) || lexicalThisRegs.has(localOp.value)) {
                  lexicalThisRegs.add(inst.result);
                }
              }
            } else if (inst.result) {
              if (inst.opcode === OpCode.CellGet || inst.opcode === OpCode.CellNew) {
                const srcOp = inst.operands[0];
                if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && lexicalThisRegs.has(srcOp.value)) {
                  lexicalThisRegs.add(inst.result);
                }
              }
            }
          }
        }
        lexicalSizeChanged = lexicalThisRegs.size !== oldRegSize || lexicalThisLocals.size !== oldLocalSize;
      }

      // 3. Data Flow Analysis to track all registers holding locally created Object Literals (from ObjectNew)
      const localObjects = new Set<string>();
      const localObjectLocals = new Set<string>();

      let localObjSizeChanged = true;
      while (localObjSizeChanged) {
        const oldRegSize = localObjects.size;
        const oldLocalSize = localObjectLocals.size;

        for (const block of func.blocks) {
          for (const inst of block.instructions) {
            if (
              (inst.opcode === OpCode.ObjectNew ||
                inst.opcode === OpCode.ArrayNew ||
                inst.opcode === OpCode.ClosureNew ||
                inst.opcode === OpCode.New ||
                inst.opcode === OpCode.NewWithArray ||
                inst.opcode === OpCode.GeneratorNew) &&
              inst.result
            ) {
              localObjects.add(inst.result);
            } else if (inst.opcode === OpCode.Move) {
              const srcOp = inst.operands[0];
              const destOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && localObjects.has(srcOp.value)) {
                if (destOp && destOp.kind === OperandKind.Register && typeof destOp.value === 'string') {
                  localObjects.add(destOp.value);
                }
              }
            } else if (inst.opcode === OpCode.StoreLocal) {
              const localOp = inst.operands[0];
              const srcOp = inst.operands[1];
              if (srcOp && srcOp.kind === OperandKind.Register && typeof srcOp.value === 'string' && localObjects.has(srcOp.value)) {
                if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                  localObjectLocals.add(localOp.value);
                }
              }
            } else if (inst.opcode === OpCode.LoadLocal && inst.result) {
              const localOp = inst.operands[0];
              if (localOp && localOp.kind === OperandKind.Register && typeof localOp.value === 'string') {
                if (localObjectLocals.has(localOp.value) || localObjects.has(localOp.value)) {
                  localObjects.add(inst.result);
                }
              }
            }
          }
        }
        localObjSizeChanged = localObjects.size !== oldRegSize || localObjectLocals.size !== oldLocalSize;
      }

      const newBlocks = func.blocks.map((block) => {
        // Skip CFF-generated blocks — these contain internal dispatcher logic
        // (Math.imul hash computation, state transitions) that must not be namespace-virtualized
        if (block.label?.startsWith('cff_')) {
          return block;
        }

        const newInstructions: Instruction[] = [];
        for (const inst of block.instructions) {
          if (inst.opcode === OpCode.PropGet || inst.opcode === OpCode.PropSet) {
            const objOp = inst.operands[0];
            const keyOp = inst.operands[1];

            const isStaticContext = func.attributes && func.attributes.indexOf(FunctionAttribute.Static) >= 0;
            const isObjThis =
              !isStaticContext &&
              objOp &&
              objOp.kind === OperandKind.Register &&
              typeof objOp.value === 'string' &&
              (isThisRegister(func, objOp.value) || lexicalThisRegs.has(objOp.value));
            const isObjParam =
              objOp && objOp.kind === OperandKind.Register && typeof objOp.value === 'string' && paramRegs.has(objOp.value);
            const isLocalObj =
              objOp && objOp.kind === OperandKind.Register && typeof objOp.value === 'string' && localObjects.has(objOp.value);

            const propName =
              keyOp && keyOp.kind === OperandKind.Register && typeof keyOp.value === 'string'
                ? getPropertyNameOfRegister(func, keyOp.value, constantPool)
                : undefined;

            const isBuiltin =
              propName &&
              (standardBuiltins.has(propName) ||
                ctx.module.exports.some((e) => e.exportedName === propName || e.localName === propName) ||
                ctx.module.imports.some((i) => i.localName === propName || i.importedName === propName));

            if (!isObjThis && !isObjParam && !isLocalObj && propName && !isBuiltin) {
              changed = true;
              nodesTransformed++;

              // Find or add hashed property name to constant pool deterministically
              const propHash = hashString(propName, ctx.profile.seed);
              const hashedName = `hash_${propHash}`;
              let cpIndex = constantPool.findIndex((c) => c.kind === ConstantKind.String && c.value === hashedName);
              if (cpIndex === -1) {
                cpIndex = constantPool.length;
                constantPool.push({
                  index: cpIndex,
                  kind: ConstantKind.String,
                  value: hashedName,
                });
              }

              const tempReg = `r${nextReg + tempIndex++}` as Register;
              addedLocals.push({
                name: `ns_virt_temp_${tempReg}`,
                register: tempReg,
                type: IRType.String,
                isCaptured: false,
              });

              // 1. Load the hashed name constant into tempReg
              newInstructions.push({
                opcode: OpCode.LoadConst,
                operands: [{ kind: OperandKind.ConstantIndex, value: cpIndex }],
                result: tempReg,
                sourceLocation: inst.sourceLocation,
              });

              // Replace PropGet/PropSet with ComputedGet/ComputedSet using the tempReg
              const ops = [...inst.operands];
              if (ops.length >= 2) {
                ops[1] = { kind: OperandKind.Register, value: tempReg };
              }
              newInstructions.push({
                ...inst,
                opcode: inst.opcode === OpCode.PropGet ? OpCode.ComputedGet : OpCode.ComputedSet,
                operands: ops,
                metadata: { namespaceVirtualization: true },
              });
            } else {
              newInstructions.push(inst);
            }
          } else {
            newInstructions.push(inst);
          }
        }
        return changed ? { ...block, instructions: newInstructions } : block;
      });
      return changed
        ? {
            ...func,
            locals: [...func.locals, ...addedLocals],
            blocks: newBlocks,
          }
        : func;
    });

    const newModule: IRModule = {
      ...ctx.module,
      functions: newFunctions,
      constantPool,
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
