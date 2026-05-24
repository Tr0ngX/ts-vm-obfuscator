const { ObfuscationPipeline, createDefaultProfile } = require('./packages/core/dist/index.js');
const path = require('path');
const fs = require('fs');

async function run() {
  const profile = createDefaultProfile('generic');
  const pipeline = new ObfuscationPipeline({
    tsconfigPath: path.resolve('examples/basic-ts/tsconfig.json'),
    profile,
    outDir: path.resolve('dist-obf')
  });
  const res = await pipeline.execute();
  const irMods = res.irModules;
  if (!irMods || irMods.length === 0) {
    console.log("No IR modules returned.");
    return;
  }
  const mod = irMods[0];
  console.log("All function names:");
  console.log(JSON.stringify(mod.functions.map(f => f.name), null, 2));
  
  const hashFn = mod.functions.find(f => f.isExported);
  console.log("First exported function:");
  console.log(JSON.stringify(hashFn, null, 2));
}
run();
