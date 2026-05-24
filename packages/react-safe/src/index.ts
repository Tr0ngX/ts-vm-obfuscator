import type { Diagnostic, IRFunction, ReactComponentInfo } from '@tsvm/shared';
import { DiagnosticSeverity, FunctionAttribute, ReactZoneSafety } from '@tsvm/shared';

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

export function enforceReactProfile(functions: readonly IRFunction[]) {
  let disabledCount = 0;
  for (const fn of functions) {
    if (!checkReactSafety(fn) && fn.isVirtualized) {
      (fn as { isVirtualized: boolean }).isVirtualized = false;
      disabledCount++;
    }
  }
  return disabledCount;
}
