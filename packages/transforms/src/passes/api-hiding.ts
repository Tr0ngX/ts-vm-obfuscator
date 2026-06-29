import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind, IRType } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

/**
 * Calculates the DJB2 hash of a string.
 */
export function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = hash * 33 + str.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return hash >>> 0;
}

const GLOBAL_API_NAMES = new Set([
  'fetch',
  'process',
  'window',
  'globalThis',
  'self',
  'global',
  'console',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'document',
  'navigator',
  'location',
  'history',
  'localStorage',
  'sessionStorage',
  'XMLHttpRequest',
  'WebSocket',
  'crypto',
  'Buffer',
]);

export class ApiHidingPass implements TransformPass {
  readonly name = 'ApiHidingPass';
  readonly priority = 60;

  execute(ctx: TransformContext): TransformResult {
    const config = ctx.profile.transforms.find((t) => t.name === this.name);
    if (config && !config.enabled) {
      return {
        module: ctx.module,
        symbolsRenamed: 0,
        nodesTransformed: 0,
        diagnostics: [],
      };
    }

    let nodesTransformed = 0;
    const hiddenAPIs = new Set<string>();
    let nextConstantIndex = ctx.module.constantPool.length;
    const newConstantPool = [...ctx.module.constantPool];

    const getOrAddStringConstant = (val: string): number => {
      const existing = newConstantPool.find((c) => c.kind === ConstantKind.String && c.value === val);
      if (existing) {
        return existing.index;
      }
      const newIdx = nextConstantIndex++;
      newConstantPool.push({
        index: newIdx,
        kind: ConstantKind.String,
        value: val,
      });
      return newIdx;
    };

    const getOrAddNumberConstant = (val: number): number => {
      const existing = newConstantPool.find((c) => c.kind === ConstantKind.Number && c.value === val);
      if (existing) {
        return existing.index;
      }
      const newIdx = nextConstantIndex++;
      newConstantPool.push({
        index: newIdx,
        kind: ConstantKind.Number,
        value: val,
      });
      return newIdx;
    };

    const newFunctions = ctx.module.functions.map((func) => {
      if (!func.isVirtualized) return func;

      let changed = false;
      let nextTempRegId = getMaxRegister(func);
      const addedLocals: any[] = [];

      const nextTempReg = (): Register => {
        const reg = `r${nextTempRegId++}` as Register;
        addedLocals.push({
          name: `api_hide_temp_${reg}`,
          register: reg,
          type: IRType.Any,
          isCaptured: false,
        });
        return reg;
      };

      const buildLookup = (apiPath: string, resultReg: Register, sourceLocation: any): Instruction[] => {
        const r_helper_name = nextTempReg();
        const r_helper_func = nextTempReg();
        const r_hash = nextTempReg();

        const helperNameIdx = getOrAddStringConstant('__resolveAPI');
        const hashVal = djb2Hash(apiPath);
        const hashIdx = getOrAddNumberConstant(hashVal);

        return [
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: helperNameIdx }],
            result: r_helper_name,
            sourceLocation,
          },
          {
            opcode: OpCode.LoadGlobal,
            operands: [{ kind: OperandKind.Register, value: r_helper_name }],
            result: r_helper_func,
            sourceLocation,
          },
          {
            opcode: OpCode.LoadConst,
            operands: [{ kind: OperandKind.ConstantIndex, value: hashIdx }],
            result: r_hash,
            sourceLocation,
          },
          {
            opcode: OpCode.Call,
            operands: [
              { kind: OperandKind.Register, value: r_helper_func },
              { kind: OperandKind.Register, value: r_hash },
            ],
            result: resultReg,
            sourceLocation,
          },
        ];
      };

      const newBlocks = func.blocks.map((block) => {
        const stringValues = new Map<Register, string>();
        const registerPaths = new Map<Register, string[]>();
        const newInstructions: Instruction[] = [];

        block.instructions.forEach((inst) => {
          if (inst.opcode === OpCode.LoadConst && inst.result && inst.operands[0]?.kind === OperandKind.ConstantIndex) {
            const cpIdx = inst.operands[0].value as number;
            const cpEntry = newConstantPool.find((c) => c.index === cpIdx);
            if (cpEntry && cpEntry.kind === ConstantKind.String && typeof cpEntry.value === 'string') {
              stringValues.set(inst.result, cpEntry.value);
            }
            newInstructions.push(inst);
          } else if (inst.opcode === OpCode.LoadGlobal && inst.result && inst.operands[0]?.kind === OperandKind.Register) {
            const nameReg = inst.operands[0].value as Register;
            const name = stringValues.get(nameReg);
            if (name && GLOBAL_API_NAMES.has(name)) {
              registerPaths.set(inst.result, [name]);
              hiddenAPIs.add(name);
              const lookupInsts = buildLookup(name, inst.result, inst.sourceLocation);
              newInstructions.push(...lookupInsts);
              changed = true;
              nodesTransformed++;
            } else {
              newInstructions.push(inst);
            }
          } else if (
            inst.opcode === OpCode.PropGet &&
            inst.result &&
            inst.operands[0]?.kind === OperandKind.Register &&
            inst.operands[1]?.kind === OperandKind.Register
          ) {
            const objReg = inst.operands[0].value as Register;
            const propReg = inst.operands[1].value as Register;
            if (registerPaths.has(objReg)) {
              const parentPath = registerPaths.get(objReg)!;
              const propName = stringValues.get(propReg);
              if (propName) {
                const newPath = [...parentPath, propName];
                registerPaths.set(inst.result, newPath);

                const apiPath = newPath.join('.');
                hiddenAPIs.add(apiPath);
                const lookupInsts = buildLookup(apiPath, inst.result, inst.sourceLocation);
                newInstructions.push(...lookupInsts);
                changed = true;
                nodesTransformed++;
              } else {
                newInstructions.push(inst);
              }
            } else {
              newInstructions.push(inst);
            }
          } else if (
            inst.opcode === OpCode.CallMethod &&
            inst.operands[0]?.kind === OperandKind.Register &&
            inst.operands[1]?.kind === OperandKind.Register
          ) {
            const objReg = inst.operands[0].value as Register;
            const propReg = inst.operands[1].value as Register;
            if (registerPaths.has(objReg)) {
              const parentPath = registerPaths.get(objReg)!;
              const propName = stringValues.get(propReg);
              if (propName) {
                const newPath = [...parentPath, propName];
                if (inst.result) {
                  registerPaths.set(inst.result, newPath);
                }

                const apiPath = newPath.join('.');
                hiddenAPIs.add(apiPath);

                const r_func = nextTempReg();
                const lookupInsts = buildLookup(apiPath, r_func, inst.sourceLocation);
                const args = inst.operands.slice(2);
                const callInst: Instruction = {
                  opcode: OpCode.Call,
                  operands: [{ kind: OperandKind.Register, value: r_func }, ...args],
                  result: inst.result,
                  sourceLocation: inst.sourceLocation,
                };
                newInstructions.push(...lookupInsts, callInst);
                changed = true;
                nodesTransformed++;
              } else {
                newInstructions.push(inst);
              }
            } else {
              newInstructions.push(inst);
            }
          } else {
            newInstructions.push(inst);
          }
        });

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
      constantPool: newConstantPool,
      functions: newFunctions,
      metadata: {
        ...ctx.module.metadata,
        hiddenAPIs: Array.from(hiddenAPIs),
      },
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
