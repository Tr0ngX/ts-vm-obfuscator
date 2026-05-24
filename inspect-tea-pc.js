const { ObfuscationPipeline, createDefaultProfile } = require('./packages/core/dist/index.js');
const path = require('path');
const { encodeBytecode } = require('./packages/bytecode/dist/encoder.js');
const { generateRemappedOpcodes } = require('./packages/bytecode/dist/opcodes.js');

async function run() {
  const profile = createDefaultProfile('generic');
  // Add a quick hook inside bytecode compiler to log byte offsets!
  // Actually, we can just compile and decode it?
  const pipeline = new ObfuscationPipeline({
    tsconfigPath: path.resolve('examples/basic-ts/tsconfig.json'),
    profile,
    outDir: path.resolve('dist-obf')
  });
  const res = await pipeline.execute();
  const buildConfig = res.buildConfig;
  
  // Oh wait, the pipeline returns the compiled build config!
  const teaFn = buildConfig.functions.find(f => f.name === 'encryptTEA');
  
  console.log("Bytecode length:", teaFn.bytecode.length);
  // Decode bytecode to see offsets
  let pc = 0;
  const rollingKeys = profile.build.rollingKeys;
  let rollingKey = rollingKeys ? profile.build.seed & 0xFF : 0;
  
  while (pc < teaFn.bytecode.length) {
    let startPc = pc;
    let b = teaFn.bytecode[pc++];
    if (rollingKeys) { b ^= rollingKey; rollingKey = (rollingKey + b) & 0xFF; }
    
    let argCount = teaFn.bytecode[pc++];
    if (rollingKeys) { argCount ^= rollingKey; rollingKey = (rollingKey + argCount) & 0xFF; }
    
    for (let i = 0; i < argCount; i++) {
       let kind = teaFn.bytecode[pc++];
       if (rollingKeys) { kind ^= rollingKey; rollingKey = (rollingKey + kind) & 0xFF; }
       
       if (profile.build.immediateEncoding === 1) { // VariableLength
         let val = 0;
         let shift = 0;
         let k;
         do {
           k = teaFn.bytecode[pc++];
           if (rollingKeys) { k ^= rollingKey; rollingKey = (rollingKey + k) & 0xFF; }
           val |= (k & 0x7F) << shift;
           shift += 7;
         } while (k & 0x80);
       } else {
         pc += 4;
       }
    }
    console.log(`[PC ${startPc} -> ${pc}] RawOp: ${b} ArgCount: ${argCount}`);
  }
}
run();
