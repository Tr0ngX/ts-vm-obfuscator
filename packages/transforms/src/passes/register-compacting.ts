import type { TransformPass, TransformContext, TransformResult, IRFunction, IRModule, Register } from '@tsvm/shared';
import { OperandKind } from '@tsvm/shared';

function collectUsedRegisters(func: IRFunction): Set<number> {
  const regs = new Set<number>();
  const add = (val: string | undefined) => {
    if (!val) return;
    const m = /^r(\d+)$/.exec(val);
    if (m) regs.add(Number.parseInt(m[1]!, 10));
  };

  for (const param of func.params) add(param.register);
  for (const local of func.locals) add(local.register);

  for (const block of func.blocks) {
    for (const phi of block.phiNodes ?? []) {
      add(phi.result);
      for (const inc of phi.incoming) add(inc.register);
    }
    for (const inst of block.instructions) {
      add(inst.result);
      for (const op of inst.operands) {
        if (op.kind === OperandKind.Register) add(op.value as string);
      }
    }
    add(block.terminator.condition);
    add(block.terminator.returnValue);
  }

  return regs;
}

function buildCompactMap(usedRegs: Set<number>): Map<string, string> | null {
  const sorted = Array.from(usedRegs).sort((a, b) => a - b);
  let hasGap = false;
  const map = new Map<string, string>();

  for (let i = 0; i < sorted.length; i++) {
    const oldReg = sorted[i]!;
    if (oldReg !== i) hasGap = true;
    map.set(`r${oldReg}`, `r${i}`);
  }

  return hasGap ? map : null;
}

function mapReg(val: string | undefined, map: Map<string, string>): string | undefined {
  if (!val) return undefined;
  return map.get(val) ?? val;
}

function mapOperandValue(val: string | number, map: Map<string, string>): string | number {
  if (typeof val === 'string') return map.get(val) ?? val;
  return val;
}

export class RegisterCompactingPass implements TransformPass {
  readonly name = 'RegisterCompactingPass';
  readonly priority = 90;

  execute(ctx: TransformContext): TransformResult {
    const newFunctions = ctx.module.functions.map(func => {
      if (!func.isVirtualized) return func;
      const usedRegs = collectUsedRegisters(func);
      const compactMap = buildCompactMap(usedRegs);
      if (!compactMap) return func;
      return this.rewriteRegisters(func, compactMap);
    });

    return {
      module: { ...ctx.module, functions: newFunctions },
      symbolsRenamed: 0,
      nodesTransformed: newFunctions.filter((f, i) => f !== ctx.module.functions[i]).length,
      diagnostics: [],
    };
  }

  private rewriteRegisters(func: IRFunction, map: Map<string, string>): IRFunction {
    return {
      ...func,
      params: func.params.map(p => ({
        ...p,
        register: mapReg(p.register, map) as Register,
      })),
      locals: func.locals.map(l => ({
        ...l,
        register: mapReg(l.register, map) as Register,
      })),
      blocks: func.blocks.map(block => ({
        ...block,
        phiNodes: (block.phiNodes ?? []).map(phi => ({
          ...phi,
          result: mapReg(phi.result, map) as Register,
          incoming: phi.incoming.map(inc => ({
            ...inc,
            register: mapReg(inc.register, map) as Register,
          })),
        })),
        instructions: block.instructions.map(inst => ({
          ...inst,
          result: mapReg(inst.result, map) as Register | undefined,
          operands: inst.operands.map(op => ({
            ...op,
            value: op.kind === OperandKind.Register
              ? mapOperandValue(op.value, map)
              : op.value,
          })),
        })),
        terminator: {
          ...block.terminator,
          condition: mapReg(block.terminator.condition, map) as Register | undefined,
          returnValue: mapReg(block.terminator.returnValue, map) as Register | undefined,
        },
      })),
    };
  }
}
