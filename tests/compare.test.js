import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, normalizeResponse, compareResponses } from '../src/compare.js';

const response = (body, status = 200) => ({ status, body });

test('object key order is irrelevant but array order is meaningful', () => {
  assert.equal(fingerprint(response({ b: 2, a: { z: 1, y: 0 } })), fingerprint(response({ a: { y: 0, z: 1 }, b: 2 })));
  assert.notEqual(fingerprint(response([1, 2])), fingerprint(response([2, 1])));
});

test('status and JSON value types participate in comparison', () => {
  assert.notEqual(fingerprint(response(1)), fingerprint(response('1')));
  assert.notEqual(fingerprint(response(null)), fingerprint(response({})));
  assert.notEqual(fingerprint(response({ ok: true }, 200)), fingerprint(response({ ok: true }, 201)));
});

test('ignore supports escaped JSON pointers and does not mutate inputs', () => {
  const input = response({ 'a/b': { '~id': 'dynamic', keep: 'same' }, arr: ['volatile', 'same'] });
  const result = normalizeResponse(input, ['/a~1b/~0id', '/arr/0', '/does/not/exist']);
  assert.deepEqual(result.body, { 'a/b': { keep: 'same' }, arr: [null, 'same'] });
  assert.equal(input.body['a/b']['~id'], 'dynamic');
  assert.equal(input.body.arr[0], 'volatile');
});

test('ignore traverses own properties without prototype mutation', () => {
  const input = response(JSON.parse('{"__proto__":{"marker":1},"ok":true}'));
  assert.deepEqual(normalizeResponse(input, ['/__proto__/marker']).body, JSON.parse('{"__proto__":{},"ok":true}'));
  assert.equal({}.marker, undefined);
  assert.throws(() => normalizeResponse(input, ['']), /RFC 6901/u);
  assert.throws(() => normalizeResponse(input, ['/broken~2']), /RFC 6901/u);
});

test('array length is not a JSON field and cannot be ignored', () => {
  assert.deepEqual(normalizeResponse(response({ a: [1, 2] }), ['/a/length']).body, { a: [1, 2] });
});

test('differences reveal paths but never body values', () => {
  const result = compareResponses(response({ tenant: 'private-A', 'a/b': 1 }), response({ tenant: 'private-B', 'a/b': 2 }, 201));
  assert.deepEqual(result.differences, ['/body/a~1b', '/body/tenant', '/status']);
  assert.equal(result.equal, false);
  assert.equal(JSON.stringify(result).includes('private'), false);
});

test('differences are bounded and report truncation', () => {
  const result = compareResponses(response({ a: 1, b: 2, c: 3 }), response({ a: 2, b: 3, c: 4 }), [], 2);
  assert.deepEqual(result.differences, ['/body/a', '/body/b']);
  assert.equal(result.differencesTruncated, true);
  assert.equal(compareResponses(response({ a: 1 }), response({ a: 1 })).equal, true);
});

test('missing array elements and absent fields produce useful paths', () => {
  const result = compareResponses(response({ a: [1, 2], remove: 1 }), response({ a: [1], added: 2 }));
  assert.deepEqual(result.differences, ['/body/a/length', '/body/a/1', '/body/added', '/body/remove']);
});
