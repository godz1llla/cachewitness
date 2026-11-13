import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, exitCode } from '../src/report.js';
import { startDemo, createDemoConfig } from '../src/demo.js';

const entry = fileURLToPath(new URL('../bin/cachewitness.js', import.meta.url));
function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stdout, stderr }));
  });
}

test('help and version work without a target', async () => {
  const help = await run(['--help']);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /cachewitness check/);
  assert.match(help.stdout, /Exit codes/);
  assert.equal(help.stderr, '');
  const version = await run(['--version']);
  assert.equal(version.code, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+/);
});

test('CLI argument failures have explicit non-zero status and clean JSON', async () => {
  for (const args of [['check', '--json'], ['demo', '--fixed', '--fixed', '--json'], ['demo', '--output', '--json'], ['check', '/missing.json', '--fixed', '--json'], ['unknown', '--json']]) {
    const result = await run(args);
    assert.equal(result.code, 2);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.equal(result.stderr, '');
  }
});

test('broken demo provides ordered, reproducible contamination evidence', async () => {
  const result = await run(['demo', '--json']);
  assert.equal(result.code, 1, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.contamination, 2);
  assert.equal(report.checks.filter(check => check.outcome === 'contamination').length, 2);
  assert.ok(report.checks.every(check => check.differences.length > 0));
  assert.equal(result.stderr, '');
});

test('fixed demo passes and creates a JSON report with identical results', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-cli-'));
  try {
    const reportFile = join(dir, 'nested', 'report.json');
    const result = await run(['demo', '--fixed', '--json', '--output', reportFile]);
    assert.equal(result.code, 0, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'pass');
    assert.equal(report.summary.passed, 2);
    assert.deepEqual(JSON.parse(await readFile(reportFile, 'utf8')), report);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('check refuses to overwrite its own input', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-cli-'));
  try {
    const file = join(dir, 'input.json');
    await writeFile(file, '{}');
    const result = await run(['check', file, '--output', file, '--json']);
    assert.equal(result.code, 2);
    assert.match(JSON.parse(result.stdout).message, /overwrite/);
    assert.equal(await readFile(file, 'utf8'), '{}');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('inconclusive reports never exit successfully', () => {
  assert.equal(exitCode({ status: 'inconclusive' }), 2);
  assert.equal(exitCode({ status: 'error' }), 2);
  assert.equal(exitCode({ status: 'fail' }), 1);
  assert.equal(exitCode({ status: 'pass' }), 0);
  assert.match(formatReport({ status: 'inconclusive', checks: [] }), /Coverage is incomplete/);
});

test('check loads environment credentials without leaking them into a report', async () => {
  const server = await startDemo();
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-check-'));
  try {
    const config = createDemoConfig(server.baseUrl);
    config.variants[0].headers.authorization = '${CACHEWITNESS_TEST_AUTH}';
    const file = join(dir, 'config.json');
    await writeFile(file, JSON.stringify(config));
    const result = await run(['check', file, '--json'], { env: { CACHEWITNESS_TEST_AUTH: 'Bearer demo-alice' } });
    assert.equal(result.code, 1, result.stderr || result.stdout);
    assert.equal(JSON.parse(result.stdout).summary.contamination, 2);
    assert.ok(!result.stdout.includes('Bearer'));
    assert.ok(!result.stdout.includes('demo-alice'));
    assert.ok(!result.stdout.includes('129900'));
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('field paths cannot inject terminal control sequences', () => {
  const output = formatReport({ status: 'fail', checks: [{ source: 'a', target: 'b', outcome: 'drift', differences: ['/body/\u001b[2J\nFAKE PASS'] }] });
  assert.ok(!output.includes('\u001b'));
  assert.ok(output.includes('\\u001b[2J\\u000aFAKE PASS'));
});
