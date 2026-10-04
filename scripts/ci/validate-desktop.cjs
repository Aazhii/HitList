'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const checkOnly = process.argv.includes('--check');
const run = (command, args, cwd = root) => {
  console.log(`\nValidate: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error(`Validation failed: ${command} (${result.error?.code || result.status})`);
};
const files = (dir, pattern) => fs.readdirSync(path.join(root, dir)).filter((file) => pattern.test(file)).map((file) => path.join(dir, file));

try {
  run('git', ['diff', '--check']);
  run('git', ['diff', '--cached', '--check']);
  for (const file of ['desktop/main.js', 'desktop/preload.js', 'desktop/installer.js', 'desktop/updater.js',
    ...files('desktop/scripts', /\.js$/), ...files('scripts/ci', /\.cjs$/)]) run(process.execPath, ['--check', file]);
  if (process.platform !== 'win32') {
    for (const file of [...files('desktop/scripts', /\.sh$/), ...files('scripts/ci', /\.sh$/)]) run('sh', ['-n', file]);
  }
  if (!checkOnly) {
    run(process.execPath, ['--test', ...files('desktop', /^test\..*\.js$/)]);
    run(process.execPath, ['--test', ...files('functions/backup', /^test\..*\.js$/)]);
    run(process.execPath, ['--test', ...files('functions/cliq-webhook', /^test\..*\.js$/)]);
    run(process.execPath, ['node_modules/typescript/bin/tsc', '-b'], path.join(root, 'web'));
    run(process.execPath, ['scripts/design-check.mjs'], path.join(root, 'web'));
    run(process.execPath, ['node_modules/eslint/bin/eslint.js', 'src', 'test'], path.join(root, 'web'));
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], path.join(root, 'web'));
    run(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], path.join(root, 'web'));
    const mvn = process.env.HITLIST_MVN || 'mvn';
    if (process.platform === 'win32') {
      throw new Error('Run the documented native Windows Maven and packaging gates; the full validator currently requires a POSIX host.');
    }
    run(mvn, ['-B', '-f', 'api/pom.xml', 'test']);
    const staticOutput = path.join(root, 'api/target/classes/static');
    fs.rmSync(staticOutput, { recursive: true, force: true });
    fs.cpSync(path.join(root, 'web/dist'), staticOutput, { recursive: true });
    run(mvn, ['-B', '-f', 'api/pom.xml', '-DskipTests', 'package']);
    const java = process.env.HITLIST_JAVA || (process.env.JAVA_HOME
      ? path.join(process.env.JAVA_HOME, 'bin/java')
      : spawnSync('which', ['java'], { encoding: 'utf8' }).stdout?.trim());
    if (!java) throw new Error('Java 25 is required; set JAVA_HOME or HITLIST_JAVA.');
    run(process.execPath, ['desktop/scripts/smoke-backend.js', java, 'api/target/hitlist.jar']);
    run(process.execPath, ['desktop/e2e/workspaces.e2e.js']);
    run('sh', ['scripts/ci/compute-version.test.sh']);
  }
  console.log(checkOnly ? '\nStatic checks passed. Full tests and native platform gates remain required.' : '\nLocal validation passed. Native packaging and manual release gates remain required.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}