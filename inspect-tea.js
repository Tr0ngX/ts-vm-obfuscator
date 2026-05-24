const { ObfuscationPipeline, createDefaultProfile } = require('./packages/core/dist/index.js');
const path = require('path');

async function run() {
  const profile = createDefaultProfile('generic');
  // Tắt StripDebugPass bằng cách set seed cố định
  const pipeline = new ObfuscationPipeline({
    tsconfigPath: path.resolve('examples/basic-ts/tsconfig.json'),
    profile,
    outDir: path.resolve('dist-obf')
  });
  const res = await pipeline.execute();
  const irMods = res.irModules;
  const mod = irMods[0];
  const teaFn = mod.functions.find(f => f.name === 'encryptTEA');
  console.log(JSON.stringify(teaFn, null, 2));
}
run();
