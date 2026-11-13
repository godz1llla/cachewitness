# Changelog

## 0.1.0 — 2026-11-13

Initial public release.

- Audit a JSON GET endpoint across 2–16 user, tenant, or query variants.
- Establish repeated cold baselines and exercise all ordered prime/probe pairs.
- Distinguish contamination, unexpected drift, incomplete coverage, and operational errors.
- Produce bounded evidence reports with hashes and field paths, without response value dumps.
- Reject redirects, invalid UTF-8, oversized bodies, lossy JSON numbers, and unsuccessful requests.
- Run self-contained broken and fixed demos without external services or dependencies.
- Validate the CLI and installed tarball on Node.js 22, 24, and 26, including Linux, macOS, and Windows CI jobs.

Scope: sequential scenarios on a dedicated resettable test environment; no endpoint discovery, cache-key introspection, concurrent race testing, or universal isolation guarantee.
