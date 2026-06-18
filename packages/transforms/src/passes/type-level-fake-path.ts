import type { TransformPass, TransformContext, TransformResult, IRModule, IRFunction, Instruction, BasicBlock, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind, IRType } from '@tsvm/shared';

/**
 * 1) Invariant dau vao: Cac ham thuc thi logic binh thuong.
 * 2) Invariant dau ra: Tao ra cac block ma chet (dead code) chua logic phuc tap (fake path)
 *    nhung duoc ket noi qua opaque predicates (dieu kien luon sai nhung kho phan tich tinh).
 * 3) Node kinds dung toi: BasicBlock, Instruction (JmpIf).
 * 4) Edge cases: Can can than khong lam tang overhead qua muc, hoac pha vo register allocation.
 */
export class TypeLevelFakePathPass implements TransformPass {
  readonly name = 'TypeLevelFakePathPass';
  readonly priority = 30;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    const newCP = [...ctx.module.constantPool];

    function getMaxRegister(func: IRFunction): number {
      let maxReg = 0;
      const consider = (value: string | undefined) => {
        if (!value) return;
        const m = /^r(\d+)$/.exec(value);
        if (m) {
          maxReg = Math.max(maxReg, parseInt(m[1]!, 10));
        }
      };

      for (const param of func.params) {
        consider(param.register);
      }
      for (const local of func.locals) {
        consider(local.register);
      }
      for (const block of func.blocks) {
        if (block.phiNodes) {
          for (const phi of block.phiNodes) {
            consider(phi.result);
            for (const incoming of phi.incoming) {
              consider(incoming.register);
            }
          }
        }
        for (const inst of block.instructions) {
          consider(inst.result);
          for (const op of inst.operands) {
            if (op.kind === OperandKind.Register && typeof op.value === 'string') {
              consider(op.value);
            }
          }
        }
        consider(block.terminator.condition);
        consider(block.terminator.returnValue);
      }
      return maxReg;
    }

    /**
     * Collect 2-3 plausible decoy instructions from random real blocks.
     * Rewrites result registers to use the provided junk temporaries so
     * the instructions are syntactically valid but semantically dead.
     */
    function collectDecoyInstructions(
      func: IRFunction,
      junkRegs: Register[],
      rng: typeof ctx.rng
    ): Instruction[] {
      // Only consider non-fake, non-trivial blocks
      const realBlocks = func.blocks.filter(
        b => !b.id.startsWith('__fake_path_') && b.instructions.length >= 2
      );
      if (realBlocks.length === 0) return [];

      const sourceBlock = rng.pick(realBlocks);
      const count = Math.min(rng.nextRange(2, 3), sourceBlock.instructions.length);
      const startIdx = rng.nextRange(0, Math.max(0, sourceBlock.instructions.length - count));
      const decoys: Instruction[] = [];

      for (let d = 0; d < count; d++) {
        const origInst = sourceBlock.instructions[startIdx + d];
        if (!origInst) break;
        // Skip control-flow or side-effecting opcodes that could cause issues
        if (
          origInst.opcode === OpCode.Jmp ||
          origInst.opcode === OpCode.JmpIf ||
          origInst.opcode === OpCode.JmpIfNot ||
          origInst.opcode === OpCode.Return ||
          origInst.opcode === OpCode.ReturnVoid ||
          origInst.opcode === OpCode.Throw ||
          origInst.opcode === OpCode.Trap ||
          origInst.opcode === OpCode.Halt ||
          origInst.opcode === OpCode.Call ||
          origInst.opcode === OpCode.CallMethod ||
          origInst.opcode === OpCode.New
        ) {
          continue;
        }
        const junkReg = junkRegs[d % junkRegs.length]!;
        decoys.push({
          ...origInst,
          result: origInst.result ? junkReg : origInst.result,
          sourceLocation: undefined, // Strip source location from decoys
          metadata: undefined
        });
      }
      return decoys;
    }

    /**
     * Build diversified fake block ending instructions.
     * Randomly chooses from: Trap, Return(undefined), or a decoy-real-code
     * sequence (LoadConst + Add + Move + Return) to prevent trivial identification.
     */
    function buildFakeBlockEnding(
      rng: typeof ctx.rng,
      junkTemp1: Register,
      junkTemp2: Register,
      regX: Register,
      fortyTwoIdx: number,
      undefinedIdx: number
    ): { instructions: Instruction[]; terminatorKind: 'return' | 'unreachable' } {
      const endingType = rng.nextRange(0, 2);

      if (endingType === 0) {
        // Original: Trap instruction
        return {
          instructions: [{ opcode: OpCode.Trap, operands: [] }],
          terminatorKind: 'unreachable'
        };
      } else if (endingType === 1) {
        // Return(undefined) — looks like a normal early return
        return {
          instructions: [
            {
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: undefinedIdx }],
              result: junkTemp1
            }
          ],
          terminatorKind: 'return'
        };
      } else {
        // Decoy real-code sequence: LoadConst + Add + Move + ReturnVoid
        return {
          instructions: [
            {
              opcode: OpCode.LoadConst,
              operands: [{ kind: OperandKind.ConstantIndex, value: fortyTwoIdx }],
              result: junkTemp1
            },
            {
              opcode: OpCode.Add,
              operands: [
                { kind: OperandKind.Register, value: junkTemp1 },
                { kind: OperandKind.Register, value: regX }
              ],
              result: junkTemp2
            },
            {
              opcode: OpCode.Move,
              operands: [
                { kind: OperandKind.Register, value: junkTemp2 },
                { kind: OperandKind.Register, value: junkTemp1 }
              ]
            }
          ],
          terminatorKind: 'return'
        };
      }
    }

    const newFunctions = ctx.module.functions.map(func => {
      if (!func.isVirtualized) return func;
      if (func.blocks.length < 3) return func;

      const isParanoid = ctx.profile.vm?.runtimeHardening === 'paranoid';

      // Apply 25% of the time per eligible function, unless paranoid which is 100% or high probability
      if (!isParanoid && ctx.rng.nextFloat() >= 0.25) {
        return func;
      }

      let eligibleBlocks = func.blocks.filter(b => b.terminator.kind === 'jump');
      if (eligibleBlocks.length === 0) {
        return func;
      }

      const numFakes = isParanoid ? ctx.rng.nextRange(1, 3) : 1;
      let currentFunc = { ...func };

      for (let f = 0; f < numFakes; f++) {
        eligibleBlocks = currentFunc.blocks.filter(b => b.terminator.kind === 'jump' && !b.id.startsWith('__fake_path_'));
        if (eligibleBlocks.length === 0) break;

        const blockToModify = ctx.rng.pick(eligibleBlocks);
        if (!blockToModify.terminator.targets || blockToModify.terminator.targets.length === 0) {
          continue;
        }

        nodesTransformed++;

        const maxReg = getMaxRegister(currentFunc);
        // Streamlined register allocation — GetEntropy replaces Date.now() reflection
        // Old: 20 registers for Date global lookup + CallMethod + BitOr/BitAnd masking
        // New: 10 registers — GetEntropy loads entropy directly into a register
        const tempA = `r${maxReg + 1}` as Register; // x = GetEntropy result (0-255)
        const tempB = `r${maxReg + 2}` as Register; // x^2 or intermediate computation
        const tempC = `r${maxReg + 3}` as Register; // constant loader / multiplied result
        const tempD = `r${maxReg + 4}` as Register; // constant loader / comparison target
        const tempE = `r${maxReg + 5}` as Register; // intermediate result
        const tempF = `r${maxReg + 6}` as Register; // intermediate result
        const tempG = `r${maxReg + 7}` as Register; // modulo / final math result
        const tempP = `r${maxReg + 8}` as Register;  // predicate equality check
        const tempQ = `r${maxReg + 9}` as Register;  // final condition (always true!)
        const junkTemp1 = `r${maxReg + 10}` as Register;
        const junkTemp2 = `r${maxReg + 11}` as Register;
        const junkTemp3 = `r${maxReg + 12}` as Register;

        const regX = currentFunc.params.length > 0 ? currentFunc.params[0]!.register : ('r0' as Register);

        // Shared constants — only allocate what we need (no more "Date" / "now" strings)
        let zeroIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 0);
        if (zeroIdx === -1) {
          zeroIdx = newCP.length;
          newCP.push({ index: zeroIdx, kind: ConstantKind.Number, value: 0 });
        }

        let threeIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 3);
        if (threeIdx === -1) {
          threeIdx = newCP.length;
          newCP.push({ index: threeIdx, kind: ConstantKind.Number, value: 3 });
        }

        let fiveIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 5);
        if (fiveIdx === -1) {
          fiveIdx = newCP.length;
          newCP.push({ index: fiveIdx, kind: ConstantKind.Number, value: 5 });
        }

        let sevenIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 7);
        if (sevenIdx === -1) {
          sevenIdx = newCP.length;
          newCP.push({ index: sevenIdx, kind: ConstantKind.Number, value: 7 });
        }

        let fourIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 4);
        if (fourIdx === -1) {
          fourIdx = newCP.length;
          newCP.push({ index: fourIdx, kind: ConstantKind.Number, value: 4 });
        }

        let fortyTwoIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 42);
        if (fortyTwoIdx === -1) {
          fortyTwoIdx = newCP.length;
          newCP.push({ index: fortyTwoIdx, kind: ConstantKind.Number, value: 42 });
        }

        let undefinedIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Undefined);
        if (undefinedIdx === -1) {
          undefinedIdx = newCP.length;
          newCP.push({ index: undefinedIdx, kind: ConstantKind.Undefined, value: null });
        }

        // Setup EB-COP constants
        let processIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'process');
        if (processIdx === -1) {
          processIdx = newCP.length;
          newCP.push({ index: processIdx, kind: ConstantKind.String, value: 'process' });
        }

        let windowIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'window');
        if (windowIdx === -1) {
          windowIdx = newCP.length;
          newCP.push({ index: windowIdx, kind: ConstantKind.String, value: 'window' });
        }

        let lengthIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'length');
        if (lengthIdx === -1) {
          lengthIdx = newCP.length;
          newCP.push({ index: lengthIdx, kind: ConstantKind.String, value: 'length' });
        }

        let thirtyOneIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 31);
        if (thirtyOneIdx === -1) {
          thirtyOneIdx = newCP.length;
          newCP.push({ index: thirtyOneIdx, kind: ConstantKind.Number, value: 31 });
        }

        let fifteenIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 15);
        if (fifteenIdx === -1) {
          fifteenIdx = newCP.length;
          newCP.push({ index: fifteenIdx, kind: ConstantKind.Number, value: 15 });
        }

        let eightIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 8);
        if (eightIdx === -1) {
          eightIdx = newCP.length;
          newCP.push({ index: eightIdx, kind: ConstantKind.Number, value: 8 });
        }

        let errorIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'Error');
        if (errorIdx === -1) {
          errorIdx = newCP.length;
          newCP.push({ index: errorIdx, kind: ConstantKind.String, value: 'Error' });
        }

        let stackIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'stack');
        if (stackIdx === -1) {
          stackIdx = newCP.length;
          newCP.push({ index: stackIdx, kind: ConstantKind.String, value: 'stack' });
        }

        let stringIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'string');
        if (stringIdx === -1) {
          stringIdx = newCP.length;
          newCP.push({ index: stringIdx, kind: ConstantKind.String, value: 'string' });
        }

        // We choose one of our 5 templates
        const templateId = isParanoid ? ctx.rng.nextRange(0, 4) : 0;
        let opaqueInsts: Instruction[] = [];

        // ─── ALL TEMPLATES NOW USE GetEntropy ───
        // GetEntropy loads a dynamic 0-255 value derived from VM internal state
        // directly into a register. No external API calls, no global lookups,
        // no Date.now() reflection, no 32-bit overflow bugs.

        if (templateId === 0) {
          // EB-COP (Environment-Bound Cryptographic Opaque Predicates)
          // Verifies the global environment process/window strings signature, hashes it,
          // and ensures the stack object behaves as a valid string.
          opaqueInsts = [
            // 1. typeof process length
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: processIdx }], result: tempA },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempA },
            { opcode: OpCode.TypeOf, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempB },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: lengthIdx }], result: tempC },
            { opcode: OpCode.PropGet, operands: [{ kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempD }, // len1
            
            // 2. typeof window length
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: windowIdx }], result: tempA },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempA },
            { opcode: OpCode.TypeOf, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempE },
            { opcode: OpCode.PropGet, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempC }], result: tempF }, // len2

            // 3. hash = (len1 * 31 + len2) & 0xF
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: thirtyOneIdx }], result: tempA },
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempD }, { kind: OperandKind.Register, value: tempA }], result: tempG }, // len1 * 31
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempG }, { kind: OperandKind.Register, value: tempF }], result: tempG }, // len1 * 31 + len2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: fifteenIdx }], result: tempA },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempG }, { kind: OperandKind.Register, value: tempA }], result: tempG }, // hash = tempG & 15

            // 4. (hash * hash + 5) % 8 !== 0
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempG }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // hash * hash
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: fiveIdx }], result: tempA },
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempA }], result: tempE }, // hash * hash + 5
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: eightIdx }], result: tempA },
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempA }], result: tempE }, // (hash*hash+5) % 8
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempA },
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempA }], result: tempE }, // hashMod === 0
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempE }], result: tempP }, // envOpaque = !hashModEqualsZero

            // 5. stack = new Error().stack, typeof stack === 'string'
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: errorIdx }], result: tempA },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempA },
            { opcode: OpCode.New, operands: [{ kind: OperandKind.Register, value: tempA }], result: tempB },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: stackIdx }], result: tempC },
            { opcode: OpCode.PropGet, operands: [{ kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempD }, // stack
            { opcode: OpCode.TypeOf, operands: [{ kind: OperandKind.Register, value: tempD }], result: tempE }, // typeof stack
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: stringIdx }], result: tempA },
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempA }], result: tempF }, // typeof stack === 'string'

            // 6. envPredicate = (rEnvOpaque === rIsString)
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempP }, { kind: OperandKind.Register, value: tempF }], result: tempQ } // tempQ is envPredicate (always true)
          ];
        } else if (templateId === 1) {
          // Quadratic non-residue mod 4: (x^2 & 3) !== 3 (always true!)
          // Proof: x^2 mod 4 ∈ {0,1} for all integers. Never 3. ∎
          opaqueInsts = [
            { opcode: OpCode.GetEntropy, operands: [], result: tempA },                     // tempA = x
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempA }], result: tempB },  // tempB = x^2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: threeIdx }], result: tempC },          // tempC = 3
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempD }, // tempD = x^2 & 3
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempD }, { kind: OperandKind.Register, value: tempC }], result: tempP }, // tempP = (x^2 & 3 === 3), always false
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }                         // tempQ = true
          ];
        } else if (templateId === 2) {
          // Quadratic non-residue mod 3: (31 * x)^2 % 3 !== 2 (always true!)
          // Proof: For any integer n, n^2 mod 3 ∈ {0,1}. Never 2. ∎
          let thirtyOneIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 31);
          if (thirtyOneIdx === -1) {
            thirtyOneIdx = newCP.length;
            newCP.push({ index: thirtyOneIdx, kind: ConstantKind.Number, value: 31 });
          }
          let twoIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 2);
          if (twoIdx === -1) {
            twoIdx = newCP.length;
            newCP.push({ index: twoIdx, kind: ConstantKind.Number, value: 2 });
          }
          opaqueInsts = [
            { opcode: OpCode.GetEntropy, operands: [], result: tempA },                     // tempA = x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: thirtyOneIdx }], result: tempC },      // tempC = 31
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempA }], result: tempB },  // tempB = 31*x
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempB }], result: tempD },  // tempD = (31*x)^2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: threeIdx }], result: tempC },          // tempC = 3
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempD }, { kind: OperandKind.Register, value: tempC }], result: tempE },  // tempE = (31*x)^2 % 3
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempC },            // tempC = 2
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempC }], result: tempP }, // tempP = false always
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }                         // tempQ = true
          ];
        } else if (templateId === 3) {
          // Fermat parity: (x^2 + x) % 2 === 0 is always true
          // Proof: x^2 + x = x(x+1), product of consecutive integers is always even. ∎
          let twoIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 2);
          if (twoIdx === -1) {
            twoIdx = newCP.length;
            newCP.push({ index: twoIdx, kind: ConstantKind.Number, value: 2 });
          }
          opaqueInsts = [
            { opcode: OpCode.GetEntropy, operands: [], result: tempA },                     // tempA = x
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempA }], result: tempB },  // tempB = x^2
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempA }], result: tempC },  // tempC = x^2 + x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempD },            // tempD = 2
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE },  // tempE = (x^2+x) % 2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },           // tempD = 0
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempD }], result: tempP }, // always true
            { opcode: OpCode.Move, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        } else {
          // Template 4: Consecutive parity: (x * (x+1)) % 2 === 0 is always true
          let twoIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 2);
          if (twoIdx === -1) {
            twoIdx = newCP.length;
            newCP.push({ index: twoIdx, kind: ConstantKind.Number, value: 2 });
          }
          let oneIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 1);
          if (oneIdx === -1) {
            oneIdx = newCP.length;
            newCP.push({ index: oneIdx, kind: ConstantKind.Number, value: 1 });
          }
          opaqueInsts = [
            { opcode: OpCode.GetEntropy, operands: [], result: tempA },                     // tempA = x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: oneIdx }], result: tempC },            // tempC = 1
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempC }], result: tempB },  // tempB = x+1
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }], result: tempD },  // tempD = x*(x+1)
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempC },            // tempC = 2
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempD }, { kind: OperandKind.Register, value: tempC }], result: tempE },  // tempE = x*(x+1) % 2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempC },           // tempC = 0
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempC }], result: tempP }, // always true
            { opcode: OpCode.Move, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        }

        const fakeBlockId = `__fake_path_${ctx.rng.identifier(6)}`;

        // Collect decoy instructions from real blocks to make fake block plausible
        const decoyInsts = collectDecoyInstructions(
          currentFunc,
          [junkTemp1, junkTemp2, junkTemp3],
          ctx.rng
        );

        // Build diversified ending (not always Trap)
        const ending = buildFakeBlockEnding(
          ctx.rng,
          junkTemp1,
          junkTemp2,
          regX,
          fortyTwoIdx,
          undefinedIdx
        );

        const fakeBlock: BasicBlock = {
          id: fakeBlockId,
          label: 'fake_path',
          instructions: [
            ...decoyInsts,
            ...ending.instructions
          ],
          terminator: {
            kind: ending.terminatorKind,
            targets: []
          },
          predecessors: [blockToModify.id],
          successors: [],
          phiNodes: []
        };

        const originalTarget = blockToModify.terminator.targets[0]!;

        const newBlocks = currentFunc.blocks.flatMap(block => {
          if (block.id === blockToModify.id) {
            const updatedBlock: BasicBlock = {
              ...block,
              instructions: [...block.instructions, ...opaqueInsts],
              terminator: {
                kind: 'branch',
                targets: [originalTarget, fakeBlock.id],
                condition: tempQ
              },
              successors: [originalTarget, fakeBlock.id]
            };
            return [updatedBlock, fakeBlock];
          }
          return [block];
        });

        const addedLocals = [
          { name: `fake_path_entropy_${tempA}`, register: tempA, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempB}`, register: tempB, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempC}`, register: tempC, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempD}`, register: tempD, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempE}`, register: tempE, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempF}`, register: tempF, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempG}`, register: tempG, type: IRType.Number, isCaptured: false },
          { name: `fake_path_pred_${tempP}`, register: tempP, type: IRType.Boolean, isCaptured: false },
          { name: `fake_path_cond_${tempQ}`, register: tempQ, type: IRType.Boolean, isCaptured: false },
          { name: `fake_path_junk_${junkTemp1}`, register: junkTemp1, type: IRType.Number, isCaptured: false },
          { name: `fake_path_junk_${junkTemp2}`, register: junkTemp2, type: IRType.Number, isCaptured: false },
          { name: `fake_path_junk_${junkTemp3}`, register: junkTemp3, type: IRType.Any, isCaptured: false }
        ];

        currentFunc = {
          ...currentFunc,
          locals: [...currentFunc.locals, ...addedLocals],
          blocks: newBlocks
        };
      }

      return currentFunc;
    });

    return {
      module: { ...ctx.module, functions: newFunctions, constantPool: newCP },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
