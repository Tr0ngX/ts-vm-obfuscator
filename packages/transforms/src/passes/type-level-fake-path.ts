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
        const tempA = `r${maxReg + 1}` as Register; // Date global
        const tempB = `r${maxReg + 2}` as Register; // "Date" / "now" string
        const tempC = `r${maxReg + 3}` as Register; // Date.now()
        const tempD = `r${maxReg + 4}` as Register; // 0 or salt constant
        const tempE = `r${maxReg + 5}` as Register; // x = (Date.now() | 0) & 3
        const tempF = `r${maxReg + 6}` as Register; // x^2 or mixed temp
        const tempG = `r${maxReg + 7}` as Register; // 3
        const tempH = `r${maxReg + 8}` as Register; // 3 * x^2 or intermediate
        const tempI = `r${maxReg + 9}` as Register; // 5
        const tempJ = `r${maxReg + 10}` as Register; // 5 * x
        const tempK = `r${maxReg + 11}` as Register; // 3 * x^2 + 5 * x
        const tempL = `r${maxReg + 12}` as Register; // 7
        const tempM = `r${maxReg + 13}` as Register; // 3 * x^2 + 5 * x + 7
        const tempN = `r${maxReg + 14}` as Register; // 4
        const tempO = `r${maxReg + 15}` as Register; // (3 * x^2 + 5 * x + 7) % 4
        const tempP = `r${maxReg + 16}` as Register; // rem === 0
        const tempQ = `r${maxReg + 17}` as Register; // rem !== 0 (always true!)
        const junkTemp1 = `r${maxReg + 18}` as Register;
        const junkTemp2 = `r${maxReg + 19}` as Register;
        const junkTemp3 = `r${maxReg + 20}` as Register; // Extra junk register for decoys

        const regX = currentFunc.params.length > 0 ? currentFunc.params[0]!.register : ('r0' as Register);

        let dateIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'Date');
        if (dateIdx === -1) {
          dateIdx = newCP.length;
          newCP.push({ index: dateIdx, kind: ConstantKind.String, value: 'Date' });
        }

        let nowIdx = newCP.findIndex(cp => cp.kind === ConstantKind.String && cp.value === 'now');
        if (nowIdx === -1) {
          nowIdx = newCP.length;
          newCP.push({ index: nowIdx, kind: ConstantKind.String, value: 'now' });
        }

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

        let twoFiftyFiveIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Number && cp.value === 255);
        if (twoFiftyFiveIdx === -1) {
          twoFiftyFiveIdx = newCP.length;
          newCP.push({ index: twoFiftyFiveIdx, kind: ConstantKind.Number, value: 255 });
        }

        let undefinedIdx = newCP.findIndex(cp => cp.kind === ConstantKind.Undefined);
        if (undefinedIdx === -1) {
          undefinedIdx = newCP.length;
          newCP.push({ index: undefinedIdx, kind: ConstantKind.Undefined, value: null });
        }

        // We choose one of our 5 templates (expanded from 3)
        const templateId = isParanoid ? ctx.rng.nextRange(0, 4) : 0;
        let opaqueInsts: Instruction[] = [];

        if (templateId === 0) {
          // Congruence invariant: (3 * x^2 + 5 * x + 7) % 4 !== 0
          opaqueInsts = [
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: dateIdx }], result: tempB },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempB }], result: tempA },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: nowIdx }], result: tempB },
            { opcode: OpCode.CallMethod, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempC },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },
            { opcode: OpCode.BitOr, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoFiftyFiveIdx }], result: tempG },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // tempE = x = (Date.now() | 0) & 255
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: threeIdx }], result: tempG },
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempE }], result: tempF },
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempG }, { kind: OperandKind.Register, value: tempF }], result: tempH },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: fiveIdx }], result: tempI },
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempI }, { kind: OperandKind.Register, value: tempE }], result: tempJ },
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempH }, { kind: OperandKind.Register, value: tempJ }], result: tempK },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: sevenIdx }], result: tempL },
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempK }, { kind: OperandKind.Register, value: tempL }], result: tempM },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: fourIdx }], result: tempN },
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempM }, { kind: OperandKind.Register, value: tempN }], result: tempO },
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempO }, { kind: OperandKind.Register, value: tempD }], result: tempP },
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        } else if (templateId === 1) {
          // Quadratic non-residue mod 4: ((x * x) & 3) !== 3 (always true!)
          opaqueInsts = [
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: dateIdx }], result: tempB },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempB }], result: tempA },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: nowIdx }], result: tempB },
            { opcode: OpCode.CallMethod, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempC },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },
            { opcode: OpCode.BitOr, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE }, // tempE = Date.now() | 0
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoFiftyFiveIdx }], result: tempG },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // tempE = x = (Date.now() | 0) & 255
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempE }], result: tempF }, // tempF = x * x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: threeIdx }], result: tempG }, // tempG = 3
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempF }, { kind: OperandKind.Register, value: tempG }], result: tempH }, // tempH = (x * x) & 3
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempH }, { kind: OperandKind.Register, value: tempG }], result: tempP },
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        } else if (templateId === 2) {
          // Quadratic non-residue mod 3: (31 * x)^2 % 3 !== 2 (always true!)
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
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: dateIdx }], result: tempB },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempB }], result: tempA },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: nowIdx }], result: tempB },
            { opcode: OpCode.CallMethod, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempC },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },
            { opcode: OpCode.BitOr, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE }, // tempE = Date.now() | 0
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoFiftyFiveIdx }], result: tempG },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // tempE = x = (Date.now() | 0) & 255
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: thirtyOneIdx }], result: tempG }, // tempG = 31
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempG }, { kind: OperandKind.Register, value: tempE }], result: tempF }, // tempF = 31 * x
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempF }, { kind: OperandKind.Register, value: tempF }], result: tempH }, // tempH = (31 * x)^2
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: threeIdx }], result: tempI }, // tempI = 3
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempH }, { kind: OperandKind.Register, value: tempI }], result: tempJ }, // tempJ = (31 * x)^2 % 3
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempL }, // tempL = 2
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempJ }, { kind: OperandKind.Register, value: tempL }], result: tempP },
            { opcode: OpCode.Not, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        } else if (templateId === 3) {
          // Fermat's Little Theorem variant: ((x^2 + x) % 2 === 0) is always true for all integers
          // Because x^2 + x = x(x+1), product of consecutive integers is always even
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
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: dateIdx }], result: tempB },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempB }], result: tempA },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: nowIdx }], result: tempB },
            { opcode: OpCode.CallMethod, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempC },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },
            { opcode: OpCode.BitOr, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoFiftyFiveIdx }], result: tempG },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // tempE = x
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempE }], result: tempF }, // tempF = x^2
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempF }, { kind: OperandKind.Register, value: tempE }], result: tempH }, // tempH = x^2 + x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempI }, // tempI = 2
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempH }, { kind: OperandKind.Register, value: tempI }], result: tempJ }, // tempJ = (x^2 + x) % 2
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempJ }, { kind: OperandKind.Register, value: tempD }], result: tempP }, // tempP = (result === 0), always true
            // Result tempP is already true, so we use it directly as the condition
            { opcode: OpCode.Move, operands: [{ kind: OperandKind.Register, value: tempP }], result: tempQ }
          ];
        } else {
          // Template 4: Parity check: ((x * (x+1)) % 2 === 0) is always true
          // since consecutive integers always have one even
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
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: dateIdx }], result: tempB },
            { opcode: OpCode.LoadGlobal, operands: [{ kind: OperandKind.Register, value: tempB }], result: tempA },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: nowIdx }], result: tempB },
            { opcode: OpCode.CallMethod, operands: [{ kind: OperandKind.Register, value: tempA }, { kind: OperandKind.Register, value: tempB }, { kind: OperandKind.Register, value: tempC }], result: tempC },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: zeroIdx }], result: tempD },
            { opcode: OpCode.BitOr, operands: [{ kind: OperandKind.Register, value: tempC }, { kind: OperandKind.Register, value: tempD }], result: tempE },
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoFiftyFiveIdx }], result: tempG },
            { opcode: OpCode.BitAnd, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempG }], result: tempE }, // tempE = x
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: oneIdx }], result: tempF }, // tempF = 1
            { opcode: OpCode.Add, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempF }], result: tempH }, // tempH = x + 1
            { opcode: OpCode.Mul, operands: [{ kind: OperandKind.Register, value: tempE }, { kind: OperandKind.Register, value: tempH }], result: tempI }, // tempI = x * (x + 1)
            { opcode: OpCode.LoadConst, operands: [{ kind: OperandKind.ConstantIndex, value: twoIdx }], result: tempJ }, // tempJ = 2
            { opcode: OpCode.Mod, operands: [{ kind: OperandKind.Register, value: tempI }, { kind: OperandKind.Register, value: tempJ }], result: tempK }, // tempK = (x * (x+1)) % 2
            { opcode: OpCode.StrictEq, operands: [{ kind: OperandKind.Register, value: tempK }, { kind: OperandKind.Register, value: tempD }], result: tempP }, // tempP = (result === 0), always true
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
          { name: `fake_path_temp_${tempA}`, register: tempA, type: IRType.Object, isCaptured: false },
          { name: `fake_path_temp_${tempB}`, register: tempB, type: IRType.String, isCaptured: false },
          { name: `fake_path_temp_${tempC}`, register: tempC, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempD}`, register: tempD, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempE}`, register: tempE, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempF}`, register: tempF, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempG}`, register: tempG, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempH}`, register: tempH, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempI}`, register: tempI, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempJ}`, register: tempJ, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempK}`, register: tempK, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempL}`, register: tempL, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempM}`, register: tempM, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempN}`, register: tempN, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempO}`, register: tempO, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${tempP}`, register: tempP, type: IRType.Boolean, isCaptured: false },
          { name: `fake_path_temp_${tempQ}`, register: tempQ, type: IRType.Boolean, isCaptured: false },
          { name: `fake_path_temp_${junkTemp1}`, register: junkTemp1, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${junkTemp2}`, register: junkTemp2, type: IRType.Number, isCaptured: false },
          { name: `fake_path_temp_${junkTemp3}`, register: junkTemp3, type: IRType.Any, isCaptured: false }
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
