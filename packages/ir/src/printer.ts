import type { IRModule, Operand, Instruction } from '@tsvm/shared';
import { OpCode, OperandKind, ConstantKind } from '@tsvm/shared';

export function printIRModule(module: IRModule): string {
  let out = `Module: ${module.sourceFile}\n`;
  out += `ID: ${module.id}\n\n`;

  out += '--- Constant Pool ---\n';
  for (const c of module.constantPool) {
    out += `  [${c.index}] ${c.kind} = ${JSON.stringify(c.value)}\n`;
  }
  out += '\n';

  out += '--- Functions ---\n';
  for (const fn of module.functions) {
    out += `Function ${fn.name} (${fn.id}) [${fn.attributes.join(', ')}]\n`;
    out += `  Params: ${fn.params.map(p => `${p.register} (${p.name})`).join(', ')}\n`;
    out += `  Locals: ${fn.locals.map(l => `${l.register} (${l.name})`).join(', ')}\n\n`;

    for (const block of fn.blocks) {
      out += `  Block ${block.id} (${block.label}):\n`;
      for (const inst of block.instructions) {
        out += `    ${formatInstruction(inst)}\n`;
      }
      out += `    ${formatTerminator(block.terminator)}\n\n`;
    }
  }

  return out;
}

function formatInstruction(inst: Instruction): string {
  let out = '';
  if (inst.result) {
    out += `${inst.result} = `;
  }
  out += `${inst.opcode} `;
  out += inst.operands.map(formatOperand).join(', ');
  return out;
}

function formatOperand(op: Operand): string {
  if (op.kind === OperandKind.Register) return op.value as string;
  if (op.kind === OperandKind.ConstantIndex) return `c[${op.value}]`;
  if (op.kind === OperandKind.Immediate) return String(op.value);
  if (op.kind === OperandKind.BlockLabel) return `L_${op.value}`;
  if (op.kind === OperandKind.FunctionRef) return `fn_${op.value}`;
  return String(op.value);
}

function formatTerminator(term: any): string {
  switch (term.kind) {
    case 'return': return `return ${term.returnValue || 'void'}`;
    case 'jump': return `jmp ${term.targets[0]}`;
    case 'branch': return `br ${term.condition} ? ${term.targets[0]} : ${term.targets[1]}`;
    case 'unreachable': return 'unreachable';
    default: return `${term.kind} ${term.targets.join(', ')}`;
  }
}
