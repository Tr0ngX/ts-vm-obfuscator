const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');
const files = fs.readdirSync(distDir);
const buildFiles = files.filter(f => f.startsWith('build_') && f.endsWith('tests_js.js')).map(f => {
  return { name: f, time: fs.statSync(path.join(distDir, f)).mtime.getTime() };
}).sort((a, b) => b.time - a.time);

if (buildFiles.length === 0) {
  console.error('ERROR: No build file found in dist!');
  process.exit(1);
}

const buildFile = buildFiles[0].name;

console.log('Loading obfuscated bundle:', buildFile);
const obf = require(path.join(distDir, buildFile));
function joinSegments(parts) {
  return parts.join(":");
}

function foldBits(values) {
  let acc = 0x13579bdf;
  for (let i = 0; i < values.length; i++) {
    acc ^= values[i] + i;
    acc = Math.imul(acc ^ (acc >>> 3), 0x45d9f3b) >>> 0;
  }
  return acc >>> 0;
}

function computeExpectedComplexStructures(flag) {
  const nested = [[3, 5], [8, 13]];
  const helpers = { joinSegments, foldBits };
  const summary = {
    left: nested[0][1],
    right: nested[1][0],
    flag,
    helpers,
  };

  nested[1][0] = summary.left ^ summary.right;

  if (flag > 3) {
    nested[0][0] = nested[1][0] & 15;
  } else {
    nested[0][0] = nested[1][0] | 16;
  }

  const tags = ["vm", String(nested[0][0]), String(summary.flag)];
  const payload = {
    digest: helpers.foldBits([nested[0][0], nested[0][1], nested[1][0], summary.right]),
    joined: helpers.joinSegments(tags),
  };

  return payload.joined + "#" + String(payload.digest);
}

const flags = [2, 7];
for (const flag of flags) {
  const expected = computeExpectedComplexStructures(flag);
  const actual = obf.runComplexStructures(flag);

  if (expected !== actual) {
    console.error(`FAIL flag=${flag}`);
    console.error('Expected:', expected);
    console.error('Actual:  ', actual);
    process.exit(1);
  }
}

console.log('OK runComplexStructures matched native output for all flags.');
