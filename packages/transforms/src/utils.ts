import type { IRFunction } from '@tsvm/shared';
import { OperandKind } from '@tsvm/shared';

export function getMaxRegister(func: IRFunction): number {
  let maxReg = -1;
  const consider = (value: string | undefined) => {
    if (!value) return;
    const m = /^r(\d+)$/.exec(value);
    if (m) {
      maxReg = Math.max(maxReg, Number.parseInt(m[1]!, 10));
    }
  };

  for (const param of func.params) consider(param.register);
  for (const local of func.locals) consider(local.register);
  for (const block of func.blocks) {
    for (const phi of block.phiNodes ?? []) {
      consider(phi.result);
      for (const incoming of phi.incoming) consider(incoming.register);
    }
    for (const inst of block.instructions) {
      consider(inst.result);
      for (const op of inst.operands) {
        if (op.kind === OperandKind.Register) consider(op.value as string);
      }
    }
    consider(block.terminator.condition);
    consider(block.terminator.returnValue);
  }

  return maxReg + 1;
}
