import type { IRFunction, IRModule } from '@tsvm/shared';
import { FunctionAttribute } from '@tsvm/shared';

// Ensures that a function is safe to be obfuscated without breaking React's rules (hooks, etc.)
export function checkReactSafety(fn: IRFunction): boolean {
  if (fn.attributes.includes(FunctionAttribute.ReactHook)) {
    // Hooks cannot be safely virtualized without careful preservation of call order
    return false;
  }
  
  // Detect custom hooks
  if (fn.name.startsWith('use')) {
    return false;
  }

  // Detect likely React components (Capitalized name returning JSX)
  // In a real semantic graph we'd check if return type is JSX.Element
  if (/^[A-Z]/.test(fn.name) && (fn.name.includes('Provider') || fn.name.includes('Context'))) {
    return false; // Components shouldn't be virtualized completely to keep devtools working
  }

  return true;
}

export function enforceReactProfile(functions: readonly IRFunction[]) {
  let disabledCount = 0;
  for (const fn of functions) {
    if (!checkReactSafety(fn)) {
      if (fn.isVirtualized) {
        (fn as any).isVirtualized = false;
        disabledCount++;
      }
    }
  }
  return disabledCount;
}
