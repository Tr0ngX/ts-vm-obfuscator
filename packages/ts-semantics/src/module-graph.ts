import ts from 'typescript';
import type { ModuleInfo, DependencyEdge, ExportedSymbol, ImportedSymbol } from '@tsvm/shared';
import { TypeFactKind } from '@tsvm/shared';
import { extractTypeFacts } from './type-facts.js';

export function buildModuleGraph(program: ts.Program, checker: ts.TypeChecker) {
  const modules = new Map<string, ModuleInfo>();
  const dependencyEdges: DependencyEdge[] = [];
  const entries: string[] = [];

  const sourceFiles = program.getSourceFiles().filter(sf => !sf.isDeclarationFile && !sf.fileName.includes('node_modules'));

  // First pass: create ModuleInfo for each file
  for (const sf of sourceFiles) {
    const filePath = sf.fileName;
    const typeFacts = extractTypeFacts(sf, checker);
    
    // Find exports and imports
    const exports: ExportedSymbol[] = [];
    const imports: ImportedSymbol[] = [];
    
    let hasJSX = false;
    let hasDecorators = false;

    ts.forEachChild(sf, function visit(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
        hasJSX = true;
      }
      if (ts.canHaveDecorators(node) && ts.getDecorators(node)?.length) {
        hasDecorators = true;
      }

      // Imports
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
        const isTypeOnly = node.importClause?.isTypeOnly ?? false;
        
        if (node.importClause) {
          if (node.importClause.name) {
            // Default import
            imports.push({
              localName: node.importClause.name.text,
              importedName: 'default',
              moduleSpecifier,
              kind: 'default',
              isTypeOnly
            });
          }
          if (node.importClause.namedBindings) {
            if (ts.isNamedImports(node.importClause.namedBindings)) {
              // Named imports
              node.importClause.namedBindings.elements.forEach(el => {
                imports.push({
                  localName: el.name.text,
                  importedName: el.propertyName ? el.propertyName.text : el.name.text,
                  moduleSpecifier,
                  kind: 'named',
                  isTypeOnly: isTypeOnly || el.isTypeOnly
                });
              });
            } else if (ts.isNamespaceImport(node.importClause.namedBindings)) {
              // Namespace import
              imports.push({
                localName: node.importClause.namedBindings.name.text,
                importedName: '*',
                moduleSpecifier,
                kind: 'namespace',
                isTypeOnly
              });
            }
          }
        } else {
          // Side-effect import
          imports.push({
            localName: '',
            importedName: '',
            moduleSpecifier,
            kind: 'side_effect',
            isTypeOnly: false
          });
        }
      }

      // Dynamic Imports
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0]!)) {
          const moduleSpecifier = node.arguments[0]!.text;
          dependencyEdges.push({
            fromModule: filePath,
            toModule: moduleSpecifier, // Will resolve properly later if needed
            symbols: [],
            isTypeOnly: false,
            isDynamic: true
          });
        }
      }

      // Exports
      if (ts.isExportDeclaration(node)) {
        const isTypeOnly = node.isTypeOnly;
        if (node.exportClause && ts.isNamedExports(node.exportClause)) {
          node.exportClause.elements.forEach(el => {
            exports.push({
              localName: el.propertyName ? el.propertyName.text : el.name.text,
              exportedName: el.name.text,
              kind: TypeFactKind.Variable, // Approximate, could be refined
              isTypeOnly: isTypeOnly || el.isTypeOnly,
              isDefault: el.name.text === 'default',
              isReExport: !!node.moduleSpecifier,
              sourceModule: node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : undefined
            });
          });
        }
      } else if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) {
        const isDefault = ts.getModifiers(node)!.some(m => m.kind === ts.SyntaxKind.DefaultKeyword);
        let name = 'default';
        if (!isDefault && (node as ts.NamedDeclaration).name && ts.isIdentifier((node as ts.NamedDeclaration).name!)) {
          name = ((node as ts.NamedDeclaration).name as ts.Identifier).text;
        } else if (!isDefault && ts.isVariableStatement(node)) {
          node.declarationList.declarations.forEach(d => {
            if (ts.isIdentifier(d.name)) {
              exports.push({
                localName: d.name.text,
                exportedName: d.name.text,
                kind: TypeFactKind.Variable,
                isTypeOnly: false,
                isDefault: false,
                isReExport: false
              });
            }
          });
          return; // Skip rest for variables
        }

        if ((node as ts.NamedDeclaration).name || isDefault) {
          exports.push({
            localName: isDefault && (node as ts.NamedDeclaration).name ? ((node as ts.NamedDeclaration).name as ts.Identifier).text : name,
            exportedName: name,
            kind: TypeFactKind.Function, // Approximate
            isTypeOnly: ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
            isDefault,
            isReExport: false
          });
        }
      }

      ts.forEachChild(node, visit);
    });

    const isEntryPoint = exports.length > 0; // Simplified detection
    if (isEntryPoint) entries.push(filePath);

    modules.set(filePath, {
      filePath,
      relativePath: program.getCurrentDirectory() ? filePath.replace(program.getCurrentDirectory(), '') : filePath,
      exports,
      imports,
      typeFacts,
      isEntryPoint,
      isDeclarationFile: sf.isDeclarationFile,
      hasJSX,
      hasDecorators,
      byteSize: sf.text.length
    });
  }

  // Second pass: build edges
  for (const [filePath, mod] of modules.entries()) {
    const targetMap = new Map<string, { symbols: string[], isTypeOnly: boolean }>();
    
    for (const imp of mod.imports) {
      // Simplified resolution - TS Compiler API resolveModuleName could be used for robustness
      const target = imp.moduleSpecifier; 
      if (!targetMap.has(target)) {
        targetMap.set(target, { symbols: [], isTypeOnly: true });
      }
      const entry = targetMap.get(target)!;
      entry.symbols.push(imp.importedName);
      if (!imp.isTypeOnly) entry.isTypeOnly = false;
    }

    for (const [target, info] of targetMap.entries()) {
      dependencyEdges.push({
        fromModule: filePath,
        toModule: target,
        symbols: info.symbols,
        isTypeOnly: info.isTypeOnly,
        isDynamic: false
      });
    }
  }

  return { modules, dependencyEdges, entries };
}
