const fs = require('fs');
const path = require('path');

// find latest build in examples/basic-ts/dist
const distDir = path.join(__dirname, 'examples/basic-ts/dist');
const files = fs.readdirSync(distDir).filter(f => f.startsWith('build_') && f.endsWith('.js'));
files.sort((a, b) => {
  return fs.statSync(path.join(distDir, b)).mtimeMs - fs.statSync(path.join(distDir, a)).mtimeMs;
});

if (files.length === 0) {
  console.log("No build files found!");
  process.exit(1);
}

const latestFile = path.join(distDir, files[0]);
console.log("Loading latest VM build:", files[0]);

const vmModule = require(latestFile);
console.log("Module exports:", Object.keys(vmModule));

if (typeof vmModule.calculateSecretHash !== 'function') {
  console.log("calculateSecretHash is not a function!");
  process.exit(1);
}

const input = "helloworld";
const result = vmModule.calculateSecretHash(input);

console.log("Test input:", input);
console.log("Output hash:", result);

// let's do the manual one to verify:
function expected(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash | 0;
  }
  return hash;
}

console.log("Expected hash:", expected(input));
if (result === expected(input)) {
  console.log("SUCCESS! VM Execution Matches Expected Output!");
} else {
  console.log("FAILED! Mismatch.");
}
