import { appendFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { audit } from '../src/audit.js';
import { ConfigError, loadConfig } from '../src/config.js';
import { canonicalPath, exitCode, formatReport, validateReportPaths, writeReport, writeHtmlReport } from '../src/report.js';

// Action inputs travel through environment variables, never executable shell text.
// Resolve existing ancestors as well, so a symlink cannot move report output out
// of the caller's workspace before any destructive reset request is made.
async function workspacePath(workspace, input) {
  if (!input || /[\u0000-\u001f\u007f]/.test(input)) throw new ConfigError('Action paths must be non-empty and contain no control characters.');
  const path = await canonicalPath(resolve(workspace, input));
  if (/[\u0000-\u001f\u007f]/.test(path)) throw new ConfigError('Resolved action paths must contain no control characters.');
  const within = relative(workspace, path);
  if (within === '..' || within.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(within)) {
    throw new ConfigError('Action configuration and reports must stay inside the workspace.');
  }
  return path;
}

const cell = value => String(value).replace(/[&<>"'|\r\n]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '|': '&#124;', '\r': ' ', '\n': ' ' })[c]);

export function formatJobSummary(report) {
  const lines = [`## CacheWitness · ${cell(report.status.toUpperCase())}`, ''];
  if (report.summary) {
    const s = report.summary;
    lines.push(`${s.variants} variants · ${s.pairs} ordered pairs · ${s.requests} HTTP requests`, '',
      `${s.passed} passed · ${s.contamination} contamination · ${s.drift} drift · ${s.indistinguishable} indistinguishable · ${s.unstable} unstable`, '');
  }
  if (report.checks?.length) {
    lines.push('| Source → target | Result |', '| --- | --- |');
    for (const check of report.checks.slice(0, 20)) lines.push(`| ${cell(check.source)} → ${cell(check.target)} | ${cell(check.outcome)} |`);
    if (report.checks.length > 20) lines.push('', `${report.checks.length - 20} more pairs are included in the saved reports.`);
    lines.push('');
  }
  if (report.message) lines.push(cell(report.message), '');
  for (const error of report.errors ?? []) lines.push(`- ${cell(error.stage)}: ${cell(error.code)} — ${cell(error.message)}`);
  lines.push('', report.status === 'pass'
    ? 'No cross-variant response changes observed in these scenarios.'
    : report.status === 'fail' ? 'Response changes were observed after another variant primed the endpoint. Inspect the HTML report for the witness.'
      : 'The audit did not establish complete isolation coverage. Check the report before interpreting this run.', '',
    'Reports omit response values and credentials. Variant names, JSON property names, and deterministic fingerprints can still be sensitive. Upload artifacts only with an appropriate access and retention policy.', '');
  return lines.join('\n');
}

export async function runAction(env = process.env, { log = console.log } = {}) {
  let report;
  let jsonPath;
  let htmlPath;
  try {
    if (!env.GITHUB_WORKSPACE) throw new ConfigError('GITHUB_WORKSPACE is required.');
    const workspace = await realpath(env.GITHUB_WORKSPACE);
    const configPath = await workspacePath(workspace, env.CACHEWITNESS_CONFIG);
    const outputDirectory = await workspacePath(workspace, env.CACHEWITNESS_REPORT_DIRECTORY || 'cachewitness-reports');
    const json = await workspacePath(workspace, join(outputDirectory, 'report.json'));
    const html = await workspacePath(workspace, join(outputDirectory, 'report.html'));
    await validateReportPaths({ config: configPath, output: json, html });
    const remote = env.CACHEWITNESS_ALLOW_REMOTE ?? 'false';
    if (!['true', 'false'].includes(remote)) throw new ConfigError('allow-remote must be true or false.');
    jsonPath = json;
    htmlPath = html;
    const config = await loadConfig(configPath, { allowRemote: remote === 'true', env });
    report = await audit(config);
  } catch (error) {
    report = { version: 1, status: 'error', message: error instanceof ConfigError ? error.message : 'The action could not prepare the audit. Check the configuration and workspace paths.' };
  }
  try {
    if (jsonPath && htmlPath) {
      await writeReport(jsonPath, report);
      await writeHtmlReport(htmlPath, report);
    }
  } catch {
    report = { version: 1, status: 'error', message: 'The action could not save both report files.' };
    jsonPath = undefined;
    htmlPath = undefined;
  }
  log(formatReport(report));
  try {
    if (env.GITHUB_OUTPUT) {
      const outputs = [`status=${report.status}`];
      if (jsonPath && htmlPath) outputs.push(`report-json=${jsonPath}`, `report-html=${htmlPath}`);
      await appendFile(env.GITHUB_OUTPUT, `${outputs.join('\n')}\n`);
    }
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, formatJobSummary(report));
  } catch {
    log('CacheWitness could not write GitHub Actions output or summary files.');
    return 2;
  }
  return exitCode(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runAction();
}
