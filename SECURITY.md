# Security and report handling

CacheWitness is a test tool that sends HTTP requests and invokes a reset operation you configure. Use it only against a dedicated environment you control and intend to reset.

## Report a vulnerability

Do not open a public issue containing credentials or a live cross-user data leak. Use [GitHub private vulnerability reporting](https://github.com/godz1llla/cachewitness/security/advisories/new) through **Security → Report a vulnerability**.

For a problem in an application tested by CacheWitness, contact that application's owner. An audit finding does not automatically indicate a vulnerability in CacheWitness itself.

## Boundaries

- Target URLs must use HTTP or HTTPS. Loopback targets are accepted by default; remote targets require `--allow-remote`.
- Redirects are rejected. Request and reset paths must remain on the configured origin.
- Use headers for test credentials. Embedded URL credentials are rejected.
- Requests have deadlines and response-size limits.
- Configuration is JSON data, not executable code.
- The CLI has no telemetry or model calls.

These controls do not make a remote service trustworthy. `--allow-remote` permits requests to the configured target; it is not an authorization check or a network sandbox. Check the configuration before running it.

## Reset endpoints

An audit invokes the reset endpoint many times. The endpoint must complete the reset before responding. Run the application in isolation from production traffic and unrelated test jobs. Keep the test-only reset capability disabled or otherwise inaccessible in production.

## What reports retain

Reports do not include raw response values, request authorization headers, reset bodies, or full URLs. They retain variant names, changed JSON pointers, outcome metadata, and deterministic response fingerprints.

This is data minimization, not full anonymization. A property name can contain private information. A variant name may identify a customer. A hash can reveal equality and may be guessable when its input has few possible values. Use synthetic data and non-sensitive names, and inspect artifacts before sharing them.

The application responses still exist in process memory while the audit compares them. Treat the machine and CI runner as part of your test environment's trust boundary.

## Disclosure and support

No specific response-time guarantee is offered. Security fixes will be documented in releases when a release is available. Use the latest reviewed version appropriate for your environment and inspect changes before upgrading a CI check.
