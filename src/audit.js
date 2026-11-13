import { compareResponses, fingerprint } from './compare.js';
import { requestJson, AuditHttpError } from './http.js';

/**
 * Sequential, destructive-in-test-environments cache-isolation experiment.
 * config.reset must clear the relevant cache before every cold baseline/pair.
 * Reports contain hashes and field paths, never body values or credentials.
 */
export async function audit(config, { signal, onProgress = () => {} } = {}) {
  const started = Date.now();
  const report = {
    version: 1,
    status: 'inconclusive',
    startedAt: new Date(started).toISOString(),
    durationMs: 0,
    summary: {
      variants: config.variants.length,
      pairs: config.variants.length * (config.variants.length - 1),
      passed: 0, contamination: 0, drift: 0, indistinguishable: 0, unstable: 0,
      errors: 0, requests: 0,
    },
    baselines: [], checks: [], errors: [],
  };
  const baselines = new Map();
  const ignore = config.ignore ?? [];
  const baselineRuns = config.baselineRuns ?? 2;
  let context = { stage: 'baseline' };
  const mark = (next) => {
    context = next;
    onProgress(next);
  };
  const send = async (request, expectJson) => {
    report.summary.requests += 1;
    return requestJson({
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
      maxBodyBytes: config.maxBodyBytes,
      ...request, expectJson, signal,
    });
  };
  const reset = () => send({ ...config.reset, method: config.reset.method ?? 'POST' }, false);
  const read = (variant) => {
    const headers = new Headers(config.request.headers);
    for (const [key, value] of Object.entries(variant.headers ?? {})) headers.set(key, value);
    return send({
      ...config.request,
      method: 'GET',
      headers: Object.fromEntries(headers),
      query: variant.query,
    }, true);
  };

  try {
    for (const variant of config.variants) {
      const samples = [];
      for (let run = 0; run < baselineRuns; run += 1) {
        mark({ stage: 'baseline-reset', variant: variant.name, run: run + 1 });
        await reset();
        mark({ stage: 'baseline', variant: variant.name, run: run + 1 });
        samples.push(await read(variant));
      }
      const hashes = samples.map((sample) => fingerprint(sample, ignore));
      const stable = hashes.every((hash) => hash === hashes[0]);
      baselines.set(variant.name, { response: samples[0], hash: hashes[0], stable });
      report.baselines.push({ variant: variant.name, stable, fingerprints: hashes });
    }

    for (const source of config.variants) {
      for (const target of config.variants) {
        if (source.name === target.name) continue;
        const a = baselines.get(source.name);
        const b = baselines.get(target.name);
        const check = {
          source: source.name,
          target: target.name,
          outcome: 'inconclusive',
          fingerprints: { source: a.hash, expected: b.hash },
          differences: [],
        };
        report.checks.push(check);
        if (!a.stable || !b.stable) {
          check.outcome = 'unstable';
          report.summary.unstable += 1;
          continue;
        }
        if (a.hash === b.hash) {
          check.outcome = 'indistinguishable';
          report.summary.indistinguishable += 1;
          continue;
        }
        const pair = { source: source.name, target: target.name };
        mark({ stage: 'pair-reset', ...pair });
        await reset();
        mark({ stage: 'prime', ...pair });
        const firstPrime = await read(source);
        mark({ stage: 'prime-repeat', ...pair });
        const secondPrime = await read(source);
        const firstHash = fingerprint(firstPrime, ignore);
        const secondHash = fingerprint(secondPrime, ignore);
        if (firstHash !== a.hash || secondHash !== a.hash) {
          check.outcome = 'unstable';
          check.fingerprints.prime = firstHash;
          check.fingerprints.primeRepeat = secondHash;
          report.summary.unstable += 1;
          continue;
        }
        mark({ stage: 'probe', ...pair });
        const observed = await read(target);
        const hash = fingerprint(observed, ignore);
        check.fingerprints.observed = hash;
        const comparison = compareResponses(b.response, observed, ignore);
        check.differences = comparison.differences;
        check.differencesTruncated = comparison.differencesTruncated;
        if (hash === b.hash) {
          check.outcome = 'pass';
          report.summary.passed += 1;
        } else if (hash === a.hash) {
          check.outcome = 'contamination';
          report.summary.contamination += 1;
        } else {
          check.outcome = 'drift';
          report.summary.drift += 1;
        }
      }
    }
    report.status = report.summary.contamination || report.summary.drift ? 'fail'
      : report.summary.unstable || report.summary.indistinguishable || report.summary.pairs === 0 ? 'inconclusive'
        : 'pass';
  } catch (error) {
    report.status = 'error';
    report.summary.errors += 1;
    report.errors.push({
      ...context,
      code: error instanceof AuditHttpError ? error.code : 'internal',
      message: error instanceof AuditHttpError ? error.message : 'Audit could not complete.',
    });
    const pending = report.checks.at(-1);
    if (pending?.outcome === 'inconclusive') pending.outcome = 'error';
  }
  report.durationMs = Date.now() - started;
  return report;
}
