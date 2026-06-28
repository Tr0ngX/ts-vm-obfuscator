# Monorepo Codebase Security & Stability Audit Report

This report consolidates and validates the codebase audit findings compiled by the 10 specialized auditing subagents. It categorizes identified bugs, architectural flaws, and performance bottlenecks by severity (Critical, High, Medium, Low), provides precise file links, explains the root causes, and details recommended fixes.

---

## Summary of Findings
- **Critical (C1 - C3):** 3 bugs that cause immediate VM crashes, module type errors, or byte-stream desynchronization.
- **High (H1 - H8):** 8 bugs causing security bypasses, logic errors, math corruption under edge cases, or build completion failures.
- **Medium (M1 - M7):** 7 issues affecting build performance, dependency emissions, or diagnostic crash scenarios.
- **Low (L1 - L4):** 4 minor codebase cleanliness, code duplication, or mathematical precision issues.

---

## 🔴 CRITICAL SEVERITY

### C1. Decoder Byte-Stream Misalignment (Disassembler Mismatch)
* **Target File:** [packages/bytecode/src/decoder.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/decoder.ts)
* **Details:**
  The disassembler utility `decodeBytecode` relies on `opcodeLayout` to determine the number of operands to read for non-variable-length opcodes. However, several new instructions have out-of-sync configurations in `opcodeLayout` compared to the IR builder and VM runtime dispatch, reading the wrong number of operands. This leads to **immediate byte-stream misalignment**, corrupting the parsing of all subsequent instructions.
* **Mismatched Layouts:**
  * `TryCatchBegin`: actual 3 inputs (`[catchBlock, endBlock, exceptionLocal]`) vs decoder `{ inputCount: 0, hasResult: false }` (Reads 0, expects 3).
  * `CellNew`: actual 1 input, 1 result vs decoder `{ inputCount: 0, hasResult: true }` (Reads 1, expects 2).
  * `PrivateGet`: actual 2 inputs, 1 result vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, expects 3).
  * `PrivateSet`: actual 3 inputs, 0 results vs decoder `{ inputCount: 2, hasResult: false }` (Reads 2, expects 3).
  * `PrivateIn`: actual 2 inputs, 1 result vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, expects 3).
  * `SuperPropGet`: actual 1 input, 1 result vs decoder `{ inputCount: 2, hasResult: true }` (Reads 3, expects 2).
  * `SuperPropSet`: actual 2 inputs, 0 results vs decoder `{ inputCount: 3, hasResult: false }` (Reads 3, expects 2).
  * `Yield` / `YieldStar` / `Await` / `RestArgs`: actual 1 input, 1 result vs decoder `{ inputCount: 0, hasResult: true }` (Reads 1, expects 2).
  * `CallWithArray`: actual 2 inputs, 1 result vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, expects 3).
  * `CallMethodWithArray`: actual 3 inputs, 1 result vs decoder `{ inputCount: 2, hasResult: true }` (Reads 3, expects 4).
  * `NewWithArray`: actual 2 inputs, 1 result vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, expects 3).
  * `Delete`: actual 2 inputs, 0 results vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, but incorrectly maps the second operand as a result register).
  * `ArrayNew`: actual 0 inputs, 1 result vs decoder `{ inputCount: 1, hasResult: true }` (Reads 1, but sets `result = undefined`).
  * `Spread`: actual 2 inputs, 0 results vs decoder `{ inputCount: 1, hasResult: true }` (Reads 2, but sets `result = sourceReg`).
* **Remediation:**
  Update the configurations inside the `opcodeLayout` mapping in `packages/bytecode/src/decoder.ts` to exactly match the VM and IR signatures.

---

### C2. VM Try/Catch Frame Stack Leak & Incorrect Exception Routing
* **Target Files:**
  * [packages/ir/src/builder.ts](file:///d:/ts-vm-obfuscator/packages/ir/src/builder.ts)
  * [packages/vm-runtime/src/polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Details:**
  1. The IR builder **never emits `TryCatchEnd` instructions**. The try-catch compiler constructs the blocks but forgets to insert the exit opcode.
  2. To pop finished try blocks, the VM main loop checks if the program counter exceeds the frame's boundaries: `pc >= endPc`.
  3. **The Leak:** If a loop is placed inside the `try` block and a `continue` or loop condition check executes, the program counter jumps backwards to the loop header (which is *before* the try block). Because `pc < endPc`, the try frame is **not popped** from `ctx.tryFrames`.
  4. Execution then leaves the try block, but the stale try frame remains active on the stack. If any subsequent native exception occurs outside the try block, the VM catches it and incorrectly routes execution to the catch handler of the completed block.
* **Remediation:**
  Modify `packages/ir/src/builder.ts` to emit `TryCatchEnd` at the exit of `try` blocks and when routing abrupt completions (returns/breaks/continues). Update the VM to pop the try-catch frame when `TryCatchEnd` is executed.

---

### C3. Symbol Indirection Wrapper Resolving Crash (Virtualized-Unexported)
* **Target File:** [packages/transforms/src/passes/symbol-indirection.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/symbol-indirection.ts)
* **Details:**
  `SymbolIndirectionPass` renames any function where `func.isExported` is false to a randomized identifier (e.g. `fn_abcdefgh`). This includes internal helper functions marked with `@virtualize`.
  However, the universal bundler wraps top-level functions using their original names, and looks them up on the VM using their original names (`vmFunctions["original_name"]`). Since the function is registered inside the VM under its renamed identifier (`fn_abcdefgh`), calling it throws a `TypeError: Cannot read properties of undefined` at runtime.
* **Remediation:**
  In `symbol-indirection.ts`, update the filter logic:
  ```typescript
  if (func.isExported || func.isVirtualized) {
    return func; // Preserve name for entrypoint wrappers
  }
  ```

---

## 🟡 HIGH SEVERITY

### H1. Multi-declaration Overwrite Security Leak
* **Target File:** [packages/core/src/universal-bundler.ts](file:///d:/ts-vm-obfuscator/packages/core/src/universal-bundler.ts)
* **Details:**
  When replacing top-level statements with VM wrappers, the bundler maps AST Statement nodes to their replacements. If multiple declarations share a single statement node (e.g., `const a = () => {}, b = () => {};`), they key off the same statement node. The replacement map only records the wrapper for the last function processed, leaving the other functions un-obfuscated and in plain text in the final output bundle.
* **Remediation:**
  Update the lowering stage to split multi-variable/function declarations into separate declarations, or rewrite the replacement mapper to split nodes programmatically.

---

### H2. Electron Hardening Phase Execution Order Bypass
* **Target File:** [packages/core/src/index.ts](file:///d:/ts-vm-obfuscator/packages/core/src/index.ts)
* **Details:**
  The Electron hardening pass is executed at Stage 7 (Post-bundling and output writing). However, bytecode compilation (Stage 5) and VM runtime generation (Stage 6) have already run. Any security guards added to the IR modules during Stage 7 are silently discarded and never compiled into bytecode, rendering all hardening features a silent no-op.
* **Remediation:**
  Move the Electron hardening pass execution logic up before Stage 5 (Bytecode Compilation).

---

### H3. Electron Hardening String Method Invocation TypeError
* **Target File:** [packages/electron-hardening/src/index.ts](file:///d:/ts-vm-obfuscator/packages/electron-hardening/src/index.ts)
* **Details:**
  The Electron hardening pass injects IPC contextBridge interceptors. However, the injected guards load the interceptor method name as a string constant (e.g., `'send'`) and attempt to invoke it directly using `OpCode.Call`. Since a string is not a function object, the VM throws a runtime `TypeError` when contextBridge is triggered.
* **Remediation:**
  Update the hardening pass to load the property reference from the object (`obj[methodName]`) before invoking the call instruction.

---

### H4. Instruction Substitution Float & Large Integer Math Corruption
* **Target File:** [packages/transforms/src/passes/instruction-substitution.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/instruction-substitution.ts)
* **Details:**
  The pass substitutes simple arithmetic operations (such as `A + B`) with bitwise equivalents (e.g. `(A ^ B) + 2 * (A & B)`). However, JavaScript bitwise operators coerce values to 32-bit signed integers. When performing math on floating-point numbers or integers larger than \(2^{31} - 1\), this substitution corrupts the value, yielding incorrect results.
* **Remediation:**
  Only apply bitwise substitution if type checking facts guarantee that the operands are small integers, or disable this substitution for operations involving floating-point types.

---

### H5. Nested Closure Lookup VM Crash
* **Target Files:**
  * [packages/transforms/src/passes/closure-propagation.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/closure-propagation.ts)
  * [packages/core/src/index.ts](file:///d:/ts-vm-obfuscator/packages/core/src/index.ts)
* **Details:**
  In the `generic` and `electron` target profiles, the closure propagation pass is bypassed. When a virtualized function contains nested closures, the closure bindings are not set up or propagated, causing VM execution to crash with reference errors when attempting to access closure variables.
* **Remediation:**
  Ensure the closure propagation check is executed for all profiles where virtualization is enabled.

---

### H6. StripDebugPass SSA Register Breakage
* **Target File:** [packages/transforms/src/passes/strip-debug.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/strip-debug.ts)
* **Details:**
  When replacing debug/logging instructions with `Nop` instructions, the pass sets the `result` register property to `undefined`. If subsequent instructions in the basic block reference the original destination register, they read an uninitialized or wrong register value, violating SSA assumptions and corrupting the block logic.
* **Remediation:**
  Retain the original `result` register property on the replaced `Nop` instruction.

---

### H7. ControlFlowFlattening Entry Block Duplication
* **Target File:** [packages/transforms/src/passes/control-flow-flattening.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/control-flow-flattening.ts)
* **Details:**
  The list of blocks `blockOrder` shuffled by the flattening pass contains the entry block of the function. This causes the entry block to be treated as a standard dispatcher case block and duplicated, resulting in unexpected behavior or potential infinite loops at runtime.
* **Remediation:**
  Filter out the entry block from `blockOrder` before shuffling and creating case blocks.

---

### H8. Abrupt process.exit(1) before I/O Flush
* **Target File:** [packages/cli/src/cli.ts](file:///d:/ts-vm-obfuscator/packages/cli/src/cli.ts)
* **Details:**
  In the commander action error handler, calling `process.exit(1)` exits the Node process immediately. Because Node I/O is asynchronous, pending file write operations to the output folder are discarded, resulting in missing or truncated output files.
* **Remediation:**
  Set `process.exitCode = 1` and let the process run to completion naturally, ensuring all write streams flush.

---

## 🟠 MEDIUM SEVERITY

### M1. Non-Universal Profile Native Discard
* **Target File:** [packages/core/src/universal-bundler.ts](file:///d:/ts-vm-obfuscator/packages/core/src/universal-bundler.ts)
* **Details:**
  Profiles other than `universal` output only the raw VM runtime and bytecode. They discard all native helper functions, imports, and exports from the original files, leading to reference crashes when executing output scripts.
* **Remediation:**
  Unify the output bundling logic so all profiles preserve the native module wrapper structures.

---

### M2. Relative Import Path Renaming Desync
* **Target File:** [packages/cli/src/cli.ts](file:///d:/ts-vm-obfuscator/packages/cli/src/cli.ts)
* **Details:**
  When files are renamed or output structure is flattened in the emission stage, relative import specifiers (e.g. `import { foo } from "./bar"`) are not rewritten, breaking imports at runtime.
* **Remediation:**
  Implement import specifier path correction during final bundle writing.

---

### M3. Type-Level Fake Path Environment Fragility
* **Target File:** [packages/transforms/src/passes/type-level-fake-path.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/type-level-fake-path.ts)
* **Details:**
  The opaque predicate relies on verifying if `typeof (new Error().stack) === 'string'`. In lightweight or optimized JS engines (such as Hermes or certain configurations of embedded engines), stack traces might be disabled or return `undefined`. This routes the predicate to `OpCode.Trap` and crashes the VM on normal executions.
* **Remediation:**
  Replace host-specific checks with mathematically verifiable or environment-agnostic predicates.

---

### M4. Semantic Graph Re-Parsing Desync
* **Target File:** [packages/ir/src/builder.ts](file:///d:/ts-vm-obfuscator/packages/ir/src/builder.ts)
* **Details:**
  The IR builder re-reads source files from disk and re-parses them instead of using the pre-built semantic graph program cached by the compiler. This degrades compilation performance and can cause type checker mismatches.
* **Remediation:**
  Refactor the IR builder to consume AST nodes directly from the pre-constructed semantic program cache.

---

### M5. Diagnostics Crash on Undefined start position
* **Target File:** [packages/ts-semantics/src/project.ts](file:///d:/ts-vm-obfuscator/packages/ts-semantics/src/project.ts)
* **Details:**
  Mapping character spans in compile diagnostics (`diag.file.getLineAndCharacterOfPosition(diag.start!)`) crashes the process with a TypeError if `diag.start` is undefined (e.g., file-level or project-level diagnostics).
* **Remediation:**
  Add a nullish check: `if (diag.start !== undefined && diag.file) ...` before calling position lookups.

---

### M6. String Pool Encoding Bytecode Inflation
* **Target File:** [packages/transforms/src/passes/string-pool-encoding.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/string-pool-encoding.ts)
* **Details:**
  String pool decryption is unrolled inline (generating 5 instructions per character). For very long strings, this produces massive bytecode inflation and heavy performance penalties at startup.
* **Remediation:**
  Skip string pool encoding for strings longer than 128 characters, or replace the unrolled decryption instructions with a VM-internal loop.

---

### M7. Stealth Dispatch Lookup Offset Desync
* **Target File:** [packages/vm-runtime/src/polymorphic-builder.ts](file:///d:/ts-vm-obfuscator/packages/vm-runtime/src/polymorphic-builder.ts)
* **Details:**
  The stealth dispatch check maps instructions using `(ctrlState + canonicalOp) % 256`. However, because the control state is mutated during normal dispatch, this offset can desynchronize, leading to incorrect validation failures.
* **Remediation:**
  Use a stable lookup mapping or separate the verification token from the active mutable control state.

---

## 🔵 LOW SEVERITY

### L1. Minor Register Count Over-allocation
* **Target File:** [packages/bytecode/src/compiler.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/compiler.ts)
* **Details:**
  The compiler allocates register frames using:
  `const maxRegs = Math.max(collectMaxRegisterIndex(irFn) + 1, paramCount);`
  Since `collectMaxRegisterIndex` already returns `maxRegister + 1`, this results in allocating `maxRegister + 2` registers in the VM context. While benign, it allocates 1 extra register slot than strictly necessary.
* **Remediation:** Remove the redundant `+ 1` calculation.

---

### L2. Duplicate Utility Functions
* **Target Files:**
  * [packages/bytecode/src/encoder.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/encoder.ts)
  * [packages/bytecode/src/decoder.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/decoder.ts)
  * [packages/bytecode/src/compiler.ts](file:///d:/ts-vm-obfuscator/packages/bytecode/src/compiler.ts)
* **Details:**
  Utility functions `isVariableLengthOpcode` and `isTerminator` are duplicate-declared in full three times across distinct files.
* **Remediation:** Export them from a shared bytecode utilities module.

---

### L3. AST Lowering Prefix/Postfix Gaps
* **Target File:** [packages/ir/src/lowering/expressions.ts](file:///d:/ts-vm-obfuscator/packages/ir/src/lowering/expressions.ts)
* **Details:**
  Prefix/postfix operators only support identifier increments (`x++`). Operations like prefix decrement (`--x`), postfix decrement (`x--`), or object property increments (`obj.prop++`) fall through to unsupported exceptions.
* **Remediation:** Add support for object/array index and decrement patterns in the unary lowering handlers.

---

### L4. Harmless Dead Global Renaming Logic
* **Target File:** [packages/transforms/src/passes/symbol-indirection.ts](file:///d:/ts-vm-obfuscator/packages/transforms/src/passes/symbol-indirection.ts)
* **Details:**
  The pass renames global variables in function metadata, but does not rewrite the corresponding global string lookup keys in constant pools. This leaves the renaming inactive and redundant, but technically harmless.
* **Remediation:** Remove the metadata renaming logic or fully support global symbol mapping.
