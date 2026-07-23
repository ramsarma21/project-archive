# Chapter Authoring

How to build a **new chapter using only content and assets** — no engine changes.
The runtime, presenter, stealth/chase, assessment, and pipeline are all built and
chapter-agnostic; a new chapter is authored data in two sibling packages
(runtime content + browser world content), plus app-owned assets. If you find
yourself editing `packages/runtime`, `packages/engine-world`, or app logic,
stop: that is engine/integration work, not chapter authoring.

The Boston 1765 chapter is the gold-standard reference. Mirror it.

---

## 0. Prerequisite reading (in order)

1. [`../design/Project-Archive-v3.md`](../design/Project-Archive-v3.md) — the canonical GDD (vision, systems, guarantees).
2. [`../design/Gameplay-Design.md`](../design/Gameplay-Design.md) — chapter structure, the two-budget loop, stealth, the two-tier concept ledger, checkpoint cadence.
3. [`../design/Curriculum-World-Map.md`](../design/Curriculum-World-Map.md) — which era owns which TEKS SEs, and `ONCE`/`SPIRAL` recurrence.
4. [`Chapter-Day-Template.md`](Chapter-Day-Template.md) — the reusable laws and beat patterns every Mission Day obeys.
5. [`../design/Interaction-Spec.md`](../design/Interaction-Spec.md) — interaction, HUD, timing, and micro rules.
6. [`../design/World-Design-Bible.md`](../design/World-Design-Bible.md) — world look/layout/atmosphere law and the harbor exclusion.
7. [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) — source-of-truth pointers and determinism contract.

The Boston worked example lives under [`../chapters/boston-1765/`](../chapters/boston-1765/);
read [`../chapters/boston-1765/Day-1.md`](../chapters/boston-1765/Day-1.md) (behavior fixture)
and [`../chapters/boston-1765/Day-1-Build-Script.md`](../chapters/boston-1765/Day-1-Build-Script.md)
(per-beat build script) as the template for structure and depth.

## 1. Era selection

Pick the era and driving question from
[`../design/Curriculum-World-Map.md`](../design/Curriculum-World-Map.md), which
assigns each STAAR-eligible SE to a `chapterOwner` and marks recurrence. A chapter
owns a set of **`ONCE`** (event-anchored, chapter-specific) SEs and reinforces the
**`SPIRAL`** SEs introduced earlier. Confirm no required SE is left unowned across
the season.

## 2. Curriculum pass (macro + micro)

Before authoring content, classify every concept per
[`../engine/Learning-Ledger-Spec.md`](../engine/Learning-Ledger-Spec.md):

- **`MACRO_GATED`** — required spine carriers. Full lifecycle (exposure → gate →
  understanding → demonstration → reassessment); ≥3 occasions / ≥2 types; must
  reach `DEMONSTRATED`; appears in every debrief. Delivered **only** on the guided
  authored spine.
- **`PATTERN`** — thematic/spiral, taught by mechanics; `archiveSafetyNet` bridge
  only for the highest-STAAR ones.
- **`MICRO`** — enrichment; engaged-only; debrief-sampled as bonus, never a gate.

Hard safety rule: interactables (NPC chats, posters, objects, side-jobs) carry
**MICRO only** — never a required macro carrier — so the path-invariant guarantee
holds no matter what a student engages or skips.

## 3. Runtime content package layout

Create `content/<city>/<act>/` mirroring [`../../content/boston/act1/`](../../content/boston/act1/)
exactly:

| Path | Purpose |
|---|---|
| `sources/sources.json` | Authored primary-source excerpts (the evidence students read). |
| `prompts/open-response-items.json` | Open-response items keyed to sources. |
| `rubrics/rubrics.json` | Criterion-level rubrics per item. |
| `feedback/feedback.json` | Authored feedback strings (positive + reroute). |
| `classifier/classifier-schema.json` | Strict observation schema for the grader. |
| `archive/connections.json` | Archive memory-cued connections (provenance labels). |
| `dialogue/npc-followups.json` | NPC follow-up lines keyed to concepts. |
| `schema/open-response-item.schema.json` | JSON Schema the items validate against. |
| `allowlists.json` | Allowlisted evidence IDs and the fiction rules (no em dashes, etc.). |
| `package.manifest.json` | Package identity, version, status, and fiction rule. |
| `validate/validate-content.mjs` | The package validator (run it constantly). |
| `REVIEW.md` | SME review log / status. |

All player-facing text obeys the project fiction rules in `allowlists.json` /
`package.manifest.json`. After editing any source file, regenerate the runtime
artifact and re-validate:

```sh
pnpm --filter @pa/chapter-boston content:compile
pnpm --filter @pa/chapter-boston content:validate
```

Never hand-edit generated chapter artifacts.

## 4. World content against manifest coordinates

Create a sibling browser package like
[`../../packages/chapter-boston-world/`](../../packages/chapter-boston-world/).
It may depend on `@pa/chapter-boston` and `@pa/engine-world`; the engine must
never depend on it. Place anchors, hero stops, notice surfaces, event staging,
watcher posts, refuge markers, atmosphere, and imported-asset keys as content
against its exterior/interior manifests.

Export one `ChapterWorldDefinition` (Boston's is `BOSTON_1765_WORLD`) from the
package root. The minimum public shape pairs the chapter id with the world
component, stealth projection factory, document-art resolver, and QA capability
flags. Keep all other files private package internals. Add exactly one app
registration that pairs the runtime `ChapterDefinition` with this world
definition; app pages import package roots only.

Public asset URLs remain app-owned (`/world/...`, `/audio/...`). A chapter-world
package authors keys and paths but does not copy assets into its package.
Reuse the existing district where a day re-dresses it (see the multi-day reuse map
in [`../design/World-Design-Bible.md`](../design/World-Design-Bible.md)); a route
is *state*, not new geometry. Keep the west/southwest harbor water open — never
extend backdrop city or land into the harbor exclusion bands.

## 5. Asset pipeline law

Every visible physical object/surface is an imported GLB and/or generated texture.
Follow the pipeline for each new physical asset — no shortcuts, no primitive
fallbacks in production:

```
Gemini concept image  →  historical/visual QA (Bible checklist)  →  Meshy image-to-3D
   →  scoped Blender optimize (tri/texture budgets)  →  verify + manifest
   →  targeted web sync
```

Prototype by re-tinting/re-placing existing assets first (the inventory is deep);
commission new GLBs only where nothing reads acceptably. Invisible collision,
portals, triggers, navigation, sky, fog, water, weather, particles, shaders, and
contact shadows may remain procedural. See
[`.cursor/rules/imported-visible-world-assets.mdc`](../../.cursor/rules/imported-visible-world-assets.mdc)
and [`../engine/Production.md`](../engine/Production.md).

## 6. Beat authoring

Author each Mission Day from [`Chapter-Day-Template.md`](Chapter-Day-Template.md):
the beat patterns, the DO → LEARN → PROVE loop, spacing rules (≥2 interactions
between Syncs), the fiction laws, and the reroute/fallback obligations. Produce a
behavior fixture (like `Day-1.md`) and, for implementers, a per-beat build script
(like `Day-1-Build-Script.md`) binding each beat to existing animation/input/skill
hooks. Open-response authoring specifics are in
[`Open-Response-Authoring.md`](Open-Response-Authoring.md).

## 7. Assessment gates

- Author STAAR-style items per concept and the checkpoint debrief form
  (`MACRO_GATED` always + engaged `MICRO` sampled as bonus + spaced retrieval of
  prior acts).
- Selection is deterministic and seeded; the bank is authored/approved content —
  the runtime **selects, never generates**.
- **SME approval is a hard gate.** Items ship as `AUTHOR_DRAFT` /
  `HISTORICAL_REVIEW_PENDING`; student-visible classifier feedback stays disabled
  until SME sign-off is logged in `REVIEW.md`.

## 8. Definition of done

- [ ] Era + driving question chosen; all required SEs owned (Curriculum-World-Map).
- [ ] Every concept classified (`MACRO_GATED` / `PATTERN` / `MICRO`); macros live only on the spine.
- [ ] Content package complete and mirroring `content/boston/act1/`; validator green.
- [ ] Artifact regenerated; generated-hash validator passes.
- [ ] Sibling chapter-world package exports a typed `ChapterWorldDefinition`; app registration pairs it with the runtime chapter.
- [ ] World content placed against its real manifest coordinates; harbor exclusion respected.
- [ ] All new visible assets shipped through the full pipeline; no primitive fallbacks.
- [ ] Behavior fixture + per-beat build script authored; spacing/fiction laws obeyed.
- [ ] Debrief form authored; SME approval logged; drafts gated.
- [ ] Path-invariance holds: skipping any optional content never breaks the required curriculum.
- [ ] QA suites green per [`QA-PLAYBOOK.md`](QA-PLAYBOOK.md).
