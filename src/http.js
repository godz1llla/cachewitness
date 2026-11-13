/** An operational failure with a message safe to place in a report. */
export class AuditHttpError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AuditHttpError';
    this.code = code;
  }
}

function unsupportedNumber() {
  return new AuditHttpError('unsupported_json_number', 'JSON number is unsafe or loses precision. Encode large or high-precision values as strings.');
}

// Compare decimal spellings without expanding powers of ten. This catches
// rounding and underflow while accepting equivalent forms like 1.00 and 1e0.
function canonicalDecimal(text) {
  const negative = text.startsWith('-');
  const unsigned = negative ? text.slice(1) : text;
  const [mantissa, exponentText = '0'] = unsigned.toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const digits = (whole + fraction).replace(/^0+/u, '');
  if (digits === '') return '0';
  let significantEnd = digits.length;
  while (digits[significantEnd - 1] === '0') significantEnd -= 1;
  const significant = digits.slice(0, significantEnd);
  const exponentDigits = exponentText.replace(/^[+-]/u, '').replace(/^0+/u, '') || '0';
  // No representable nonzero Number needs an exponent with this magnitude;
  // bound parsing work even when a hostile JSON body contains a huge exponent.
  if (exponentDigits.length > 12) throw unsupportedNumber();
  const exponentSign = exponentText.startsWith('-') ? -1n : 1n;
  const exponent = exponentSign * BigInt(exponentDigits) - BigInt(fraction.length)
    + BigInt(digits.length - significant.length);
  return `${negative ? '-' : ''}${significant}e${exponent}`;
}

/** Request a bounded JSON body. Redirects never receive credentials. */
export async function requestJson({
  baseUrl, path, method = 'GET', headers = {}, query = {}, body,
  timeoutMs = 5000, maxBodyBytes = 1048576, signal, expectJson = true,
}) {
  let url;
  try {
    const base = new URL(baseUrl);
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new Error();
    url = new URL(path, base);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || url.origin !== base.origin) throw new Error();
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  } catch {
    throw new AuditHttpError('invalid_url', 'Request URL must stay on the configured HTTP(S) origin.');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let reader;
  try {
    const requestHeaders = new Headers(headers);
    let payload;
    if (body !== undefined) {
      payload = JSON.stringify(body);
      if (!requestHeaders.has('content-type')) requestHeaders.set('content-type', 'application/json');
    }
    const response = await fetch(url, {
      method, headers: requestHeaders, body: payload, redirect: 'manual', signal: combinedSignal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new AuditHttpError('redirect', 'Redirects are not followed. Use a direct endpoint.');
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AuditHttpError('http_status', `Endpoint returned HTTP ${response.status}; a successful response is required.`);
    }
    const sizeHeader = response.headers.get('content-length');
    if (sizeHeader !== null && Number(sizeHeader) > maxBodyBytes) {
      await response.body?.cancel();
      throw new AuditHttpError('body_too_large', 'Response exceeded maxBodyBytes.');
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      reader = response.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBodyBytes) {
          await reader.cancel();
          throw new AuditHttpError('body_too_large', 'Response exceeded maxBodyBytes.');
        }
        if (expectJson) chunks.push(value);
      }
    }
    if (!expectJson) return { status: response.status, body: null };
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
      const parsed = JSON.parse(text, (_key, value, context) => {
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))
            || typeof context?.source !== 'string'
            || canonicalDecimal(context.source) !== canonicalDecimal(value.toString())) {
            throw unsupportedNumber();
          }
        }
        return value;
      });
      return { status: response.status, body: parsed };
    } catch (error) {
      if (error instanceof AuditHttpError) throw error;
      throw new AuditHttpError('invalid_json', 'Endpoint did not return a valid JSON body.');
    }
  } catch (error) {
    if (signal?.aborted) throw new AuditHttpError('aborted', 'Audit was cancelled.');
    if (controller.signal.aborted) throw new AuditHttpError('timeout', 'Request timed out.');
    if (error instanceof AuditHttpError) throw error;
    throw new AuditHttpError('network', 'Request failed. Check connectivity and request configuration.');
  } finally {
    clearTimeout(timeout);
    reader?.releaseLock();
  }
}
