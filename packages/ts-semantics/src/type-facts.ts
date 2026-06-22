import ts from 'typescript';
import type { TypeFact, SourceLocation } from '@tsvm/shared';
import { TypeFactKind } from '@tsvm/shared';

function getSourceLocation(node: ts.Node): SourceLocation {
  const sourceFile = node.getSourceFile();
  const start = node.getStart();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return {
    filePath: sourceFile.fileName,
    line,
    column: character,
    offset: start,
    length: node.getEnd() - start
  };
}

export function extractTypeFacts(sourceFile: ts.SourceFile, checker: ts.TypeChecker): TypeFact[] {
  const facts: TypeFact[] = [];
  
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessor(node) ||
      ts.isSetAccessor(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      if ((node as ts.NamedDeclaration).name && ts.isIdentifier((node as ts.NamedDeclaration).name!)) {
        const symbol = checker.getSymbolAtLocation((node as ts.NamedDeclaration).name!);
        if (symbol) {
          const type = checker.getTypeOfSymbolAtLocation(symbol, node);
          const typeText = checker.typeToString(type, node, ts.TypeFormatFlags.NoTruncation);
          
          let kind = TypeFactKind.Variable;
          if (ts.isFunctionDeclaration(node)) kind = TypeFactKind.Function;
          else if (ts.isClassDeclaration(node)) kind = TypeFactKind.Class;
          else if (ts.isInterfaceDeclaration(node)) kind = TypeFactKind.Interface;
          else if (ts.isTypeAliasDeclaration(node)) kind = TypeFactKind.TypeAlias;
          else if (ts.isEnumDeclaration(node)) kind = TypeFactKind.Enum;
          else if (ts.isModuleDeclaration(node)) kind = TypeFactKind.Namespace;
          else if (ts.isParameter(node)) kind = TypeFactKind.Parameter;
          else if (ts.isPropertyDeclaration(node)) kind = TypeFactKind.Property;
          else if (ts.isMethodDeclaration(node)) kind = TypeFactKind.Method;
          else if (ts.isGetAccessor(node) || ts.isSetAccessor(node)) kind = TypeFactKind.Accessor;
          else if (ts.isConstructorDeclaration(node)) kind = TypeFactKind.Constructor;

          let isExported = false;
          let isAmbient = false;
          if (ts.canHaveModifiers(node)) {
            const modifiers = ts.getModifiers(node);
            isExported = modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
            isAmbient = modifiers?.some(m => m.kind === ts.SyntaxKind.DeclareKeyword) ?? false;
          }

          let isGeneric = false;
          const typeParameters: string[] = [];
          const constraints: string[] = [];
          
          if ('typeParameters' in node) {
            const nodeWithTP = node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> };
            const tps = nodeWithTP.typeParameters;
            if (tps) {
              isGeneric = true;
              tps.forEach(tp => {
                typeParameters.push(tp.name.text);
                if (tp.constraint) {
                  constraints.push(tp.constraint.getText());
                }
              });
            }
          }

          const decorators: string[] = [];
          if (ts.canHaveDecorators(node)) {
            const decs = ts.getDecorators(node);
            if (decs) {
              decs.forEach(d => decorators.push(d.expression.getText()));
            }
          }

          facts.push({
            symbolName: symbol.name,
            symbolId: (symbol as { id?: number }).id ?? -1,
            kind,
            typeText,
            flags: type.flags,
            isGeneric,
            typeParameters,
            constraints,
            sourceLocation: getSourceLocation(node),
            isExported,
            isAmbient,
            decorators
          });
        }
      }
    }
    
    ts.forEachChild(node, visit);
  }
  
  visit(sourceFile);
  return facts;
}
