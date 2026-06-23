import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  applyRuntimeBackendToProfile,
  applyRuntimeHardeningToProfile,
  applySeedToProfile,
  parseRuntimeBackend,
  parseRuntimeHardening,
  parseSeed,
  resolveRuntimeHardening,
  resolveProfileTarget,
  detectProfileFromProjectSync,
} from '../src/options.js';
import { createCliProfile } from '../src/cli.js';

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
    expect(parseRuntimeBackend('javascript')).toBe('js');
    expect(parseRuntimeBackend('wasm')).toBe('wasm_hybrid');
    expect(parseRuntimeBackend('hybrid')).toBe('wasm_hybrid');
    expect(profile.vm.runtimeBackend).toBe('wasm_hybrid');
    expect(() => parseRuntimeBackend('native')).toThrow('Unsupported runtime');
  });

  it('parses and applies VM hardening levels', () => {
    const stealthProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening(undefined));
    const paranoidProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening('max'));
    const offProfile = applyRuntimeHardeningToProfile({ vm: {} }, parseRuntimeHardening('debug'));

    expect(stealthProfile.vm.runtimeHardening).toBe('stealth');
    expect(stealthProfile.vm.stealthDispatch).toBe(true);
    expect(stealthProfile.vm.tamperDetection).toBe(true);
    expect(stealthProfile.vm.antiDebug).toBe(false);
    expect(paranoidProfile.vm.antiDebug).toBe(true);
    expect(offProfile.vm.stealthDispatch).toBe(false);
    expect(resolveRuntimeHardening('stealth', { debugVm: true })).toBe('off');
    expect(resolveRuntimeHardening('off', { paranoid: true })).toBe('paranoid');
    expect(() => resolveRuntimeHardening('stealth', { debugVm: true, paranoid: true })).toThrow('Conflicting');
    expect(() => parseRuntimeHardening('loose')).toThrow('Unsupported hardening');
  });

  it('creates CLI profiles with shorthand runtime and hardening flags', () => {
    const profile = createCliProfile('generic', '123', 'wasm', 'stealth', { paranoid: true });

    expect(profile.seed).toBe(123);
    expect(profile.vm.runtimeBackend).toBe('wasm_hybrid');
    expect(profile.vm.runtimeHardening).toBe('paranoid');
    expect(profile.vm.antiDebug).toBe(true);
  });
});

describe('Profile Auto-Detection', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsvm-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects react profile when react is a dependency', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    expect(detectProfileFromProjectSync(tsconfigPath)).toBe('react');
  });

  it('detects electron profile when electron is a devDependency', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ devDependencies: { electron: '^22.0.0' } }),
    );
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    expect(detectProfileFromProjectSync(tsconfigPath)).toBe('electron');
  });

  it('detects library profile for non-private library projects', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ main: 'dist/index.js', types: 'dist/index.d.ts' }),
    );
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    expect(detectProfileFromProjectSync(tsconfigPath)).toBe('library');
  });

  it('defaults to generic profile when no specific dependencies match', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { lodash: '^4.17.21' } }),
    );
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    expect(detectProfileFromProjectSync(tsconfigPath)).toBe('generic');
  });

  it('resolves default and auto option targets using auto-detection', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ dependencies: { react: '^18.0.0' } }),
    );
    const tsconfigPath = path.join(tmpDir, 'tsconfig.json');
    expect(resolveProfileTarget('auto', tsconfigPath)).toBe('react');
    expect(resolveProfileTarget('default', tsconfigPath)).toBe('react');
  });
});

