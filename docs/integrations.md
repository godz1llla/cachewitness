# Connect CacheWitness to your application

The smallest integration has three parts: a JSON GET endpoint, two request variants with different correct responses, and a reset endpoint that clears the relevant cache synchronously.

This guide assumes the CLI is installed from a [GitHub release](https://github.com/godz1llla/cachewitness/releases). In a source checkout, replace `cachewitness` with `node bin/cachewitness.js`.

## Start with the bundled local server

From a source checkout, start the deliberately broken fixture:

```sh
npm ci
npm run example:server
```

It listens on `http://127.0.0.1:4318`. In a second terminal, run:

```sh
node --env-file=examples/demo.env bin/cachewitness.js check examples/cachewitness.json --output broken.json --html broken.html
```

The expected result is contamination and exit code 1. Open `broken.html` in a browser to inspect the pair matrix and evidence. The report is self-contained and can be opened offline.

Stop the fixture with Ctrl-C, then restart it with the identity-aware key:

```sh
npm run example:server -- --fixed
```

Run the same check, saving a new report:

```sh
node --env-file=examples/demo.env bin/cachewitness.js check examples/cachewitness.json --output fixed.json --html fixed.html
```

The expected result is pass and exit code 0. The sample uses synthetic accounts and an in-memory cache. It demonstrates the experiment without requiring Redis or a real account.

## Generate your configuration

```sh
cachewitness init --preset auth
```

This creates `cachewitness.json`. To choose a different file:

```sh
cachewitness init tests/cache-isolation.json --preset tenant
```

The destination's parent directory must already exist. `init` never overwrites an existing file or symlink, never sends requests, and writes environment references rather than credentials. Add `--json` for machine-readable initialization output.

Presets are starting points. Review the generated endpoint, headers, reset operation, and environment references before running the audit. Your application's real endpoint and authentication remain authoritative.

| Preset | Variation | Suitable starting scenario |
| --- | --- | --- |
| `auth` | Two bearer tokens | Alice and Bob have different dashboards. |
| `tenant` | `x-tenant-id` set to `acme` or `globex` | Two test organizations have different settings. |
| `currency` | `currency` query parameter set to USD, EUR, or KZT | A price endpoint returns different currency data. |

All presets use `CACHEWITNESS_BASE_URL` and a reset endpoint at `/__test/reset-cache`, authenticated by `Bearer ${CACHEWITNESS_RESET_TOKEN}`. The auth preset also references `CACHEWITNESS_ALICE_TOKEN` and `CACHEWITNESS_BOB_TOKEN`.

The tenant and currency presets do not establish authorization by themselves. Add common `request.headers` or per-variant credentials if your application requires them. A tenant selector supplied by the client is not a substitute for server-side authorization.

## Add a reset adapter to an existing Express test app

The example below is an integration sketch for an application that already uses Express. CacheWitness itself has no Express dependency.

The key detail is **which cache gets cleared**: the handler must use the same cache instance as the endpoint under test. Clearing a new `Map`, an unrelated Redis namespace, or only a browser cache does not reset the experiment.

```js
// In your existing test application's setup module:
// app is the existing Express instance.
// dashboardCache is the Map used by GET /api/dashboard.

if (process.env.NODE_ENV === 'test' &&
    process.env.ENABLE_CACHEWITNESS_RESET === '1') {
  const token = process.env.CACHEWITNESS_RESET_TOKEN;
  if (!token) throw new Error('A test reset token is required');

  app.post('/__test/reset-cache', (req, res) => {
    if (req.get('authorization') !== `Bearer ${token}`) {
      res.sendStatus(403);
      return;
    }

    dashboardCache.clear();
    res.sendStatus(204);
  });
}
```

Keep this route test-only. Give the application and CacheWitness the same test reset token, and do not expose the route in production.

For an asynchronous cache adapter, wait until the relevant test keys are removed before returning success. An endpoint that responds as soon as it schedules a deletion creates a race with the next request. For Redis, delete the known test namespace or keys through your application's adapter; do not clear an unrelated shared database. The application owns that implementation and any adapter dependencies.

## Supply test credentials

The generated auth configuration references these variables:

```dotenv
CACHEWITNESS_BASE_URL=http://127.0.0.1:3000
CACHEWITNESS_ALICE_TOKEN=replace-with-a-test-token
CACHEWITNESS_BOB_TOKEN=replace-with-another-test-token
CACHEWITNESS_RESET_TOKEN=replace-with-your-test-reset-token
```

Populate them through your shell or secret mechanism. In a source checkout, Node's environment-file support is also available:

```sh
node --env-file=.env.cachewitness bin/cachewitness.js check cachewitness.json --output report.json --html report.html
```

Keep files containing real test credentials outside version control. The example values above are placeholders. Audit tokens should select known fixtures whose expected responses differ in at least one compared field.

## Run the audit

```sh
cachewitness check cachewitness.json --output report.json --html report.html
```

For a remote test environment, explicitly allow the configured origin:

```sh
cachewitness check cachewitness.json --allow-remote --html staging-report.html
```

Run sequentially against the resettable environment, without competing tests or background traffic. An audit with two variants and default settings performs six resets and sixteen HTTP requests when every pair is exercised. Resetting the same environment from another job can invalidate the experiment.

## GitHub Action

Check out your repository, start its test application, and wait for it to be ready before invoking the action. The application must already expose the configured reset endpoint and seeded fixtures.

```yaml
- name: Audit response isolation
  id: cachewitness
  uses: godz1llla/cachewitness@v0.2.0
  with:
    config: cachewitness.json
    allow-remote: 'false'
    report-directory: cachewitness-reports
  env:
    CACHEWITNESS_BASE_URL: http://127.0.0.1:3000
    CACHEWITNESS_ALICE_TOKEN: ${{ secrets.TEST_ALICE_TOKEN }}
    CACHEWITNESS_BOB_TOKEN: ${{ secrets.TEST_BOB_TOKEN }}
    CACHEWITNESS_RESET_TOKEN: ${{ secrets.TEST_RESET_TOKEN }}

- name: Upload audit evidence
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: cachewitness-report
    path: cachewitness-reports/
```

The action sets up Node.js 22 for its CLI. It does not install or build your application. Run the audit after your application's setup and startup steps if changing the active Node version would affect that setup.

| Input | Required | Default | Purpose |
| --- | --- | --- | --- |
| `config` | Yes | — | JSON configuration path in your checked-out workspace. |
| `allow-remote` | No | `'false'` | Set to `'true'` to permit your configured remote test origin. |
| `report-directory` | No | `cachewitness-reports` | Directory for JSON and HTML evidence files. |

| Output | Meaning |
| --- | --- |
| `status` | Overall audit status: `pass`, `fail`, `inconclusive`, or `error`. |
| `report-json` | Absolute path to the JSON report, when saved. |
| `report-html` | Absolute path to the standalone HTML report, when saved. |

The action writes a GitHub job summary. It fails the step for exit code 1 or 2; use an `if: always()` artifact step so evidence can still be retained. If setup fails before an audit can run, inspect the action log; an audit report may not exist.

For production workflows, pin third-party actions to a reviewed commit SHA in line with your repository's dependency policy.

## Interpret incomplete checks

**Indistinguishable baselines:** choose fixtures with an observable difference. Two accounts returning the same empty list cannot reveal this kind of contamination.

**Unstable baselines:** isolate the environment and inspect timestamps or request metadata. Ignore specific nonessential JSON fields only after understanding why they change. Do not ignore the tenant, owner, or currency field you intended to test.

**A reset or authorization error:** correct the integration first. A failed reset, a `401`, or a `403` does not establish a valid baseline and cannot produce a passing isolation check.

**Unexpected drift:** reproduce the sequence and investigate state beyond the cache as well. The tool establishes an observed response change, not its root cause.

See the [methodology](methodology.md) and [configuration reference](configuration.md) for the complete comparison rules and scope.
