import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { lowerToIR } from '../src/builder.js';
import { OpCode, TypeFactKind, type ModuleInfo, type ProjectSemanticGraph } from '@tsvm/shared';

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

describe('IR builder', () => {
  it('lowers array and object literals with computed access and branches', () => {
    const filePath = path.join(__dirname, 'fixtures', 'complex-structures.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'complexStructures');

    expect(fn).toBeDefined();
    const instructions = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));

    expect(instructions).toContain(OpCode.ArrayNew);
    expect(instructions).toContain(OpCode.ObjectNew);
    expect(instructions).toContain(OpCode.ComputedGet);
    expect(instructions).toContain(OpCode.ComputedSet);
    expect(instructions).toContain(OpCode.PropSet);
    expect(fn!.blocks.some((block) => block.terminator.kind === 'branch')).toBe(true);
  });
});
