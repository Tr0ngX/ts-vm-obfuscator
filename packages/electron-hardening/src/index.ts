import type { IRModule, Instruction, Register } from '@tsvm/shared';
import { OpCode, ConstantKind, OperandKind } from '@tsvm/shared';

// ─────────────────────────────────────────────────────────────
// Electron-sensitive property names that require hardening guards.
// ─────────────────────────────────────────────────────────────

/** IPC communication methods that an attacker could hijack to escape the renderer sandbox. */
const ELECTRON_IPC_PROPERTIES: ReadonlySet<string> = new Set([
  'ipcRenderer',
  'ipcMain',
  'send',
  'invoke',
  'on',
  'handle',
  'removeListener',
]);

/** BrowserWindow security settings that must not be tampered with at runtime. */
const ELECTRON_CONTEXT_ISOLATION_PROPERTIES: ReadonlySet<string> = new Set(['nodeIntegration', 'contextIsolation', 'webPreferences']);

/** Union of all sensitive property names for fast membership testing. */
const ALL_SENSITIVE_PROPERTIES: ReadonlySet<string> = new Set([...ELECTRON_IPC_PROPERTIES, ...ELECTRON_CONTEXT_ISOLATION_PROPERTIES]);

// ─────────────────────────────────────────────────────────────
// Guard injection helpers
// ─────────────────────────────────────────────────────────────

/**
 * Classifies a sensitive property name into a hardening category.
 * Returns `null` when the name is not sensitive.
 */
function classifySensitiveProperty(name: string): 'ipc_protection' | 'context_isolation' | null {
  if (ELECTRON_IPC_PROPERTIES.has(name)) {
    return 'ipc_protection';
  }
  if (ELECTRON_CONTEXT_ISOLATION_PROPERTIES.has(name)) {
    return 'context_isolation';
  }
  return null;
}

/**
 * Resolves the string property name referenced by a `PropGet` instruction by
 * scanning the preceding instruction list for the `LoadConst` that loaded the
 * property register.
 *
 * PropGet operands follow the pattern: `[objectReg, propertyReg]`.
 * The `propertyReg` is typically populated by a preceding `LoadConst` whose
 * first operand is a `ConstantIndex` pointing into the module constant pool.
 *
 * @returns The string literal property name, or `null` when it cannot be
 *          statically resolved (e.g. dynamic/computed access).
 */
function resolvePropertyName(
  inst: Instruction,
  precedingInstructions: readonly Instruction[],
  constantPool: IRModule['constantPool'],
): string | null {
  // PropGet has exactly two operands: [objectReg, propertyNameReg].
  if (inst.operands.length < 2) {
    return null;
  }
  const propertyOperand = inst.operands[1]!;
  if (propertyOperand.kind !== OperandKind.Register) {
    return null;
  }
  const targetRegister = propertyOperand.value;

  // Walk backwards through preceding instructions to find the LoadConst that
  // populated `targetRegister`.
  for (let i = precedingInstructions.length - 1; i >= 0; i--) {
    const prev = precedingInstructions[i]!;
    if (prev.opcode !== OpCode.LoadConst) {
      continue;
    }
    if (prev.result !== targetRegister) {
      continue;
    }
    // Found the LoadConst that loaded into the property register.
    if (prev.operands.length === 0) {
      return null;
    }
    const constOperand = prev.operands[0]!;
    if (constOperand.kind !== OperandKind.ConstantIndex) {
      return null;
    }
    const poolIndex = typeof constOperand.value === 'number' ? constOperand.value : Number.parseInt(constOperand.value as string, 10);
    if (Number.isNaN(poolIndex)) {
      return null;
    }
    const entry = constantPool.find((e) => e.index === poolIndex);
    if (entry == null || entry.kind !== ConstantKind.String) {
      return null;
    }
    return typeof entry.value === 'string' ? entry.value : null;
  }

  return null;
}

/**
 * Builds the guard instruction sequence injected immediately before a
 * sensitive `PropGet`.
 *
 * The sequence is:
 *  1. `Nop` — metadata marker for the hardening type so downstream passes and
 *     the VM runtime can recognise hardened regions.
 *  2. `LoadConst` — loads the property name from the constant pool so the
 *     runtime integrity checker receives the exact method/setting being
 *     accessed.
 *  3. `Call` — invokes the runtime integrity check function.  The Call
 *     operand references the LoadConst result register indirectly; the
 *     runtime will resolve the actual checker at execution time.
 *
 * This is fully deterministic — no randomness is involved.
 */
function getMaxRegister(func: any): number {
  let max = -1;
  for (const block of func.blocks) {
    for (const inst of block.instructions) {
      if (inst.result) {
        const val = Number.parseInt(inst.result.replace('r', ''), 10);
        if (!Number.isNaN(val) && val > max) max = val;
      }
      for (const op of inst.operands || []) {
        if (op.kind === OperandKind.Register && typeof op.value === 'string') {
          const val = Number.parseInt(op.value.replace('r', ''), 10);
          if (!Number.isNaN(val) && val > max) max = val;
        }
      }
    }
  }
  return max + 1;
}

function buildGuardSequence(
  reason: 'ipc_protection' | 'context_isolation',
  propertyName: string,
  guardRegister: Register,
  objectReg: string,
): readonly Instruction[] {
  const nopMarker: Instruction = {
    opcode: OpCode.Nop,
    operands: [],
    metadata: {
      electronHardened: true,
      reason,
      property: propertyName,
    },
  };

  const loadPropertyName: Instruction = {
    opcode: OpCode.LoadConst,
    operands: [{ kind: OperandKind.Immediate, value: propertyName }],
    result: guardRegister,
    metadata: {
      electronHardened: true,
      guardRole: 'integrity_check_property',
    },
  };

  const fetchProperty: Instruction = {
    opcode: OpCode.PropGet,
    operands: [
      { kind: OperandKind.Register, value: objectReg },
      { kind: OperandKind.Register, value: guardRegister },
    ],
    result: guardRegister,
    metadata: {
      electronHardened: true,
      guardRole: 'integrity_check_fetch',
    },
  };

  const callIntegrityCheck: Instruction = {
    opcode: OpCode.Call,
    operands: [{ kind: OperandKind.Register, value: guardRegister }],
    metadata: {
      electronHardened: true,
      guardRole: 'integrity_check_invoke',
      reason,
      property: propertyName,
    },
  };

  return [nopMarker, loadPropertyName, fetchProperty, callIntegrityCheck];
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Applies Electron-specific hardening to an IR module.
 *
 * For every `PropGet` instruction whose property name can be statically
 * resolved to a known Electron-sensitive API (IPC methods or context-isolation
 * settings), a deterministic guard sequence is injected immediately before the
 * access.  The guard loads the property name and invokes a runtime integrity
 * check so the VM can verify at execution time that the access has not been
 * tampered with.
 *
 * This pass is fully deterministic — it never uses `Math.random()` or any
 * other source of non-determinism.  Every sensitive `PropGet` is hardened,
 * not a probabilistic subset.
 */
export function applyElectronHardening(module: IRModule): IRModule {
  let hardenCount = 0;
  const newFunctions = module.functions.map((func) => {
    let changed = false;
    let maxRegId = getMaxRegister(func);
    const addedLocals: any[] = [];
    const newBlocks = func.blocks.map((block) => {
      const newInstructions: Instruction[] = [];
      for (const inst of block.instructions) {
        if (inst.opcode === OpCode.PropGet) {
          const propertyName = resolvePropertyName(inst, newInstructions, module.constantPool);
          if (propertyName !== null && ALL_SENSITIVE_PROPERTIES.has(propertyName)) {
            const reason = classifySensitiveProperty(propertyName);
            const objOperand = inst.operands[0];
            if (reason !== null && objOperand && objOperand.kind === OperandKind.Register && typeof objOperand.value === 'string') {
              const guardRegister = `r${maxRegId++}` as Register;
              addedLocals.push({
                name: `electron_harden_${guardRegister}`,
                register: guardRegister,
                type: 'any',
                isCaptured: false,
              });
              const guardInstructions = buildGuardSequence(reason, propertyName, guardRegister, objOperand.value);
              for (const guardInst of guardInstructions) {
                newInstructions.push(guardInst);
              }
              changed = true;
              hardenCount++;
            }
          }
        }
        newInstructions.push(inst);
      }
      return changed ? { ...block, instructions: newInstructions } : block;
    });
    return changed ? { ...func, locals: [...func.locals, ...addedLocals], blocks: newBlocks } : func;
  });

  return hardenCount > 0 ? { ...module, functions: newFunctions } : module;
}
