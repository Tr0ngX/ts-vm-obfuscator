import { describe, expect, it } from 'vitest';
import { FunctionAttribute, IRType, ReactZoneSafety, type IRFunction } from '@tsvm/shared';
import { checkReactSafety, collectReactComponentInfo, createReactSafetyDiagnostics, enforceReactProfile } from '../src/index.js';

function createFunction(
  name: string,
  attributes: FunctionAttribute[] = [],
  isVirtualized = true,
): IRFunction {
  return {
    id: `${name}-id`,
    name,
    params: [],
    returnType: IRType.Void,
    blocks: [
      {
        id: `${name}-block`,
        label: 'entry',
        instructions: [],
        terminator: { kind: 'return', targets: [] },
        predecessors: [],
        successors: [],
        phiNodes: [],
      },
    ],
    locals: [],
    isVirtualized,
    isExported: false,
    attributes,
    capturedVariables: [],
  };
}

describe('React Safe Detector', () => {
  it('detects hooks and marks them unsafe for virtualization', () => {
    const hook = createFunction('useWidget', [FunctionAttribute.ReactHook]);

    expect(checkReactSafety(hook)).toBe(false);

    const info = collectReactComponentInfo([hook], 'src/widget.tsx');
    expect(info).toHaveLength(1);
    expect(info[0]?.hooks).toEqual(['useWidget']);
    expect(info[0]?.safeZones.get(hook.id)).toBe(ReactZoneSafety.Forbidden);
  });

  it('disables virtualization and emits diagnostics for React-sensitive functions', () => {
    const component = createFunction('ThemeProvider', [FunctionAttribute.ReactComponent]);
    const disabledCount = enforceReactProfile([component]);
    const diagnostics = createReactSafetyDiagnostics([component], 'src/theme.tsx');

    expect(disabledCount).toBe(1);
    expect(component.isVirtualized).toBe(false);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.code).toBe('REACT_SAFE_VIRTUALIZATION_DISABLED');
  });
});
