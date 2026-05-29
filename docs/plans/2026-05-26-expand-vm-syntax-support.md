# Expand VM Syntax Support (Object Literals and Async/Await) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Provide full VM support for all object literal property forms (including computed properties in object destructuring/binding patterns) and all async/await control flows (including `for await...of` loops).

**Architecture:** Extend the TSXobf AST-to-IR builder in `packages/ir/src/builder.ts` to support computed property keys in both variable destructuring (binding patterns) and assignment destructuring (object patterns). Expand `ForOfStatement` lowering to dynamically resolve `Symbol.asyncIterator` and inject `Await` instructions for async loops.

**Tech Stack:** TypeScript Compiler API, VM Bytecode/OpCodes.

---

### Task 1: Support Computed Properties in Object Binding Patterns (Variable Declarations)

**Files:**
- Modify: `packages/ir/src/builder.ts:1493-1535`
- Test: `packages/ir/tests/builder.test.ts`

**Step 1: Write the failing test**

In `packages/ir/tests/builder.test.ts`, add a test case that compiles variable destructuring with computed keys:
```typescript
it('should compile object destructuring with computed property names', () => {
  const code = `
    const key = 'a';
    const { [key]: value } = { a: 42 };
  `;
  const module = compileSource(code);
  // Should successfully compile without throwing "Unsupported object binding property name"
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @tsvm/ir test`
Expected: FAIL with "Unsupported object binding property name"

**Step 3: Write minimal implementation**

In `packages/ir/src/builder.ts` (around line 1493), update `ts.isObjectBindingPattern` handling:
```typescript
    if (ts.isObjectBindingPattern(bindingName)) {
      let restElement: ts.BindingElement | undefined;
      const excludedKeys: Register[] = [];
      for (const element of bindingName.elements) {
        if (element.dotDotDotToken) {
          restElement = element;
          continue;
        }
        const propertyName = element.propertyName ?? element.name;
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @tsvm/ir test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ir/src/builder.ts packages/ir/tests/builder.test.ts
git commit -m "feat: support computed property names in object binding patterns"
```

---

### Task 2: Support Computed Properties in Object Assignment Destructuring

**Files:**
- Modify: `packages/ir/src/builder.ts:2710-2757`
- Test: `packages/ir/tests/builder.test.ts`

**Step 1: Write the failing test**

In `packages/ir/tests/builder.test.ts`, add a test case for assignment destructuring with computed keys:
```typescript
it('should compile object assignment destructuring with computed property names', () => {
  const code = `
    let value;
    const key = 'a';
    ({ [key]: value } = { a: 100 });
  `;
  const module = compileSource(code);
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @tsvm/ir test`
Expected: FAIL with "Unsupported object assignment target"

**Step 3: Write minimal implementation**

In `packages/ir/src/builder.ts` (around line 2710), update `storeObjectPattern`:
```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @tsvm/ir test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ir/src/builder.ts packages/ir/tests/builder.test.ts
git commit -m "feat: support computed property names in assignment destructuring"
```

---

### Task 3: Support `for await...of` Loops

**Files:**
- Modify: `packages/ir/src/builder.ts:2882-2950`
- Test: `packages/vm-runtime/tests/runtime.test.ts`

**Step 1: Write the failing test**

In `packages/vm-runtime/tests/runtime.test.ts`, add an integration test for `for await...of` execution inside the VM:
```typescript
it('should execute async for-await-of loops through the VM runtime', async () => {
  const code = `
    export async function testAsyncLoop(iterable: any) {
      let sum = 0;
      for await (const x of iterable) {
        sum += x;
      }
      return sum;
    }
  `;
  // Compile, run under VM, and verify it returns correct sum
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @tsvm/vm-runtime test`
Expected: FAIL with "Symbol.iterator is not a function" or compilation error.

**Step 3: Write minimal implementation**

In `packages/ir/src/builder.ts` (around line 2882), modify the `ts.isForOfStatement` handler to:
1. Dynamically resolve `Symbol.asyncIterator` when `stmt.awaitModifier` is present.
2. Call the generator/iterator `next()` and call `OpCode.Await` on its result if async.

```typescript
    else if (ts.isForOfStatement(stmt)) {
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
        this.currentBlock.addInstruction(
          OpCode.Await,
          [{ kind: OperandKind.Register, value: nextPromiseReg }],
          stepReg,
        );
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
      this.bindPattern(stmt.initializer.declarations[0].name, valueReg, 'declare');
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @tsvm/vm-runtime test`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/ir/src/builder.ts packages/vm-runtime/tests/runtime.test.ts
git commit -m "feat: support for await...of loops in VM runtime"
```

---

### Task 4: Complete End-To-End Integration and Docs

**Files:**
- Modify: `examples/basic-ts/src/index.ts`
- Modify: `test-pipeline.js`
- Modify: `docs/support-status.md`
- Modify: `docs/ast-support.md`

**Step 1: Write integration tests in basic-ts example**

Add complex computed property destructuring and `for await...of` loops to `examples/basic-ts/src/index.ts` with `@virtualize`.
Validate outputs in `test-pipeline.js`.

**Step 2: Run pipeline validation**

Run: `pnpm test`
Expected: PASS with all tests passing and perfect semantic equivalence!

**Step 3: Update Docs**

Update both support status tables in the documentation files to mark `Object property forms (computed keys in destructuring)` and `Async / Await (general, loops, for-await-of)` as **Fully Supported**.

**Step 4: Commit**

```bash
git add examples/basic-ts/src/index.ts test-pipeline.js docs/support-status.md docs/ast-support.md
git commit -m "docs & test: complete VM syntax expansion verification"
```
