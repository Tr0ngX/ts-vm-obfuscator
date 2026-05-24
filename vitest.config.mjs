import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@tsvm/shared': path.resolve(rootDir, 'packages/shared/src/index.ts'),
      '@tsvm/bytecode': path.resolve(rootDir, 'packages/bytecode/src/index.ts'),
      '@tsvm/ir': path.resolve(rootDir, 'packages/ir/src/index.ts'),
      '@tsvm/core': path.resolve(rootDir, 'packages/core/src/index.ts'),
      '@tsvm/transforms': path.resolve(rootDir, 'packages/transforms/src/index.ts'),
      '@tsvm/ts-semantics': path.resolve(rootDir, 'packages/ts-semantics/src/index.ts'),
      '@tsvm/vm-runtime': path.resolve(rootDir, 'packages/vm-runtime/src/index.ts'),
      '@tsvm/react-safe': path.resolve(rootDir, 'packages/react-safe/src/index.ts'),
      '@tsvm/electron-hardening': path.resolve(rootDir, 'packages/electron-hardening/src/index.ts'),
      '@tsvm/benchmark': path.resolve(rootDir, 'packages/benchmark/src/index.ts'),
      '@tsvm/cli': path.resolve(rootDir, 'packages/cli/src/cli.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.d.ts', '**/index.ts'],
    },
    testTimeout: 30_000,
    pool: 'forks',
  },
});
