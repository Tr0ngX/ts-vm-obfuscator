# Support Status Guide

This document is the quick status board for TSXobf virtualization support.

Use it together with [AST Support Matrix](./ast-support.md):
- `ast-support.md` lists syntax families in the lowering surface.
- `support-status.md` shows how confident the repo is about each family right now.

## Status Levels

| Status | Meaning |
| --- | --- |
| `Fully Supported` | Verified by IR tests, VM runtime tests, and working pipeline coverage in this repo. |
| `Supported With Limits` | Works on the verified path, but with explicit constraints or tradeoffs. |
| `In Progress / Not Yet Stable` | Some plumbing or partial behavior exists, but the repo should not claim full support yet. |
| `Not Supported` | Still expected to fail loudly, route through compatibility handling, or stay outside the VM path. |

## Current Status

| Area | Feature / Syntax | Status | Notes |
| --- | --- | --- | --- |
| Control flow | `if / else` | `Fully Supported` | Covered by IR and runtime regression. Exhaustively verified with nested multi-condition gateways and edge inputs in `verifyArtemisGatingSystem`. |
| Control flow | `for`, `while`, `do / while` | `Fully Supported` | Verified in VM execution tests. Exhaustively verified with complex Collatz sequence loops and limit checks in `verifyArtemisCollatzAndMath`. |
| Control flow | `break`, `continue` | `Fully Supported` | Verified through loop control-flow fixtures. |
| Control flow | `switch` | `Fully Supported` | Routed as `vm_safe` on the verified path. |
| Control flow | `throw` | `Fully Supported` | VM runtime executes explicit throws correctly. |
| Control flow | `try / catch / finally` | `Supported With Limits` | Fully verified for synchronous flow; async `await` inside the current async subset, including async generators, is verified separately. |
| Control flow | `catch` binding | `Fully Supported` | Verified for identifier, no-binding, and destructured catch bindings on the VM path. |
| Data / objects | array literals | `Fully Supported` | Includes indexed reads and writes on verified path. Exhaustively tested with nested sequence data mutations in `verifyArtemisStateDecimation`. |
| Data / objects | object literals, shorthand props, object-literal methods | `Supported With Limits` | Common forms are covered; not every property form is modeled yet. Verified with dynamic property additions/mutations in `verifyArtemisStateDecimation`. |
| Data / objects | property access / element access | `Fully Supported` | Verified in lowering and runtime fixtures. Exhaustively tested with dynamic keys (e.g. `telemetry[key]`) and array indexes (e.g. `telemetry.sensorData[idx]`). |
| Data / objects | property assignment / computed assignment | `Fully Supported` | Verified in complex structure fixtures. |
| Data / objects | `delete` | `Fully Supported` | Runtime handler is in place and tested. Exhaustively verified via `delete telemetry.active` in `verifyArtemisStateDecimation`. |
| Expressions | conditional `a ? b : c` | `Fully Supported` | Lowered and exercised in syntax-pack regression. |
| Expressions | logical `&&`, `||`, `??` | `Fully Supported` | Verified short-circuit lowering path. Exhaustively tested with compound statements (`(A && B) || (C > D)`) in `verifyArtemisGatingSystem`. |
| Expressions | `new` | `Fully Supported` | VM runtime includes constructor path. |
| Iteration | `for...of` | `Fully Supported` | Verified in runtime fixture. |
| Iteration | `for...in` | `Fully Supported` | Verified in runtime fixture. |
| Bindings | object/array destructuring declarations | `Fully Supported` | Verified for declarations, loop bindings, and simple default values. |
| Bindings | destructuring assignment | `Fully Supported` | Verified for array/object assignments, simple nesting, and default values. |
| Bindings | rest/spread on VM path | `Fully Supported` | Verified for object/array rest binding, rest parameters, and spread in literals plus call/new arguments. |
| Functions | nested `FunctionExpression` / `ArrowFunction` / local `FunctionDeclaration` / object-literal `MethodDeclaration` | `Fully Supported` | Compiled as nested VM functions. |
| Closures | lexical capture of outer locals | `Supported With Limits` | Correct, but captured bindings are boxed and add targeted overhead. |
| Semantics | `this` | `Supported With Limits` | Verified for regular function paths, constructor-style VM execution, and nested arrows that capture lexical `this` from an enclosing function context. Top-level arrows without a lexical provider still stay off the vm-safe path. |
| Semantics | `new.target` | `Supported With Limits` | Verified for constructor-style VM execution and nested arrows that capture lexical `new.target` from an enclosing function context. Top-level arrows without a lexical provider still stay off the vm-safe path. |
| Profile | `universal` | `Supported With Limits` | ESM-native and stronger than before, but still mixes `vm_safe` and compatibility-lowered paths depending on syntax. |
| Runtime backend | `js` | `Fully Supported` | Default generated JavaScript VM runtime. Covered by the normal build, runtime, and pipeline verification flow. |
| Runtime backend | `wasm_hybrid` | `Supported With Limits` | Opt-in via `--runtime wasm-hybrid`. Verified as a real WebAssembly bootstrap plus JS VM semantic fallback; not yet a full native WASM opcode dispatcher. |
| Runtime hardening | `stealth` | `Supported With Limits` | Default hardening level. Enables stealth dispatch, native intrinsic tamper checks, string-concealed VM literals, opaque/dead branches, and intrinsic snapshots for private-state access without the unstable rolling-key path. |
| Runtime hardening | `paranoid` | `Supported With Limits` | Adds anti-debug timing probes. Stronger disruption behavior, but higher compatibility and false-positive risk. |
| Runtime hardening | `off` | `Fully Supported` | Debug-friendly JS VM shape with hardening disabled. |
| Language | spread elements in general expression lowering | `Fully Supported` | Verified for iterable spread in array literals plus call/new argument materialization on the VM path. |
| Language | sparse array holes | `Fully Supported` | Verified for array literal lowering with preserved length and sparse index semantics. |
| Language | `super` | `In Progress / Not Yet Stable` | Runtime handlers are being hardened, but derived-class lowering is still outside the verified VM path. |
| Language | classes / class expressions | `Supported With Limits` | Verified for base classes, constructor, methods, accessors, public/private instance fields, static fields, and computed names. Derived classes and static blocks stay outside the verified VM path. |
| Language | `await` | `Supported With Limits` | Verified for async function declarations and async arrows, including current `try/catch/finally` await coverage. |
| Language | generators / `yield` | `Fully Supported` | Fully supported for synchronous and async generator functions, including `yield` and `yield*` interpretation via iterator protocols. |
| Language | decorators | `Not Supported` | Not part of verified VM virtualization support. |

## Notes

| Topic | Current rule |
| --- | --- |
| Unsupported AST | Still expected to fail loudly during IR lowering when no safe lowering path exists. |
| `universal` compatibility | A compatibility-lowered result is not the same thing as VM support. |
| `wasm_hybrid` backend | The current hybrid backend validates the native WebAssembly bootstrap and preserves semantics through the JS VM executor. Promote individual opcode execution to WASM only after runtime and pipeline evidence exists. |
| Runtime hardening | Inspired by JS-Confuser's tamper-protection/integrity ideas, but implemented directly in the generated VM runtime. Keep `rollingKeys` opt-in until jump-heavy fixtures prove stable. |
| Promotion rule | Only move an item to `Fully Supported` after fresh IR/runtime/pipeline evidence exists. |

## Updating Rule

| Step | Required action |
| --- | --- |
| 1 | Update `docs/ast-support.md`. |
| 2 | Update this file. |
| 3 | Add or update IR/runtime regression coverage. |
| 4 | Re-run verification before changing status wording. |
