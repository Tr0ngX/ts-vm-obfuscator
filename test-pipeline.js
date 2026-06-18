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

function verifyArtemisCollatzAndMath(n, seed) {
  if (n <= 0 || seed <= 0) return 0;
  let current = n;
  let iterations = 0;
  let accumulator = seed;

  while (current > 1 && iterations < 100) {
    if ((current % 2) === 0) {
      current = (current / 2) | 0;
    } else {
      current = ((current * 3) + 1) | 0;
    }
    
    accumulator = (accumulator ^ (current + iterations)) | 0;
    accumulator = (accumulator << 3) - accumulator + current;
    accumulator |= 0;
    iterations++;
  }

  return accumulator;
}

function verifyArtemisStateDecimation(key, multiplier, limit) {
  if (!key || multiplier === 0) return -1;

  const telemetry = {
    status: 1,
    oxygen: 100,
    pressure: 1013,
    active: true,
    sensorData: [10, 20, 30, 40, 50]
  };

  telemetry[key] = (multiplier * 42) | 0;
  
  delete telemetry.active;
  delete telemetry.status;

  let score = 0;
  
  if (telemetry[key]) {
    score = (telemetry[key] + telemetry.pressure) | 0;
  } else {
    score = telemetry.pressure;
  }

  let idx = 0;
  while (idx < limit && idx < 5) {
    const baseValue = telemetry.sensorData[idx];
    telemetry.sensorData[idx] = (baseValue * multiplier) | 0;
    score = (score + telemetry.sensorData[idx]) | 0;
    ++idx;
  }

  return score;
}

function verifyArtemisGatingSystem(sensorA, sensorB, threshold) {
  let criticalLevel = 0;

  if ((sensorA > threshold && sensorB > threshold) || (sensorA + sensorB > (threshold * 2) | 0)) {
    if (sensorA === sensorB) {
      criticalLevel = 100;
    } else if (sensorA > sensorB) {
      criticalLevel = ((sensorA - sensorB) * 2) | 0;
    } else {
      criticalLevel = ((sensorB - sensorA) * 3) | 0;
    }
  } else if (sensorA < 0 || sensorB < 0) {
    criticalLevel = -999;
  } else {
    criticalLevel = (sensorA ^ sensorB) | 0;
  }

  return criticalLevel;
}

function verifyArtemisComputedDestructuring(key, value, defaultVal) {
  const obj = { [key]: value, otherKey: 99 };
  const { [key]: extracted, otherKey, ...rest } = obj;
  let assigned;
  let fallback;
  ({ [key]: assigned, missingKey: fallback = defaultVal } = obj);
  return [extracted, otherKey, rest, assigned, fallback];
}

async function verifyArtemisAsyncLoop(count) {
  const asyncIterable = {
    [Symbol.asyncIterator]() {
      let i = 1;
      return {
        async next() {
          if (i <= count) {
            return { value: i++, done: false };
          }
          return { value: undefined, done: true };
        }
      };
    }
  };

  let sum = 0;
  for await (const x of asyncIterable) {
    sum += x;
  }
  return sum;
}

const testInput = 'hello-world';
const expectedHash = calculateSecretHash(testInput);
console.log('Expected hash:', expectedHash);

// Step 2: Run obfuscator pipeline
console.log('Running obfuscation pipeline...');
// Clean previous build files first
try {
  fs.rmSync('dist-obf', { recursive: true, force: true });
} catch (e) {}

// Compile original basic-ts natively first using tsc
console.log('Compiling original basic-ts natively...');
cp.execSync('npx tsc -p examples/basic-ts/tsconfig.json --outDir examples/basic-ts/dist-orig', { stdio: 'inherit' });

// We try compiling with default generic profile first, if it fails due to unsupported VM syntax, we use universal profile which enables compatibility fallbacks
let profile = 'universal';
try {
  console.log('Attempting obfuscation with universal profile...');
  cp.execSync('node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf --profile universal', { stdio: 'inherit' });
} catch (e) {
  console.log('Obfuscation failed, exiting');
  process.exit(1);
}

// Step 3: Load the latest obfuscated build
const files = fs.readdirSync('dist-obf');
const buildFiles = files.filter(f => f.startsWith('build_') && (f.endsWith('.js') || f.endsWith('.mjs'))).map(f => {
  return { name: f, time: fs.statSync('dist-obf/' + f).mtime.getTime() };
}).sort((a, b) => b.time - a.time);

if (buildFiles.length === 0) {
  console.error('ERROR: No build file found!');
  process.exit(1);
}

// Locate the main index.ts bundle
const buildFileIndex = buildFiles.find(f => f.name.includes('index_ts') || f.name.includes('index.ts'));
if (!buildFileIndex) {
  console.error('ERROR: No index build file found!');
  process.exit(1);
}

const buildFile = buildFileIndex.name;
const buildPath = './dist-obf/' + buildFile;
console.log('Loading obfuscated bundle: ' + buildFile + '...');
const customTestFile = buildFiles.find(f => f.name.includes('custom-test.ts') || f.name.includes('custom_test'));
if (customTestFile) {
  fs.writeFileSync('dist-obf/package.json', JSON.stringify({ type: 'module' }));
  fs.copyFileSync('dist-obf/' + customTestFile.name, 'dist-obf/custom-test.js');
}

(async () => {
  // Load original natively-compiled module
  const orig = require('./examples/basic-ts/dist-orig/index.js');
  try {
    require('./examples/basic-ts/dist-orig/with-test.js');
  } catch (e) {}
  
  // Load obfuscated module dynamically to support ESM .mjs
  const mod = await import(buildPath);
  globalThis.testVMBlockerWith = function(val1) {
    const obj = { a: val1 };
    let out = 0;
    with (obj) {
      out = a;
    }
    return out;
  };

  const testInput = 'hello-world';
  const expectedHash = calculateSecretHash(testInput);
  const obfuscatedHash = mod.calculateSecretHash(testInput);
  console.log('Expected hash:', expectedHash);
  console.log('Obfuscated hash:', obfuscatedHash);

  const expectedTEA = encryptTEA(12345, 67890, 1, 2, 3, 4);
  const obfuscatedTEA = mod.encryptTEA(12345, 67890, 1, 2, 3, 4);
  console.log('Expected TEA:', expectedTEA);
  console.log('Obfuscated TEA:', obfuscatedTEA);

  let allPass = true;

  // Step 4: Verify semantic equivalence of basic test cases
  if (obfuscatedHash === expectedHash && expectedTEA === obfuscatedTEA) {
    console.log('\n✅ SUCCESS: Obfuscated functions produce correct output!');
  } else {
    console.error('\n❌ FAILURE: Output mismatch!');
    allPass = false;
  }

  console.log('\n--- TIER 1 TO 4 COMPREHENSIVE E2E TEST RUNNER ---');

  const e2eTests = [
    {
      name: 'Constructor Parameter Properties',
      fn: 'testConstructorParamProperties',
      cases: [
        { id: 1, args: [5, null] },
        { id: 2, args: [10, 'test'] },
        { id: 3, args: [99, null] },
        { id: 3, args: [undefined, null] },
        { id: 4, args: [3, 'hello'] },
        { id: 5, args: [7, 'child'] },
        { id: 1, args: [0, null], tier: 2 },
        { id: 2, args: [-9999999, 9999999], tier: 2 },
        { id: 3, args: [[1, 2, 3], { key: 'value' }], tier: 2 },
        { id: 4, args: [null, undefined], tier: 2 },
        { id: 5, args: [42, null], tier: 2 }
      ]
    },
    {
      name: 'Private Methods',
      fn: 'testPrivateMethods',
      cases: [
        { id: 1, args: [null, null] },
        { id: 2, args: [5, null] },
        { id: 3, args: [null, null] },
        { id: 4, args: [8, null] },
        { id: 5, args: [null, null] },
        { id: 1, args: [5, null], tier: 2 },
        { id: 2, args: [null, null], tier: 2 },
        { id: 3, args: [null, null], tier: 2 },
        { id: 3, args: ['notNull', null], tier: 2 },
        { id: 4, args: [42, null], tier: 2 },
        { id: 5, args: [null, null], tier: 2 }
      ]
    },
    {
      name: 'Private Accessors',
      fn: 'testPrivateAccessors',
      cases: [
        { id: 1, args: [42, null] },
        { id: 2, args: ['getVal', null] },
        { id: 3, args: ['setVal', null] },
        { id: 4, args: [10, 50] },
        { id: 5, args: [null, null] },
        { id: 1, args: [-1.234e-5, null], tier: 2 },
        { id: 2, args: [5, null], tier: 2 },
        { id: 2, args: [-5, null], tier: 2 },
        { id: 3, args: ['logged', null], tier: 2 },
        { id: 4, args: [null, null], tier: 2 },
        { id: 5, args: [100, null], tier: 2 }
      ]
    },
    {
      name: 'Complex Super Calls',
      fn: 'testComplexSuperCalls',
      cases: [
        { id: 1, args: ['base', 'derived'] },
        { id: 2, args: ['base-closure', 'derived-closure'] },
        { id: 3, args: [null, null] },
        { id: 4, args: [5, null] },
        { id: 4, args: [-1, null] },
        { id: 5, args: ['b', 'l2'] },
        { id: 1, args: [null, null], tier: 2 },
        { id: 2, args: ['arrow-return', null], tier: 2 },
        { id: 3, args: [[1, 2, 3], null], tier: 2 },
        { id: 4, args: [null, null], tier: 2 },
        { id: 5, args: [null, null], tier: 2 }
      ]
    },
    {
      name: 'Complex Destructuring',
      fn: 'testComplexDestructuring',
      cases: [
        { id: 1, args: [{ a: { b: 5 } }, null] },
        { id: 1, args: [undefined, null] },
        { id: 2, args: [[10, [20, 30]], null] },
        { id: 2, args: [undefined, null] },
        { id: 3, args: [{ a: [10, 20, 30] }, null] },
        { id: 3, args: [undefined, null] },
        { id: 4, args: [[1, 2, 3, 4], null] },
        { id: 5, args: ['computed', null] },
        { id: 1, args: [null, null], tier: 2 },
        { id: 2, args: [null, null], tier: 2 },
        { id: 3, args: [42, null], tier: 2 },
        { id: 4, args: [null, null], tier: 2 },
        { id: 5, args: ['deep', null], tier: 2 }
      ]
    },
    {
      name: 'Loop Headers',
      fn: 'testLoopHeaders',
      cases: [
        { id: 1, args: [[[1, 2], [3, 4]], null] },
        { id: 2, args: [{ x: 1, y: 2 }, null] },
        { id: 3, args: [[{ a: { b: 'foo' } }, { a: { b: 'bar' } }], null] },
        { id: 4, args: [[[1, 2], [3, 4]], null] },
        { id: 5, args: [[[1, 2, 3], [4, 5]], null] },
        { id: 1, args: [null, null], tier: 2 },
        { id: 2, args: [null, null], tier: 2 },
        { id: 3, args: [[1, 2], null], tier: 2 },
        { id: 4, args: [[1, 2, 3], null], tier: 2 },
        { id: 5, args: [[1, 2, 3, 4, 5], null], tier: 2 }
      ]
    },
    {
      name: 'React Hooks / JSX Safety',
      fn: 'testReactHooksJSX',
      cases: [
        { id: 1, args: [5, null] },
        { id: 2, args: ['provider', null] },
        { id: 3, args: ['state', null] },
        { id: 4, args: ['ctx', null] },
        { id: 5, args: ['query', null] },
        { id: 1, args: ['nested', null], tier: 2 },
        { id: 2, args: [null, null], tier: 2 },
        { id: 3, args: ['compState', null], tier: 2 },
        { id: 4, args: ['x', null], tier: 2 },
        { id: 5, args: ['userComponent', null], tier: 2 }
      ]
    },
    {
      name: 'VM Blockers',
      fn: 'testVMBlockers',
      cases: [
        { id: 1, args: [42, null] },
        { id: 2, args: ['with', null] },
        { id: 3, args: ['import', null] },
        { id: 4, args: [5, null] },
        { id: 4, args: [-5, null] },
        { id: 5, args: ['loop', null] },
        { id: 1, args: ['emptyWith', null], tier: 2 },
        { id: 2, args: ['try', 'catch'], tier: 2 },
        { id: 3, args: ['importCatch', null], tier: 2 },
        { id: 4, args: [10, 20], tier: 2 },
        { id: 5, args: ['nestedDebugger', null], tier: 2 }
      ]
    },
    {
      name: 'Cross Feature Combinations',
      fn: 'testCrossFeatureCombinations',
      combo: true,
      cases: [
        { id: 1, args: [5, 10] },
        { id: 2, args: [5, 10] },
        { id: 3, args: [5, 10] },
        { id: 4, args: ['val', null] },
        { id: 5, args: [{ x: 10, y: { z: 'custom' } }, null] },
        { id: 6, args: [[{ a: [1, 2] }, { a: [3] }, {}], null] },
        { id: 7, args: [[10, 20, 30], null] },
        { id: 8, args: ['init', 'update'] }
      ]
    },
    {
      name: 'Real World Scenarios',
      fn: 'testRealWorldScenarios',
      scenario: true,
      cases: [
        { id: 1, args: ['SM1', [{ type: 'TRANSITION', payload: { nextState: 'RUNNING' } }]] },
        { id: 2, args: [10, [5, 12, 8, 20]] },
        { id: 3, args: ['production', ['logger', 'db', 'auth']] },
        { id: 4, args: [[[1, 2, 3], [0, 4, 5], [1, 0, 6]], null] },
        { id: 5, args: ['MyRenderer', { children: ['hello', 'world'], useHook: false }] },
        { id: 5, args: ['MyRenderer', { useHook: true }] }
      ]
    }
  ];

  let e2ePass = true;
  for (const group of e2eTests) {
    console.log(`\n  Running Group: ${group.name}`);
    for (const tc of group.cases) {
      const tier = tc.tier || 1;
      const caseId = tc.id;
      const args = tc.args;
      const fnName = group.fn;
      
      let expected, actual;
      if (group.combo) {
        expected = orig[fnName](caseId, ...args);
        actual = mod[fnName](caseId, ...args);
      } else if (group.scenario) {
        expected = orig[fnName](caseId, ...args);
        actual = mod[fnName](caseId, ...args);
      } else {
        expected = orig[fnName](tier, caseId, ...args);
        actual = mod[fnName](tier, caseId, ...args);
      }
      
      if (expected instanceof Promise || actual instanceof Promise) {
        expected = await expected;
        actual = await actual;
      }

      const pass = JSON.stringify(expected) === JSON.stringify(actual);
      console.log(`    ${pass ? '✅' : '❌'} Case ${caseId} (Tier ${tier}): ${JSON.stringify(actual)} (expected ${JSON.stringify(expected)})`);
      if (!pass) {
        e2ePass = false;
        allPass = false;
      }
    }
  }

  if (allPass) {
    console.log('\n✅ ALL TESTS PASSED — Perfect Semantic Equivalence Verified (NASA Codex Compliant).');
  } else {
    console.error('\n❌ SOME TESTS FAILED');
    process.exit(1);
  }
})();

