import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { audit } from '../src/audit.js';

async function fixture(t, mode = 'broken') {
  const cache = new Map();
  let tick = 0;
  let last = null;
  const server = createServer((req, res) => {
    if (req.url === '/reset') {
      cache.clear(); last = null;
      if (mode === 'reset-failure') return res.writeHead(500).end();
      return res.writeHead(204).end();
    }
    const tenant = req.headers.authorization;
    if (mode === 'auth-failure' && tenant === 'private-B') return res.writeHead(401).end('{}');
    const own = { tenant, secret: `${tenant}-sensitive-data` };
    let value = own;
    const key = mode === 'fixed' ? tenant : 'shared';
    if (mode === 'broken' || mode === 'fixed') {
      if (!cache.has(key)) cache.set(key, own);
      value = cache.get(key);
    } else if (mode === 'identical') value = { shared: 'same' };
    else if (mode === 'volatile') value = { ...own, tick: tick++ };
    else if (mode === 'drift' && last && last !== tenant) value = { tenant, secret: 'unexpected-value' };
    else if (mode === 'warm-unstable' && last === tenant) value = { tenant, secret: 'changed-on-warm' };
    last = tenant;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(value));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    request: { path: '/account', headers: {} }, reset: { path: '/reset' },
    variants: [{ name: 'A', headers: { authorization: 'private-A' } }, { name: 'B', headers: { authorization: 'private-B' } }],
    baselineRuns: 2, ignore: [], timeoutMs: 1000, maxBodyBytes: 10000,
  };
}

test('broken cache yields a witness in both directions without retaining secrets', async (t) => {
  const config = await fixture(t);
  const stages = [];
  const report = await audit(config, { onProgress: (phase) => stages.push(phase.stage) });
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.contamination, 2);
  assert.equal(report.summary.requests, 16);
  assert.deepEqual(report.checks.map((c) => [c.source, c.target]), [['A', 'B'], ['B', 'A']]);
  assert.ok(report.checks.every((c) => c.fingerprints.observed === c.fingerprints.source));
  assert.deepEqual(report.checks[0].differences, ['/body/secret', '/body/tenant']);
  assert.equal(JSON.stringify(report).includes('private-A'), false);
  assert.equal(JSON.stringify(report).includes('sensitive-data'), false);
  assert.equal(JSON.stringify(report).includes(config.baseUrl), false);
  assert.ok(stages.includes('prime-repeat'));
});

test('identity-aware cache passes every ordered pair', async (t) => {
  const report = await audit(await fixture(t, 'fixed'));
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.passed, 2);
  assert.equal(report.summary.contamination, 0);
});

test('identical cold baselines are inconclusive, not a false pass', async (t) => {
  const report = await audit(await fixture(t, 'identical'));
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.summary.indistinguishable, 2);
  assert.equal(report.summary.requests, 8);
});

test('unstable cold baselines are inconclusive', async (t) => {
  const report = await audit(await fixture(t, 'volatile'));
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.summary.unstable, 2);
  assert.ok(report.baselines.every((b) => b.stable === false));
});

test('explicit ignores let stable data be compared despite volatile fields', async (t) => {
  const config = await fixture(t, 'volatile');
  config.ignore = ['/tick'];
  const report = await audit(config);
  assert.equal(report.status, 'pass');
  assert.equal(report.summary.passed, 2);
});

test('unexpected cross-request response is drift without claiming source contamination', async (t) => {
  const report = await audit(await fixture(t, 'drift'));
  assert.equal(report.status, 'fail');
  assert.equal(report.summary.drift, 2);
  assert.equal(report.summary.contamination, 0);
});

test('warm response instability makes the pair inconclusive', async (t) => {
  const report = await audit(await fixture(t, 'warm-unstable'));
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.summary.unstable, 2);
  assert.equal(report.summary.requests, 14);
});

test('reset failures stop the audit and identify the stage', async (t) => {
  const report = await audit(await fixture(t, 'reset-failure'));
  assert.equal(report.status, 'error');
  assert.equal(report.summary.requests, 1);
  assert.equal(report.errors[0].stage, 'baseline-reset');
  assert.equal(report.errors[0].code, 'http_status');
});

test('authentication failures cannot be mistaken for equivalent baselines', async (t) => {
  const report = await audit(await fixture(t, 'auth-failure'));
  assert.equal(report.status, 'error');
  assert.equal(report.errors[0].variant, 'B');
  assert.equal(report.errors[0].code, 'http_status');
});

test('variant header overrides are case-insensitive', async (t) => {
  const config = await fixture(t, 'fixed');
  config.request.headers = { Authorization: 'default-secret' };
  const report = await audit(config);
  assert.equal(report.status, 'pass');
  const baselineHash = report.baselines[0].fingerprints[0];
  config.request.headers = {};
  assert.equal((await audit(config)).baselines[0].fingerprints[0], baselineHash);
});

test('a pre-cancelled audit ends with error, not pass', async (t) => {
  const config = await fixture(t, 'fixed');
  const report = await audit(config, { signal: AbortSignal.abort() });
  assert.equal(report.status, 'error');
  assert.equal(report.errors[0].code, 'aborted');
});
