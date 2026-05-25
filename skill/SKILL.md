---
name: tsxobf-vm-gap-closer
description: Use this skill when extending TSXobf VM-path semantics. Prioritize implementation-truth support gaps, keep unsupported syntax explicit, and do not promote docs until IR, runtime, universal, build, and pipeline verification all pass.
---

# TSXobf VM Gap Closer

Current VM semantic gaps that must stay explicit until verified:

- `super`
- `class` / `class expression`
- lexical `this` in arrow
- lexical `new.target` in arrow

Preferred implementation directions:

- `super`: helper-based semantics, not `Base.prototype` shortcuts
- `class` / `class expression`: class-aware normalization before raw IR lowering
- lexical arrow semantics: real lexical capture through closure env/cell flow, not dynamic `this`

Execution rules:

1. Start by reading the relevant pipeline code and tests for the exact syntax family being changed.
2. Make the smallest semantics-correct change that moves a verified case from `js_lowered` to `vm_safe`.
3. Do not silently downgrade verified syntax families back to compatibility lowering.
4. If `class` / `super` are still unsupported, keep the limitation explicit in code and docs.
5. Fail loudly on unsupported edge cases instead of compiling wrong behavior.

Acceptance gate before promoting support claims:

- `pnpm exec vitest run packages/ir/tests/builder.test.ts`
- `pnpm exec vitest run packages/bytecode/tests/compiler.test.ts`
- `pnpm exec vitest run packages/vm-runtime/tests/runtime.test.ts`
- `pnpm exec vitest run packages/core/tests/universal.test.ts`
- `pnpm test`
- `pnpm build`
- `node test-pipeline.js`

Doc update rule:

- Only update `README.md`, `README_VN.md`, `docs/ast-support.md`, or `docs/support-status.md` after the acceptance gate above passes for the newly claimed syntax.
