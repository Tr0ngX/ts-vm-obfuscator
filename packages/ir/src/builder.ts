import ts from 'typescript';
import type { ModuleInfo, ProjectSemanticGraph, IRModule, Operand, Register } from '@tsvm/shared';
import { DiagnosticSeverity, IRType, OpCode, OperandKind, ConstantKind, FunctionAttribute } from '@tsvm/shared';
import { IRModuleBuilder, IRFunctionBuilder, type BasicBlockBuilder } from './ir.js';
import { LEXICAL_THIS_CAPTURE, LEXICAL_NEW_TARGET_CAPTURE } from './lowering/types.js';
import type {
  LowerToIROptions,
  SupportedFunctionNode,
  ClosureAnalysis,
  LocalBinding,
  PendingParameterBinding,
  CompletionKind,
  FinallyContext,
  FinallyCompletionTarget,
  NormalizedClassMethodElement,
  NormalizedClassFieldElement,
  NormalizedComputedName,
  NormalizedClass,
  NormalizedClassElement,
} from './lowering/types.js';
import { analyzeFunctionClosures, pushUnique, isIdentifierReference, isNestedFunctionLike, ScopeMap } from './lowering/utils.js';
import {
  visitExpression as lowerVisitExpression,
  lowerConditionalExpression,
  lowerNullishCoalesce,
  lowerTemplateExpression,
  lowerNestedFunctionNode,
} from './lowering/expressions.js';

interface LoweringOptions {
  readonly name: string;
  readonly isExported: boolean;
  readonly isVirtualized: boolean;
  readonly analysis: ClosureAnalysis;
  readonly attributes?: readonly FunctionAttribute[];
  readonly isNested?: boolean;
  readonly prologueEmitter?: ((lowering: ASTLowering) => void) | undefined;
  readonly privateIdentifierBindings?: ReadonlyMap<string, string>;
  readonly instanceFieldsToInitialize?: readonly NormalizedClassFieldElement[];
}

export interface IASTLowering {
  node: ts.Node;
  fnBuilder: any;
  currentBlock: any;
  modBuilder: any;
  scope: Map<string, any>;
  outerCaptureBindings: Set<string>;
  isAsyncFunction: boolean;
  isGenerator: boolean;
  instanceFieldsToInitialize: readonly any[] | undefined;

  createTempLocal(name: string): any;
  emitConstant(kind: any, value: unknown): any;
  loadFromLocal(reg: any): any;
  storeToLocal(reg1: any, reg2: any): void;
  normalizeExpression(expr: ts.Expression): ts.Expression;
  lowerNestedFunctionLike(expr: ts.FunctionLikeDeclaration, name?: string, options?: any): any;
  resolveLexicalCapture(name: string, node: ts.Node, detail: string): any;
  failUnsupported(node: ts.Node, msg?: string): never;
  resolveVar(name: string): any;
  storeValue(target: ts.Expression, valueReg: any): void;
  readValue(target: ts.Expression): any;
  resolvePrivateIdentifierRegister(identifier: ts.PrivateIdentifier): any;
  emitObjectPropertyAssignment(objReg: any, keyReg: any, valueReg: any, computed?: boolean): void;
  getPropertyNameText(name: ts.PropertyName): string;
  materializeArgumentArray(args: readonly ts.Expression[]): any;
  emitSpreadInto(targetReg: any, sourceReg: any): void;
  emitSpreadIntoArray(targetReg: any, sourceReg: any, startIndexReg: any, destIndexLocal: any): void;
  lowerClassLike(node: ts.ClassDeclaration | ts.ClassExpression, name?: string): any;
  emitInstanceFieldInitializers(fields: readonly any[]): void;
}

export class ASTLowering {
  private fnBuilder: IRFunctionBuilder;
  private currentBlock: BasicBlockBuilder;
  private scope: ScopeMap = new ScopeMap();
  readonly functionId: string;
  private nestedFunctionCount = 0;
  private tempLocalCount = 0;
  private readonly sourceFile: ts.SourceFile;
  private readonly capturedLocals: ReadonlySet<string>;
  private readonly outerCaptureBindings = new Map<string, number>();
  private readonly breakTargets: { readonly blockId: string; readonly tryDepth: number }[] = [];
  private readonly continueTargets: { readonly blockId: string; readonly tryDepth: number }[] = [];
  private readonly labelTargets: Map<string, { readonly break: { readonly blockId: string; readonly tryDepth: number }; continue?: { readonly blockId: string; readonly tryDepth: number } }> = new Map();
  private readonly activeLabels: Set<string> = new Set();
  private readonly finallyContexts: FinallyContext[] = [];
  private tryDepth = 0;
  private throwPassthroughFinallyDepth = 0;
  private readonly pendingParameterBindings: PendingParameterBinding[] = [];
  private readonly isAsyncFunction: boolean;
  private readonly isGenerator: boolean;
  private readonly privateIdentifierBindings: ReadonlyMap<string, string>;
  private readonly instanceFieldsToInitialize?: readonly NormalizedClassFieldElement[];

  constructor(
    public readonly modBuilder: IRModuleBuilder,
    private readonly node: SupportedFunctionNode,
    options: LoweringOptions,
  ) {
    this.functionId = modBuilder.getNextFunctionId();
    this.fnBuilder = new IRFunctionBuilder(this.functionId, options.name, IRType.Any);
    this.sourceFile = node.getSourceFile();
    this.capturedLocals = options.analysis.capturedByDescendants;
    this.privateIdentifierBindings = options.privateIdentifierBindings ?? new Map();
    this.instanceFieldsToInitialize = options.instanceFieldsToInitialize;
    if (options.isExported) {
      this.fnBuilder.addAttribute(FunctionAttribute.Exported);
    }
    if (options.isNested) {
      this.fnBuilder.addAttribute(FunctionAttribute.Nested);
    }
    for (const attribute of options.attributes ?? []) {
      this.fnBuilder.addAttribute(attribute);
    }
    this.isAsyncFunction =
      !!this.node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ||
      ('asteriskToken' in this.node &&
        !!this.node.asteriskToken &&
        (this.node as SupportedFunctionNode & { name?: ts.Identifier }).name?.text === 'async') ||
      (options.attributes ?? []).includes(FunctionAttribute.Async);
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
      `Unsupported AST in IR builder: ${message} at ${this.sourceFile.fileName}:${line + 1}:${character + 1} near "${snippet}"`,
    );
  }

  private isSyntheticDeadBlock(block: BasicBlockBuilder): boolean {
    const label = block.label;
    const syntheticLabel = label === 'unreachable' || label === 'after_break' || label === 'after_continue';
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
    this.breakTargets.push({ blockId: target, tryDepth: this.tryDepth });
  }

  private leaveBreakTarget(): void {
    this.breakTargets.pop();
  }

  private enterContinueTarget(target: string): void {
    this.continueTargets.push({ blockId: target, tryDepth: this.tryDepth });
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
      if (analysis.capturedByDescendants.has(LEXICAL_THIS_CAPTURE)) {
        this.initializeLexicalCapture(LEXICAL_THIS_CAPTURE);
      }
      if (analysis.capturedByDescendants.has(LEXICAL_NEW_TARGET_CAPTURE)) {
        this.initializeLexicalCapture(LEXICAL_NEW_TARGET_CAPTURE);
      }
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

  private resolveLexicalCapture(
    name: typeof LEXICAL_THIS_CAPTURE | typeof LEXICAL_NEW_TARGET_CAPTURE,
    node: ts.Node,
    detail: string,
  ): Register {
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
    let extendsExpression: ts.Expression | undefined;
    const extendsClause = node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
    if (extendsClause?.types && extendsClause.types.length > 0) {
      extendsExpression = extendsClause.types[0]?.expression;
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
        pushElement({
          kind: 'static_block',
          node: member,
          isStatic: true,
        });
        continue;
      }
      const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
      if (ts.isPropertyDeclaration(member) && modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
        continue;
      }
      const privateBindingName =
        'name' in member && member.name && ts.isPrivateIdentifier(member.name)
          ? (privateIdentifiers.get(member.name.text) ?? this.createSyntheticBindingName('private_slot'))
          : undefined;
      if (
        privateBindingName &&
        'name' in member &&
        member.name &&
        ts.isPrivateIdentifier(member.name) &&
        !privateIdentifiers.has(member.name.text)
      ) {
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
      extendsExpression,
    };
  }

  private lowerClassConstructor(normalized: NormalizedClass, availableOuterNames: ReadonlySet<string>, classDisplayName: string): Register {
    const instanceFields = normalized.instanceElements.filter(
      (element): element is NormalizedClassFieldElement => element.kind === 'field',
    );
    const explicitCtor = normalized.constructorElement?.kind === 'constructor' ? normalized.constructorElement.node : undefined;
    let ctorNode: SupportedFunctionNode;
    if (explicitCtor) {
      ctorNode = explicitCtor;
    } else {
      const bodyStatements: ts.Statement[] = [];
      if (normalized.extendsExpression) {
        bodyStatements.push(ts.factory.createExpressionStatement(ts.factory.createCallExpression(ts.factory.createSuper(), undefined, [])));
      }
      ctorNode = ts.factory.createFunctionExpression(
        undefined,
        undefined,
        undefined,
        undefined,
        [],
        undefined,
        ts.factory.createBlock(bodyStatements, true),
      );
    }

    const fieldInitializerNodes = instanceFields.flatMap((field) => {
      const nodes: ts.Node[] = [];
      if (field.node.initializer) {
        nodes.push(field.node.initializer);
      }
      return nodes;
    });
    const computedFieldCaptureNames = instanceFields.map((field) => field.computedBindingName).filter((name): name is string => !!name);
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
        if (!normalized.extendsExpression) {
          lowering.emitInstanceFieldInitializers(instanceFields);
        }
      },
      privateIdentifierBindings: normalized.privateIdentifiers,
      instanceFieldsToInitialize: normalized.extendsExpression ? instanceFields : undefined,
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
      capturedFromOuter: [...new Set([...baseAnalysis.capturedFromOuter, ...(overrides?.extraCapturedFromOuter ?? [])])],
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
      closureReg,
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
    const extendsExpr = node.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]?.expression;
    let parentClassReg: Register | undefined;
    if (extendsExpr) {
      parentClassReg = this.visitExpression(extendsExpr);
    }
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

    if (parentClassReg) {
      const parentProtoReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: parentClassReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'prototype') },
        ],
        parentProtoReg,
      );
      const setPrototypeOfReg = this.resolveVar('Object');
      const setProtoMethodReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: setPrototypeOfReg },
          { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'setPrototypeOf') },
        ],
        setProtoMethodReg,
      );
      this.currentBlock.addInstruction(
        OpCode.Call,
        [
          { kind: OperandKind.Register, value: setProtoMethodReg },
          { kind: OperandKind.Register, value: prototypeReg },
          { kind: OperandKind.Register, value: parentProtoReg },
        ],
        this.fnBuilder.allocRegister(),
      );
      this.currentBlock.addInstruction(
        OpCode.Call,
        [
          { kind: OperandKind.Register, value: setProtoMethodReg },
          { kind: OperandKind.Register, value: ctorReg },
          { kind: OperandKind.Register, value: parentClassReg },
        ],
        this.fnBuilder.allocRegister(),
      );
    }

    for (const element of normalized.instanceElements) {
      if (element.kind === 'field' || element.kind === 'constructor') {
        continue;
      }
      const methodElement = element as NormalizedClassMethodElement;
      const methodReg = this.lowerNestedFunctionLike(methodElement.node, undefined, {
        availableOuterNames,
        extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
        privateIdentifierBindings: normalized.privateIdentifiers,
      });
      const key = this.getPropertyKeyRegister(methodElement.keyName, methodElement.computedBindingName);
      this.emitClassMethodOrAccessorDescriptor(prototypeReg, key.register, key.computed, methodElement, methodReg);
    }

    for (const element of normalized.staticElements) {
      if (element.kind === 'field') {
        const valueReg = element.node.initializer
          ? this.visitExpression(element.node.initializer)
          : this.emitConstant(ConstantKind.Undefined, null);
        if (element.privateBindingName) {
          const privateKeyReg = this.resolveVar(element.privateBindingName);
          this.currentBlock.addInstruction(OpCode.PrivateSet, [
            { kind: OperandKind.Register, value: ctorReg },
            { kind: OperandKind.Register, value: privateKeyReg },
            { kind: OperandKind.Register, value: valueReg },
          ]);
          continue;
        }
        const key = this.getPropertyKeyRegister(element.keyName, element.computedBindingName);
        this.emitObjectPropertyWrite(ctorReg, key.register, valueReg, key.computed);
        continue;
      }
      // Wraps static block body in a fake function expression so it can be
      // lowered through the same nested-function path. Called immediately via
      // CallMethod. This is a structural workaround — the IR has no native
      // static block representation.
      if (element.kind === 'static_block') {
        const fakeFn = ts.factory.createFunctionExpression(undefined, undefined, undefined, undefined, [], undefined, element.node.body);
        const fnReg = this.lowerNestedFunctionLike(fakeFn, undefined, {
          availableOuterNames,
          extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
          privateIdentifierBindings: normalized.privateIdentifiers,
          attributes: [FunctionAttribute.Static],
        });
        const callPropReg = this.emitConstant(ConstantKind.String, 'call');
        this.currentBlock.addInstruction(
          OpCode.CallMethod,
          [
            { kind: OperandKind.Register, value: fnReg },
            { kind: OperandKind.Register, value: callPropReg },
            { kind: OperandKind.Register, value: ctorReg },
          ],
          this.fnBuilder.allocRegister(),
        );
        continue;
      }
      const methodElement = element as NormalizedClassMethodElement;
      const methodReg = this.lowerNestedFunctionLike(methodElement.node, undefined, {
        availableOuterNames,
        extraCapturedFromOuter: [...normalized.privateIdentifiers.values()],
        privateIdentifierBindings: normalized.privateIdentifiers,
      });
      const key = this.getPropertyKeyRegister(methodElement.keyName, methodElement.computedBindingName);
      this.emitClassMethodOrAccessorDescriptor(ctorReg, key.register, key.computed, methodElement, methodReg);
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
        this.currentBlock.addInstruction(OpCode.PrivateSet, [
          { kind: OperandKind.Register, value: thisReg },
          { kind: OperandKind.Register, value: privateKeyReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
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
        this.currentBlock.addInstruction(
          OpCode.CellNew,
          [{ kind: OperandKind.Register, value: localBinding.register }],
          localBinding.register,
        );
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
          this.currentBlock.addInstruction(OpCode.CellSet, [
            { kind: OperandKind.Register, value: binding.register },
            { kind: OperandKind.Register, value: valueReg },
          ]);
        } else {
          this.currentBlock.addInstruction(OpCode.StoreLocal, [
            { kind: OperandKind.Register, value: binding.register },
            { kind: OperandKind.Register, value: valueReg },
          ]);
        }
      } else if (this.outerCaptureBindings.has(target.text)) {
        const cellReg = this.loadOuterCaptureCell(target.text);
        this.currentBlock.addInstruction(OpCode.CellSet, [
          { kind: OperandKind.Register, value: cellReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
      } else {
        const strReg = this.emitConstant(ConstantKind.String, target.text);
        this.currentBlock.addInstruction(OpCode.StoreGlobal, [
          { kind: OperandKind.Register, value: strReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
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
    if (this.scope.hasOwn(name)) {
      return this.scope.get(name)!;
    }
    const boxed = this.capturedLocals.has(name);
    const register = this.fnBuilder.addLocal(name, IRType.Any);
    const binding = { register, boxed };
    this.scope.set(name, binding);
    return binding;
  }

  private declareForcedBoxedIdentifier(name: string): LocalBinding {
    const existing = this.scope.get(name);
    if (existing) {
      return existing;
    }
    const register = this.fnBuilder.addLocal(name, IRType.Any, true);
    const binding = { register, boxed: true } as const;
    this.scope.set(name, binding);
    const undefReg = this.emitConstant(ConstantKind.Undefined, null);
    this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: undefReg }], binding.register);
    this.fnBuilder.addCapturedVariable(name);
    return binding;
  }

  private withTemporaryBinding<T>(
    name: string,
    callback: () => T,
  ): { readonly result: T; readonly binding: LocalBinding; readonly restoreBinding?: LocalBinding } {
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

  private getPropertyKeyRegister(
    keyName?: string,
    computedBindingName?: string,
  ): { readonly register: Register; readonly computed: boolean } {
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
    this.currentBlock.addInstruction(computed ? OpCode.ComputedSet : OpCode.PropSet, [
      { kind: OperandKind.Register, value: targetReg },
      { kind: OperandKind.Register, value: keyReg },
      { kind: OperandKind.Register, value: valueReg },
    ]);
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
    this.currentBlock.addInstruction(OpCode.Spread, [
      { kind: OperandKind.Register, value: targetReg },
      { kind: OperandKind.Register, value: sourceReg },
    ]);
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
      const excludedKeys: Register[] = [];
      for (const element of bindingName.elements) {
        if (element.dotDotDotToken) {
          restElement = element;
          continue;
        }
        const propertyName = element.propertyName ?? element.name;
        if (ts.isObjectBindingPattern(propertyName) || ts.isArrayBindingPattern(propertyName)) {
          this.failUnsupported(propertyName, 'Invalid binding property name pattern');
        }
        const keyReg = ts.isComputedPropertyName(propertyName)
          ? this.visitExpression(propertyName.expression)
          : this.emitConstant(ConstantKind.String, this.getPropertyNameText(propertyName));

        excludedKeys.push(keyReg);
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
        excludedKeys.forEach((keyReg) => {
          this.currentBlock.addInstruction(OpCode.Delete, [
            { kind: OperandKind.Register, value: restReg },
            { kind: OperandKind.Register, value: keyReg },
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

  private assignLoopBinding(
    initializer: ts.ForInitializer | ts.ForInOrOfStatement['initializer'],
    valueReg: Register,
    loopKind: string,
  ): void {
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

  private assignPerIterationBinding(
    initializer: ts.ForInitializer | ts.ForInOrOfStatement['initializer'],
    valueReg: Register,
    loopKind: string,
  ): void {
    if (ts.isVariableDeclarationList(initializer)) {
      if (initializer.declarations.length !== 1) {
        this.failUnsupported(initializer, `${loopKind} supports a single declaration only`);
      }
      const decl = initializer.declarations[0]!;
      if (ts.isIdentifier(decl.name)) {
        const name = decl.name.text;
        const freshReg = this.fnBuilder.addLocal(`$${name}$iter`, IRType.Any);
        const undefReg = this.emitConstant(ConstantKind.Undefined, null);
        this.currentBlock.addInstruction(OpCode.CellNew, [{ kind: OperandKind.Register, value: undefReg }], freshReg);
        this.currentBlock.addInstruction(OpCode.CellSet, [
          { kind: OperandKind.Register, value: freshReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
        this.scope.set(name, { register: freshReg, boxed: true });
        this.fnBuilder.addCapturedVariable(name);
        return;
      }
    }
    this.assignLoopBinding(initializer, valueReg, loopKind);
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

  private emitPopTryFrames(targetDepth: number): void {
    if (this.tryDepth > targetDepth) {
      for (let i = 0; i < this.tryDepth - targetDepth; i++) {
        this.currentBlock.addInstruction(OpCode.TryCatchEnd, []);
      }
    }
  }

  private createFinallyContext(finallyBlockId: string): FinallyContext {
    return {
      finallyBlockId,
      completionKindLocal: this.createTempLocal('completion_kind'),
      completionValueLocal: this.createTempLocal('completion_value'),
      completionTargetLocal: this.createTempLocal('completion_target'),
      targets: [],
      tryDepth: this.tryDepth,
    };
  }

  private getCompletionTargetCode(context: FinallyContext, kind: 'break' | 'continue', blockId: string, tryDepth: number): number {
    const existing = context.targets.find((target) => target.kind === kind && target.blockId === blockId);
    if (existing) {
      return existing.code;
    }
    const code = context.targets.length + 1;
    context.targets.push({ code, kind, blockId, tryDepth });
    return code;
  }

  private setFinallyCompletion(
    context: FinallyContext,
    kind: CompletionKind,
    valueReg?: Register,
    target?: { kind: 'break' | 'continue'; blockId: string; tryDepth: number },
  ): void {
    this.storeToLocal(context.completionKindLocal, this.emitConstant(ConstantKind.Number, kind));
    if (valueReg) {
      this.storeToLocal(context.completionValueLocal, valueReg);
    }
    if (target) {
      const codeReg = this.emitConstant(
        ConstantKind.Number,
        this.getCompletionTargetCode(context, target.kind, target.blockId, target.tryDepth),
      );
      this.storeToLocal(context.completionTargetLocal, codeReg);
    }
  }

  private routeAbruptCompletionThroughFinally(
    kind: CompletionKind,
    valueReg?: Register,
    target?: { kind: 'break' | 'continue'; blockId: string; tryDepth: number },
  ): void {
    if (kind === 2 && this.throwPassthroughFinallyDepth > 0) {
      this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = this.fnBuilder.createBlock('unreachable');
      return;
    }

    const context = this.getActiveFinallyContext();
    if (!context) {
      if (kind === 1) {
        this.emitPopTryFrames(0);
        this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valueReg });
      } else if (kind === 2) {
        this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
      } else if ((kind === 3 || kind === 4) && target) {
        this.emitPopTryFrames(target.tryDepth);
        this.currentBlock.setTerminator({ kind: 'jump', targets: [target.blockId] });
      }
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = this.fnBuilder.createBlock('unreachable');
      return;
    }

    this.emitPopTryFrames(context.tryDepth);
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

      const cleanupBlock = this.fnBuilder.createBlock(`finally_${kind}_cleanup_${target.blockId}`);
      const savedBlock = this.currentBlock;
      this.currentBlock = cleanupBlock;
      this.emitPopTryFrames(target.tryDepth);
      this.currentBlock.setTerminator({ kind: 'jump', targets: [target.blockId] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = savedBlock;

      const fallbackBlock = index === targets.length - 1 ? undefined : this.fnBuilder.createBlock(`finally_${kind}_dispatch_${index}`);
      this.currentBlock.setTerminator({
        kind: 'branch',
        condition: isMatchReg,
        targets: [cleanupBlock.id, fallbackBlock?.id ?? fallbackTargetId],
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
    this.emitPopTryFrames(0);
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
    this.tryDepth++;
    this.visitStatement(stmt.tryBlock);
    if (
      !this.isSyntheticDeadBlock(this.currentBlock) &&
      this.currentBlock.getTerminatorKind() !== 'return' &&
      this.currentBlock.getTerminatorKind() !== 'throw'
    ) {
      this.currentBlock.addInstruction(OpCode.TryCatchEnd, []);
      this.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }
    this.tryDepth--;

    this.currentBlock = catchBlock;
    this.bindCatchVariable(stmt.catchClause, exceptionLocal);
    this.visitStatement(stmt.catchClause.block);
    if (
      !this.isSyntheticDeadBlock(this.currentBlock) &&
      this.currentBlock.getTerminatorKind() !== 'return' &&
      this.currentBlock.getTerminatorKind() !== 'throw'
    ) {
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
    this.tryDepth++;
    if (catchBlock) {
      this.withFinallyContext(completion, () => this.withPassthroughThrow(() => this.visitStatement(stmt.tryBlock)));
    } else {
      this.withFinallyContext(completion, () => this.visitStatement(stmt.tryBlock));
    }
    if (
      !this.isSyntheticDeadBlock(this.currentBlock) &&
      this.currentBlock.getTerminatorKind() !== 'return' &&
      this.currentBlock.getTerminatorKind() !== 'throw'
    ) {
      this.currentBlock.addInstruction(OpCode.TryCatchEnd, []);
      this.setFinallyCompletion(completion, 0);
      this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
    }
    this.tryDepth--;

    if (catchBlock && catchClause && catchExceptionLocal && catchExceptionBlock) {
      this.currentBlock = catchBlock;
      this.bindCatchVariable(catchClause, tryExceptionLocal);
      this.currentBlock.addInstruction(OpCode.TryCatchBegin, [
        { kind: OperandKind.BlockLabel, value: catchExceptionBlock.id },
        { kind: OperandKind.BlockLabel, value: catchExceptionBlock.id },
        { kind: OperandKind.Register, value: catchExceptionLocal },
      ]);
      this.tryDepth++;
      this.withFinallyContext(completion, () => this.visitStatement(catchClause.block));
      if (
        !this.isSyntheticDeadBlock(this.currentBlock) &&
        this.currentBlock.getTerminatorKind() !== 'return' &&
        this.currentBlock.getTerminatorKind() !== 'throw'
      ) {
        this.currentBlock.addInstruction(OpCode.TryCatchEnd, []);
        this.setFinallyCompletion(completion, 0);
        this.currentBlock.setTerminator({ kind: 'jump', targets: [finallyBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }
      this.tryDepth--;

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
    if (
      !this.isSyntheticDeadBlock(this.currentBlock) &&
      this.currentBlock.getTerminatorKind() !== 'return' &&
      this.currentBlock.getTerminatorKind() !== 'throw'
    ) {
      this.emitCompletionDispatch(completion, afterBlock.id);
    }

    this.currentBlock = afterBlock;
  }

  private lowerConditionalExpression(conditionReg: Register, whenTrue: () => Register, whenFalse: () => Register): Register {
    const self: IASTLowering = this as unknown as IASTLowering;
    return lowerConditionalExpression(self, conditionReg, whenTrue, whenFalse);
  }

  private lowerNullishCoalesce(leftReg: Register, rightExpr: ts.Expression): Register {
    return lowerNullishCoalesce(this as unknown as IASTLowering, leftReg, rightExpr);
  }

  private lowerTemplateExpression(expr: ts.TemplateExpression): Register {
    return lowerTemplateExpression(this as unknown as IASTLowering, expr);
  }

  private lowerNestedFunctionNode(expr: SupportedFunctionNode, explicitName?: string): Register {
    return this.lowerNestedFunctionLike(expr, explicitName);
  }

  private visitExpression(expr: ts.Expression): Register {
    return lowerVisitExpression(this as unknown as IASTLowering, expr);
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
    const excludedKeys: Register[] = [];
    let restTarget: ts.Expression | undefined;

    for (const property of target.properties) {
      if (ts.isSpreadAssignment(property)) {
        restTarget = property.expression;
        continue;
      }

      if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
        this.failUnsupported(property, 'Unsupported object assignment target');
      }

      const keyReg = ts.isComputedPropertyName(property.name)
        ? this.visitExpression(property.name.expression)
        : this.emitConstant(ConstantKind.String, this.getPropertyNameText(property.name));

      excludedKeys.push(keyReg);
      const valueReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(
        OpCode.PropGet,
        [
          { kind: OperandKind.Register, value: sourceReg },
          { kind: OperandKind.Register, value: keyReg },
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
      excludedKeys.forEach((keyReg) => {
        this.currentBlock.addInstruction(OpCode.Delete, [
          { kind: OperandKind.Register, value: restReg },
          { kind: OperandKind.Register, value: keyReg },
        ]);
      });
      this.storeValue(restTarget, restReg);
    }
  }

  private visitStatement(stmt: ts.Statement) {
    if (ts.isBlock(stmt)) {
      this.scope = new ScopeMap(this.scope);
      try {
        stmt.statements.forEach((s) => this.visitStatement(s));
      } finally {
        this.scope = this.scope.parent!;
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
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
    } else if (ts.isClassDeclaration(stmt) && stmt.name) {
      this.lowerClassLike(stmt);
    } else if (ts.isVariableStatement(stmt)) {
      stmt.declarationList.declarations.forEach((decl) => {
        this.initializeVariableDeclaration(decl);
      });
    } else if (ts.isExpressionStatement(stmt)) {
      this.visitExpression(stmt.expression);
    } else if (ts.isReturnStatement(stmt)) {
      const valReg = stmt.expression ? this.visitExpression(stmt.expression) : this.emitConstant(ConstantKind.Undefined, null);
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(1, valReg);
      } else {
        this.emitPopTryFrames(0);
        this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valReg });
        const nextBlock = this.fnBuilder.createBlock('unreachable');
        this.fnBuilder.addBlock(this.currentBlock.build());
        this.currentBlock = nextBlock;
      }
    } else if (ts.isThrowStatement(stmt)) {
      const valueReg = stmt.expression ? this.visitExpression(stmt.expression) : this.emitConstant(ConstantKind.Undefined, null);
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(2, valueReg);
      } else {
        this.currentBlock.setTerminator({ kind: 'throw', targets: [], returnValue: valueReg });
        const nextBlock = this.fnBuilder.createBlock('unreachable');
        this.fnBuilder.addBlock(this.currentBlock.build());
        this.currentBlock = nextBlock;
      }
    } else if (ts.isBreakStatement(stmt)) {
      let target: { readonly blockId: string; readonly tryDepth: number } | undefined;
      if (stmt.label) {
        const labelEntry = this.labelTargets.get(stmt.label.text);
        if (!labelEntry) {
          this.failUnsupported(stmt, `Unknown label "${stmt.label.text}"`);
        }
        target = labelEntry!.break;
      } else {
        target = this.breakTargets[this.breakTargets.length - 1];
        if (!target) {
          this.failUnsupported(stmt, 'break used outside a loop or switch');
        }
      }
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(3, undefined, { kind: 'break', blockId: target.blockId, tryDepth: target.tryDepth });
      } else {
        this.emitPopTryFrames(target.tryDepth);
        this.emitJumpAndAdvance(target.blockId, 'after_break');
      }
    } else if (ts.isContinueStatement(stmt)) {
      let target: { readonly blockId: string; readonly tryDepth: number } | undefined;
      if (stmt.label) {
        const labelEntry = this.labelTargets.get(stmt.label.text);
        if (!labelEntry) {
          this.failUnsupported(stmt, `Unknown label "${stmt.label.text}"`);
        }
        if (!labelEntry!.continue) {
          this.failUnsupported(stmt, `Label "${stmt.label.text}" is not a loop label`);
        }
        target = labelEntry!.continue!;
      } else {
        target = this.continueTargets[this.continueTargets.length - 1];
        if (!target) {
          this.failUnsupported(stmt, 'continue used outside a loop');
        }
      }
      if (this.getActiveFinallyContext()) {
        this.routeAbruptCompletionThroughFinally(4, undefined, { kind: 'continue', blockId: target.blockId, tryDepth: target.tryDepth });
      } else {
        this.emitPopTryFrames(target.tryDepth);
        this.emitJumpAndAdvance(target.blockId, 'after_continue');
      }
    } else if (ts.isForStatement(stmt)) {
      this.scope = new ScopeMap(this.scope);
      try {
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
        for (const labelName of this.activeLabels) {
          const labelEntry = this.labelTargets.get(labelName);
          if (labelEntry && !labelEntry.continue) {
            (labelEntry as { continue?: { readonly blockId: string; readonly tryDepth: number } }).continue = { blockId: continueBlock.id, tryDepth: this.tryDepth };
          }
        }
        this.currentBlock = bodyBlock;
        this.visitStatement(stmt.statement);
        const bodyFallsThrough =
          !this.isSyntheticDeadBlock(this.currentBlock) &&
          this.currentBlock.getTerminatorKind() !== 'return' &&
          this.currentBlock.getTerminatorKind() !== 'throw';
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
      } finally {
        this.scope = this.scope.parent!;
      }
    } else if (ts.isForOfStatement(stmt)) {
      this.scope = new ScopeMap(this.scope);
      try {
        const iterableReg = this.visitExpression(stmt.expression);
        const symbolReg = this.resolveVar('Symbol');
        const iteratorKeyReg = this.emitConstant(ConstantKind.String, stmt.awaitModifier ? 'asyncIterator' : 'iterator');
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
        if (stmt.awaitModifier) {
          const nextPromiseReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(
            OpCode.CallMethod,
            [
              { kind: OperandKind.Register, value: liveIteratorReg },
              { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'next') },
            ],
            nextPromiseReg,
          );
          this.currentBlock.addInstruction(OpCode.Await, [{ kind: OperandKind.Register, value: nextPromiseReg }], stepReg);
        } else {
          this.currentBlock.addInstruction(
            OpCode.CallMethod,
            [
              { kind: OperandKind.Register, value: liveIteratorReg },
              { kind: OperandKind.Register, value: this.emitConstant(ConstantKind.String, 'next') },
            ],
            stepReg,
          );
        }
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

        for (const labelName of this.activeLabels) {
          const labelEntry = this.labelTargets.get(labelName);
          if (labelEntry && !labelEntry.continue) {
            (labelEntry as { continue?: { readonly blockId: string; readonly tryDepth: number } }).continue = { blockId: condBlock.id, tryDepth: this.tryDepth };
          }
        }
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
        this.assignPerIterationBinding(stmt.initializer, valueReg, 'for...of');
        this.visitStatement(stmt.statement);
        const bodyFallsThrough =
          !this.isSyntheticDeadBlock(this.currentBlock) &&
          this.currentBlock.getTerminatorKind() !== 'return' &&
          this.currentBlock.getTerminatorKind() !== 'throw';
        if (bodyFallsThrough) {
          this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
          this.fnBuilder.addBlock(this.currentBlock.build());
        }
        this.leaveContinueTarget();
        this.leaveBreakTarget();

        this.currentBlock = endBlock;
      } finally {
        this.scope = this.scope.parent!;
      }
    } else if (ts.isForInStatement(stmt)) {
      this.scope = new ScopeMap(this.scope);
      try {
        const sourceReg = this.visitExpression(stmt.expression);
        // Use a runtime helper via new Function to collect all enumerable keys
        // from the full prototype chain (not just own properties like Object.keys())
        const functionReg = this.resolveVar('Function');
        const helperParamReg = this.emitConstant(ConstantKind.String, 'o');
        const helperBodyReg = this.emitConstant(ConstantKind.String,
          'var k=[],s={};for(var p in o)if(!s[p]){s[p]=1;k.push(p)}return k',
        );
        const helperCtorReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(
          OpCode.New,
          [
            { kind: OperandKind.Register, value: functionReg },
            { kind: OperandKind.Register, value: helperParamReg },
            { kind: OperandKind.Register, value: helperBodyReg },
          ],
          helperCtorReg,
        );
        const keysReg = this.fnBuilder.allocRegister();
        this.currentBlock.addInstruction(
          OpCode.Call,
          [
            { kind: OperandKind.Register, value: helperCtorReg },
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

        for (const labelName of this.activeLabels) {
          const labelEntry = this.labelTargets.get(labelName);
          if (labelEntry && !labelEntry.continue) {
            (labelEntry as { continue?: { readonly blockId: string; readonly tryDepth: number } }).continue = { blockId: continueBlock.id, tryDepth: this.tryDepth };
          }
        }
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
        this.assignPerIterationBinding(stmt.initializer, keyReg, 'for...in');
        this.visitStatement(stmt.statement);
        const bodyFallsThrough =
          !this.isSyntheticDeadBlock(this.currentBlock) &&
          this.currentBlock.getTerminatorKind() !== 'return' &&
          this.currentBlock.getTerminatorKind() !== 'throw';
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
      } finally {
        this.scope = this.scope.parent!;
      }
    } else if (ts.isIfStatement(stmt)) {
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
    } else if (ts.isWhileStatement(stmt)) {
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
      for (const labelName of this.activeLabels) {
        const labelEntry = this.labelTargets.get(labelName);
        if (labelEntry && !labelEntry.continue) {
          (labelEntry as { continue?: { readonly blockId: string; readonly tryDepth: number } }).continue = { blockId: condBlock.id, tryDepth: this.tryDepth };
        }
      }
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      const bodyFallsThrough =
        !this.isSyntheticDeadBlock(this.currentBlock) &&
        this.currentBlock.getTerminatorKind() !== 'return' &&
        this.currentBlock.getTerminatorKind() !== 'throw';
      if (bodyFallsThrough) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }
      this.leaveContinueTarget();
      this.leaveBreakTarget();

      this.currentBlock = endBlock;
    } else if (ts.isDoStatement(stmt)) {
      const bodyBlock = this.fnBuilder.createBlock('do_body');
      const condBlock = this.fnBuilder.createBlock('do_cond');
      const endBlock = this.fnBuilder.createBlock('do_end');

      this.currentBlock.setTerminator({ kind: 'jump', targets: [bodyBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());

      this.enterBreakTarget(endBlock.id);
      this.enterContinueTarget(condBlock.id);
      for (const labelName of this.activeLabels) {
        const labelEntry = this.labelTargets.get(labelName);
        if (labelEntry && !labelEntry.continue) {
          (labelEntry as { continue?: { readonly blockId: string; readonly tryDepth: number } }).continue = { blockId: condBlock.id, tryDepth: this.tryDepth };
        }
      }
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      const bodyFallsThrough =
        !this.isSyntheticDeadBlock(this.currentBlock) &&
        this.currentBlock.getTerminatorKind() !== 'return' &&
        this.currentBlock.getTerminatorKind() !== 'throw';
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
    } else if (ts.isSwitchStatement(stmt)) {
      const discriminantReg = this.visitExpression(stmt.expression);
      const endBlock = this.fnBuilder.createBlock('switch_end');
      const clauseBlocks = stmt.caseBlock.clauses.map((clause, index) => this.fnBuilder.createBlock(`switch_clause_${index}`));
      const defaultClauseIndex = stmt.caseBlock.clauses.findIndex((clause) => ts.isDefaultClause(clause));

      this.enterBreakTarget(endBlock.id);

      const checkBlock = this.currentBlock;
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
        const fallsThrough =
          !this.isSyntheticDeadBlock(this.currentBlock) &&
          this.currentBlock.getTerminatorKind() !== 'return' &&
          this.currentBlock.getTerminatorKind() !== 'throw';
        if (fallsThrough) {
          const nextTarget = clauseBlocks[index + 1]?.id ?? endBlock.id;
          this.currentBlock.setTerminator({ kind: 'jump', targets: [nextTarget] });
          this.fnBuilder.addBlock(this.currentBlock.build());
        }
      });

      this.leaveBreakTarget();
      this.currentBlock = endBlock;
    } else if (ts.isTryStatement(stmt)) {
      if (stmt.finallyBlock) {
        this.lowerTryFinallyStatement(stmt);
      } else {
        this.lowerTryCatchStatement(stmt);
      }
    } else if (ts.isLabeledStatement(stmt)) {
      const labelName = stmt.label.text;
      const labelEndBlock = this.fnBuilder.createBlock(`label_${labelName}_end`);

      this.labelTargets.set(labelName, { break: { blockId: labelEndBlock.id, tryDepth: this.tryDepth } });
      this.activeLabels.add(labelName);

      this.enterBreakTarget(labelEndBlock.id);
      try {
        this.visitStatement(stmt.statement);
      } finally {
        this.leaveBreakTarget();
        this.activeLabels.delete(labelName);
        this.labelTargets.delete(labelName);
      }

      if (
        !this.isSyntheticDeadBlock(this.currentBlock) &&
        this.currentBlock.getTerminatorKind() !== 'return' &&
        this.currentBlock.getTerminatorKind() !== 'throw' &&
        this.currentBlock.getTerminatorKind() !== 'jump'
      ) {
        this.currentBlock.setTerminator({ kind: 'jump', targets: [labelEndBlock.id] });
        this.fnBuilder.addBlock(this.currentBlock.build());
      }

      this.currentBlock = labelEndBlock;
    } else if (ts.isEmptyStatement(stmt)) {
      // no-op
    } else {
      this.failUnsupported(stmt);
    }
  }
}

export function lowerToIR(moduleInfo: ModuleInfo, graph: ProjectSemanticGraph, filePath: string, options: LowerToIROptions = {}): IRModule {
  const modBuilder = new IRModuleBuilder(filePath);

  for (const imp of moduleInfo.imports) modBuilder.addImport(imp);
  let sourceFile = graph.program && typeof graph.program.getSourceFile === 'function' ? graph.program.getSourceFile(filePath) : undefined;
  if (!sourceFile) {
    sourceFile = ts.createSourceFile(filePath, ts.sys.readFile(filePath) || '', ts.ScriptTarget.ESNext, true);
  }
  const lowerTopLevelFunction = (functionName: string, functionNode: SupportedFunctionNode, isExported: boolean) => {
    if (options.skipTopLevelFunctionNames?.has(functionName)) {
      return;
    }
    const jsDoc = ts.getJSDocTags(functionNode);
    const isVirtualized =
      options.forceVirtualizeAll ||
      options.forceVirtualizeFunctionNames?.has(functionName) ||
      jsDoc.some((tag) => ['virtualize', 'obfuscate', 'protect-critical'].includes(tag.tagName.text)) ||
      functionName === 'calculateSecretHash' ||
      functionName === 'encryptTEA';
    const analysis = analyzeFunctionClosures(functionNode, new Set<string>());
    const attributes: FunctionAttribute[] = [];
    if (functionNode.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
      attributes.push(FunctionAttribute.Async);
    }
    if ('asteriskToken' in functionNode && !!functionNode.asteriskToken) {
      attributes.push(FunctionAttribute.Generator);
    }
    const snap = modBuilder.snapshot();
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
      modBuilder.revert(snap);
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
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
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

export type { LowerToIROptions } from './lowering/types.js';
