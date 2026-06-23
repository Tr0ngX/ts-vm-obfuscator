#!/usr/bin/env node
import { program as baseProgram } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs/promises';
import { pathToFileURL } from 'url';
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
} from './options.js';

export function createCliProfile(
  profileOption: string,
  seedOption?: string,
  runtimeOption?: string,
  hardeningOption?: string,
  flags: { readonly debugVm?: boolean; readonly paranoid?: boolean } = {},
): ObfuscationProfile {
  const target = resolveProfileTarget(profileOption);
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
    .description('TypeScript semantic-aware obfuscator')
    .addHelpText(
      'after',
      `

Examples:
  $ ts-obfuscate -p examples/basic-ts/tsconfig.json
  $ ts-obfuscate -p examples/st/tsconfig.json --runtime wasm --hardening max
  $ ts-obfuscate -p examples/st/tsconfig.json --debug-vm

Runtime notes:
  --runtime js            Stable generated JavaScript VM backend
  --runtime wasm-hybrid   WASM bootstrap + JS VM semantic executor
  --hardening stealth     Default production-safe runtime hardening
  --hardening paranoid    Adds heavier anti-debug probes
  --debug-vm              Alias for --hardening off
`,
    )
    .version('0.1.0')
    .requiredOption('-p, --project <path>', 'path to tsconfig.json')
    .option('-o, --out <dir>', 'output directory', 'dist-obf')
    .option('--profile <type>', 'obfuscation profile (default, generic, react, electron, library, universal)', 'default')
    .option('--runtime <backend>', 'VM runtime backend: js, wasm-hybrid (aliases: wasm, hybrid)', 'js')
    .option('--hardening <level>', 'VM hardening level: off, stealth, paranoid (aliases: debug, max)', 'stealth')
    .option('--debug-vm', 'debug-friendly alias for --hardening off')
    .option('--paranoid', 'shortcut for --hardening paranoid')
    .option('--seed <number>', 'random seed for polymorphic generation')
    .action(async (options) => {
      const spinner = ora('Initializing pipeline...').start();
      try {
        const tsconfigPath = path.resolve(process.cwd(), options.project);
        const outDir = path.resolve(process.cwd(), options.out);
        const profile = createCliProfile(options.profile, options.seed, options.runtime, options.hardening, {
          debugVm: options.debugVm,
          paranoid: options.paranoid,
        });

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
