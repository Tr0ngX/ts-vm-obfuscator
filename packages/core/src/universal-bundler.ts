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
  const cjsFooterMatch = vmSource.match(/\nif \(typeof module !== 'undefined' && module\.exports\) \{([\s\S]*)\}\s*$/);
  if (!cjsFooterMatch) return vmSource.trim();
  const body = cjsFooterMatch[1]!;
  let depth = 0;
  for (const ch of body) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth < 0) return vmSource.trim();
  }
  if (depth === 0) return vmSource.slice(0, cjsFooterMatch.index).trim();
  return vmSource.trim();
}

function extractVmFunctionObjectName(vmSource: string): string {
  const match = /const\s+([A-Za-z_$][\w$]*)\s*=\s*\(function\s*\(/u.exec(vmSource);
  return match?.[1] ?? 'vmFunctions';
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
  vmObjectName: string,
): string {
  const functionName = statement.name!.text;
  const body = statement.body;
  if (!body) {
    throw new Error(`Cannot emit VM wrapper for declaration without body: ${functionName}`);
  }
  const signatureText = transpiledSource.slice(statement.getStart(sourceFile), body.getStart(sourceFile));
  return `${signatureText}{ if (new.target) { return Reflect.construct(${vmObjectName}[${JSON.stringify(functionName)}], Array.prototype.slice.call(arguments), new.target); } return ${vmObjectName}[${JSON.stringify(functionName)}].apply(this, arguments); }`;
}

function buildVmFunctionExpressionWrapper(
  functionName: string,
  initializer: import('typescript').Expression,
  vmObjectName: string,
): string {
  if (ts.isArrowFunction(initializer)) {
    return initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      ? `async (...args) => ${vmObjectName}[${JSON.stringify(functionName)}].apply(this, args)`
      : `(...args) => ${vmObjectName}[${JSON.stringify(functionName)}].apply(this, args)`;
  }
  if (ts.isFunctionExpression(initializer)) {
    return initializer.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      ? `async function (...args) { return ${vmObjectName}[${JSON.stringify(functionName)}].apply(this, args); }`
      : `function (...args) { if (new.target) { return Reflect.construct(${vmObjectName}[${JSON.stringify(functionName)}], args, new.target); } return ${vmObjectName}[${JSON.stringify(functionName)}].apply(this, args); }`;
  }
  throw new Error(`Unsupported top-level VM wrapper initializer for ${functionName}`);
}

function rewriteModuleStatements(
  transpiledSource: string,
  sourceFile: import('typescript').SourceFile,
  reports: readonly FunctionCapabilityReport[],
  vmObjectName: string,
  virtualizedFunctions?: ReadonlySet<string>,
): { readonly rewrittenSource: string; readonly hasVmFunctions: boolean } {
  const topLevelReportMap = buildTopLevelReportMap(sourceFile, reports);
  const replacements: { start: number; end: number; replacementText: string }[] = [];
  let hasVmFunctions = false;

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const functionName = statement.name.text;
      if (virtualizedFunctions && !virtualizedFunctions.has(functionName)) {
        continue;
      }
      const report = topLevelReportMap.get(functionName);
      if (!report) {
        continue;
      }
      if (report.tier === 'unsupported') {
        throw new Error(
          `Universal ESM emitter cannot lower top-level function "${report.functionName}" in ${report.filePath}:${report.startLine}:${report.startColumn}`,
        );
      }
      if (report.tier === 'vm_safe') {
        replacements.push({
          start: statement.getStart(sourceFile),
          end: statement.getEnd(),
          replacementText: buildVmFunctionWrapper(transpiledSource, sourceFile, statement, vmObjectName),
        });
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
        if (virtualizedFunctions && !virtualizedFunctions.has(bindingName)) {
          continue;
        }
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
          const initializerStart = declaration.initializer.getStart(sourceFile);
          const initializerEnd = declaration.initializer.getEnd();
          replacements.push({
            start: initializerStart,
            end: initializerEnd,
            replacementText: buildVmFunctionExpressionWrapper(bindingName, declaration.initializer, vmObjectName),
          });
          hasVmFunctions = true;
        }
      }
    }
  }

  // Sort replacements descending by start position to prevent offset shifting
  replacements.sort((a, b) => b.start - a.start || b.end - a.end);

  let rewritten = transpiledSource;
  for (const r of replacements) {
    rewritten = rewritten.slice(0, r.start) + r.replacementText + rewritten.slice(r.end);
  }

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
  virtualizedFunctions?: ReadonlySet<string>,
): VMRuntimeBundle {
  const sourceText = ts.sys.readFile(moduleInfo.filePath) || '';
  const transpiledSource = transpileModuleToEsm(sourceText, moduleInfo.filePath, compilerOptions);
  const transpiledFile = ts.createSourceFile(
    `${moduleInfo.relativePath}.mjs`,
    transpiledSource,
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  const vmObjectName = vmBundle ? extractVmFunctionObjectName(vmBundle.fullSource) : 'vmFunctions';
  const { rewrittenSource, hasVmFunctions } = rewriteModuleStatements(
    transpiledSource,
    transpiledFile,
    functionReports,
    vmObjectName,
    virtualizedFunctions,
  );

  const loweredFunctions = functionReports.filter((report) => report.tier === 'js_lowered');
  const reportComment =
    loweredFunctions.length > 0
      ? loweredFunctions.map((report) => `// ${report.functionName} -> js_lowered: ${report.reasons.join(', ')}`).join('\n')
      : '// all top-level rewritten functions were vm_safe';

  const vmRuntimeSource = hasVmFunctions && vmBundle ? stripCommonJsFooter(vmBundle.fullSource) : '';
  const esmModuleSource = vmRuntimeSource.length > 0 ? injectVmRuntimeAfterImports(rewrittenSource, vmRuntimeSource) : rewrittenSource;

  const source = `// Universal ESM bundle: ${moduleInfo.relativePath}
${reportComment}
${esmModuleSource}
`.trim();

  return createEmptyBundle(buildId, source);
}
