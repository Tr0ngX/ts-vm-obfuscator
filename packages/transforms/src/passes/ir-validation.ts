import type { TransformPass, TransformContext, TransformResult, IRFunction, IRModule } from '@tsvm/shared';
import { DiagnosticSeverity, OperandKind } from '@tsvm/shared';
import { getMaxRegister } from '../utils.js';

function registerValue(val: string | number | undefined): string | undefined {
  if (typeof val === 'string' && /^r\d+$/.test(val)) return val;
  return undefined;
}

export class IRValidationPass implements TransformPass {
  readonly name = 'IRValidationPass';
  readonly priority = 999;

  execute(ctx: TransformContext): TransformResult {
    const diagnostics: import('@tsvm/shared').Diagnostic[] = [];
    let nodesTransformed = 0;

    for (const func of ctx.module.functions) {
      if (func.isVirtualized) {
        const fnDiagnostics = this.validateFunction(func, ctx.module);
        diagnostics.push(...fnDiagnostics);
        nodesTransformed += fnDiagnostics.length;
      }
    }

    return {
      module: ctx.module,
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics,
    };
  }

  private validateFunction(func: IRFunction, module: IRModule): import('@tsvm/shared').Diagnostic[] {
    const diagnostics: import('@tsvm/shared').Diagnostic[] = [];
    const blockIds = new Set(func.blocks.map((b) => b.id));
    const blockMap = new Map(func.blocks.map((b) => [b.id, b]));
    const maxReg = getMaxRegister(func);

    for (const block of func.blocks) {
      // 1. Check predecessors reference existing blocks
      for (const pred of block.predecessors) {
        if (!blockIds.has(pred)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_INVALID_PREDECESSOR',
            message: `Block "${block.id}" has non-existent predecessor "${pred}"`,
          });
        }
      }

      // 2. Check successors reference existing blocks
      for (const succ of block.successors) {
        if (!blockIds.has(succ)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_INVALID_SUCCESSOR',
            message: `Block "${block.id}" has non-existent successor "${succ}"`,
          });
        }
      }

      // 3. Check terminator targets exist
      for (const target of block.terminator.targets) {
        if (!blockIds.has(target)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_INVALID_TARGET',
            message: `Block "${block.id}" references non-existent target block "${target}"`,
          });
        }
      }

      // 4. Check phi node incoming blocks exist
      for (const phi of block.phiNodes ?? []) {
        const regPhi = registerValue(phi.result);
        if (regPhi) {
          const idx = Number.parseInt(regPhi.substring(1), 10);
          if (idx >= maxReg) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              code: 'IR_PHI_REGISTER_BOUNDS',
              message: `Phi node result "${phi.result}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
            });
          }
        }
        for (const inc of phi.incoming) {
          if (!blockIds.has(inc.blockId)) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              code: 'IR_INVALID_PHI_BLOCK',
              message: `Phi node in "${block.id}" references non-existent incoming block "${inc.blockId}"`,
            });
          }
          const regInc = registerValue(inc.register);
          if (regInc) {
            const idx = Number.parseInt(regInc.substring(1), 10);
            if (idx >= maxReg) {
              diagnostics.push({
                severity: DiagnosticSeverity.Warning,
                code: 'IR_PHI_REGISTER_BOUNDS',
                message: `Phi node incoming register "${inc.register}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
              });
            }
          }
        }
      }

      // 5. Check instruction operands and results
      for (const inst of block.instructions) {
        const regResult = registerValue(inst.result);
        if (regResult) {
          const idx = Number.parseInt(regResult.substring(1), 10);
          if (idx >= maxReg) {
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              code: 'IR_INSTRUCTION_REGISTER_BOUNDS',
              message: `Instruction result "${inst.result}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
            });
          }
        }

        for (const op of inst.operands) {
          if (op.kind === OperandKind.Register) {
            const regVal = registerValue(op.value);
            if (regVal) {
              const idx = Number.parseInt(regVal.substring(1), 10);
              if (idx >= maxReg) {
                diagnostics.push({
                  severity: DiagnosticSeverity.Warning,
                  code: 'IR_OPERAND_REGISTER_BOUNDS',
                  message: `Operand "${op.value}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
                });
              }
            }
          }
        }
      }

      // 6. Check terminator condition/returnValue
      const regCond = registerValue(block.terminator.condition);
      if (regCond) {
        const idx = Number.parseInt(regCond.substring(1), 10);
        if (idx >= maxReg) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_TERMINATOR_REGISTER_BOUNDS',
            message: `Terminator condition "${block.terminator.condition}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
          });
        }
      }

      const regRet = registerValue(block.terminator.returnValue);
      if (regRet) {
        const idx = Number.parseInt(regRet.substring(1), 10);
        if (idx >= maxReg) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_TERMINATOR_REGISTER_BOUNDS',
            message: `Terminator returnValue "${block.terminator.returnValue}" exceeds max register ${maxReg - 1} in function "${func.name}"`,
          });
        }
      }
    }

    // 7. Check predecessor/successor consistency (bidirectional)
    for (const block of func.blocks) {
      for (const succ of block.successors) {
        const succBlock = blockMap.get(succ);
        if (succBlock && !succBlock.predecessors.includes(block.id)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_INCONSISTENT_EDGE',
            message: `Block "${block.id}" lists "${succ}" as successor but "${succ}" does not list it as predecessor`,
          });
        }
      }
      for (const pred of block.predecessors) {
        const predBlock = blockMap.get(pred);
        if (predBlock && !predBlock.successors.includes(block.id)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_INCONSISTENT_EDGE',
            message: `Block "${block.id}" lists "${pred}" as predecessor but "${pred}" does not list it as successor`,
          });
        }
      }
    }

    return diagnostics;
  }
}
