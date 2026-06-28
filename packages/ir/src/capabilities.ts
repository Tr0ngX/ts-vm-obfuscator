import ts from 'typescript';
import type { FunctionCapabilityReport, FunctionExecutionTier } from '@tsvm/shared';

const VM_BLOCKERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.WithStatement,
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
  // Walk up AST to find an enclosing function/method/constructor that provides `this`
  let current: ts.Node | undefined = node.parent;
  while (current) {
    // Method, constructor, getter, setter provide their own `this`
    if (
      ts.isMethodDeclaration(current) ||
      ts.isConstructorDeclaration(current) ||
      ts.isGetAccessorDeclaration(current) ||
      ts.isSetAccessorDeclaration(current)
    ) {
      return true;
    }
    // Regular function declaration/expression provides its own `this`
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) {
      return true;
    }
    // Class property initializer — arrow in property position gets class `this`
    if (ts.isPropertyDeclaration(current) && (ts.isClassDeclaration(current.parent) || ts.isClassExpression(current.parent))) {
      return true;
    }
    // Reached top of file without finding a provider
    if (ts.isSourceFile(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function hasLexicalNewTargetProvider(node: ts.ArrowFunction): boolean {
  // Walk up AST to find an enclosing constructor or function that can be `new`-called
  let current: ts.Node | undefined = node.parent;
  while (current) {
    // Constructor provides new.target
    if (ts.isConstructorDeclaration(current)) {
      return true;
    }
    // Regular function (can be called with new) provides new.target
    if (ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current)) {
      return true;
    }
    // Arrow functions inherit new.target lexically — keep walking
    if (ts.isArrowFunction(current)) {
      current = current.parent;
      continue;
    }
    // Methods, getters, setters cannot be `new`-called
    if (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) {
      return false;
    }
    // Reached top of file
    if (ts.isSourceFile(current)) {
      return false;
    }
    current = current.parent;
  }
  return false;
}

function analyzeClassSupport(node: ts.ClassDeclaration | ts.ClassExpression): string[] {
  const reasons = new Set<string>();

  const visit = (current: ts.Node) => {
    if (ts.isConstructorDeclaration(current) && current.parameters.some((parameter) => parameter.modifiers?.length)) {
      reasons.add('class uses parameter properties');
    }
    if (
      (ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current)) &&
      current.name &&
      ts.isPrivateIdentifier(current.name)
    ) {
      reasons.add('class uses unsupported private methods or accessors');
    }
    ts.forEachChild(current, visit);
  };

  node.members.forEach((member) => visit(member));
  return [...reasons];
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

    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) {
      syntaxKinds.add(ts.SyntaxKind[current.kind]);
      const classReasons = analyzeClassSupport(current);
      classReasons.forEach((reason) => reasons.add(reason));
      if (tier === 'vm_safe' && classReasons.length > 0) {
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

    if (
      ts.isMetaProperty(current) &&
      current.keywordToken === ts.SyntaxKind.NewKeyword &&
      current.name.text === 'target' &&
      ts.isArrowFunction(node)
    ) {
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

export function analyzeFunctionCapabilities(filePath: string, sourceText?: string, program?: any): FunctionCapabilityReport[] {
  let sourceFile = (program && typeof program.getSourceFile === 'function')
    ? program.getSourceFile(filePath)
    : undefined;
  if (!sourceFile) {
    const text = sourceText ?? ts.sys.readFile(filePath) ?? '';
    sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true);
  }
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

export function analyzeTopLevelFunctionCapabilities(filePath: string, sourceText?: string, program?: any): FunctionCapabilityReport[] {
  let sourceFile = (program && typeof program.getSourceFile === 'function')
    ? program.getSourceFile(filePath)
    : undefined;
  if (!sourceFile) {
    const text = sourceText ?? ts.sys.readFile(filePath) ?? '';
    sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.ESNext, true);
  }
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
