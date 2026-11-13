# Contributing to CacheWitness

Thanks for helping make isolation checks more reliable. Small reproductions and clear explanations are particularly useful.

## Local development

Use Node.js 22 or newer:

```sh
git clone https://github.com/godz1llla/cachewitness.git
cd cachewitness
npm ci
npm test
npm run demo:fixed
```

`npm run demo` deliberately finds a broken cache and exits with code 1. That is expected; it is not a failing installation.

## Report a bug

Include the Node.js version, operating system, command, expected result, and a small reproduction. Prefer a test server with synthetic identities over a production URL or private application code.

Remove credentials, account data, and sensitive field names from any attached report. Do not post a real cross-user data leak publicly; see [SECURITY.md](SECURITY.md).

## Propose a change

For a substantial feature, open an issue explaining the scenario before implementing it. Useful questions include:

- What behavior does a user need to check?
- Can the existing configuration express it?
- What evidence would justify a pass, fail, or inconclusive verdict?
- How can the behavior be demonstrated with a small deterministic server?

The initial scope is intentionally narrow: sequential HTTP JSON response isolation. Features should preserve clear evidence and bounded execution.

## Pull requests

1. Make a focused change.
2. Add a meaningful regression test when changing audit behavior.
3. Run `npm test` and the relevant demo.
4. Update the configuration or methodology docs if behavior changed.
5. Describe the problem, resulting behavior, and validation in the pull request.

Use descriptive commits such as `fix: reject unstable cold baselines` or `feat: support a new request dimension`. Avoid unrelated formatting changes.

Never put authorization headers, raw account responses, or reset bodies in diagnostic output. Treat ambiguous observations as inconclusive rather than as a pass. Keep the runtime dependency-free unless a proposed dependency has a clear, reviewed benefit.

Contributions are made under the project's [MIT license](LICENSE).
