import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStarterConfig, initConfig, presets } from '../src/init.js';
import { normalizeConfig } from '../src/config.js';

const env = {
  CACHEWITNESS_BASE_URL: 'http://127.0.0.1:3000',
  CACHEWITNESS_RESET_TOKEN: 'synthetic-reset',
  CACHEWITNESS_ALICE_TOKEN: 'synthetic-alice',
  CACHEWITNESS_BOB_TOKEN: 'synthetic-bob',
};

test('all starter presets normalize with explicit environment values', () => {
  for (const preset of presets) {
    const raw = createStarterConfig(preset);
    assert.equal(raw.baseUrl, '${CACHEWITNESS_BASE_URL}');
    const config = normalizeConfig(raw, { env });
    assert.equal(config.reset.path, '/__test/reset-cache');
    assert.equal(config.reset.headers.authorization, 'Bearer synthetic-reset');
    assert.deepEqual(config.ignore, []);
    assert.equal(config.variants.length, preset === 'currency' ? 3 : 2);
  }
  const tenant = normalizeConfig(createStarterConfig('tenant'), { env });
  assert.deepEqual(tenant.variants.map(v => v.headers['x-tenant-id']), ['acme', 'globex']);
  const currency = normalizeConfig(createStarterConfig('currency'), { env });
  assert.deepEqual(currency.variants.map(v => v.query.currency), ['USD', 'EUR', 'KZT']);
  assert.throws(() => createStarterConfig('unknown'), /Unknown preset/);
});

test('init writes only references and refuses to replace an existing configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-init-'));
  try {
    const filename = join(dir, 'config.json');
    const result = await initConfig(filename);
    assert.equal(result.status, 'created');
    assert.equal(result.preset, 'auth');
    const content = await readFile(filename, 'utf8');
    assert.deepEqual(JSON.parse(content), createStarterConfig());
    assert.ok(!content.includes('synthetic-alice'));
    await assert.rejects(initConfig(filename, { preset: 'currency' }), /already exists/);
    assert.equal(await readFile(filename, 'utf8'), content);
    await assert.rejects(initConfig(join(dir, 'missing', 'config.json')), /parent directory/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('init refuses existing and dangling symlink destinations', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'cachewitness-init-links-'));
  try {
    const target = join(dir, 'original.json');
    const alias = join(dir, 'alias.json');
    await writeFile(target, 'original');
    try { await symlink(target, alias, 'file'); }
    catch (error) {
      if (error.code === 'EPERM') { t.skip('Host cannot create file symlinks.'); return; }
      throw error;
    }
    await assert.rejects(initConfig(alias), /already exists/);
    assert.equal(await readFile(target, 'utf8'), 'original');
    const dangling = join(dir, 'dangling.json');
    await symlink(join(dir, 'not-created.json'), dangling, 'file');
    await assert.rejects(initConfig(dangling), /already exists/);
    await assert.rejects(readFile(join(dir, 'not-created.json')), { code: 'ENOENT' });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
