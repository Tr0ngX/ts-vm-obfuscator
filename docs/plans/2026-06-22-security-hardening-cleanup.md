# TSXobf Security Hardening & Code Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 12 security, code-quality, and maintainability issues found across the TSXobf codebase, excluding the WASM backend simulator (kept as-is).

**Architecture:** Each task targets a specific file/package with minimal, focused changes. All fixes are backward-compatible — no public API changes. Each task ends with `pnpm typecheck` and `pnpm test` verification scoped to the affected package.

**Tech Stack:** TypeScript, Node.js, Vitest, pnpm workspace

## Global Constraints

- All generated runtime output (`polymorphic-builder.ts`) must not contain `require('vm')`, `console.log` DEBUG leaks, or unresolved placeholders
- No production code may have `@ts-nocheck` — replace with proper types
- Test files may retain `console.error` but must not dump to hardcoded paths
- Commits follow conventional commits (`fix:`, `refactor:`, `chore:`)
- Each task runs `pnpm typecheck` and `pnpm test` (or targeted test file) before committing

---

### Task 1: Remove `require('vm')` sandbox escape in generated runtime

**Files:**
- Modify: `packages/vm-runtime/src/polymorphic-builder.ts:1393-1419`

**Interfaces:**
- Consumes: `buildVMRuntime()` function signature in same file
- Produces: Generated source code without `require('vm')` block

- [ ] **Step 1: Read the current code**

```bash
code packages/vm-runtime/src/polymorphic-builder.ts
```

- [ ] **Step 2: Replace `require('vm')` block with safe intrinsic fallback only**

Replace lines 1393-1419 (the `cleanIntrinsics` IIFE) to remove `require('vm')` entirely. Keep only the DOM iframe approach as a single fallback, wrapped in try-catch. The new version must never use `vm.runInNewContext`.

```typescript
  // Grab clean intrinsics from a secure isolated context.
  // Uses iframe (browser) ONLY — require('vm') is deliberately excluded
  // due to known sandbox escape vulnerabilities (CVE-2023-37903, etc.).
  // For Node.js environments, pre-sealed intrinsics should be provided via config.
  var cleanIntrinsics = (function() {
    var win;
    try {
      if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        var iframe = document.createElement('iframe');
        iframe.style.display = 'none';
        document.documentElement.appendChild(iframe);
        win = iframe.contentWindow;
        try {
          if (iframe && iframe.parentNode) iframe.parentNode.removeChild(iframe);
        } catch(e) {}
      }
    } catch (e) {}
    return win || {};
  })();
```

- [ ] **Step 3: Run typecheck and tests for vm-runtime**

```bash
cd packages/vm-runtime && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/vm-runtime/src/polymorphic-builder.ts
git commit -m "fix: remove require('vm') sandbox escape vulnerability from generated runtime"
```

---

### Task 2: Remove `execSync` from namespace virtualization safe list

**Files:**
- Modify: `packages/transforms/src/passes/namespace-virtualization.ts:69`

**Interfaces:**
- Consumes: `NAMESPACE_VIRT_SAFE_GLOBALS` array in same file
- Produces: Updated safe list without `execSync`

- [ ] **Step 1: Read the safe list**

Read `packages/transforms/src/passes/namespace-virtualization.ts` lines 45-79.

- [ ] **Step 2: Remove `'execSync'` from the array**

Change:
```typescript
      'readFileSync', 'writeFileSync', 'readdirSync', 'statSync', 'execSync', 'mtime', 'getTime',
```
To:
```typescript
      'readFileSync', 'writeFileSync', 'readdirSync', 'statSync', 'mtime', 'getTime',
```

- [ ] **Step 3: Run typecheck and tests for transforms**

```bash
cd packages/transforms && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/transforms/src/passes/namespace-virtualization.ts
git commit -m "fix: remove execSync from namespace virtualization safe list to prevent RCE vector"
```

---

### Task 3: Guard/remove DEBUG `console.log` leaks in polymoprhic-builder runtime handlers

**Files:**
- Modify: `packages/vm-runtime/src/polymorphic-builder.ts:762-767` (LoadGlobal handler)
- Modify: `packages/vm-runtime/src/polymorphic-builder.ts:873-878` (Call handler)

**Interfaces:**
- Consumes: Handler declaration strings in `declareHandler()` calls
- Produces: Handler code without console.log DEBUG statements

- [ ] **Step 1: Remove DEBUG console.log from LoadGlobal handler**

Change lines 762-767:
```typescript
    if (false) {
      console.log("[DEBUG] LoadGlobal for:", propName);
      console.log("[DEBUG] globalScope exists:", !!${ctxRef('globalScope')});
      console.log("[DEBUG] globalScope[propName] is function:", typeof globalVal === 'function');
      console.log("[DEBUG] globalScope[propName] value:", globalVal);
    }
```
Remove entirely.

- [ ] **Step 2: Remove DEBUG console.log from Call handler**

Change lines 873-878:
```typescript
    if (typeof fn === 'undefined' || fn === null) {
      console.log("[DEBUG] OpCode.Call failed: fn is undefined!");
      console.log("[DEBUG] args[0] register index:", args[0]);
      console.log("[DEBUG] register values:", ctx.regs);
      console.log("[DEBUG] args array:", args);
    }
```
To just the null check without logging:
```typescript
    if (typeof fn === 'undefined' || fn === null) {
      throw new TypeError('VM Call target is undefined or null');
    }
```

- [ ] **Step 3: Run typecheck and tests**

```bash
cd packages/vm-runtime && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/vm-runtime/src/polymorphic-builder.ts
git commit -m "fix: remove DEBUG console.log leaks from generated VM runtime handlers"
```

---

### Task 4: Fix unresolved `__ADD_EXPR__`, `__AND_EXPR__`, `__OR_EXPR__`, `__XOR_EXPR__` placeholders

**Files:**
- Modify: `packages/vm-runtime/src/polymorphic-builder.ts:780, 787-789`

**Interfaces:**
- Consumes: Handler declarations in `declareHandler()` calls
- Produces: Proper JavaScript expressions replacing all `__*_EXPR__` placeholders

- [ ] **Step 1: Search for all `__*_EXPR__` placeholders**

Check which ones exist and whether they're replaced elsewhere in the builder pipeline. Look for string replacement logic.

```bash
rg '__[A-Z]+_EXPR__' packages/vm-runtime/src/
```

- [ ] **Step 2: Fix each placeholder**

Replace `__ADD_EXPR__` with actual expression `(ctx.regs[args[0]] + ctx.regs[args[1]])` in line 780.
Replace `__AND_EXPR__` with `(ctx.regs[args[0]] & ctx.regs[args[1]])` in line 787.
Replace `__OR_EXPR__` with `(ctx.regs[args[0]] | ctx.regs[args[1]])` in line 788.
Replace `__XOR_EXPR__` with `(ctx.regs[args[0]] ^ ctx.regs[args[1]])` in line 789.

- [ ] **Step 3: Run typecheck and tests**

```bash
cd packages/vm-runtime && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/vm-runtime/src/polymorphic-builder.ts
git commit -m "fix: resolve placeholder expressions __ADD_EXPR__, __AND_EXPR__, __OR_EXPR__, __XOR_EXPR__ in VM handlers"
```

---

### Task 5: Guard DEBUG console.log in react-safe package

**Files:**
- Modify: `packages/react-safe/src/index.ts:67, 79, 107`

**Interfaces:**
- Consumes: `ReactDetector` class methods
- Produces: Removal of unconditional debug logging

- [ ] **Step 1: Read the react-safe source**

```bash
code packages/react-safe/src/index.ts
```

- [ ] **Step 2: Remove or wrap console.log calls**

Remove the three `console.log("[DEBUG] ...")` calls at lines 67, 79, and 107. These leak function names and IDs unconditionally. If debug logging is desired, gate behind a `process.env.DEBUG` check or remove entirely.

- [ ] **Step 3: Run typecheck and tests**

```bash
cd packages/react-safe && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/react-safe/src/index.ts
git commit -m "fix: remove unconditional DEBUG console.log from react-safe detector"
```

---

### Task 6: Remove `@ts-nocheck` from expressions.ts and add proper types

**Files:**
- Modify: `packages/ir/src/lowering/expressions.ts:1-6`

**Interfaces:**
- Consumes: `ASTLowering` class, `Register` type from `@tsvm/shared`
- Produces: Properly typed file with public interface for extracted functions

- [ ] **Step 1: Read the full expressions.ts to understand all type issues**

```bash
cat packages/ir/src/lowering/expressions.ts | head -50
```

- [ ] **Step 2: Create a public interface for ASTLowering**

In `packages/ir/src/builder.ts`, extract a public interface `IASTLowering` that exposes the members used by expressions.ts:

```typescript
export interface IASTLowering {
  node: ts.Node;
  fnBuilder: FunctionBuilder;
  currentBlock: BlockBuilder;
  modBuilder: ModuleBuilder;
  scope: Scope;
  outerCaptureBindings: Set<string>;
  lowerNestedFunctionLike(node: ts.FunctionLikeDeclaration, name?: string, options?: LowerFunctionOptions): Register;
  emitConstant(kind: ConstantKind, value: unknown): Register;
  createTempLocal(name: string): Register;
  // ... other methods used by expressions.ts
}
```

- [ ] **Step 3: Remove `@ts-nocheck` and change parameter type**

Replace `// @ts-nocheck` with proper import of `IASTLowering` and change `self: ASTLowering` to `self: IASTLowering`.

- [ ] **Step 4: Fix any remaining type errors**

```bash
cd packages/ir && pnpm typecheck
```
Iteratively fix any type errors that arise.

- [ ] **Step 5: Run tests**

```bash
cd packages/ir && pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add packages/ir/src/lowering/expressions.ts packages/ir/src/builder.ts
git commit -m "refactor: remove @ts-nocheck from expressions.ts with proper IASTLowering interface"
```

---

### Task 7: Remove unused `dummyReg` allocation in expressions.ts

**Files:**
- Modify: `packages/ir/src/lowering/expressions.ts:513, 523`

**Interfaces:**
- Consumes: Register allocation logic in `ASTLowering` / `IASTLowering`
- Produces: Removed unused register allocation

- [ ] **Step 1: Locate the dummyReg usage**

In `expressions.ts`, find the `dummyReg` variable around line 513.

- [ ] **Step 2: Replace with unused underscore pattern**

Change:
```typescript
const dummyReg = self.fnBuilder.allocRegister();
self.currentBlock.addInstruction(
  OpCode.CallMethod, [...], dummyReg
);
```
To:
```typescript
self.currentBlock.addInstruction(
  OpCode.CallMethod, [...], self.fnBuilder.allocRegister()
);
```

- [ ] **Step 3: Run typecheck and tests**

```bash
cd packages/ir && pnpm typecheck && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/ir/src/lowering/expressions.ts
git commit -m "refactor: remove unused dummyReg variable in object literal lowering"
```

---

### Task 8: Remove TODO comments across the codebase

**Files:**
- Modify: `packages/ir/src/lowering/expressions.ts:1`
- Modify: `packages/transforms/src/passes/type-level-fake-path.ts:279`

**Interfaces:**
- Consumes: N/A — comments only
- Produces: Cleaned-up source files

- [ ] **Step 1: Remove the TODO in expressions.ts line 1**

Remove:
```
// TODO: Refactor ASTLowering to expose a public interface for these extracted functions.
// Currently, they access private members of ASTLowering via the `self` parameter,
// which forces the use of @ts-nocheck. A proper solution would extract shared state
// into a separate accessible context object or define a public interface for the
// operations these functions need.
// @ts-nocheck
```
(Handled by Task 6.)

- [ ] **Step 2: Remove template comment in type-level-fake-path.ts line 279**

Remove:
```
        // ─── ALL TEMPLATES NOW USE GetEntropy ───
```
This comment adds no value — it documents a past decision.

- [ ] **Step 3: Commit**

```bash
git add packages/transforms/src/passes/type-level-fake-path.ts
git commit -m "chore: remove stale TODO and template comment"
```

---

### Task 9: Clean up `examples/st/test.js` — remove or document demo file

**Files:**
- Modify: `examples/st/test.js`

**Interfaces:**
- Produces: Demo file with documented purpose or removed

- [ ] **Step 1: Add a header comment to the file**

Add at the top of `examples/st/test.js`:
```javascript
/**
 * DEMO FILE — NOT part of the main pipeline.
 * Tests basic state machine + token vault concepts.
 * fakeRemoteScore() is a local simulation, not a real API call.
 */
```

- [ ] **Step 2: Commit**

```bash
git add examples/st/test.js
git commit -m "chore: document examples/st/test.js as demo file with simulation code"
```

---

### Task 10: Fix hardcoded `scratch/` path in runtime tests

**Files:**
- Modify: `packages/vm-runtime/tests/runtime.test.ts:340, 358, 438`

**Interfaces:**
- Consumes: Test assertions in `runtime.test.ts`
- Produces: Test code using `os.tmpdir()` or `path.join(__dirname, 'scratch')`

- [ ] **Step 1: Add os/tmpdir import and replace hardcoded path**

Add `import { tmpdir } from 'os';` and replace:
```typescript
console.error("DUMPED FAILED SOURCE TO scratch/failed-source.js due to error:", e);
```
With:
```typescript
const dumpPath = path.join(tmpdir(), `tsvm-failed-${Date.now()}.js`);
console.error("DUMPED FAILED SOURCE TO", dumpPath, "due to error:", e);
require('fs').writeFileSync(dumpPath, sourceCode);
```
(Repeat for all 3 occurrences.)

- [ ] **Step 2: Run tests**

```bash
cd packages/vm-runtime && pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add packages/vm-runtime/tests/runtime.test.ts
git commit -m "chore: use os.tmpdir() instead of hardcoded scratch/ path in test dumps"
```

---

### Task 11: Document `fakeFn` hack for static blocks in builder.ts

**Files:**
- Modify: `packages/ir/src/builder.ts:828`

**Interfaces:**
- Produces: Inline comment explaining the workaround

- [ ] **Step 1: Add explanatory comment**

Add before line 828:
```typescript
      // Wraps static block body in a fake function expression so it can be
      // lowered through the same nested-function path. Called immediately via
      // CallMethod. This is a structural workaround — the IR has no native
      // static block representation.
```

- [ ] **Step 2: Commit**

```bash
git add packages/ir/src/builder.ts
git commit -m "docs: add comment explaining fakeFn workaround for static blocks"
```

---

### Task 12: Run full regression test suite

- [ ] **Step 1: Run full workspace build and test**

```bash
pnpm build && pnpm typecheck && pnpm test
```

- [ ] **Step 2: Run pipeline validation**

```bash
node test-pipeline.js
```

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "chore: post-cleanup regression fixes"
```
