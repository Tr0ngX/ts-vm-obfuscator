import type {
  IRModule, IRFunction, IRGlobal, IRImport, IRExport,
  ConstantPoolEntry, BasicBlock, Instruction, TerminatorInstruction,
  Operand, IRParam, IRLocal, Register
} from '@tsvm/shared';
import { OpCode, IRType, ConstantKind, FunctionAttribute } from '@tsvm/shared';

export class IRModuleBuilder {
  private functions: IRFunction[] = [];
  private globals: IRGlobal[] = [];
  private imports: IRImport[] = [];
  private exports: IRExport[] = [];
  private constantPool: ConstantPoolEntry[] = [];
  private constantMap = new Map<string, number>();
  private nextFunctionId = 1;

  constructor(public readonly sourceFile: string) {}

  addFunction(fn: IRFunction) {
    this.functions.push(fn);
  }

  addGlobal(g: IRGlobal) {
    this.globals.push(g);
  }

  addImport(imp: IRImport) {
    this.imports.push(imp);
  }

  addExport(exp: IRExport) {
    this.exports.push(exp);
  }

  addConstant(kind: ConstantKind, value: string | number | boolean | null): number {
    const key = `${kind}:${value}`;
    if (this.constantMap.has(key)) {
      return this.constantMap.get(key)!;
    }
    const index = this.constantPool.length;
    this.constantPool.push({ index, kind, value });
    this.constantMap.set(key, index);
    return index;
  }

  build(): IRModule {
    let blockCount = 0;
    let instructionCount = 0;
    for (const f of this.functions) {
      blockCount += f.blocks.length;
      for (const b of f.blocks) {
        instructionCount += b.instructions.length;
      }
    }

    return {
      id: `mod_${Date.now()}`,
      sourceFile: this.sourceFile,
      functions: this.functions,
      globals: this.globals,
      imports: this.imports,
      exports: this.exports,
      constantPool: this.constantPool,
      metadata: {
        sourceFile: this.sourceFile,
        originalByteSize: 0,
        functionCount: this.functions.length,
        blockCount,
        instructionCount,
        buildTimestamp: Date.now()
      }
    };
  }

  getNextFunctionId(): string {
    return `fn_${this.nextFunctionId++}`;
  }
}

export class IRFunctionBuilder {
  private blocks: BasicBlock[] = [];
  private params: IRParam[] = [];
  private locals: IRLocal[] = [];
  private attributes: FunctionAttribute[] = [];
  private capturedVariables: string[] = [];
  private nextRegId = 0;
  private nextBlockId = 0;

  constructor(public readonly id: string, public readonly name: string, public readonly returnType: IRType) {}

  addParam(name: string, type: IRType, isRest = false, defaultValue?: number): Register {
    const reg = this.allocRegister();
    this.params.push({ name, register: reg, type, isRest, defaultValue });
    return reg;
  }

  addLocal(name: string, type: IRType, isCaptured = false): Register {
    const reg = this.allocRegister();
    this.locals.push({ name, register: reg, type, isCaptured });
    return reg;
  }

  addAttribute(attr: FunctionAttribute) {
    if (!this.attributes.includes(attr)) {
      this.attributes.push(attr);
    }
  }

  addCapturedVariable(name: string) {
    if (!this.capturedVariables.includes(name)) {
      this.capturedVariables.push(name);
    }
  }

  allocRegister(): Register {
    return `r${this.nextRegId++}` as Register;
  }

  createBlock(label: string): BasicBlockBuilder {
    const id = `b${this.nextBlockId++}`;
    const block = new BasicBlockBuilder(id, label);
    return block;
  }

  addBlock(block: BasicBlock) {
    this.blocks.push(block);
  }

  getBlockCount(): number {
    return this.blocks.length;
  }

  build(isVirtualized = true, isExported = false): IRFunction {
    return {
      id: this.id,
      name: this.name,
      params: this.params,
      returnType: this.returnType,
      blocks: this.blocks,
      locals: this.locals,
      isVirtualized,
      isExported,
      attributes: this.attributes,
      capturedVariables: this.capturedVariables
    };
  }
}

export class BasicBlockBuilder {
  private instructions: Instruction[] = [];
  private terminator?: TerminatorInstruction;
  private predecessors: string[] = [];
  private successors: string[] = [];

  constructor(public readonly id: string, public readonly label: string) {}

  addInstruction(opcode: OpCode, operands: Operand[], result?: Register) {
    this.instructions.push({ opcode, operands, result });
  }

  setTerminator(term: TerminatorInstruction) {
    this.terminator = term;
    this.successors = [...term.targets];
  }

  addPredecessor(id: string) {
    if (!this.predecessors.includes(id)) {
      this.predecessors.push(id);
    }
  }

  getInstructionCount(): number {
    return this.instructions.length;
  }

  getPredecessorCount(): number {
    return this.predecessors.length;
  }

  getTerminatorKind(): TerminatorInstruction['kind'] | undefined {
    return this.terminator?.kind;
  }

  build(): BasicBlock {
    if (!this.terminator) {
      this.terminator = { kind: 'unreachable', targets: [] };
    }
    return {
      id: this.id,
      label: this.label,
      instructions: this.instructions,
      terminator: this.terminator,
      predecessors: this.predecessors,
      successors: this.successors,
      phiNodes: []
    };
  }
}

export function createInstruction(opcode: OpCode, operands: Operand[], result?: Register): Instruction {
  return { opcode, operands, result };
}

export function createTerminator(kind: TerminatorInstruction['kind'], targets: string[], condition?: Register, returnValue?: Register): TerminatorInstruction {
  return { kind, targets, condition, returnValue };
}
