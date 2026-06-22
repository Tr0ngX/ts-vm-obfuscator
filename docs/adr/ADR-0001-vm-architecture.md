# ADR-0001: Polymorphic Threaded VM Architecture

**Status:** Accepted
**Date:** 2026-06-22

## Context

Selected functions must execute in a custom runtime to prevent static analysis and reverse engineering. The runtime must be self-contained, produce no external dependencies, and resist both static and dynamic analysis.

## Decision

Use an **indirect threaded dispatch** VM with **per-execution bytecode cloning**:

1. **Threaded dispatch**: each handler function returns the next handler. This defeats linear disassembly and makes control-flow reconstruction harder than a simple switch-loop.
2. **Per-execution bytecode cloning**: the original bytecode is copied before each run. The clone (not the original) is subject to LCG self-modification. This ensures idempotent entry — running the same function twice always starts from the same state.
3. **LCG rolling keys**: a linear congruential generator mutates the cloned bytecode at runtime. The mutation pattern is deterministic per seed but looks random to an observer.
4. **Shadow XOR Mask Buffer**: each byte mutation is logged to `xorLog`. On recovery, the original bytecode can be reconstructed by XOR-ing the corrupted byte with the log entry.

## Consequences

- (+) Strong resistance to bytecode dumping and static analysis
- (+) No external dependencies — self-contained JS
- (+) Deterministic: same seed → same behavior
- (-) ~50-80 KB overhead per virtualized function
- (-) Per-execution clone adds O(n) time per call
- (-) LCG state can be fingerprinted by timing attacks
