#!/usr/bin/env node
import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import path from 'path';
import fs from 'fs/promises';
import { ObfuscationPipeline, createDefaultProfile } from '@tsvm/core';

program
  .name('ts-obfuscate')
  .description('TypeScript semantic-aware obfuscator')
  .version('0.1.0')
  .requiredOption('-p, --project <path>', 'path to tsconfig.json')
  .option('-o, --out <dir>', 'output directory', 'dist-obf')
  .option('--profile <type>', 'obfuscation profile (default, react-safe, max)', 'default')
  .option('--seed <number>', 'random seed for polymorphic generation')
  .action(async (options) => {
    const spinner = ora('Initializing pipeline...').start();
    try {
      const tsconfigPath = path.resolve(process.cwd(), options.project);
      const outDir = path.resolve(process.cwd(), options.out);
      
      const seed = options.seed ? parseInt(options.seed, 10) : Math.floor(Math.random() * 1000000);

      const profile = createDefaultProfile(
        ['react', 'electron', 'library', 'generic'].includes(options.profile) ? options.profile : 'generic'
      );

      const pipeline = new ObfuscationPipeline({
        tsconfigPath,
        profile,
        outDir
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
      
      if (result.vmBundles) {
        for (const bundle of result.vmBundles) {
          const filePath = path.join(outDir, `${bundle.buildId}.js`);
          await fs.writeFile(filePath, bundle.fullSource, 'utf-8');
        }
      }

      spinner.succeed(chalk.green(`Successfully obfuscated to ${outDir}`));
    } catch (err: any) {
      spinner.fail(chalk.red(`Obfuscation failed: ${err.message}`));
      console.error(err);
      process.exit(1);
    }
  });

program.parse(process.argv);
