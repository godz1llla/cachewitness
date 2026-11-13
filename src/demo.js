import { createServer } from 'node:http';

// Public, synthetic fixtures. These are not credentials for any real service.
const accounts = new Map([
  ['Bearer demo-alice', { tenant: 'acme', owner: 'Alice', balanceCents: 129900 }],
  ['Bearer demo-bob', { tenant: 'globex', owner: 'Bob', balanceCents: 8400 }],
]);

export async function startDemo({ fixed = false, port = 0 } = {}) {
  const cache = new Map();
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const reply = (status, value, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(value));
    };

    if (url.pathname === '/__cachewitness/reset' && req.method === 'POST') {
      if (req.headers['x-cachewitness-demo'] !== 'reset-synthetic-cache') {
        reply(403, { error: 'Demo reset header required' });
        return;
      }
      cache.clear();
      reply(200, { reset: true });
      return;
    }
    if (url.pathname !== '/api/dashboard' || req.method !== 'GET') {
      reply(404, { error: 'Not found' });
      return;
    }
    const account = accounts.get(req.headers.authorization);
    if (!account) {
      reply(401, { error: 'Use a synthetic demo account' });
      return;
    }
    // The complete bug and its fix: a shared key vs a tenant-scoped key.
    const key = fixed ? `dashboard:${account.tenant}` : 'dashboard';
    const hit = cache.has(key);
    if (!hit) cache.set(key, { ...account });
    reply(200, { ...cache.get(key), generatedAt: new Date().toISOString() }, {
      'x-demo-cache': hit ? 'HIT' : 'MISS',
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    }),
  };
}

export function createDemoConfig(baseUrl) {
  return {
    baseUrl,
    request: { path: '/api/dashboard', method: 'GET', headers: {} },
    variants: [
      { name: 'alice', headers: { authorization: 'Bearer demo-alice' }, query: {} },
      { name: 'bob', headers: { authorization: 'Bearer demo-bob' }, query: {} },
    ],
    reset: {
      path: '/__cachewitness/reset', method: 'POST',
      headers: { 'x-cachewitness-demo': 'reset-synthetic-cache' },
    },
    ignore: ['/generatedAt'], timeoutMs: 5000, maxBodyBytes: 1048576, baselineRuns: 2,
  };
}
