# AGENTS.md

## Purpose

This repository is `TSXobf` (`ts-vm-obfuscator`): a TypeScript semantic-aware obfuscation pipeline that turns selected functions into custom bytecode and executes them inside a polymorphic JavaScript VM runtime.

The main end-to-end flow is:

1. TypeScript project analysis
2. Semantic graph construction
3. IR lowering
4. Transform passes
5. Bytecode compilation
6. VM runtime generation
7. Output bundle emission to `dist-obf/`

## Workspace Shape

- `packages/core`: pipeline orchestrator; start here for end-to-end behavior
- `packages/ts-semantics`: TypeScript project analysis and semantic graph building
- `packages/ir`: lowers semantic modules into IR
- `packages/transforms`: ordered obfuscation/virtualization passes
- `packages/bytecode`: IR to bytecode compiler, encoder, decoder, opcode model
- `packages/vm-runtime`: polymorphic VM/runtime source generation
- `packages/shared`: shared types and configuration models used everywhere
- `packages/cli`: CLI entrypoint that runs the pipeline and writes output files
- `packages/react-safe`: React-specific safety rules for virtualization
- `packages/electron-hardening`: Electron-specific hardening hooks
- `packages/benchmark`: benchmark helpers
- `apps/visualizer`: currently a mock/demo UI for IR, timeline, and bytecode views
- `examples/basic-ts`: primary sample project for CLI and pipeline validation

## Primary Entry Points

- CLI: `packages/cli/src/cli.ts`
- Pipeline orchestrator: `packages/core/src/index.ts`
- VM builder: `packages/vm-runtime/src/index.ts`
- Example validation script: `test-pipeline.js`

If you need to understand what the repo "does", read these in order:

1. `README.md`
2. `packages/core/src/index.ts`
3. `packages/cli/src/cli.ts`
4. `test-pipeline.js`

## Default Commands

- Install: `pnpm install`
- Build workspace: `pnpm build`
- Run tests: `pnpm test`
- Typecheck workspace: `pnpm typecheck`
- Start visualizer: `pnpm visualizer`
- Run CLI against sample project: `node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf`
- Validate semantic equivalence: `node test-pipeline.js`

`pnpm test` was passing in this workspace on 2026-05-30 after the threaded VM hardening upgrade. That command runs Vitest, builds the workspace, then runs `node test-pipeline.js`.

## How To Change Things Safely

- When changing pipeline behavior, prefer tracing through `ObfuscationPipeline.execute()` in `packages/core/src/index.ts`.
- When changing virtualization behavior, inspect both transform selection in `packages/transforms` and compilation/runtime assumptions in `packages/bytecode` and `packages/vm-runtime`.
- When changing VM hardening or rolling bytecode behavior, inspect `packages/vm-runtime/src/polymorphic-builder.ts`, `packages/transforms/src/passes/type-level-fake-path.ts`, and the corresponding tests in `packages/vm-runtime/tests/runtime.test.ts` and `packages/transforms/tests/transforms.test.ts`.
- Keep profile-specific behavior aligned across `generic`, `react`, `electron`, and `library` modes.
- Treat `examples/basic-ts` and `test-pipeline.js` as the quickest regression check for semantic equivalence.
- The visualizer app is not the source of truth for runtime behavior; it currently renders mock data.

## Guardrails

- Do not assume whole-program virtualization; this repo is built around selected-region virtualization with `@virtualize`.
- Do not change opcode encoding or runtime dispatch rules without verifying both compiler and VM sides together.
- Do not remove self-modifying bytecode when fixing rolling-key bugs. The current safe pattern is per-execution bytecode cloning plus Shadow XOR Mask Buffer (`xorLog`) recovery and LCG-derived corruption masks.
- For anti-symbolic fake paths, keep the real path on the true congruence invariant and keep the trap-backed fake path unreachable under normal arithmetic. Avoid dynamic expressions that can break under JavaScript Number precision.
- Do not overwrite existing user changes in the worktree; this repo may already be dirty.
- Prefer targeted tests for touched packages, then run `pnpm test` if the change affects shared pipeline behavior.

## High-Value Test Targets

- `packages/ts-semantics/tests/project.test.ts`
- `packages/bytecode/tests/compiler.test.ts`
- `packages/vm-runtime/tests/runtime.test.ts`
- `packages/transforms/tests/transforms.test.ts`
- `packages/react-safe/tests/detector.test.ts`
- `packages/benchmark/tests/scoring.test.ts`
- `test-pipeline.js`

## Current Notes

- `apps/visualizer` is useful for product direction but not yet wired to real pipeline output.
- CLI profile parsing currently accepts `react`, `electron`, `library`, and falls back to `generic`.
- **Note:** The IR builder has received a major upgrade ("CỰC NÂNG CẤP") and now fully supports complex statements and expressions including `if`/`while` loops, array/object literals, element access, prefix unary expressions, and `delete` operators. Ensure to use targeted regression testing when modifying these lowering handlers.
- **Hardening note:** The VM runtime now uses indirect threaded dispatch (`handler = handler(ctx)`), per-execution bytecode cloning, Shadow XOR Mask Buffer recovery, and LCG rolling self-modification when `rollingKeys` is enabled.
- **Fake-path note:** `TypeLevelFakePathPass` now injects a VM-level congruence predicate based on `(3 * x^2 + 5 * x + 7) % 4 !== 0` with `x` reduced via `& 3`, then routes the true branch to the real target and the false branch to a `Trap` fake block.
