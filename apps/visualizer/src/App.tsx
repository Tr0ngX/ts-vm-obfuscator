import React, { useState } from 'react';
import type { IRModule, BytecodeModule, TransformTimelineEntry } from '@tsvm/shared';

// -- Mock Data --
const mockIR: IRModule = {
  id: 'mod_123',
  sourceFile: 'src/index.ts',
  functions: [
    {
      id: 'fn_1',
      name: 'helloWorld',
      params: [],
      returnType: 'string' as any,
      blocks: [
        {
          id: 'blk_1',
          label: 'entry',
          instructions: [
            { opcode: 0x01 /* LoadConst */, operands: [{ kind: 'constant_index', value: 0 }], result: 'r0' }
          ],
          terminator: { kind: 'return', targets: [], returnValue: 'r0' },
          predecessors: [],
          successors: [],
          phiNodes: []
        }
      ],
      locals: [],
      isVirtualized: true,
      isExported: true,
      attributes: [],
      capturedVariables: []
    }
  ],
  globals: [],
  imports: [],
  exports: [],
  constantPool: [
    { index: 0, kind: 'string' as any, value: 'Hello Virtualized World' }
  ],
  metadata: {
    sourceFile: 'src/index.ts',
    originalByteSize: 100,
    functionCount: 1,
    blockCount: 1,
    instructionCount: 1,
    buildTimestamp: Date.now()
  }
};

const mockTimeline: TransformTimelineEntry[] = [
  { passName: 'PreserveTypeIllusionsPass', order: 1, nodesAffected: 0, symbolsRenamed: 0, durationMs: 2 },
  { passName: 'GenericConfusionPass', order: 2, nodesAffected: 5, symbolsRenamed: 0, durationMs: 10 },
  { passName: 'NamespaceVirtualizationPass', order: 3, nodesAffected: 12, symbolsRenamed: 0, durationMs: 4 },
  { passName: 'TypeLevelFakePathPass', order: 4, nodesAffected: 2, symbolsRenamed: 0, durationMs: 8 },
  { passName: 'SymbolIndirectionPass', order: 5, nodesAffected: 0, symbolsRenamed: 45, durationMs: 15 }
];

export default function App() {
  const [activeTab, setActiveTab] = useState<'ir' | 'timeline' | 'bytecode'>('timeline');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ borderBottom: '1px solid #ccc', paddingBottom: '10px', marginBottom: '20px' }}>
        <h1>ts-vm-obfuscator Visualizer</h1>
        <p>Interactive explorer for semantic graph, IR, transforms, and bytecode.</p>
      </header>

      <nav style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
        <button 
          onClick={() => setActiveTab('timeline')}
          style={{ fontWeight: activeTab === 'timeline' ? 'bold' : 'normal', padding: '5px 15px' }}
        >
          Transform Timeline
        </button>
        <button 
          onClick={() => setActiveTab('ir')}
          style={{ fontWeight: activeTab === 'ir' ? 'bold' : 'normal', padding: '5px 15px' }}
        >
          IR Graph
        </button>
        <button 
          onClick={() => setActiveTab('bytecode')}
          style={{ fontWeight: activeTab === 'bytecode' ? 'bold' : 'normal', padding: '5px 15px' }}
        >
          Bytecode Dump
        </button>
      </nav>

      <main>
        {activeTab === 'timeline' && (
          <section>
            <h2>Transform Timeline</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', textAlign: 'left' }}>
                  <th style={{ padding: '8px', border: '1px solid #ccc' }}>Order</th>
                  <th style={{ padding: '8px', border: '1px solid #ccc' }}>Pass Name</th>
                  <th style={{ padding: '8px', border: '1px solid #ccc' }}>Nodes Affected</th>
                  <th style={{ padding: '8px', border: '1px solid #ccc' }}>Symbols Renamed</th>
                  <th style={{ padding: '8px', border: '1px solid #ccc' }}>Duration (ms)</th>
                </tr>
              </thead>
              <tbody>
                {mockTimeline.map(entry => (
                  <tr key={entry.passName}>
                    <td style={{ padding: '8px', border: '1px solid #ccc' }}>{entry.order}</td>
                    <td style={{ padding: '8px', border: '1px solid #ccc', fontWeight: 'bold' }}>{entry.passName}</td>
                    <td style={{ padding: '8px', border: '1px solid #ccc' }}>{entry.nodesAffected}</td>
                    <td style={{ padding: '8px', border: '1px solid #ccc' }}>{entry.symbolsRenamed}</td>
                    <td style={{ padding: '8px', border: '1px solid #ccc' }}>{entry.durationMs}ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'ir' && (
          <section>
            <h2>IR Module Dump</h2>
            <pre style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '15px', borderRadius: '4px', overflowX: 'auto' }}>
              {JSON.stringify(mockIR, null, 2)}
            </pre>
          </section>
        )}

        {activeTab === 'bytecode' && (
          <section>
            <h2>Bytecode (Mock)</h2>
            <p>Bytecode visualization would parse the TSOB binary format here.</p>
            <div style={{ background: '#1e1e1e', color: '#569cd6', padding: '15px', borderRadius: '4px', fontFamily: 'monospace' }}>
              00000000  54 53 4f 42 01 00 00 00  ... TSOB....<br/>
              00000008  01 02 03 04 05 06 07 08  ... (opcode map)<br/>
              00000010  1a 2b 3c 4d 5e 6f 70 81  ... (handler layout)<br/>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
