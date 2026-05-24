import type { TransformPass, TransformContext, TransformResult, IRModule, IRFunction } from '@tsvm/shared';

/**
 * 1) Invariant đầu vào: Các hàm và biến nội bộ có tên symbol giữ nguyên từ mã gốc (trừ khi đã rename).
 * 2) Invariant đầu ra: Toàn bộ tên biến, hàm nội bộ (không export, không phải API public)
 *    được mã hóa/ẩn đi thông qua alias map.
 * 3) Node kinds đụng tới: IRFunction, IRLocal, IRGlobal.
 * 4) Edge cases: Bỏ qua các exported symbols nếu config yêu cầu (ví dụ làm thư viện).
 * 5) Pseudo-code:
 *    For each function, local, global:
 *      if not exported:
 *         rename to a random hashed string
 *         update alias map
 */
export class SymbolIndirectionPass implements TransformPass {
  readonly name = 'SymbolIndirectionPass';
  readonly priority = 50;

  execute(ctx: TransformContext): TransformResult {
    let symbolsRenamed = 0;
    
    // Rename functions
    const newFunctions = ctx.module.functions.map(func => {
      // Always preserve exported function names — the VM runtime needs
      // the original name for module.exports binding.
      // Internal implementation is still fully obfuscated via bytecode.
      if (func.isExported || func.isVirtualized) {
        return func;
      }

      // Preserve special names like 'constructor' or React specific ones if needed
      if (ctx.profile.reactSafe && func.name.startsWith('use')) {
         return func;
      }

      const newName = `fn_${ctx.rng.identifier(8)}`;
      symbolsRenamed++;

      // Also rename locals
      const newLocals = func.locals.map(local => {
        symbolsRenamed++;
        return {
          ...local,
          name: `v_${ctx.rng.identifier(6)}`
        };
      });

      return {
        ...func,
        name: newName,
        locals: newLocals
      };
    });

    const newGlobals = ctx.module.globals.map(g => {
      if (g.isExported && ctx.profile.preserveExports) return g;
      symbolsRenamed++;
      return {
        ...g,
        name: `g_${ctx.rng.identifier(8)}`
      };
    });

    const newModule: IRModule = {
      ...ctx.module,
      functions: newFunctions,
      globals: newGlobals
    };

    return {
      module: newModule,
      symbolsRenamed,
      nodesTransformed: 0,
      diagnostics: []
    };
  }
}
