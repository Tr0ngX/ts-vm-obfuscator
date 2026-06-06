import type { TransformPass, TransformContext, TransformResult, IRModule, ConstantPoolEntry, IRFunction, Instruction, BasicBlock, IRLocal, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind, IRType } from '@tsvm/shared';

export class StringPoolEncodingPass implements TransformPass {
  readonly name = 'StringPoolEncodingPass';
  readonly priority = 70;

  execute(ctx: TransformContext): TransformResult {
    const config = ctx.profile.transforms.find(t => t.name === this.name);
    const fragmentStrings = config?.options?.['fragmentStrings'] ?? true;
    const minLength = (config?.options?.['minLength'] as number) ?? 3;

    if (!fragmentStrings) {
      return {
        module: ctx.module,
        symbolsRenamed: 0,
        nodesTransformed: 0,
        diagnostics: []
      };
    }

    let nextConstantIndex = ctx.module.constantPool.length;
    const newConstantPool = [...ctx.module.constantPool];

    // Helper to find or add a string constant
    const getOrAddStringConstant = (val: string): number => {
      const existing = newConstantPool.find(c => c.kind === ConstantKind.String && c.value === val);
      if (existing) {
        return existing.index;
      }
      const newIdx = nextConstantIndex++;
      newConstantPool.push({
        index: newIdx,
        kind: ConstantKind.String,
        value: val
      });
      return newIdx;
    };

    // Helper to find or add a number constant
    const getOrAddNumberConstant = (val: number): number => {
      const existing = newConstantPool.find(c => c.kind === ConstantKind.Number && c.value === val);
      if (existing) {
        return existing.index;
      }
      const newIdx = nextConstantIndex++;
      newConstantPool.push({
        index: newIdx,
        kind: ConstantKind.Number,
        value: val
      });
      return newIdx;
    };

    let nodesTransformed = 0;

    const newFunctions = ctx.module.functions.map(fn => {
      // Find maximum register ID in function
      let maxRegId = 0;
      const regPattern = /^r(\d+)$/;
      const checkReg = (r: string | undefined) => {
        if (!r) return;
        const match = regPattern.exec(r);
        if (match) {
          const id = parseInt(match[1]!, 10);
          if (id > maxRegId) maxRegId = id;
        }
      };

      fn.params.forEach(p => checkReg(p.register));
      fn.locals.forEach(l => checkReg(l.register));

      fn.blocks.forEach(block => {
        block.instructions.forEach(inst => {
          checkReg(inst.result);
          inst.operands.forEach(op => {
            if (op.kind === OperandKind.Register) {
              checkReg(op.value as string);
            }
          });
        });
        if (block.terminator.condition) checkReg(block.terminator.condition);
        if (block.terminator.returnValue) checkReg(block.terminator.returnValue);
      });

      let nextTempRegId = maxRegId + 1;
      const addedLocals: IRLocal[] = [];

      const newBlocks = fn.blocks.map(block => {
        const newInstructions: Instruction[] = [];

        block.instructions.forEach(inst => {
          if (inst.opcode === OpCode.LoadConst && inst.operands.length > 0 && inst.result) {
            const op = inst.operands[0]!;
            if (op.kind === OperandKind.ConstantIndex) {
              const constIndex = op.value as number;
              const constant = ctx.module.constantPool[constIndex];

              if (constant && constant.kind === ConstantKind.String && typeof constant.value === 'string' && constant.value.length >= minLength) {
                const fullStr = constant.value;
                const baseKey = ctx.rng.nextRange(1, 255);

                const r_arr = `r${nextTempRegId++}` as Register;
                const r_val = `r${nextTempRegId++}` as Register;
                const r_key = `r${nextTempRegId++}` as Register;
                const r_dec = `r${nextTempRegId++}` as Register;
                const r_idx = `r${nextTempRegId++}` as Register;
                const r_string_str = `r${nextTempRegId++}` as Register;
                const r_string = `r${nextTempRegId++}` as Register;
                const r_from_char_code_str = `r${nextTempRegId++}` as Register;
                const r_from_char_code = `r${nextTempRegId++}` as Register;

                // Track and register dynamic locals
                addedLocals.push(
                  { name: `str_pool_temp_${r_arr}`, register: r_arr, type: IRType.Any, isCaptured: false },
                  { name: `str_pool_temp_${r_val}`, register: r_val, type: IRType.Number, isCaptured: false },
                  { name: `str_pool_temp_${r_key}`, register: r_key, type: IRType.Number, isCaptured: false },
                  { name: `str_pool_temp_${r_dec}`, register: r_dec, type: IRType.Number, isCaptured: false },
                  { name: `str_pool_temp_${r_idx}`, register: r_idx, type: IRType.Number, isCaptured: false },
                  { name: `str_pool_temp_${r_string_str}`, register: r_string_str, type: IRType.String, isCaptured: false },
                  { name: `str_pool_temp_${r_string}`, register: r_string, type: IRType.Any, isCaptured: false },
                  { name: `str_pool_temp_${r_from_char_code_str}`, register: r_from_char_code_str, type: IRType.String, isCaptured: false },
                  { name: `str_pool_temp_${r_from_char_code}`, register: r_from_char_code, type: IRType.Any, isCaptured: false }
                );

                const stringNameIdx = getOrAddStringConstant('String');
                const fromCharCodeIdx = getOrAddStringConstant('fromCharCode');

                const stringPoolInsts: Instruction[] = [
                  {
                    opcode: OpCode.ArrayNew,
                    operands: [],
                    result: r_arr,
                    sourceLocation: inst.sourceLocation
                  }
                ];

                // Per-character cascading key derivation:
                // charKey_i = ((baseKey * (i + 1)) ^ prevEncoded ^ (i * 37)) & 0xFF
                // prevEncoded starts as baseKey, then becomes the current encoded value
                let prevEncoded = baseKey;
                for (let i = 0; i < fullStr.length; i++) {
                  const charKey = ((baseKey * (i + 1)) ^ prevEncoded ^ (i * 37)) & 0xFF;
                  // Ensure charKey is non-zero to avoid identity XOR
                  const effectiveKey = charKey === 0 ? 1 : charKey;
                  const encoded = fullStr.charCodeAt(i) ^ effectiveKey;
                  prevEncoded = encoded & 0xFF;

                  const valIdx = getOrAddNumberConstant(encoded);
                  const keyIdx = getOrAddNumberConstant(effectiveKey);
                  const idxIdx = getOrAddNumberConstant(i);

                  stringPoolInsts.push(
                    {
                      opcode: OpCode.LoadConst,
                      operands: [{ kind: OperandKind.ConstantIndex, value: valIdx }],
                      result: r_val,
                      sourceLocation: inst.sourceLocation
                    },
                    {
                      opcode: OpCode.LoadConst,
                      operands: [{ kind: OperandKind.ConstantIndex, value: keyIdx }],
                      result: r_key,
                      sourceLocation: inst.sourceLocation
                    },
                    {
                      opcode: OpCode.BitXor,
                      operands: [
                        { kind: OperandKind.Register, value: r_val },
                        { kind: OperandKind.Register, value: r_key }
                      ],
                      result: r_dec,
                      sourceLocation: inst.sourceLocation
                    },
                    {
                      opcode: OpCode.LoadConst,
                      operands: [{ kind: OperandKind.ConstantIndex, value: idxIdx }],
                      result: r_idx,
                      sourceLocation: inst.sourceLocation
                    },
                    {
                      opcode: OpCode.ComputedSet,
                      operands: [
                        { kind: OperandKind.Register, value: r_arr },
                        { kind: OperandKind.Register, value: r_idx },
                        { kind: OperandKind.Register, value: r_dec }
                      ],
                      sourceLocation: inst.sourceLocation
                    }
                  );
                }

                stringPoolInsts.push(
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: stringNameIdx }],
                    result: r_string_str,
                    sourceLocation: inst.sourceLocation
                  },
                  {
                    opcode: OpCode.LoadGlobal,
                    operands: [{ kind: OperandKind.Register, value: r_string_str }],
                    result: r_string,
                    sourceLocation: inst.sourceLocation
                  },
                  {
                    opcode: OpCode.LoadConst,
                    operands: [{ kind: OperandKind.ConstantIndex, value: fromCharCodeIdx }],
                    result: r_from_char_code_str,
                    sourceLocation: inst.sourceLocation
                  },
                  {
                    opcode: OpCode.PropGet,
                    operands: [
                      { kind: OperandKind.Register, value: r_string },
                      { kind: OperandKind.Register, value: r_from_char_code_str }
                    ],
                    result: r_from_char_code,
                    sourceLocation: inst.sourceLocation
                  },
                  {
                    opcode: OpCode.CallWithArray,
                    operands: [
                      { kind: OperandKind.Register, value: r_from_char_code },
                      { kind: OperandKind.Register, value: r_arr }
                    ],
                    result: inst.result,
                    sourceLocation: inst.sourceLocation
                  }
                );

                newInstructions.push(...stringPoolInsts);
                nodesTransformed++;
                return;
              }
            }
          }

          newInstructions.push(inst);
        });

        return {
          ...block,
          instructions: newInstructions
        };
      });

      return {
        ...fn,
        locals: [...fn.locals, ...addedLocals],
        blocks: newBlocks
      };
    });

    const newModule: IRModule = {
      ...ctx.module,
      constantPool: newConstantPool,
      functions: newFunctions
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
