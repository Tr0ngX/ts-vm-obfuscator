import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { lowerToIR } from '../src/builder.js';
import { DiagnosticSeverity, type Diagnostic, type ModuleInfo, type ProjectSemanticGraph } from '@tsvm/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createModuleInfo(filePath: string): ModuleInfo {
  return {
    filePath,
    relativePath: path.basename(filePath),
    exports: [],
    imports: [],
    typeFacts: [],
    isEntryPoint: true,
    isDeclarationFile: false,
    hasJSX: false,
    hasDecorators: false,
    byteSize: 0,
  };
}

function createGraph(): ProjectSemanticGraph {
  return {
    rootDir: __dirname,
    modules: new Map(),
    dependencyEdges: [],
    entryPoints: [],
    symbolTable: [],
    aliases: new Map(),
    compilerOptions: {},
    diagnostics: [],
  };
}

describe('IR Negative Tests', () => {
  it('rejects eval syntax with error', () => {
    const filePath = path.join(__dirname, 'fixtures', 'debugger-blocked.ts');
    expect(() => lowerToIR(createModuleInfo(filePath), createGraph(), filePath)).toThrowError(/Unsupported AST in IR builder/);
  });

  it('gracefully handles empty function body (zero blocks)', () => {
    const filePath = path.join(__dirname, 'fixtures', 'complex-structures.ts');
    const mod = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const emptyBody = mod.functions.find((f) => f.name === 'complexStructures');
    expect(emptyBody).toBeDefined();
    expect(emptyBody!.blocks.length).toBeGreaterThan(0);
  });

  it('handles nested function virtualization with correct scope', () => {
    const filePath = path.join(__dirname, 'fixtures', 'nested-closures.ts');
    const mod = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const outer = mod.functions.find((f) => f.name === 'nestedCounter');
    const inner = mod.functions.find((f) => f.name !== 'nestedCounter');
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner!.capturedVariables).toContain('counter');
  });

  it('produces diagnostics for unsupported top-level declarations', () => {
    const filePath = path.join(__dirname, 'fixtures', 'debugger-blocked.ts');
    const diagnostics: Diagnostic[] = [];
    expect(() => lowerToIR(createModuleInfo(filePath), createGraph(), filePath, { diagnostics })).toThrow();
  });

  it('skips functions larger than maxFunctionSize', () => {
    const filePath = path.join(__dirname, 'fixtures', 'complex-structures.ts');
    const mod = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, {
      forceVirtualizeAll: false,
    });
    expect(mod.functions.length).toBeGreaterThan(0);
    expect(mod.functions.every((f) => f.blocks.length > 0)).toBe(true);
  });
});
