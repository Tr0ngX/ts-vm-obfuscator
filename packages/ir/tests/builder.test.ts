import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { lowerToIR } from '../src/builder.js';
import { DiagnosticSeverity, FunctionAttribute, OpCode, type Diagnostic, type ModuleInfo, type ProjectSemanticGraph } from '@tsvm/shared';
import { analyzeFunctionCapabilities } from '../src/capabilities.js';

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

  it('lowers the syntax-pack regression fixture', () => {
    const filePath = path.join(__dirname, 'fixtures', 'syntax-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'syntaxPack');

    expect(fn).toBeDefined();
    const instructions = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));

    expect(instructions).toContain(OpCode.New);
    expect(instructions).toContain(OpCode.ClosureNew);
    expect(instructions).toContain(OpCode.LoadLocal);
    expect(instructions).toContain(OpCode.Call);
    expect(fn!.blocks.some((block) => block.terminator.kind === 'branch')).toBe(true);
  });

  it('lowers do-while, switch, break/continue, and throw', () => {
    const filePath = path.join(__dirname, 'fixtures', 'control-flow-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'controlFlowPack');
    const throwing = module.functions.find((candidate) => candidate.name === 'throwingPack');

    expect(fn).toBeDefined();
    expect(throwing).toBeDefined();

    const controlOpcodes = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(controlOpcodes).toContain(OpCode.StrictEq);
    expect(controlOpcodes).toContain(OpCode.Add);
    expect(fn!.blocks.some((block) => block.terminator.kind === 'branch')).toBe(true);
    expect(fn!.blocks.some((block) => block.label.includes('switch'))).toBe(true);

    expect(throwing!.blocks.some((block) => block.terminator.kind === 'throw')).toBe(true);
  });

  it('lowers for-of, for-in, and destructuring declarations', () => {
    const filePath = path.join(__dirname, 'fixtures', 'iteration-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'iterationPack');

    expect(fn).toBeDefined();
    const opcodes = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));

    expect(opcodes).toContain(OpCode.CallMethod);
    expect(opcodes).toContain(OpCode.ComputedGet);
    expect(opcodes).toContain(OpCode.PropGet);
    expect(opcodes).toContain(OpCode.Lt);
    expect(fn!.blocks.some((block) => block.label.includes('forof'))).toBe(true);
    expect(fn!.blocks.some((block) => block.label.includes('forin'))).toBe(true);
  });

  it('analyzes function capabilities for universal tiering', () => {
    const filePath = path.join(__dirname, 'fixtures', 'mixed-support.ts');
    const reports = analyzeFunctionCapabilities(filePath);

    expect(reports.find((report) => report.functionName === 'supportedAdd')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'unsupportedTryCatch')?.tier).toBe('vm_safe');
  });

  it('keeps iteration-heavy syntax in vm_safe tier after lowering support is added', () => {
    const filePath = path.join(__dirname, 'fixtures', 'iteration-pack.ts');
    const reports = analyzeFunctionCapabilities(filePath);

    expect(reports.find((report) => report.functionName === 'iterationPack')?.tier).toBe('vm_safe');
  });

  it('lowers try/catch/finally syntax into vm-safe IR', () => {
    const filePath = path.join(__dirname, 'fixtures', 'exception-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const tryCatchFn = module.functions.find((candidate) => candidate.name === 'tryCatchPack');
    const tryCatchFinallyFn = module.functions.find((candidate) => candidate.name === 'tryCatchFinallyPack');

    expect(tryCatchFn).toBeDefined();
    expect(tryCatchFinallyFn).toBeDefined();
    expect(reports.find((report) => report.functionName === 'tryCatchPack')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'tryCatchFinallyPack')?.tier).toBe('vm_safe');
    expect(tryCatchFn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode))).toContain(OpCode.TryCatchBegin);
    expect(tryCatchFn!.blocks.some((block) => block.terminator.kind === 'throw')).toBe(true);
    expect(tryCatchFinallyFn!.blocks.some((block) => block.label.includes('try_finally'))).toBe(true);
  });

  it('lowers the binding pack into vm-safe IR', () => {
    const filePath = path.join(__dirname, 'fixtures', 'binding-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'bindingPack');
    const paramFn = module.functions.find((candidate) => candidate.name === 'parameterPack');
    const arrowFn = module.functions.find((candidate) => candidate.name === 'arrayPatternArrow');

    expect(fn).toBeDefined();
    expect(paramFn).toBeDefined();
    expect(arrowFn).toBeDefined();
    expect(reports.find((report) => report.functionName === 'bindingPack')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'parameterPack')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'arrayPatternArrow')?.tier).toBe('vm_safe');

    const opcodes = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(opcodes).toContain(OpCode.ArrayNew);
    expect(opcodes).toContain(OpCode.ObjectNew);
    expect(opcodes).toContain(OpCode.ComputedGet);
    expect(opcodes).toContain(OpCode.ComputedSet);
    expect(opcodes).toContain(OpCode.PropGet);
    expect(opcodes).toContain(OpCode.PropSet);
    expect(opcodes).toContain(OpCode.CallMethod);
    expect(opcodes).toContain(OpCode.Spread);
    expect(fn!.blocks.some((block) => block.label.includes('try_catch'))).toBe(true);
  });

  it('lowers iterable spread and sparse array holes into vm-safe IR', () => {
    const filePath = path.join(__dirname, 'fixtures', 'expression-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const fn = module.functions.find((candidate) => candidate.name === 'expressionPack');

    expect(fn).toBeDefined();
    expect(reports.find((report) => report.functionName === 'expressionPack')?.tier).toBe('vm_safe');

    const opcodes = fn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(opcodes).toContain(OpCode.ArrayNew);
    expect(opcodes).toContain(OpCode.Spread);
    expect(opcodes).toContain(OpCode.PropSet);
    expect(opcodes).toContain(OpCode.CallMethodWithArray);
    expect(opcodes).toContain(OpCode.NewWithArray);
  });

  it('keeps this and new.target semantics on the vm-safe path', () => {
    const filePath = path.join(__dirname, 'fixtures', 'this-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const thisFn = module.functions.find((candidate) => candidate.name === 'thisPack');
    const newTargetFn = module.functions.find((candidate) => candidate.name === 'newTargetPack');

    expect(thisFn).toBeDefined();
    expect(newTargetFn).toBeDefined();
    expect(reports.find((report) => report.functionName === 'thisPack')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'newTargetPack')?.tier).toBe('vm_safe');

    const thisOpcodes = thisFn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    const newTargetOpcodes = newTargetFn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(thisOpcodes).toContain(OpCode.LoadThis);
    expect(newTargetOpcodes).toContain(OpCode.LoadNewTarget);
  });

  it('lowers nested lexical this and lexical new.target arrows through closure captures', () => {
    const filePath = path.join(__dirname, 'fixtures', 'this-arrow-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const lexicalThisHost = module.functions.find((candidate) => candidate.name === 'lexicalThisArrowHost');
    const lexicalNewTargetHost = module.functions.find((candidate) => candidate.name === 'lexicalNewTargetArrowHost');
    const nestedLexicalArrows = module.functions.filter((candidate) => candidate.attributes.includes(FunctionAttribute.Arrow));

    expect(lexicalThisHost).toBeDefined();
    expect(lexicalNewTargetHost).toBeDefined();
    expect(reports.find((report) => report.functionName === 'lexicalThisArrowHost')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'lexicalNewTargetArrowHost')?.tier).toBe('vm_safe');

    expect(nestedLexicalArrows).toHaveLength(2);
    expect(nestedLexicalArrows.every((candidate) => candidate.attributes.includes(FunctionAttribute.Nested))).toBe(true);
    expect(reports.filter((report) => report.functionName === '<anonymous>').every((report) => report.tier === 'vm_safe')).toBe(true);

    const nestedLexicalThis = nestedLexicalArrows.find((candidate) => candidate.capturedVariables.includes('$$vm_lexical_this'));
    const nestedLexicalNewTarget = nestedLexicalArrows.find((candidate) => candidate.capturedVariables.includes('$$vm_lexical_new_target'));

    expect(nestedLexicalThis).toBeDefined();
    expect(nestedLexicalNewTarget).toBeDefined();
    expect(nestedLexicalThis!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode))).toContain(OpCode.EnvGet);
    expect(nestedLexicalThis!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode))).not.toContain(OpCode.LoadThis);
    expect(nestedLexicalNewTarget!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode))).toContain(OpCode.EnvGet);
    expect(nestedLexicalNewTarget!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode))).not.toContain(OpCode.LoadNewTarget);

    const unsupportedFilePath = path.join(__dirname, 'fixtures', 'this-arrow-unsupported.ts');
    const unsupportedReports = analyzeFunctionCapabilities(unsupportedFilePath);
    expect(unsupportedReports.find((report) => report.functionName === 'topLevelLexicalThisArrow')?.tier).toBe('js_lowered');
    expect(unsupportedReports.find((report) => report.functionName === 'topLevelLexicalNewTargetArrow')?.tier).toBe('js_lowered');
  });

  it('lowers verified async/await functions into vm-safe IR', () => {
    const filePath = path.join(__dirname, 'fixtures', 'async-pack.ts');
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath);
    const reports = analyzeFunctionCapabilities(filePath);
    const asyncFn = module.functions.find((candidate) => candidate.name === 'asyncPack');
    const asyncArrow = module.functions.find((candidate) => candidate.name === 'asyncArrowPack');

    expect(asyncFn).toBeDefined();
    expect(asyncArrow).toBeDefined();
    expect(reports.find((report) => report.functionName === 'asyncPack')?.tier).toBe('vm_safe');
    expect(reports.find((report) => report.functionName === 'asyncArrowPack')?.tier).toBe('vm_safe');
    expect(asyncFn!.attributes).toContain(FunctionAttribute.Async);
    expect(asyncArrow!.attributes).toContain(FunctionAttribute.Async);

    const asyncOpcodes = asyncFn!.blocks.flatMap((block) => block.instructions.map((inst) => inst.opcode));
    expect(asyncOpcodes).toContain(OpCode.Await);
    expect(asyncFn!.blocks.some((block) => block.label.includes('try_catch'))).toBe(true);
  });

  it('skips unsupported functions in compatibility fallback mode', () => {
    const filePath = path.join(__dirname, 'fixtures', 'mixed-support.ts');
    const diagnostics: Diagnostic[] = [];
    const module = lowerToIR(createModuleInfo(filePath), createGraph(), filePath, {
      forceVirtualizeAll: true,
      compatibilityFallback: true,
      diagnostics,
    });

    expect(module.functions.some((candidate) => candidate.name === 'supportedAdd')).toBe(true);
    expect(module.functions.some((candidate) => candidate.name === 'unsupportedTryCatch')).toBe(true);
    expect(diagnostics.some((diag) => diag.code === 'IR_UNIVERSAL_FALLBACK' && diag.severity === DiagnosticSeverity.Warning)).toBe(false);
  });
});
