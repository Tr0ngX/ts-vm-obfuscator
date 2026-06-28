import type { TransformPass, TransformContext, TransformResult, BasicBlock, Instruction, Register, ConstantPoolEntry } from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind, IRType } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

function inferRegisterTypes(
  blocks: readonly BasicBlock[],
  params: readonly any[],
  locals: readonly any[],
  constantPool: readonly ConstantPoolEntry[],
): Map<Register, IRType> {
  const types = new Map<Register, IRType>();

  for (const param of params) {
    types.set(param.register, param.type);
  }

  for (const local of locals) {
    types.set(local.register, local.type);
  }

  const getConstantType = (idx: number): IRType => {
    const entry = constantPool[idx];
    if (!entry) return IRType.Any;
    switch (entry.kind) {
      case ConstantKind.Number:
        return IRType.Number;
      case ConstantKind.String:
      case ConstantKind.Template:
        return IRType.String;
      case ConstantKind.Boolean:
        return IRType.Boolean;
      case ConstantKind.Null:
        return IRType.Null;
      case ConstantKind.Undefined:
        return IRType.Undefined;
      case ConstantKind.BigInt:
        return IRType.BigInt;
      default:
        return IRType.Any;
    }
  };

  const getOperandType = (op: any): IRType => {
    if (op.kind === OperandKind.Register) {
      return types.get(op.value as Register) ?? IRType.Any;
    }
    if (op.kind === OperandKind.ConstantIndex) {
      return getConstantType(op.value as number);
    }
    return IRType.Any;
  };

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 5) {
    changed = false;
    for (const block of blocks) {
      for (const inst of block.instructions) {
        if (!inst.result) continue;

        let newType = IRType.Any;
        switch (inst.opcode) {
          case OpCode.LoadConst: {
            const op = inst.operands[0];
            if (op && op.kind === OperandKind.ConstantIndex) {
              newType = getConstantType(op.value as number);
            }
            break;
          }
          case OpCode.Move: {
            const op = inst.operands[0];
            if (op) {
              newType = getOperandType(op);
            }
            break;
          }
          case OpCode.Add: {
            const opA = inst.operands[0];
            const opB = inst.operands[1];
            if (opA && opB) {
              const typeA = getOperandType(opA);
              const typeB = getOperandType(opB);
              if (typeA === IRType.Number && typeB === IRType.Number) {
                newType = IRType.Number;
              } else if (typeA === IRType.String || typeB === IRType.String) {
                newType = IRType.String;
              } else {
                newType = IRType.Any;
              }
            }
            break;
          }
          case OpCode.Sub:
          case OpCode.Mul:
          case OpCode.Div:
          case OpCode.Mod:
          case OpCode.BitAnd:
          case OpCode.BitOr:
          case OpCode.BitXor:
          case OpCode.Shl:
          case OpCode.Shr:
          case OpCode.UShr:
          case OpCode.Neg: {
            newType = IRType.Number;
            break;
          }
          case OpCode.Lt:
          case OpCode.Gt:
          case OpCode.LtEq:
          case OpCode.GtEq:
          case OpCode.Eq:
          case OpCode.StrictEq:
          case OpCode.In:
          case OpCode.InstanceOf:
          case OpCode.Not: {
            newType = IRType.Boolean;
            break;
          }
          case OpCode.LoadLocal: {
            const op = inst.operands[0];
            if (op && op.kind === OperandKind.Register) {
              newType = types.get(op.value as Register) ?? IRType.Any;
            }
            break;
          }
          default:
            newType = IRType.Any;
            break;
        }

        const oldType = types.get(inst.result);
        if (oldType !== newType) {
          types.set(inst.result, newType);
          changed = true;
        }
      }
    }
    iterations++;
  }

  return types;
}

export class InstructionSubstitutionPass implements TransformPass {
  readonly name = 'InstructionSubstitutionPass';
  readonly priority = 20;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const constantPool = [...ctx.module.constantPool];

    const getOrAddNumberConstant = (val: number): number => {
      let idx = constantPool.findIndex((c) => c.kind === ConstantKind.Number && c.value === val);
      if (idx === -1) {
        idx = constantPool.length;
        constantPool.push({ index: idx, kind: ConstantKind.Number, value: val });
      }
      return idx;
    };

    const newFunctions = ctx.module.functions.map((func) => {
      if (!func.isVirtualized) return func;

      const regTypes = inferRegisterTypes(func.blocks, func.params, func.locals, constantPool);
      let nextReg = getMaxRegister(func);
      let changed = false;

      const newBlocks = func.blocks.map((block) => {
        const newInstructions: Instruction[] = [];
        const smallIntegerRegisters = new Set<Register>();

        for (const inst of block.instructions) {
          const getOperandType = (op: any): IRType => {
            if (op.kind === OperandKind.Register) {
              return regTypes.get(op.value as Register) ?? IRType.Any;
            }
            if (op.kind === OperandKind.ConstantIndex) {
              const entry = constantPool[op.value as number];
              if (entry) {
                if (entry.kind === ConstantKind.Number) return IRType.Number;
                if (entry.kind === ConstantKind.String || entry.kind === ConstantKind.Template) return IRType.String;
              }
            }
            return IRType.Any;
          };

          const isSmallIntegerOperand = (op: any): boolean => {
            if (op.kind === OperandKind.ConstantIndex) {
              const entry = constantPool[op.value as number];
              if (entry && entry.kind === ConstantKind.Number) {
                const val = entry.value;
                if (typeof val === 'number') {
                  return Number.isSafeInteger(val) && val >= -2147483648 && val <= 2147483647;
                }
              }
            } else if (op.kind === OperandKind.Immediate) {
              const val = op.value;
              if (typeof val === 'number') {
                return Number.isSafeInteger(val) && val >= -2147483648 && val <= 2147483647;
              }
            } else if (op.kind === OperandKind.Register) {
              return smallIntegerRegisters.has(op.value as Register);
            }
            return false;
          };

          let wasSubstituted = false;

          if (ctx.rng.nextFloat() < 0.4) {
            if (inst.opcode === OpCode.Add && inst.operands.length === 2 && inst.result) {
              const opA = inst.operands[0]!;
              const opB = inst.operands[1]!;

              const typeA = getOperandType(opA);
              const typeB = getOperandType(opB);

              if (typeA === IRType.Number && typeB === IRType.Number && isSmallIntegerOperand(opA) && isSmallIntegerOperand(opB)) {
                // A + B => (A ^ B) + 2 * (A & B)
                const temp1 = `r${nextReg++}` as Register;
                const temp2 = `r${nextReg++}` as Register;
                const tempConst2 = `r${nextReg++}` as Register;
                const temp3 = `r${nextReg++}` as Register;

                newInstructions.push(
                  { opcode: OpCode.BitXor, operands: [opA, opB], result: temp1 },
                  { opcode: OpCode.BitAnd, operands: [opA, opB], result: temp2 },
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(2) }],
                    result: tempConst2,
                  },
                  {
                    opcode: OpCode.Mul,
                    operands: [
                      { kind: OperandKind.Register, value: temp2 },
                      { kind: OperandKind.Register, value: tempConst2 },
                    ],
                    result: temp3,
                  },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: temp1 },
                      { kind: OperandKind.Register, value: temp3 },
                    ],
                    result: inst.result,
                  },
                );

                nodesTransformed++;
                changed = true;
                wasSubstituted = true;
              }
            } else if (inst.opcode === OpCode.BitAnd && inst.operands.length === 2 && inst.result) {
              const opA = inst.operands[0]!;
              const opB = inst.operands[1]!;

              const typeA = getOperandType(opA);
              const typeB = getOperandType(opB);

              if (typeA === IRType.Number && typeB === IRType.Number) {
                // A & B => (A | B) - (A ^ B)
                const temp1 = `r${nextReg++}` as Register;
                const temp2 = `r${nextReg++}` as Register;

                newInstructions.push(
                  { opcode: OpCode.BitOr, operands: [opA, opB], result: temp1 },
                  { opcode: OpCode.BitXor, operands: [opA, opB], result: temp2 },
                  {
                    opcode: OpCode.Sub,
                    operands: [
                      { kind: OperandKind.Register, value: temp1 },
                      { kind: OperandKind.Register, value: temp2 },
                    ],
                    result: inst.result,
                  },
                );

                nodesTransformed++;
                changed = true;
                wasSubstituted = true;
              }
            } else if (inst.opcode === OpCode.BitOr && inst.operands.length === 2 && inst.result) {
              const opA = inst.operands[0]!;
              const opB = inst.operands[1]!;

              const typeA = getOperandType(opA);
              const typeB = getOperandType(opB);

              if (typeA === IRType.Number && typeB === IRType.Number) {
                // A | B => (A & B) + (A ^ B)
                const temp1 = `r${nextReg++}` as Register;
                const temp2 = `r${nextReg++}` as Register;

                newInstructions.push(
                  { opcode: OpCode.BitAnd, operands: [opA, opB], result: temp1 },
                  { opcode: OpCode.BitXor, operands: [opA, opB], result: temp2 },
                  {
                    opcode: OpCode.Add,
                    operands: [
                      { kind: OperandKind.Register, value: temp1 },
                      { kind: OperandKind.Register, value: temp2 },
                    ],
                    result: inst.result,
                  },
                );

                nodesTransformed++;
                changed = true;
                wasSubstituted = true;
              }
            } else if (inst.opcode === OpCode.BitXor && inst.operands.length === 2 && inst.result) {
              const opA = inst.operands[0]!;
              const opB = inst.operands[1]!;

              const typeA = getOperandType(opA);
              const typeB = getOperandType(opB);

              if (typeA === IRType.Number && typeB === IRType.Number) {
                // A ^ B => (A | B) - (A & B)
                const temp1 = `r${nextReg++}` as Register;
                const temp2 = `r${nextReg++}` as Register;

                newInstructions.push(
                  { opcode: OpCode.BitOr, operands: [opA, opB], result: temp1 },
                  { opcode: OpCode.BitAnd, operands: [opA, opB], result: temp2 },
                  {
                    opcode: OpCode.Sub,
                    operands: [
                      { kind: OperandKind.Register, value: temp1 },
                      { kind: OperandKind.Register, value: temp2 },
                    ],
                    result: inst.result,
                  },
                );

                nodesTransformed++;
                changed = true;
                wasSubstituted = true;
              }
            } else if (inst.opcode === OpCode.Neg && inst.operands.length === 1 && inst.result) {
              const opA = inst.operands[0]!;

              const typeA = getOperandType(opA);

              if (typeA === IRType.Number) {
                // -A => A * -1
                const tempConstNeg1 = `r${nextReg++}` as Register;

                newInstructions.push(
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: getOrAddNumberConstant(-1) }],
                    result: tempConstNeg1,
                  },
                  {
                    opcode: OpCode.Mul,
                    operands: [opA, { kind: OperandKind.Register, value: tempConstNeg1 }],
                    result: inst.result,
                  },
                );

                nodesTransformed++;
                changed = true;
                wasSubstituted = true;
              }
            }
          }

          if (!wasSubstituted) {
            newInstructions.push(inst);
          }

          // Update smallIntegerRegisters for the next instructions
          if (inst.result) {
            let isSmallInt = false;
            if (inst.opcode === OpCode.LoadConst) {
              const op = inst.operands[0];
              if (op) {
                isSmallInt = isSmallIntegerOperand(op);
              }
            } else if (inst.opcode === OpCode.Move) {
              const op = inst.operands[0];
              if (op) {
                isSmallInt = isSmallIntegerOperand(op);
              }
            } else if (
              inst.opcode === OpCode.BitAnd ||
              inst.opcode === OpCode.BitOr ||
              inst.opcode === OpCode.BitXor ||
              inst.opcode === OpCode.Shl ||
              inst.opcode === OpCode.Shr
            ) {
              isSmallInt = true;
            }

            if (isSmallInt) {
              smallIntegerRegisters.add(inst.result);
            } else {
              smallIntegerRegisters.delete(inst.result);
            }
          }
        }

        return { ...block, instructions: newInstructions };
      });

      if (!changed) return func;

      const newLocals = [...func.locals];
      const maxOriginalReg = getMaxRegister(func);
      for (let reg = maxOriginalReg; reg < nextReg; reg++) {
        newLocals.push({
          name: `isub_temp_r${reg}`,
          register: `r${reg}` as Register,
          type: IRType.Any,
          isCaptured: false,
        });
      }

      return { ...func, blocks: newBlocks, locals: newLocals };
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: [],
    };
  }
}
