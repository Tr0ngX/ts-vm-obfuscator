import ts from 'typescript';
import type { Diagnostic, ModuleInfo, ProjectSemanticGraph, IRModule, Operand, Register } from '@tsvm/shared';
import { DiagnosticSeverity, IRType, OpCode, OperandKind, ConstantKind, FunctionAttribute } from '@tsvm/shared';
import { IRModuleBuilder, IRFunctionBuilder, BasicBlockBuilder } from './ir.js';

type SupportedFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

interface LoweringOptions {
  readonly name: string;
  readonly isExported: boolean;
  readonly isVirtualized: boolean;
  readonly analysis: ClosureAnalysis;
  readonly attributes?: readonly FunctionAttribute[];
  readonly isNested?: boolean;
  readonly prologueEmitter?: ((lowering: ASTLowering) => void) | undefined;
  readonly privateIdentifierBindings?: ReadonlyMap<string, string>;
}

export interface LowerToIROptions {
  readonly forceVirtualizeAll?: boolean;
  readonly forceVirtualizeFunctionNames?: ReadonlySet<string>;
  readonly skipTopLevelFunctionNames?: ReadonlySet<string>;
  readonly compatibilityFallback?: boolean;
  readonly diagnostics?: Diagnostic[];
}

interface ClosureAnalysis {
  readonly localNames: ReadonlySet<string>;
  readonly capturedFromOuter: readonly string[];
  readonly capturedByDescendants: ReadonlySet<string>;
}

interface LocalBinding {
  readonly register: Register;
  readonly boxed: boolean;
}

interface PendingParameterBinding {
  readonly param: ts.ParameterDeclaration;
  readonly register: Register;
}

type CompletionKind = 0 | 1 | 2 | 3 | 4;

interface FinallyCompletionTarget {
  readonly code: number;
  readonly kind: 'break' | 'continue';
  readonly blockId: string;
}

interface FinallyContext {
  readonly finallyBlockId: string;
  readonly completionKindLocal: Register;
  readonly completionValueLocal: Register;
  readonly completionTargetLocal: Register;
  readonly targets: FinallyCompletionTarget[];
}

interface NormalizedComputedName {
  readonly bindingName: string;
  readonly expression: ts.Expression;
}

interface NormalizedClassMethodElement {
  readonly kind: 'constructor' | 'method' | 'getter' | 'setter';
  readonly node: ts.ConstructorDeclaration | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration;
  readonly isStatic: boolean;
  readonly keyName?: string;
  readonly computedBindingName?: string;
}

interface NormalizedClassFieldElement {
  readonly kind: 'field';
  readonly node: ts.PropertyDeclaration;
  readonly isStatic: boolean;
  readonly keyName?: string;
  readonly computedBindingName?: string;
  readonly privateBindingName?: string;
}

interface NormalizedClassStaticBlockElement {
  readonly kind: 'static_block';
  readonly node: ts.ClassStaticBlockDeclaration;
  readonly isStatic: true;
}

type NormalizedClassElement = NormalizedClassMethodElement | NormalizedClassFieldElement | NormalizedClassStaticBlockElement;

interface NormalizedClass {
  readonly bindingName?: string;
  readonly restoreBinding?: LocalBinding;
  readonly constructorElement?: NormalizedClassMethodElement;
  readonly computedNames: readonly NormalizedComputedName[];
  readonly privateIdentifiers: ReadonlyMap<string, string>;
  readonly instanceElements: readonly NormalizedClassElement[];
  readonly staticElements: readonly NormalizedClassElement[];
}

const LEXICAL_THIS_CAPTURE = '$$vm_lexical_this';
const LEXICAL_NEW_TARGET_CAPTURE = '$$vm_lexical_new_target';

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function isNestedFunctionLike(node: ts.Node): node is SupportedFunctionNode {
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

function isTypePosition(node: ts.Node): boolean {
  const parent = node.parent;
  return ts.isTypeNode(parent) || ts.isTypeAliasDeclaration(parent) || ts.isHeritageClause(parent);
}

function isIdentifierReference(node: ts.Identifier): boolean {
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

function collectFunctionLocalNames(node: SupportedFunctionNode): Set<string> {
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

function analyzeFunctionClosures(node: SupportedFunctionNode, availableOuterNames: ReadonlySet<string>): ClosureAnalysis {
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
        if (localNames.has(name)) {
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

class ASTLowering {
  private fnBuilder: IRFunctionBuilder;
  private currentBlock: BasicBlockBuilder;
  private scope: Map<string, LocalBinding> = new Map();
  readonly functionId: string;
  private nestedFunctionCount = 0;
  private tempLocalCount = 0;
  private readonly sourceFile: ts.SourceFile;
  private readonly capturedLocals: ReadonlySet<string>;
  private readonly outerCaptureBindings = new Map<string, number>();
  private readonly breakTargets: string[] = [];
  private readonly continueTargets: string[] = [];
  private readonly finallyContexts: FinallyContext[] = [];
  private throwPassthroughFinallyDepth = 0;
  private readonly pendingParameterBindings: PendingParameterBinding[] = [];
  private readonly isAsyncFunction: boolean;
  private readonly isGenerator: boolean;
  private readonly privateIdentifierBindings: ReadonlyMap<string, string>;

  constructor(public readonly modBuilder: IRModuleBuilder, private readonly node: SupportedFunctionNode, options: LoweringOptions) {
    this.functionId = modBuilder.getNextFunctionId();
    this.fnBuilder = new IRFunctionBuilder(this.functionId, options.name, IRType.Any);
    this.sourceFile = node.getSourceFile();
    this.capturedLocals = options.analysis.capturedByDescendants;
    this.privateIdentifierBindings = options.privateIdentifierBindings ?? new Map();
    if (options.isExported) {
      this.fnBuilder.addAttribute(FunctionAttribute.Exported);
    }
    if (options.isNested) {
      this.fnBuilder.addAttribute(FunctionAttribute.Nested);
    }
    for (const attribute of options.attributes ?? []) {
      this.fnBuilder.addAttribute(attribute);
    }
    this.isAsyncFunction = !!this.node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
      || ('asteriskToken' in this.node && !!this.node.asteriskToken && (this.node.name as any)?.text === 'async')
      || (options.attributes ?? []).includes(FunctionAttribute.Async);
    this.isGenerator = 'asteriskToken' in this.node && !!this.node.asteriskToken;

    this.currentBlock = this.fnBuilder.createBlock('entry');
    options.analysis.capturedFromOuter.forEach((name, index) => {
      this.outerCaptureBindings.set(name, index);
      this.fnBuilder.addCapturedVariable(name);
    });

    const isThisParameter = (param: ts.ParameterDeclaration) => ts.isIdentifier(param.name) && param.name.text === 'this';
    let runtimeParamIndex = 0;
    node.parameters.forEach((param, index) => {
      if (isThisParameter(param)) {
        return;
      }
      const isPlainIdentifier = ts.isIdentifier(param.name) && !param.dotDotDotToken && !param.initializer;
      const paramName = isPlainIdentifier ? param.name.text : `$param_${runtimeParamIndex}`;
      const reg = this.fnBuilder.addParam(paramName, IRType.Any, !!param.dotDotDotToken);
      if (isPlainIdentifier && ts.isIdentifier(param.name)) {
        this.scope.set(param.name.text, { register: reg, boxed: this.capturedLocals.has(param.name.text) });
      } else {
        this.pendingParameterBindings.push({ param, register: reg });
      }
      runtimeParamIndex++;
    });
    this.boxCapturedParameters();
    this.lowerPendingParameterBindings();
    this.initializeLexicalSemanticCaptures(options.analysis);
    options.prologueEmitter?.(this);

    if (node.body) {
      if (ts.isBlock(node.body)) {
        this.visitStatement(node.body);
      } else {
        const valueReg = this.visitExpression(node.body);
        this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valueReg });
      }
    }

    if (this.shouldEmitFallthroughReturn()) {
      const undefConst = this.modBuilder.addConstant(ConstantKind.Undefined, null);
      const rRet = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadConst, [{ kind: OperandKind.ConstantIndex, value: undefConst }], rRet);
      this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: rRet });
    }
    if (!this.isSyntheticDeadBlock(this.currentBlock)) {
      this.fnBuilder.addBlock(this.currentBlock.build());
    }
    this.modBuilder.addFunction(this.fnBuilder.build(options.isVirtualized, options.isExported));
  }

  private failUnsupported(node: ts.Node, detail?: string): never {
    const kind = ts.SyntaxKind[node.kind];
    const snippet = node.getText(this.sourceFile).replace(/\s+/g, ' ').slice(0, 80);
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(node.getStart(this.sourceFile));
    const message = detail ? `${kind} (${detail})` : kind;
    throw new Error(
      `Unsupported AST in IR builder: ${message} at ${this.sourceFile.fileName}:${line + 1}:${character + 1} near "${snippet}"`
    );
  }

  private isSyntheticDeadBlock(block: BasicBlockBuilder): boolean {
    const label = block.label;
    const syntheticLabel =
      label === 'unreachable' ||
      label === 'after_break' ||
      label === 'after_continue';
    return (
      syntheticLabel &&
      block.getInstructionCount() === 0 &&
      (block.getTerminatorKind() === undefined || block.getTerminatorKind() === 'unreachable') &&
      this.fnBuilder.getBlockCount() > 0
    );
  }

  private shouldEmitFallthroughReturn(): boolean {
    if (this.isSyntheticDeadBlock(this.currentBlock)) {
      return false;
    }
    const termKind = this.currentBlock.getTerminatorKind();
    return termKind === undefined || termKind === 'unreachable';
  }

  private enterBreakTarget(target: string): void {
    this.breakTargets.push(target);
  }

  private leaveBreakTarget(): void {
    this.breakTargets.pop();
  }

  private enterContinueTarget(target: string): void {
    this.continueTargets.push(target);
  }

  private leaveContinueTarget(): void {
    this.continueTargets.pop();
  }

  private emitJumpAndAdvance(targetBlockId: string, nextLabel: string): void {
    this.currentBlock.setTerminator({ kind: 'jump', targets: [targetBlockId] });
    this.fnBuilder.addBlock(this.currentBlock.build());
    this.currentBlock = this.fnBuilder.createBlock(nextLabel);
  }

  private emitConstant(kind: ConstantKind, value: string | number | boolean | null): Register {
    const idx = this.modBuilder.addConstant(kind, value);
    const reg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadConst, [{ kind: OperandKind.ConstantIndex, value: idx }], reg);
    return reg;
  }

  private storeToLocal(localReg: Register, valueReg: Register): void {
    this.currentBlock.addInstruction(OpCode.StoreLocal, [
      { kind: OperandKind.Register, value: localReg },
      { kind: OperandKind.Register, value: valueReg },
    ]);
  }

  private boxCapturedParameters(): void {
    for (const [name, binding] of this.scope.entries()) {
      if (binding.boxed) {
        this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: binding.register }], binding.register);
        this.fnBuilder.addCapturedVariable(name);
      }
    }
  }

  private lowerPendingParameterBindings(): void {
    this.pendingParameterBindings.forEach(({ param, register }, index) => {
      let valueReg = param.dotDotDotToken ? this.emitRestArgs(index) : this.loadFromLocal(register);
      valueReg = this.applyDefaultValue(valueReg, param.initializer);

      if (ts.isIdentifier(param.name)) {
        this.initializeDeclaredIdentifier(param.name.text, valueReg);
        return;
      }

      this.bindPattern(param.name, valueReg, 'declare');
    });
  }

  private loadOuterCaptureCell(name: string): Register {
    const envIndex = this.outerCaptureBindings.get(name);
    if (envIndex === undefined) {
      this.failUnsupported(this.findIdentifierNode(name) ?? this.node, `Unknown closure binding "${name}"`);
    }
    const cellReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.EnvGet, [{ kind: OperandKind.Immediate, value: envIndex }], cellReg);
    return cellReg;
  }

  private resolveVar(name: string): Register {
    if (this.scope.has(name)) {
      const binding = this.scope.get(name)!;
      const destReg = this.fnBuilder.allocRegister();
      if (binding.boxed) {
        this.currentBlock.addInstruction(OpCode.CellGet, [{ kind: OperandKind.Register, value: binding.register }], destReg);
      } else {
        this.currentBlock.addInstruction(OpCode.LoadLocal, [{ kind: OperandKind.Register, value: binding.register }], destReg);
      }
      return destReg;
    }
    if (this.outerCaptureBindings.has(name)) {
      const cellReg = this.loadOuterCaptureCell(name);
      const destReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.CellGet, [{ kind: OperandKind.Register, value: cellReg }], destReg);
      return destReg;
    }
    // Assume global
    const strReg = this.emitConstant(ConstantKind.String, name);
    const destReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadGlobal, [{ kind: OperandKind.Register, value: strReg }], destReg);
    return destReg;
  }

  private findIdentifierNode(name: string): ts.Identifier | undefined {
    let match: ts.Identifier | undefined;
    const visit = (node: ts.Node) => {
      if (match) {
        return;
      }
      if (ts.isIdentifier(node) && node.text === name) {
        match = node;
        return;
      }
      ts.forEachChild(node, visit);
    };
    if (this.node.body) {
      ts.forEachChild(this.node.body, visit);
    }
    return match;
  }

  private createNestedFunctionName(): string {
    const suffix = this.nestedFunctionCount++;
    return `${this.fnBuilder.name}$closure$${suffix}`;
  }

  private getAvailableOuterCaptureNames(): Set<string> {
    const availableOuterNames = new Set<string>(this.outerCaptureBindings.keys());
    for (const name of this.scope.keys()) {
      availableOuterNames.add(name);
    }
    if (this.canProvideLexicalThis()) {
      availableOuterNames.add(LEXICAL_THIS_CAPTURE);
    }
    if (this.canProvideLexicalNewTarget()) {
      availableOuterNames.add(LEXICAL_NEW_TARGET_CAPTURE);
    }
    return availableOuterNames;
  }

  private canProvideLexicalThis(): boolean {
    if (!ts.isArrowFunction(this.node)) {
      return true;
    }
    return this.scope.has(LEXICAL_THIS_CAPTURE) || this.outerCaptureBindings.has(LEXICAL_THIS_CAPTURE);
  }

  private canProvideLexicalNewTarget(): boolean {
    if (!ts.isArrowFunction(this.node)) {
      return true;
    }
    return this.scope.has(LEXICAL_NEW_TARGET_CAPTURE) || this.outerCaptureBindings.has(LEXICAL_NEW_TARGET_CAPTURE);
  }

  private initializeLexicalSemanticCaptures(analysis: ClosureAnalysis): void {
    if (!ts.isArrowFunction(this.node)) {
      return;
    }
    if (analysis.capturedFromOuter.includes(LEXICAL_THIS_CAPTURE)) {
      this.initializeLexicalCapture(LEXICAL_THIS_CAPTURE);
    }
    if (analysis.capturedFromOuter.includes(LEXICAL_NEW_TARGET_CAPTURE)) {
      this.initializeLexicalCapture(LEXICAL_NEW_TARGET_CAPTURE);
    }
  }

  private initializeLexicalCapture(name: typeof LEXICAL_THIS_CAPTURE | typeof LEXICAL_NEW_TARGET_CAPTURE): void {
    if (this.scope.has(name)) {
      return;
    }

    const localReg = this.fnBuilder.addLocal(name, IRType.Any, true);
    this.scope.set(name, { register: localReg, boxed: true });

    let sourceValueReg: Register;
    if (this.outerCaptureBindings.has(name)) {
      const outerCellReg = this.loadOuterCaptureCell(name);
      sourceValueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.CellGet, [{ kind: OperandKind.Register, value: outerCellReg }], sourceValueReg);
    } else if (name === LEXICAL_THIS_CAPTURE) {
      sourceValueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadThis, [], sourceValueReg);
    } else {
      sourceValueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadNewTarget, [], sourceValueReg);
    }

    this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: sourceValueReg }], localReg);
    this.fnBuilder.addCapturedVariable(name);
  }

  private resolveLexicalCapture(name: typeof LEXICAL_THIS_CAPTURE | typeof LEXICAL_NEW_TARGET_CAPTURE, node: ts.Node, detail: string): Register {
    if (!this.scope.has(name) && !this.outerCaptureBindings.has(name)) {
      this.failUnsupported(node, detail);
    }
    return this.resolveVar(name);
  }

  private collectReferencedOuterNames(nodes: readonly ts.Node[], availableOuterNames: ReadonlySet<string>): string[] {
    const referenced = new Set<string>();
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) && availableOuterNames.has(node.text)) {
        referenced.add(node.text);
      }
      ts.forEachChild(node, visit);
    };
    nodes.forEach((node) => visit(node));
    return [...referenced];
  }

  private getFunctionAttributes(node: SupportedFunctionNode): FunctionAttribute[] {
    const attributes: FunctionAttribute[] = [];
    if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      attributes.push(FunctionAttribute.Async);
    }
    if (ts.isArrowFunction(node)) {
      attributes.push(FunctionAttribute.Arrow);
    }
    if (ts.isMethodDeclaration(node)) {
      attributes.push(FunctionAttribute.Method);
    }
    if (ts.isGetAccessorDeclaration(node)) {
      attributes.push(FunctionAttribute.Getter);
    }
    if (ts.isSetAccessorDeclaration(node)) {
      attributes.push(FunctionAttribute.Setter);
    }
    if (ts.isConstructorDeclaration(node)) {
      attributes.push(FunctionAttribute.Constructor);
    }
    if ('asteriskToken' in node && !!node.asteriskToken) {
      attributes.push(FunctionAttribute.Generator);
    }
    if (node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)) {
      attributes.push(FunctionAttribute.Static);
    }
    return attributes;
  }

  private normalizeClassLike(node: ts.ClassDeclaration | ts.ClassExpression): NormalizedClass {
    if (node.heritageClauses?.some((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)) {
      this.failUnsupported(node, 'class extends is not supported on the vm-safe path');
    }

    const computedNames: NormalizedComputedName[] = [];
    const privateIdentifiers = new Map<string, string>();
    const instanceElements: NormalizedClassElement[] = [];
    const staticElements: NormalizedClassElement[] = [];
    let constructorElement: NormalizedClassMethodElement | undefined;

    const pushElement = (element: NormalizedClassElement) => {
      if (element.kind === 'constructor') {
        if (constructorElement) {
          this.failUnsupported(element.node, 'multiple constructors are not supported');
        }
        constructorElement = element;
        instanceElements.push(element);
        return;
      }
      if (element.isStatic) {
        staticElements.push(element);
      } else {
        instanceElements.push(element);
      }
    };

    for (const member of node.members) {
      if (ts.isSemicolonClassElement(member)) {
        continue;
      }
      if (ts.isClassStaticBlockDeclaration(member)) {
        this.failUnsupported(member, 'class static blocks are not supported on the vm-safe path');
      }
      const modifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) ?? [] : [];
      if (ts.isPropertyDeclaration(member) && modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
        continue;
      }
      const privateBindingName =
        'name' in member && member.name && ts.isPrivateIdentifier(member.name)
          ? privateIdentifiers.get(member.name.text) ?? this.createSyntheticBindingName('private_slot')
          : undefined;
      if (privateBindingName && 'name' in member && member.name && ts.isPrivateIdentifier(member.name) && !privateIdentifiers.has(member.name.text)) {
        privateIdentifiers.set(member.name.text, privateBindingName);
      }
      if (privateBindingName && !ts.isPropertyDeclaration(member)) {
        this.failUnsupported(member.name!, 'private class methods and accessors are not supported on the vm-safe path');
      }

      const isStatic = modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword);
      const computedBindingName =
        'name' in member && member.name && ts.isComputedPropertyName(member.name)
          ? this.createSyntheticBindingName('class_key')
          : undefined;

      if (computedBindingName && 'name' in member && member.name && ts.isComputedPropertyName(member.name)) {
        computedNames.push({
          bindingName: computedBindingName,
          expression: member.name.expression,
        });
      }

      const keyName =
        'name' in member && member.name && !ts.isComputedPropertyName(member.name) && !ts.isPrivateIdentifier(member.name)
          ? this.getPropertyNameText(member.name)
          : undefined;

      if (ts.isConstructorDeclaration(member)) {
        if (member.parameters.some((parameter) => parameter.modifiers?.length)) {
          this.failUnsupported(member, 'parameter properties are not supported on the vm-safe path');
        }
        pushElement({
          kind: 'constructor',
          node: member,
          isStatic: false,
        });
        continue;
      }

      if (ts.isMethodDeclaration(member)) {
        pushElement({
          kind: 'method',
          node: member,
          isStatic,
          keyName,
          computedBindingName,
        });
        continue;
      }

      if (ts.isGetAccessorDeclaration(member)) {
        pushElement({
          kind: 'getter',
          node: member,
          isStatic,
          keyName,
          computedBindingName,
        });
        continue;
      }

      if (ts.isSetAccessorDeclaration(member)) {
        pushElement({
          kind: 'setter',
          node: member,
          isStatic,
          keyName,
          computedBindingName,
        });
        continue;
      }

      if (ts.isPropertyDeclaration(member)) {
        pushElement({
          kind: 'field',
          node: member,
          isStatic,
          keyName,
          computedBindingName,
          privateBindingName,
        });
        continue;
      }

      this.failUnsupported(member, 'unsupported class element');
    }

    return {
      bindingName: node.name?.text,
      constructorElement,
      computedNames,
      privateIdentifiers,
      instanceElements,
      staticElements,
    };
  }

  private lowerClassConstructor(
    normalized: NormalizedClass,
    availableOuterNames: ReadonlySet<string>,
    classDisplayName: string,
  ): Register {
    const instanceFields = normalized.instanceElements.filter(
      (element): element is NormalizedClassFieldElement => element.kind === 'field',
    );
    const explicitCtor = normalized.constructorElement?.kind === 'constructor' ? normalized.constructorElement.node : undefined;
    const ctorNode: SupportedFunctionNode = explicitCtor
      ?? ts.factory.createFunctionExpression(undefined, undefined, undefined, undefined, [], undefined, ts.factory.createBlock([], true));

    const fieldInitializerNodes = instanceFields.flatMap((field) => {
      const nodes: ts.Node[] = [];
      if (field.node.initializer) {
        nodes.push(field.node.initializer);
      }
      return nodes;
    });
    const computedFieldCaptureNames = instanceFields
      .map((field) => field.computedBindingName)
      .filter((name): name is string => !!name);
    const extraCapturedFromOuter = [
      ...this.collectReferencedOuterNames(fieldInitializerNodes, availableOuterNames),
      ...computedFieldCaptureNames,
      ...normalized.privateIdentifiers.values(),
    ];
    const analysisBase = analyzeFunctionClosures(ctorNode, new Set<string>(availableOuterNames));
    const analysis: ClosureAnalysis = {
      ...analysisBase,
      capturedFromOuter: [...new Set([...analysisBase.capturedFromOuter, ...extraCapturedFromOuter])],
    };

    const nestedName = this.createNestedFunctionName();
    const nestedLowering = new ASTLowering(this.modBuilder, ctorNode, {
      name: nestedName,
      isExported: false,
      isVirtualized: true,
      analysis,
      attributes: [FunctionAttribute.Constructor],
      isNested: true,
      prologueEmitter: (lowering) => {
        lowering.emitClassConstructorGuard(classDisplayName);
        lowering.emitInstanceFieldInitializers(instanceFields);
      },
      privateIdentifierBindings: normalized.privateIdentifiers,
    });
    const envReg = this.buildClosureEnvironment(analysis.capturedFromOuter);
    const functionIdIndex = this.modBuilder.addConstant(ConstantKind.String, nestedLowering.functionId);
    const closureReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.ClosureNew,
      [
        { kind: OperandKind.ConstantIndex, value: functionIdIndex },
        { kind: OperandKind.Register, value: envReg },
      ],
      closureReg,
    );
    return closureReg;
  }

  private lowerNestedFunctionLike(
    expr: SupportedFunctionNode,
    explicitName?: string,
    overrides?: {
      readonly extraCapturedFromOuter?: readonly string[];
      readonly attributes?: readonly FunctionAttribute[];
      readonly prologueEmitter?: ((lowering: ASTLowering) => void) | undefined;
      readonly availableOuterNames?: ReadonlySet<string>;
      readonly privateIdentifierBindings?: ReadonlyMap<string, string>;
    },
  ): Register {
    const nestedName = explicitName ?? this.createNestedFunctionName();
    const availableOuterNames = overrides?.availableOuterNames ?? this.getAvailableOuterCaptureNames();
    const baseAnalysis = analyzeFunctionClosures(expr, new Set<string>(availableOuterNames));
    const analysis: ClosureAnalysis = {
      ...baseAnalysis,
      capturedFromOuter: [
        ...new Set([
          ...baseAnalysis.capturedFromOuter,
          ...(overrides?.extraCapturedFromOuter ?? []),
        ]),
      ],
    };
    const nestedLowering = new ASTLowering(this.modBuilder, expr, {
      name: nestedName,
      isExported: false,
      isVirtualized: true,
      analysis,
      attributes: [...this.getFunctionAttributes(expr), ...(overrides?.attributes ?? [])],
      isNested: true,
      prologueEmitter: overrides?.prologueEmitter,
      privateIdentifierBindings: overrides?.privateIdentifierBindings,
    });
    const envReg = this.buildClosureEnvironment(analysis.capturedFromOuter);
    const functionIdIndex = this.modBuilder.addConstant(ConstantKind.String, nestedLowering.functionId);
    const closureReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.ClosureNew,
      [
        { kind: OperandKind.ConstantIndex, value: functionIdIndex },
        { kind: OperandKind.Register, value: envReg },
      ],
      closureReg
    );
    return closureReg;
  }

  private emitClassMethodOrAccessorDescriptor(
    targetReg: Register,
    keyReg: Register,
    computed: boolean,
    element: NormalizedClassMethodElement,
    fnReg: Register,
  ): void {
    const descriptorReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.ObjectNew, [], descriptorReg);
    const enumerableReg = this.emitConstant(ConstantKind.Boolean, false);
    const configurableReg = this.emitConstant(ConstantKind.Boolean, true);
    this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'enumerable'), enumerableReg, false);
    this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'configurable'), configurableReg, false);

    if (element.kind === 'method' || element.kind === 'constructor') {
      const writableReg = this.emitConstant(ConstantKind.Boolean, true);
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'writable'), writableReg, false);
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'value'), fnReg, false);
      this.emitDefineProperty(targetReg, keyReg, descriptorReg);
      return;
    }

    const existingDescriptorReg = this.buildAccessorDescriptorSource(targetReg, keyReg, computed);
    const accessorValueReg = this.fnBuilder.allocRegister();
    if (element.kind === 'getter') {
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'get'), fnReg, false);
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: existingDescriptorReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'set') },
        ],
        accessorValueReg,
      );
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'set'), accessorValueReg, false);
    } else {
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'set'), fnReg, false);
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: existingDescriptorReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'get') },
        ],
        accessorValueReg,
      );
      this.emitObjectPropertyWrite(descriptorReg, this.emitConstant(ConstantKind.String, 'get'), accessorValueReg, false);
    }
    this.emitDefineProperty(targetReg, keyReg, descriptorReg);
  }

  private lowerClassLike(node: ts.ClassDeclaration | ts.ClassExpression, classBindingNameOverride?: string): Register {
    const normalized = this.normalizeClassLike(node);
    const classBindingName = classBindingNameOverride ?? normalized.bindingName;

    let classBinding: LocalBinding | undefined;
    let restoreBinding: LocalBinding | undefined;
    if (classBindingName) {
      if (classBindingNameOverride && classBindingNameOverride === normalized.bindingName) {
        restoreBinding = this.scope.get(classBindingName);
        classBinding = this.declareForcedBoxedIdentifier(classBindingName);
      } else if (this.scope.has(classBindingName)) {
        classBinding = this.scope.get(classBindingName);
      } else {
        classBinding = this.declareForcedBoxedIdentifier(classBindingName);
      }
    }

    for (const computedName of normalized.computedNames) {
      this.declareForcedBoxedIdentifier(computedName.bindingName);
      const valueReg = this.visitExpression(computedName.expression);
      this.initializeDeclaredIdentifier(computedName.bindingName, valueReg);
    }
    for (const bindingName of normalized.privateIdentifiers.values()) {
      this.declareForcedBoxedIdentifier(bindingName);
      this.initializeDeclaredIdentifier(bindingName, this.emitConstant(ConstantKind.String, bindingName));
    }

    const availableOuterNames = this.getAvailableOuterCaptureNames();
    const ctorReg = this.lowerClassConstructor(normalized, availableOuterNames, classBindingName ?? '<anonymous>');
    if (classBindingName) {
      this.initializeDeclaredIdentifier(classBindingName, ctorReg);
    }

    const prototypeReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.PropGet,
      [
        { kind: OperandKind.Register, value: ctorReg },
        { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'prototype') },
      ],
      prototypeReg,
    );

    for (const element of normalized.instanceElements) {
      if (element.kind === 'field' || element.kind === 'constructor') {
        continue;
      }
      const methodReg = this.lowerNestedFunctionLike(element.node as any, undefined, {
        availableOuterNames,
        extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
        privateIdentifierBindings: normalized.privateIdentifiers,
      });
      const key = this.getPropertyKeyRegister((element as any).keyName, (element as any).computedBindingName);
      this.emitClassMethodOrAccessorDescriptor(prototypeReg, key.register, key.computed, element as any, methodReg);
    }

    for (const element of normalized.staticElements) {
      if (element.kind === 'field') {
        const valueReg = element.node.initializer
          ? this.visitExpression(element.node.initializer)
          : this.emitConstant(ConstantKind.Undefined, null);
        if (element.privateBindingName) {
          const privateKeyReg = this.resolveVar(element.privateBindingName);
          const resultReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.PrivateSet, [
            { kind: OperandKind.Register, value: ctorReg },
            { kind: OperandKind.Register, value: privateKeyReg },
            { kind: OperandKind.Register, value: valueReg },
          ], resultReg);
          continue;
        }
        const key = this.getPropertyKeyRegister(element.keyName, element.computedBindingName);
        this.emitObjectPropertyWrite(ctorReg, key.register, valueReg, key.computed);
        continue;
      }
      if (element.kind === 'static_block') {
        const fakeFn = ts.factory.createFunctionExpression(
          undefined, undefined, undefined, undefined, [], undefined, element.node.body
        );
        const fnReg = this.lowerNestedFunctionLike(fakeFn, undefined, {
          availableOuterNames,
          extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
          privateIdentifierBindings: normalized.privateIdentifiers,
        });
        const callPropReg = this.emitConstant(ConstantKind.String, 'call');
        this.currentBlock.addInstruction(OpCode.CallMethod, [
          { kind: OperandKind.Register, value: fnReg },
          { kind: OperandKind.Register, value: callPropReg },
          { kind: OperandKind.Register, value: ctorReg },
        ]);
        continue;
      }
      const methodReg = this.lowerNestedFunctionLike(element.node as any, undefined, {
        availableOuterNames,
        extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
        privateIdentifierBindings: normalized.privateIdentifiers,
      });
      const key = this.getPropertyKeyRegister((element as any).keyName, (element as any).computedBindingName);
      this.emitClassMethodOrAccessorDescriptor(ctorReg, key.register, key.computed, element as any, methodReg);
    }

    if (restoreBinding) {
      this.scope.set(classBindingName!, restoreBinding);
    } else if (classBindingNameOverride && classBindingNameOverride === normalized.bindingName) {
      this.scope.delete(classBindingName!);
    }

    return ctorReg;
  }

  private emitClassConstructorGuard(classDisplayName: string): void {
    const newTargetReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadNewTarget, [], newTargetReg);
    const undefinedReg = this.emitConstant(ConstantKind.Undefined, null);
    const isUndefinedReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: newTargetReg },
        { kind: OperandKind.Register, value: undefinedReg },
      ],
      isUndefinedReg,
    );
    const throwBlock = this.fnBuilder.createBlock('class_ctor_throw');
    const continueBlock = this.fnBuilder.createBlock('class_ctor_continue');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isUndefinedReg, targets: [throwBlock.id, continueBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = throwBlock;
    const typeErrorReg = this.resolveVar('TypeError');
    const messageReg = this.emitConstant(ConstantKind.String, `Class constructor ${classDisplayName} cannot be invoked without 'new'`);
    const errorReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.New,
      [
        { kind: OperandKind.Register, value: typeErrorReg },
        { kind: OperandKind.Register, value: messageReg },
      ],
      errorReg,
    );
    this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: errorReg });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = continueBlock;
  }

  private emitInstanceFieldInitializers(fields: readonly NormalizedClassFieldElement[]): void {
    if (fields.length === 0) {
      return;
    }
    const thisReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
    for (const field of fields) {
      const valueReg = field.node.initializer
        ? this.visitExpression(field.node.initializer)
        : this.emitConstant(ConstantKind.Undefined, null);
      if (field.privateBindingName) {
        const privateKeyReg = this.resolveVar(field.privateBindingName);
        const resultReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.PrivateSet, [
          { kind: OperandKind.Register, value: thisReg },
          { kind: OperandKind.Register, value: privateKeyReg },
          { kind: OperandKind.Register, value: valueReg },
        ], resultReg);
        continue;
      }
      const key = this.getPropertyKeyRegister(field.keyName, field.computedBindingName);
      this.emitObjectPropertyWrite(thisReg, key.register, valueReg, key.computed);
    }
  }

  private resolvePrivateIdentifierRegister(identifier: ts.PrivateIdentifier): Register {
    const bindingName = this.privateIdentifierBindings.get(identifier.text);
    if (!bindingName) {
      this.failUnsupported(identifier, `Unknown private identifier ${identifier.text}`);
    }
    return this.resolveVar(bindingName);
  }

  private lowerNestedFunction(
    expr: ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
  ): Register {
    return this.lowerNestedFunctionLike(expr);
  }

  private buildClosureEnvironment(capturedNames: readonly string[]): Register {
    const envReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.ArrayNew, [], envReg);

    capturedNames.forEach((name, index) => {
      const indexReg = this.emitConstant(ConstantKind.Number, index);
      const cellReg = this.getCellForCapture(name);
      this.currentBlock.addInstruction(OpCode.ComputedSet, [
        { kind: OperandKind.Register, value: envReg },
        { kind: OperandKind.Register, value: indexReg },
        { kind: OperandKind.Register, value: cellReg },
      ]);
    });

    return envReg;
  }

  private getCellForCapture(name: string): Register {
    const localBinding = this.scope.get(name);
    if (localBinding) {
      if (!localBinding.boxed) {
        this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: localBinding.register }], localBinding.register);
        this.scope.set(name, { register: localBinding.register, boxed: true });
        this.fnBuilder.addCapturedVariable(name);
        return localBinding.register;
      }
      return localBinding.register;
    }
    if (name === LEXICAL_THIS_CAPTURE || name === LEXICAL_NEW_TARGET_CAPTURE) {
      this.initializeLexicalCapture(name);
      const lexicalBinding = this.scope.get(name);
      if (lexicalBinding?.boxed) {
        return lexicalBinding.register;
      }
    }
    if (this.outerCaptureBindings.has(name)) {
      return this.loadOuterCaptureCell(name);
    }
    this.failUnsupported(this.findIdentifierNode(name) ?? this.node, `Unknown capture "${name}"`);
  }

  private storeValue(target: ts.Expression, valueReg: Register): void {
    target = this.normalizeExpression(target);
    if (ts.isIdentifier(target)) {
      if (this.scope.has(target.text)) {
        const binding = this.scope.get(target.text)!;
        if (binding.boxed) {
          this.currentBlock.addInstruction(OpCode.CellSet, [{ kind: OperandKind.Register, value: binding.register }, { kind: OperandKind.Register, value: valueReg }]);
        } else {
          this.currentBlock.addInstruction(OpCode.StoreLocal, [{ kind: OperandKind.Register, value: binding.register }, { kind: OperandKind.Register, value: valueReg }]);
        }
      } else if (this.outerCaptureBindings.has(target.text)) {
        const cellReg = this.loadOuterCaptureCell(target.text);
        this.currentBlock.addInstruction(OpCode.CellSet, [{ kind: OperandKind.Register, value: cellReg }, { kind: OperandKind.Register, value: valueReg }]);
      } else {
        const strReg = this.emitConstant(ConstantKind.String, target.text);
        this.currentBlock.addInstruction(OpCode.StoreGlobal, [{ kind: OperandKind.Register, value: strReg }, { kind: OperandKind.Register, value: valueReg }]);
      }
      return;
    }

    if (ts.isPropertyAccessExpression(target)) {
      if (target.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const propReg = this.emitConstant(ConstantKind.String, target.name.text);
        this.currentBlock.addInstruction(OpCode.SuperPropSet, [
          { kind: OperandKind.Register, value: propReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
        return;
      }

      const objReg = this.visitExpression(target.expression);
      const propReg = this.emitConstant(ConstantKind.String, target.name.text);
      if (ts.isPrivateIdentifier(target.name)) {
        const privateKeyReg = this.resolvePrivateIdentifierRegister(target.name);
        this.currentBlock.addInstruction(OpCode.PrivateSet, [
          { kind: OperandKind.Register, value: objReg },
          { kind: OperandKind.Register, value: privateKeyReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
        return;
      }
      this.currentBlock.addInstruction(OpCode.PropSet, [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: propReg },
        { kind: OperandKind.Register, value: valueReg },
      ]);
      return;
    }

    if (ts.isElementAccessExpression(target)) {
      if (!target.argumentExpression) {
        this.failUnsupported(target, 'Element access assignment requires an index expression');
      }
      const objReg = this.visitExpression(target.expression);
      const indexReg = this.visitExpression(target.argumentExpression);
      this.currentBlock.addInstruction(OpCode.ComputedSet, [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: indexReg },
        { kind: OperandKind.Register, value: valueReg },
      ]);
      return;
    }

    if (ts.isArrayLiteralExpression(target)) {
      this.storeArrayPattern(target, valueReg);
      return;
    }

    if (ts.isObjectLiteralExpression(target)) {
      this.storeObjectPattern(target, valueReg);
      return;
    }

    this.failUnsupported(target, 'Unsupported assignment target');
  }

  private readValue(target: ts.Expression): Register {
    if (ts.isIdentifier(target)) {
      return this.resolveVar(target.text);
    }
    if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
      return this.visitExpression(target);
    }
    this.failUnsupported(target, 'Unsupported read target');
  }

  private emitObjectPropertyAssignment(objectReg: Register, nameReg: Register, valueReg: Register, computed = false): void {
    this.currentBlock.addInstruction(computed ? OpCode.ComputedSet : OpCode.PropSet, [
      { kind: OperandKind.Register, value: objectReg },
      { kind: OperandKind.Register, value: nameReg },
      { kind: OperandKind.Register, value: valueReg },
    ]);
  }

  private normalizeExpression(expr: ts.Expression): ts.Expression {
    let current = expr;
    while (
      ts.isParenthesizedExpression(current) ||
      ts.isAsExpression(current) ||
      ts.isNonNullExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isTypeAssertionExpression(current)
    ) {
      if (ts.isParenthesizedExpression(current)) {
        current = current.expression;
      } else {
        current = current.expression;
      }
    }
    return current;
  }

  private createTempLocal(prefix: string): Register {
    return this.fnBuilder.addLocal(`$${prefix}_${this.tempLocalCount++}`, IRType.Any);
  }

  private createSyntheticBindingName(prefix: string): string {
    return `$$${prefix}_${this.tempLocalCount++}`;
  }

  private declareScopedIdentifier(name: string): LocalBinding {
    const existing = this.scope.get(name);
    if (existing) {
      return existing;
    }
    const boxed = this.capturedLocals.has(name);
    const register = this.fnBuilder.addLocal(name, IRType.Any);
    const binding = { register, boxed };
    this.scope.set(name, binding);
    return binding;
  }

  private declareForcedBoxedIdentifier(name: string): LocalBinding {
    const register = this.fnBuilder.addLocal(name, IRType.Any, true);
    const binding = { register, boxed: true } as const;
    this.scope.set(name, binding);
    const undefReg = this.emitConstant(ConstantKind.Undefined, null);
    this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: undefReg }], binding.register);
    this.fnBuilder.addCapturedVariable(name);
    return binding;
  }

  private withTemporaryBinding<T>(name: string, callback: () => T): { readonly result: T; readonly binding: LocalBinding; readonly restoreBinding?: LocalBinding } {
    const restoreBinding = this.scope.get(name);
    const binding = this.declareForcedBoxedIdentifier(name);
    const result = callback();
    if (restoreBinding) {
      this.scope.set(name, restoreBinding);
    } else {
      this.scope.delete(name);
    }
    return { result, binding, restoreBinding };
  }

  private getPropertyKeyRegister(keyName?: string, computedBindingName?: string): { readonly register: Register; readonly computed: boolean } {
    if (computedBindingName) {
      return {
        register: this.resolveVar(computedBindingName),
        computed: true,
      };
    }
    if (keyName === undefined) {
      this.failUnsupported(this.node, 'Missing class element key');
    }
    return {
      register: this.emitConstant(ConstantKind.String, keyName),
      computed: false,
    };
  }

  private buildAccessorDescriptorSource(targetReg: Register, keyReg: Register, computed: boolean): Register {
    const descriptorReg = this.fnBuilder.allocRegister();
    const objectReg = this.resolveVar('Object');
    const descriptorMethod = this.emitConstant(ConstantKind.String, 'getOwnPropertyDescriptor');
    const callArgs: Operand[] = [
      { kind: OperandKind.Register, value: objectReg },
      { kind: OperandKind.Register, value: descriptorMethod },
      { kind: OperandKind.Register, value: targetReg },
      { kind: OperandKind.Register, value: keyReg },
    ];
    this.currentBlock.addInstruction(OpCode.CallMethod, callArgs, descriptorReg);
    const descriptorLocal = this.createTempLocal('accessor_desc');
    this.storeToLocal(descriptorLocal, descriptorReg);
    const undefinedReg = this.emitConstant(ConstantKind.Undefined, null);
    const isUndefinedReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: descriptorReg },
        { kind: OperandKind.Register, value: undefinedReg },
      ],
      isUndefinedReg,
    );
    const undefinedBlock = this.fnBuilder.createBlock('accessor_desc_undefined');
    const endBlock = this.fnBuilder.createBlock('accessor_desc_end');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isUndefinedReg, targets: [undefinedBlock.id, endBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = undefinedBlock;
    const emptyDescriptorReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.ObjectNew, [], emptyDescriptorReg);
    this.storeToLocal(descriptorLocal, emptyDescriptorReg);
    this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = endBlock;
    return this.loadFromLocal(descriptorLocal);
  }

  private emitObjectPropertyWrite(targetReg: Register, keyReg: Register, valueReg: Register, computed: boolean): void {
    this.currentBlock.addInstruction(
      computed ? OpCode.ComputedSet : OpCode.PropSet,
      [
        { kind: OperandKind.Register, value: targetReg },
        { kind: OperandKind.Register, value: keyReg },
        { kind: OperandKind.Register, value: valueReg },
      ],
    );
  }

  private emitDefineProperty(targetReg: Register, keyReg: Register, descriptorReg: Register): void {
    const objectReg = this.resolveVar('Object');
    const definePropertyReg = this.emitConstant(ConstantKind.String, 'defineProperty');
    this.currentBlock.addInstruction(
      OpCode.CallMethod,
      [
        { kind: OperandKind.Register, value: objectReg },
        { kind: OperandKind.Register, value: definePropertyReg },
        { kind: OperandKind.Register, value: targetReg },
        { kind: OperandKind.Register, value: keyReg },
        { kind: OperandKind.Register, value: descriptorReg },
      ],
      this.fnBuilder.allocRegister(),
    );
  }

  private initializeDeclaredIdentifier(name: string, initializerReg?: Register): void {
    const existing = this.scope.get(name);
    const binding = this.declareScopedIdentifier(name);
    if (initializerReg !== undefined) {
      if (binding.boxed) {
        if (existing) {
          this.currentBlock.addInstruction(OpCode.CellSet, [
            { kind: OperandKind.Register, value: binding.register },
            { kind: OperandKind.Register, value: initializerReg },
          ]);
        } else {
          this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: initializerReg }], binding.register);
          this.fnBuilder.addCapturedVariable(name);
        }
      } else {
        this.currentBlock.addInstruction(OpCode.StoreLocal, [
          { kind: OperandKind.Register, value: binding.register },
          { kind: OperandKind.Register, value: initializerReg },
        ]);
      }
      return;
    }

    if (binding.boxed) {
      const undefReg = this.emitConstant(ConstantKind.Undefined, null);
      this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: undefReg }], binding.register);
      this.fnBuilder.addCapturedVariable(name);
    }
  }

  private applyDefaultValue(sourceReg: Register, initializer?: ts.Expression): Register {
    if (!initializer) {
      return sourceReg;
    }

    const undefinedReg = this.emitConstant(ConstantKind.Undefined, null);
    const isUndefinedReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: sourceReg },
        { kind: OperandKind.Register, value: undefinedReg },
      ],
      isUndefinedReg,
    );
    return this.lowerConditionalExpression(
      isUndefinedReg,
      () => this.visitExpression(initializer),
      () => sourceReg,
    );
  }

  private materializeBindingElementValue(element: ts.BindingElement, sourceReg: Register): Register {
    return this.applyDefaultValue(sourceReg, element.initializer);
  }

  private emitRestArgs(startIndex: number): Register {
    const destReg = this.fnBuilder.allocRegister();
    const indexReg = this.emitConstant(ConstantKind.Number, startIndex);
    this.currentBlock.addInstruction(OpCode.RestArgs, [{ kind: OperandKind.Register, value: indexReg }], destReg);
    return destReg;
  }

  private emitArraySlice(sourceReg: Register, startIndex: number): Register {
    const destReg = this.fnBuilder.allocRegister();
    const indexReg = this.emitConstant(ConstantKind.Number, startIndex);
    this.currentBlock.addInstruction(
      OpCode.CallMethod,
      [
        { kind: OperandKind.Register, value: sourceReg },
        { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'slice') },
        { kind: OperandKind.Register, value: indexReg },
      ],
      destReg,
    );
    return destReg;
  }

  private emitSpreadInto(targetReg: Register, sourceReg: Register): void {
    this.currentBlock.addInstruction(
      OpCode.Spread,
      [
        { kind: OperandKind.Register, value: targetReg },
        { kind: OperandKind.Register, value: sourceReg },
      ],
    );
  }

  private emitSpreadIntoArray(targetReg: Register, sourceReg: Register, startIndexReg: Register, destIndexLocal: Register): void {
    const spreadCountReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.SpreadIntoArray,
      [
        { kind: OperandKind.Register, value: targetReg },
        { kind: OperandKind.Register, value: sourceReg },
        { kind: OperandKind.Register, value: startIndexReg },
      ],
      spreadCountReg,
    );
    const nextIndexReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.Add,
      [
        { kind: OperandKind.Register, value: startIndexReg },
        { kind: OperandKind.Register, value: spreadCountReg },
      ],
      nextIndexReg,
    );
    this.storeToLocal(destIndexLocal, nextIndexReg);
  }

  private bindPattern(bindingName: ts.BindingName, sourceReg: Register, mode: 'declare' | 'assign' = 'declare'): void {
    if (ts.isIdentifier(bindingName)) {
      if (mode === 'declare') {
        this.initializeDeclaredIdentifier(bindingName.text, sourceReg);
      } else {
        this.storeValue(bindingName, sourceReg);
      }
      return;
    }

    if (ts.isObjectBindingPattern(bindingName)) {
      let restElement: ts.BindingElement | undefined;
      const excludedKeys: string[] = [];
      for (const element of bindingName.elements) {
        if (element.dotDotDotToken) {
          restElement = element;
          continue;
        }
        const propertyName = element.propertyName ?? element.name;
        const keyText =
          ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName) || ts.isNumericLiteral(propertyName)
            ? propertyName.text
            : undefined;
        if (!keyText) {
          this.failUnsupported(propertyName, 'Unsupported object binding property name');
        }
        excludedKeys.push(keyText);
        const keyReg = this.emitConstant(ConstantKind.String, keyText);
        const valueReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(
          OpCode.PropGet,
          [
            { kind: OperandKind.Register, value: sourceReg },
            { kind: OperandKind.Register, value: keyReg },
          ],
          valueReg,
        );
        this.bindPattern(element.name, this.materializeBindingElementValue(element, valueReg), mode);
      }
      if (restElement) {
        const restReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.ObjectNew, [], restReg);
        this.emitSpreadInto(restReg, sourceReg);
        excludedKeys.forEach((key) => {
          this.currentBlock.addInstruction(OpCode.Delete, [
            { kind: OperandKind.Register, value: restReg },
            { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, key) },
          ]);
        });
        this.bindPattern(restElement.name, restReg, mode);
      }
      return;
    }

    if (ts.isArrayBindingPattern(bindingName)) {
      bindingName.elements.forEach((element, index) => {
        if (ts.isOmittedExpression(element)) {
          return;
        }
        if (element.dotDotDotToken) {
          this.bindPattern(element.name, this.emitArraySlice(sourceReg, index), mode);
          return;
        }
        const indexReg = this.emitConstant(ConstantKind.Number, index);
        const valueReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(
          OpCode.ComputedGet,
          [
            { kind: OperandKind.Register, value: sourceReg },
            { kind: OperandKind.Register, value: indexReg },
          ],
          valueReg,
        );
        this.bindPattern(element.name, this.materializeBindingElementValue(element, valueReg), mode);
      });
      return;
    }

    this.failUnsupported(bindingName, 'Unsupported binding pattern');
  }

  private initializeVariableDeclaration(decl: ts.VariableDeclaration): void {
    const initializerReg = decl.initializer ? this.visitExpression(decl.initializer) : undefined;
    if (ts.isIdentifier(decl.name)) {
      this.initializeDeclaredIdentifier(decl.name.text, initializerReg);
      return;
    }
    if (initializerReg === undefined) {
      this.failUnsupported(decl.name, 'Destructuring declarations require an initializer');
    }
    this.bindPattern(decl.name, initializerReg, 'declare');
  }

  private assignLoopBinding(initializer: ts.ForInitializer | ts.ForInOrOfStatement['initializer'], valueReg: Register, loopKind: string): void {
    if (ts.isVariableDeclarationList(initializer)) {
      if (initializer.declarations.length !== 1) {
        this.failUnsupported(initializer, `${loopKind} supports a single declaration only`);
      }
      const decl = initializer.declarations[0]!;
      if (decl.initializer) {
        this.failUnsupported(decl, `${loopKind} declaration initializers are not supported`);
      }
      if (ts.isIdentifier(decl.name)) {
        this.initializeDeclaredIdentifier(decl.name.text, valueReg);
        return;
      }
      this.bindPattern(decl.name, valueReg, 'declare');
      return;
    }

    this.storeValue(initializer, valueReg);
  }

  private loadFromLocal(localReg: Register): Register {
    const destReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadLocal, [{ kind: OperandKind.Register, value: localReg }], destReg);
    return destReg;
  }

  private getActiveFinallyContext(): FinallyContext | undefined {
    return this.finallyContexts[this.finallyContexts.length - 1];
  }

  private withFinallyContext<T>(context: FinallyContext, callback: () => T): T {
    this.finallyContexts.push(context);
    try {
      return callback();
    } finally {
      this.finallyContexts.pop();
    }
  }

  private withPassthroughThrow<T>(callback: () => T): T {
    this.throwPassthroughFinallyDepth += 1;
    try {
      return callback();
    } finally {
      this.throwPassthroughFinallyDepth -= 1;
    }
  }

  private createFinallyContext(finallyBlockId: string): FinallyContext {
    return {
      finallyBlockId,
      completionKindLocal: this.createTempLocal('completion_kind'),
      completionValueLocal: this.createTempLocal('completion_value'),
      completionTargetLocal: this.createTempLocal('completion_target'),
      targets: [],
    };
  }

  private getCompletionTargetCode(context: FinallyContext, kind: 'break' | 'continue', blockId: string): number {
    const existing = context.targets.find((target) => target.kind === kind && target.blockId === blockId);
    if (existing) {
      return existing.code;
    }
    const code = context.targets.length + 1;
    context.targets.push({ code, kind, blockId });
    return code;
  }

  private setFinallyCompletion(context: FinallyContext, kind: CompletionKind, valueReg?: Register, target?: { kind: 'break' | 'continue'; blockId: string }): void {
    this.storeToLocal(context.completionKindLocal, this.emitConstant(ConstantKind.Number, kind));
    if (valueReg) {
      this.storeToLocal(context.completionValueLocal, valueReg);
    }
    if (target) {
      const codeReg = this.emitConstant(ConstantKind.Number, this.getCompletionTargetCode(context, target.kind, target.blockId));
      this.storeToLocal(context.completionTargetLocal, codeReg);
    }
  }

  private routeAbruptCompletionThroughFinally(kind: CompletionKind, valueReg?: Register, target?: { kind: 'break' | 'continue'; blockId: string }): void {
    if (kind === 2 && this.throwPassthroughFinallyDepth > 0) {
      this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = this.fnBuilder.createBlock('unreachable');
      return;
    }

    const context = this.getActiveFinallyContext();
    if (!context) {
      if (kind === 1) {
        this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valueReg });
      } else if (kind === 2) {
        this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
      } else if ((kind === 3 || kind === 4) && target) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [target.blockId] });
      }
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = this.fnBuilder.createBlock('unreachable');
      return;
    }

    this.setFinallyCompletion(context, kind, valueReg, target);
    this.emitJumpAndAdvance(context.finallyBlockId, 'unreachable');
  }

  private emitCompletionTargetDispatch(context: FinallyContext, kind: 'break' | 'continue', fallbackTargetId: string): void {
    const targets = context.targets.filter((target) => target.kind === kind);
    if (targets.length === 0) {
      this.currentBlock.setTerminator({ kind: 'jump', targets: [fallbackTargetId] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      return;
    }

    targets.forEach((target, index) => {
      const targetCodeReg = this.loadFromLocal(context.completionTargetLocal);
      const expectedCodeReg = this.emitConstant(ConstantKind.Number, target.code);
      const isMatchReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.StrictEq,
        [
          { kind: OperandKind.Register, value: targetCodeReg },
          { kind: OperandKind.Register, value: expectedCodeReg },
        ],
        isMatchReg,
      );
      const fallbackBlock = index === targets.length - 1 ? undefined : this.fnBuilder.createBlock(`finally_${kind}_dispatch_${index}`);
      this.currentBlock.setTerminator({
        kind: 'branch',
        condition: isMatchReg,
        targets: [target.blockId, fallbackBlock?.id ?? fallbackTargetId],
      });
      this.fnBuilder.addBlock(this.currentBlock.build());
      if (fallbackBlock) {
        this.currentBlock = fallbackBlock;
      }
    });
  }

  private emitCompletionDispatch(context: FinallyContext, normalTargetId: string): void {
    const normalCheckBlock = this.fnBuilder.createBlock('finally_normal_check');
    this.currentBlock.setTerminator({ kind: 'jump', targets: [normalCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = normalCheckBlock;
    const normalKindReg = this.loadFromLocal(context.completionKindLocal);
    const normalConstReg = this.emitConstant(ConstantKind.Number, 0);
    const isNormalReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: normalKindReg },
        { kind: OperandKind.Register, value: normalConstReg },
      ],
      isNormalReg,
    );
    const returnCheckBlock = this.fnBuilder.createBlock('finally_return_check');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isNormalReg, targets: [normalTargetId, returnCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = returnCheckBlock;
    const returnKindReg = this.loadFromLocal(context.completionKindLocal);
    const returnConstReg = this.emitConstant(ConstantKind.Number, 1);
    const isReturnReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: returnKindReg },
        { kind: OperandKind.Register, value: returnConstReg },
      ],
      isReturnReg,
    );
    const returnBlock = this.fnBuilder.createBlock('finally_return');
    const throwCheckBlock = this.fnBuilder.createBlock('finally_throw_check');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isReturnReg, targets: [returnBlock.id, throwCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = returnBlock;
    this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: this.loadFromLocal(context.completionValueLocal) });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = throwCheckBlock;
    const throwKindReg = this.loadFromLocal(context.completionKindLocal);
    const throwConstReg = this.emitConstant(ConstantKind.Number, 2);
    const isThrowReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: throwKindReg },
        { kind: OperandKind.Register, value: throwConstReg },
      ],
      isThrowReg,
    );
    const throwBlock = this.fnBuilder.createBlock('finally_throw');
    const breakCheckBlock = this.fnBuilder.createBlock('finally_break_check');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isThrowReg, targets: [throwBlock.id, breakCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = throwBlock;
    this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: this.loadFromLocal(context.completionValueLocal) });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = breakCheckBlock;
    const breakKindReg = this.loadFromLocal(context.completionKindLocal);
    const breakConstReg = this.emitConstant(ConstantKind.Number, 3);
    const isBreakReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: breakKindReg },
        { kind: OperandKind.Register, value: breakConstReg },
      ],
      isBreakReg,
    );
    const breakDispatchBlock = this.fnBuilder.createBlock('finally_break_dispatch');
    const continueCheckBlock = this.fnBuilder.createBlock('finally_continue_check');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isBreakReg, targets: [breakDispatchBlock.id, continueCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = breakDispatchBlock;
    this.emitCompletionTargetDispatch(context, 'break', normalTargetId);

    this.currentBlock = continueCheckBlock;
    const continueKindReg = this.loadFromLocal(context.completionKindLocal);
    const continueConstReg = this.emitConstant(ConstantKind.Number, 4);
    const isContinueReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(
      OpCode.StrictEq,
      [
        { kind: OperandKind.Register, value: continueKindReg },
        { kind: OperandKind.Register, value: continueConstReg },
      ],
      isContinueReg,
    );
    const continueDispatchBlock = this.fnBuilder.createBlock('finally_continue_dispatch');
    this.currentBlock.setTerminator({ kind: 'branch', condition: isContinueReg, targets: [continueDispatchBlock.id, normalTargetId] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = continueDispatchBlock;
    this.emitCompletionTargetDispatch(context, 'continue', normalTargetId);
  }

  private bindCatchVariable(catchClause: ts.CatchClause, exceptionLocal: Register): void {
    if (!catchClause.variableDeclaration) {
      return;
    }
    const exceptionValue = this.loadFromLocal(exceptionLocal);
    this.bindPattern(catchClause.variableDeclaration.name, exceptionValue, 'declare');
  }

  private lowerTryCatchStatement(stmt: ts.TryStatement): void {
    if (!stmt.catchClause) {
      this.failUnsupported(stmt, 'try without catch requires finally support');
    }

    const exceptionLocal = this.createTempLocal('try_exception');
    const tryBlock = this.fnBuilder.createBlock('try_body');
    const catchBlock = this.fnBuilder.createBlock('try_catch');
    const endBlock = this.fnBuilder.createBlock('try_end');

    this.currentBlock.setTerminator({ kind: 'jump', targets: [tryBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = tryBlock;
    this.currentBlock.addInstruction(OpCode.TryCatchBegin, [
      { kind: OperandKind.BlockLabel, value: catchBlock.id },
      { kind: OperandKind.BlockLabel, value: catchBlock.id },
      { kind: OperandKind.Register, value: exceptionLocal },
    ]);
    this.visitStatement(stmt.tryBlock);
    if (!this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw') {
      this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }

    this.currentBlock = catchBlock;
    this.bindCatchVariable(stmt.catchClause, exceptionLocal);
    this.visitStatement(stmt.catchClause.block);
    if (!this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw') {
      this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }

    this.currentBlock = endBlock;
  }

  private lowerTryFinallyStatement(stmt: ts.TryStatement): void {
    const finallyBlock = this.fnBuilder.createBlock('try_finally');
    const afterBlock = this.fnBuilder.createBlock('try_end');
    const completion = this.createFinallyContext(finallyBlock.id);
    const tryBlock = this.fnBuilder.createBlock('try_body');
    const tryExceptionLocal = this.createTempLocal('try_exception');
    const tryExceptionBlock = this.fnBuilder.createBlock('try_exception');
    const catchClause = stmt.catchClause;
    const catchBlock = catchClause ? this.fnBuilder.createBlock('try_catch') : undefined;
    const catchExceptionLocal = catchClause ? this.createTempLocal('catch_exception') : undefined;
    const catchExceptionBlock = catchClause ? this.fnBuilder.createBlock('catch_exception') : undefined;

    this.currentBlock.setTerminator({ kind: 'jump', targets: [tryBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = tryBlock;
    this.currentBlock.addInstruction(OpCode.TryCatchBegin, [
      { kind: OperandKind.BlockLabel, value: catchBlock?.id ?? tryExceptionBlock.id },
      { kind: OperandKind.BlockLabel, value: catchBlock?.id ?? tryExceptionBlock.id },
      { kind: OperandKind.Register, value: tryExceptionLocal },
    ]);
    if (catchBlock) {
      this.withFinallyContext(completion, () => this.withPassthroughThrow(() => this.visitStatement(stmt.tryBlock)));
    } else {
      this.withFinallyContext(completion, () => this.visitStatement(stmt.tryBlock));
    }
    if (!this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw') {
      this.setFinallyCompletion(completion, 0);
      this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }

    if (catchBlock && catchClause && catchExceptionLocal && catchExceptionBlock) {
      this.currentBlock = catchBlock;
      this.bindCatchVariable(catchClause, tryExceptionLocal);
      this.currentBlock.addInstruction(OpCode.TryCatchBegin, [
        { kind: OperandKind.BlockLabel, value: catchExceptionBlock.id },
        { kind: OperandKind.BlockLabel, value: catchExceptionBlock.id },
        { kind: OperandKind.Register, value: catchExceptionLocal },
      ]);
      this.withFinallyContext(completion, () => this.visitStatement(catchClause.block));
      if (!this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw') {
        this.setFinallyCompletion(completion, 0);
        this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }

      this.currentBlock = catchExceptionBlock;
      this.setFinallyCompletion(completion, 2, this.loadFromLocal(catchExceptionLocal));
      this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }

    this.currentBlock = tryExceptionBlock;
    this.setFinallyCompletion(completion, 2, this.loadFromLocal(tryExceptionLocal));
    this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = finallyBlock;
    this.visitStatement(stmt.finallyBlock!);
    if (!this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw') {
      this.emitCompletionDispatch(completion, afterBlock.id);
    }

    this.currentBlock = afterBlock;
  }

  private lowerConditionalExpression(
    conditionReg: Register,
    whenTrue: () => Register,
    whenFalse: () => Register
  ): Register {
    const tempReg = this.createTempLocal('expr');
    const trueBlock = this.fnBuilder.createBlock('expr_true');
    const falseBlock = this.fnBuilder.createBlock('expr_false');
    const endBlock = this.fnBuilder.createBlock('expr_end');

    trueBlock.addPredecessor(this.currentBlock.id);
    falseBlock.addPredecessor(this.currentBlock.id);
    this.currentBlock.setTerminator({ kind: 'branch', condition: conditionReg, targets: [trueBlock.id, falseBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = trueBlock;
    const trueValue = whenTrue();
    this.currentBlock.addInstruction(OpCode.StoreLocal, [
      { kind: OperandKind.Register, value: tempReg },
      { kind: OperandKind.Register, value: trueValue },
    ]);
    this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
    endBlock.addPredecessor(this.currentBlock.id);
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = falseBlock;
    const falseValue = whenFalse();
    this.currentBlock.addInstruction(OpCode.StoreLocal, [
      { kind: OperandKind.Register, value: tempReg },
      { kind: OperandKind.Register, value: falseValue },
    ]);
    this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
    endBlock.addPredecessor(this.currentBlock.id);
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = endBlock;
    return this.loadFromLocal(tempReg);
  }

  private lowerNullishCoalesce(leftReg: Register, rightExpr: ts.Expression): Register {
    const tempReg = this.createTempLocal('nullish');
    this.currentBlock.addInstruction(OpCode.StoreLocal, [
      { kind: OperandKind.Register, value: tempReg },
      { kind: OperandKind.Register, value: leftReg },
    ]);

    const nullConst = this.emitConstant(ConstantKind.Null, null);
    const undefConst = this.emitConstant(ConstantKind.Undefined, null);
    const isNullReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.StrictEq, [
      { kind: OperandKind.Register, value: leftReg },
      { kind: OperandKind.Register, value: nullConst },
    ], isNullReg);

    const rhsBlock = this.fnBuilder.createBlock('nullish_rhs');
    const undefCheckBlock = this.fnBuilder.createBlock('nullish_undef');
    const endBlock = this.fnBuilder.createBlock('nullish_end');

    rhsBlock.addPredecessor(this.currentBlock.id);
    undefCheckBlock.addPredecessor(this.currentBlock.id);
    this.currentBlock.setTerminator({ kind: 'branch', condition: isNullReg, targets: [rhsBlock.id, undefCheckBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = undefCheckBlock;
    const isUndefReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.StrictEq, [
      { kind: OperandKind.Register, value: leftReg },
      { kind: OperandKind.Register, value: undefConst },
    ], isUndefReg);
    rhsBlock.addPredecessor(this.currentBlock.id);
    endBlock.addPredecessor(this.currentBlock.id);
    this.currentBlock.setTerminator({ kind: 'branch', condition: isUndefReg, targets: [rhsBlock.id, endBlock.id] });
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = rhsBlock;
    const rightReg = this.visitExpression(rightExpr);
    this.currentBlock.addInstruction(OpCode.StoreLocal, [
      { kind: OperandKind.Register, value: tempReg },
      { kind: OperandKind.Register, value: rightReg },
    ]);
    this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
    endBlock.addPredecessor(this.currentBlock.id);
    this.fnBuilder.addBlock(this.currentBlock.build());

    this.currentBlock = endBlock;
    return this.loadFromLocal(tempReg);
  }

  private lowerTemplateExpression(expr: ts.TemplateExpression): Register {
    let accReg = this.emitConstant(ConstantKind.String, expr.head.text);

    for (const span of expr.templateSpans) {
      const valueReg = this.visitExpression(span.expression);
      const combinedValue = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.Add, [
        { kind: OperandKind.Register, value: accReg },
        { kind: OperandKind.Register, value: valueReg },
      ], combinedValue);
      accReg = combinedValue;

      if (span.literal.text.length > 0) {
        const literalReg = this.emitConstant(ConstantKind.String, span.literal.text);
        const combinedLiteral = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.Add, [
          { kind: OperandKind.Register, value: accReg },
          { kind: OperandKind.Register, value: literalReg },
        ], combinedLiteral);
        accReg = combinedLiteral;
      }
    }

    return accReg;
  }

  private lowerNestedFunctionNode(expr: SupportedFunctionNode, explicitName?: string): Register {
    return this.lowerNestedFunctionLike(expr, explicitName);
  }

  private visitExpression(expr: ts.Expression): Register {
    expr = this.normalizeExpression(expr);
    if (ts.isNumericLiteral(expr)) {
      return this.emitConstant(ConstantKind.Number, parseFloat(expr.text));
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return this.emitConstant(ConstantKind.String, expr.text);
    }
    if (ts.isBigIntLiteral(expr)) {
      const bigintGlobalReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadGlobal, [{ kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'BigInt') }], bigintGlobalReg);

      const valReg = this.emitConstant(ConstantKind.String, expr.text);
      const resReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.Call,
        [
          { kind: OperandKind.Register, value: bigintGlobalReg },
          { kind: OperandKind.Register, value: valReg }
        ],
        resReg
      );
      return resReg;
    }
    if (ts.isRegularExpressionLiteral(expr)) {
      const rawText = expr.text;
      const lastSlashIndex = rawText.lastIndexOf('/');
      const pattern = rawText.slice(1, lastSlashIndex);
      const flags = rawText.slice(lastSlashIndex + 1);

      const objectGlobalReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadGlobal, [{ kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'RegExp') }], objectGlobalReg);

      const patternReg = this.emitConstant(ConstantKind.String, pattern);
      const flagsReg = this.emitConstant(ConstantKind.String, flags);

      const resReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.New, [
        { kind: OperandKind.Register, value: objectGlobalReg },
        { kind: OperandKind.Register, value: patternReg },
        { kind: OperandKind.Register, value: flagsReg }
      ], resReg);
      return resReg;
    }
    if (ts.isTemplateExpression(expr)) {
      return this.lowerTemplateExpression(expr);
    }
    if (ts.isAwaitExpression(expr)) {
      if (!this.isAsyncFunction) {
        this.failUnsupported(expr, 'await outside async function is not supported');
      }
      const awaitedSourceReg = this.visitExpression(expr.expression);
      const awaitedValueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.Await,
        [{ kind: OperandKind.Register, value: awaitedSourceReg }],
        awaitedValueReg,
      );
      return awaitedValueReg;
    }
    if (ts.isYieldExpression(expr)) {
      if (!this.isGenerator) {
        this.failUnsupported(expr, 'yield outside generator is not supported');
      }
      const yieldedValueReg = expr.expression
        ? this.visitExpression(expr.expression)
        : this.emitConstant(ConstantKind.Undefined, null);
      const resReg = this.fnBuilder.allocRegister();
      if (expr.asteriskToken) {
        this.currentBlock.addInstruction(
          OpCode.YieldStar,
          [{ kind: OperandKind.Register, value: yieldedValueReg }],
          resReg,
        );
      } else {
        this.currentBlock.addInstruction(
          OpCode.Yield,
          [{ kind: OperandKind.Register, value: yieldedValueReg }],
          resReg,
        );
      }
      return resReg;
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) return this.emitConstant(ConstantKind.Null, null);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return this.emitConstant(ConstantKind.Boolean, true);
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return this.emitConstant(ConstantKind.Boolean, false);
    if (expr.kind === ts.SyntaxKind.ThisKeyword) {
      if (ts.isArrowFunction(this.node)) {
        return this.resolveLexicalCapture(LEXICAL_THIS_CAPTURE, expr, 'lexical this in arrow function requires an enclosing function context');
      }
      const thisReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
      return thisReg;
    }
    if (ts.isMetaProperty(expr)) {
      if (expr.keywordToken === ts.SyntaxKind.NewKeyword && expr.name.text === 'target') {
        if (ts.isArrowFunction(this.node)) {
          return this.resolveLexicalCapture(
            LEXICAL_NEW_TARGET_CAPTURE,
            expr,
            'lexical new.target in arrow function requires an enclosing function context',
          );
        }
        const newTargetReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.LoadNewTarget, [], newTargetReg);
        return newTargetReg;
      }
      this.failUnsupported(expr, 'meta property is not supported');
    }
    
    if (ts.isIdentifier(expr)) {
      return this.resolveVar(expr.text);
    }

    if (ts.isConditionalExpression(expr)) {
      const conditionReg = this.visitExpression(expr.condition);
      return this.lowerConditionalExpression(
        conditionReg,
        () => this.visitExpression(expr.whenTrue),
        () => this.visitExpression(expr.whenFalse),
      );
    }
    
    if (ts.isBinaryExpression(expr)) {
      if (
        expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const leftReg = this.visitExpression(expr.left);
        if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
          return this.lowerConditionalExpression(leftReg, () => this.visitExpression(expr.right), () => leftReg);
        }
        if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
          return this.lowerConditionalExpression(leftReg, () => leftReg, () => this.visitExpression(expr.right));
        }
        return this.lowerNullishCoalesce(leftReg, expr.right);
      }
      if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const valueReg = this.visitExpression(expr.right);
        this.storeValue(expr.left, valueReg);
        return valueReg;
      }
      
      if (expr.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isPrivateIdentifier(expr.left)) {
        const leftReg = this.resolvePrivateIdentifierRegister(expr.left);
        const rightReg = this.visitExpression(expr.right);
        const resReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.PrivateIn, [{ kind: OperandKind.Register, value: rightReg }, { kind: OperandKind.Register, value: leftReg }], resReg);
        return resReg;
      }

      const leftReg = this.visitExpression(expr.left);
      const rightReg = this.visitExpression(expr.right);
      const resReg = this.fnBuilder.allocRegister();
      
      const opMap: Record<number, OpCode> = {
        [ts.SyntaxKind.PlusToken]: OpCode.Add,
        [ts.SyntaxKind.MinusToken]: OpCode.Sub,
        [ts.SyntaxKind.AsteriskToken]: OpCode.Mul,
        [ts.SyntaxKind.SlashToken]: OpCode.Div,
        [ts.SyntaxKind.PercentToken]: OpCode.Mod,
        [ts.SyntaxKind.LessThanLessThanToken]: OpCode.Shl,
        [ts.SyntaxKind.GreaterThanGreaterThanToken]: OpCode.Shr,
        [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]: OpCode.UShr,
        [ts.SyntaxKind.BarToken]: OpCode.BitOr,
        [ts.SyntaxKind.AmpersandToken]: OpCode.BitAnd,
        [ts.SyntaxKind.CaretToken]: OpCode.BitXor,
        [ts.SyntaxKind.LessThanToken]: OpCode.Lt,
        [ts.SyntaxKind.GreaterThanToken]: OpCode.Gt,
        [ts.SyntaxKind.LessThanEqualsToken]: OpCode.LtEq,
        [ts.SyntaxKind.GreaterThanEqualsToken]: OpCode.GtEq,
        [ts.SyntaxKind.EqualsEqualsToken]: OpCode.Eq,
        [ts.SyntaxKind.EqualsEqualsEqualsToken]: OpCode.StrictEq,
        [ts.SyntaxKind.ExclamationEqualsToken]: OpCode.Eq, // Wait, not in OpCode enum, typically mapped to Not after Eq?
        [ts.SyntaxKind.ExclamationEqualsEqualsToken]: OpCode.StrictEq,
        [ts.SyntaxKind.InKeyword]: OpCode.In,
        [ts.SyntaxKind.InstanceOfKeyword]: OpCode.InstanceOf,
      };
      
      const isCompound = expr.operatorToken.kind >= ts.SyntaxKind.PlusEqualsToken && expr.operatorToken.kind <= ts.SyntaxKind.CaretEqualsToken;
      if (isCompound) {
        const cmpMap: Record<number, OpCode> = {
          [ts.SyntaxKind.PlusEqualsToken]: OpCode.Add,
          [ts.SyntaxKind.MinusEqualsToken]: OpCode.Sub,
          [ts.SyntaxKind.AsteriskEqualsToken]: OpCode.Mul,
          [ts.SyntaxKind.SlashEqualsToken]: OpCode.Div,
          [ts.SyntaxKind.PercentEqualsToken]: OpCode.Mod,
          [ts.SyntaxKind.LessThanLessThanEqualsToken]: OpCode.Shl,
          [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: OpCode.Shr,
          [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]: OpCode.UShr,
          [ts.SyntaxKind.AmpersandEqualsToken]: OpCode.BitAnd,
          [ts.SyntaxKind.BarEqualsToken]: OpCode.BitOr,
          [ts.SyntaxKind.CaretEqualsToken]: OpCode.BitXor,
        };
        const opc = cmpMap[expr.operatorToken.kind] || OpCode.Add;
        const leftValueReg = this.readValue(expr.left);
        this.currentBlock.addInstruction(opc, [{ kind: OperandKind.Register, value: leftValueReg }, { kind: OperandKind.Register, value: rightReg }], resReg);
        this.storeValue(expr.left, resReg);
        return resReg;
      }
      
      if (opMap[expr.operatorToken.kind]) {
        this.currentBlock.addInstruction(opMap[expr.operatorToken.kind]!, [{ kind: OperandKind.Register, value: leftReg }, { kind: OperandKind.Register, value: rightReg }], resReg);
        
        if (expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken || expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken) {
          const notReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: resReg }], notReg);
          return notReg;
        }
        
        return resReg;
      }
    }
    
    if (ts.isPropertyAccessExpression(expr)) {
      if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const propReg = this.emitConstant(ConstantKind.String, expr.name.text);
        const resReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], resReg);
        return resReg;
      }

      const objReg = this.visitExpression(expr.expression);
      const resReg = this.fnBuilder.allocRegister();
      if (ts.isPrivateIdentifier(expr.name)) {
        const privateKeyReg = this.resolvePrivateIdentifierRegister(expr.name);
        this.currentBlock.addInstruction(OpCode.PrivateGet, [{ kind: OperandKind.Register, value: objReg }, { kind: OperandKind.Register, value: privateKeyReg }], resReg);
        return resReg;
      }
      const propReg = this.emitConstant(ConstantKind.String, expr.name.text);
      this.currentBlock.addInstruction(OpCode.PropGet, [{ kind: OperandKind.Register, value: objReg }, { kind: OperandKind.Register, value: propReg }], resReg);
      return resReg;
    }

    if (ts.isElementAccessExpression(expr)) {
      if (!expr.argumentExpression) {
        this.failUnsupported(expr, 'Element access requires an index expression');
      }
      const objReg = this.visitExpression(expr.expression);
      const indexReg = this.visitExpression(expr.argumentExpression);
      const resReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.ComputedGet, [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: indexReg },
      ], resReg);
      return resReg;
    }

    if (ts.isArrayLiteralExpression(expr)) {
      const arrayReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.ArrayNew, [], arrayReg);
      const indexLocal = this.createTempLocal('array_index');
      const zeroReg = this.emitConstant(ConstantKind.Number, 0);
      const oneReg = this.emitConstant(ConstantKind.Number, 1);
      const lengthKeyReg = this.emitConstant(ConstantKind.String, 'length');
      this.storeToLocal(indexLocal, zeroReg);

      expr.elements.forEach((element) => {
        if (ts.isOmittedExpression(element)) {
          const currentIndexReg = this.loadFromLocal(indexLocal);
          const nextIndexReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(
            OpCode.Add,
            [
              { kind: OperandKind.Register, value: currentIndexReg },
              { kind: OperandKind.Register, value: oneReg },
            ],
            nextIndexReg,
          );
          this.storeToLocal(indexLocal, nextIndexReg);
          return;
        }
        if (ts.isSpreadElement(element)) {
          const currentIndexReg = this.loadFromLocal(indexLocal);
          const spreadReg = this.visitExpression(element.expression);
          this.emitSpreadIntoArray(arrayReg, spreadReg, currentIndexReg, indexLocal);
          return;
        }
        const currentIndexReg = this.loadFromLocal(indexLocal);
        const valueReg = this.visitExpression(element);
        this.currentBlock.addInstruction(
          OpCode.ComputedSet,
          [
            { kind: OperandKind.Register, value: arrayReg },
            { kind: OperandKind.Register, value: currentIndexReg },
            { kind: OperandKind.Register, value: valueReg },
          ],
        );
        const nextIndexReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(
          OpCode.Add,
          [
            { kind: OperandKind.Register, value: currentIndexReg },
            { kind: OperandKind.Register, value: oneReg },
          ],
          nextIndexReg,
        );
        this.storeToLocal(indexLocal, nextIndexReg);
      });

      const finalLengthReg = this.loadFromLocal(indexLocal);
      this.currentBlock.addInstruction(
        OpCode.PropSet,
        [
          { kind: OperandKind.Register, value: arrayReg },
          { kind: OperandKind.Register, value: lengthKeyReg },
          { kind: OperandKind.Register, value: finalLengthReg },
        ],
      );

      return arrayReg;
    }

    if (ts.isObjectLiteralExpression(expr)) {
      const objectReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.ObjectNew, [], objectReg);

      for (const property of expr.properties) {
        if (ts.isPropertyAssignment(property)) {
          const valueReg = this.visitExpression(property.initializer);
          if (ts.isComputedPropertyName(property.name)) {
            const nameReg = this.visitExpression(property.name.expression);
            this.emitObjectPropertyAssignment(objectReg, nameReg, valueReg, true);
          } else {
            const propName = this.getPropertyNameText(property.name);
            const nameReg = this.emitConstant(ConstantKind.String, propName);
            this.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
          }
          continue;
        }

        if (ts.isShorthandPropertyAssignment(property)) {
          const nameReg = this.emitConstant(ConstantKind.String, property.name.text);
          const valueReg = this.resolveVar(property.name.text);
          this.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
          continue;
        }

        if (ts.isMethodDeclaration(property)) {
          const valueReg = this.lowerNestedFunctionLike(property);
          if (ts.isComputedPropertyName(property.name)) {
            const nameReg = this.visitExpression(property.name.expression);
            this.emitObjectPropertyAssignment(objectReg, nameReg, valueReg, true);
          } else {
            const nameReg = this.emitConstant(ConstantKind.String, this.getPropertyNameText(property.name));
            this.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
          }
          continue;
        }

        if (ts.isSpreadAssignment(property)) {
          const valueReg = this.visitExpression(property.expression);
          this.emitSpreadInto(objectReg, valueReg);
          continue;
        }

        if (ts.isGetAccessor(property) || ts.isSetAccessor(property)) {
          const valueReg = this.lowerNestedFunctionLike(property);
          const nameReg = ts.isComputedPropertyName(property.name)
            ? this.visitExpression(property.name.expression)
            : this.emitConstant(ConstantKind.String, this.getPropertyNameText(property.name));

          const objectGlobalReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(
            OpCode.LoadGlobal,
            [{ kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'Object') }],
            objectGlobalReg,
          );

          const descriptorReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.ObjectNew, [], descriptorReg);

          const getPropReg = this.emitConstant(ConstantKind.String, ts.isGetAccessor(property) ? 'get' : 'set');
          this.emitObjectPropertyAssignment(descriptorReg, getPropReg, valueReg);

          const trueReg = this.emitConstant(ConstantKind.Boolean, true);
          this.emitObjectPropertyAssignment(descriptorReg, this.emitConstant(ConstantKind.String, 'configurable'), trueReg);
          this.emitObjectPropertyAssignment(descriptorReg, this.emitConstant(ConstantKind.String, 'enumerable'), trueReg);

          const dummyReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(
            OpCode.CallMethod,
            [
              { kind: OperandKind.Register, value: objectGlobalReg },
              { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'defineProperty') },
              { kind: OperandKind.Register, value: objectReg },
              { kind: OperandKind.Register, value: nameReg },
              { kind: OperandKind.Register, value: descriptorReg },
            ],
            dummyReg
          );
          continue;
        }

        this.failUnsupported(property, 'Unsupported object literal property kind');
      }

      return objectReg;
    }

    if (ts.isCallExpression(expr)) {
      const resReg = this.fnBuilder.allocRegister();
      const hasSpread = expr.arguments.some((arg) => ts.isSpreadElement(arg));
      if (hasSpread) {
        const argArrayReg = this.materializeArgumentArray(expr.arguments);
        if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
          this.currentBlock.addInstruction(
            OpCode.SuperCallWithArray,
            [{ kind: OperandKind.Register, value: argArrayReg }],
            resReg,
          );
          return resReg;
        }
        if (ts.isPropertyAccessExpression(expr.expression)) {
          if (expr.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
            const propReg = this.emitConstant(ConstantKind.String, expr.expression.name.text);
            const fnReg = this.fnBuilder.allocRegister();
            this.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], fnReg);
            const applyReg = this.emitConstant(ConstantKind.String, 'apply');
            const thisReg = this.fnBuilder.allocRegister();
            this.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
            this.currentBlock.addInstruction(
              OpCode.CallMethod,
              [
                { kind: OperandKind.Register, value: fnReg },
                { kind: OperandKind.Register, value: applyReg },
                { kind: OperandKind.Register, value: thisReg },
                { kind: OperandKind.Register, value: argArrayReg }
              ],
              resReg
            );
            return resReg;
          }
          const objReg = this.visitExpression(expr.expression.expression);
          const propReg = this.emitConstant(ConstantKind.String, expr.expression.name.text);
          this.currentBlock.addInstruction(
            OpCode.CallMethodWithArray,
            [
              { kind: OperandKind.Register, value: objReg },
              { kind: OperandKind.Register, value: propReg },
              { kind: OperandKind.Register, value: argArrayReg },
            ],
            resReg,
          );
          return resReg;
        }
        const calleeReg = this.visitExpression(expr.expression);
        this.currentBlock.addInstruction(
          OpCode.CallWithArray,
          [
            { kind: OperandKind.Register, value: calleeReg },
            { kind: OperandKind.Register, value: argArrayReg },
          ],
          resReg,
        );
        return resReg;
      }
      const args = expr.arguments.map(a => this.visitExpression(a));
      
      if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const ops: Operand[] = args.map(a => ({ kind: OperandKind.Register, value: a } as Operand));
        this.currentBlock.addInstruction(OpCode.SuperCall, ops, resReg);
        return resReg;
      }
      
      if (ts.isPropertyAccessExpression(expr.expression)) {
        if (expr.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
          const propReg = this.emitConstant(ConstantKind.String, expr.expression.name.text);
          const fnReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], fnReg);
          const callReg = this.emitConstant(ConstantKind.String, 'call');
          const thisReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
          const ops: Operand[] = [
            { kind: OperandKind.Register, value: fnReg },
            { kind: OperandKind.Register, value: callReg },
            { kind: OperandKind.Register, value: thisReg },
            ...args.map(a => ({ kind: OperandKind.Register, value: a } as Operand))
          ];
          this.currentBlock.addInstruction(OpCode.CallMethod, ops, resReg);
          return resReg;
        }
        const objReg = this.visitExpression(expr.expression.expression);
        const propReg = this.emitConstant(ConstantKind.String, expr.expression.name.text);
        const ops: Operand[] = [
          { kind: OperandKind.Register, value: objReg },
          { kind: OperandKind.Register, value: propReg },
          ...args.map(a => ({ kind: OperandKind.Register, value: a } as Operand))
        ];
        this.currentBlock.addInstruction(OpCode.CallMethod, ops, resReg);
      } else {
        const calleeReg = this.visitExpression(expr.expression);
        const ops: Operand[] = [
          { kind: OperandKind.Register, value: calleeReg },
          ...args.map(a => ({ kind: OperandKind.Register, value: a } as Operand))
        ];
        this.currentBlock.addInstruction(OpCode.Call, ops, resReg);
      }
      return resReg;
    }

    if (ts.isNewExpression(expr)) {
      const calleeReg = this.visitExpression(expr.expression);
      const resReg = this.fnBuilder.allocRegister();
      const argsList = expr.arguments ? [...expr.arguments] : [];
      if (argsList.some((arg) => ts.isSpreadElement(arg))) {
        const argArrayReg = this.materializeArgumentArray(argsList);
        this.currentBlock.addInstruction(
          OpCode.NewWithArray,
          [
            { kind: OperandKind.Register, value: calleeReg },
            { kind: OperandKind.Register, value: argArrayReg },
          ],
          resReg,
        );
        return resReg;
      }
      const args = argsList.map((arg) => this.visitExpression(arg));
      const ops: Operand[] = [
        { kind: OperandKind.Register, value: calleeReg },
        ...args.map((arg) => ({ kind: OperandKind.Register, value: arg } as Operand)),
      ];
      this.currentBlock.addInstruction(OpCode.New, ops, resReg);
      return resReg;
    }

    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      return this.lowerNestedFunctionNode(expr);
    }

    if (ts.isClassExpression(expr)) {
      return this.lowerClassLike(expr, expr.name?.text);
    }

    if (ts.isPostfixUnaryExpression(expr)) {
      if (expr.operator === ts.SyntaxKind.PlusPlusToken) {
        if (ts.isIdentifier(expr.operand)) {
          const vReg = this.resolveVar(expr.operand.text);
          const oneReg = this.emitConstant(ConstantKind.Number, 1);
          const resReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.Add, [{ kind: OperandKind.Register, value: vReg }, { kind: OperandKind.Register, value: oneReg }], resReg);
          this.storeValue(expr.operand, resReg);
          return vReg;
        }
      }
    }

    if (ts.isPrefixUnaryExpression(expr)) {
      const operandReg = this.visitExpression(expr.operand);
      const resReg = this.fnBuilder.allocRegister();
      if (expr.operator === ts.SyntaxKind.ExclamationToken) {
        this.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: operandReg }], resReg);
      } else if (expr.operator === ts.SyntaxKind.MinusToken) {
        this.currentBlock.addInstruction(OpCode.Neg, [{ kind: OperandKind.Register, value: operandReg }], resReg);
      } else if (expr.operator === ts.SyntaxKind.TildeToken) {
        const notReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: operandReg }], notReg);
        this.currentBlock.addInstruction(OpCode.BitXor, [{ kind: OperandKind.Register, value: operandReg }, { kind: OperandKind.Register, value: notReg }], resReg); // Approximate bitwise NOT if proper opcode doesn't exist
      } else {
        this.failUnsupported(expr, 'Unsupported prefix unary operator');
      }
      return resReg;
    }

    if (ts.isTypeOfExpression(expr)) {
      const operandReg = this.visitExpression(expr.expression);
      const resReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.TypeOf, [{ kind: OperandKind.Register, value: operandReg }], resReg);
      return resReg;
    }

    if (ts.isDeleteExpression(expr)) {
      if (ts.isPropertyAccessExpression(expr.expression)) {
        const objReg = this.visitExpression(expr.expression.expression);
        const propReg = this.emitConstant(ConstantKind.String, expr.expression.name.text);
        const resReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.Delete, [
          { kind: OperandKind.Register, value: objReg },
          { kind: OperandKind.Register, value: propReg }
        ], resReg);
        this.currentBlock.addInstruction(OpCode.LoadConst, [{ kind: OperandKind.ConstantIndex, value: this.modBuilder.addConstant(ConstantKind.Boolean, true) }], resReg); // delete returns true usually
        return resReg;
      } else if (ts.isElementAccessExpression(expr.expression)) {
        if (!expr.expression.argumentExpression) {
          this.failUnsupported(expr.expression, 'Element access requires an index expression');
        }
        const objReg = this.visitExpression(expr.expression.expression);
        const propReg = this.visitExpression(expr.expression.argumentExpression);
        const resReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(OpCode.Delete, [
          { kind: OperandKind.Register, value: objReg },
          { kind: OperandKind.Register, value: propReg }
        ], resReg);
        this.currentBlock.addInstruction(OpCode.LoadConst, [{ kind: OperandKind.ConstantIndex, value: this.modBuilder.addConstant(ConstantKind.Boolean, true) }], resReg);
        return resReg;
      }
      this.failUnsupported(expr, 'Unsupported delete target');
    }

    this.failUnsupported(expr);
  }

  private getPropertyNameText(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    this.failUnsupported(name, 'Unsupported property name');
  }

  private materializeArgumentArray(args: readonly ts.Expression[]): Register {
    const arrayReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.ArrayNew, [], arrayReg);
    args.forEach((arg) => {
      if (ts.isSpreadElement(arg)) {
        const spreadReg = this.visitExpression(arg.expression);
        this.emitSpreadInto(arrayReg, spreadReg);
        return;
      }
      const valueReg = this.visitExpression(arg);
      this.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: arrayReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'push') },
          { kind: OperandKind.Register, value: valueReg },
        ],
        this.fnBuilder.allocRegister(),
      );
    });
    return arrayReg;
  }

  private parseAssignmentTargetWithDefault(expr: ts.Expression): { target: ts.Expression; initializer?: ts.Expression } {
    const normalized = this.normalizeExpression(expr);
    if (ts.isBinaryExpression(normalized) && normalized.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      return { target: normalized.left as ts.Expression, initializer: normalized.right };
    }
    return { target: normalized };
  }

  private storeArrayPattern(target: ts.ArrayLiteralExpression, sourceReg: Register): void {
    target.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) {
        return;
      }
      if (ts.isSpreadElement(element)) {
        this.storeValue(element.expression, this.emitArraySlice(sourceReg, index));
        return;
      }
      const { target: nestedTarget, initializer } = this.parseAssignmentTargetWithDefault(element);
      const valueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.ComputedGet,
        [
          { kind: OperandKind.Register, value: sourceReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.Number, index) },
        ],
        valueReg,
      );
      this.storeValue(nestedTarget, this.applyDefaultValue(valueReg, initializer));
    });
  }

  private storeObjectPattern(target: ts.ObjectLiteralExpression, sourceReg: Register): void {
    const excludedKeys: string[] = [];
    let restTarget: ts.Expression | undefined;

    for (const property of target.properties) {
      if (ts.isSpreadAssignment(property)) {
        restTarget = property.expression;
        continue;
      }

      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        this.failUnsupported(property, 'Unsupported object assignment target');
      }

      const keyText = this.getPropertyNameText(property.name);
      excludedKeys.push(keyText);
      const valueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: sourceReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, keyText) },
        ],
        valueReg,
      );

      if (ts.isShorthandPropertyAssignment(property)) {
        this.storeValue(property.name, this.applyDefaultValue(valueReg, property.objectAssignmentInitializer));
        continue;
      }

      const { target: nestedTarget, initializer } = this.parseAssignmentTargetWithDefault(property.initializer);
      this.storeValue(nestedTarget, this.applyDefaultValue(valueReg, initializer));
    }

    if (restTarget) {
      const restReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.ObjectNew, [], restReg);
      this.emitSpreadInto(restReg, sourceReg);
      excludedKeys.forEach((key) => {
        this.currentBlock.addInstruction(OpCode.Delete, [
          { kind: OperandKind.Register, value: restReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, key) },
        ]);
      });
      this.storeValue(restTarget, restReg);
    }
  }

  private visitStatement(stmt: ts.Statement) {
    if (ts.isBlock(stmt)) {
      stmt.statements.forEach(s => this.visitStatement(s));
    }
    else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      const boxed = this.capturedLocals.has(stmt.name.text);
      const localReg = this.scope.get(stmt.name.text)?.register ?? this.fnBuilder.addLocal(stmt.name.text, IRType.Any);
      this.scope.set(stmt.name.text, { register: localReg, boxed });
      const closureReg = this.lowerNestedFunctionNode(stmt, stmt.name.text);
      if (boxed) {
        this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: closureReg }], localReg);
        this.fnBuilder.addCapturedVariable(stmt.name.text);
      } else {
        this.currentBlock.addInstruction(OpCode.StoreLocal, [
          { kind: OperandKind.Register, value: localReg },
          { kind: OperandKind.Register, value: closureReg },
        ]);
      }
    }
    else if (ts.isClassDeclaration(stmt) && stmt.name) {
      this.lowerClassLike(stmt);
    }
    else if (ts.isVariableStatement(stmt)) {
      stmt.declarationList.declarations.forEach(decl => {
        this.initializeVariableDeclaration(decl);
      });
    }
    else if (ts.isExpressionStatement(stmt)) {
      this.visitExpression(stmt.expression);
    }
    else if (ts.isReturnStatement(stmt)) {
      const valReg = stmt.expression ? this.visitExpression(stmt.expression) : this.emitConstant(ConstantKind.Undefined, null);
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(1, valReg);
      } else {
        this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valReg });
        const nextBlock = this.fnBuilder.createBlock('unreachable');
        this.fnBuilder.addBlock(this.currentBlock.build());
        this.currentBlock = nextBlock;
      }
    }
    else if (ts.isThrowStatement(stmt)) {
      const valueReg = stmt.expression ? this.visitExpression(stmt.expression) : this.emitConstant(ConstantKind.Undefined, null);
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(2, valueReg);
      } else {
        this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
        const nextBlock = this.fnBuilder.createBlock('unreachable');
        this.fnBuilder.addBlock(this.currentBlock.build());
        this.currentBlock = nextBlock;
      }
    }
    else if (ts.isBreakStatement(stmt)) {
      const target = this.breakTargets[this.breakTargets.length - 1];
      if (!target) {
        this.failUnsupported(stmt, 'break used outside a loop or switch');
      }
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(3, undefined, { kind: 'break', blockId: target });
      } else {
        this.emitJumpAndAdvance(target, 'after_break');
      }
    }
    else if (ts.isContinueStatement(stmt)) {
      const target = this.continueTargets[this.continueTargets.length - 1];
      if (!target) {
        this.failUnsupported(stmt, 'continue used outside a loop');
      }
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(4, undefined, { kind: 'continue', blockId: target });
      } else {
        this.emitJumpAndAdvance(target, 'after_continue');
      }
    }
    else if (ts.isForStatement(stmt)) {
      if (stmt.initializer) {
        if (ts.isVariableDeclarationList(stmt.initializer)) {
          stmt.initializer.declarations.forEach((decl) => this.initializeVariableDeclaration(decl));
        } else {
          this.visitExpression(stmt.initializer);
        }
      }
      
      const condBlock = this.fnBuilder.createBlock('for_cond');
      const bodyBlock = this.fnBuilder.createBlock('for_body');
      const continueBlock = this.fnBuilder.createBlock('for_continue');
      const endBlock = this.fnBuilder.createBlock('for_end');
      
      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      
      // Condition
      this.currentBlock = condBlock;
      if (stmt.condition) {
        const condReg = this.visitExpression(stmt.condition);
        this.currentBlock.setTerminator({ kind: 'branch', condition: condReg, targets: [bodyBlock.id, endBlock.id] });
      } else {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [bodyBlock.id] });
      }
      this.fnBuilder.addBlock(this.currentBlock.build());
      
      // Body
      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(continueBlock.id);
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      const bodyFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [continueBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }
      
      this.currentBlock = continueBlock;
      if (stmt.incrementor) {
        this.visitExpression(stmt.incrementor);
      }
      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.leaveContinueTarget();
      this.leaveBreakTarget();
      
      this.currentBlock = endBlock;
    }
    else if (ts.isForOfStatement(stmt)) {
      const iterableReg = this.visitExpression(stmt.expression);
      const symbolReg = this.resolveVar('Symbol');
      const iteratorKeyReg = this.emitConstant(ConstantKind.String, 'iterator');
      const iteratorSymbolReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: symbolReg },
          { kind: OperandKind.Register, value: iteratorKeyReg },
        ],
        iteratorSymbolReg,
      );
      const iteratorMethodReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.ComputedGet,
        [
          { kind: OperandKind.Register, value: iterableReg },
          { kind: OperandKind.Register, value: iteratorSymbolReg },
        ],
        iteratorMethodReg,
      );
      const iteratorLocal = this.createTempLocal('forof_iter');
      const iteratorReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: iteratorMethodReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'call') },
          { kind: OperandKind.Register, value: iterableReg },
        ],
        iteratorReg,
      );
      this.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: iteratorLocal },
        { kind: OperandKind.Register, value: iteratorReg },
      ]);

      const stepLocal = this.createTempLocal('forof_step');
      const condBlock = this.fnBuilder.createBlock('forof_cond');
      const bodyBlock = this.fnBuilder.createBlock('forof_body');
      const endBlock = this.fnBuilder.createBlock('forof_end');

      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.currentBlock = condBlock;
      const liveIteratorReg = this.loadFromLocal(iteratorLocal);
      const stepReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: liveIteratorReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'next') },
        ],
        stepReg,
      );
      this.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: stepLocal },
        { kind: OperandKind.Register, value: stepReg },
      ]);
      const doneReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: stepReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'done') },
        ],
        doneReg,
      );
      this.currentBlock.setTerminator({ kind: 'branch', condition: doneReg, targets: [endBlock.id, bodyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(condBlock.id);
      this.currentBlock = bodyBlock;
      const liveStepReg = this.loadFromLocal(stepLocal);
      const valueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: liveStepReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'value') },
        ],
        valueReg,
      );
      this.assignLoopBinding(stmt.initializer, valueReg, 'for...of');
      this.visitStatement(stmt.statement);
      const bodyFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }
      this.leaveContinueTarget();
      this.leaveBreakTarget();

      this.currentBlock = endBlock;
    }
    else if (ts.isForInStatement(stmt)) {
      const sourceReg = this.visitExpression(stmt.expression);
      const objectReg = this.resolveVar('Object');
      const keysReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: objectReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'keys') },
          { kind: OperandKind.Register, value: sourceReg },
        ],
        keysReg,
      );
      const keysLocal = this.createTempLocal('forin_keys');
      this.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: keysLocal },
        { kind: OperandKind.Register, value: keysReg },
      ]);
      const indexLocal = this.createTempLocal('forin_index');
      const zeroReg = this.emitConstant(ConstantKind.Number, 0);
      this.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: indexLocal },
        { kind: OperandKind.Register, value: zeroReg },
      ]);

      const condBlock = this.fnBuilder.createBlock('forin_cond');
      const bodyBlock = this.fnBuilder.createBlock('forin_body');
      const continueBlock = this.fnBuilder.createBlock('forin_continue');
      const endBlock = this.fnBuilder.createBlock('forin_end');

      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.currentBlock = condBlock;
      const liveKeysReg = this.loadFromLocal(keysLocal);
      const liveIndexReg = this.loadFromLocal(indexLocal);
      const lengthReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: liveKeysReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'length') },
        ],
        lengthReg,
      );
      const condReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.Lt,
        [
          { kind: OperandKind.Register, value: liveIndexReg },
          { kind: OperandKind.Register, value: lengthReg },
        ],
        condReg,
      );
      this.currentBlock.setTerminator({ kind: 'branch', condition: condReg, targets: [bodyBlock.id, endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(continueBlock.id);
      this.currentBlock = bodyBlock;
      const bodyKeysReg = this.loadFromLocal(keysLocal);
      const bodyIndexReg = this.loadFromLocal(indexLocal);
      const keyReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.ComputedGet,
        [
          { kind: OperandKind.Register, value: bodyKeysReg },
          { kind: OperandKind.Register, value: bodyIndexReg },
        ],
        keyReg,
      );
      this.assignLoopBinding(stmt.initializer, keyReg, 'for...in');
      this.visitStatement(stmt.statement);
      const bodyFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [continueBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }

      this.currentBlock = continueBlock;
      const continueIndexReg = this.loadFromLocal(indexLocal);
      const oneReg = this.emitConstant(ConstantKind.Number, 1);
      const nextIndexReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.Add,
        [
          { kind: OperandKind.Register, value: continueIndexReg },
          { kind: OperandKind.Register, value: oneReg },
        ],
        nextIndexReg,
      );
      this.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: indexLocal },
        { kind: OperandKind.Register, value: nextIndexReg },
      ]);
      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.leaveContinueTarget();
      this.leaveBreakTarget();

      this.currentBlock = endBlock;
    }
    else if (ts.isIfStatement(stmt)) {
      const conditionReg = this.visitExpression(stmt.expression);
      const trueBlock = this.fnBuilder.createBlock('if_true');
      const falseBlock = this.fnBuilder.createBlock(stmt.elseStatement ? 'if_false' : 'if_end');
      const endBlock = stmt.elseStatement ? this.fnBuilder.createBlock('if_end') : falseBlock;

      trueBlock.addPredecessor(this.currentBlock.id);
      falseBlock.addPredecessor(this.currentBlock.id);
      this.currentBlock.setTerminator({ kind: 'branch', condition: conditionReg, targets: [trueBlock.id, falseBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.currentBlock = trueBlock;
      this.visitStatement(stmt.thenStatement);
      const thenFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return';
      if (thenFallsThrough) {
        if (this.currentBlock.getTerminatorKind() === undefined || this.currentBlock.getTerminatorKind() === 'unreachable') {
          this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
        }
        endBlock.addPredecessor(this.currentBlock.id);
        this.fnBuilder.addBlock(this.currentBlock.build());
      }

      if (stmt.elseStatement) {
        this.currentBlock = falseBlock;
        this.visitStatement(stmt.elseStatement);
        const elseFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return';
        if (elseFallsThrough) {
          if (this.currentBlock.getTerminatorKind() === undefined || this.currentBlock.getTerminatorKind() === 'unreachable') {
            this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
          }
          endBlock.addPredecessor(this.currentBlock.id);
          this.fnBuilder.addBlock(this.currentBlock.build());
        }
      } else {
        endBlock.addPredecessor(falseBlock.id);
      }

      this.currentBlock = endBlock;
    }
    else if (ts.isWhileStatement(stmt)) {
      const condBlock = this.fnBuilder.createBlock('while_cond');
      const bodyBlock = this.fnBuilder.createBlock('while_body');
      const endBlock = this.fnBuilder.createBlock('while_end');
      
      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      
      this.currentBlock = condBlock;
      const condReg = this.visitExpression(stmt.expression);
      this.currentBlock.setTerminator({ kind: 'branch', condition: condReg, targets: [bodyBlock.id, endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      
      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(condBlock.id);
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      const bodyFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }
      this.leaveContinueTarget();
      this.leaveBreakTarget();
      
      this.currentBlock = endBlock;
    }
    else if (ts.isDoStatement(stmt)) {
      const bodyBlock = this.fnBuilder.createBlock('do_body');
      const condBlock = this.fnBuilder.createBlock('do_cond');
      const endBlock = this.fnBuilder.createBlock('do_end');

      this.currentBlock.setTerminator({ kind: 'jump', targets: [bodyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(condBlock.id);
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      const bodyFallsThrough = !this.isSyntheticDeadBlock(this.currentBlock) && this.currentBlock.getTerminatorKind() !== 'return' && this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }

      this.currentBlock = condBlock;
      const condReg = this.visitExpression(stmt.expression);
      this.currentBlock.setTerminator({ kind: 'branch', condition: condReg, targets: [bodyBlock.id, endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.leaveContinueTarget();
      this.leaveBreakTarget();

      this.currentBlock = endBlock;
    }
    else if (ts.isSwitchStatement(stmt)) {
      const discriminantReg = this.visitExpression(stmt.expression);
      const endBlock = this.fnBuilder.createBlock('switch_end');
      const clauseBlocks = stmt.caseBlock.clauses.map((clause, index) => this.fnBuilder.createBlock(`switch_clause_${index}`));
      const defaultClauseIndex = stmt.caseBlock.clauses.findIndex((clause) => ts.isDefaultClause(clause));

      this.enterBreakTarget(endBlock.id);

      let checkBlock = this.currentBlock;
      const caseClauses = stmt.caseBlock.clauses
        .map((clause, index) => ({ clause, index }))
        .filter((entry) => ts.isCaseClause(entry.clause));
      const checkBlocks = caseClauses.slice(1).map((_, index) => this.fnBuilder.createBlock(`switch_check_${index + 1}`));

      if (caseClauses.length === 0) {
        checkBlock.setTerminator({
          kind: 'jump',
          targets: [defaultClauseIndex >= 0 ? clauseBlocks[defaultClauseIndex]!.id : endBlock.id],
        });
        this.fnBuilder.addBlock(checkBlock.build());
      } else {
        caseClauses.forEach((entry, index) => {
          const caseBlock = index === 0 ? checkBlock : checkBlocks[index - 1]!;
          if (index > 0) {
            this.currentBlock = caseBlock;
          }
          const caseValueReg = this.visitExpression((entry.clause as ts.CaseClause).expression);
          const cmpReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(
            OpCode.StrictEq,
            [
              { kind: OperandKind.Register, value: discriminantReg },
              { kind: OperandKind.Register, value: caseValueReg },
            ],
            cmpReg,
          );

          const falseTarget =
            index === caseClauses.length - 1
              ? defaultClauseIndex >= 0
                ? clauseBlocks[defaultClauseIndex]!.id
                : endBlock.id
              : checkBlocks[index]!.id;

          this.currentBlock.setTerminator({
            kind: 'branch',
            condition: cmpReg,
            targets: [clauseBlocks[entry.index]!.id, falseTarget],
          });
          this.fnBuilder.addBlock(this.currentBlock.build());
        });
      }

      stmt.caseBlock.clauses.forEach((clause, index) => {
        this.currentBlock = clauseBlocks[index]!;
        clause.statements.forEach((caseStmt) => this.visitStatement(caseStmt));
        const fallsThrough = !this.isSyntheticDeadBlock(this.currentBlock)
          && this.currentBlock.getTerminatorKind() !== 'return'
          && this.currentBlock.getTerminatorKind() !== 'throw';
        if (fallsThrough) {
          const nextTarget = clauseBlocks[index + 1]?.id ?? endBlock.id;
          this.currentBlock.setTerminator({ kind: 'jump', targets: [nextTarget] });
          this.fnBuilder.addBlock(this.currentBlock.build());
        }
      });

      this.leaveBreakTarget();
      this.currentBlock = endBlock;
    }
    else if (ts.isTryStatement(stmt)) {
      if (stmt.finallyBlock) {
        this.lowerTryFinallyStatement(stmt);
      } else {
        this.lowerTryCatchStatement(stmt);
      }
    }
    else {
      this.failUnsupported(stmt);
    }
  }
}

export function lowerToIR(moduleInfo: ModuleInfo, graph: ProjectSemanticGraph, filePath: string, options: LowerToIROptions = {}): IRModule {
  const modBuilder = new IRModuleBuilder(filePath);

  for (const imp of moduleInfo.imports) modBuilder.addImport(imp);
  for (const exp of moduleInfo.exports) modBuilder.addExport(exp);

  const sourceFile = ts.createSourceFile(filePath, ts.sys.readFile(filePath) || '', ts.ScriptTarget.ESNext, true);
  const lowerTopLevelFunction = (functionName: string, functionNode: SupportedFunctionNode, isExported: boolean) => {
    if (options.skipTopLevelFunctionNames?.has(functionName)) {
      return;
    }
    const jsDoc = ts.getJSDocTags(functionNode);
    const isVirtualized = options.forceVirtualizeAll
      || options.forceVirtualizeFunctionNames?.has(functionName)
      || jsDoc.some((tag) => ['virtualize', 'obfuscate', 'protect-critical'].includes(tag.tagName.text))
      || functionName === 'calculateSecretHash'
      || functionName === 'encryptTEA';
    const analysis = analyzeFunctionClosures(functionNode, new Set<string>());
    const attributes: FunctionAttribute[] = [];
    if (functionNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      attributes.push(FunctionAttribute.Async);
    }
    if ('asteriskToken' in functionNode && !!functionNode.asteriskToken) {
      attributes.push(FunctionAttribute.Generator);
    }
    try {
      new ASTLowering(modBuilder, functionNode, {
        name: functionName,
        isExported,
        isVirtualized,
        analysis,
        attributes,
      });
    } catch (error) {
      if (!options.compatibilityFallback) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      const position = sourceFile.getLineAndCharacterOfPosition(functionNode.getStart(sourceFile));
      options.diagnostics?.push({
        severity: DiagnosticSeverity.Warning,
        code: 'IR_UNIVERSAL_FALLBACK',
        message: `Skipped VM lowering for function "${functionName}" due to unsupported syntax: ${message}`,
        location: {
          filePath,
          line: position.line + 1,
          column: position.character + 1,
          offset: functionNode.getStart(sourceFile),
          length: functionNode.getWidth(sourceFile),
        },
      });
    }
  };
  
  ts.forEachChild(sourceFile, function visit(node) {
    if (node.parent === sourceFile && ts.isFunctionDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      lowerTopLevelFunction(node.name.text, node, isExported);
    } else if (node.parent === sourceFile && ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        if (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) {
          lowerTopLevelFunction(declaration.name.text, declaration.initializer, isExported);
          continue;
        }
        if (options.compatibilityFallback && options.forceVirtualizeAll) {
          const position = sourceFile.getLineAndCharacterOfPosition(declaration.getStart(sourceFile));
          options.diagnostics?.push({
            severity: DiagnosticSeverity.Warning,
            code: 'IR_UNIVERSAL_FALLBACK',
            message: `Skipped VM lowering for declaration "${declaration.name.text}" because it is not a function-like initializer`,
            location: {
              filePath,
              line: position.line + 1,
              column: position.character + 1,
              offset: declaration.getStart(sourceFile),
              length: declaration.getWidth(sourceFile),
            },
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  });

  return modBuilder.build();
}
