import { lstat, mkdir, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ConfigError } from './config.js';

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

// Resolve existing ancestors too: two absent files can alias through a symlinked
// parent. A dangling symlink must be resolved explicitly because realpath fails.
export async function canonicalPath(filename, hops = 0) {
  if (hops > 40) throw new ConfigError('A report path contains a symbolic-link loop.');
  const absolute = resolve(filename);
  try { return await realpath(absolute); }
  catch (error) {
    if (error.code !== 'ENOENT') throw new ConfigError('A report path could not be resolved.');
  }
  const info = await lstat(absolute).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw new ConfigError('A report path could not be inspected.');
  });
  if (info?.isSymbolicLink()) return canonicalPath(resolve(dirname(absolute), await readlink(absolute)), hops + 1);
  const parent = dirname(absolute);
  if (parent === absolute) throw new ConfigError('A report path could not be resolved.');
  return resolve(await canonicalPath(parent, hops + 1), basename(absolute));
}

export async function validateReportPaths({ config, output, html }) {
  const paths = [];
  for (const [kind, filename] of [['configuration', config], ['JSON', output], ['HTML', html]]) {
    if (!filename) continue;
    const canonical = await canonicalPath(filename);
    const info = await stat(canonical).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw new ConfigError('A report path could not be inspected.');
    });
    if (kind !== 'configuration' && info && !info.isFile()) throw new ConfigError(`${kind} report destination must be a file.`);
    const key = ['darwin', 'win32'].includes(process.platform) ? canonical.toLowerCase() : canonical;
    for (const previous of paths) {
      if (key.startsWith(`${previous.key}${sep}`) || previous.key.startsWith(`${key}${sep}`)) {
        throw new ConfigError('Report destinations must not contain one another or contain the configuration file.');
      }
      const aliases = key === previous.key || (info && previous.info && info.dev === previous.info.dev && info.ino === previous.info.ino);
      if (!aliases) continue;
      if (previous.kind === 'configuration') throw new ConfigError(`${kind} report must not overwrite the configuration file.`);
      throw new ConfigError('JSON and HTML reports must use different destination files.');
    }
    paths.push({ kind, key, info });
  }
}

export async function writeArtifact(filename, content) {
  const destination = resolve(filename);
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function writeReport(filename, report) {
  return writeArtifact(filename, `${JSON.stringify(report, null, 2)}\n`);
}

export async function writeHtmlReport(filename, report) {
  const { formatHtmlReport } = await import('./html-report.js');
  return writeArtifact(filename, formatHtmlReport(report));
}
