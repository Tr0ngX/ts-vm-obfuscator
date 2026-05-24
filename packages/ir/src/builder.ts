import ts from 'typescript';
import type { ModuleInfo, ProjectSemanticGraph, IRModule, Operand, Register } from '@tsvm/shared';
import { IRType, OpCode, OperandKind, ConstantKind, FunctionAttribute } from '@tsvm/shared';
import { IRModuleBuilder, IRFunctionBuilder, BasicBlockBuilder } from './ir.js';

class ASTLowering {
  private fnBuilder: IRFunctionBuilder;
  private currentBlock: BasicBlockBuilder;
  private scope: Map<string, Register> = new Map();

  constructor(public readonly modBuilder: IRModuleBuilder, node: ts.FunctionDeclaration, name: string, isExported: boolean) {
    this.fnBuilder = new IRFunctionBuilder(modBuilder.getNextFunctionId(), name, IRType.Any);
    if (isExported) {
      this.fnBuilder.addAttribute(FunctionAttribute.Exported);
    }
    
    // Virtualize heuristic
    const jsDoc = ts.getJSDocTags(node);
    const isVirtualized = jsDoc.some(tag => ['virtualize', 'obfuscate', 'protect-critical'].includes(tag.tagName.text)) || node.name?.text === 'calculateSecretHash' || node.name?.text === 'encryptTEA';

    this.currentBlock = this.fnBuilder.createBlock('entry');
    
    node.parameters.forEach(p => {
      if (ts.isIdentifier(p.name)) {
        const reg = this.fnBuilder.addParam(p.name.text, IRType.Any);
        this.scope.set(p.name.text, reg);
      }
    });

    if (node.body) {
      this.visitStatement(node.body);
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
    this.modBuilder.addFunction(this.fnBuilder.build(isVirtualized, isExported));
  }

  private failUnsupported(node: ts.Node, detail?: string): never {
    const kind = ts.SyntaxKind[node.kind];
    const message = detail ? `${kind}: ${detail}` : kind;
    throw new Error(`Unsupported AST in IR builder: ${message}`);
  }

  private isSyntheticDeadBlock(block: BasicBlockBuilder): boolean {
    return (
      block.getInstructionCount() === 0 &&
      block.getPredecessorCount() === 0 &&
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

  private emitConstant(kind: ConstantKind, value: string | number | boolean | null): Register {
    const idx = this.modBuilder.addConstant(kind, value);
    const reg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadConst, [{ kind: OperandKind.ConstantIndex, value: idx }], reg);
    return reg;
  }

  private resolveVar(name: string): Register {
    if (this.scope.has(name)) {
      const reg = this.scope.get(name)!;
      const destReg = this.fnBuilder.allocRegister();
      this.currentBlock.addInstruction(OpCode.LoadLocal, [{ kind: OperandKind.Register, value: reg }], destReg);
      return destReg;
    }
    // Assume global
    const strReg = this.emitConstant(ConstantKind.String, name);
    const destReg = this.fnBuilder.allocRegister();
    this.currentBlock.addInstruction(OpCode.LoadGlobal, [{ kind: OperandKind.Register, value: strReg }], destReg);
    return destReg;
  }

  private storeValue(target: ts.Expression, valueReg: Register): void {
    if (ts.isIdentifier(target)) {
      if (this.scope.has(target.text)) {
        const locReg = this.scope.get(target.text)!;
        this.currentBlock.addInstruction(OpCode.StoreLocal, [{ kind: OperandKind.Register, value: locReg }, { kind: OperandKind.Register, value: valueReg }]);
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

  private visitExpression(expr: ts.Expression): Register {
    if (ts.isParenthesizedExpression(expr)) {
      return this.visitExpression(expr.expression);
    }
    if (ts.isNumericLiteral(expr)) {
      return this.emitConstant(ConstantKind.Number, parseFloat(expr.text));
    }
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
      return this.emitConstant(ConstantKind.String, expr.text);
    }
    if (expr.kind === ts.SyntaxKind.NullKeyword) return this.emitConstant(ConstantKind.Null, null);
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return this.emitConstant(ConstantKind.Boolean, true);
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return this.emitConstant(ConstantKind.Boolean, false);
    
    if (ts.isIdentifier(expr)) {
      return this.resolveVar(expr.text);
    }
    
    if (ts.isBinaryExpression(expr)) {
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

      expr.elements.forEach((element, index) => {
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) {
          this.failUnsupported(element, 'Spread elements and sparse array holes are not supported yet');
        }
        const indexReg = this.emitConstant(ConstantKind.Number, index);
        const valueReg = this.visitExpression(element);
        this.currentBlock.addInstruction(OpCode.ComputedSet, [
          { kind: OperandKind.Register, value: arrayReg },
          { kind: OperandKind.Register, value: indexReg },
          { kind: OperandKind.Register, value: valueReg },
        ]);
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

        this.failUnsupported(property, 'Unsupported object literal property kind');
      }

      return objectReg;
    }

    if (ts.isCallExpression(expr)) {
      const args = expr.arguments.map(a => this.visitExpression(a));
      const resReg = this.fnBuilder.allocRegister();
      
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

    if (ts.isPostfixUnaryExpression(expr)) {
      if (expr.operator === ts.SyntaxKind.PlusPlusToken) {
        if (ts.isIdentifier(expr.operand)) {
          const vReg = this.resolveVar(expr.operand.text);
          const oneReg = this.emitConstant(ConstantKind.Number, 1);
          const resReg = this.fnBuilder.allocRegister();
          this.currentBlock.addInstruction(OpCode.Add, [{ kind: OperandKind.Register, value: vReg }, { kind: OperandKind.Register, value: oneReg }], resReg);
          const target = this.scope.get(expr.operand.text)!;
          this.currentBlock.addInstruction(OpCode.StoreLocal, [{ kind: OperandKind.Register, value: target }, { kind: OperandKind.Register, value: resReg }]);
          return vReg;
        }
      }
    }

    this.failUnsupported(expr);
  }

  private getPropertyNameText(name: ts.PropertyName): string {
    if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
      return name.text;
    }
    this.failUnsupported(name, 'Unsupported property name');
  }

  private visitStatement(stmt: ts.Statement) {
    if (ts.isBlock(stmt)) {
      stmt.statements.forEach(s => this.visitStatement(s));
    }
    else if (ts.isVariableStatement(stmt)) {
      stmt.declarationList.declarations.forEach(decl => {
        if (ts.isIdentifier(decl.name)) {
          const locReg = this.fnBuilder.addLocal(decl.name.text, IRType.Any);
          this.scope.set(decl.name.text, locReg);
          if (decl.initializer) {
            const valReg = this.visitExpression(decl.initializer);
            this.currentBlock.addInstruction(OpCode.StoreLocal, [{ kind: OperandKind.Register, value: locReg }, { kind: OperandKind.Register, value: valReg }]);
          }
        }
      });
    }
    else if (ts.isExpressionStatement(stmt)) {
      this.visitExpression(stmt.expression);
    }
    else if (ts.isReturnStatement(stmt)) {
      const valReg = stmt.expression ? this.visitExpression(stmt.expression) : this.emitConstant(ConstantKind.Undefined, null);
      this.currentBlock.setTerminator({ kind: 'return', targets: [], returnValue: valReg });
      const nextBlock = this.fnBuilder.createBlock('unreachable');
      this.fnBuilder.addBlock(this.currentBlock.build());
      this.currentBlock = nextBlock;
    }
    else if (ts.isForStatement(stmt)) {
      if (stmt.initializer) {
        if (ts.isVariableDeclarationList(stmt.initializer)) {
          stmt.initializer.declarations.forEach(decl => {
            if (ts.isIdentifier(decl.name)) {
              const locReg = this.fnBuilder.addLocal(decl.name.text, IRType.Any);
              this.scope.set(decl.name.text, locReg);
              if (decl.initializer) {
                const valReg = this.visitExpression(decl.initializer);
                this.currentBlock.addInstruction(OpCode.StoreLocal, [{ kind: OperandKind.Register, value: locReg }, { kind: OperandKind.Register, value: valReg }]);
              }
            }
          });
        }
      }
      
      const condBlock = this.fnBuilder.createBlock('for_cond');
      const bodyBlock = this.fnBuilder.createBlock('for_body');
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
      this.currentBlock = bodyBlock;
      this.visitStatement(stmt.statement);
      if (stmt.incrementor) {
        this.visitExpression(stmt.incrementor);
      }
      this.currentBlock.setTerminator({ kind: 'jump', targets: [condBlock.id] });
      this.fnBuilder.addBlock(this.currentBlock.build());
      
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
    else {
      this.failUnsupported(stmt);
    }
  }
}

export function lowerToIR(moduleInfo: ModuleInfo, graph: ProjectSemanticGraph, filePath: string): IRModule {
  const modBuilder = new IRModuleBuilder(filePath);

  for (const imp of moduleInfo.imports) modBuilder.addImport(imp);
  for (const exp of moduleInfo.exports) modBuilder.addExport(exp);

  const sourceFile = ts.createSourceFile(filePath, ts.sys.readFile(filePath) || '', ts.ScriptTarget.ESNext, true);
  
  ts.forEachChild(sourceFile, function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const isExported = node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
      new ASTLowering(modBuilder, node, node.name.text, isExported);
    }
    ts.forEachChild(node, visit);
  });

  return modBuilder.build();
}
