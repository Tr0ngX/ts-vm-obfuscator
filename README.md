<p align="center">
  <img src="assets/logo.png" alt="TSXobf Logo" width="200px" />
</p>

# TSXobf

TypeScript semantic-aware obfuscation pipeline built around selective virtualization. Instead of scrambling every AST node, TSXobf lowers chosen functions to IR, compiles them to custom bytecode, and executes them inside a generated JavaScript VM runtime.

Languages: [English](README.md) | [Tiếng Việt](README_VN.md)

## What It Does

TSXobf is designed for high-value business logic such as license checks, billing rules, cryptographic helpers, and integrity-sensitive algorithms.

The main pipeline is:

1. TypeScript project analysis
2. Semantic graph construction
3. IR lowering
4. Transform passes
5. Bytecode compilation
6. VM runtime generation
7. Output bundle emission

Virtualization is selective, not whole-program. Functions are typically opted in with `/** @virtualize */`.

## Current Technical Capabilities

- TypeScript project analysis through the TypeScript Compiler API
- Register-based IR lowering for selected functions
- VM bytecode compilation with remapped opcodes
- Generated JS runtime with threaded dispatch and integrity trap handlers
- Constant-pool based lowering with runtime decoding
- React-safe and Electron-oriented profile switches
- Strip-debug transform in the obfuscation pipeline

IR lowering now covers these important runtime-safe constructs:

- Array literals like `[1, 2, 3]`
- Object literals with `PropertyAssignment` and `ShorthandPropertyAssignment`
- Element access like `arr[i]`
- Property assignment like `obj.x = y`
- Computed assignment like `arr[i] = y`
- Basic `if / else` branch lowering
- `while` loops
- Prefix unary expressions (e.g. `!x`, `-x`, `typeof x`)
- `delete` operator expressions

The VM runtime now includes handlers for:

- `ArrayNew`
- `ObjectNew`
- `ComputedGet`
- `ComputedSet`
- `Delete`

## Current Limits

This repo is still a serious prototype rather than a fully general JS/TS VM compiler.

Notable limits:

- Object literal method declarations such as `{ f() {} }` are not yet documented as supported inside virtualized regions.
- Function expressions and arrow functions embedded inside object literals are not part of the verified support set.
- Unsupported AST forms now fail loudly during IR lowering instead of silently producing invalid registers.
- `apps/visualizer` is still a demo UI and not the source of truth for runtime behavior.

## Workspace Layout

```text
packages/core                 Pipeline orchestrator
packages/ts-semantics         TS project analysis and semantic graph
packages/ir                   AST to IR lowering
packages/transforms           Obfuscation and virtualization passes
packages/bytecode             IR to bytecode compiler and encoder
packages/vm-runtime           Generated VM runtime builder
packages/shared               Shared types and config
packages/cli                  CLI entrypoint
packages/react-safe           React safety rules
packages/electron-hardening   Electron-oriented hardening hooks
packages/benchmark            Benchmark helpers
examples/basic-ts             Main baseline sample
examples/st                   Complex structure regression sample
```

## Requirements

- Node.js 20+
- pnpm

## Install And Build

```bash
pnpm install
pnpm build
```

## CLI Usage

Build the CLI first, then run it against a target `tsconfig.json`.

```bash
node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf --profile generic
```

Supported profiles:

- `default` -> alias of `generic`
- `generic`
- `react`
- `electron`
- `library`

The CLI also supports `--seed <number>`, and that seed is applied to both the obfuscation profile and VM config.

## Verification

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

Then compare native vs obfuscated execution:

```bash
node examples/st/run-obf.js
```

Expected success output:

```text
OK runComplexStructures matched native output for all flags.
```

## Example Virtualized Function

```ts
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

After lowering and compilation, the original function body is replaced by VM bytecode plus a generated runtime bundle.

## Entry Points

- CLI: `packages/cli/src/cli.ts`
- Pipeline: `packages/core/src/index.ts`
- VM builder: `packages/vm-runtime/src/polymorphic-builder.ts`
- Baseline verifier: `test-pipeline.js`
- Complex verifier: `examples/st/run-obf.js`

## Recommended Development Flow

If you are changing pipeline behavior:

1. Update or add tests first
2. Run targeted Vitest cases
3. Run `pnpm test`
4. If touching complex expression lowering, rerun the `examples/st` verification flow

## Status

The repo currently verifies:

- Baseline semantic equivalence for `examples/basic-ts`
- Complex array/object/index/branch behavior for `examples/st`
- CLI option parsing for profile and seed
- VM runtime generation for the newer allocation handlers

It does not claim broad support for arbitrary JavaScript syntax inside every virtualized function yet.

## License

MIT. See [LICENSE](LICENSE).
