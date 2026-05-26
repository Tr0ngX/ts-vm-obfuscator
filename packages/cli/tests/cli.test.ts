import { describe, expect, it } from 'vitest';
import {
  applyRuntimeBackendToProfile,
  applyRuntimeHardeningToProfile,
  applySeedToProfile,
  parseRuntimeBackend,
  parseRuntimeHardening,
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

  it('parses and applies VM hardening levels', () => {
    const stealthProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening(undefined));
    const paranoidProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening('paranoid'));
    const offProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening('off'));

    expect(stealthProfile.vm.runtimeHardening).toBe('stealth');
    expect(stealthProfile.vm.stealthDispatch).toBe(true);
    expect(stealthProfile.vm.tamperDetection).toBe(true);
    expect(stealthProfile.vm.antiDebug).toBe(false);
    expect(paranoidProfile.vm.antiDebug).toBe(true);
    expect(offProfile.vm.stealthDispatch).toBe(false);
    expect(() => parseRuntimeHardening('loose')).toThrow('Unsupported hardening');
  });
});
