import ts from 'typescript';
import type { FunctionCapabilityReport, FunctionExecutionTier } from '@tsvm/shared';

const VM_BLOCKERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.WithStatement,
  ts.SyntaxKind.YieldExpression,
  ts.SyntaxKind.ImportKeyword,
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.JsxClosingElement,
]);

type SupportedFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

function isFunctionLikeNode(node: ts.Node): node is SupportedFunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function getFunctionName(node: SupportedFunctionNode): string {
  if (ts.isConstructorDeclaration(node)) {
    return 'constructor';
  }
  const name = (node as ts.NamedDeclaration).name;
  if (name && (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name))) {
    return name.text;
  }
  if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isPropertyAssignment(node.parent)) {
    const propertyName = node.parent.name;
    if (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName)) {
      return propertyName.text;
    }
  }
  if (!name) {
    return '<anonymous>';
  }
  return '<computed>';
}

function findEnclosingFunctionLike(node: ts.Node): SupportedFunctionNode | undefined {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (isFunctionLikeNode(current)) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function hasLexicalThisProvider(node: ts.ArrowFunction): boolean {
  return findEnclosingFunctionLike(node) !== undefined;
}

function hasLexicalNewTargetProvider(node: ts.ArrowFunction): boolean {
  const enclosing = findEnclosingFunctionLike(node);
  if (!enclosing) {
    return false;
  }
  return !ts.isArrowFunction(enclosing) || hasLexicalNewTargetProvider(enclosing);
}

function analyzeFunctionNode(node: SupportedFunctionNode, sourceFile: ts.SourceFile): FunctionCapabilityReport {
  const syntaxKinds = new Set<string>();
  const reasons = new Set<string>();
  let tier: FunctionExecutionTier = 'vm_safe';

  const isAsyncFunction = !!node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);
  const visit = (current: ts.Node) => {
    if (current !== node && isFunctionLikeNode(current)) {
      return;
    }

    if (VM_BLOCKERS.has(current.kind)) {
      syntaxKinds.add(ts.SyntaxKind[current.kind]);
      reasons.add(`contains ${ts.SyntaxKind[current.kind]}`);
      if (tier === 'vm_safe') {
        tier = 'js_lowered';
      } 
    }

    if (ts.isAwaitExpression(current)) {
      syntaxKinds.add('AwaitExpression');
      if (!isAsyncFunction) {
        reasons.add('uses await outside async function');
        if (tier === 'vm_safe') {
          tier = 'js_lowered';
        }
      }
    }

    if (current.kind === ts.SyntaxKind.ThisKeyword && ts.isArrowFunction(node)) {
      syntaxKinds.add('ThisKeyword');
      if (!hasLexicalThisProvider(node)) {
        reasons.add('uses lexical this in arrow function without an enclosing function context');
      }
      if (tier === 'vm_safe' && !hasLexicalThisProvider(node)) {
        tier = 'js_lowered';
      }
    }

    if (ts.isMetaProperty(current) && current.keywordToken === ts.SyntaxKind.NewKeyword && current.name.text === 'target' && ts.isArrowFunction(node)) {
      syntaxKinds.add('MetaProperty');
      if (!hasLexicalNewTargetProvider(node)) {
        reasons.add('uses lexical new.target in arrow function without an enclosing constructor/function context');
      }
      if (tier === 'vm_safe' && !hasLexicalNewTargetProvider(node)) {
        tier = 'js_lowered';
      }
    }

    ts.forEachChild(current, visit);
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }

  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    filePath: sourceFile.fileName,
    functionName: getFunctionName(node),
    tier,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    syntaxKinds: Array.from(syntaxKinds).sort(),
    reasons: Array.from(reasons).sort(),
  };
}

function tryGetTopLevelVariableFunctionBinding(statement: ts.Statement): Array<{ name: string; node: SupportedFunctionNode }> {
  if (!ts.isVariableStatement(statement)) {
    return [];
  }

  const bindings: Array<{ name: string; node: SupportedFunctionNode }> = [];
  for (const declaration of statement.declarationList.declarations) {
    if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
      continue;
    }
    if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
      bindings.push({ name: declaration.name.text, node: declaration.initializer });
    }
  }
  return bindings;
}

export function analyzeFunctionCapabilities(filePath: string): FunctionCapabilityReport[] {
  const sourceText = ts.sys.readFile(filePath) || '';
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ESNext, true);
  const reports: FunctionCapabilityReport[] = [];

  const visit = (node: ts.Node) => {
    if (isFunctionLikeNode(node)) {
      reports.push(analyzeFunctionNode(node, sourceFile));
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return reports;
}

export function analyzeTopLevelFunctionCapabilities(filePath: string): FunctionCapabilityReport[] {
  const sourceText = ts.sys.readFile(filePath) || '';
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ESNext, true);
  const reports: FunctionCapabilityReport[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      reports.push(analyzeFunctionNode(statement, sourceFile));
      continue;
    }
    for (const binding of tryGetTopLevelVariableFunctionBinding(statement)) {
      const report = analyzeFunctionNode(binding.node, sourceFile);
      reports.push({
        ...report,
        functionName: binding.name,
      });
    }
  }

  return reports;
}
