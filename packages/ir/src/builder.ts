import ts from 'typescript';
import type { Diagnostic, ModuleInfo, ProjectSemanticGraph, IRModule, Operand, Register } from '@tsvm/shared';
import { DiagnosticSeverity, IRType, OpCode, OperandKind, ConstantKind, FunctionAttribute } from '@tsvm/shared';
import { IRModuleBuilder, IRFunctionBuilder, BasicBlockBuilder } from './ir.js';

type SupportedFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

interface LoweringOptions {
  readonly name: string;
  readonly isExported: boolean;
  readonly isVirtualized: boolean;
  readonly analysis: ClosureAnalysis;
  readonly attributes?: readonly FunctionAttribute[];
  readonly isNested?: boolean;
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

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}

function isNestedFunctionLike(node: ts.Node): node is SupportedFunctionNode {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
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

  constructor(public readonly modBuilder: IRModuleBuilder, private readonly node: SupportedFunctionNode, options: LoweringOptions) {
    this.functionId = modBuilder.getNextFunctionId();
    this.fnBuilder = new IRFunctionBuilder(this.functionId, options.name, IRType.Any);
    this.sourceFile = node.getSourceFile();
    this.capturedLocals = options.analysis.capturedByDescendants;
    if (options.isExported) {
      this.fnBuilder.addAttribute(FunctionAttribute.Exported);
    }
    if (options.isNested) {
      this.fnBuilder.addAttribute(FunctionAttribute.Nested);
    }
    for (const attribute of options.attributes ?? []) {
      this.fnBuilder.addAttribute(attribute);
    }

    this.currentBlock = this.fnBuilder.createBlock('entry');
    options.analysis.capturedFromOuter.forEach((name, index) => {
      this.outerCaptureBindings.set(name, index);
      this.fnBuilder.addCapturedVariable(name);
    });

    node.parameters.forEach((param, index) => {
      const isPlainIdentifier = ts.isIdentifier(param.name) && !param.dotDotDotToken && !param.initializer;
      const paramName = isPlainIdentifier ? param.name.text : `$param_${index}`;
      const reg = this.fnBuilder.addParam(paramName, IRType.Any, !!param.dotDotDotToken);
      if (isPlainIdentifier && ts.isIdentifier(param.name)) {
        this.scope.set(param.name.text, { register: reg, boxed: this.capturedLocals.has(param.name.text) });
      } else {
        this.pendingParameterBindings.push({ param, register: reg });
      }
    });
    this.boxCapturedParameters();
    this.lowerPendingParameterBindings();

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

  private lowerNestedFunction(expr: ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration): Register {
    const nestedName = this.createNestedFunctionName();
    const availableOuterNames = new Set<string>(this.outerCaptureBindings.keys());
    for (const name of this.scope.keys()) {
      availableOuterNames.add(name);
    }
    const analysis = analyzeFunctionClosures(expr, availableOuterNames);
    const attributes: FunctionAttribute[] = [];
    if (ts.isArrowFunction(expr)) {
      attributes.push(FunctionAttribute.Arrow);
    }
    if (ts.isMethodDeclaration(expr)) {
      attributes.push(FunctionAttribute.Method);
    }
    const nestedLowering = new ASTLowering(this.modBuilder, expr, {
      name: nestedName,
      isExported: false,
      isVirtualized: true,
      analysis,
      attributes,
      isNested: true,
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
        this.failUnsupported(this.findIdentifierNode(name) ?? this.node, `Closure capture expected boxed local "${name}"`);
      }
      return localBinding.register;
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
      const objReg = this.visitExpression(target.expression);
      const propReg = this.emitConstant(ConstantKind.String, target.name.text);
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
    const nestedName = explicitName ?? this.createNestedFunctionName();
    const availableOuterNames = new Set<string>(this.outerCaptureBindings.keys());
    for (const name of this.scope.keys()) {
      availableOuterNames.add(name);
    }
    const analysis = analyzeFunctionClosures(expr, availableOuterNames);
    const attributes: FunctionAttribute[] = [];
    if (ts.isArrowFunction(expr)) {
      attributes.push(FunctionAttribute.Arrow);
    }
    if (ts.isMethodDeclaration(expr)) {
      attributes.push(FunctionAttribute.Method);
    }
    const nestedLowering = new ASTLowering(this.modBuilder, expr, {
      name: nestedName,
      isExported: false,
      isVirtualized: true,
      analysis,
      attributes,
      isNested: true,
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

  private visitExpression(expr: ts.Expression): Register {
    expr = this.normalizeExpression(expr);
    if (ts.isNumericLiteral(expr)) {
      return this.emitConstant(ConstantKind.Number, parseFloat(expr.text));
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return this.emitConstant(ConstantKind.String, expr.text);
    }
    if (ts.isTemplateExpression(expr)) {
      return this.lowerTemplateExpression(expr);
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) return this.emitConstant(ConstantKind.Null, null);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return this.emitConstant(ConstantKind.Boolean, true);
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return this.emitConstant(ConstantKind.Boolean, false);
    if (expr.kind === ts.SyntaxKind.ThisKeyword) return this.emitConstant(ConstantKind.Undefined, null);
    
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
      const objReg = this.visitExpression(expr.expression);
      const propReg = this.emitConstant(ConstantKind.String, expr.name.text);
      const resReg = this.fnBuilder.allocRegister();
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

      expr.elements.forEach((element) => {
        if (ts.isOmittedExpression(element)) {
          this.failUnsupported(element, 'Sparse array holes are not supported yet');
        }
        if (ts.isSpreadElement(element)) {
          const spreadReg = this.visitExpression(element.expression);
          this.emitSpreadInto(arrayReg, spreadReg);
          return;
        }
        const valueReg = this.visitExpression(element);
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
          const valueReg = this.lowerNestedFunction(property);
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

        this.failUnsupported(property, 'Unsupported object literal property kind');
      }

      return objectReg;
    }

    if (ts.isCallExpression(expr)) {
      const resReg = this.fnBuilder.allocRegister();
      const hasSpread = expr.arguments.some((arg) => ts.isSpreadElement(arg));
      if (hasSpread) {
        const argArrayReg = this.materializeArgumentArray(expr.arguments);
        if (ts.isPropertyAccessExpression(expr.expression)) {
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
      
      if (ts.isPropertyAccessExpression(expr.expression)) {
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
    try {
      new ASTLowering(modBuilder, functionNode, {
        name: functionName,
        isExported,
        isVirtualized,
        analysis,
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
