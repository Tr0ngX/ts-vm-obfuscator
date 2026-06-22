/**
 * @tsvm/core — Pipeline orchestrator for ts-vm-obfuscator.
 *
 * This module wires together the entire obfuscation pipeline:
 *   1. Semantic analysis (read TS project, extract type facts, module graph)
 *   2. IR lowering (convert semantic graph to intermediate representation)
 *   3. Transform execution (apply obfuscation passes in priority order)
 *   4. Bytecode compilation (compile IR to bytecode module)
 *   5. VM build (generate polymorphic JavaScript VM runtime)
 *   6. Optional: benchmark, React-safe checks, Electron hardening
 *
 * Architecture decision: selected-region virtualization (not whole-program)
 *   - Whole-program VM would impose unacceptable runtime overhead for React/web apps
 *   - Selected-region lets developers annotate or configure which functions to virtualize
 *   - Non-virtualized code still gets semantic transforms (symbol indirection, string pool, etc.)
 *   - This keeps bundle sizes reasonable and preserves tree-shaking
 *
 * VM architecture: register-based hybrid
 *   - Register-based is more efficient than stack-based for JS target
 *   - Hybrid: uses registers for locals + implicit operand stack for complex expressions
 *   - Polymorphic: opcode mapping, encoding, handler layout all randomized per build
 */

import {
  DiagnosticSeverity,
  ImmediateEncodingScheme,
  ConstantEncodingScheme,
} from '@tsvm/shared';
import type {
  ObfuscationProfile,
  ProjectSemanticGraph,
  IRModule,
  BytecodeModule,
  VMRuntimeBundle,
  BuildManifest,
  PipelineEvent,
  PipelineEventHandler,
  PipelineStage,
  Diagnostic,
  SeededRandom,
  BenchmarkSuiteResult,
  TransformPass,
  TransformContext,
  SymbolAlias,
  ElectronAuditReport,
  ReactComponentInfo,
  FunctionCapabilityReport,
} from '@tsvm/shared';
import { buildUniversalBundle } from './universal-bundler.js';

export { SeededRandom } from '@tsvm/shared';

function getUniversalOutputExtension(profile: ObfuscationProfile): '.js' | '.mjs' {
  return profile.target === 'universal' ? '.mjs' : '.js';
}

// ─────────────────────────────────────────────────────────────
// Pipeline Configuration
// ─────────────────────────────────────────────────────────────

export interface PipelineOptions {
  /** Absolute path to tsconfig.json. */
  readonly tsconfigPath: string;

  /** Obfuscation profile to apply. */
  readonly profile: ObfuscationProfile;

  /** Output directory for generated files. */
  readonly outDir: string;

  /** Event handler for pipeline progress. */
  readonly onEvent?: PipelineEventHandler;

  /** If true, run benchmarks after obfuscation. */
  readonly benchmark?: boolean;

  /** If true, generate visualization data alongside output. */
  readonly emitVisualizationData?: boolean;

  /** Override entry points (defaults to tsconfig "files" or auto-detect). */
  readonly entryPoints?: readonly string[];
}

// ─────────────────────────────────────────────────────────────
// Pipeline Result
// ─────────────────────────────────────────────────────────────

export interface PipelineResult {
  readonly success: boolean;
  readonly manifest: BuildManifest;
  readonly diagnostics: readonly Diagnostic[];
  readonly semanticGraph?: ProjectSemanticGraph;
  readonly irModules?: readonly IRModule[];
  readonly bytecodeModules?: readonly BytecodeModule[];
  readonly vmBundles?: readonly VMRuntimeBundle[];
  readonly benchmarkResults?: BenchmarkSuiteResult;
  readonly electronAudit?: ElectronAuditReport;
  readonly reactComponents?: readonly ReactComponentInfo[];
  readonly functionReports?: readonly FunctionCapabilityReport[];
}

// ─────────────────────────────────────────────────────────────
// Default Profiles
// ─────────────────────────────────────────────────────────────

export function createDefaultProfile(target: ObfuscationProfile['target']): ObfuscationProfile {
  const baseSeed = Date.now();

  const baseTransforms = [
    { name: 'InstructionSubstitutionPass', enabled: true, options: {} },
    { name: 'SymbolIndirectionPass', enabled: true, options: {} },
    { name: 'StringPoolEncodingPass', enabled: true, options: {} },
    { name: 'FunctionVirtualizationPass', enabled: true, options: {} },
    { name: 'DeadCodeInjectionPass', enabled: true, options: {} },
    { name: 'ControlFlowFlatteningPass', enabled: true, options: {} },
    { name: 'PreserveTypeIllusionsPass', enabled: true, options: {} },
    { name: 'TypeLevelFakePathPass', enabled: true, options: {} },
    { name: 'DecoratorAwareLoweringPass', enabled: true, options: {} },
    { name: 'GenericConfusionPass', enabled: true, options: {} },
    { name: 'NamespaceVirtualizationPass', enabled: true, options: {} },
    { name: 'StripDebugPass', enabled: true, options: {} },
    { name: 'RegisterCompactingPass', enabled: true, options: {} },
    { name: 'IRValidationPass', enabled: true, options: {} },
  ] as const;

  switch (target) {
    case 'react':
      return {
        name: 'react-safe',
        target: 'react',
        transforms: baseTransforms.map((t) =>
          t.name === 'FunctionVirtualizationPass'
            ? { ...t, options: { excludeComponents: true, excludeHooks: true } }
            : t,
        ),
        virtualization: {
          mode: 'annotated',
          annotations: ['@virtualize'],
          maxFunctionSize: 200,
          excludePatterns: ['**/components/**', '**/hooks/**'],
        },
        vm: createDefaultVMConfig(baseSeed),
        preservePatterns: ['**/*.d.ts', '**/*.test.*'],
        preserveExports: true,
        preserveDecorators: false,
        reactSafe: true,
        electronHarden: false,
        deterministic: false,
        seed: baseSeed,
      };

    case 'electron':
      return {
        name: 'electron-hardened',
        target: 'electron',
        transforms: baseTransforms,
        virtualization: {
          mode: 'selected',
          annotations: ['@virtualize'],
          maxFunctionSize: 500,
          excludePatterns: ['**/preload/**'],
        },
        vm: createDefaultVMConfig(baseSeed),
        preservePatterns: ['**/*.d.ts', '**/*.test.*'],
        preserveExports: false,
        preserveDecorators: true,
        reactSafe: false,
        electronHarden: true,
        deterministic: false,
        seed: baseSeed,
      };

    case 'library':
      return {
        name: 'library-safe',
        target: 'library',
        transforms: baseTransforms.map((t) =>
          t.name === 'FunctionVirtualizationPass' ? { ...t, enabled: false } : t,
        ),
        virtualization: {
          mode: 'none',
          annotations: [],
          maxFunctionSize: 0,
          excludePatterns: [],
        },
        vm: createDefaultVMConfig(baseSeed),
        preservePatterns: ['**/*.d.ts', '**/*.test.*'],
        preserveExports: true,
        preserveDecorators: true,
        reactSafe: false,
        electronHarden: false,
        deterministic: false,
        seed: baseSeed,
      };

    case 'universal':
      return {
        name: 'universal-compat',
        target: 'universal',
        transforms: baseTransforms,
        virtualization: {
          mode: 'whole_program',
          annotations: [],
          maxFunctionSize: 2_000,
          excludePatterns: [],
          compatibilityFallback: true,
        },
        vm: createDefaultVMConfig(baseSeed),
        preservePatterns: ['**/*.d.ts', '**/*.test.*'],
        preserveExports: true,
        preserveDecorators: true,
        reactSafe: false,
        electronHarden: false,
        deterministic: false,
        seed: baseSeed,
      };

    case 'generic':
    default:
      return {
        name: 'generic',
        target: 'generic',
        transforms: baseTransforms,
        virtualization: {
          mode: 'selected',
          annotations: ['@virtualize'],
          maxFunctionSize: 500,
          excludePatterns: [],
        },
        vm: createDefaultVMConfig(baseSeed),
        preservePatterns: ['**/*.d.ts', '**/*.test.*'],
        preserveExports: false,
        preserveDecorators: false,
        reactSafe: false,
        electronHarden: false,
        deterministic: false,
        seed: baseSeed,
      };
  }
}

function createDefaultVMConfig(seed: number): import('@tsvm/shared').VMBuildConfig {
  return {
    opcodeRemapping: true,
    immediateEncoding: ImmediateEncodingScheme.XorMasked,
    superInstructions: true,
    handlerLayoutRandom: true,
    constantPoolEncoding: ConstantEncodingScheme.XorRotate,
    traceMode: false,
    deterministicReplay: false,
    seed,
    runtimeHardening: 'stealth',
    stealthDispatch: true,
    tamperDetection: true,
    antiDebug: false,
    junkInsertion: true,
    rollingKeys: true,
  };
}

// ─────────────────────────────────────────────────────────────
// Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────

export class ObfuscationPipeline {
  private readonly options: PipelineOptions;
  private readonly diagnostics: Diagnostic[] = [];

  constructor(options: PipelineOptions) {
    this.options = options;
  }

  private emit(stage: PipelineStage, message: string, durationMs?: number): void {
    if (this.options.onEvent) {
      this.options.onEvent({
        stage,
        message,
        timestamp: Date.now(),
        durationMs,
      });
    }
  }

  private emitError(stage: PipelineStage, message: string, error: unknown): void {
    let errorMessage = '';
    if (error instanceof Error) {
      errorMessage = `${error.message}\n${error.stack}`;
    } else if (error && typeof error === 'object') {
      const obj = error as Record<string, unknown>;
      errorMessage = String(obj?.['stack'] ?? obj?.['message'] ?? JSON.stringify(obj) ?? String(error));
    } else {
      errorMessage = String(error);
    }
    this.diagnostics.push({
      severity: 0 as DiagnosticSeverity, // Error
      code: `PIPELINE_${stage.toUpperCase()}`,
      message: `${message}: ${errorMessage}`,
    });
    this.emit(stage, `ERROR: ${message}: ${errorMessage}`);
  }

  /**
   * Execute the full obfuscation pipeline.
   *
   * The pipeline is intentionally sequential — each stage depends on the
   * output of the previous stage. Parallelism happens *within* stages
   * (e.g., transforms can be parallelized across modules).
   */
  async execute(): Promise<PipelineResult> {
    const startTime = Date.now();
    const buildId = `build_${this.options.profile.seed}_${startTime}`;

    // ── Stage 1: Semantic Analysis ──
    this.emit('semantic_analysis' as PipelineStage, 'Starting semantic analysis...');
    let semanticGraph: ProjectSemanticGraph;
    try {
      const { analyzeProject } = await import('@tsvm/ts-semantics');
      const t0 = Date.now();
      semanticGraph = analyzeProject(this.options.tsconfigPath, this.options.entryPoints);
      this.emit('semantic_analysis' as PipelineStage, 'Semantic analysis complete', Date.now() - t0);
    } catch (error: unknown) {
      this.emitError('semantic_analysis' as PipelineStage, 'Semantic analysis failed', error);
      return this.failResult(buildId, startTime);
    }

    // ── Stage 2: IR Lowering ──
    this.emit('ir_lowering' as PipelineStage, 'Lowering to IR...');
    let irModules: IRModule[];
    let functionReports: FunctionCapabilityReport[] | undefined;
    try {
      const { analyzeFunctionCapabilities, analyzeTopLevelFunctionCapabilities, lowerToIR } = await import('@tsvm/ir');
      const t0 = Date.now();
      irModules = [];
      if (this.options.profile.target === 'universal') {
        functionReports = [];
      }
      for (const [filePath, moduleInfo] of semanticGraph.modules) {
        const universalTopLevelReports =
          this.options.profile.target === 'universal'
            ? analyzeTopLevelFunctionCapabilities(filePath)
            : [];
        if (functionReports) {
          functionReports.push(...analyzeFunctionCapabilities(filePath));
        }
        const forcedVmSafeFunctionNames = new Set(
          universalTopLevelReports
            .filter((report) => report.tier === 'vm_safe')
            .map((report) => report.functionName),
        );
        const skippedJsLoweredFunctionNames = new Set(
          universalTopLevelReports
            .filter((report) => report.tier === 'js_lowered')
            .map((report) => report.functionName),
        );
        const unsupportedTopLevelReports = universalTopLevelReports.filter((report) => report.tier === 'unsupported');
        for (const report of unsupportedTopLevelReports) {
          this.diagnostics.push({
            severity: DiagnosticSeverity.Error,
            code: 'UNIVERSAL_UNSUPPORTED_FUNCTION',
            message: `Universal profile cannot lower function "${report.functionName}" in ${report.filePath}:${report.startLine}:${report.startColumn}: ${report.reasons.join(', ')}`,
          });
        }
        const irModule = lowerToIR(moduleInfo, semanticGraph, filePath, {
          forceVirtualizeAll: this.options.profile.virtualization.mode === 'whole_program',
          forceVirtualizeFunctionNames: forcedVmSafeFunctionNames,
          skipTopLevelFunctionNames: skippedJsLoweredFunctionNames,
          compatibilityFallback: this.options.profile.target === 'universal'
            ? false
            : this.options.profile.virtualization.compatibilityFallback,
          diagnostics: this.diagnostics,
        });
        irModules.push(irModule);
      }
      this.emit('ir_lowering' as PipelineStage, `Lowered ${irModules.length} modules to IR`, Date.now() - t0);
    } catch (error: unknown) {
      this.emitError('ir_lowering' as PipelineStage, 'IR lowering failed', error);
      return this.failResult(buildId, startTime, { semanticGraph });
    }

    // ── Stage 3: React-Safe Analysis (if enabled) ──
    let reactComponents: ReactComponentInfo[] | undefined;
    if (this.options.profile.reactSafe) {
      this.emit('transform_execution' as PipelineStage, 'Running React safety analysis...');
      try {
        const { collectReactComponentInfo, createReactSafetyDiagnostics, enforceReactProfile } = await import('@tsvm/react-safe');
        reactComponents = [];
        for (const irModule of irModules) {
          reactComponents.push(...collectReactComponentInfo(irModule.functions, irModule.sourceFile));
          this.diagnostics.push(...createReactSafetyDiagnostics(irModule.functions, irModule.sourceFile));
          enforceReactProfile(irModule.functions, irModule.constantPool);
        }
        this.emit(
          'transform_execution' as PipelineStage,
          `Applied React safety profile to ${reactComponents.length} React-sensitive functions`,
        );
      } catch (error: unknown) {
        this.emitError('transform_execution' as PipelineStage, 'React safety analysis failed', error);
        return this.failResult(buildId, startTime, { semanticGraph, irModules });
      }
    }

    // ── Stage 4: Transform Execution ──
    this.emit('transform_execution' as PipelineStage, 'Executing transform passes...');
    try {
      const { createTransformRegistry } = await import('@tsvm/transforms');
      const registry = createTransformRegistry(this.options.profile);
      const { SeededRandom: SRandom } = await import('@tsvm/shared');
      const rng = new SRandom(this.options.profile.seed);

      const t0 = Date.now();
      for (let i = 0; i < irModules.length; i++) {
        const ctx: TransformContext = {
          module: irModules[i]!,
          profile: this.options.profile,
          semanticGraph,
          symbolAliases: semanticGraph.aliases,
          diagnostics: [],
          rng,
          phase: 0,
        };

        for (const pass of registry.getOrderedPasses()) {
          const result = pass.execute(ctx);
          irModules[i] = result.module;
          this.diagnostics.push(...result.diagnostics);
          (ctx as { module: IRModule }).module = result.module;
        }
      }
      this.emit('transform_execution' as PipelineStage, 'Transforms complete', Date.now() - t0);
    } catch (error: unknown) {
      this.emitError('transform_execution' as PipelineStage, 'Transform execution failed', error);
      return this.failResult(buildId, startTime, { semanticGraph, irModules });
    }

    // ── Stage 5: Bytecode Compilation ──
    this.emit('bytecode_compilation' as PipelineStage, 'Compiling to bytecode...');
    let bytecodeModules: BytecodeModule[];
    const bytecodeSourceFiles = new Map<string, string>();
    try {
      const { compileToBytecode } = await import('@tsvm/bytecode');
      const t0 = Date.now();
      bytecodeModules = [];
      for (const irModule of irModules) {
        const virtualizedFunctions = irModule.functions.filter((f) => f.isVirtualized);
        if (virtualizedFunctions.length > 0) {
          const bcModule = compileToBytecode(irModule, this.options.profile.vm);
          bytecodeModules.push(bcModule);
          bytecodeSourceFiles.set(bcModule.buildId, irModule.sourceFile);
        }
      }
      this.emit(
        'bytecode_compilation' as PipelineStage,
        `Compiled ${bytecodeModules.length} bytecode modules`,
        Date.now() - t0,
      );
    } catch (error: unknown) {
      this.emitError('bytecode_compilation' as PipelineStage, 'Bytecode compilation failed', error);
      return this.failResult(buildId, startTime, { semanticGraph, irModules });
    }

    // ── Stage 6: VM Build ──
    const runtimeBackend = this.options.profile.vm.runtimeBackend ?? 'js';
    this.emit('vm_build' as PipelineStage, `Building ${runtimeBackend} VM runtime...`);
    let vmBundles: VMRuntimeBundle[];
    try {
      const t0 = Date.now();
      vmBundles = [];
      const buildRuntime =
        runtimeBackend === 'wasm_hybrid'
          ? (await import('@tsvm/wasm-runtime')).buildWasmHybridRuntime
          : (await import('@tsvm/vm-runtime')).buildVMRuntime;
      for (const bcModule of bytecodeModules) {
        const bundle = buildRuntime(bcModule, this.options.profile.vm);
        vmBundles.push(bundle);
      }
      this.emit('vm_build' as PipelineStage, `Built ${vmBundles.length} VM bundles`, Date.now() - t0);
    } catch (error: unknown) {
      this.emitError('vm_build' as PipelineStage, 'VM build failed', error);
      return this.failResult(buildId, startTime, { semanticGraph, irModules, bytecodeModules });
    }

    if (this.options.profile.target === 'universal') {
      const vmBundleByFile = new Map<string, VMRuntimeBundle>();
      for (const bundle of vmBundles) {
        const matchedPath = bytecodeSourceFiles.get(bundle.buildId);
        if (matchedPath) {
          vmBundleByFile.set(matchedPath, bundle);
        }
      }

      const universalBundles: VMRuntimeBundle[] = [];
      for (const [filePath, moduleInfo] of semanticGraph.modules) {
        const reportsForFile = functionReports?.filter((report) => report.filePath === filePath) ?? [];
        if (moduleInfo.exports.length === 0 && reportsForFile.length === 0) {
          continue;
        }
        universalBundles.push(
          buildUniversalBundle(
            `${buildId}_${moduleInfo.relativePath.replace(/[\\/]/g, '_').replace(/[^a-zA-Z0-9_.-]/g, '_')}`,
            moduleInfo,
            semanticGraph.compilerOptions,
            reportsForFile,
            vmBundleByFile.get(filePath),
          ),
        );
      }
      vmBundles = universalBundles;
      this.emit('vm_build' as PipelineStage, `Built ${vmBundles.length} universal compatibility bundles`);
    }

    // ── Stage 7: Electron Hardening (if enabled) ──
    let electronAudit: ElectronAuditReport | undefined;
    if (this.options.profile.electronHarden) {
      try {
        const { applyElectronHardening } = await import('@tsvm/electron-hardening');
        for (let i = 0; i < irModules.length; i++) {
          irModules[i] = applyElectronHardening(irModules[i]!);
        }
        this.emit('vm_build' as PipelineStage, `Applied Electron hardening rules`);
      } catch (error: unknown) {
        this.emitError('vm_build' as PipelineStage, 'Electron hardening failed', error);
      }
    }

    // Benchmark was removed to avoid circular dependencies.
    // It should be run externally.
    let benchmarkResults: BenchmarkSuiteResult | undefined;

    // ── Build Manifest ──
    const manifest: BuildManifest = {
      buildId,
      timestamp: startTime,
      profile: this.options.profile,
      inputFiles: Array.from(semanticGraph.modules.keys()),
      outputFiles: vmBundles.map((b) => `${this.options.outDir}/${b.buildId}${getUniversalOutputExtension(this.options.profile)}`),
      seed: this.options.profile.seed,
      diagnostics: this.diagnostics,
      metrics: [],
      functionReports,
    };

    return {
      success: this.diagnostics.filter((d) => d.severity === (0 as DiagnosticSeverity)).length === 0,
      manifest,
      diagnostics: this.diagnostics,
      semanticGraph,
      irModules,
      bytecodeModules,
      vmBundles,
      benchmarkResults,
      electronAudit,
      reactComponents,
      functionReports,
    };
  }

  private failResult(
    buildId: string,
    startTime: number,
    partial?: Partial<Pick<PipelineResult, 'semanticGraph' | 'irModules' | 'bytecodeModules'>>,
  ): PipelineResult {
    return {
      success: false,
      manifest: {
        buildId,
        timestamp: startTime,
        profile: this.options.profile,
        inputFiles: [],
        outputFiles: [],
        seed: this.options.profile.seed,
        diagnostics: this.diagnostics,
        metrics: [],
        functionReports: [],
      },
      diagnostics: this.diagnostics,
      ...partial,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// Convenience API
// ─────────────────────────────────────────────────────────────

/**
 * One-shot obfuscation of a TypeScript project.
 *
 * @param tsconfigPath - Absolute path to tsconfig.json
 * @param outDir - Output directory
 * @param profile - Obfuscation profile (use createDefaultProfile for defaults)
 * @param onEvent - Optional progress callback
 */
export async function obfuscate(
  tsconfigPath: string,
  outDir: string,
  profile?: ObfuscationProfile,
  onEvent?: PipelineEventHandler,
): Promise<PipelineResult> {
  const resolvedProfile = profile ?? createDefaultProfile('generic');
  const pipeline = new ObfuscationPipeline({
    tsconfigPath,
    profile: resolvedProfile,
    outDir,
    onEvent,
  });
  return pipeline.execute();
}

export type {
  ObfuscationProfile,
  ProjectSemanticGraph,
  IRModule,
  BytecodeModule,
  VMRuntimeBundle,
  BuildManifest,
  PipelineEvent,
  PipelineEventHandler,
  TransformPass,
  TransformContext,
  BenchmarkSuiteResult,
  ElectronAuditReport,
  ReactComponentInfo,
  Diagnostic,
} from '@tsvm/shared';
