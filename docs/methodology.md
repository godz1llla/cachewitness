# How CacheWitness reaches a verdict

CacheWitness tests one question:

> Does a target variant receive its normal response after a different variant primes the same endpoint?

The test uses HTTP observations. It does not inspect cache keys or determine the implementation's root cause.

## Inputs

You provide one GET endpoint, at least two variants, and a synchronous reset operation. A variant can represent a user, tenant, locale, currency, or any request context expressed through headers and query parameters.

Fixtures should be deterministic and should return different values where isolation matters. The reset operation must remove the shared state relevant to this experiment without changing those fixtures.

## 1. Establish cold baselines

For each variant, repeat the following sequence `baselineRuns` times (default: twice):

```text
reset → request variant → normalize JSON → fingerprint
```

Every baseline request starts after its own reset. The repetitions must agree after configured fields are ignored. An unstable baseline cannot be used as an expected response; affected pair checks are inconclusive.

Normalization ignores object property order, preserves array order, and excludes explicitly configured JSON pointers. HTTP status is part of the comparison.

The JSON comparison rejects unsafe integers and non-finite parsed numbers rather than treating rounded values as reliable evidence. Represent large identifiers as strings. Headers are not compared.

## 2. Exercise each ordered pair

For every distinct pair A and B with usable baselines:

```text
reset → A → A again → B
```

The source responses must stay consistent with A's baseline. The second A request also exercises the warmed path before probing B.

Then compare the observed B response with the baselines:

| Observation | Interpretation |
| --- | --- |
| Cold A equals cold B | The pair is indistinguishable. There is no observable discriminator. |
| Observed B equals cold B | The tested sequence passes. |
| Observed B differs from cold B and equals cold A | A contamination witness. |
| Observed B differs from both baselines | A drift witness that needs investigation. |

A → B and B → A are separate checks. With `n` variants, there are `n × (n − 1)` ordered pairs. Keep the variant set small and representative.

For fully distinguishable, stable variants, the default two baseline runs use `4n + 4n(n − 1)` HTTP requests, including resets. For two variants, that is 16 requests. Skipped pairs and early errors reduce this number.

## 3. Report evidence

The report records the source and target names, verdict, response fingerprints, and changed JSON pointers. It does not write raw response values. This makes reports easier to review without copying private account data into CI logs.

JSON field names and variant names can themselves be sensitive. Hashes are deterministic and may reveal equality or permit guessing of low-entropy payloads. They are not an anonymization guarantee.

## Interpret the verdict carefully

- **Pass:** the supplied distinguishable cases survived the exercised sequences.
- **Fail:** a contamination or drift witness was observed.
- **Inconclusive:** the experiment cannot establish isolation for all requested pairs, for example because baselines are identical or unstable.
- **Error:** the experiment could not run reliably, for example because a reset failed or a response exceeded its limit.

An operational error must never be treated as a clean run. A failure in one checked pair also remains useful evidence when other pairs could not be checked; inspect the report's checks and summary rather than relying only on a single label.

## What this does not prove

**A contamination witness does not prove a cache bug.** Shared session state, mutable globals, an incorrect tenant lookup, a broken reset, or another stateful component can create the same output. Inspect the request sequence and the application before assigning a root cause.

**A pass does not prove complete isolation.** It says nothing about untested endpoints, identities, request dimensions, concurrent requests, long-lived expiration behavior, asynchronous resets, or effects hidden by ignored fields.

**Warm requests do not prove a cache hit.** CacheWitness observes the responses; without application instrumentation it cannot know whether an internal cache was consulted.

**The tool does not infer authorization policy.** You choose valid test identities and the expected distinctions. It does not decide which users are permitted to see which fields.

## Reproduce and fix a finding

1. Reset the same dedicated test environment.
2. Make the source request twice.
3. Make the target request and compare it with a fresh cold request for that target.
4. Trace the relevant state in your application, including cache keys and user or tenant context.
5. Fix the implementation and run the same configuration again.
6. Keep the scenario in CI so a later change exercises the same ordering.

Use the included broken and fixed demos to see this loop without connecting any external service.
