import test from 'node:test';
import assert from 'node:assert/strict';
import { startDemo, createDemoConfig } from '../src/demo.js';

for (const fixed of [false, true]) {
  test(`demo exhibits ${fixed ? 'tenant isolation' : 'cross-tenant contamination'}`, async (t) => {
    const demo = await startDemo({ fixed });
    t.after(demo.close);
    const get = (token) => fetch(`${demo.baseUrl}/api/dashboard`, {
      headers: { authorization: `Bearer demo-${token}` },
    }).then(r => r.json());
    assert.equal((await get('alice')).tenant, 'acme');
    assert.equal((await get('bob')).tenant, fixed ? 'globex' : 'acme');
    const config = createDemoConfig(demo.baseUrl);
    assert.equal((await fetch(`${demo.baseUrl}${config.reset.path}`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${demo.baseUrl}${config.reset.path}`, config.reset)).status, 200);
    assert.equal((await get('bob')).tenant, 'globex');
    assert.equal((await fetch(`${demo.baseUrl}/api/dashboard`)).status, 401);
  });
}
