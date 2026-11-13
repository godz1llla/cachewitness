import { createHash } from 'node:crypto';

function decodePointer(pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/') || /~(?![01])/u.test(pointer)) {
    throw new TypeError('Ignore entries must be non-root RFC 6901 JSON pointers.');
  }
  return pointer.slice(1).split('/').map((part) => part.replace(/~1/gu, '/').replace(/~0/gu, '~'));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Canonicalize a JSON response after omitting explicit body paths. */
export function normalizeResponse(response, ignore = []) {
  const body = JSON.parse(JSON.stringify(response.body));
  for (const pointer of ignore) {
    const parts = decodePointer(pointer);
    let parent = body;
    for (const key of parts.slice(0, -1)) {
      if (parent === null || typeof parent !== 'object' || !Object.hasOwn(parent, key)) {
        parent = undefined;
        break;
      }
      parent = parent[key];
    }
    const key = parts.at(-1);
    if (parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key)
      && (!Array.isArray(parent) || /^(?:0|[1-9]\d*)$/u.test(key))) {
      // Preserve array length and indices: an ignored position is not a removal.
      if (Array.isArray(parent)) parent[key] = null;
      else delete parent[key];
    }
  }
  return { status: response.status, body };
}

/** Fingerprints identify equal normalized responses without retaining values. */
export function fingerprint(response, ignore = []) {
  return createHash('sha256').update(canonical(normalizeResponse(response, ignore))).digest('hex');
}

const escapePointer = (key) => String(key).replace(/~/gu, '~0').replace(/\//gu, '~1');

/** Return structural difference paths, never response values. */
export function compareResponses(expected, observed, ignore = [], limit = 30) {
  const left = normalizeResponse(expected, ignore);
  const right = normalizeResponse(observed, ignore);
  const differences = [];
  let truncated = false;
  function add(path) {
    if (differences.length < limit) differences.push(path || '/');
    else truncated = true;
  }
  function walk(a, b, path) {
    if (truncated || canonical(a) === canonical(b)) return;
    const aObject = a !== null && typeof a === 'object';
    const bObject = b !== null && typeof b === 'object';
    if (!aObject || !bObject || Array.isArray(a) !== Array.isArray(b)) {
      add(path);
      return;
    }
    if (Array.isArray(a) && a.length !== b.length) add(`${path}/length`);
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const next = `${path}/${escapePointer(key)}`;
      if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) add(next);
      else walk(a[key], b[key], next);
      if (truncated) break;
    }
  }
  walk(left, right, '');
  return { equal: canonical(left) === canonical(right), differences, differencesTruncated: truncated };
}
