import { describe, expect, it } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { ObfuscationPipeline, createDefaultProfile } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('universal profile', () => {
  it('builds a compatibility bundle that preserves lowered and fallback exports', async () => {
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
    expect(result.functionReports?.some((report) => report.functionName === 'switchTry' && report.tier === 'js_lowered')).toBe(true);
    expect(result.functionReports?.some((report) => report.functionName === 'destructured' && report.tier === 'js_lowered')).toBe(true);

    const moduleShim = { exports: {} as Record<string, (...args: any[]) => any> };
    new Function('module', result.vmBundles![0]!.fullSource)(moduleShim);

    expect(moduleShim.exports.vmAdd(2, 3)).toBe(5);
    expect(moduleShim.exports.switchTry(1)).toBe('one');
    expect(moduleShim.exports.switchTry(7)).toBe('other');
    expect(moduleShim.exports.destructured({ a: 2 }, 3, 4, 5)).toBe(12);
  });
});
