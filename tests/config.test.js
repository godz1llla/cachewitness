import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, loadConfig, normalizeConfig } from '../src/config.js';

function config() {
  return {
    baseUrl: 'http://127.0.0.1:3000', request: { path: '/dashboard' },
    reset: { path: '/test/reset' },
    variants: [{ name: 'alice' }, { name: 'bob' }],
  };
}

test('defaults preserve a minimal explicit audit scenario', () => {
  const actual = normalizeConfig(config());
  assert.equal(actual.request.method, 'GET');
  assert.equal(actual.reset.method, 'POST');
  assert.equal(actual.timeoutMs, 5000);
  assert.equal(actual.maxBodyBytes, 1048576);
  assert.equal(actual.baselineRuns, 2);
  assert.deepEqual(actual.variants[0], { name: 'alice', headers: {}, query: {} });
});

test('environment credentials expand in memory without mutating input', () => {
  const input = config();
  input.variants[0].headers = { Authorization: 'Bearer ${DEMO_TOKEN}' };
  input.reset.body = { key: '${DEMO_TOKEN}' };
  const actual = normalizeConfig(input, { env: { DEMO_TOKEN: 'secret-123' } });
  assert.equal(actual.variants[0].headers.authorization, 'Bearer secret-123');
  assert.equal(actual.reset.body.key, 'secret-123');
  assert.equal(input.variants[0].headers.Authorization, 'Bearer ${DEMO_TOKEN}');
});

test('missing or invalid environment credentials produce sanitized errors', () => {
  const input = config();
  input.variants[0].headers = { authorization: 'Bearer ${PRIVATE_NAME}' };
  assert.throws(() => normalizeConfig(input, { env: {} }), error => error instanceof ConfigError && !error.message.includes('PRIVATE_NAME'));
  assert.throws(() => normalizeConfig(input, { env: { PRIVATE_NAME: 'SENSITIVE\nheader' } }), error => !error.message.includes('SENSITIVE'));
});

test('remote targets require explicit opt-in and credentials are never accepted in URLs', () => {
  for (const baseUrl of ['https://example.com', 'http://127.0.0.1.evil.example', 'http://localhost.evil.example']) {
    assert.throws(() => normalizeConfig({ ...config(), baseUrl }), /--allow-remote/);
    assert.equal(normalizeConfig({ ...config(), baseUrl }, { allowRemote: true }).baseUrl, baseUrl);
  }
  for (const baseUrl of ['file:///tmp/a', 'https://user:secret@example.com', 'http://127.0.0.1/path', 'http://127.0.0.1?token=secret']) {
    assert.throws(() => normalizeConfig({ ...config(), baseUrl }, { allowRemote: true }), error => !error.message.includes('secret'));
  }
  assert.equal(normalizeConfig({ ...config(), baseUrl: 'http://[::1]:4444/' }).baseUrl, 'http://[::1]:4444');
});

test('paths cannot change the destination origin or use URL fragments', () => {
  for (const path of ['//evil.example/x', '/\\evil.example/x', 'https://evil.example', '/x#fragment', '/x\r\n']) {
    for (const field of ['request', 'reset']) {
      const input = config(); input[field].path = path;
      assert.throws(() => normalizeConfig(input), ConfigError);
    }
  }
});

test('schema catches typos, unsafe methods, invalid bounds, and identity collisions', () => {
  const inputs = [
    { ...config(), timeout: 100 },
    { ...config(), request: { path: '/', method: 'POST' } },
    { ...config(), reset: { path: '/', method: 'GET' } },
    { ...config(), reset: undefined },
    { ...config(), variants: [{ name: 'alice' }] },
    { ...config(), variants: [{ name: 'alice' }, { name: 'alice' }] },
    { ...config(), variants: [{ name: 'alice' }, { name: 'bob\nPASS' }] },
    { ...config(), variants: [{ name: 'alice' }, { name: 'bob', query: { page: 3 } }] },
    { ...config(), baselineRuns: 1 },
    { ...config(), baselineRuns: null },
    { ...config(), ignore: null },
    { ...config(), variants: [{ name: 'alice' }, { name: 'bob', query: null }] },
    { ...config(), timeoutMs: 0 },
    { ...config(), maxBodyBytes: 10485761 },
    { ...config(), request: { path: '/', headers: { host: 'evil.example' } } },
    { ...config(), request: { path: '/', headers: { Authorization: 'a', authorization: 'b' } } },
  ];
  for (const input of inputs) assert.throws(() => normalizeConfig(input), ConfigError);
});

test('JSON pointers are explicit, escaped, and non-root', () => {
  assert.deepEqual(normalizeConfig({ ...config(), ignore: ['/time', '/a~1b/~0key', '/time'] }).ignore, ['/time', '/a~1b/~0key']);
  for (const pointer of ['', 'time', '/bad~2', '/items/*/id']) assert.throws(() => normalizeConfig({ ...config(), ignore: [pointer] }), ConfigError);
});

test('file loader rejects executable configs and hides JSON parse context', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-config-'));
  try {
    const file = join(dir, 'config.json');
    await writeFile(file, JSON.stringify(config()));
    assert.equal((await loadConfig(file)).variants.length, 2);
    await writeFile(file, '{"authorization":"private-token", BAD');
    await assert.rejects(loadConfig(file), error => error instanceof ConfigError && !error.message.includes('private-token'));
    await writeFile(file, 'export default {}');
    await assert.rejects(loadConfig(file), /not valid JSON/);
    await assert.rejects(loadConfig(dir), /JSON file/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
