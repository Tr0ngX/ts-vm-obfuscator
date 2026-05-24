import ts from 'typescript';
import type { FunctionCapabilityReport, FunctionExecutionTier } from '@tsvm/shared';

const VM_BLOCKERS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.TryStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.DebuggerStatement,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ClassExpression,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.WithStatement,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.YieldExpression,
  ts.SyntaxKind.ImportKeyword,
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
  ts.SyntaxKind.JsxExpression,
  ts.SyntaxKind.JsxOpeningElement,
  ts.SyntaxKind.JsxClosingElement,
  ts.SyntaxKind.ObjectBindingPattern,
  ts.SyntaxKind.ArrayBindingPattern,
  ts.SyntaxKind.SpreadElement,
  ts.SyntaxKind.SpreadAssignment,
]);

const FALLBACK_ONLY = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.WithStatement,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.AwaitExpression,
  ts.SyntaxKind.YieldExpression,
  ts.SyntaxKind.JsxElement,
  ts.SyntaxKind.JsxSelfClosingElement,
  ts.SyntaxKind.JsxFragment,
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
  if (!name) {
    return '<anonymous>';
  }
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return '<computed>';
}

function analyzeFunctionNode(node: SupportedFunctionNode, sourceFile: ts.SourceFile): FunctionCapabilityReport {
  const syntaxKinds = new Set<string>();
  const reasons = new Set<string>();
  let tier: FunctionExecutionTier = 'vm_safe';

  const visit = (current: ts.Node) => {
    if (current !== node && isFunctionLikeNode(current)) {
      return;
    }

    if (VM_BLOCKERS.has(current.kind)) {
      syntaxKinds.add(ts.SyntaxKind[current.kind]);
      reasons.add(`contains ${ts.SyntaxKind[current.kind]}`);
      if (FALLBACK_ONLY.has(current.kind)) {
        tier = 'native_fallback';
      } else if (tier === 'vm_safe') {
        tier = 'js_lowered';
      }
    }

    if (current.kind === ts.SyntaxKind.ThisKeyword) {
      syntaxKinds.add('ThisKeyword');
      reasons.add('uses this semantics');
      if (tier === 'vm_safe') {
        tier = 'js_lowered';
      }
    }

    ts.forEachChild(current, visit);
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }

  for (const param of node.parameters) {
    if (param.dotDotDotToken) {
      syntaxKinds.add('RestParameter');
      reasons.add('uses rest parameters');
      if (tier === 'vm_safe') {
        tier = 'js_lowered';
      }
    }
    if (ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)) {
      syntaxKinds.add(ts.SyntaxKind[param.name.kind]);
      reasons.add(`uses parameter ${ts.SyntaxKind[param.name.kind]}`);
      if (tier === 'vm_safe') {
        tier = 'js_lowered';
      }
    }
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
