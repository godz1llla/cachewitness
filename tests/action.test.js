import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAction, formatJobSummary } from '../scripts/action.js';
import { startDemo, createDemoConfig } from '../src/demo.js';

async function context(t) {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-action-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, env: { GITHUB_WORKSPACE: dir, CACHEWITNESS_CONFIG: 'config.json', GITHUB_OUTPUT: join(dir, 'outputs'), GITHUB_STEP_SUMMARY: join(dir, 'summary') } };
}

for (const fixed of [false, true]) {
  test(`GitHub action saves both reports, summary and outputs for ${fixed ? 'pass' : 'contamination'}`, async t => {
    const { dir, env } = await context(t);
    const server = await startDemo({ fixed });
    t.after(() => server.close());
    await writeFile(join(dir, 'config.json'), JSON.stringify(createDemoConfig(server.baseUrl)));
    const logs = [];
    const code = await runAction(env, { log: text => logs.push(text) });
    assert.equal(code, fixed ? 0 : 1);
    const report = JSON.parse(await readFile(join(dir, 'cachewitness-reports', 'report.json'), 'utf8'));
    assert.equal(report.status, fixed ? 'pass' : 'fail');
    const html = await readFile(join(dir, 'cachewitness-reports', 'report.html'), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.ok(!html.includes('Bearer demo-alice'));
    const outputs = await readFile(env.GITHUB_OUTPUT, 'utf8');
    assert.match(outputs, new RegExp(`status=${report.status}`));
    assert.match(outputs, /report-html=.*report\.html/);
    const summary = await readFile(env.GITHUB_STEP_SUMMARY, 'utf8');
    assert.match(summary, /alice → bob/);
    assert.match(summary, /16 HTTP requests/);
    assert.ok(!summary.includes('129900'));
    assert.equal(logs.length, 1);
  });
}

test('configuration errors create fresh error reports and do not expose environment values', async t => {
  const { dir, env } = await context(t);
  await writeFile(join(dir, 'config.json'), JSON.stringify({ baseUrl: '${SECRET_NOT_SET}' }));
  assert.equal(await runAction(env, { log() {} }), 2);
  const report = JSON.parse(await readFile(join(dir, 'cachewitness-reports', 'report.json'), 'utf8'));
  assert.equal(report.status, 'error');
  assert.ok(!JSON.stringify(report).includes('SECRET_NOT_SET'));
  assert.match(await readFile(env.GITHUB_STEP_SUMMARY, 'utf8'), /ERROR/);
});

test('action rejects workspace escapes and output collisions before reading a configuration', async t => {
  const { dir, env } = await context(t);
  await writeFile(join(dir, 'config.json'), '{}');
  for (const override of [
    { CACHEWITNESS_REPORT_DIRECTORY: '..' },
    { CACHEWITNESS_REPORT_DIRECTORY: 'bad\nstatus=pass' },
    { CACHEWITNESS_CONFIG: '../outside.json' },
    { CACHEWITNESS_ALLOW_REMOTE: 'yes' },
    { CACHEWITNESS_CONFIG: 'report.json', CACHEWITNESS_REPORT_DIRECTORY: '.' },
  ]) {
    const messages = [];
    assert.equal(await runAction({ ...env, ...override }, { log: text => messages.push(text) }), 2);
    assert.match(messages.join('\n'), /ERROR/);
  }
  assert.equal(await readFile(join(dir, 'config.json'), 'utf8'), '{}');
});

test('action rejects directory symlinks that escape the workspace', async t => {
  const { dir, env } = await context(t);
  const outside = await mkdtemp(join(tmpdir(), 'cachewitness-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const logs = [];
  assert.equal(await runAction({ ...env, CACHEWITNESS_REPORT_DIRECTORY: 'linked/nested' }, { log: value => logs.push(value) }), 2);
  assert.match(logs[0], /inside the workspace/);
});

test('job summary escapes markup and table delimiters in report metadata', () => {
  const summary = formatJobSummary({ status: 'error', checks: [{ source: '<img src=x onerror=alert(1)>|bad', target: 'b\n## forged', outcome: 'error' }] });
  assert.ok(!summary.includes('<img'));
  assert.ok(summary.includes('&lt;img'));
  assert.ok(summary.includes('&#124;bad'));
  assert.ok(!summary.includes('\n## forged'));
});

test('a symlink cannot inject an Actions output through its resolved filename', { skip: process.platform === 'win32' }, async t => {
  const { dir, env } = await context(t);
  const target = join(dir, 'reports\nstatus=pass');
  await mkdir(target);
  await symlink(target, join(dir, 'innocent'), 'dir');
  assert.equal(await runAction({ ...env, CACHEWITNESS_REPORT_DIRECTORY: 'innocent' }, { log() {} }), 2);
  assert.equal(await readFile(env.GITHUB_OUTPUT, 'utf8'), 'status=error\n');
});
