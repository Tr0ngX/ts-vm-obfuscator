import type { ModuleInfo, TypeFact, SymbolAlias } from '@tsvm/shared';
import { ScopeKind } from '@tsvm/shared';

export function buildSymbolTable(modules: Map<string, ModuleInfo>) {
  const symbolTable: TypeFact[] = [];
  const aliases = new Map<number, SymbolAlias>();

  let nextSymbolId = 1;

  for (const [filePath, mod] of modules.entries()) {
    for (const fact of mod.typeFacts) {
      // Normalize ID
      const normalizedId = nextSymbolId++;

      const normalizedFact: TypeFact = {
        ...fact,
        symbolId: normalizedId,
      };

      symbolTable.push(normalizedFact);

      // Create initial alias mapping (identity)
      aliases.set(normalizedId, {
        originalName: fact.symbolName,
        obfuscatedName: fact.symbolName, // Will be changed by SymbolIndirectionPass
        scope: fact.isExported ? ScopeKind.Module : ScopeKind.Block, // Simplified
        symbolId: normalizedId,
        isExported: fact.isExported,
      });
    }
  }

  return { symbolTable, aliases };
}
