/**
 * @tsvm/shared — Canonical type definitions for the ts-vm-obfuscator pipeline.
 *
 * Data flow:
 *   TS Source → ProjectSemanticGraph → IRModule → TransformPass[] → BytecodeModule → VM Runtime
 *
 * Every package in the monorepo imports types from here.
 * No runtime logic lives in this package — pure types + tiny utilities.
 */

// ─────────────────────────────────────────────────────────────
// §1  Source Location & Diagnostics
// ─────────────────────────────────────────────────────────────

export interface SourceLocation {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly offset: number;
  readonly length: number;
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Info = 2,
  Hint = 3,
}

export interface Diagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly location?: SourceLocation;
  readonly relatedLocations?: readonly SourceLocation[];
}

// ─────────────────────────────────────────────────────────────
// §2  Semantic Graph  (output of @tsvm/ts-semantics)
// ─────────────────────────────────────────────────────────────

export enum TypeFactKind {
  Variable = 'variable',
  Function = 'function',
  Class = 'class',
  Interface = 'interface',
  TypeAlias = 'type_alias',
  Enum = 'enum',
  Namespace = 'namespace',
  Parameter = 'parameter',
  Property = 'property',
  Method = 'method',
  Accessor = 'accessor',
  Constructor = 'constructor',
}

export enum ScopeKind {
  Global = 'global',
  Module = 'module',
  Function = 'function',
  Block = 'block',
  Class = 'class',
  Namespace = 'namespace',
}

export interface TypeFact {
  readonly symbolName: string;
  readonly symbolId: number;
  readonly kind: TypeFactKind;
  readonly typeText: string;
  readonly flags: number; // ts.TypeFlags bitmask
  readonly isGeneric: boolean;
  readonly typeParameters: readonly string[];
  readonly constraints: readonly string[];
  readonly sourceLocation: SourceLocation;
  readonly isExported: boolean;
  readonly isAmbient: boolean;
  readonly decorators: readonly string[];
}

export interface ExportedSymbol {
  readonly localName: string;
  readonly exportedName: string;
  readonly kind: TypeFactKind;
  readonly isTypeOnly: boolean;
  readonly isDefault: boolean;
  readonly isReExport: boolean;
  readonly sourceModule?: string;
}

export interface ImportedSymbol {
  readonly localName: string;
  readonly importedName: string;
  readonly moduleSpecifier: string;
  readonly kind: 'named' | 'default' | 'namespace' | 'side_effect';
  readonly isTypeOnly: boolean;
  readonly resolvedPath?: string;
}

export interface DependencyEdge {
  readonly fromModule: string;
  readonly toModule: string;
  readonly symbols: readonly string[];
  readonly isTypeOnly: boolean;
  readonly isDynamic: boolean;
}

export interface ModuleInfo {
  readonly filePath: string;
  readonly relativePath: string;
  readonly exports: readonly ExportedSymbol[];
  readonly imports: readonly ImportedSymbol[];
  readonly typeFacts: readonly TypeFact[];
  readonly isEntryPoint: boolean;
  readonly isDeclarationFile: boolean;
  readonly hasJSX: boolean;
  readonly hasDecorators: boolean;
  readonly byteSize: number;
}

export interface SymbolAlias {
  readonly originalName: string;
  readonly obfuscatedName: string;
  readonly scope: ScopeKind;
  readonly symbolId: number;
  readonly isExported: boolean;
  readonly preserveReason?: string;
}

export interface ProjectSemanticGraph {
  readonly rootDir: string;
  readonly modules: ReadonlyMap<string, ModuleInfo>;
  readonly dependencyEdges: readonly DependencyEdge[];
  readonly entryPoints: readonly string[];
  readonly symbolTable: readonly TypeFact[];
  readonly aliases: Map<number, SymbolAlias>;
  readonly compilerOptions: Record<string, unknown>;
  readonly diagnostics: readonly Diagnostic[];
}

// ─────────────────────────────────────────────────────────────
// §3  Obfuscation Profile & Configuration
// ─────────────────────────────────────────────────────────────

export interface TransformPassConfig {
  readonly name: string;
  readonly enabled: boolean;
  readonly options: Record<string, unknown>;
}

export interface VirtualizationConfig {
  readonly mode: 'none' | 'selected' | 'annotated';
  readonly annotations: readonly string[];
  readonly maxFunctionSize: number;
  readonly excludePatterns: readonly string[];
}

export enum ConstantEncodingScheme {
  Identity = 0,
  XorRotate = 1,
  AffineTransform = 2,
  SplitMerge = 3,
}

export enum ImmediateEncodingScheme {
  Raw = 0,
  VariableLength = 1,
  XorMasked = 2,
  DeltaEncoded = 3,
}

export interface VMBuildConfig {
  readonly opcodeRemapping: boolean;
  readonly immediateEncoding: ImmediateEncodingScheme;
  readonly superInstructions: boolean;
  readonly handlerLayoutRandom: boolean;
  readonly constantPoolEncoding: ConstantEncodingScheme;
  readonly traceMode: boolean;
  readonly deterministicReplay: boolean;
  readonly seed: number;
}

export interface ObfuscationProfile {
  readonly name: string;
  readonly target: 'generic' | 'react' | 'electron' | 'library';
  readonly transforms: readonly TransformPassConfig[];
  readonly virtualization: VirtualizationConfig;
  readonly vm: VMBuildConfig;
  readonly preservePatterns: readonly string[];
  readonly preserveExports: boolean;
  readonly preserveDecorators: boolean;
  readonly reactSafe: boolean;
  readonly electronHarden: boolean;
  readonly deterministic: boolean;
  readonly seed: number;
}

// ─────────────────────────────────────────────────────────────
// §4  IR — Intermediate Representation
// ─────────────────────────────────────────────────────────────

export enum IRType {
  Void = 'void',
  Number = 'number',
  String = 'string',
  Boolean = 'boolean',
  Object = 'object',
  Array = 'array',
  Function = 'function',
  Any = 'any',
  Undefined = 'undefined',
  Null = 'null',
  Symbol = 'symbol',
  BigInt = 'bigint',
  Unknown = 'unknown',
}

export type Register = `r${number}`;

export enum OpCode {
  // Load/Store/Move
  LoadConst = 0x01,
  LoadLocal = 0x02,
  StoreLocal = 0x03,
  Move = 0x04,
  LoadGlobal = 0x05,
  StoreGlobal = 0x06,
  LoadCapture = 0x07,
  StoreCapture = 0x08,

  // Arithmetic
  Add = 0x10,
  Sub = 0x11,
  Mul = 0x12,
  Div = 0x13,
  Mod = 0x14,
  Neg = 0x15,
  BitAnd = 0x16,
  BitOr = 0x17,
  BitXor = 0x18,
  Shl = 0x19,
  Shr = 0x1A,
  UShr = 0x1B,

  // Comparison
  Eq = 0x20,
  StrictEq = 0x21,
  Lt = 0x22,
  LtEq = 0x23,
  Gt = 0x24,
  GtEq = 0x25,
  Not = 0x26,
  TypeOf = 0x27,
  InstanceOf = 0x28,
  In = 0x29,

  // Control flow
  Jmp = 0x30,
  JmpIf = 0x31,
  JmpIfNot = 0x32,
  Switch = 0x33,

  // Calls
  Call = 0x40,
  CallMethod = 0x41,
  New = 0x42,
  Return = 0x43,
  ReturnVoid = 0x44,
  TailCall = 0x45,

  // Object/Array
  PropGet = 0x50,
  PropSet = 0x51,
  ComputedGet = 0x52,
  ComputedSet = 0x53,
  ArrayNew = 0x54,
  ObjectNew = 0x55,
  Spread = 0x56,
  Delete = 0x57,

  // Special
  Phi = 0x60,
  Throw = 0x61,
  TryCatchBegin = 0x62,
  TryCatchEnd = 0x63,
  FinallyBegin = 0x64,
  FinallyEnd = 0x65,
  Yield = 0x66,
  Await = 0x67,
  Debugger = 0x68,

  // VM-specific
  Nop = 0xF0,
  Halt = 0xF1,
  Trap = 0xF2,
  SuperInstruction = 0xFE,
}

export enum OperandKind {
  Register = 'register',
  Immediate = 'immediate',
  ConstantIndex = 'constant_index',
  BlockLabel = 'block_label',
  FunctionRef = 'function_ref',
}

export interface Operand {
  readonly kind: OperandKind;
  readonly value: number | string;
}

export interface PhiNode {
  readonly result: Register;
  readonly incoming: readonly { readonly blockId: string; readonly register: Register }[];
}

export interface Instruction {
  readonly opcode: OpCode;
  readonly operands: readonly Operand[];
  readonly result?: Register;
  readonly sourceLocation?: SourceLocation;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TerminatorInstruction {
  readonly kind: 'jump' | 'branch' | 'return' | 'throw' | 'switch' | 'unreachable';
  readonly targets: readonly string[];
  readonly condition?: Register;
  readonly returnValue?: Register;
  readonly sourceLocation?: SourceLocation;
}

export interface BasicBlock {
  readonly id: string;
  readonly label: string;
  readonly instructions: readonly Instruction[];
  readonly terminator: TerminatorInstruction;
  readonly predecessors: readonly string[];
  readonly successors: readonly string[];
  readonly phiNodes: readonly PhiNode[];
}

export enum FunctionAttribute {
  Async = 'async',
  Generator = 'generator',
  Arrow = 'arrow',
  Method = 'method',
  Constructor = 'constructor',
  Getter = 'getter',
  Setter = 'setter',
  Static = 'static',
  ReactComponent = 'react_component',
  ReactHook = 'react_hook',
  Exported = 'exported',
  Virtualized = 'virtualized',
}

export interface IRParam {
  readonly name: string;
  readonly register: Register;
  readonly type: IRType;
  readonly isRest: boolean;
  readonly defaultValue?: number; // constant pool index
}

export interface IRLocal {
  readonly name: string;
  readonly register: Register;
  readonly type: IRType;
  readonly isCaptured: boolean;
}

export interface SourceMapping {
  readonly originalStart: SourceLocation;
  readonly originalEnd: SourceLocation;
  readonly generatedFunctionId: string;
}

export interface IRFunction {
  readonly id: string;
  readonly name: string;
  readonly params: readonly IRParam[];
  readonly returnType: IRType;
  readonly blocks: readonly BasicBlock[];
  readonly locals: readonly IRLocal[];
  readonly isVirtualized: boolean;
  readonly isExported: boolean;
  readonly sourceMap?: SourceMapping;
  readonly attributes: readonly FunctionAttribute[];
  readonly capturedVariables: readonly string[];
}

export interface IRGlobal {
  readonly name: string;
  readonly type: IRType;
  readonly initializer?: number; // constant pool index
  readonly isExported: boolean;
}

export interface IRImport {
  readonly localName: string;
  readonly importedName: string;
  readonly moduleSpecifier: string;
  readonly isTypeOnly: boolean;
}

export interface IRExport {
  readonly localName: string;
  readonly exportedName: string;
  readonly isDefault: boolean;
  readonly isTypeOnly: boolean;
}

export enum ConstantKind {
  Number = 'number',
  String = 'string',
  Boolean = 'boolean',
  Null = 'null',
  Undefined = 'undefined',
  BigInt = 'bigint',
  Regex = 'regex',
  Template = 'template',
}

export interface ConstantPoolEntry {
  readonly index: number;
  readonly kind: ConstantKind;
  readonly value: string | number | boolean | null;
  readonly encoding?: number;
}

export interface IRModuleMetadata {
  readonly sourceFile: string;
  readonly originalByteSize: number;
  readonly functionCount: number;
  readonly blockCount: number;
  readonly instructionCount: number;
  readonly buildTimestamp: number;
}

export interface IRModule {
  readonly id: string;
  readonly sourceFile: string;
  readonly functions: readonly IRFunction[];
  readonly globals: readonly IRGlobal[];
  readonly imports: readonly IRImport[];
  readonly exports: readonly IRExport[];
  readonly constantPool: readonly ConstantPoolEntry[];
  readonly metadata: IRModuleMetadata;
}

// ─────────────────────────────────────────────────────────────
// §5  Transform Pass System
// ─────────────────────────────────────────────────────────────

export interface TransformContext {
  readonly module: IRModule;
  readonly profile: ObfuscationProfile;
  readonly semanticGraph: ProjectSemanticGraph;
  readonly symbolAliases: Map<number, SymbolAlias>;
  readonly diagnostics: Diagnostic[];
  readonly rng: SeededRandom;
  readonly phase: number;
}

export interface TransformResult {
  readonly module: IRModule;
  readonly symbolsRenamed: number;
  readonly nodesTransformed: number;
  readonly diagnostics: readonly Diagnostic[];
}

export interface TransformPass {
  readonly name: string;
  readonly priority: number;
  execute(ctx: TransformContext): TransformResult;
  validate?(module: IRModule): readonly Diagnostic[];
}

// ─────────────────────────────────────────────────────────────
// §6  Bytecode Module
// ─────────────────────────────────────────────────────────────

export const BYTECODE_MAGIC = 0x54534F42; // 'TSOB'
export const BYTECODE_VERSION = 1;

export interface OpcodeMapping {
  readonly forward: ReadonlyMap<OpCode, number>;
  readonly reverse: ReadonlyMap<number, OpCode>;
  readonly seed: number;
}

export interface EncodedConstant {
  readonly index: number;
  readonly kind: ConstantKind;
  readonly encodedBytes: Uint8Array;
  readonly decodingKey: number;
}

export interface BytecodeFunction {
  readonly id: string;
  readonly name: string;
  readonly paramCount: number;
  readonly localCount: number;
  readonly maxRegisters: number;
  readonly bytecode: Uint8Array;
  readonly sourceMapOffset?: number;
  readonly isEntryPoint: boolean;
}

export interface BytecodeMetadata {
  readonly buildTimestamp: number;
  readonly buildId: string;
  readonly sourceHash: string;
  readonly profile: string;
  readonly deterministicSeed?: number;
}

export interface BytecodeModule {
  readonly magic: typeof BYTECODE_MAGIC;
  readonly version: typeof BYTECODE_VERSION;
  readonly buildId: string;
  readonly opcodeMapping: OpcodeMapping;
  readonly constantPool: readonly EncodedConstant[];
  readonly functions: readonly BytecodeFunction[];
  readonly entryPointIndex: number;
  readonly metadata: BytecodeMetadata;
}

// ─────────────────────────────────────────────────────────────
// §7  VM Build Configuration (polymorphic output)
// ─────────────────────────────────────────────────────────────

export interface VMHandlerDescriptor {
  readonly opcode: number;
  readonly canonicalOpcode: OpCode;
  readonly handlerCode: string;
  readonly position: number;
}

export interface VMRuntimeBundle {
  readonly buildId: string;
  readonly dispatchLoop: string;
  readonly handlers: readonly VMHandlerDescriptor[];
  readonly constantDecoder: string;
  readonly bytecodePayload: Uint8Array;
  readonly entryBootstrap: string;
  readonly fullSource: string;
}

// ─────────────────────────────────────────────────────────────
// §8  Benchmark System
// ─────────────────────────────────────────────────────────────

export interface BenchmarkMetric {
  readonly name: string;
  readonly value: number;
  readonly unit: string;
  readonly lowerIsBetter: boolean;
}

export interface BenchmarkCase {
  readonly id: string;
  readonly name: string;
  readonly category: 'typescript' | 'react' | 'electron';
  readonly sourceCode: string;
  readonly expectedBehavior: string;
  readonly metrics: readonly BenchmarkMetric[];
}

export interface BenchmarkResult {
  readonly caseId: string;
  readonly timestamp: number;
  readonly profile: string;
  readonly buildId: string;
  readonly syntaxPass: boolean;
  readonly buildPass: boolean;
  readonly semanticEquivalence: boolean;
  readonly runtimeOverheadMs: number;
  readonly sizeOverheadBytes: number;
  readonly sizeOverheadPercent: number;
  readonly metrics: readonly BenchmarkMetric[];
}

export interface ReverseAttemptResult {
  readonly caseId: string;
  readonly model: string;
  readonly tokensUsed: number;
  readonly wallClockMs: number;
  readonly syntaxRecovered: boolean;
  readonly semanticRecovery: number;
  readonly graphRecovery: number;
  readonly symbolRecovery: number;
  readonly humanReadabilityScore: number;
  readonly cfgEditDistance: number;
}

export interface BenchmarkSuiteResult {
  readonly suiteId: string;
  readonly timestamp: number;
  readonly cases: readonly BenchmarkResult[];
  readonly reverseAttempts: readonly ReverseAttemptResult[];
  readonly summary: BenchmarkSummary;
}

export interface BenchmarkSummary {
  readonly totalCases: number;
  readonly passedCases: number;
  readonly failedCases: number;
  readonly avgRuntimeOverheadMs: number;
  readonly avgSizeOverheadPercent: number;
  readonly avgSemanticRecovery: number;
  readonly avgGraphRecovery: number;
}

// ─────────────────────────────────────────────────────────────
// §9  React-Safe Mode
// ─────────────────────────────────────────────────────────────

export enum ReactZoneSafety {
  Forbidden = 'forbidden',
  SafeWithCaution = 'safe_with_caution',
  FullySafe = 'fully_safe',
}

export interface ReactComponentInfo {
  readonly name: string;
  readonly filePath: string;
  readonly isClassComponent: boolean;
  readonly isFunctionComponent: boolean;
  readonly hooks: readonly string[];
  readonly renderBlockId?: string;
  readonly eventHandlers: readonly string[];
  readonly memoizedCallbacks: readonly string[];
  readonly safeZones: ReadonlyMap<string, ReactZoneSafety>;
}

// ─────────────────────────────────────────────────────────────
// §10  Electron Hardening
// ─────────────────────────────────────────────────────────────

export interface ElectronFuseConfig {
  readonly runAsNode: boolean;
  readonly enableCookieEncryption: boolean;
  readonly enableNodeOptionsEnvironmentVariable: boolean;
  readonly enableNodeCliInspectArguments: boolean;
  readonly enableEmbeddedAsarIntegrityValidation: boolean;
  readonly onlyLoadAppFromAsar: boolean;
  readonly loadBrowserProcessSpecificV8Snapshot: boolean;
  readonly grantFileProtocolExtraPrivileges: boolean;
}

export interface ElectronAuditFinding {
  readonly severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  readonly category: string;
  readonly message: string;
  readonly recommendation: string;
  readonly autoFixable: boolean;
}

export interface ElectronAuditReport {
  readonly timestamp: number;
  readonly findings: readonly ElectronAuditFinding[];
  readonly fuseConfig: ElectronFuseConfig;
  readonly score: number;
  readonly maxScore: number;
}

// ─────────────────────────────────────────────────────────────
// §11  Visualization Data
// ─────────────────────────────────────────────────────────────

export interface ASTNodeViz {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly children: readonly ASTNodeViz[];
  readonly sourceLocation?: SourceLocation;
  readonly metadata?: Record<string, unknown>;
}

export interface CFGNodeViz {
  readonly id: string;
  readonly label: string;
  readonly instructions: readonly string[];
  readonly edges: readonly { readonly target: string; readonly label?: string }[];
}

export interface TransformTimelineEntry {
  readonly passName: string;
  readonly order: number;
  readonly nodesAffected: number;
  readonly symbolsRenamed: number;
  readonly durationMs: number;
  readonly irSnapshot?: IRModule;
}

// ─────────────────────────────────────────────────────────────
// §12  Seeded Random — deterministic builds
// ─────────────────────────────────────────────────────────────

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed & 0x7FFFFFFF;
    if (this.state === 0) {
      this.state = 1;
    }
  }

  /** Returns a pseudo-random integer in [0, 2^31 - 2]. */
  nextInt(): number {
    // Park-Miller LCG
    this.state = (this.state * 16807) % 2147483647;
    return this.state;
  }

  /** Returns a pseudo-random float in [0, 1). */
  nextFloat(): number {
    return (this.nextInt() - 1) / 2147483646;
  }

  /** Returns a pseudo-random integer in [min, max] inclusive. */
  nextRange(min: number, max: number): number {
    if (min > max) {
      throw new RangeError(`SeededRandom.nextRange: min (${min}) > max (${max})`);
    }
    return min + (this.nextInt() % (max - min + 1));
  }

  /** Fisher-Yates shuffle, in-place, returns same array. */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextRange(0, i);
      const tmp = array[i]!;
      array[i] = array[j]!;
      array[j] = tmp;
    }
    return array;
  }

  /** Pick one random element. */
  pick<T>(array: readonly T[]): T {
    if (array.length === 0) {
      throw new RangeError('SeededRandom.pick: empty array');
    }
    return array[this.nextRange(0, array.length - 1)]!;
  }

  /** Generate a random alphanumeric identifier of given length. */
  identifier(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const allChars = chars + '0123456789_$';
    let result = chars[this.nextRange(0, chars.length - 1)]!; // must start with letter
    for (let i = 1; i < length; i++) {
      result += allChars[this.nextRange(0, allChars.length - 1)]!;
    }
    return result;
  }

  /** Snapshot current state for replay. */
  snapshot(): number {
    return this.state;
  }

  /** Restore from snapshot. */
  restore(state: number): void {
    this.state = state & 0x7FFFFFFF;
    if (this.state === 0) {
      this.state = 1;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// §13  Pipeline Events
// ─────────────────────────────────────────────────────────────

export enum PipelineStage {
  SemanticAnalysis = 'semantic_analysis',
  IRLowering = 'ir_lowering',
  TransformExecution = 'transform_execution',
  BytecodeCompilation = 'bytecode_compilation',
  VMBuild = 'vm_build',
  BenchmarkRun = 'benchmark_run',
}

export interface PipelineEvent {
  readonly stage: PipelineStage;
  readonly message: string;
  readonly timestamp: number;
  readonly durationMs?: number;
  readonly diagnostics?: readonly Diagnostic[];
}

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ─────────────────────────────────────────────────────────────
// §14  Utility types
// ─────────────────────────────────────────────────────────────

export type DeepReadonly<T> = {
  readonly [P in keyof T]: T[P] extends (infer U)[]
    ? readonly DeepReadonly<U>[]
    : T[P] extends object
      ? DeepReadonly<T[P]>
      : T[P];
};

/** Mutable version of an IR node for builders. */
export type Mutable<T> = {
  -readonly [P in keyof T]: T[P] extends readonly (infer U)[]
    ? U[]
    : T[P] extends ReadonlyMap<infer K, infer V>
      ? Map<K, V>
      : T[P];
};

export interface BuildManifest {
  readonly buildId: string;
  readonly timestamp: number;
  readonly profile: ObfuscationProfile;
  readonly inputFiles: readonly string[];
  readonly outputFiles: readonly string[];
  readonly seed: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly metrics: readonly BenchmarkMetric[];
}
