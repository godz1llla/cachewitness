import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// Field names originate in the target response. Never let them control a terminal.
const terminalText = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);

export function exitCode(report) {
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

export function formatReport(report) {
  const lines = [`CacheWitness — ${report.status.toUpperCase()}`];
  if (report.message) lines.push(report.message);
  if (report.summary) {
    const s = report.summary;
    lines.push(`${s.variants} variants · ${s.pairs} ordered pairs · ${s.requests} HTTP requests`);
    lines.push(`${s.passed} passed · ${s.contamination} contamination · ${s.drift} drift · ${s.indistinguishable} indistinguishable · ${s.unstable} unstable`);
  }
  for (const check of report.checks ?? []) {
    lines.push(`  ${check.source} → ${check.target}: ${check.outcome}`);
    if (check.outcome === 'contamination') lines.push('    Target received the source baseline instead of its own baseline.');
    if (check.outcome === 'drift') lines.push('    Target changed after priming, but did not match the source baseline.');
    if (check.differences?.length) lines.push(`    Changed fields: ${check.differences.map(terminalText).join(', ')}${check.differencesTruncated ? ' (truncated)' : ''}`);
  }
  for (const error of report.errors ?? []) lines.push(`  ${error.stage}: ${error.code} — ${error.message}`);
  if (report.status === 'pass') lines.push('No cross-variant response changes observed in these scenarios.');
  if (report.status === 'inconclusive') lines.push('Coverage is incomplete. Indistinguishable or unstable baselines cannot establish isolation.');
  if (report.status === 'fail') lines.push('Reproduce with the same configuration in an isolated test environment.');
  return lines.join('\n');
}

export async function writeReport(filename, report) {
  const destination = resolve(filename);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
