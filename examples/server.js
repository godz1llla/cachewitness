import { startDemo } from '../src/demo.js';

const fixed = process.argv.includes('--fixed');
const port = Number(process.env.PORT ?? 4318);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('PORT must be an integer between 0 and 65535.');
  process.exit(2);
}
const demo = await startDemo({ fixed, port });
console.log(`Synthetic ${fixed ? 'isolated' : 'shared-key'} cache at ${demo.baseUrl}`);
console.log('This reset-enabled fixture is for local testing only. Ctrl-C stops it.');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => { await demo.close(); process.exit(0); });
}
