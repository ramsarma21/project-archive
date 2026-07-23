# Boston — Learning Ledger & Contract Extension

**Status: the spec for scaling the existing learning-state model to the full Boston chapter** (23 assessed SEs + ~14 micros/Act) and for the two capabilities the new design needs: **provenance logging** (so the Archive can give memory-cued hints) and a **two-track concept classification** (gated facts vs. patterns vs. micros). All changes are **additive and backward-compatible** with `@pa/contracts`.

**Grounding:** the current model lives in `packages/contracts/src/state.ts` and `teks.ts`; mastery UI in `apps/web/src/presenter/MasteryPanel.tsx`; heat/Standing/Threads/Routes persistence landed in M0 (`apps/web/src/world/M0-INTEGRATION-HANDOFF.md`). Consumers: the Archive orchestrator (`Archive-Spec.md` R6/R7), the CP debrief (`Micro-Concepts.md` §4), the delivery model (`Concept-Delivery-Map.md`).

---

## 1. What exists today (and its limits)

```ts
// state.ts (current)
type ExposureType = "SCENE" | "CONVERSATION" | "ARTICLE" | "HANDS_ON";
interface ExposureRecord { exposureId: string; type: ExposureType; interactionOrdinal: number; }
interface ConceptLearningState {
  exposures: ExposureRecord[]; distinctOccasionCount: number; exposureTypes: ExposureType[];
  learningGate: "NOT_READY" | "READY";
  understanding: "NOT_ASSESSED" | "REEXPOSURE_REQUIRED" | "RETRY_PENDING" | "UNDERSTOOD";
  firstUnderstandingAttemptCount: number;
  pendingReexposure: ReexposureObligation | null;
  notesAddedTransactionId: string | null;
  demonstration: "LOCKED" | "PENDING" | "DEMONSTRATED";
  priorDayReassessment: "NOT_DUE" | "DUE" | "DONE";
  misconceptionIds: string[];
}
type LearnerState = Record<ConceptId, ConceptLearningState>;
```

This is a **mature, well-designed lifecycle** (exposure → gate → understanding → demonstration → reassessment) — but it was authored for **Day 1's three macro concepts**. Two gaps for the new design:

1. **No provenance.** `ExposureRecord` knows the *type* (ARTICLE) and *when* (ordinal) but not *which world moment* ("the stamp schedule at the notice board"). The Archive's memory-cued hints (R7) need that.
2. **No concept tier / SE linkage on the state.** Every concept is treated identically. The chapter now has three *classes* (gated fact / pattern / micro-enrichment) and 23 SEs with `ONCE`/`SPIRAL` recurrence — the runtime needs to know a concept's class to route it correctly (full gate vs. Archive-light vs. debrief-sample-only).

Everything else (the lifecycle machine, reexposure, misconceptions) **stays exactly as is** and simply operates over more concepts.

---

## 2. Extension A — provenance on exposures

Add an optional provenance descriptor to `ExposureRecord` (additive; existing writers keep working):

```ts
interface ExposureProvenance {
  sourceId: string;        // e.g. "LORE-noticeboard", "MECH-search", "NPC-pike", "B11"
  sourceKind: "LORE" | "MECHANIC" | "NPC" | "EVENT" | "SIDEJOB" | "EAVESDROP_TRACKED";
  label: string;           // authored recall cue: "the stamp schedule nailed by the town pump"
  zone?: string;           // "Z4" — optional spatial anchor
}
interface ExposureRecord {
  exposureId: string;
  type: ExposureType;
  interactionOrdinal: number;
  provenance?: ExposureProvenance;   // NEW, optional
}
```

- **Written by:** every tracked surface — Found-History focus-reads (`Environmental-Lore.md` §4), mechanic completions (`Mechanics-Spec.md`), NPC/side-job finishes, the fixed event. The `sourceId` is the same id used in `World-Content.md`, so provenance is a stable cross-reference.
- **Read by:** the Archive hint engine (R7) — the first hint on a wrong answer is built from the `label` of an exposure this student actually has (*"Remember {label}?"*). No provenance for a concept → the Archive falls back to a generic explicit hint (never fabricates a memory).
- **Fairness:** provenance is *per student* — the hint can only cue moments they engaged. This is the technical backbone of "never test/hint what the world didn't show them."

## 3. Extension B — concept classification (two-track + SE linkage)

Concepts are static content, so classification lives in the **content package / concept registry** (`teks.ts` neighborhood), not in per-student state:

```ts
type ConceptClass =
  | "MACRO_GATED"      // required spine carrier; full lifecycle + demonstration (the 3 macros, Boston gated facts)
  | "PATTERN"          // thematic/spiral; taught by mechanics; dual-delivered ones get a light Archive bridge
  | "MICRO";           // enrichment; engaged-only; debrief-sampled, never gates

type Recurrence = "ONCE" | "SPIRAL";   // ONCE = event-anchored/Boston-specific; SPIRAL = reinforced across chapters

interface ConceptMeta {
  conceptId: ConceptId;
  class: ConceptClass;
  recurrence: Recurrence;
  seIds: string[];              // STAAR SE codes, e.g. ["8.4A"]
  chapterOwner: string;         // "BOSTON" | "PHILADELPHIA" | ...  (per Curriculum-World-Map)
  archiveSafetyNet?: boolean;   // true for dual-delivered high-STAAR patterns (R5 bridge allowed)
}
type ConceptRegistry = Record<ConceptId, ConceptMeta>;
```

- **Routing rule the runtime applies:**
  - `MACRO_GATED` → full existing lifecycle; **must** reach `DEMONSTRATED`; appears in every CP debrief.
  - `PATTERN` → taught by a mechanic; lifecycle runs but demonstration is via *gameplay*; Archive bridge (R5) only if `archiveSafetyNet`.
  - `MICRO` → lifecycle runs lightly; **engaged-only** (see §4); debrief-sampled as bonus, never pass/fail.
- **Scale target (Act 1 / Boston):** 3 macros + the Boston gated facts + the pattern SEs + ~14 micros. The full 23-SE ownership and `ONCE`/`SPIRAL` tags come from `STAAR-Coverage-Map.md` / `Curriculum-World-Map.md` — this registry is where those tags become runtime-legible.

## 4. Extension C — the engaged set (fair debrief sampling)

The CP debrief samples micros **only if the student engaged them.** Derive an engaged set rather than adding bespoke state:

```ts
// A concept is "engaged" iff it has ≥1 ExposureRecord from a TRACKED source.
function engagedConcepts(state: LearnerState, registry: ConceptRegistry): ConceptId[] {
  return Object.entries(state)
    .filter(([_, s]) => s.exposures.length > 0)
    .map(([id]) => id as ConceptId);
}
```

- **CP1 debrief =** all `MACRO_GATED` (always) + a deterministic sample of **engaged `MICRO`** (bonus framing).
- **CP2-CP4 =** the above + **spaced retrieval** from prior Acts' engaged sets (uses `priorDayReassessment`, already in the contract).
- **Determinism:** sampling is seeded (existing seed policy, `Localhost-Text-Slice-Spec` §17) so a given student's debrief is reproducible.

## 5. What does NOT change

- The lifecycle state machine (gate → understanding → demonstration → reexposure) — unchanged; it just runs over more `ConceptId`s.
- `misconceptionIds`, `ReexposureObligation`, `priorDayReassessment` — reused as-is (spaced retrieval leans on them).
- Heat / Standing / Threads / Routes — already persist (M0); this doc doesn't touch them. Owned-route flags and the boycott flag live beside them per their own specs.
- The STAAR bank is **authored/approved content** (FR-8) — the ledger *selects*, never generates.

> **Where state actually landed (as built).** `LearnerState` owns *only* the concept-learning lifecycle (exposures, gate, understanding, demonstration, reassessment, misconceptions). The reactive-world state — **micro engagement, Standing, heat, and threads** — lives in `FieldDurableState` (`packages/contracts/src/field.ts`, projected/reduced by `packages/runtime/src/fieldState.ts`), **not** in `LearnerState`. Consequently **assessment (Archive Syncs and checkpoint debriefs) applies no Standing bonus or ding — by design**: Standing is built only by tracked unnamed-crowd interactions and side-jobs, and it never moves as a function of an answer being right or wrong.

## 6. Build order & open items

- **Build:** (1) add optional `provenance` to `ExposureRecord` + thread it through the tracked-read/mechanic-completion writers; (2) add the `ConceptRegistry` to the content package and the routing switch; (3) implement `engagedConcepts` + seeded debrief sampling; (4) wire R7 hints to read `provenance`. All additive; existing Day-1 tests stay green.
- **Locked decisions (2026-07-21):**
  2. **Provenance `label`** authoring lives in the **localhost text slice** (it's recall-cue copy, authored alongside inspect/dialogue text).
  3. **Engaged = "≥1 tracked exposure"** (not requiring `learningGate = READY`). Micros are enrichment; we sample fairly from anything the student actually touched. (`READY`/demonstration gating remains for `MACRO_GATED` understanding only.)
  1. **Default `ConceptClass` assignment** (SME to ratify final SE codes, not a systems blocker):
     - `MACRO_GATED` = the 3 macros + Boston event/fact anchors: Stamp schedule + what-counts, Boston Massacre event, Tea Party event, writs of assistance, Andrew Oliver/effigy, Lexington & Concord.
     - `PATTERN` = mercantilism, non-importation/free-markets, representation, oppression/grievances, points-of-view, port-geography→economy, news-networks→committees, women's contributions. `archiveSafetyNet = true` for the four highest-STAAR patterns: **mercantilism, representation, non-importation, oppression/grievances**.
     - `MICRO` = the 14 enrichment concepts in `Micro-Concepts.md`.
