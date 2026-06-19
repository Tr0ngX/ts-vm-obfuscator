import type { ObfuscationProfile, TransformPass } from '@tsvm/shared';
import { PreserveTypeIllusionsPass } from './passes/preserve-type-illusions.js';
import { GenericConfusionPass } from './passes/generic-confusion.js';
import { DecoratorAwareLoweringPass } from './passes/decorator-aware-lowering.js';
import { NamespaceVirtualizationPass } from './passes/namespace-virtualization.js';
import { TypeLevelFakePathPass } from './passes/type-level-fake-path.js';
import { SymbolIndirectionPass } from './passes/symbol-indirection.js';
import { StringPoolEncodingPass } from './passes/string-pool-encoding.js';
import { FunctionVirtualizationPass } from './passes/function-virtualization.js';
import { DeadCodeInjectionPass } from './passes/dead-code-injection.js';
import { ControlFlowFlatteningPass } from './passes/control-flow-flattening.js';
import { StripDebugPass } from './passes/strip-debug.js';
import { IRValidationPass } from './passes/ir-validation.js';
import { RegisterCompactingPass } from './passes/register-compacting.js';
import { InstructionSubstitutionPass } from './passes/instruction-substitution.js';

export class TransformRegistry {
  private passes: Map<string, TransformPass> = new Map();

  constructor(profile: ObfuscationProfile) {
    const availablePasses: Record<string, new () => TransformPass> = {
      'PreserveTypeIllusionsPass': PreserveTypeIllusionsPass,
      'GenericConfusionPass': GenericConfusionPass,
      'DecoratorAwareLoweringPass': DecoratorAwareLoweringPass,
      'NamespaceVirtualizationPass': NamespaceVirtualizationPass,
      'TypeLevelFakePathPass': TypeLevelFakePathPass,
      'SymbolIndirectionPass': SymbolIndirectionPass,
      'StringPoolEncodingPass': StringPoolEncodingPass,
      'FunctionVirtualizationPass': FunctionVirtualizationPass,
      'DeadCodeInjectionPass': DeadCodeInjectionPass,
      'ControlFlowFlatteningPass': ControlFlowFlatteningPass,
      'StripDebugPass': StripDebugPass,
      'IRValidationPass': IRValidationPass,
      'RegisterCompactingPass': RegisterCompactingPass,
      'InstructionSubstitutionPass': InstructionSubstitutionPass,
    };

    for (const passConfig of profile.transforms) {
      if (passConfig.enabled && availablePasses[passConfig.name]) {
        this.addPass(new availablePasses[passConfig.name]!());
      }
    }
  }

  addPass(pass: TransformPass) {
    this.passes.set(pass.name, pass);
  }

  removePass(name: string) {
    this.passes.delete(name);
  }

  getPass(name: string): TransformPass | undefined {
    return this.passes.get(name);
  }

  getOrderedPasses(): TransformPass[] {
    return Array.from(this.passes.values()).sort((a, b) => a.priority - b.priority);
  }
}

export function createTransformRegistry(profile: ObfuscationProfile): TransformRegistry {
  return new TransformRegistry(profile);
}
