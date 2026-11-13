import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'cachewitness-package-'));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('Run this check with npm run verify:package.');
const npm = (args) => exec(process.execPath, [npmCli, ...args], {
  cwd: root, timeout: 60000, maxBuffer: 4 * 1024 * 1024,
});
try {
  const { stdout } = await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary]);
  const [packed] = JSON.parse(stdout);
  assert(packed.files.some(f => f.path === 'bin/cachewitness.js'));
  assert(!packed.files.some(f => /^(tests|reports|scripts|\.git)\//.test(f.path)));
  await npm(['install', '--prefix', temporary, '--ignore-scripts', '--no-audit', '--no-fund', '--offline', join(temporary, packed.filename)]);
  const cli = join(temporary, 'node_modules', '@godz1llla', 'cachewitness', 'bin', 'cachewitness.js');
  const run = async (args) => {
    try {
      const out = await exec(process.execPath, [cli, ...args], { cwd: temporary, timeout: 30000 });
      return { ...out, code: 0 };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return error;
    }
  };
  const vulnerable = await run(['demo', '--json', '--output', join(temporary, 'report.json')]);
  assert.equal(vulnerable.code, 1, vulnerable.stderr);
  const witness = JSON.parse(vulnerable.stdout);
  assert.equal(witness.status, 'fail');
  assert.equal(witness.summary.contamination, 2);
  assert.deepEqual(JSON.parse(await readFile(join(temporary, 'report.json'), 'utf8')), witness);
  const fixed = await run(['demo', '--fixed', '--json']);
  assert.equal(fixed.code, 0, fixed.stderr);
  assert.equal(JSON.parse(fixed.stdout).status, 'pass');
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  console.log(`Verified ${packed.filename}: installed CLI detects both contamination directions; fixed cache passes.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
