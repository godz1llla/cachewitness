import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { audit } from '../src/audit.js';
import { normalizeConfig } from '../src/config.js';

for (const fixed of [false, true]) {
  test(`three currency variants ${fixed ? 'stay isolated' : 'expose a missing query discriminator'} in all six orders`, async (t) => {
    const cache = new Map();
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost');
      res.setHeader('content-type', 'application/json');
      if (url.pathname === '/reset' && req.method === 'DELETE') {
        cache.clear();
        res.end('{}');
        return;
      }
      const currency = url.searchParams.get('currency');
      const prices = { USD: 100, EUR: 92, KZT: 49000 };
      const key = fixed ? `price:${currency}` : 'price';
      if (!cache.has(key)) cache.set(key, { currency, price: prices[currency] });
      res.end(JSON.stringify(cache.get(key)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const config = normalizeConfig({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      request: { path: '/price?product=demo' },
      reset: { path: '/reset', method: 'DELETE' },
      variants: ['USD', 'EUR', 'KZT'].map(name => ({ name, query: { currency: name } })),
    });
    const report = await audit(config);
    assert.equal(report.status, fixed ? 'pass' : 'fail');
    assert.equal(report.summary.pairs, 6);
    assert.equal(report.summary.requests, 36);
    assert.equal(fixed ? report.summary.passed : report.summary.contamination, 6);
    assert.equal(new Set(report.checks.map(c => `${c.source}-${c.target}`)).size, 6);
  });
}
