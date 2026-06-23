#!/usr/bin/env node
import { program as baseProgram } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
import { createRequire } from 'module';
import { ObfuscationPipeline, createDefaultProfile } from '@tsvm/core';
import type { ObfuscationProfile } from '@tsvm/shared';
import {
  applyRuntimeBackendToProfile,
  applyRuntimeHardeningToProfile,
  applySeedToProfile,
  parseRuntimeBackend,
  resolveRuntimeHardening,
  parseSeed,
  resolveProfileTarget,
  detectProfileFromProjectSync,
} from './options.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

export function createCliProfile(
  profileOption: string,
  seedOption?: string,
  runtimeOption?: string,
  hardeningOption?: string,
  flags: { readonly debugVm?: boolean; readonly paranoid?: boolean } = {},
  tsconfigPath?: string,
): ObfuscationProfile {
  const target = resolveProfileTarget(profileOption, tsconfigPath);
  const seed = parseSeed(seedOption);
  const baseProfile = createDefaultProfile(target);
  const runtimeBackend = parseRuntimeBackend(runtimeOption);
  const runtimeHardening = resolveRuntimeHardening(hardeningOption, flags);

  return applyRuntimeHardeningToProfile(
    applyRuntimeBackendToProfile(applySeedToProfile(baseProfile, seed), runtimeBackend),
    runtimeHardening,
  );
}

export function createProgram() {
  return baseProgram
    .name('ts-obfuscate')
    .description('TypeScript semantic-aware obfuscator — compiles selected functions to custom bytecode inside a polymorphic VM runtime')
    .addHelpText(
      'after',
      `
Examples:
  # Basic usage with a TypeScript project
  $ ts-obfuscate -p tsconfig.json
  $ ts-obfuscate -p tsconfig.json --out dist-obf

  # Profile selection
  $ ts-obfuscate -p tsconfig.json --profile generic    # General purpose (default)
  $ ts-obfuscate -p tsconfig.json --profile universal  # Full auto: vm-safe + js-lowered tiers
  $ ts-obfuscate -p tsconfig.json --profile react      # React-safe profile
  $ ts-obfuscate -p tsconfig.json --profile electron   # Electron-hardened profile

  # Runtime & hardening
  $ ts-obfuscate -p tsconfig.json --runtime js              # JS VM (default)
  $ ts-obfuscate -p tsconfig.json --runtime wasm-hybrid     # WASM bootstrap + JS executor
  $ ts-obfuscate -p tsconfig.json --hardening stealth       # Production-safe (default)
  $ ts-obfuscate -p tsconfig.json --hardening paranoid      # + anti-debug timing probes
  $ ts-obfuscate -p tsconfig.json --hardening off           # Debug-friendly (no hardening)

  # Deterministic builds (same seed = same bytecode)
  $ ts-obfuscate -p tsconfig.json --seed 42

  # Shorthand flags
  $ ts-obfuscate -p tsconfig.json --debug-vm    # --hardening off
  $ ts-obfuscate -p tsconfig.json --paranoid     # --hardening paranoid

  # Development flow
  $ pnpm cli -p examples/basic-ts/tsconfig.json --profile universal

  # Run with npx (after npm publish)
  $ npx @tsvm/cli -p tsconfig.json

Profiles:
  generic     General-purpose obfuscation with recommended transforms
  react       React-safe: hooks, JSX, components stay native
  electron    Electron-hardened: IPC, contextBridge protections
  library     Library-safe: preserves public API shape
  universal   Full automatic: vm-safe + js-lowered tiers, ESM output

Runtime backends:
  js             Pure JavaScript VM (default, most stable)
  wasm-hybrid    WASM bootstrap + JS VM semantic executor (aliases: wasm, hybrid)

Hardening levels:
  off       No hardening, plain VM shape (debug-friendly)
  stealth   Indirect threaded dispatch, intrinsic snapshots, tamper checks (default)
  paranoid  All stealth features + anti-debug timing probes

Virtualization:
  Mark functions with /** @virtualize */ in your TypeScript source.
  The pipeline compiles only annotated functions to bytecode;
  everything else stays 100% native.

Output:
  By default writes to ./dist-obf/ as .js (generic) or .mjs (universal) files.
  A .report.json file is also generated with per-function tier information.

  AI/CI: Use --out for deterministic output paths.
  CI:     Use --seed for reproducible builds.
`,
    )
    .version(pkg.version)
    .requiredOption('-p, --project <path>', 'path to tsconfig.json')
    .option('-o, --out <dir>', 'output directory (default: dist-obf)', 'dist-obf')
    .option('--profile <type>', 'obfuscation profile: auto, generic, react, electron, library, universal', 'auto')
    .option('--runtime <backend>', 'VM runtime backend: js, wasm-hybrid (aliases: wasm, hybrid)', 'js')
    .option('--hardening <level>', 'VM hardening: off, stealth, paranoid (aliases: debug, max)', 'stealth')
    .option('--debug-vm', 'alias for --hardening off')
    .option('--paranoid', 'alias for --hardening paranoid')
    .option('--seed <number>', 'random seed for deterministic polymorphic generation')
    .action(async (options) => {
      const spinner = ora('Initializing pipeline...').start();
      try {
        const tsconfigPath = path.resolve(process.cwd(), options.project);
        const outDir = path.resolve(process.cwd(), options.out);

        let displayTarget = options.profile;
        if (displayTarget === 'auto' || displayTarget === 'default') {
          const detected = detectProfileFromProjectSync(tsconfigPath);
          spinner.info(chalk.blue(`[tsvm] Auto-detected profile: ${detected} (resolved from project dependencies)`));
          spinner.start('Initializing pipeline...');
          displayTarget = detected;
        }

        const profile = createCliProfile(
          options.profile,
          options.seed,
          options.runtime,
          options.hardening,
          {
            debugVm: options.debugVm,
            paranoid: options.paranoid,
          },
          tsconfigPath,
        );

        const pipeline = new ObfuscationPipeline({
          tsconfigPath,
          profile,
          outDir,
        });

        spinner.text = 'Running obfuscation pipeline...';
        const result = await pipeline.execute();

        if (!result.success) {
          spinner.fail('Pipeline execution failed.');
          for (const diag of result.diagnostics) {
            console.error(`[${diag.code}] ${diag.message}`);
          }
          process.exit(1);
        }

        spinner.text = 'Writing output...';
        await fs.mkdir(outDir, { recursive: true });

        if (result.manifest.functionReports && result.manifest.functionReports.length > 0) {
          const reportPath = path.join(outDir, `${result.manifest.buildId}.report.json`);
          await fs.writeFile(reportPath, JSON.stringify(result.manifest.functionReports, null, 2), 'utf-8');
        }

        if (result.vmBundles) {
          const outputExtension = profile.target === 'universal' ? '.mjs' : '.js';
          for (const bundle of result.vmBundles) {
            const filePath = path.join(outDir, `${bundle.buildId}${outputExtension}`);
            await fs.writeFile(filePath, bundle.fullSource, 'utf-8');
          }
        }

        spinner.succeed(chalk.green(`Successfully obfuscated to ${outDir}`));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        spinner.fail(chalk.red(`Obfuscation failed: ${message}`));
        console.error(err);
        process.exit(1);
      }
    });
}

const isDirectExecution = typeof process.argv[1] === 'string' && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectExecution) {
  createProgram().parse(process.argv);
}
