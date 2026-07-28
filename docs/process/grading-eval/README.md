# Grading eval — dated reports

The nightly `Grading eval` workflow (`.github/workflows/grading-eval.yml`) writes
one JSON report here per run, named `YYYY-MM-DD.json` (UTC), plus `latest.json`.

**These files are the signal that survives nobody watching.** A green CI dashboard
cannot distinguish a passing nightly from one that silently stopped running — that
is the exact failure mode the automation exists to remove. The git history of this
directory is the trend; a **gap in the dates** is proof the nightly stopped, and is
itself the alarm. A failing run also commits its report here (with
`gate.pass: false`) and opens/updates a GitHub issue labelled `grading-eval`.

Each file is the full `EvalReport` from `packages/grading/src/eval/harness.ts`. The
load-bearing fields:

- `gate.pass` — the verdict. `false` means the run failed the ship gate.
- `gate.reasons` — why it failed, in plain English.
- `falseNegativeRate` — a correct answer marked wrong. The toxic direction; ceiling
  `EVAL_MAX_FALSE_NEGATIVE_RATE` (2.0%).
- `falsePositiveRate` / `gate.untoleratedFalsePositives` — wrong answers graded
  correct. The ceiling catches gross drift; any *un-tolerated* over-credit fails the
  gate outright, at any rate.
- `gradedCases` / `totalCases` — fallbacks are excluded from the rates and counted
  separately; a run that classified fewer than 90% of cases fails, so a degraded
  gateway is a loud fail rather than a false pass.
- `model` — which model was measured, so drift in the provider is attributable.

To reproduce a run locally against a real credential:

```sh
pnpm grading:eval:gate --json /tmp/report.json
```

**Unverified from here:** whether this workflow actually runs in a real GitHub
Actions runner has not been confirmed — `gh` is unauthenticated in the environment
these files were authored in, so a green-looking workflow file is not proof of a
working nightly. The first real run (or its absence) settles it. See
`../CI-AND-BROWSER-CHECKS.md`.
