import ts from 'typescript';
import type { SupportedFunctionNode, LocalBinding, ClosureAnalysis } from './types.js';
import { LEXICAL_THIS_CAPTURE, LEXICAL_NEW_TARGET_CAPTURE } from './types.js';

export function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

export function isNestedFunctionLike(node: ts.Node): node is SupportedFunctionNode {
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

export function isTypePosition(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isTypeNode(parent) || ts.isTypeAliasDeclaration(parent) || ts.isHeritageClause(parent);
}

export function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent || isTypePosition(node)) {
    return false;
  }
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isShorthandPropertyAssignment(parent) && parent.name !== node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    (ts.isBreakOrContinueStatement(parent) && parent.label === node)
  ) {
    return false;
  }
  return true;
}

export function collectFunctionLocalNames(node: SupportedFunctionNode): Set<string> {
  const names = new Set<string>();
  const isThisParameter = (param: ts.ParameterDeclaration) => ts.isIdentifier(param.name) && param.name.text === 'this';
  const collectBindingNames = (bindingName: ts.BindingName) => {
    if (ts.isIdentifier(bindingName)) {
      names.add(bindingName.text);
      return;
    }
    for (const element of bindingName.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }
      collectBindingNames(element.name);
    }
  };

  node.parameters.forEach((param) => {
    if (isThisParameter(param)) {
      return;
    }
    collectBindingNames(param.name);
  });
  if ((ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.name) {
    names.add(node.name.text);
  }

  const visit = (current: ts.Node) => {
    if (current !== node && isNestedFunctionLike(current)) {
      return;
    }
    if (ts.isVariableDeclaration(current)) {
      collectBindingNames(current.name);
    }
    if (ts.isCatchClause(current) && current.variableDeclaration) {
      collectBindingNames(current.variableDeclaration.name);
    }
    ts.forEachChild(current, visit);
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }

  return names;
}

export function analyzeFunctionClosures(node: SupportedFunctionNode, availableOuterNames: ReadonlySet<string>): ClosureAnalysis {
  const localNames = collectFunctionLocalNames(node);
  const capturedFromOuter: string[] = [];
  const capturedByDescendants = new Set<string>();

  const childAvailableOuterNames = new Set<string>(availableOuterNames);
  for (const name of localNames) {
    childAvailableOuterNames.add(name);
  }

  const visit = (current: ts.Node) => {
    if (current !== node && isNestedFunctionLike(current)) {
      const childAnalysis = analyzeFunctionClosures(current, childAvailableOuterNames);
      for (const name of childAnalysis.capturedFromOuter) {
        if (localNames.has(name) || name === LEXICAL_THIS_CAPTURE || name === LEXICAL_NEW_TARGET_CAPTURE) {
          capturedByDescendants.add(name);
        } else if (availableOuterNames.has(name)) {
          pushUnique(capturedFromOuter, name);
        }
      }
      return;
    }

    if (ts.isIdentifier(current) && isIdentifierReference(current)) {
      const name = current.text;
      if (!localNames.has(name) && availableOuterNames.has(name)) {
        pushUnique(capturedFromOuter, name);
      }
    }

    if (ts.isArrowFunction(node) && current.kind === ts.SyntaxKind.ThisKeyword && availableOuterNames.has(LEXICAL_THIS_CAPTURE)) {
      pushUnique(capturedFromOuter, LEXICAL_THIS_CAPTURE);
    }

    if (
      ts.isArrowFunction(node) &&
      ts.isMetaProperty(current) &&
      current.keywordToken === ts.SyntaxKind.NewKeyword &&
      current.name.text === 'target' &&
      availableOuterNames.has(LEXICAL_NEW_TARGET_CAPTURE)
    ) {
      pushUnique(capturedFromOuter, LEXICAL_NEW_TARGET_CAPTURE);
    }

    ts.forEachChild(current, visit);
  };

  if (node.body) {
    ts.forEachChild(node.body, visit);
  }

  return {
    localNames,
    capturedFromOuter,
    capturedByDescendants,
  };
}

export class ScopeMap {
  constructor(public parent?: ScopeMap) {}
  private map = new Map<string, LocalBinding>();
  get(name: string): LocalBinding | undefined {
    return this.map.get(name) ?? this.parent?.get(name);
  }
  set(name: string, binding: LocalBinding) {
    this.map.set(name, binding);
  }
  has(name: string): boolean {
    return this.map.has(name) || (this.parent?.has(name) ?? false);
  }
  hasOwn(name: string): boolean {
    return this.map.has(name);
  }
  delete(name: string): boolean {
    if (this.map.has(name)) {
      return this.map.delete(name);
    }
    return this.parent?.delete(name) ?? false;
  }
  keys(): string[] {
    const all = new Set<string>();
    let curr: ScopeMap | undefined = this;
    while (curr) {
      for (const k of curr.map.keys()) {
        all.add(k);
      }
      curr = curr.parent;
    }
    return Array.from(all);
  }
  entries(): [string, LocalBinding][] {
    const all = new Map<string, LocalBinding>();
    let curr: ScopeMap | undefined = this;
    const scopes: ScopeMap[] = [];
    while (curr) {
      scopes.unshift(curr);
      curr = curr.parent;
    }
    for (const scope of scopes) {
      for (const [k, v] of scope.map.entries()) {
        all.set(k, v);
      }
    }
    return Array.from(all.entries());
  }
}
