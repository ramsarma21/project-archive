# Project Archive

Project Archive is a cinematic, story-driven history game that teaches the required
Grade 8 United States history curriculum (Texas TEKS, U.S. history through 1877) by
letting students *live* history instead of studying it. Players work an ordinary job
in a real historical city while fixed historical events unfold around them, and a
diegetic futuristic "Archive" System provides concise exposition and assessment
in-world.

The core promise: **no two players play the same game, but every player learns the
same required history.**

## Status: built

The game is implemented and playable, not a paper design. The Boston 1765 reference
chapter is built end to end:

- **Milestones M0–M5 complete** — foundations, stamina + chase, watchers/suspicion/
  heat, Standing + reactive world, content + assets, and micro tracking + the CP1
  debrief.
- **Cognitive learning core** — event-sourced deterministic runtime with the full
  exposure → gate → understanding → demonstration → reassessment lifecycle, the
  two-tier concept ledger, and seeded, reproducible assessment selection.
- **World v3** — the "big street" district with **36 explorable interiors**, all
  visible production geometry imported through the asset pipeline.
- **All suites green** — workspace typechecks, runtime tests, web (world/collision/
  stealth/chase) tests, content validators, API tests, and the browser QA harnesses
  (zero game/page/HTTP/WebGL errors, non-black rendering).

## Quickstart

```sh
pnpm install
pnpm dev            # runs @pa/api + @pa/web concurrently

# verify
pnpm typecheck
pnpm test
pnpm --filter @pa/web build
```

Google login and save persistence need the API configured (see `.env.example` and
`infra/README.md`). The full verification matrix is in
[`docs/process/QA-PLAYBOOK.md`](docs/process/QA-PLAYBOOK.md).

## Documentation

Start with [`ARCHITECTURE.md`](ARCHITECTURE.md) — system overview, source-of-truth
pointers, the symptom → owning-module bug-finding table, and the determinism
contract. Then:

### `docs/design/` — product & design intent
- [`Project-Archive-v3.md`](docs/design/Project-Archive-v3.md) — canonical Game Design Document.
- [`PRODUCT-REQUIREMENTS.md`](docs/design/PRODUCT-REQUIREMENTS.md) — product requirements.
- [`Gameplay-Design.md`](docs/design/Gameplay-Design.md) — the game built around the learning core.
- [`World-Design-Bible.md`](docs/design/World-Design-Bible.md) — world look/layout/atmosphere law.
- [`Interaction-Spec.md`](docs/design/Interaction-Spec.md) — interaction, HUD, timing, micro rules.
- [`Curriculum-World-Map.md`](docs/design/Curriculum-World-Map.md) — TEKS ownership across eras.
- [`BrainLift.md`](docs/design/BrainLift.md) — design thinking / provenance.

### `docs/engine/` — built-state & backend specs
- [`Backend-AI-System.md`](docs/engine/Backend-AI-System.md) — backend/AI architecture.
- [`Production.md`](docs/engine/Production.md) — asset pipeline + no-mocap laws.
- [`World-Built-State.md`](docs/engine/World-Built-State.md) — the 3D world as actually built.
- [`Learning-Ledger-Spec.md`](docs/engine/Learning-Ledger-Spec.md) — learner state & contract extension.
- [`Assessment-Content-Gap.md`](docs/engine/Assessment-Content-Gap.md) — assessment content status.
- [`Grading-Benchmark.md`](docs/engine/Grading-Benchmark.md) — formative-grading model selection.

### `docs/chapters/boston-1765/` — the worked chapter
- [`Day-1.md`](docs/chapters/boston-1765/Day-1.md) — the canonical behavior fixture.
- [`Day-1-Build-Script.md`](docs/chapters/boston-1765/Day-1-Build-Script.md) — per-beat build script.
- Plus world content, micro concepts, environmental lore, activity/mechanics/archive/quest/STAAR specs.

### `docs/process/` — how to build more
- [`CHAPTER-AUTHORING.md`](docs/process/CHAPTER-AUTHORING.md) — build a new chapter with only content + assets.
- [`QA-PLAYBOOK.md`](docs/process/QA-PLAYBOOK.md) — every suite/harness and its exact command.
- [`Chapter-Day-Template.md`](docs/process/Chapter-Day-Template.md) — reusable Mission Day laws and beat patterns.
- [`Open-Response-Authoring.md`](docs/process/Open-Response-Authoring.md) — open-response content authoring.

### `docs/archive/2026-07/` — historical build briefs and integration handoffs
Point-in-time planning and milestone-integration notes, kept for provenance.

## Curriculum target

Texas Grade 8 Social Studies — United States history through 1877, aligned to
current STAAR-eligible content TEKS.
