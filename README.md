<p align="center">
  <img src="assets/logo.png" alt="TSXobf Logo" width="200px" />
</p>

# TSXobf — TypeScript Semantic-Aware VM Obfuscator

> **Next-Generation Code Virtualization Pipeline** for securing high-value business logic in TypeScript and JavaScript ecosystems.

---
**Languages:** [English](README.md) | [Tiếng Việt (Vietnamese)](README_VN.md)
---

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![Architecture](https://img.shields.io/badge/Architecture-Register--Based%20VM-orange.svg)]()

Unlike traditional obfuscators that rely on easily-reversible AST transformations (like variable renaming, dead code injection, or control flow flattening), **TSXobf** introduces a professional-grade **Compiler Backend** that compiles your proprietary TypeScript algorithms down to custom bytecode and executes them inside a dynamically randomized **Polymorphic Virtual Machine (VM)**.

It is designed for high-value business logic such as license checks, billing rules, cryptographic helpers, and integrity-sensitive algorithms. Virtualization is selective, not whole-program. Functions are typically opted in with `/** @virtualize */`.

## Key Features

- **Semantic-Aware Compilation:** Uses the official TypeScript Compiler API to seamlessly resolve module exports, scope rules, typed variables, and dependency calls.
- **Polymorphic Virtual Machine Runtime:** Generates a Threaded Dispatch execution engine with randomized handlers and integrity traps.
- **Optional WASM Hybrid Runtime:** `--runtime wasm-hybrid` emits a WebAssembly bootstrap with the existing JS VM semantic executor as the correctness-preserving bridge.
- **1-to-N Opcode Aliasing & Shuffling:** Defeats statistical pattern-matching by mapping one instruction type to multiple virtual opcodes, randomized per build.
- **Rolling XOR Key Encryption:** Instruction opcodes and immediate values are encrypted within the bytecode stream and dynamically decrypted.
- **JIT Constant Pool Decryption:** Strings, numerical constants, and property lookups are extracted into an encrypted constant pool and decrypted lazily.
- **Targeted Protection via JSDoc:** Protect only critical functions by placing a `/** @virtualize */` annotation above them, maintaining 100% native speed for UI/framework code.
- **StripDebugPass:** Automatically strips all `console.log`, `console.warn`, and `console.error` calls to remove debug literals from the production constant pool.
- **Zero-Dependency Bundling:** Outputs a clean, standalone JavaScript file that runs anywhere (Browsers, Node.js, Electron, Workers).

## Tech Stack

- **Language**: TypeScript 5+
- **Monorepo Manager**: pnpm
- **Bundler**: tsup
- **IR & Bytecode Backend**: Custom Register-Based TSVM
- **Optional Native Layer**: WebAssembly bootstrap for the hybrid VM backend

## Prerequisites

- Node.js 20 or higher
- pnpm (highly recommended for workspaces)

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/philleyquattro317-arch/ts-vm-obfuscator.git
cd ts-vm-obfuscator
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Compile Workspace

```bash
pnpm build
```

### 4. Run the Obfuscator CLI

Provide the compiler with the target TypeScript configuration:

```bash
node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf --profile generic
```

The protected production files will be built and output into the `dist-obf/` directory with a timestamped build signature (e.g., `build_1779526130061_index_ts.js`).
Supported profiles: `default` (alias of `generic`), `generic`, `react`, `electron`, `library`.

Runtime backends:
- `--runtime js` is the default and uses the generated JavaScript VM runtime.
- `--runtime wasm-hybrid` uses the WebAssembly hybrid backend. In the current phase, this validates and embeds a native WebAssembly bootstrap, then delegates bytecode semantics to the existing JS VM executor so behavior stays identical while the WASM core can be expanded incrementally.

## Architecture

TSXobf works as a compiler backend. It takes your TypeScript code, compiles target functions into a register-based Intermediate Representation (IR), applies security passes, and packages them into a lightweight JS interpreter.

```mermaid
graph TD
    A["TypeScript Source"] -->|"TS Compiler API"| B["Semantic AST Analysis"]
    B -->|"@virtualize Filter"| C["Register-Based IR"]

    subgraph T["Transforms Pipeline"]
        direction TB
        T1["StripDebugPass"]
        T2["StringPoolEncodingPass"]
        T3["SymbolIndirectionPass"]
        T4["DeadCodeInjectionPass"]
        T5["ControlFlowFlatteningPass"]
        T6["GenericConfusionPass"]
    end
    
    C --> T1
    T1 --> T2
    T2 --> T3
    T3 --> T4
    T4 --> T5
    T5 --> T6

    T6 -->|"Assembler"| G["Binary Bytecode Stream"]
    G -->|"Polymorphic Packaging"| H["Production JS Bundle"]

    subgraph R["VM Execution Runtime"]
        direction TB
        R1["Encrypted Constant Pool"]
        R2["Polymorphic VM Interpreter"]
    end
    
    H -->|"Lazy Decode"| R1
    H -->|"Dispatch Loop"| R2
    
    R1 --> K["Runtime Values"]
    R2 --> K

    K -->|"Semantic Output"| L["Equivalent Program Behavior"]
```

### Current Technical Capabilities

- TypeScript project analysis through the TypeScript Compiler API.
- Register-based IR lowering for selected functions.
- VM bytecode compilation with remapped opcodes.
- Generated JS runtime with threaded dispatch and integrity trap handlers.
- Optional `wasm_hybrid` runtime backend with a verified WebAssembly bootstrap and JS semantic fallback.
- Constant-pool based lowering with runtime decoding.
- React-safe and Electron-oriented profile switches.
- Strip-debug transform in the obfuscation pipeline.

**IR lowering now covers these important runtime-safe constructs:**
- Array literals like `[1, 2, 3]`
- Object literals with `PropertyAssignment` and `ShorthandPropertyAssignment`
- Object literal methods like `{ f() {} }`
- Element access like `arr[i]`
- Property assignment like `obj.x = y`
- Computed assignment like `arr[i] = y`
- Basic `if / else` branch lowering
- `do / while`, `for`, `for...of`, and `for...in`
- `break`, `continue`, `switch`, and `throw`
- `while` loops
- `try / catch / finally` for synchronous control flow
- Object and array destructuring declarations with simple default values
- Destructuring assignment for verified array/object forms, including defaults and simple nesting
- Object/array rest binding, parameter destructuring, and rest parameters
- Spread in array/object literals and in call/new argument lists
- Verified async/await lowering for async function declarations and async arrows
- Prefix unary expressions (e.g. `!x`, `-x`, `~x`, `typeof x`)
- `delete` operator expressions
- Base `class` declarations and `class` expressions without `extends`, including constructors, methods, accessors, public fields, static fields, and computed names
- Nested `FunctionExpression`, `ArrowFunction`, and object-literal `MethodDeclaration`
- True lexical closures for captured outer locals via boxed cells and closure environments
- Runtime `this` and `new.target` for verified function/constructor paths, plus lexical capture for nested arrows

**The VM runtime now includes handlers for:**
- `ArrayNew`
- `ObjectNew`
- `ComputedGet`
- `ComputedSet`
- `Delete`
- `ClosureNew`
- `CellNew`
- `CellGet`
- `CellSet`
- `EnvGet`
- `LoadThis`
- `LoadNewTarget`
- `Throw`
- `TryCatchBegin`
- `TryCatchEnd`
- `Await`

Detailed status references:
- [AST Support Matrix](docs/ast-support.md)
- [Support Status Guide](docs/support-status.md)

### Workspace Layout

```text
├── apps/
│   └── visualizer/            # Web-based visualizer for IR and bytecode (Demo UI)
├── packages/
│   ├── cli/                   # CLI entry point to run the obfuscation pipeline
│   ├── core/                  # Pipeline orchestrator (End-to-End flow)
│   ├── ts-semantics/          # TypeScript project analysis and semantic graph building
│   ├── ir/                    # AST to IR lowering
│   ├── transforms/            # Obfuscation and virtualization passes
│   ├── bytecode/              # IR to bytecode compiler and encoder
│   ├── vm-runtime/            # Generated VM runtime builder
│   ├── wasm-runtime/          # Optional WASM hybrid runtime bridge
│   ├── shared/                # Shared types and config
│   ├── react-safe/            # React safety rules
│   ├── electron-hardening/    # Electron-oriented hardening hooks
│   └── benchmark/             # Benchmark helpers
├── examples/
│   ├── basic-ts/              # Main baseline sample (Hash, TEA)
│   └── st/                    # Complex structure regression sample
└── test-pipeline.js           # End-to-End semantic validation script
```

## Code Example

**1. Original Code (`examples/basic-ts/src/index.ts`)**
```typescript
/** @virtualize */
export function calculateSecretHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
```

**2. Obfuscated Output JavaScript (`dist-obf/...`)**
```javascript
const vmFunctions = (function() {
  const seed = 1779526130061;
  // Encrypted Constant Pool, 1-to-N Handlers, and Threaded Dispatch Loop...
  
  function createExecutor(bytecodeArr) {
    return function execute(...fnArgs) {
       // Register-based VM executing encrypted bytecode...
    }
  }

  var result = {};
  result['calculateSecretHash'] = createExecutor(new Uint8Array([73,122,89,14,244,11,8,90,201...]));
  return result;
})();
```

After lowering and compilation, the original function body is replaced by VM bytecode plus a generated runtime bundle.

## Verification & Testing

TSXobf includes strict semantic validation to ensure the VM interpreter produces the exact same results as native Node.js V8 execution.

### Baseline Regression

This verifies the existing `examples/basic-ts` sample and compares obfuscated output against native behavior:

```bash
pnpm test
```

That command currently does all of the following:
1. Runs the workspace Vitest suites from the root config
2. Builds the workspace
3. Runs `node test-pipeline.js`

### Complex Structure Regression

This verifies the newer array/object/index/branch support in `examples/st`.

Build an obfuscated bundle:
```bash
node packages/cli/dist/cli.js -p examples/st/tsconfig.json --out examples/st/dist
```

Build with the optional WASM hybrid runtime:
```bash
node packages/cli/dist/cli.js -p examples/st/tsconfig.json --out examples/st/dist --runtime wasm-hybrid
```

Then compare native vs obfuscated execution:
```bash
node examples/st/run-obf.js
```
Expected success output: `OK runComplexStructures matched native output for all flags.`

## Recommended Development Flow

If you are changing pipeline behavior:
1. Update or add tests first.
2. Run targeted Vitest cases.
3. Run `pnpm test`.
4. If touching complex expression lowering, rerun the `examples/st` verification flow.

## Current Limits & Status

This repo is a serious VM compiler and is currently in a state of **SUPER UPGRADE**, fully verified against complex structural logic, but it does not claim broad support for arbitrary JavaScript syntax inside *every* virtualized function yet.

Notable limits:
- Unsupported AST forms now fail loudly during IR lowering instead of silently producing invalid registers.
- Broad arbitrary JavaScript syntax is still not guaranteed inside every virtualized function; support is expanding through targeted lowering and regression coverage.
- Closure support now works for captured outer locals, but only the variables that are actually captured are boxed, which adds targeted runtime overhead on those bindings.
- `wasm_hybrid` is an opt-in phase-1 backend: the generated bundle includes a real WebAssembly bootstrap, but opcode execution still uses the JS VM semantic executor. Do not treat it as a full native WASM opcode core yet.
- `try / catch / finally` is fully verified for synchronous flow. Async `await` inside `try / catch / finally` is verified for the current async-function subset, including async generators on the verified path.
- `this` and `new.target` are verified for regular function paths, constructor-style VM execution, and nested arrows that capture them lexically from an enclosing function context. Top-level arrows without an enclosing lexical provider are still kept off the `vm_safe` path.
- Base `class` declarations and `class` expressions are verified on the VM path, including public fields, private instance fields, methods, accessors, static fields, and computed names. Derived classes (`extends` / `super`), static blocks, and decorators are still outside the verified VM path.
- Generators are verified on the VM path for both synchronous and async generator functions, including `yield` and `yield*`.
- `apps/visualizer` is still a demo UI and not the source of truth for runtime behavior.

## Troubleshooting

### VM Integrity Violation

**Error:** `VM Integrity Violation at PC X`

**Solution:** This typically means the bytecode stream got desynchronized due to an unmapped opcode, or an incorrect `argCount` parsing in the VM runtime. Ensure that you have run `pnpm build` after modifying any `polymorphic-builder.ts` handlers or `compiler.ts` logic.

### Missing Braces causing TypeError

**Error:** `TypeError: Cannot read properties of undefined (reading 'apply')`

**Solution:** Check the TypeScript source code for missing curly braces `{}` in `for`, `while`, or `if` statements. The AST parser might aggressively merge function calls if block scopes are ambiguous, causing incorrect register mappings during virtualization.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
