const cp = require('child_process');
const fs = require('fs');
fs.rmSync('dist-obf', { recursive: true, force: true });
cp.execSync('node packages/cli/dist/cli.js -p examples/basic-ts/tsconfig.json --out dist-obf', { stdio: 'inherit' });
const files = fs.readdirSync('dist-obf').filter(f => f.startsWith('build_') && f.endsWith('.js'));
for (const f of files) {
  const mod = require('./dist-obf/' + f);
  console.log('File:', f, 'Exports:', Object.keys(mod));
  if (mod.run) {
    console.log('Running run()...');
    mod.run();
  } else if (mod.calculateFibonacci) {
    console.log('Fib 10 =', mod.calculateFibonacci(10));
  }
}
