# TSXobf Domain Context

## What

TSXobf (ts-vm-obfuscator) is a TypeScript semantic-aware obfuscation pipeline. It analyzes TypeScript projects, builds a semantic graph, lowers selected `@virtualize`-annotated functions into an IR, applies obfuscation transforms, compiles to custom bytecode, and generates a polymorphic JavaScript VM runtime that executes the bytecode at runtime.

## Key Concepts

- **`@virtualize` annotation** — JSDoc tag that marks a function for bytecode virtualization. Only annotated functions are VM'd.
- **Semantic Graph** — The project's type-aware analysis result: captures imports, exports, call graphs, and closure relationships.
- **IR** — Intermediate Representation: a control-flow graph of basic blocks with typed instructions (SSA-like). The bridge between TypeScript AST and bytecode.
- **Transform Pass** — An ordered obfuscation/virtualization stage (14 passes). Each pass mutates the IR module in-place.
- **Opaque Predicate** — A boolean expression that's always true or always false but appears dynamic to static analysis.
- **Fake Path** — Dead branches injected to confuse symbolic execution.
- **Threaded Dispatch** — VM dispatch pattern where each handler returns the next handler function (indirect threading).
- **Rolling Key / LCG** — Linear Congruential Generator for self-modifying bytecode: the VM mutates its own bytecode between executions.
- **Shadow XOR Mask Buffer** — Recovery mechanism: each bytecode mutation is logged so the VM can reconstruct the original under analysis.
- **Profile** — A named configuration set: `generic`, `react`, `electron`, `library`. Controls which transforms and hardening features are active.

## Architecture Layers

1. **Project Analysis** (`ts-semantics`) — Parses tsconfig, resolves modules, builds semantic graph
2. **IR Lowering** (`ir`) — Converts TypeScript AST to IR (builder + lowering helpers)
3. **Transform Pipeline** (`transforms`) — Applies 14 obfuscation passes in sequence
4. **Bytecode Compilation** (`bytecode`) — Compiles IR to bytecode, encodes/decodes binary format
5. **VM Runtime Generation** (`vm-runtime`) — Generates the polymorphic JS VM source
6. **Output Bundle** (`core` + `cli`) — Orchestrates the pipeline, produces ESM bundle
