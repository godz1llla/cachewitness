import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConfigError, loadConfig, normalizeConfig } from './config.js';
import { exitCode, formatReport, writeReport } from './report.js';

const help = `CacheWitness — find cross-user and cross-tenant cache contamination.

Usage:
  cachewitness check <config.json> [--json] [--output report.json] [--allow-remote]
  cachewitness demo [--fixed] [--json] [--output report.json]
  cachewitness --help
  cachewitness --version

Options:
  --json          Print a machine-readable report to stdout.
  --output PATH   Save a JSON report atomically (response values are omitted).
  --allow-remote  Allow a non-loopback test target. Reset calls change its cache.
  --fixed         Run the demo with an identity-aware cache key.

Exit codes: 0 = pass, 1 = observed response contamination/drift,
            2 = configuration/operational error or inconclusive coverage.

Use only disposable test environments you control. A reset endpoint is required.
`;

function parse(argv) {
  if (argv.length === 0 || (argv.length === 1 && ['--help', '-h'].includes(argv[0]))) return { help: true };
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) return { version: true };
  const [command, ...args] = argv;
  if (!['check', 'demo'].includes(command)) throw new ConfigError('Expected check or demo. Run cachewitness --help.');
  const options = { command, json: false, fixed: false, allowRemote: false };
  const used = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--json', '--fixed', '--allow-remote', '--output'].includes(arg)) {
      if (used.has(arg)) throw new ConfigError('An option was supplied more than once.');
      used.add(arg);
      if (arg === '--output') {
        if (!args[i + 1] || args[i + 1].startsWith('-')) throw new ConfigError('--output needs a file path.');
        options.output = args[++i];
      } else if (arg === '--json') options.json = true;
      else if (arg === '--fixed') options.fixed = true;
      else options.allowRemote = true;
    } else if (command === 'check' && !options.config && !arg.startsWith('-')) options.config = arg;
    else throw new ConfigError('Unknown argument. Run cachewitness --help.');
  }
  if (command === 'check' && !options.config) throw new ConfigError('check requires a JSON configuration file.');
  if (command === 'check' && options.fixed) throw new ConfigError('--fixed is only available for demo.');
  if (command === 'demo' && options.allowRemote) throw new ConfigError('--allow-remote is only available for check.');
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const jsonRequested = argv.includes('--json');
  const controller = new AbortController();
  const stop = () => controller.abort();
  let demo;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const options = parse(argv);
    if (options.help) { process.stdout.write(help); return 0; }
    if (options.version) {
      const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      process.stdout.write(`${pkg.version}\n`);
      return 0;
    }
    if (options.output && options.config) {
      const source = await realpath(options.config).catch(() => resolve(options.config));
      const destination = await realpath(options.output).catch(() => resolve(options.output));
      if (source === destination) throw new ConfigError('The output file must not overwrite the configuration file.');
    }
    let config;
    if (options.command === 'demo') {
      const { startDemo, createDemoConfig } = await import('./demo.js');
      demo = await startDemo({ fixed: options.fixed });
      config = normalizeConfig(createDemoConfig(demo.baseUrl));
    } else config = await loadConfig(options.config, { allowRemote: options.allowRemote });
    const { audit } = await import('./audit.js');
    const report = await audit(config, { signal: controller.signal });
    if (options.output) {
      try { await writeReport(options.output, report); }
      catch { throw new ConfigError('Could not write the report file.'); }
    }
    process.stdout.write(`${options.json ? JSON.stringify(report, null, 2) : formatReport(report)}\n`);
    return exitCode(report);
  } catch (error) {
    const report = { status: 'error', message: error instanceof ConfigError ? error.message : 'The audit could not complete. Check the configuration and target availability.' };
    (jsonRequested ? process.stdout : process.stderr).write(`${jsonRequested ? JSON.stringify(report) : formatReport(report)}\n`);
    return 2;
  } finally {
    if (demo) await demo.close();
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
  }
}
