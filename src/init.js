import { lstat, writeFile } from 'node:fs/promises';
import { ConfigError } from './config.js';

export const presets = ['auth', 'tenant', 'currency'];

export function createStarterConfig(preset = 'auth') {
  if (!presets.includes(preset)) throw new ConfigError('Unknown preset. Choose auth, tenant, or currency.');
  const variants = {
    auth: [
      { name: 'alice', headers: { authorization: 'Bearer ${CACHEWITNESS_ALICE_TOKEN}' } },
      { name: 'bob', headers: { authorization: 'Bearer ${CACHEWITNESS_BOB_TOKEN}' } },
    ],
    tenant: [
      { name: 'acme', headers: { 'x-tenant-id': 'acme' } },
      { name: 'globex', headers: { 'x-tenant-id': 'globex' } },
    ],
    currency: [
      { name: 'USD', query: { currency: 'USD' } },
      { name: 'EUR', query: { currency: 'EUR' } },
      { name: 'KZT', query: { currency: 'KZT' } },
    ],
  };
  return {
    baseUrl: '${CACHEWITNESS_BASE_URL}',
    request: { path: preset === 'currency' ? '/api/prices' : '/api/dashboard', method: 'GET' },
    variants: variants[preset],
    reset: {
      path: '/__test/reset-cache', method: 'POST',
      headers: { authorization: 'Bearer ${CACHEWITNESS_RESET_TOKEN}' },
    },
    ignore: [],
  };
}

export async function initConfig(filename = 'cachewitness.json', { preset = 'auth' } = {}) {
  const config = createStarterConfig(preset);
  try {
    // On Windows, wx may follow a dangling symlink and create its target.
    // Inspect the directory entry itself before the exclusive file creation.
    const existing = await lstat(filename).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (existing) {
      const error = new Error('Destination exists.');
      error.code = 'EEXIST';
      throw error;
    }
    // Keep wx so another ordinary file cannot be overwritten after the check.
    await writeFile(filename, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ConfigError('The configuration destination already exists. Choose a new file; init never overwrites files or symlinks.');
    if (error.code === 'ENOENT') throw new ConfigError('The configuration parent directory does not exist. Create it first.');
    throw new ConfigError('Could not create the configuration file. Check the destination directory and permissions.');
  }
  const environment = ['CACHEWITNESS_BASE_URL', 'CACHEWITNESS_RESET_TOKEN'];
  if (preset === 'auth') environment.push('CACHEWITNESS_ALICE_TOKEN', 'CACHEWITNESS_BOB_TOKEN');
  return {
    status: 'created', preset, path: filename,
    environment,
    nextSteps: [
      'Set the listed environment variables for a disposable test environment you control.',
      'Edit request.path and variants to match your application. Tenant headers must be authorized by your application; add authentication where needed.',
      'Implement or configure the test-only reset endpoint. It must finish clearing the relevant cache before returning a successful response.',
      'Run cachewitness check with this configuration. Add --allow-remote only for a non-loopback test environment.',
    ],
  };
}

export function formatInitResult(result) {
  return [
    `Created ${JSON.stringify(result.path)} with the ${result.preset} preset.`,
    `Environment: ${result.environment.join(', ')}`,
    ...result.nextSteps.map((step, index) => `${index + 1}. ${step}`),
    'No requests were sent. No credentials were written to the configuration.',
  ].join('\n');
}
