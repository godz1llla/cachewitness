# Launch preparation

This is a maintainer checklist, not evidence of adoption or a ready-made promotional post.

## Claims the implementation is intended to support

- It compares cold responses with responses observed after another variant primes the endpoint.
- It exercises both directions for each distinguishable pair.
- It reports contamination separately from unexplained drift.
- It treats unstable or indistinguishable baselines as inconclusive.
- It runs locally using Node.js and no runtime dependencies.
- Reports omit raw response values and request credentials, with the privacy limits described in SECURITY.md.

Verify these claims against the current release before describing it publicly. Do not claim that it identifies the responsible cache key, guarantees tenant isolation, or has found bugs in external projects unless there is evidence and permission to share it.

## Capture a useful demonstration

1. Start from a fresh clone and install using the documented commands.
2. Run the broken demo and show the source, target, and changed fields.
3. Show the incorrect cache key in the sample application.
4. Run the fixed demo with identity included in the key.
5. Keep the recording focused on the observable before/after behavior.

Say explicitly that the first demo is intentionally vulnerable and exits with code 1. A synthetic demonstration is not a finding in a real project.

## Before a public announcement

- Confirm the repository is public and the documented commands work from a clean checkout.
- Check CI, packaged files, license, and the release notes.
- Make the supported scope and limitations easy to find.
- Ask a few developers who did not build it to run the demo and explain the result.
- Record setup failures and confusing verdicts; fix those before expanding promotion.

## Choose a relevant audience

Start with developers maintaining HTTP applications with shared caches. Match each community's topic and self-promotion rules. Disclose that you maintain the project. Ask for scenarios the current experiment cannot express or findings that are hard to interpret.

If submitting to Hacker News, write the title, submission, and comments yourself. Its guidelines prohibit generated and AI-edited text, automated posting, and solicited votes. Check the current [HN guidelines](https://news.ycombinator.com/newsguidelines.html) and [Show HN guidelines](https://news.ycombinator.com/showhn.html) before posting. This document is not a submission draft.

## What to learn from early use

Track whether people can complete setup, supply a correct reset adapter, interpret inconclusive results, and retain a useful check in CI. Stars indicate interest; successful use and independent reproductions indicate whether the tool solves the intended problem. Neither can be promised in advance.
