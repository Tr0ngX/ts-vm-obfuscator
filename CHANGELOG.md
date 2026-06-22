# Changelog

## [0.1.0] - 2026-06-22

### Added
- Initial release of TSXobf (ts-vm-obfuscator)
- TypeScript semantic-aware obfuscation pipeline
- Custom bytecode VM with polymorphic threaded dispatch
- IR lowering from TypeScript AST
- 14 transform passes including control flow flattening, dead code injection, opaque predicates
- React-safe and Electron-hardening profiles
- CLI entrypoint with profile support
- WASM hybrid bootstrap (JS bridge)
- Benchmark and scoring suite
