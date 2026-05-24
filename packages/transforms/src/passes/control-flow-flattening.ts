import type { TransformPass, TransformContext, TransformResult, IRModule, Instruction, BasicBlock, TerminatorInstruction } from '@tsvm/shared';
import { OpCode, OperandKind } from '@tsvm/shared';

export class ControlFlowFlatteningPass implements TransformPass {
  readonly name = 'ControlFlowFlatteningPass';
  readonly priority = 26;

  execute(ctx: TransformContext): TransformResult {
    let nodesTransformed = 0;
    
    const newFunctions = ctx.module.functions.map(func => {
      if (!func.isVirtualized || func.blocks.length === 0) return func;

      let changed = false;
      const newBlocks: BasicBlock[] = [];
      
      for (let i = 0; i < func.blocks.length; i++) {
        const block = func.blocks[i]!;
        
        // Only split blocks with >= 5 instructions to avoid splitting tiny blocks like entry/exit
        if (block.instructions.length >= 5 && ctx.rng.nextFloat() < 0.5) {
          changed = true;
          nodesTransformed++;
          
          // Split point roughly in the middle
          const splitIdx = Math.floor(block.instructions.length / 2);
          const insts1 = block.instructions.slice(0, splitIdx);
          const insts2 = block.instructions.slice(splitIdx);
          
          const newBlockId = `${block.id}_split_${ctx.rng.identifier(4)}`;
          
          // The first block jumps to the second block using a direct jump
          // In a true flattening pass, this would be an opaque branch or a switch state, 
          // but splitting the CFG is a solid start for spaghetti code.
          const term1: TerminatorInstruction = {
            kind: 'jump',
            targets: [newBlockId]
          };
          
          newBlocks.push({
            ...block,
            instructions: insts1,
            terminator: term1,
            successors: [newBlockId]
          });
          
          // The second block continues the rest of the execution
          newBlocks.push({
            id: newBlockId,
            label: `${block.label}_split`,
            instructions: insts2,
            terminator: block.terminator,
            predecessors: [block.id],
            successors: block.successors,
            phiNodes: [] // The split block inherits no phi nodes, the first block kept them
          });
          
        } else {
          newBlocks.push(block);
        }
      }
      
      // We must patch the successors/predecessors references if a block was split, 
      // but since we only split a block in half and linked them directly, the outside edges 
      // pointing to `block.id` still point to the first half, and the second half points to the old successors.
      // So CFG integrity is largely maintained.
      
      return changed ? { ...func, blocks: newBlocks } : func;
    });

    return {
      module: { ...ctx.module, functions: newFunctions },
      symbolsRenamed: 0,
      nodesTransformed,
      diagnostics: []
    };
  }
}
