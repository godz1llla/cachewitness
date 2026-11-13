import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestJson } from '../src/http.js';

async function serve(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}

test('sends exact query and headers and parses JSON', async (t) => {
  const baseUrl = await serve(t, (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ path: req.url, header: req.headers.authorization }));
  });
  const result = await requestJson({ baseUrl, path: '/api?keep=yes', query: { locale: 'en GB' }, headers: { authorization: 'Bearer test' } });
  assert.equal(result.body.path, '/api?keep=yes&locale=en+GB');
  assert.equal(result.body.header, 'Bearer test');
});

test('allows empty reset responses and sends JSON reset payload', async (t) => {
  let received;
  const baseUrl = await serve(t, async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { method: req.method, body: JSON.parse(Buffer.concat(chunks)), type: req.headers['content-type'] };
    res.writeHead(204).end();
  });
  const result = await requestJson({ baseUrl, path: '/reset', method: 'POST', body: { scope: 'test' }, expectJson: false });
  assert.equal(result.status, 204);
  assert.deepEqual(received, { method: 'POST', body: { scope: 'test' }, type: 'application/json' });
});

test('rejects non-JSON body without including body or URL in error', async (t) => {
  const baseUrl = await serve(t, (_, res) => res.end('private-response-token'));
  await assert.rejects(requestJson({ baseUrl, path: '/?token=secret' }), (error) => {
    assert.equal(error.code, 'invalid_json');
    assert.equal(error.message.includes('private'), false);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
});

test('rejects JSON numbers that could silently collapse different identifiers', async (t) => {
  const baseUrl = await serve(t, (req, res) => {
    res.end(req.url === '/overflow' ? '{"value":1e400}' : '{"id":9007199254740993}');
  });
  for (const path of ['/overflow', '/unsafe-integer']) {
    await assert.rejects(requestJson({ baseUrl, path }), { code: 'unsupported_json_number' });
  }
});

test('rejects underflow and rounded decimal values rather than comparing them equal', async (t) => {
  const numbers = ['1e-400', '-1e-400', '1.000000000000000001', '0.100000000000000001', '1e-999999999999999999999999'];
  const baseUrl = await serve(t, (req, res) => res.end(`{"value":${numbers[Number(req.url.slice(1))]}}`));
  for (let index = 0; index < numbers.length; index += 1) {
    await assert.rejects(requestJson({ baseUrl, path: `/${index}` }), { code: 'unsupported_json_number' });
  }
});

test('accepts equivalent decimal spellings and finite round-trip decimals', async (t) => {
  const numbers = ['1e3', '0.1', '1.00', '-0', '0e-999999999999999999999999', '1.20e-1', '1E+0003', '-2.5e-3', '5e-324'];
  const baseUrl = await serve(t, (req, res) => res.end(`{"value":${numbers[Number(req.url.slice(1))]}}`));
  for (let index = 0; index < numbers.length; index += 1) {
    const result = await requestJson({ baseUrl, path: `/${index}` });
    assert.equal(result.body.value, Number(numbers[index]));
  }
});

test('invalid UTF-8 is rejected instead of normalized to replacement characters', async (t) => {
  const baseUrl = await serve(t, (_, res) => res.end(Buffer.from([0x22, 0xc3, 0x28, 0x22])));
  await assert.rejects(requestJson({ baseUrl, path: '/' }), { code: 'invalid_json' });
});

test('redirects are rejected and never forward credentials', async (t) => {
  let sinkCalls = 0;
  const sink = await serve(t, (_, res) => { sinkCalls += 1; res.end('{}'); });
  const baseUrl = await serve(t, (_, res) => res.writeHead(302, { location: sink }).end());
  await assert.rejects(requestJson({ baseUrl, path: '/', headers: { authorization: 'private' } }), { code: 'redirect' });
  assert.equal(sinkCalls, 0);
});

test('absolute paths cannot escape the configured origin', async () => {
  for (const path of ['//other.test/api', 'http://other.test/api', '/\\other.test/api']) {
    await assert.rejects(requestJson({ baseUrl: 'http://127.0.0.1', path }), { code: 'invalid_url' });
  }
});

test('non-2xx response is operational error even with JSON', async (t) => {
  const baseUrl = await serve(t, (_, res) => res.writeHead(401).end('{"error":"private"}'));
  await assert.rejects(requestJson({ baseUrl, path: '/' }), { code: 'http_status' });
});

test('body limit handles both content-length and chunked bodies', async (t) => {
  const baseUrl = await serve(t, (req, res) => {
    if (req.url === '/sized') res.setHeader('content-length', 100);
    else res.setHeader('transfer-encoding', 'chunked');
    res.end('x'.repeat(100));
  });
  for (const path of ['/sized', '/chunked']) {
    await assert.rejects(requestJson({ baseUrl, path, maxBodyBytes: 10 }), { code: 'body_too_large' });
  }
});

test('timeout includes slow streaming body, not only headers', async (t) => {
  const baseUrl = await serve(t, (_, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  await assert.rejects(requestJson({ baseUrl, path: '/', timeoutMs: 50 }), { code: 'timeout' });
});

test('aborting an in-flight request returns an explicit cancellation', async (t) => {
  const baseUrl = await serve(t, () => {});
  const controller = new AbortController();
  const result = requestJson({ baseUrl, path: '/', signal: controller.signal });
  controller.abort();
  await assert.rejects(result, { code: 'aborted' });
});
