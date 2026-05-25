import { createRequire } from 'node:module';
import type { FunctionCapabilityReport, ModuleInfo, VMRuntimeBundle } from '@tsvm/shared';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');
type TypeScriptCompilerOptions = import('typescript').CompilerOptions;

function createEmptyBundle(buildId: string, source: string): VMRuntimeBundle {
  return {
    buildId,
    dispatchLoop: '',
    handlers: [],
    constantDecoder: '',
    bytecodePayload: new Uint8Array(),
    entryBootstrap: '',
    fullSource: source,
  };
}

function transpileModuleToEsm(sourceText: string, filePath: string, compilerOptions: Record<string, unknown>): string {
  return ts.transpileModule(sourceText, {
    fileName: filePath,
    compilerOptions: {
      ...(compilerOptions as TypeScriptCompilerOptions),
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2020,
      sourceMap: false,
      declaration: false,
      declarationMap: false,
      inlineSourceMap: false,
      inlineSources: false,
    },
    reportDiagnostics: false,
  }).outputText;
}

function stripCommonJsFooter(vmSource: string): string {
  return vmSource.replace(/\nif \(typeof module !== 'undefined' && module\.exports\) \{[\s\S]*?\}\s*$/u, '').trim();
}

function buildTopLevelReportMap(
  transpiledFile: import('typescript').SourceFile,
  reports: readonly FunctionCapabilityReport[],
): Map<string, FunctionCapabilityReport> {
  const topLevelReports = new Map<string, FunctionCapabilityReport>();
  for (const statement of transpiledFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const report = reports.find((candidate) => candidate.functionName === statement.name!.text);
      if (report) {
        topLevelReports.set(statement.name.text, report);
      }
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        const bindingName = declaration.name.text;
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          const report = reports.find((candidate) => candidate.functionName === bindingName);
          if (report) {
            topLevelReports.set(bindingName, report);
          }
        }
      }
    }
  }
  return topLevelReports;
}

function buildVmFunctionWrapper(
  transpiledSource: string,
  sourceFile: import('typescript').SourceFile,
  statement: import('typescript').FunctionDeclaration,
): string {
  const functionName = statement.name!.text;
  const body = statement.body;
  if (!body) {
    throw new Error(`Cannot emit VM wrapper for declaration without body: ${functionName}`);
  }
  const signatureText = transpiledSource.slice(statement.getStart(sourceFile), body.getStart(sourceFile));
  return `${signatureText}{ if (new.target) { return Reflect.construct(vmFunctions[${JSON.stringify(functionName)}], Array.prototype.slice.call(arguments), new.target); } return vmFunctions[${JSON.stringify(functionName)}].apply(this, arguments); }`;
}

function buildVmFunctionExpressionWrapper(functionName: string, initializer: import('typescript').Expression): string {
  if (ts.isArrowFunction(initializer)) {
    return initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      ? `async (...args) => vmFunctions[${JSON.stringify(functionName)}].apply(this, args)`
      : `(...args) => vmFunctions[${JSON.stringify(functionName)}].apply(this, args)`;
  }
  if (ts.isFunctionExpression(initializer)) {
    return initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      ? `async function (...args) { return vmFunctions[${JSON.stringify(functionName)}].apply(this, args); }`
      : `function (...args) { if (new.target) { return Reflect.construct(vmFunctions[${JSON.stringify(functionName)}], args, new.target); } return vmFunctions[${JSON.stringify(functionName)}].apply(this, args); }`;
  }
  throw new Error(`Unsupported top-level VM wrapper initializer for ${functionName}`);
}

function rewriteModuleStatements(
  transpiledSource: string,
  sourceFile: import('typescript').SourceFile,
  reports: readonly FunctionCapabilityReport[],
): { readonly rewrittenSource: string; readonly hasVmFunctions: boolean } {
  const topLevelReportMap = buildTopLevelReportMap(sourceFile, reports);
  const replacements = new Map<import('typescript').Statement, string>();
  let hasVmFunctions = false;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const report = topLevelReportMap.get(statement.name.text);
      if (!report) {
        continue;
      }
      if (report.tier === 'unsupported') {
        throw new Error(
          `Universal ESM emitter cannot lower top-level function "${report.functionName}" in ${report.filePath}:${report.startLine}:${report.startColumn}`,
        );
      }
      if (report.tier === 'vm_safe') {
        replacements.set(statement, buildVmFunctionWrapper(transpiledSource, sourceFile, statement));
        hasVmFunctions = true;
      }
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        const bindingName = declaration.name.text;
        if (!ts.isArrowFunction(declaration.initializer) && !ts.isFunctionExpression(declaration.initializer)) {
          continue;
        }
        const report = topLevelReportMap.get(bindingName);
        if (!report) {
          continue;
        }
        if (report.tier === 'unsupported') {
          throw new Error(
            `Universal ESM emitter cannot lower top-level function "${report.functionName}" in ${report.filePath}:${report.startLine}:${report.startColumn}`,
          );
        }
        if (report.tier === 'vm_safe') {
          const statementStart = statement.getStart(sourceFile);
          const statementEnd = statement.getEnd();
          const initializerStart = declaration.initializer.getStart(sourceFile);
          const initializerEnd = declaration.initializer.getEnd();
          replacements.set(
            statement,
            [
              transpiledSource.slice(statementStart, initializerStart),
              buildVmFunctionExpressionWrapper(bindingName, declaration.initializer),
              transpiledSource.slice(initializerEnd, statementEnd),
            ].join(''),
          );
          hasVmFunctions = true;
        }
      }
    }
  }

  let rewritten = '';
  let cursor = 0;
  for (const statement of sourceFile.statements) {
    const start = statement.getStart(sourceFile);
    const end = statement.getEnd();
    rewritten += transpiledSource.slice(cursor, start);
    rewritten += replacements.get(statement) ?? transpiledSource.slice(start, end);
    cursor = end;
  }
  rewritten += transpiledSource.slice(cursor);

  return {
    rewrittenSource: rewritten.trim(),
    hasVmFunctions,
  };
}

function injectVmRuntimeAfterImports(moduleSource: string, vmSource: string): string {
  const sourceFile = ts.createSourceFile('universal-bundle.mjs', moduleSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  let insertionOffset = 0;
  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      insertionOffset = statement.getEnd();
      continue;
    }
    break;
  }

  const prefix = moduleSource.slice(0, insertionOffset);
  const suffix = moduleSource.slice(insertionOffset).trimStart();
  const injected = `${vmSource}\n\n${suffix}`.trim();
  return prefix.length > 0 ? `${prefix}\n\n${injected}` : injected;
}

export function buildUniversalBundle(
  buildId: string,
  moduleInfo: ModuleInfo,
  compilerOptions: Record<string, unknown>,
  functionReports: readonly FunctionCapabilityReport[],
  vmBundle?: VMRuntimeBundle,
): VMRuntimeBundle {
  const sourceText = ts.sys.readFile(moduleInfo.filePath) || '';
  const transpiledSource = transpileModuleToEsm(sourceText, moduleInfo.filePath, compilerOptions);
  const transpiledFile = ts.createSourceFile(`${moduleInfo.relativePath}.mjs`, transpiledSource, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const { rewrittenSource, hasVmFunctions } = rewriteModuleStatements(transpiledSource, transpiledFile, functionReports);

  const loweredFunctions = functionReports.filter((report) => report.tier === 'js_lowered');
  const reportComment = loweredFunctions.length > 0
    ? loweredFunctions
        .map((report) => `// ${report.functionName} -> js_lowered: ${report.reasons.join(', ')}`)
        .join('\n')
    : '// all top-level rewritten functions were vm_safe';

  const vmRuntimeSource = hasVmFunctions && vmBundle ? stripCommonJsFooter(vmBundle.fullSource) : '';
  const esmModuleSource = vmRuntimeSource.length > 0
    ? injectVmRuntimeAfterImports(rewrittenSource, vmRuntimeSource)
    : rewrittenSource;

  const source = `// Universal ESM bundle: ${moduleInfo.relativePath}
${reportComment}
${esmModuleSource}
`.trim();

  return createEmptyBundle(buildId, source);
}
