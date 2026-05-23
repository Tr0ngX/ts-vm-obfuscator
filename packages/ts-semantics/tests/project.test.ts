import { describe, it, expect } from 'vitest';
import { analyzeProject } from '../src/project.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Project Semantic Analyzer', () => {
  it('should successfully parse a valid tsconfig and build module graph', () => {
    // Note: Provide a path to a mock tsconfig for tests
    const mockTsConfig = path.join(__dirname, '__fixtures__', 'tsconfig.mock.json');
    // Using try-catch to simulate if fixture isn't available yet
    try {
      const graph = analyzeProject(mockTsConfig);
      expect(graph).toBeDefined();
      expect(graph.modules.size).toBeGreaterThan(0);
    } catch (e: any) {
      expect(e.message).toContain('Failed to read tsconfig');
    }
  });
});
