import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { lowerToIR } from '../src/builder.js';
import { FunctionAttribute, OpCode, type ModuleInfo, type ProjectSemanticGraph } from '@tsvm/shared';

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

  it('lowers nested function expressions, arrows, and object methods via ClosureNew', () => {
    const filePath = path.join(__dirname, 'fixtures', 'nested-functions.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const outer = module.functions.find((candidate) => candidate.name === 'nestedFactories');

    expect(outer).toBeDefined();

    const outerOpcodes = outer!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(outerOpcodes).toContain(OpCode.ClosureNew);

    const nestedFunctions = module.functions.filter((candidate) => candidate.name !== 'nestedFactories');
    expect(nestedFunctions).toHaveLength(3);
    expect(nestedFunctions.some((candidate) => candidate.attributes.includes(FunctionAttribute.Arrow))).toBe(true);
    expect(nestedFunctions.some((candidate) => candidate.attributes.includes(FunctionAttribute.Method))).toBe(true);
    expect(nestedFunctions.every((candidate) => candidate.attributes.includes(FunctionAttribute.Nested))).toBe(true);
  });

  it('boxes captured locals and records closure captures', () => {
    const filePath = path.join(__dirname, 'fixtures', 'nested-closures.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const outer = module.functions.find((candidate) => candidate.name === 'nestedCounter');
    const inner = module.functions.find((candidate) => candidate.name !== 'nestedCounter');

    expect(outer).toBeDefined();
    expect(inner).toBeDefined();

    const outerOpcodes = outer!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    const innerOpcodes = inner!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));

    expect(outerOpcodes).toContain(OpCode.CellNew);
    expect(outerOpcodes).toContain(OpCode.CellSet);
    expect(outerOpcodes).toContain(OpCode.ClosureNew);
    expect(innerOpcodes).toContain(OpCode.EnvGet);
    expect(innerOpcodes).toContain(OpCode.CellGet);
    expect(innerOpcodes).toContain(OpCode.CellSet);
    expect(inner!.capturedVariables).toContain('counter');
  });

  it('still fails loudly for unsupported AST with location context', () => {
    const filePath = path.join(__dirname, 'fixtures', 'nested-capture-failure.ts');

    expect(() => lowerToIR(createModuleInfo(filePath), createGraph(), filePath)).toThrowError(
      /Unsupported AST in IR builder: .* at .*nested-capture-failure\.ts:\d+:\d+ near /
    );
  });
});
