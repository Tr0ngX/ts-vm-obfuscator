import { describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { ObfuscationPipeline, createDefaultProfile } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('universal profile', () => {
  it('builds an ESM universal bundle that preserves vm-safe and js-lowered exports', async () => {
    const fixtureRoot = path.join(__dirname, 'fixtures', 'universal-project');
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tsvm-universal-'));
    const pipeline = new ObfuscationPipeline({
      tsconfigPath: path.join(fixtureRoot, 'tsconfig.json'),
      profile: createDefaultProfile('universal'),
      outDir,
    });

    const result = await pipeline.execute();

    expect(result.success).toBe(true);
    expect(result.vmBundles?.length).toBe(1);
    expect(result.functionReports?.some((report) => report.functionName === 'vmArrow' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'switchTry' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'destructured' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'lifted' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'spreadHoles' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'thisAware' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'ctorAware' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'lexicalThisLifted' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'lexicalCtorLifted' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'classLifted' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'asyncVm' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'asyncLifted' && report.tier === 'vm_safe')).toBe(true);
    expect(result.functionReports?.every((report) => report.tier !== 'unsupported')).toBe(true);
    expect(result.vmBundles![0]!.fullSource.includes('module.exports')).toBe(false);
    expect(result.vmBundles![0]!.fullSource.includes('Object.assign(__nativeModule.exports')).toBe(false);
    expect(result.vmBundles![0]!.fullSource.includes('const __nativeModule')).toBe(false);

    const bundlePath = path.join(outDir, `${result.vmBundles![0]!.buildId}.mjs`);
    await fs.writeFile(bundlePath, result.vmBundles![0]!.fullSource, 'utf-8');
    const imported = await import(`${pathToFileURL(bundlePath).href}?t=${Date.now()}`) as Record<string, (...args: any[]) => any>;

    expect(imported.vmAdd(2, 3)).toBe(5);
    expect(imported.vmArrow(4, 5)).toBe(21);
    expect(imported.switchTry(1)).toBe('one');
    expect(imported.switchTry(7)).toBe('other');
    expect(imported.destructured({ a: 2 }, 3, 4, 5)).toBe(12);
    expect(imported.lifted({ value: 2 })).toBe(5);
    expect(imported.spreadHoles()).toBe('7:0|2|3|5|6:AB:2');
    expect(imported.thisAware.call({ label: 'ctx' }, 'hello')).toBe('hello:ctx');
    expect(imported.thisAware('hello')).toBe('hello:none');
    expect(new (imported.ctorAware as new (value: number) => { value: number })(7).value).toBe(7);
    expect(imported.ctorAware(7)).toBe(6);
    expect(imported.lexicalThisLifted.call({ label: 'ctx' }, 'hello')).toBe('hello:ctx');
    expect(imported.lexicalThisLifted('hello')).toBe('hello:none');
    expect(new (imported.lexicalCtorLifted as new (value: number) => { value: number })(7).value).toBe(7);
    expect(imported.lexicalCtorLifted(7)).toBe(6);
    expect(imported.classLifted(4)).toBe('Local:6');
    await expect(imported.asyncVm(4)).resolves.toBe(12);
    await expect(imported.asyncLifted(4)).resolves.toBe(15);
  });
});
