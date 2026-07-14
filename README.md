# Project Archive

Project Archive is a cinematic, story-driven history game that teaches the required Grade 8 United States history curriculum (Texas TEKS, U.S. history through 1877) by letting students *live* history instead of studying it. Players work an ordinary job in a real historical city while fixed historical events unfold around them, and a diegetic futuristic "Archive" System provides concise exposition and assessment in-world.

This repository contains the canonical **Game Design Document** ([`Project-Archive-v3.md`](Project-Archive-v3.md)) — the production source of truth for gameplay, learning systems, runtime architecture, content pipeline, and the fully specified Boston reference chapter.

## The Pitch

You are inserted into a historical city under a believable cover identity — a printer's apprentice in 1765 Boston, for example. You take deliveries, talk to neighbors, run errands, and witness the events that shaped a nation. History is fixed: you cannot stop the Stamp Act, the Boston Massacre, or the Tea Party. But *how* you move through each day — the encounters you stumble into, the routes you take, the people you talk to — is different almost every time.

The core promise: **no two players play the same game, but every player learns the same required history.**

## Two Design Pillars

### 1. Practically impossible to play the exact same game twice

As you travel between objectives, the world interrupts you with short, fully authored **Living Historical Encounters** — a customs inspection, an overturned cart, a rumor in the market, a changed meeting place, a crowd forming around a newspaper. These are selected at runtime from a large authored bank, combined with route order, dialogue variants, and deliberate silence.

The design does not claim literal infinity (the content bank is finite and honest about it). Instead it defines a **verifiable uniqueness contract**:

- A per-player **no-repeat guarantee** across the first several chapter replays whenever a legal alternative exists.
- A cohort target keeping the probability of *any* two players sharing an identical system-selected playthrough below 1% across 10,000 representative runs.
- A single deterministic, seeded selection function so runs stay reproducible for QA while feeling spontaneous to players.

### 2. Everyone learns the same thing anyway

Replay variation only changes optional texture. It can never alter:

- Fixed historical facts, dates, participants, and outcomes.
- The required curriculum (every player is guaranteed the same instruction via versioned **Required Carrier Contracts**).
- The assessment standard and cognitive demand.

Optional encounters may *reinforce* learning but can never be the sole carrier of a required concept, and they are never scored.

## How a Session Plays

```
Anchor briefing  ->  Job objective  ->  Travel (encounter or silence)
      ->  Required conversation / evidence  ->  Historical event
      ->  Archive Sync (in-world check)  ->  Return to anchor  ->  End day
```

- **Mission Day** — the core repeatable unit: one job, a fixed historical event, a required Archive Sync, and a return.
- **Chapter** — one place, one driving question, one anchor character, several Mission Days, ending in a Mission Debrief.
- **Season** — four chapters and a transfer arc, ending in a STAAR-style Season Review.

## Key Systems

- **AI Director** — chooses the single best *approved* next experience at each decision point. It selects from human-authored options only; it never generates or rewrites dialogue, facts, questions, or history.
- **Event Manager** — the sole authority on what is currently legal, and the coordinator of all state transactions.
- **World State, Learner Model, and Replay Profile** — separate owners for historical truth, lightweight learning evidence, and non-learning replay history, respectively.
- **The Archive** — an in-fiction holographic System that delivers exposition, formative Syncs, Debriefs, and Reviews without breaking immersion.
- **Assessment Runtime** — owns forms, reviewed item order, and immutable official records, kept independent of replay state, route, and support history for fairness.

## Design Guarantees

- **Authored, not generated.** No player-facing content is generated at runtime. Everything is written, reviewed, voiced, and packaged before release.
- **Deterministic and reproducible.** Fixed inputs (package, seed, state, selector version) always produce the same run.
- **Playable offline.** The complete required path works with no network and no runtime AI.
- **Privacy-first.** Replay and telemetry data exclude raw responses, learner-state labels, and direct identifiers by default.
- **Evidence-gated release.** Requirements are tracked with explicit status; the document does not claim validation that has not yet been produced.

## Reference Chapter: Boston, 1765–1774

The document fully specifies **"Boston on the Brink"** as the gold-standard reference design: four Mission Days spanning the Stamp Act crisis, the Boston Massacre, the Boston Tea Party, and the Intolerable Acts / Port Act, anchored by Abigail Mercer's print shop and a 32-family Living Historical Encounter bank.

## Repository Contents

| File | Description |
| --- | --- |
| [`Project-Archive-v3.md`](Project-Archive-v3.md) | Canonical game design document (vision, systems, architecture, production, and the Boston reference chapter). |

## Status

This repository currently holds the design specification. Boston is a complete core-spine reference design; encounter ActionSpecs, final assets, and validation/pilot evidence are tracked as pending package deliverables in the document's requirements matrix.

## Curriculum Target

Texas Grade 8 Social Studies — United States history through 1877, aligned to current STAAR-eligible content TEKS.
