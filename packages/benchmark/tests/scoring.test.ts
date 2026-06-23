import { describe, it, expect } from 'vitest';
import { runBenchmarkSuite } from '../src/index.js';
import { IRType, type IRModule, type BytecodeModule, type ObfuscationProfile } from '@tsvm/shared';

describe('Benchmark Suite Executor', () => {
  it('should accurately analyze complexity and timing on mock profiles', async () => {
    // 1. Arrange
    const mockProfile: ObfuscationProfile = {
      name: 'stealth-profile',
      target: 'generic',
      seed: 42,
      transforms: {
        deadCode: { enabled: true, density: 0.1 },
        controlFlowFlattening: { enabled: true, passes: 1 },
        opaquePredicates: { enabled: true, density: 0.2 },
        stringEncryption: { enabled: true, threshold: 0.8 },
        namespaceVirtualization: { enabled: true },
        typeLevelFakePath: { enabled: true },
      },
      vm: {
        runtimeHardening: 'stealth',
        opcodeRemapping: true,
        rollingKeys: true,
        threadedDispatch: true,
        antiDebug: true,
        tamperDetection: true,
        stealthDispatch: true,
      },
    };

    const mockIR: IRModule[] = [
      {
        id: 'mod_1',
        sourceFile: 'index.ts',
        functions: [
          {
            id: 'func_0',
            name: 'calculateSecretHash',
            params: [],
            returnType: IRType.Number,
            blocks: [],
            locals: [
              { name: 'hash', register: 'r0', type: IRType.Any, isCaptured: false },
              { name: 'i', register: 'r1', type: IRType.Any, isCaptured: false },
            ],
            isVirtualized: false,
            isExported: false,
            attributes: [],
            capturedVariables: [],
          },
        ],
        globals: [],
        imports: [],
        exports: [],
        constantPool: [],
        metadata: {
          sourceFile: 'index.ts',
          originalByteSize: 1500,
          functionCount: 1,
          blockCount: 5,
          instructionCount: 45,
          buildTimestamp: Date.now(),
        },
      },
    ];

    const mockBytecode: BytecodeModule[] = [
      {
        magic: 0x5453564d,
        version: 1,
        buildId: 'build_test_123',
        opcodeMapping: { forward: new Map(), reverse: new Map(), seed: 0 },
        constantPool: [],
        functions: [
          {
            id: 'func_0',
            name: 'calculateSecretHash',
            paramCount: 1,
            localCount: 0,
            maxRegisters: 2,
            bytecode: new Uint8Array([
              0x02,
              0x00,
              0x00,
              0x00,
              0x00, // LoadLocal
              0x30,
              0x0a,
              0x00,
              0x00,
              0x00, // Jmp
              0x40,
              0x01,
              0x00,
              0x00,
              0x00, // Call
              0x03,
              0x00,
              0x00,
              0x00,
              0x00, // StoreLocal
            ]),
            isEntryPoint: true,
          },
        ],
        entryPointIndex: 0,
        metadata: {
          buildId: 'build_test_123',
          sourceHash: 'abc',
          profile: 'stealth-profile',
          deterministicSeed: 42,
        },
      },
    ];

    // 2. Act
    const results = await runBenchmarkSuite(mockIR, mockBytecode, mockProfile);

    // 3. Assert
    expect(results).toBeDefined();
    expect(results.suiteId).toBeDefined();
    expect(results.cases).toHaveLength(1);

    const mainCase = results.cases[0]!;
    expect(mainCase.profile).toBe('stealth-profile');
    expect(mainCase.buildId).toBe('build_test_123');
    expect(mainCase.syntaxPass).toBe(true);
    expect(mainCase.buildPass).toBe(true);
    expect(mainCase.semanticEquivalence).toBe(true);

    // Validate size overhead measurements
    expect(mainCase.sizeOverheadPercent).toBeGreaterThan(0);
    expect(mainCase.sizeOverheadBytes).toBeGreaterThan(0);

    // Validate control flow branch density and shannon entropy
    const branchMetric = mainCase.metrics.find((m) => m.name === 'CFG Branch Density Ratio');
    expect(branchMetric).toBeDefined();
    expect(branchMetric!.value).toBeDefined();
    expect(branchMetric!.unit).toBe('%');

    const renamingEntropyMetric = mainCase.metrics.find((m) => m.name === 'Renaming Information Entropy');
    expect(renamingEntropyMetric).toBeDefined();
    expect(renamingEntropyMetric!.value).toBeGreaterThan(0);

    // Validate reverse attempts scoring (resilience)
    expect(results.reverseAttempts).toHaveLength(2);
    const solverAttempt = results.reverseAttempts.find((r) => r.model === 'LLM_SymbolicExecutor');
    expect(solverAttempt).toBeDefined();
    expect(solverAttempt!.semanticRecovery).toBeLessThan(40); // Hardened by stealth & rolling keys
    expect(solverAttempt!.graphRecovery).toBeLessThan(45);
  });
});
