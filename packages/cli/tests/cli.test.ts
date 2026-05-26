import { describe, expect, it } from 'vitest';
import {
  applyRuntimeBackendToProfile,
  applySeedToProfile,
  parseRuntimeBackend,
  parseSeed,
  resolveProfileTarget,
} from '../src/options.js';

describe('CLI helpers', () => {
  it('maps the default profile alias to generic', () => {
    expect(resolveProfileTarget('default')).toBe('generic');
    expect(resolveProfileTarget('react')).toBe('react');
    expect(resolveProfileTarget('universal')).toBe('universal');
  });

  it('applies the provided seed to both profile and VM config', () => {
    const profile = applySeedToProfile(
      {
        seed: 1,
        vm: { seed: 1 },
      },
      123,
    );

    expect(profile.seed).toBe(123);
    expect(profile.vm.seed).toBe(123);
  });

  it('rejects invalid seeds', () => {
    expect(() => parseSeed('abc')).toThrow('Invalid seed');
  });

  it('rejects unsupported profiles', () => {
    expect(() => resolveProfileTarget('max')).toThrow('Unsupported profile');
  });

  it('parses and applies VM runtime backend selection', () => {
    const profile = applyRuntimeBackendToProfile(
      {
        vm: {},
      },
      parseRuntimeBackend('wasm-hybrid'),
    );

    expect(parseRuntimeBackend(undefined)).toBe('js');
    expect(profile.vm.runtimeBackend).toBe('wasm_hybrid');
    expect(() => parseRuntimeBackend('native')).toThrow('Unsupported runtime');
  });
});
