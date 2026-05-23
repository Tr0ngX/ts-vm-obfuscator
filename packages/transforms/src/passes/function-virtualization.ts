import type { TransformPass, TransformContext, TransformResult, IRModule } from '@tsvm/shared';
import { FunctionAttribute } from '@tsvm/shared';

export class FunctionVirtualizationPass implements TransformPass {
  readonly name = 'FunctionVirtualizationPass';
  readonly priority = 80;

  execute(ctx: TransformContext): TransformResult {
    const newModule: IRModule = {
      ...ctx.module,
      functions: ctx.module.functions.map(fn => {
        // Exclude React components from virtualization if they are pure view
        // In a real implementation we would do more complex analysis
        if (fn.attributes.includes(FunctionAttribute.ReactComponent)) {
          return { ...fn, isVirtualized: false };
        }
        return fn; // Preserve the isVirtualized flag set by IR builder based on @virtualize annotation
      })
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed: 0,
      diagnostics: []
    };
  }
}
