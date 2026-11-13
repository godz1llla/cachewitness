import { readFile, stat } from 'node:fs/promises';

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

function fail(message) { throw new ConfigError(message); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
}
function keys(value, allowed, label) {
  object(value, label);
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(`${label} contains an unsupported field.`);
}
function integer(value, fallback, min, max, label) {
  const result = value === undefined ? fallback : value;
  if (!Number.isInteger(result) || result < min || result > max) fail(`${label} must be an integer between ${min} and ${max}.`);
  return result;
}

// Only explicit environment references are expanded; no shell or code is evaluated.
function expand(value, env, depth = 0) {
  if (depth > 32) fail('Configuration nesting is too deep.');
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
      if (!Object.hasOwn(env, name) || env[name] === undefined) fail('A referenced environment variable is not set.');
      return String(env[name]);
    });
  }
  if (Array.isArray(value)) return value.map(item => expand(item, env, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, expand(item, env, depth + 1)]));
  return value;
}

const blockedHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'expect', 'proxy-connection', 'keep-alive']);
function headers(value, label) {
  if (value === undefined) return {};
  object(value, label);
  const result = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (typeof entry !== 'string' || blockedHeaders.has(normalized) || Object.hasOwn(result, normalized)) fail(`${label} contains an invalid or unsupported header.`);
    try {
      const checked = new Headers([[key, entry]]);
      result[normalized] = checked.get(key);
    } catch { fail(`${label} contains an invalid or unsupported header.`); }
  }
  return Object.fromEntries(Object.entries(result));
}

function path(value, label) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n\t#]/.test(value)) fail(`${label} must be an origin-relative path beginning with a single slash, without fragments or backslashes.`);
  return value;
}

export function normalizeConfig(input, { allowRemote = false, env = process.env } = {}) {
  keys(input, ['baseUrl', 'request', 'variants', 'reset', 'ignore', 'timeoutMs', 'maxBodyBytes', 'baselineRuns'], 'Configuration');
  const data = expand(input, env);
  let base;
  try { base = new URL(data.baseUrl); } catch { fail('baseUrl must be an HTTP(S) origin.'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') fail('baseUrl must be an HTTP(S) origin without credentials, path, query, or fragment.');
  if (!allowRemote && !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) fail('Remote targets require --allow-remote. Use a disposable test environment you control.');

  keys(data.request, ['path', 'method', 'headers'], 'request');
  if ((data.request.method === undefined ? 'GET' : data.request.method) !== 'GET') fail('request.method must be GET.');
  const request = { path: path(data.request.path, 'request.path'), method: 'GET', headers: headers(data.request.headers, 'request.headers') };
  keys(data.reset, ['path', 'method', 'headers', 'body'], 'reset');
  const resetMethod = data.reset.method === undefined ? 'POST' : data.reset.method;
  if (!['POST', 'DELETE'].includes(resetMethod)) fail('reset.method must be POST or DELETE.');
  const reset = { path: path(data.reset.path, 'reset.path'), method: resetMethod, headers: headers(data.reset.headers, 'reset.headers') };
  if (Object.hasOwn(data.reset, 'body')) reset.body = data.reset.body;

  if (!Array.isArray(data.variants) || data.variants.length < 2 || data.variants.length > 16) fail('variants must contain between 2 and 16 entries.');
  const names = new Set();
  const variants = data.variants.map(value => {
    keys(value, ['name', 'headers', 'query'], 'A variant');
    if (typeof value.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,47}$/.test(value.name) || names.has(value.name)) fail('Variant names must be unique, 1–48 characters, and contain only letters, digits, dots, underscores, and hyphens.');
    names.add(value.name);
    const query = value.query === undefined ? {} : value.query;
    object(query, 'Variant query');
    if (Object.values(query).some(item => typeof item !== 'string')) fail('Variant query values must be strings.');
    return { name: value.name, headers: headers(value.headers, 'Variant headers'), query };
  });
  const ignore = data.ignore === undefined ? [] : data.ignore;
  if (!Array.isArray(ignore) || ignore.length > 100 || ignore.some(pointer => typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/.test(pointer) || pointer.includes('*'))) fail('ignore must be an array of up to 100 non-root RFC 6901 JSON pointers; wildcards are not supported.');
  return {
    baseUrl: base.origin, request, variants, reset, ignore: [...new Set(ignore)],
    timeoutMs: integer(data.timeoutMs, 5000, 1, 60000, 'timeoutMs'),
    maxBodyBytes: integer(data.maxBodyBytes, 1048576, 1, 10485760, 'maxBodyBytes'),
    baselineRuns: integer(data.baselineRuns, 2, 2, 5, 'baselineRuns'),
  };
}

export async function loadConfig(filename, options) {
  let content;
  try {
    const info = await stat(filename);
    if (!info.isFile() || info.size > 1048576) fail('Configuration must be a JSON file no larger than 1 MiB.');
    content = await readFile(filename, 'utf8');
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    fail('Could not read the configuration file.');
  }
  let parsed;
  try { parsed = JSON.parse(content); } catch { fail('Configuration is not valid JSON.'); }
  return normalizeConfig(parsed, options);
}
