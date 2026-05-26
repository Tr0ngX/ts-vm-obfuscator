# VM Fully Support Plan

## Goal
Promote existing limited-support features (lexical `this`/`new.target` in top-level arrow functions, broader async/await flows, and missing object property literal forms) to fully supported VM status by implementing necessary AST lowering handlers and runtime VM executors.

## Tasks
- [ ] Task 1: Analyze current top-level lexical `this` and `new.target` compiler failures → Verify: Run targeted CLI compilation test on a top-level arrow function using lexical context.
- [ ] Task 2: Implement top-level lexical environment providers in `packages/ir/src/builder.ts` → Verify: Transpiler generates valid VM context bindings for top-level lexical properties.
- [ ] Task 3: Map complex object literal property forms (like getters/setters and computed key/value variations) → Verify: Add unit tests in `packages/ir/tests/builder.test.ts`.
- [ ] Task 4: Expand async/await capabilities to cover complex loops, try-catch scopes, and async iterators inside the VM → Verify: Run `pnpm test` in the `packages/vm-runtime` suite.
- [ ] Task 5: Integrate new validation cases into `examples/basic-ts/src/index.ts` and `test-pipeline.js` → Verify: Run `node test-pipeline.js` successfully.
- [ ] Task 6: Update `docs/ast-support.md` and `docs/support-status.md` to reflect full-support status → Verify: View both docs files to ensure status is marked as `Fully Supported`.

## Done When
- All new complex tests run successfully inside `test-pipeline.js` with 100% semantic equivalence.
- The `docs/support-status.md` shows `Fully Supported` for lexical context, object properties, and async features.
