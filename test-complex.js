const fs = require('fs');
const cp = require('child_process');

function encryptTEA(v0, v1, k0, k1, k2, k3) {
  let sum = 0;
  let delta = 2654435769; // 0x9E3779B9
  for (let i = 0; i < 32; i++) {
    sum = sum + delta;
    sum |= 0;
    
    let t1 = (v1 << 4) + k0;
    let t2 = v1 + sum;
    let t3 = (v1 >> 5) + k1;
    v0 = v0 + (t1 ^ t2 ^ t3);
    v0 |= 0;

    let t4 = (v0 << 4) + k2;
    let t5 = v0 + sum;
    let t6 = (v0 >> 5) + k3;
    v1 = v1 + (t4 ^ t5 ^ t6);
    v1 |= 0;
  }
  return (v0 ^ v1) | 0;
}

const expected = encryptTEA(1234567, 7654321, 111, 222, 333, 444);
console.log('Expected TEA output:', expected);

console.log('Running obfuscator on basic-ts (which includes complex.ts)...');
cp.execSync('node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf', {stdio: 'inherit'});

const files = fs.readdirSync('dist-obf');
const buildFiles = files.filter(f => f.startsWith('build_') && f.endsWith('.js')).map(f => {
  return { name: f, time: fs.statSync('dist-obf/' + f).mtime.getTime() };
}).sort((a, b) => b.time - a.time);

let mod = null;
for (const bf of buildFiles) {
  const m = require('./dist-obf/' + bf.name);
  if (m.encryptTEA) {
    mod = m;
    console.log('Loading ' + bf.name + ' for encryptTEA...');
    break;
  }
}

if (!mod) {
  console.error('ERROR: Could not find encryptTEA in any build file!');
  process.exit(1);
}

const obfuscated = mod.encryptTEA(1234567, 7654321, 111, 222, 333, 444);

console.log('Obfuscated TEA output:', obfuscated);

if (obfuscated === expected) {
  console.log('✅ SUCCESS: Complex TEA algorithm executed correctly within the polymorphic VM!');
} else {
  console.error('❌ FAILURE: Output mismatch!');
  process.exit(1);
}
