import type { DispatchTable } from './dispatch.js';
import { dispatchLoop } from './dispatch.js';

export interface StackFrame {
  retPc: number;
  retReg: number;
  framePointer: number;
}

export class VMRuntime {
  registers: unknown[] = new Array(256).fill(undefined);
  callStack: StackFrame[] = [];
  constantPool: unknown[] = [];
  pc: number = 0;
  halted: boolean = false;
  traceLog: string[] = [];
  
  constructor(public config: { trace: boolean }) {}

  execute(bytecode: Uint8Array, table: DispatchTable): unknown {
    this.halted = false;
    this.pc = 0;
    dispatchLoop(this, bytecode, table);
    return this.registers[0]; // Assuming r0 holds the return value
  }

  pushFrame(retPc: number, retReg: number) {
    this.callStack.push({ retPc, retReg, framePointer: this.registers.length });
  }

  popFrame() {
    return this.callStack.pop();
  }

  logTrace(msg: string) {
    if (this.config.trace) {
      this.traceLog.push(msg);
    }
  }
}
