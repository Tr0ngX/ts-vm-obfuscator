import type { TransformPass, TransformContext, TransformResult, IRModule } from '@tsvm/shared';

export class DecoratorAwareLoweringPass implements TransformPass {
  readonly name = 'DecoratorAwareLoweringPass';
  readonly priority = 30;

  execute(ctx: TransformContext): TransformResult {
    const newModule: IRModule = {
      ...ctx.module
    };

    return {
      module: newModule,
      symbolsRenamed: 0,
      nodesTransformed: 0,
      diagnostics: []
    };
  }
}
