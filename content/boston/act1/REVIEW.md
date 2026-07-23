# Boston Act 1 — Cognitive Learning Content Package (Author Draft)

**Status:** `AUTHOR_DRAFT` / `HISTORICAL_REVIEW_PENDING`. Authored with Claude Opus 4.8.
**Scope:** Content and validation only. No runtime, API, or web-integration files were touched. This package is safe to review independently of the presentation, rubric-runtime, grading-service, and open-response-UI work owned by other workers.

> This is a draft for historical and curriculum review. Nothing here is SME-approved, nothing scores mastery, and nothing gates the story. TEKS tags are placeholders. Player-facing text obeys the project no-em-dash fiction rule (`Day-1.md` §5, `Day-Template` L12).

---

## 1. Files and package structure

```
content/boston/act1/
├── package.manifest.json            versioned package meta, exposure cap, disclaimers, review workflow
├── allowlists.json                  single source of truth for every enumeration the validator enforces
├── sources/
│   └── sources.json                 13 historically reviewed source packets: transcriptions, claims, evidence
├── prompts/
│   └── open-response-items.json     12 open-response items (the prompt set)
├── rubrics/
│   └── rubrics.json                 5 rubrics (one per reasoning operation), allowlisted criteria
├── feedback/
│   └── feedback.json                17 authored, supportive, nonnumeric feedback lines
├── classifier/
│   └── classifier-schema.json       enum-only classifier output schema + 8 adversarial examples
├── archive/
│   └── connections.json             5 Archive Connections cards unlocked by source combinations
├── dialogue/
│   └── npc-followups.json           6 named-NPC follow-up dialogues (max 3 options, spaced)
├── schema/
│   └── open-response-item.schema.json   JSON Schema (Draft-07) for a single item
├── validate/
│   └── validate-content.mjs         isolated Node validator (imports nothing from packages/apps)
└── REVIEW.md                        this document
```

Run validation: `node content/boston/act1/validate/validate-content.mjs`

---

## 2. Item inventory (12 items, at most 4 shown per player)

| Item ID | Operation | Macro | Placement | Prereq sources | Spacing |
|---|---|---|---|---|---|
| `OR.REVENUE_VS_MARKET` | COMPARE | DEBT_POLICY | Sarah/Thomas, Archive | revenue proclamation + Sarah market | 2 |
| `OR.STAMPED_VS_PLAIN` | COMPARE | STAMP_INTERNAL | Pike, Archive | proof compare + stamp schedule | 2 |
| `OR.NONIMPORT_TRANSFER` | TRANSFER | REPRESENTATION | Thomas | non-importation agreement | 2 |
| `OR.WRITS_TRANSFER` | TRANSFER | DEBT_POLICY | Pike | writs/customs | 2 |
| `OR.PIKE_SOURCE_CREDIBILITY` | PERSPECTIVE | STAMP_INTERNAL | Pike | proof + schedule | 2 |
| `OR.CLARKE_LOYALIST` | PERSPECTIVE | REPRESENTATION | Clarke | no-consent broadside + effigy | 3 |
| `OR.ABIGAIL_PRINT_COORDINATION` | PERSPECTIVE | STAMP_INTERNAL | Abigail | printer press | 2 |
| `OR.RIDER_ROUTE_STRATEGY` | STRATEGY | REPRESENTATION | rider | rider network | 2 |
| `OR.POST_EFFIGY_SYNTHESIS` | CAUSAL_SYNTHESIS | REPRESENTATION | Archive | effigy + no-consent | 2 |
| `OR.RUNNER_BALANCE_STRATEGY` | STRATEGY | REPRESENTATION | Archive/rider | rider + writs | 3 |
| `OR.NETWORK_SYNTHESIS` | CAUSAL_SYNTHESIS | REPRESENTATION | Archive | town meeting + rider | 2 |
| `OR.CROWN_CLAIM_VS_LOCAL_SYNTHESIS` | CAUSAL_SYNTHESIS | DEBT_POLICY | Archive | revenue proclamation + wharfage | 2 |

Operation coverage: COMPARE ×2, TRANSFER ×2, PERSPECTIVE ×3, STRATEGY ×2, CAUSAL_SYNTHESIS ×3.
All 12 map to the brief's required prompt set, including the Archive Connections synthesis prompts.

**Bounding:** `act1ExposureCap = 4` in both the manifest and item set. Each item is additionally gated by source prerequisites and a minimum spacing of 2 to 3 committed interactions after the relevant source, so a typical run surfaces only 3 to 4.

---

## 3. Source / rubric / feedback matrix

**Source packets (13):** each binds in-world artifacts/NPCs to a reviewed transcription, typed claims (`DOCUMENTED` / `REPRESENTATIVE` / `INFERENCE`), and citable evidence units. Claims total 31, evidence units 19.

| Packet | Backs | Claim types |
|---|---|---|
| REVENUE_PROCLAMATION | poster + Custom House notice | DOCUMENTED ×2, REPRESENTATIVE |
| STAMP_SCHEDULE | poster + Pike records | DOCUMENTED ×2, REPRESENTATIVE |
| PIKE_STAMPED_PROOF | B3 proof objects | DOCUMENTED, REPRESENTATIVE, INFERENCE |
| NONIMPORTATION_AGREEMENT | poster + Thomas | DOCUMENTED, REPRESENTATIVE (dating flag) |
| NO_CONSENT_BROADSIDE | poster | DOCUMENTED, REPRESENTATIVE |
| TOWN_MEETING_NOTICE | poster | DOCUMENTED, REPRESENTATIVE |
| WHARFAGE_RATES | poster + cargo marks | DOCUMENTED, REPRESENTATIVE |
| SARAH_MARKET | Sarah thread + stall | REPRESENTATIVE, INFERENCE |
| THOMAS_LEDGER | Thomas + ledger | DOCUMENTED, REPRESENTATIVE |
| EFFIGY_OLIVER | effigy + placard + elm | DOCUMENTED ×2, REPRESENTATIVE |
| WRITS_CUSTOMHOUSE | customs counter + watch house | DOCUMENTED ×2, REPRESENTATIVE |
| PRINTER_PRESS | Abigail + type case | DOCUMENTED, REPRESENTATIVE |
| RIDER_NETWORK | rider + tavern + notice | DOCUMENTED, REPRESENTATIVE |

**Rubrics (5), allowlisted criteria only, NO grammar/spelling/length criterion:**

| Rubric | Criteria | Min distinct source packets |
|---|---|---|
| COMPARE | Concept accuracy, Source comparison, Relevant evidence | 2 |
| TRANSFER | Concept accuracy, Transfer reasoning, Relevant evidence | 1 |
| PERSPECTIVE | Perspective fidelity, Concept accuracy, Relevant evidence | 1 |
| STRATEGY | Strategy reasoning, Concept accuracy, Relevant evidence | 1 |
| CAUSAL_SYNTHESIS | Causal reasoning, Source comparison, Relevant evidence | 2 |

**Feedback (17):** STRONG / PARTIAL / MISSING per operation (15) plus generic OFF_TOPIC and UNCLASSIFIED. Every entry `authored=true`, supportive, and nonnumeric. The classifier can only emit allowlisted labels; it can never produce display text.

---

## 4. Classifier and safety model

- Output is strictly enumerated (`classifier-schema.json`, `additionalProperties:false`): topicality, per-criterion levels, evidence IDs, and technical confidence. No free-text, chain-of-thought, display numbers, or feedback strings.
- Deterministic resolution: criterion levels derive `STRONG_RESPONSE`, `PARTIAL_RESPONSE`, or `NEEDS_SOURCE_REVISIT`; topicality derives `OFF_TOPIC` or `ABSTAINED`; unknown labels/evidence, malformed output, `LOW` confidence on an on-topic response, timeout, or policy denial resolve to `UNCLASSIFIED`.
- 8 adversarial examples cover prompt injection, unknown label, unknown evidence, blank, honest non-answer, free-text-feedback attempt, provider timeout, and low confidence.
- Every item carries a deterministic offline fallback (authored feedback + a non-graded Archive activity) so provider outage or a local profile never blocks the story.

---

## 5. Validation results

`node content/boston/act1/validate/validate-content.mjs` → **RESULT: PASS (0 hard errors, 0 blockers, 0 warnings).**

Checks enforced and passing:

- Unique IDs across items, prompts, packets, claims, evidence, rubrics, feedback, cards, dialogue.
- Known concepts (macro/micro against the allowlist mirroring `@pa/contracts`).
- Known sources (backing refs in the asset registry; item source packets resolve).
- 2+ distinct evidence sources for COMPARE and CAUSAL_SYNTHESIS items.
- No unsupported claims: every cited claim/evidence ID resolves to the referenced packet; inference/representative claims carry notes and item-level `inferenceNote`.
- Forbidden score/mastery language absent from all player-facing and educator-label text.
- Response length within 35 to 90 words (min < max).
- No em dash in player-facing text.
- No prompt fires immediately after a source (minSpacing ≥ 2).
- No raw model feedback: all feedback `authored=true`; classifier schema is enum-only with no text field.
- Rubric criteria allowlisted; no grammar/spelling/length criterion anywhere.
- Package never claims SME approval (forbidden approval statuses absent; `approvedBy` null).
- Act 1 exposure cap present and ≤ 4.

---

## 6. Review blockers and open questions (for SME / historical review)

These do not block the systems build; they block flipping any status to approved.

1. **Non-importation dating (highest priority).** `NONIMPORTATION_AGREEMENT` claim 2 carries a dating flag: a signed, widely subscribed Boston non-importation agreement is best documented in 1767 to 1770. The 1765-dated signed sheet compresses this for the Act 1 setting. SME to confirm whether to soften the artifact to "emerging in 1765" wording. The transfer item (`OR.NONIMPORT_TRANSFER`) does not depend on the exact date.
2. **Citation confirmation.** All `DOCUMENTED` claims carry `citationHint`s (for example Stamp Act 1765, 5 Geo. III c. 12; Otis 1761 writs challenge; Oliver effigy Aug 14 to 15, 1765). SME to verify exact references and grade-level framing. No external URLs were fabricated.
3. **TEKS tags.** All are placeholders (draft, unconfirmed) pending the Grade 8 adoption confirmation already flagged in `Act-1-Micro-Concepts.md`.
4. **Representative artifacts.** Every poster/broadside is a plausible period reconstruction, not a transcription of a specific surviving document; flagged `REPRESENTATIVE` so educator-facing citations can say so.
5. **Perspective vs. endorsement.** `OR.CLARKE_LOYALIST` requires the student to state that they are voicing Clarke's view, not endorsing it. SME to confirm the framing reads as intended for the target grade.

---

## 7. Integration mapping (for the runtime/API/web workers)

This package is data. It maps onto the accepted plan's integration surfaces as follows, but authors none of them:

| This package | Consumed by (owned by another worker) |
|---|---|
| `prompts/open-response-items.json` | open-response contracts in `packages/contracts/src/openResponse.ts`; item selection in the assessment runtime |
| `rubrics/rubrics.json` | `content/boston/rubrics/` loader + `packages/runtime/src/assessment/rubricResolver.ts` |
| `sources/sources.json` | `content/boston/sources/` + the shared historical-source registry derived from `interiorSources.ts` |
| `classifier/classifier-schema.json` | grading provider adapter under `apps/api/src/grading/`; strict structured output |
| `feedback/feedback.json` | authored feedback selection in the resolver; `OpenResponsePanel.tsx` display (authored text only) |
| `archive/connections.json` | Archive "Connections" section unlock logic in `ArchiveOverlay.tsx` |
| `dialogue/npc-followups.json` | reactive NPC follow-up definitions (runtime-owned registry, e.g. `reactive.ts`) |
| `allowlists.json` | shared allowlists the resolver validates model output against |

**ID conventions** intentionally mirror the existing `BOS.*` / `MICRO.*` / `RCC.*` schemes in `@pa/contracts` (`assessment.ts`, `field.ts`, `ids.ts`) so wiring is a lookup, not a translation. Concept and micro IDs are duplicated into `allowlists.json` only so the validator runs without importing runtime code.

**Boundaries respected:** no edits to any existing tracked file; all output is new, additive content under `content/boston/act1/`. Uncommitted work elsewhere in the tree is untouched.
