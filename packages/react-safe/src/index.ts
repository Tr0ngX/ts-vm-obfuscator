import type { Diagnostic, IRFunction, ReactComponentInfo, ConstantPoolEntry } from '@tsvm/shared';
import { DiagnosticSeverity, FunctionAttribute, ReactZoneSafety, OpCode, OperandKind } from '@tsvm/shared';

function isHookLikeFunction(fn: IRFunction): boolean {
  return fn.attributes.includes(FunctionAttribute.ReactHook) || fn.name.startsWith('use');
}

function isReactComponentLike(fn: IRFunction): boolean {
  return (
    fn.attributes.includes(FunctionAttribute.ReactComponent) ||
    (/^[A-Z]/.test(fn.name) && (fn.name.includes('Provider') || fn.name.includes('Context')))
  );
}

export function checkReactSafety(fn: IRFunction): boolean {
  return !isHookLikeFunction(fn) && !isReactComponentLike(fn);
}

export function collectReactComponentInfo(
  functions: readonly IRFunction[],
  filePath: string,
): ReactComponentInfo[] {
  return functions
    .filter((fn) => isHookLikeFunction(fn) || isReactComponentLike(fn))
    .map((fn) => {
      const hooks = isHookLikeFunction(fn) ? [fn.name] : [];
      const safety = checkReactSafety(fn) ? ReactZoneSafety.FullySafe : ReactZoneSafety.Forbidden;

      return {
        name: fn.name,
        filePath,
        isClassComponent: false,
        isFunctionComponent: isReactComponentLike(fn),
        hooks,
        renderBlockId: fn.blocks[0]?.id,
        eventHandlers: [],
        memoizedCallbacks: [],
        safeZones: new Map([[fn.id, safety]]),
      };
    });
}

export function createReactSafetyDiagnostics(
  functions: readonly IRFunction[],
  filePath: string,
): Diagnostic[] {
  return functions
    .filter((fn) => !checkReactSafety(fn))
    .map((fn) => ({
      severity: DiagnosticSeverity.Warning,
      code: 'REACT_SAFE_VIRTUALIZATION_DISABLED',
      message: `Disabled virtualization for React-sensitive function "${fn.name}" in ${filePath}.`,
    }));
}

export function enforceReactProfile(functions: readonly IRFunction[], constantPool?: readonly ConstantPoolEntry[]) {
  let disabledCount = 0;
  const disabledIds = new Set<string>();

  for (const fn of functions) {
    if (!checkReactSafety(fn)) {
      if (fn.isVirtualized) {
        (fn as { isVirtualized: boolean }).isVirtualized = false;
        disabledCount++;
      }
      disabledIds.add(fn.id);
    }
  }

  if (constantPool) {
    const childToParent = new Map<string, string>();
    for (const fn of functions) {
      for (const block of fn.blocks) {
        for (const inst of block.instructions) {
          if (inst.opcode === OpCode.ClosureNew && inst.operands[0]?.kind === OperandKind.ConstantIndex) {
            const constIdx = inst.operands[0].value as number;
            const entry = constantPool[constIdx];
            if (entry && typeof entry.value === 'string') {
              childToParent.set(entry.value, fn.id);
            }
          }
        }
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      for (const fn of functions) {
        if (!fn.isVirtualized) {
          continue;
        }
        let hasDisabledChild = false;
        for (const [childId, parentId] of childToParent.entries()) {
          if (parentId === fn.id && disabledIds.has(childId)) {
            hasDisabledChild = true;
            break;
          }
        }
        if (hasDisabledChild) {
          (fn as { isVirtualized: boolean }).isVirtualized = false;
          disabledIds.add(fn.id);
          disabledCount++;
          changed = true;
        }
      }
    }
  }

  return disabledCount;
}
