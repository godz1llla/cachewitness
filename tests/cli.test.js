import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport, exitCode } from '../src/report.js';
import { startDemo, createDemoConfig } from '../src/demo.js';

const entry = fileURLToPath(new URL('../bin/cachewitness.js', import.meta.url));
function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd: options.cwd, env: { ...process.env, ...options.env }, stdio: ['ignore', 'pipe', 'pipe'] });
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

test('init defaults to cachewitness.json and describes the required reset endpoint', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-init-cli-'));
  try {
    const result = await run(['init', '--json'], { cwd: dir });
    assert.equal(result.code, 0, result.stderr);
    const created = JSON.parse(result.stdout);
    assert.equal(created.status, 'created');
    assert.equal(created.path, 'cachewitness.json');
    assert.equal(created.preset, 'auth');
    assert.ok(created.nextSteps.some(s => s.includes('reset endpoint')));
    assert.equal(JSON.parse(await readFile(join(dir, 'cachewitness.json'), 'utf8')).baseUrl, '${CACHEWITNESS_BASE_URL}');
    assert.equal(result.stderr, '');
    const duplicate = await run(['init', '--json'], { cwd: dir });
    assert.equal(duplicate.code, 2);
    assert.match(JSON.parse(duplicate.stdout).message, /already exists/);
    for (const args of [['init', '--allow-remote', '--json'], ['init', '--preset', 'unknown', '--json'], ['init', '--html', 'report.html', '--json'], ['demo', '--preset', 'auth', '--json']]) {
      const invalid = await run(args, { cwd: dir });
      assert.equal(invalid.code, 2);
      assert.equal(JSON.parse(invalid.stdout).status, 'error');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('init never contacts the configured endpoint', async () => {
  let calls = 0;
  const server = createServer((_req, res) => { calls++; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-init-offline-'));
  try {
    const result = await run(['init', '--preset', 'tenant'], { cwd: dir, env: { CACHEWITNESS_BASE_URL: `http://127.0.0.1:${server.address().port}` } });
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /No requests were sent/);
    assert.equal(calls, 0);
    assert.equal(JSON.parse(await readFile(join(dir, 'cachewitness.json'), 'utf8')).variants[0].name, 'acme');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('HTML and JSON exports describe the same failed audit while stdout stays JSON', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-html-cli-'));
  try {
    const json = join(dir, 'report.json'), html = join(dir, 'report.html');
    const result = await run(['demo', '--json', '--output', json, '--html', html]);
    assert.equal(result.code, 1, result.stderr || result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'fail');
    assert.deepEqual(JSON.parse(await readFile(json, 'utf8')), report);
    const page = await readFile(html, 'utf8');
    assert.match(page, /<!doctype html>/i);
    assert.match(page, /contamination/i);
    assert.match(page, /alice/);
    assert.match(page, /bob/);
    assert.equal(result.stderr, '');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('report destinations are validated before any reset or probe', async () => {
  let calls = 0;
  const server = createServer((_req, res) => { calls++; res.end('{}'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-collisions-'));
  try {
    const file = join(dir, 'config.json');
    const original = JSON.stringify(createDemoConfig(`http://127.0.0.1:${server.address().port}`));
    await writeFile(file, original);
    for (const flag of ['--output', '--html']) {
      const result = await run(['check', file, flag, file, '--json']);
      assert.equal(result.code, 2);
      assert.match(JSON.parse(result.stdout).message, /overwrite the configuration/);
    }
    const shared = join(dir, 'same-report');
    const collision = await run(['check', file, '--output', shared, '--html', shared, '--json']);
    assert.equal(collision.code, 2);
    assert.match(JSON.parse(collision.stdout).message, /different destination/);
    for (const [output, html] of [[join(dir, 'reports'), join(dir, 'reports', 'report.html')], [join(dir, 'reports', 'report.json'), join(dir, 'reports')]]) {
      const hierarchy = await run(['check', file, '--output', output, '--html', html, '--json']);
      assert.equal(hierarchy.code, 2);
      assert.match(JSON.parse(hierarchy.stdout).message, /must not contain/);
    }
    const directory = await run(['check', file, '--html', dir, '--json']);
    assert.equal(directory.code, 2);
    assert.match(JSON.parse(directory.stdout).message, /must be a file/);
    assert.equal(calls, 0);
    assert.equal(await readFile(file, 'utf8'), original);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
});

test('report collision guards resolve symlink aliases, including absent descendants', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-report-links-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, '{}');
    const real = join(dir, 'real');
    const alias = join(dir, 'alias');
    await mkdir(real);
    try { await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
    catch (error) {
      if (error.code === 'EPERM') { t.skip('Host cannot create directory links.'); return; }
      throw error;
    }
    const output = join(real, 'missing', 'report');
    const html = join(alias, 'missing', 'report');
    const collision = await run(['check', file, '--output', output, '--html', html, '--json']);
    assert.equal(collision.code, 2);
    assert.match(JSON.parse(collision.stdout).message, /different destination/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });

    const fileAlias = join(dir, 'config-alias.json');
    try { await symlink(file, fileAlias, 'file'); }
    catch (error) { if (error.code === 'EPERM') return; throw error; }
    const overwrite = await run(['check', file, '--html', fileAlias, '--json']);
    assert.equal(overwrite.code, 2);
    assert.match(JSON.parse(overwrite.stdout).message, /overwrite the configuration/);
    assert.equal(await readFile(file, 'utf8'), '{}');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
