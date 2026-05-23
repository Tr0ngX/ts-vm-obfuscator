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

// Step 4: Verify semantic equivalence
if (obfuscatedHash === expectedHash) {
  console.log('\n✅ SUCCESS: Obfuscated function produces correct output!');
  console.log(`   calculateSecretHash('${testInput}') = ${obfuscatedHash}`);
} else {
  console.error('\n❌ FAILURE: Output mismatch!');
  console.error(`   Expected: ${expectedHash}`);
  console.error(`   Got:      ${obfuscatedHash}`);
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
