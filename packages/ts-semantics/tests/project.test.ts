import { describe, it, expect } from 'vitest';
import { analyzeProject } from '../src/project.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Project Semantic Analyzer', () => {
  it('should successfully parse a valid tsconfig and build module graph', () => {
    const mockTsConfig = path.join(__dirname, '__fixtures__', 'tsconfig.mock.json');
    const graph = analyzeProject(mockTsConfig);
    expect(graph).toBeDefined();
    expect(graph.modules.size).toBeGreaterThanOrEqual(1);
    const mod = graph.modules.values().next().value;
    expect(mod).toBeDefined();
    expect(mod.filePath).toContain('hello.ts');
  });

  it('should throw for non-existent tsconfig', () => {
    expect(() => analyzeProject('/nonexistent/tsconfig.json')).toThrow();
  });

  it('should throw for invalid tsconfig content', () => {
    const badPath = path.join(__dirname, '__fixtures__', 'tsconfig.mock.json.bak');
    expect(() => analyzeProject(badPath)).toThrow();
  });
});
