const { ObfuscationPipeline, createDefaultProfile } = require('./packages/core/dist/index.js');
const path = require('path');

async function main() {
  const tsconfigPath = path.resolve('examples/basic-ts/tsconfig.json');
  const profile = createDefaultProfile('generic');
  const pipeline = new ObfuscationPipeline({
    tsconfigPath,
    profile,
    outDir: path.resolve('dist-obf')
  });

  const result = await pipeline.execute();
  console.log('Success:', result.success);
  console.log('IR Modules:', result.irModules.length);
  for (const mod of result.irModules) {
    const vfuncs = mod.functions.filter(f => f.isVirtualized);
    console.log(`Module ${mod.filePath}: ${vfuncs.length} virtualized functions out of ${mod.functions.length}`);
    for (const f of mod.functions) {
      console.log(`  - ${f.name} (virtualized: ${f.isVirtualized})`);
    }
  }
}
main().catch(console.error);
