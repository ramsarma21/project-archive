# TrueFoundry formative grading selection

Run: 2026-07-22 against the gateway `/models` and
`/chat/completions` endpoints. The corpus contains ten authored engineering
fixtures (connected, partial, unsupported, prompt-injection, dialect, and
spelling cases). It is not an SME calibration or bias-approval corpus.

Thresholds:

- structured-output compliance: 100%
- exact authored-label accuracy: at least 80%
- abstention (`NEEDS_SOURCE_REVISIT`) quality: at least 67%
- selection among passing candidates: lowest p50 latency

Selected deployment:
`aws-bedrock/us.amazon.nova-micro-v1-0`

Evidence from the final run:

- native JSON Schema compliance: 10/10 (100%)
- exact label accuracy: 9/10 (90%)
- abstention quality: 3/3 (100%)
- p50 latency: 712 ms
- p95 latency: 1,296 ms
- total input tokens: 10,340
- total output tokens: 724
- provider-reported cost: unavailable in the gateway response; deployment
  cost controls must therefore use token budgets until billing metadata is
  exposed

Other discovered candidates in this small speed set did not pass. The two
nano OpenAI aliases returned HTTP 400 for both schema and JSON-object request
forms through this gateway. Gemini 3.5 Flash Lite returned JSON that failed
the strict observation schema. They were not selected based on apparent
error latency.

Reproduce manually (never normal CI):

```sh
RUN_LIVE_GRADING_BENCHMARK=true \
TRUEFOUNDRY_GRADING_BENCHMARK_MODELS='comma,separated,discovered-models' \
pnpm --filter @pa/api grading:benchmark:live
```

The script requires model discovery to confirm every candidate, emits only
fixture IDs and aggregate metrics, and never writes student text, provider
prompts, or credentials. It runs on `TRUEFOUNDRY_API_KEY` like everything else —
there is one TrueFoundry key. (This paragraph used to require a *separate*
`TRUEFOUNDRY_GRADING_API_KEY` in production; the owner overruled that. The
deployed task still receives the alias, injected by `infra/` from the same single
secret, because `packages/grading` has not yet dropped its `NODE_ENV` branch.)

## Canonical five-operation probe

After adopting the content package's criterion-level schema, a second live
probe ran against the same pinned deployment on 2026-07-22:

- all five operations returned native, strict-schema-valid JSON;
- topicality stayed within `ON_TOPIC | OFF_TOPIC | ABSTAINED`;
- every criterion level stayed within `STRONG | PARTIAL | MISSING`;
- all cited evidence IDs remained package-allowlisted;
- deterministic outcomes were authored-only: four `PARTIAL_RESPONSE`
  outcomes and one `OFF_TOPIC` outcome for the deliberately mismatched
  perspective fixture;
- latency ranged from 1,024 ms to 1,733 ms;
- no response text, provider prompt, secret, or model prose was printed.

This proves transport/schema compatibility, not curriculum calibration.
Student-visible classifier feedback remains disabled while the package is
`AUTHOR_DRAFT` / `HISTORICAL_REVIEW_PENDING`.

