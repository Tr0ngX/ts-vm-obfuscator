import ts from 'typescript';
import type { ProjectSemanticGraph, ModuleInfo, Diagnostic } from '@tsvm/shared';
import { DiagnosticSeverity } from '@tsvm/shared';
import { buildModuleGraph } from './module-graph.js';
import { buildSymbolTable } from './symbol-table.js';
import path from 'path';

export function analyzeProject(tsconfigPath: string, entryPoints?: readonly string[]): ProjectSemanticGraph {
  const diagnostics: Diagnostic[] = [];

  // Read and parse tsconfig
  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(`Failed to read tsconfig: ${configFile.error.messageText}`);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(tsconfigPath));

  if (parsedConfig.errors.length > 0) {
    const errorMsg = parsedConfig.errors.map((e) => e.messageText).join(', ');
    throw new Error(`Invalid tsconfig: ${errorMsg}`);
  }

  const rootNames = entryPoints && entryPoints.length > 0 ? entryPoints : parsedConfig.fileNames;

  // Create Program
  const program = ts.createProgram({
    rootNames,
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();

  // Build Module Graph (extracts type facts, imports, exports)
  const { modules, dependencyEdges, entries } = buildModuleGraph(program, checker);

  // Build Global Symbol Table and Alias Map
  const { symbolTable, aliases } = buildSymbolTable(modules);

  // Collect TypeScript Diagnostics
  const tsDiagnostics = ts.getPreEmitDiagnostics(program);
  for (const diag of tsDiagnostics) {
    diagnostics.push({
      severity:
        diag.category === 1 /* ts.DiagnosticCategory.Error */
          ? DiagnosticSeverity.Error
          : diag.category === 0 /* ts.DiagnosticCategory.Warning */
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Info,
      code: `TS${diag.code}`,
      message: ts.flattenDiagnosticMessageText(diag.messageText, '\n'),
      location: diag.file
        ? {
            filePath: diag.file.fileName,
            line: diag.file.getLineAndCharacterOfPosition(diag.start!).line,
            column: diag.file.getLineAndCharacterOfPosition(diag.start!).character,
            offset: diag.start!,
            length: diag.length!,
          }
        : undefined,
    });
  }

  return {
    rootDir: program.getCurrentDirectory(),
    modules,
    dependencyEdges,
    entryPoints: entries,
    symbolTable,
    aliases,
    compilerOptions: parsedConfig.options as Record<string, unknown>,
    diagnostics,
  };
}
