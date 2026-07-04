import type { IASTLowering } from '../builder.js';
import { OpCode, OperandKind, ConstantKind } from '@tsvm/shared';
import type { Register, Operand } from '@tsvm/shared';
import ts from 'typescript';
import { LEXICAL_THIS_CAPTURE, LEXICAL_NEW_TARGET_CAPTURE } from './types.js';
import type { SupportedFunctionNode } from './types.js';

export function lowerConditionalExpression(
  self: IASTLowering,
  conditionReg: Register,
  whenTrue: () => Register,
  whenFalse: () => Register,
): Register {
  const tempReg = self.createTempLocal('expr');
  const trueBlock = self.fnBuilder.createBlock('expr_true');
  const falseBlock = self.fnBuilder.createBlock('expr_false');
  const endBlock = self.fnBuilder.createBlock('expr_end');

  trueBlock.addPredecessor(self.currentBlock.id);
  falseBlock.addPredecessor(self.currentBlock.id);
  self.currentBlock.setTerminator({ kind: 'branch', condition: conditionReg, targets: [trueBlock.id, falseBlock.id] });
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = trueBlock;
  const trueValue = whenTrue();
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: trueValue },
  ]);
  self.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
  endBlock.addPredecessor(self.currentBlock.id);
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = falseBlock;
  const falseValue = whenFalse();
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: falseValue },
  ]);
  self.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
  endBlock.addPredecessor(self.currentBlock.id);
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = endBlock;
  return self.loadFromLocal(tempReg);
}

export function lowerOptionalChain(self: IASTLowering, objReg: Register, continuation: () => Register): Register {
  const tempReg = self.createTempLocal('optchain');
  const undefValReg = self.emitConstant(ConstantKind.Undefined, null);
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: undefValReg },
  ]);

  const nullConst = self.emitConstant(ConstantKind.Null, null);
  const isNullOrUndefReg = self.fnBuilder.allocRegister();
  self.currentBlock.addInstruction(
    OpCode.Eq,
    [
      { kind: OperandKind.Register, value: objReg },
      { kind: OperandKind.Register, value: nullConst },
    ],
    isNullOrUndefReg,
  );

  const rhsBlock = self.fnBuilder.createBlock('optchain_rhs');
  const endBlock = self.fnBuilder.createBlock('optchain_end');
  rhsBlock.addPredecessor(self.currentBlock.id);
  endBlock.addPredecessor(self.currentBlock.id);
  self.currentBlock.setTerminator({
    kind: 'branch',
    condition: isNullOrUndefReg,
    targets: [endBlock.id, rhsBlock.id],
  });
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = rhsBlock;
  const resultReg = continuation();
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: resultReg },
  ]);
  self.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
  endBlock.addPredecessor(self.currentBlock.id);
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = endBlock;
  return self.loadFromLocal(tempReg);
}

export function lowerNullishCoalesce(self: IASTLowering, leftReg: Register, rightExpr: ts.Expression): Register {
  const tempReg = self.createTempLocal('nullish');
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: leftReg },
  ]);

  const nullConst = self.emitConstant(ConstantKind.Null, null);
  const undefConst = self.emitConstant(ConstantKind.Undefined, null);
  const isNullReg = self.fnBuilder.allocRegister();
  self.currentBlock.addInstruction(
    OpCode.StrictEq,
    [
      { kind: OperandKind.Register, value: leftReg },
      { kind: OperandKind.Register, value: nullConst },
    ],
    isNullReg,
  );

  const rhsBlock = self.fnBuilder.createBlock('nullish_rhs');
  const undefCheckBlock = self.fnBuilder.createBlock('nullish_undef');
  const endBlock = self.fnBuilder.createBlock('nullish_end');

  rhsBlock.addPredecessor(self.currentBlock.id);
  undefCheckBlock.addPredecessor(self.currentBlock.id);
  self.currentBlock.setTerminator({ kind: 'branch', condition: isNullReg, targets: [rhsBlock.id, undefCheckBlock.id] });
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = undefCheckBlock;
  const isUndefReg = self.fnBuilder.allocRegister();
  self.currentBlock.addInstruction(
    OpCode.StrictEq,
    [
      { kind: OperandKind.Register, value: leftReg },
      { kind: OperandKind.Register, value: undefConst },
    ],
    isUndefReg,
  );
  rhsBlock.addPredecessor(self.currentBlock.id);
  endBlock.addPredecessor(self.currentBlock.id);
  self.currentBlock.setTerminator({ kind: 'branch', condition: isUndefReg, targets: [rhsBlock.id, endBlock.id] });
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = rhsBlock;
  const rightReg = visitExpression(self, rightExpr);
  self.currentBlock.addInstruction(OpCode.StoreLocal, [
    { kind: OperandKind.Register, value: tempReg },
    { kind: OperandKind.Register, value: rightReg },
  ]);
  self.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
  endBlock.addPredecessor(self.currentBlock.id);
  self.fnBuilder.addBlock(self.currentBlock.build());

  self.currentBlock = endBlock;
  return self.loadFromLocal(tempReg);
}

export function lowerTemplateExpression(self: IASTLowering, expr: ts.TemplateExpression): Register {
  let accReg = self.emitConstant(ConstantKind.String, expr.head.text);

  for (const span of expr.templateSpans) {
    const valueReg = visitExpression(self, span.expression);
    const combinedValue = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.Add,
      [
        { kind: OperandKind.Register, value: accReg },
        { kind: OperandKind.Register, value: valueReg },
      ],
      combinedValue,
    );
    accReg = combinedValue;

    if (span.literal.text.length > 0) {
      const literalReg = self.emitConstant(ConstantKind.String, span.literal.text);
      const combinedLiteral = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.Add,
        [
          { kind: OperandKind.Register, value: accReg },
          { kind: OperandKind.Register, value: literalReg },
        ],
        combinedLiteral,
      );
      accReg = combinedLiteral;
    }
  }

  return accReg;
}

export function lowerNestedFunctionNode(self: IASTLowering, expr: SupportedFunctionNode, explicitName?: string): Register {
  return self.lowerNestedFunctionLike(expr, explicitName);
}

export function visitExpression(self: IASTLowering, expr: ts.Expression): Register {
  expr = self.normalizeExpression(expr);
  if (ts.isNumericLiteral(expr)) {
    return self.emitConstant(ConstantKind.Number, Number.parseFloat(expr.text));
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return self.emitConstant(ConstantKind.String, expr.text);
  }
  if (ts.isBigIntLiteral(expr)) {
    const bigintGlobalReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.LoadGlobal,
      [{ kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'BigInt') }],
      bigintGlobalReg,
    );

    const valReg = self.emitConstant(ConstantKind.String, expr.text.replace(/n$/, ''));
    const resReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.Call,
      [
        { kind: OperandKind.Register, value: bigintGlobalReg },
        { kind: OperandKind.Register, value: valReg },
      ],
      resReg,
    );
    return resReg;
  }
  if (ts.isRegularExpressionLiteral(expr)) {
    const rawText = expr.text;
    const lastSlashIndex = rawText.lastIndexOf('/');
    const pattern = rawText.slice(1, lastSlashIndex);
    const flags = rawText.slice(lastSlashIndex + 1);

    const objectGlobalReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.LoadGlobal,
      [{ kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'RegExp') }],
      objectGlobalReg,
    );

    const patternReg = self.emitConstant(ConstantKind.String, pattern);
    const flagsReg = self.emitConstant(ConstantKind.String, flags);

    const resReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.New,
      [
        { kind: OperandKind.Register, value: objectGlobalReg },
        { kind: OperandKind.Register, value: patternReg },
        { kind: OperandKind.Register, value: flagsReg },
      ],
      resReg,
    );
    return resReg;
  }
  if (ts.isTemplateExpression(expr)) {
    return lowerTemplateExpression(self, expr);
  }
  if (ts.isTaggedTemplateExpression(expr)) {
    const tagReg = visitExpression(self, expr.tag);
    const template = expr.template;
    const cookedReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.ArrayNew, [], cookedReg);
    const rawReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.ArrayNew, [], rawReg);
    let parts: string[];
    let subRegs: Register[];
    if (ts.isTemplateExpression(template)) {
      parts = [template.head.text];
      for (const span of template.templateSpans) {
        parts.push(span.literal.text);
      }
      subRegs = template.templateSpans.map((span) => visitExpression(self, span.expression));
    } else {
      parts = [template.text];
      subRegs = [];
    }
    for (let i = 0; i < parts.length; i++) {
      const strReg = self.emitConstant(ConstantKind.String, parts[i]);
      const idxReg = self.emitConstant(ConstantKind.Number, i);
      self.currentBlock.addInstruction(OpCode.ComputedSet, [
        { kind: OperandKind.Register, value: cookedReg },
        { kind: OperandKind.Register, value: idxReg },
        { kind: OperandKind.Register, value: strReg },
      ]);
      self.currentBlock.addInstruction(OpCode.ComputedSet, [
        { kind: OperandKind.Register, value: rawReg },
        { kind: OperandKind.Register, value: idxReg },
        { kind: OperandKind.Register, value: strReg },
      ]);
    }
    const rawPropReg = self.emitConstant(ConstantKind.String, 'raw');
    self.currentBlock.addInstruction(OpCode.PropSet, [
      { kind: OperandKind.Register, value: cookedReg },
      { kind: OperandKind.Register, value: rawPropReg },
      { kind: OperandKind.Register, value: rawReg },
    ]);
    const resReg = self.fnBuilder.allocRegister();
    const ops: Operand[] = [
      { kind: OperandKind.Register, value: tagReg },
      { kind: OperandKind.Register, value: cookedReg },
      ...subRegs.map((r) => ({ kind: OperandKind.Register, value: r }) as Operand),
    ];
    self.currentBlock.addInstruction(OpCode.Call, ops, resReg);
    return resReg;
  }
  if (ts.isAwaitExpression(expr)) {
    if (!self.isAsyncFunction) {
      self.failUnsupported(expr, 'await outside async function is not supported');
    }
    const awaitedSourceReg = visitExpression(self, expr.expression);
    const awaitedValueReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.Await, [{ kind: OperandKind.Register, value: awaitedSourceReg }], awaitedValueReg);
    return awaitedValueReg;
  }
  if (ts.isYieldExpression(expr)) {
    if (!self.isGenerator) {
      self.failUnsupported(expr, 'yield outside generator is not supported');
    }
    const yieldedValueReg = expr.expression ? visitExpression(self, expr.expression) : self.emitConstant(ConstantKind.Undefined, null);
    const resReg = self.fnBuilder.allocRegister();
    if (expr.asteriskToken) {
      self.currentBlock.addInstruction(OpCode.YieldStar, [{ kind: OperandKind.Register, value: yieldedValueReg }], resReg);
    } else {
      self.currentBlock.addInstruction(OpCode.Yield, [{ kind: OperandKind.Register, value: yieldedValueReg }], resReg);
    }
    return resReg;
  }
  if (expr.kind === ts.SyntaxKind.NullKeyword) return self.emitConstant(ConstantKind.Null, null);
  if (expr.kind === ts.SyntaxKind.TrueKeyword) return self.emitConstant(ConstantKind.Boolean, true);
  if (expr.kind === ts.SyntaxKind.FalseKeyword) return self.emitConstant(ConstantKind.Boolean, false);
  if (expr.kind === ts.SyntaxKind.ThisKeyword) {
    if (ts.isArrowFunction(self.node) && (self.scope.has(LEXICAL_THIS_CAPTURE) || self.outerCaptureBindings.has(LEXICAL_THIS_CAPTURE))) {
      return self.resolveLexicalCapture(
        LEXICAL_THIS_CAPTURE,
        expr,
        'lexical this in arrow function requires an enclosing function context',
      );
    }
    const thisReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
    return thisReg;
  }
  if (ts.isMetaProperty(expr)) {
    if (expr.keywordToken === ts.SyntaxKind.NewKeyword && expr.name.text === 'target') {
      if (
        ts.isArrowFunction(self.node) &&
        (self.scope.has(LEXICAL_NEW_TARGET_CAPTURE) || self.outerCaptureBindings.has(LEXICAL_NEW_TARGET_CAPTURE))
      ) {
        return self.resolveLexicalCapture(
          LEXICAL_NEW_TARGET_CAPTURE,
          expr,
          'lexical new.target in arrow function requires an enclosing function context',
        );
      }
      const newTargetReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(OpCode.LoadNewTarget, [], newTargetReg);
      return newTargetReg;
    }
    self.failUnsupported(expr, 'meta property is not supported');
  }

  if (ts.isIdentifier(expr)) {
    return self.resolveVar(expr.text);
  }

  if (ts.isConditionalExpression(expr)) {
    const conditionReg = visitExpression(self, expr.condition);
    return lowerConditionalExpression(
      self,
      conditionReg,
      () => visitExpression(self, expr.whenTrue),
      () => visitExpression(self, expr.whenFalse),
    );
  }

  if (ts.isBinaryExpression(expr)) {
    if (expr.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      visitExpression(self, expr.left);
      return visitExpression(self, expr.right);
    }
    if (
      expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      expr.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const leftReg = visitExpression(self, expr.left);
      if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
        return lowerConditionalExpression(
          self,
          leftReg,
          () => visitExpression(self, expr.right),
          () => leftReg,
        );
      }
      if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
        return lowerConditionalExpression(
          self,
          leftReg,
          () => leftReg,
          () => visitExpression(self, expr.right),
        );
      }
      return lowerNullishCoalesce(self, leftReg, expr.right);
    }
    if (expr.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const valueReg = visitExpression(self, expr.right);
      self.storeValue(expr.left, valueReg);
      return valueReg;
    }

    if (expr.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken) {
      const leftReg = visitExpression(self, expr.left);
      return lowerConditionalExpression(
        self,
        leftReg,
        () => leftReg,
        () => {
          const rightReg = visitExpression(self, expr.right);
          self.storeValue(expr.left, rightReg);
          return rightReg;
        },
      );
    }
    if (expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandEqualsToken) {
      const leftReg = visitExpression(self, expr.left);
      return lowerConditionalExpression(
        self,
        leftReg,
        () => {
          const rightReg = visitExpression(self, expr.right);
          self.storeValue(expr.left, rightReg);
          return rightReg;
        },
        () => leftReg,
      );
    }
    if (expr.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken) {
      const leftReg = visitExpression(self, expr.left);
      const tempReg = self.createTempLocal('qq_eq');
      self.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: tempReg },
        { kind: OperandKind.Register, value: leftReg },
      ]);
      const nullConst = self.emitConstant(ConstantKind.Null, null);
      const undefConst = self.emitConstant(ConstantKind.Undefined, null);
      const isNullReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.StrictEq,
        [
          { kind: OperandKind.Register, value: leftReg },
          { kind: OperandKind.Register, value: nullConst },
        ],
        isNullReg,
      );
      const rhsBlock = self.fnBuilder.createBlock('qq_eq_rhs');
      const undefCheckBlock = self.fnBuilder.createBlock('qq_eq_undef');
      const endBlock = self.fnBuilder.createBlock('qq_eq_end');
      rhsBlock.addPredecessor(self.currentBlock.id);
      undefCheckBlock.addPredecessor(self.currentBlock.id);
      self.currentBlock.setTerminator({ kind: 'branch', condition: isNullReg, targets: [rhsBlock.id, undefCheckBlock.id] });
      self.fnBuilder.addBlock(self.currentBlock.build());
      self.currentBlock = undefCheckBlock;
      const isUndefReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.StrictEq,
        [
          { kind: OperandKind.Register, value: self.loadFromLocal(tempReg) },
          { kind: OperandKind.Register, value: undefConst },
        ],
        isUndefReg,
      );
      rhsBlock.addPredecessor(self.currentBlock.id);
      endBlock.addPredecessor(self.currentBlock.id);
      self.currentBlock.setTerminator({ kind: 'branch', condition: isUndefReg, targets: [rhsBlock.id, endBlock.id] });
      self.fnBuilder.addBlock(self.currentBlock.build());
      self.currentBlock = rhsBlock;
      const rightReg = visitExpression(self, expr.right);
      self.storeValue(expr.left, rightReg);
      self.currentBlock.addInstruction(OpCode.StoreLocal, [
        { kind: OperandKind.Register, value: tempReg },
        { kind: OperandKind.Register, value: rightReg },
      ]);
      self.currentBlock.setTerminator({ kind: 'jump', targets: [endBlock.id] });
      endBlock.addPredecessor(self.currentBlock.id);
      self.fnBuilder.addBlock(self.currentBlock.build());
      self.currentBlock = endBlock;
      return self.loadFromLocal(tempReg);
    }

    if (expr.operatorToken.kind === ts.SyntaxKind.InKeyword && ts.isPrivateIdentifier(expr.left)) {
      const leftReg = self.resolvePrivateIdentifierRegister(expr.left);
      const rightReg = visitExpression(self, expr.right);
      const resReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.PrivateIn,
        [
          { kind: OperandKind.Register, value: rightReg },
          { kind: OperandKind.Register, value: leftReg },
        ],
        resReg,
      );
      return resReg;
    }

    const leftReg = visitExpression(self, expr.left);
    const rightReg = visitExpression(self, expr.right);
    const resReg = self.fnBuilder.allocRegister();

    if (expr.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken) {
      const mathGlobalReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.LoadGlobal,
        [{ kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'Math') }],
        mathGlobalReg,
      );
      self.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: mathGlobalReg },
          { kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'pow') },
          { kind: OperandKind.Register, value: leftReg },
          { kind: OperandKind.Register, value: rightReg },
        ],
        resReg,
      );
      return resReg;
    }

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
      [ts.SyntaxKind.ExclamationEqualsToken]: OpCode.Eq,
      [ts.SyntaxKind.ExclamationEqualsEqualsToken]: OpCode.StrictEq,
      [ts.SyntaxKind.InKeyword]: OpCode.In,
      [ts.SyntaxKind.InstanceOfKeyword]: OpCode.InstanceOf,
    };

    if (expr.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken) {
      const leftValueReg = self.readValue(expr.left);
      const mathGlobalReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.LoadGlobal,
        [{ kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'Math') }],
        mathGlobalReg,
      );
      self.currentBlock.addInstruction(
        OpCode.CallMethod,
        [
          { kind: OperandKind.Register, value: mathGlobalReg },
          { kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'pow') },
          { kind: OperandKind.Register, value: leftValueReg },
          { kind: OperandKind.Register, value: rightReg },
        ],
        resReg,
      );
      self.storeValue(expr.left, resReg);
      return resReg;
    }

    const isCompound =
      expr.operatorToken.kind >= ts.SyntaxKind.PlusEqualsToken && expr.operatorToken.kind <= ts.SyntaxKind.CaretEqualsToken;
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
      const leftValueReg = self.readValue(expr.left);
      self.currentBlock.addInstruction(
        opc,
        [
          { kind: OperandKind.Register, value: leftValueReg },
          { kind: OperandKind.Register, value: rightReg },
        ],
        resReg,
      );
      self.storeValue(expr.left, resReg);
      return resReg;
    }

    if (opMap[expr.operatorToken.kind]) {
      self.currentBlock.addInstruction(
        opMap[expr.operatorToken.kind]!,
        [
          { kind: OperandKind.Register, value: leftReg },
          { kind: OperandKind.Register, value: rightReg },
        ],
        resReg,
      );

      if (
        expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
        expr.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
      ) {
        const notReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: resReg }], notReg);
        return notReg;
      }

      return resReg;
    }
  }

  if (ts.isPropertyAccessExpression(expr)) {
    if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const propReg = self.emitConstant(ConstantKind.String, expr.name.text);
      const resReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], resReg);
      return resReg;
    }

    const objReg = visitExpression(self, expr.expression);
    if (expr.questionDotToken) {
      return lowerOptionalChain(self, objReg, () => {
        const resReg = self.fnBuilder.allocRegister();
        if (ts.isPrivateIdentifier(expr.name)) {
          const privateKeyReg = self.resolvePrivateIdentifierRegister(expr.name);
          self.currentBlock.addInstruction(
            OpCode.PrivateGet,
            [
              { kind: OperandKind.Register, value: objReg },
              { kind: OperandKind.Register, value: privateKeyReg },
            ],
            resReg,
          );
          return resReg;
        }
        const propReg = self.emitConstant(ConstantKind.String, expr.name.text);
        self.currentBlock.addInstruction(
          OpCode.PropGet,
          [
            { kind: OperandKind.Register, value: objReg },
            { kind: OperandKind.Register, value: propReg },
          ],
          resReg,
        );
        return resReg;
      });
    }
    const resReg = self.fnBuilder.allocRegister();
    if (ts.isPrivateIdentifier(expr.name)) {
      const privateKeyReg = self.resolvePrivateIdentifierRegister(expr.name);
      self.currentBlock.addInstruction(
        OpCode.PrivateGet,
        [
          { kind: OperandKind.Register, value: objReg },
          { kind: OperandKind.Register, value: privateKeyReg },
        ],
        resReg,
      );
      return resReg;
    }
    const propReg = self.emitConstant(ConstantKind.String, expr.name.text);
    self.currentBlock.addInstruction(
      OpCode.PropGet,
      [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: propReg },
      ],
      resReg,
    );
    return resReg;
  }

  if (ts.isElementAccessExpression(expr)) {
    if (!expr.argumentExpression) {
      self.failUnsupported(expr, 'Element access requires an index expression');
    }
    const objReg = visitExpression(self, expr.expression);
    if (expr.questionDotToken) {
      return lowerOptionalChain(self, objReg, () => {
        const indexReg = visitExpression(self, expr.argumentExpression!);
        const resReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(
          OpCode.ComputedGet,
          [
            { kind: OperandKind.Register, value: objReg },
            { kind: OperandKind.Register, value: indexReg },
          ],
          resReg,
        );
        return resReg;
      });
    }
    const indexReg = visitExpression(self, expr.argumentExpression);
    const resReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(
      OpCode.ComputedGet,
      [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: indexReg },
      ],
      resReg,
    );
    return resReg;
  }

  if (ts.isArrayLiteralExpression(expr)) {
    const arrayReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.ArrayNew, [], arrayReg);
    const indexLocal = self.createTempLocal('array_index');
    const zeroReg = self.emitConstant(ConstantKind.Number, 0);
    const oneReg = self.emitConstant(ConstantKind.Number, 1);
    const lengthKeyReg = self.emitConstant(ConstantKind.String, 'length');
    self.storeToLocal(indexLocal, zeroReg);

    expr.elements.forEach((element) => {
      if (ts.isOmittedExpression(element)) {
        const currentIndexReg = self.loadFromLocal(indexLocal);
        const nextIndexReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(
          OpCode.Add,
          [
            { kind: OperandKind.Register, value: currentIndexReg },
            { kind: OperandKind.Register, value: oneReg },
          ],
          nextIndexReg,
        );
        self.storeToLocal(indexLocal, nextIndexReg);
        return;
      }
      if (ts.isSpreadElement(element)) {
        const currentIndexReg = self.loadFromLocal(indexLocal);
        const spreadReg = visitExpression(self, element.expression);
        self.emitSpreadIntoArray(arrayReg, spreadReg, currentIndexReg, indexLocal);
        return;
      }
      const currentIndexReg = self.loadFromLocal(indexLocal);
      const valueReg = visitExpression(self, element);
      self.currentBlock.addInstruction(OpCode.ComputedSet, [
        { kind: OperandKind.Register, value: arrayReg },
        { kind: OperandKind.Register, value: currentIndexReg },
        { kind: OperandKind.Register, value: valueReg },
      ]);
      const nextIndexReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.Add,
        [
          { kind: OperandKind.Register, value: currentIndexReg },
          { kind: OperandKind.Register, value: oneReg },
        ],
        nextIndexReg,
      );
      self.storeToLocal(indexLocal, nextIndexReg);
    });

    const finalLengthReg = self.loadFromLocal(indexLocal);
    self.currentBlock.addInstruction(OpCode.PropSet, [
      { kind: OperandKind.Register, value: arrayReg },
      { kind: OperandKind.Register, value: lengthKeyReg },
      { kind: OperandKind.Register, value: finalLengthReg },
    ]);

    return arrayReg;
  }

  if (ts.isObjectLiteralExpression(expr)) {
    const objectReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.ObjectNew, [], objectReg);

    for (const property of expr.properties) {
      if (ts.isPropertyAssignment(property)) {
        const valueReg = visitExpression(self, property.initializer);
        if (ts.isComputedPropertyName(property.name)) {
          const nameReg = visitExpression(self, property.name.expression);
          self.emitObjectPropertyAssignment(objectReg, nameReg, valueReg, true);
        } else {
          const propName = self.getPropertyNameText(property.name);
          const nameReg = self.emitConstant(ConstantKind.String, propName);
          self.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
        }
        continue;
      }

      if (ts.isShorthandPropertyAssignment(property)) {
        const nameReg = self.emitConstant(ConstantKind.String, property.name.text);
        const valueReg = self.resolveVar(property.name.text);
        self.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
        continue;
      }

      if (ts.isMethodDeclaration(property)) {
        const valueReg = lowerNestedFunctionNode(self, property);
        if (ts.isComputedPropertyName(property.name)) {
          const nameReg = visitExpression(self, property.name.expression);
          self.emitObjectPropertyAssignment(objectReg, nameReg, valueReg, true);
        } else {
          const nameReg = self.emitConstant(ConstantKind.String, self.getPropertyNameText(property.name));
          self.emitObjectPropertyAssignment(objectReg, nameReg, valueReg);
        }
        continue;
      }

      if (ts.isSpreadAssignment(property)) {
        const valueReg = visitExpression(self, property.expression);
        self.emitSpreadInto(objectReg, valueReg);
        continue;
      }

      if (ts.isGetAccessor(property) || ts.isSetAccessor(property)) {
        const valueReg = lowerNestedFunctionNode(self, property);
        const nameReg = ts.isComputedPropertyName(property.name)
          ? visitExpression(self, property.name.expression)
          : self.emitConstant(ConstantKind.String, self.getPropertyNameText(property.name));

        const objectGlobalReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(
          OpCode.LoadGlobal,
          [{ kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'Object') }],
          objectGlobalReg,
        );

        const descriptorReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(OpCode.ObjectNew, [], descriptorReg);

        const getPropReg = self.emitConstant(ConstantKind.String, ts.isGetAccessor(property) ? 'get' : 'set');
        self.emitObjectPropertyAssignment(descriptorReg, getPropReg, valueReg);

        const trueReg = self.emitConstant(ConstantKind.Boolean, true);
        self.emitObjectPropertyAssignment(descriptorReg, self.emitConstant(ConstantKind.String, 'configurable'), trueReg);
        self.emitObjectPropertyAssignment(descriptorReg, self.emitConstant(ConstantKind.String, 'enumerable'), trueReg);

        self.currentBlock.addInstruction(
          OpCode.CallMethod,
          [
            { kind: OperandKind.Register, value: objectGlobalReg },
            { kind: OperandKind.Register, value: self.emitConstant(ConstantKind.String, 'defineProperty') },
            { kind: OperandKind.Register, value: objectReg },
            { kind: OperandKind.Register, value: nameReg },
            { kind: OperandKind.Register, value: descriptorReg },
          ],
          self.fnBuilder.allocRegister(),
        );
        continue;
      }

      self.failUnsupported(property, 'Unsupported object literal property kind');
    }

    return objectReg;
  }

  if (ts.isCallExpression(expr)) {
    const hasSpread = expr.arguments.some((arg) => ts.isSpreadElement(arg));
    if (expr.questionDotToken) {
      const calleeReg = visitExpression(self, expr.expression);
      return lowerOptionalChain(self, calleeReg, () => {
        const resReg = self.fnBuilder.allocRegister();
        if (hasSpread) {
          const argArrayReg = self.materializeArgumentArray(expr.arguments);
          self.currentBlock.addInstruction(
            OpCode.CallWithArray,
            [
              { kind: OperandKind.Register, value: calleeReg },
              { kind: OperandKind.Register, value: argArrayReg },
            ],
            resReg,
          );
        } else {
          const args = expr.arguments.map((a) => visitExpression(self, a));
          const ops: Operand[] = [
            { kind: OperandKind.Register, value: calleeReg },
            ...args.map((a) => ({ kind: OperandKind.Register, value: a }) as Operand),
          ];
          self.currentBlock.addInstruction(OpCode.Call, ops, resReg);
        }
        return resReg;
      });
    }
    const resReg = self.fnBuilder.allocRegister();
    if (hasSpread) {
      const argArrayReg = self.materializeArgumentArray(expr.arguments);
      if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
        self.currentBlock.addInstruction(OpCode.SuperCallWithArray, [{ kind: OperandKind.Register, value: argArrayReg }], resReg);
        if (self.instanceFieldsToInitialize) {
          self.emitInstanceFieldInitializers(self.instanceFieldsToInitialize);
        }
        return resReg;
      }
      if (ts.isPropertyAccessExpression(expr.expression)) {
        if (expr.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
          const propReg = self.emitConstant(ConstantKind.String, expr.expression.name.text);
          const fnReg = self.fnBuilder.allocRegister();
          self.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], fnReg);
          const applyReg = self.emitConstant(ConstantKind.String, 'apply');
          const thisReg = self.fnBuilder.allocRegister();
          self.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
          self.currentBlock.addInstruction(
            OpCode.CallMethod,
            [
              { kind: OperandKind.Register, value: fnReg },
              { kind: OperandKind.Register, value: applyReg },
              { kind: OperandKind.Register, value: thisReg },
              { kind: OperandKind.Register, value: argArrayReg },
            ],
            resReg,
          );
          return resReg;
        }
        const objReg = visitExpression(self, expr.expression.expression);
        const propReg = self.emitConstant(ConstantKind.String, expr.expression.name.text);
        self.currentBlock.addInstruction(
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
      const calleeReg = visitExpression(self, expr.expression);
      self.currentBlock.addInstruction(
        OpCode.CallWithArray,
        [
          { kind: OperandKind.Register, value: calleeReg },
          { kind: OperandKind.Register, value: argArrayReg },
        ],
        resReg,
      );
      return resReg;
    }
    const args = expr.arguments.map((a) => visitExpression(self, a));

    if (expr.expression.kind === ts.SyntaxKind.SuperKeyword) {
      const ops: Operand[] = args.map((a) => ({ kind: OperandKind.Register, value: a }) as Operand);
      self.currentBlock.addInstruction(OpCode.SuperCall, ops, resReg);
      if (self.instanceFieldsToInitialize) {
        self.emitInstanceFieldInitializers(self.instanceFieldsToInitialize);
      }
      return resReg;
    }

    if (ts.isPropertyAccessExpression(expr.expression)) {
      if (expr.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const propReg = self.emitConstant(ConstantKind.String, expr.expression.name.text);
        const fnReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(OpCode.SuperPropGet, [{ kind: OperandKind.Register, value: propReg }], fnReg);
        const callReg = self.emitConstant(ConstantKind.String, 'call');
        const thisReg = self.fnBuilder.allocRegister();
        self.currentBlock.addInstruction(OpCode.LoadThis, [], thisReg);
        const ops: Operand[] = [
          { kind: OperandKind.Register, value: fnReg },
          { kind: OperandKind.Register, value: callReg },
          { kind: OperandKind.Register, value: thisReg },
          ...args.map((a) => ({ kind: OperandKind.Register, value: a }) as Operand),
        ];
        self.currentBlock.addInstruction(OpCode.CallMethod, ops, resReg);
        return resReg;
      }
      const objReg = visitExpression(self, expr.expression.expression);
      const propReg = self.emitConstant(ConstantKind.String, expr.expression.name.text);
      const ops: Operand[] = [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: propReg },
        ...args.map((a) => ({ kind: OperandKind.Register, value: a }) as Operand),
      ];
      self.currentBlock.addInstruction(OpCode.CallMethod, ops, resReg);
    } else {
      const calleeReg = visitExpression(self, expr.expression);
      const ops: Operand[] = [
        { kind: OperandKind.Register, value: calleeReg },
        ...args.map((a) => ({ kind: OperandKind.Register, value: a }) as Operand),
      ];
      self.currentBlock.addInstruction(OpCode.Call, ops, resReg);
    }
    return resReg;
  }

  if (ts.isNewExpression(expr)) {
    const calleeReg = visitExpression(self, expr.expression);
    const resReg = self.fnBuilder.allocRegister();
    const argsList = expr.arguments ? [...expr.arguments] : [];
    if (argsList.some((arg) => ts.isSpreadElement(arg))) {
      const argArrayReg = self.materializeArgumentArray(argsList);
      self.currentBlock.addInstruction(
        OpCode.NewWithArray,
        [
          { kind: OperandKind.Register, value: calleeReg },
          { kind: OperandKind.Register, value: argArrayReg },
        ],
        resReg,
      );
      return resReg;
    }
    const args = argsList.map((arg) => visitExpression(self, arg));
    const ops: Operand[] = [
      { kind: OperandKind.Register, value: calleeReg },
      ...args.map((arg) => ({ kind: OperandKind.Register, value: arg }) as Operand),
    ];
    self.currentBlock.addInstruction(OpCode.New, ops, resReg);
    return resReg;
  }

  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    return lowerNestedFunctionNode(self, expr);
  }

  if (ts.isClassExpression(expr)) {
    return self.lowerClassLike(expr, expr.name?.text);
  }

  if (ts.isPostfixUnaryExpression(expr)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const vReg = self.readValue(expr.operand);
      const oneReg = self.emitConstant(ConstantKind.Number, 1);
      const resReg = self.fnBuilder.allocRegister();
      const op = expr.operator === ts.SyntaxKind.PlusPlusToken ? OpCode.Add : OpCode.Sub;
      self.currentBlock.addInstruction(
        op,
        [
          { kind: OperandKind.Register, value: vReg },
          { kind: OperandKind.Register, value: oneReg },
        ],
        resReg,
      );
      self.storeValue(expr.operand, resReg);
      return vReg;
    }
  }

  if (ts.isPrefixUnaryExpression(expr)) {
    if (expr.operator === ts.SyntaxKind.PlusPlusToken || expr.operator === ts.SyntaxKind.MinusMinusToken) {
      const vReg = self.readValue(expr.operand);
      const oneReg = self.emitConstant(ConstantKind.Number, 1);
      const resReg = self.fnBuilder.allocRegister();
      const op = expr.operator === ts.SyntaxKind.PlusPlusToken ? OpCode.Add : OpCode.Sub;
      self.currentBlock.addInstruction(
        op,
        [
          { kind: OperandKind.Register, value: vReg },
          { kind: OperandKind.Register, value: oneReg },
        ],
        resReg,
      );
      self.storeValue(expr.operand, resReg);
      return resReg;
    }

    const operandReg = visitExpression(self, expr.operand);
    const resReg = self.fnBuilder.allocRegister();
    if (expr.operator === ts.SyntaxKind.ExclamationToken) {
      self.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: operandReg }], resReg);
    } else if (expr.operator === ts.SyntaxKind.MinusToken) {
      self.currentBlock.addInstruction(OpCode.Neg, [{ kind: OperandKind.Register, value: operandReg }], resReg);
    } else if (expr.operator === ts.SyntaxKind.TildeToken) {
      const notReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(OpCode.Not, [{ kind: OperandKind.Register, value: operandReg }], notReg);
      self.currentBlock.addInstruction(
        OpCode.BitXor,
        [
          { kind: OperandKind.Register, value: operandReg },
          { kind: OperandKind.Register, value: notReg },
        ],
        resReg,
      );
    } else {
      self.failUnsupported(expr, 'Unsupported prefix unary operator');
    }
    return resReg;
  }

  if (ts.isTypeOfExpression(expr)) {
    const operandReg = visitExpression(self, expr.expression);
    const resReg = self.fnBuilder.allocRegister();
    self.currentBlock.addInstruction(OpCode.TypeOf, [{ kind: OperandKind.Register, value: operandReg }], resReg);
    return resReg;
  }

  if (ts.isVoidExpression(expr)) {
    visitExpression(self, expr.expression);
    return self.emitConstant(ConstantKind.Undefined, null);
  }

  if (ts.isDeleteExpression(expr)) {
    if (ts.isPropertyAccessExpression(expr.expression)) {
      const objReg = visitExpression(self, expr.expression.expression);
      const propReg = self.emitConstant(ConstantKind.String, expr.expression.name.text);
      const resReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(OpCode.Delete, [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: propReg },
      ]);
      self.currentBlock.addInstruction(
        OpCode.LoadConst,
        [{ kind: OperandKind.ConstantIndex, value: self.modBuilder.addConstant(ConstantKind.Boolean, true) }],
        resReg,
      );
      return resReg;
    }
    if (ts.isElementAccessExpression(expr.expression)) {
      if (!expr.expression.argumentExpression) {
        self.failUnsupported(expr.expression, 'Element access requires an index expression');
      }
      const objReg = visitExpression(self, expr.expression.expression);
      const propReg = visitExpression(self, expr.expression.argumentExpression);
      const resReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(OpCode.Delete, [
        { kind: OperandKind.Register, value: objReg },
        { kind: OperandKind.Register, value: propReg },
      ]);
      self.currentBlock.addInstruction(
        OpCode.LoadConst,
        [{ kind: OperandKind.ConstantIndex, value: self.modBuilder.addConstant(ConstantKind.Boolean, true) }],
        resReg,
      );
      return resReg;
    }
    if (ts.isIdentifier(expr.expression)) {
      visitExpression(self, expr.expression);
      const resReg = self.fnBuilder.allocRegister();
      self.currentBlock.addInstruction(
        OpCode.LoadConst,
        [{ kind: OperandKind.ConstantIndex, value: self.modBuilder.addConstant(ConstantKind.Boolean, true) }],
        resReg,
      );
      return resReg;
    }
    self.failUnsupported(expr, 'Unsupported delete target');
  }

  self.failUnsupported(expr);
}
