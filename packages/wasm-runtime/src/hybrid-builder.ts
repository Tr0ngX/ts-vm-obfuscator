import type { BytecodeModule, VMBuildConfig, VMRuntimeBundle } from '@tsvm/shared';
import { buildVMRuntime } from '@tsvm/vm-runtime';

const WASM_CORE_BYTES = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 127, 3, 2, 1, 0, 7, 21, 1, 17, 116, 115, 118, 109, 95, 119, 97, 115, 109, 95, 98, 97, 99,
  107, 101, 110, 100, 0, 0, 10, 6, 1, 4, 0, 65, 1, 11,
];

function createWasmBootstrap(): string {
  return `
// WASM hybrid VM bootstrap. v1 validates a native WebAssembly core is available
// and keeps JS semantic execution as the correctness-preserving bridge.
const __tsvmWasmBytes = new Uint8Array([${WASM_CORE_BYTES.join(',')}]);
const __tsvmWasmModule = new WebAssembly.Module(__tsvmWasmBytes);
const __tsvmWasmInstance = new WebAssembly.Instance(__tsvmWasmModule, {});
if (__tsvmWasmInstance.exports.tsvm_wasm_backend() !== 1) {
  throw new Error('TSXobf WASM backend bootstrap failed');
}
`.trim();
}

export function buildWasmHybridRuntime(module: BytecodeModule, config: VMBuildConfig): VMRuntimeBundle {
  const jsBundle = buildVMRuntime(module, config);
  const wasmBootstrap = createWasmBootstrap();
  const fullSource = `${wasmBootstrap}\n\n${jsBundle.fullSource}`;

  return {
    ...jsBundle,
    buildId: `${jsBundle.buildId}_wasm_hybrid`,
    dispatchLoop: wasmBootstrap,
    entryBootstrap: wasmBootstrap,
    fullSource,
  };
}
