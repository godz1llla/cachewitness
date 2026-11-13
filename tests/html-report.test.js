import test from 'node:test';
import assert from 'node:assert/strict';
import { formatHtmlReport } from '../src/html-report.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
function fixture(status = 'fail') {
  return {
    version: 1, status, startedAt: '2026-11-13T12:00:00.000Z', durationMs: 1530,
    summary: { variants: 2, pairs: 2, passed: 0, contamination: 2, drift: 0, indistinguishable: 0, unstable: 0, errors: 0, requests: 16 },
    baselines: [{ variant: 'Tenant A', stable: true, fingerprints: [A, A] }, { variant: 'Tenant B', stable: true, fingerprints: [B, B] }],
    checks: [{ source: 'Tenant A', target: 'Tenant B', outcome: 'contamination', fingerprints: { source: A, expected: B, observed: A }, differences: ['/body/tenant'] }, { source: 'Tenant B', target: 'Tenant A', outcome: 'contamination', fingerprints: { source: B, expected: A, observed: B }, differences: ['/body/tenant'] }],
    errors: [],
  };
}

test('renders actionable contamination evidence and full hashes in standalone HTML', () => {
  const html = formatHtmlReport(fixture());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.match(html, /Cache isolation audit \/ FAIL/u);
  assert.match(html, /Cross-variant contamination observed/u);
  assert.match(html, /2 of 2 planned pairs compared/u);
  assert.match(html, /id="pair-1" open/u);
  assert.match(html, new RegExp(A));
  assert.match(html, new RegExp(B));
  assert.match(html, /\/body\/tenant/u);
  assert.match(html, /Inspect identity and presentation dimensions/u);
  assert.match(html, /hashes are not anonymization/u);
});

test('verdicts distinguish pass, fail, inconclusive and operational error', () => {
  const titles = {
    pass: 'Isolation held in the tested scenarios.',
    fail: 'Cross-variant contamination observed.',
    inconclusive: 'Isolation could not be established.',
    error: 'The audit could not finish.',
  };
  for (const [status, title] of Object.entries(titles)) {
    assert.ok(formatHtmlReport(fixture(status)).includes(title));
  }
  const drift = fixture(); drift.summary.contamination = 0;
  assert.match(formatHtmlReport(drift), /Cross-variant response changes observed/u);
  assert.match(formatHtmlReport({ ...fixture(), status: 'unrecognized' }), /Report status is unavailable/u);
});

test('escapes report-controlled strings in every rendered surface', () => {
  const attack = '</style><script>alert("x")</script><img src=x onerror="x">&\'';
  const data = fixture();
  data.version = attack; data.startedAt = attack;
  data.baselines = [{ variant: attack, stable: true, fingerprints: [attack] }];
  data.checks = [{ source: attack, target: `${attack}target`, outcome: 'contamination', fingerprints: { source: attack, expected: attack, observed: attack }, differences: [attack] }];
  data.errors = [{ stage: attack, code: attack, message: attack, source: attack, target: attack, variant: attack, run: attack }];
  const html = formatHtmlReport(data);
  assert.equal(html.includes(attack), false);
  assert.equal((html.match(/<style>/gu) ?? []).length, 1);
  assert.equal((html.match(/<\/style>/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /<script\b|<img\b/iu);
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/u);
  assert.match(html, /&amp;&#39;/u);
});

test('partial error renders missing pairs as not run and never invents a probe', () => {
  const data = fixture('error');
  data.checks = [{ source: 'Tenant A', target: 'Tenant B', outcome: 'error', fingerprints: { source: A, expected: B }, differences: [] }];
  data.errors = [{ stage: 'prime-repeat', source: 'Tenant A', target: 'Tenant B', code: 'timeout', message: 'Request timed out.' }];
  const html = formatHtmlReport(data);
  assert.match(html, /0 of 2 planned pairs compared/u);
  assert.match(html, /Not run<small>No comparison recorded/u);
  assert.match(html, /Stopped here<\/small>Prime source again/u);
  assert.match(html, /Not run<\/small>Probe target/u);
  assert.doesNotMatch(html, /Completed<\/small>Probe target/u);
  assert.match(html, /Target · observed probe<\/dt><dd><span class="missing">Not recorded/u);
});

test('cold baseline skips do not show an executed pair sequence', () => {
  for (const outcome of ['unstable', 'indistinguishable']) {
    const data = fixture('inconclusive');
    data.checks = [{ ...data.checks[0], outcome, fingerprints: { source: A, expected: B } }];
    const html = formatHtmlReport(data);
    assert.match(html, /Pair sequence skipped before reset/u);
    assert.doesNotMatch(html, /aria-label="Recorded execution sequence"/u);
    assert.doesNotMatch(html, /Completed<\/small>Probe target/u);
  }
});

test('warm instability shows completed prime reads and an unexecuted target', () => {
  const data = fixture('inconclusive');
  data.checks = [{ ...data.checks[0], outcome: 'unstable', fingerprints: { source: A, expected: B, prime: A, primeRepeat: C } }];
  const html = formatHtmlReport(data);
  assert.match(html, /Completed<\/small>Prime source again/u);
  assert.match(html, /Not run<\/small>Probe target/u);
  assert.match(html, /Source warm-read fingerprints/u);
  assert.match(html, new RegExp(C));
});

test('early baseline error discloses unknown variant names instead of inventing them', () => {
  const data = fixture('error'); data.baselines = []; data.checks = [];
  data.errors = [{ stage: 'baseline-reset', variant: 'Tenant A', code: 'http_status', message: 'Endpoint returned HTTP 500.' }];
  const html = formatHtmlReport(data);
  assert.match(html, /1 configured variant not named in the recorded evidence/u);
  assert.doesNotMatch(html, /Tenant B/u);
  assert.match(html, /No completed cold baseline was recorded/u);
  assert.match(html, /No pair experiments were recorded/u);
});

test('minimal error report remains useful without summary or identities', () => {
  const html = formatHtmlReport({ status: 'error', errors: [{ code: 'config', message: 'Invalid configuration.' }] });
  assert.match(html, /No variant names were recorded/u);
  assert.match(html, /Invalid configuration\./u);
  assert.doesNotMatch(html, /undefined|NaN/u);
  assert.match(formatHtmlReport({ status: 'error', message: '<bad config>' }), /&lt;bad config&gt;/u);
});

test('report is offline, script-free, responsive and contains accessible table markup', () => {
  const html = formatHtmlReport(fixture());
  assert.match(html, /Content-Security-Policy/u);
  assert.match(html, /default-src 'none'; style-src 'unsafe-inline'/u);
  assert.doesNotMatch(html, /<script\b|<iframe\b|<link\b|\bsrc=|@import|url\(/iu);
  assert.doesNotMatch(html, /https?:\/\//u);
  assert.match(html, /<caption>/u);
  assert.match(html, /scope="col"/u);
  assert.match(html, /scope="row"/u);
  assert.match(html, /width=device-width/u);
  assert.match(html, /@media\(max-width:760px\)/u);
  assert.match(html, /prefers-reduced-motion/u);
});

test('truncated paths and unknown outcomes are explained', () => {
  const data = fixture(); data.checks[0].differencesTruncated = true;
  data.checks[1].outcome = '"><svg onload=alert(1)>';
  const html = formatHtmlReport(data);
  assert.match(html, /path list was truncated/u);
  assert.match(html, /Unknown outcome/u);
  assert.doesNotMatch(html, /<svg|onload=/u);
  data.checks[1].outcome = '__proto__';
  assert.match(formatHtmlReport(data), /Unknown outcome/u);
  assert.doesNotMatch(formatHtmlReport(data), /undefined/u);
});
