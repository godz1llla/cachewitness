# Configuration reference

CacheWitness reads JSON data. Configuration files do not execute JavaScript.

```sh
node bin/cachewitness.js check path/to/config.json
node bin/cachewitness.js check path/to/config.json --json
node bin/cachewitness.js check path/to/config.json --output artifacts/report.json
```

## Fields

| Field | Required | Description |
| --- | --- | --- |
| `baseUrl` | Yes | HTTP or HTTPS origin such as `http://127.0.0.1:3000`, without a path, query, fragment, or embedded credentials. |
| `request.path` | Yes | Origin-relative path for the JSON endpoint, starting with `/`. |
| `request.method` | No | `GET`. This release audits GET responses. |
| `request.headers` | No | Common string-valued headers. Defaults to `{}`. |
| `variants` | Yes | Between 2 and 16 request variants with unique names. |
| `variants[].name` | Yes | Unique name, 1–48 characters: ASCII letters, digits, `.`, `_`, or `-`; begins with a letter or digit. Use non-sensitive names. |
| `variants[].headers` | No | Headers to merge over common request headers. |
| `variants[].query` | No | String-valued query parameters for this variant. |
| `reset.path` | Yes | Origin-relative path for your test reset endpoint. |
| `reset.method` | No | `POST` or `DELETE`. Defaults to `POST`. |
| `reset.headers` | No | Headers sent only to the reset endpoint. |
| `reset.body` | No | JSON request body for the reset endpoint. |
| `ignore` | No | Up to 100 non-root JSON pointers to exclude from comparisons. Defaults to `[]`. |
| `timeoutMs` | No | Per-request deadline, including response reading, from 1 to 60000 milliseconds. Default: `5000`. |
| `maxBodyBytes` | No | Maximum response size from 1 to 10485760 bytes. Default: `1048576` (1 MiB). |
| `baselineRuns` | No | Cold baseline requests per variant, from 2 to 5. Default: `2`. |

Unknown fields are rejected so a misspelled option cannot silently weaken the audit. Non-2xx responses do not establish a valid baseline or a successful reset. Configuration files are limited to 1 MiB and nesting to 32 levels. Headers are case-insensitive; duplicate spellings and transport-controlled headers such as `Host` and `Content-Length` are rejected.

## Environment variables

String values may reference environment variables using `${NAME}`:

```json
{
  "baseUrl": "${CACHEWITNESS_BASE_URL}",
  "request": { "path": "/api/dashboard" },
  "variants": [
    {
      "name": "alice",
      "headers": { "Authorization": "Bearer ${CACHEWITNESS_ALICE_TOKEN}" }
    },
    {
      "name": "bob",
      "headers": { "Authorization": "Bearer ${CACHEWITNESS_BOB_TOKEN}" }
    }
  ],
  "reset": { "path": "/__test/reset-cache", "method": "POST" }
}
```

Missing referenced variables produce a configuration error. Use your shell, CI secret store, or environment loader to populate them. CacheWitness does not require a `.env` file.

Environment substitution supplies strings. Numeric configuration options such as `timeoutMs` must remain JSON numbers. Never commit real credentials to a configuration file.

## Reset adapter

The reset endpoint is part of your test application. It must finish clearing the state relevant to the audit before returning a successful response. A response that only enqueues a reset is insufficient.

CacheWitness resets before **every** cold baseline request and before every ordered pair. For two variants and two baseline runs, that is six resets. Your adapter should be repeatable.

For a cache audit, clear the relevant cache while retaining the fixtures that determine each user's correct response. Clearing unrelated application data can make the result difficult to interpret. Authenticate the endpoint if your test environment requires it; use `reset.headers` for those credentials.

Run against a dedicated test environment. This endpoint is intentionally state-changing and should not be exposed as a public production capability.

## Query variants

You can vary query parameters as well as headers:

```json
{
  "baseUrl": "http://127.0.0.1:3000",
  "request": { "path": "/api/price" },
  "variants": [
    { "name": "usd", "query": { "currency": "USD" } },
    { "name": "eur", "query": { "currency": "EUR" } }
  ],
  "reset": { "path": "/__test/reset-cache", "method": "POST" }
}
```

Choose fixtures whose correct responses differ in a meaningful field. If both currencies produce the same response, the pair is indistinguishable and the audit cannot establish isolation.

## Ignored JSON pointers

Use explicit JSON pointers for genuinely variable metadata:

```json
{
  "ignore": ["/requestId", "/metadata/generatedAt", "/items/0/debugTimestamp"]
}
```

Pointers use RFC 6901 escaping: `~1` means `/` inside a property name and `~0` means `~`. Wildcards are not supported. Array indices refer to exact positions, not every array member.

Do not ignore the fields that distinguish your variants, such as `/tenantId` or `/currency`. Ignoring too much can make the test inconclusive or hide the behavior you intended to check. Response object key order does not matter; array order does.

## Remote targets

The default allowed hosts are `localhost`, `127.0.0.1`, and `[::1]`. An explicitly authorized remote test environment needs:

```sh
node bin/cachewitness.js check staging-cachewitness.json --allow-remote
```

HTTP redirects are rejected. Request and reset paths must stay on the configured origin. Embedded URL credentials are not supported; use headers instead.

## Output and exit codes

`--json` writes the report to stdout. `--output` writes a JSON report file and can be combined with `--json`. Human-readable output is the default.

| Exit | Meaning |
| --- | --- |
| `0` | All covered ordered pairs passed. |
| `1` | At least one contamination or drift witness was found. |
| `2` | Configuration or operational error, or an inconclusive audit. |

Reports contain hashes, variant names, and JSON pointers. They do not include raw response values, authorization headers, full URLs, or reset request bodies. See [report privacy](../SECURITY.md).

## Response constraints

The checked endpoint must return a successful HTTP response containing JSON. Reset responses only need a successful HTTP status; they do not need a JSON body.

JavaScript numbers cannot exactly represent every integer that JSON permits. CacheWitness rejects unsafe integers and non-finite parsed numbers with `unsupported_json_number` instead of comparing potentially rounded values as if they were trustworthy. Encode large identifiers and exact high-precision quantities as strings in the response. This tool is not an arbitrary-precision JSON comparator.

Object property order is ignored. Array order is significant. Response headers are not compared, and the CLI does not maintain a browser cookie jar between requests: express each variant's required test credentials explicitly in its headers.
