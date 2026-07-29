# Project Archive

Project Archive is a cinematic, story-driven history game that teaches the required
Grade 8 United States history curriculum (Texas TEKS, U.S. history through 1877) by
letting students *live* history instead of studying it. Players work an ordinary job
in a real historical city while fixed historical events unfold around them, and a
diegetic futuristic "Archive" System provides concise exposition and assessment
in-world.

The core promise: **no two players play the same game, but every player learns the
same required history.**

## Status

**Mission 1 and PvP are playable end to end.** The rest of the Boston chapter is
scaffolded but not authored: all fourteen operations are declared, thirteen of them
carry `built: false` and the hub draws those as forthcoming. Adding one is changing
a line of that array into a definition — content and assets, not code.

A run of Mission 1 is: the hub, a mandatory three-minute learning module, a held
briefing moment where the System annotates the world, three minutes of stealth
parkour against a dawn clock, a precision-timed beat at the Liberty Tree, and a gun
duel where each round's free-response question is graded live and buys 14 balls for
a right answer or 7 for a wrong one. PvP is that duel between two accounts.

## Quickstart

```sh
pnpm install
pnpm db:up          # Postgres in Docker — progression will not save without it
pnpm db:migrate
pnpm dev            # @pa/api on :3001 and @pa/web on :5173
```

Then open **http://localhost:5173**. Sign in with Google, or take the local-profile
path on the landing page, which runs the hub as labelled practice that saves nothing.

To duel yourself, open `http://localhost:5173/src/pvp/pvp.html` in a normal window
and again in a private one, and sign in as a different account in each. Two windows
are needed because a duel is between two accounts and one browser context holds one
session — joining your own lobby is refused by name.

Grading needs a TrueFoundry credential, and there is exactly one: set
`TRUEFOUNDRY_API_KEY` in `.env` and nothing else. The same key serves grading, the
nightly grading eval and the concept-art pipeline. Without it, answers fall back to
granting the maximum, which looks like working grading and is not. See
`.env.example`.

```sh
# verify
pnpm typecheck
pnpm test
pnpm lint
pnpm --filter @pa/web build
```

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

> **A caution on the docs above.** The game was redesigned and its previous
> implementation deleted — roughly 70,000 lines, including the open-world district,
> the Standing and chase systems and the formative open-response grading. Documents
> written for that version still describe it. The ones known to match what is built
> are [`ARCHITECTURE.md`](ARCHITECTURE.md), the Mission Slate, the M1 fun audit, and
> the package READMEs under `packages/`. Treat the rest as design intent rather than
> as a description of the code until it has been checked.

## Curriculum target

Texas Grade 8 Social Studies — United States history through 1877, aligned to
current STAAR-eligible content TEKS.
