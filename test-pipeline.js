const fs = require('fs');
const cp = require('child_process');

// Step 1: Compute expected hash using original TS logic
function calculateSecretHash(input) {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function encryptTEA(v0, v1, k0, k1, k2, k3) {
  let sum = 0;
  const delta = 0x9e3779b9;
  for (let i = 0; i < 32; i++) {
    sum = (sum + delta) | 0;
    v0 = (v0 + (((v1 << 4) + k0) ^ (v1 + sum) ^ ((v1 >>> 5) + k1))) | 0;
    v1 = (v1 + (((v0 << 4) + k2) ^ (v0 + sum) ^ ((v0 >>> 5) + k3))) | 0;
  }
  return (v0 ^ v1) | 0;
}

const testInput = 'hello-world';
const expectedHash = calculateSecretHash(testInput);
console.log('Expected hash:', expectedHash);

// Step 2: Run obfuscator pipeline
console.log('Running obfuscation pipeline...');
cp.execSync('node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf', {stdio: 'inherit'});

// Step 3: Load the latest obfuscated build
const files = fs.readdirSync('dist-obf');
const buildFiles = files.filter(f => f.startsWith('build_') && f.endsWith('.js')).map(f => {
  return { name: f, time: fs.statSync('dist-obf/' + f).mtime.getTime() };
}).sort((a, b) => b.time - a.time);

if (buildFiles.length === 0) {
  console.error('ERROR: No build file found!');
  process.exit(1);
}

const buildFile = buildFiles[0].name;
console.log('Loading ' + buildFile + '...');

const mod = require('./dist-obf/' + buildFile);
const obfuscatedHash = mod.calculateSecretHash(testInput);
console.log('Obfuscated hash:', obfuscatedHash);

const expectedTEA = encryptTEA(12345, 67890, 1, 2, 3, 4);
const obfuscatedTEA = mod.encryptTEA(12345, 67890, 1, 2, 3, 4);
console.log('Expected TEA:', expectedTEA);
console.log('Obfuscated TEA:', obfuscatedTEA);

// Step 4: Verify semantic equivalence
if (obfuscatedHash === expectedHash && expectedTEA === obfuscatedTEA) {
  console.log('\n✅ SUCCESS: Obfuscated functions produce correct output!');
  console.log(`   calculateSecretHash('${testInput}') = ${obfuscatedHash}`);
  console.log(`   encryptTEA = MATCHED`);
} else {
  console.error('\n❌ FAILURE: Output mismatch!');
  if (obfuscatedHash !== expectedHash) {
    console.error(`   Hash Expected: ${expectedHash}`);
    console.error(`   Hash Got:      ${obfuscatedHash}`);
  }
  if (expectedTEA !== obfuscatedTEA) {
    console.error(`   TEA Expected: ${expectedTEA}`);
    console.error(`   TEA Got:      ${obfuscatedTEA}`);
  }
  process.exit(1);
}

// Step 5: Test with additional inputs
const testCases = ['', 'a', 'test', 'TypeScript VM Obfuscator', '日本語'];
let allPass = true;
for (const tc of testCases) {
  const expected = calculateSecretHash(tc);
  const actual = mod.calculateSecretHash(tc);
  const pass = expected === actual;
  console.log(`  ${pass ? '✅' : '❌'} calculateSecretHash('${tc}') = ${actual} (expected ${expected})`);
  if (!pass) allPass = false;
}

if (allPass) {
  console.log('\n✅ ALL TESTS PASSED — Semantic equivalence verified.');
} else {
  console.error('\n❌ SOME TESTS FAILED');
  process.exit(1);
}
