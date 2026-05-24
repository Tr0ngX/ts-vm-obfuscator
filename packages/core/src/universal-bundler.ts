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

export function buildUniversalBundle(
  buildId: string,
  moduleInfo: ModuleInfo,
  compilerOptions: Record<string, unknown>,
  functionReports: readonly FunctionCapabilityReport[],
  vmBundle?: VMRuntimeBundle,
): VMRuntimeBundle {
  const sourceText = ts.sys.readFile(moduleInfo.filePath) || '';
  const transpiled = ts.transpileModule(sourceText, {
    fileName: moduleInfo.filePath,
    compilerOptions: {
      ...(compilerOptions as TypeScriptCompilerOptions),
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      sourceMap: false,
      declaration: false,
      declarationMap: false,
      inlineSourceMap: false,
      inlineSources: false,
    },
    reportDiagnostics: false,
  });

  const loweredOrFallback = functionReports.filter((report) => report.tier !== 'vm_safe');
  const reportComment = loweredOrFallback.length > 0
    ? loweredOrFallback
        .map((report) => `// ${report.functionName} -> ${report.tier}: ${report.reasons.join(', ')}`)
        .join('\n')
    : '// all discovered functions were vm_safe';

  const vmBootstrap = vmBundle
    ? `
const __vmModule = { exports: {} };
(function(module) {
${vmBundle.fullSource}
})(__vmModule);
Object.assign(__nativeModule.exports, __vmModule.exports);
`
    : '';

  const source = `// Universal compatibility bundle: ${moduleInfo.relativePath}
${reportComment}
const __nativeModule = { exports: {} };
const __nativeExports = __nativeModule.exports;
const __universalRequire = typeof require === 'function'
  ? require
  : function(name) { throw new Error('require is unavailable in this universal bundle: ' + name); };
(function(require, module, exports) {
${transpiled.outputText}
})(__universalRequire, __nativeModule, __nativeExports);
${vmBootstrap}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = __nativeModule.exports;
}
`.trim();

  return createEmptyBundle(buildId, source);
}
