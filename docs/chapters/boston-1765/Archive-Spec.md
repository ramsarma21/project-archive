# Boston — The Archive as Orchestrator (consolidated spec)

**Status: the single authority for everything the Archive does across the Boston chapter.** The Archive is the game's cheapest, most flexible teaching instrument — deterministic text + UI, no expensive assets or runtime generation — so it's the **orchestrator** that binds the world's learning together *without* becoming dialogue spam. This doc consolidates its roles (previously scattered across `Gameplay-Design`, `Concept-Delivery-Map`, `Interaction-Spec`, and `Project-Archive-v3` §16-22) into one governed system.

**Governing principle:** the Archive is **powerful but rationed.** It does the cheap, high-leverage jobs (framing, bridging, assessing, remembering) and *defers to the world* for delivery. Every role below is capped by the **annoyance budget** (§8). If a lesson can land in the world (mechanic, lore, event), the Archive stays silent; it speaks only to *frame, bridge, assess, or remember*.

**Existing surface:** `apps/web/src/presenter/ArchiveOverlay.tsx` (tabs `TODAY/PEOPLE/THREADS/NOTES/ROUTES`, `StandingCard`); mastery = `MasteryPanel.tsx`; state = `@pa/contracts`. This doc specs behavior, not new UI chrome.

---

## 1. The seven roles (one table)

| # | Role | When it fires | What it does | Cost tier |
|---|---|---|---|---|
| R1 | **Narrator / stage-setter** | CP0 intake; each Act re-insertion (year-jump) | sets time/place/stakes in 2-4 lines; the *only* place a "cutscene-ish" frame is default | cheap |
| R2 | **Director** | idle/lost; spine drift | soft nudge toward the *spine* (never spoils optional); the guardrail for a 13-year-old | cheap |
| R3 | **Routes reminder** | approaching a stretch you have an owned bypass for | one clause surfacing an *earned* capability (*"You know a back lane that skips this."*) | cheap |
| R4 | **Decision-frame** | at a **state-moving** choice | one clause posing the historical consideration — never the answer (*"(Clarke reports what he sees.)"*) | cheap |
| R5 | **Reinforcer / bridge** | after a mechanic that taught a *feeling* but not the *label* | names the vocabulary the world just delivered implicitly (*"those searches were 'writs of assistance.'"*) | cheap |
| R6 | **Assessor / mastery gate** | checkpoints (CP0-CP4) | Archive Sync: STAAR-format items on macro + engaged micro; the mastery gate w/ escalating-friction hints | medium |
| R7 | **Hint engine** | on an incorrect gate answer, or an explicit "help" | memory-cued recall drawn from *this student's* provenance, escalating to elimination | medium |
| — | **Codex / logs** | player-opened overlay | passive reference: `TODAY/PEOPLE/THREADS/NOTES/ROUTES` | free |

---

## 2. R1 — Narrator / stage-setter

- **Where:** CP0 (day intake) and the four Act re-insertions (`Gameplay-Design` §1 — the year-jumps between Acts *are* the checkpoints).
- **Behavior:** 2-4 authored lines establishing year, place, what changed since last Act, and the day's frame. This is the Archive's one *default-narrative* license — everywhere else the world leads.
- **Learning:** frames the era's throughline (the "spiral" patterns) so the student carries a mental model between Acts.
- **Build:** the `TODAY` pane header + intake sequence; deterministic text keyed to Act.

## 3. R2 — Director (soft guidance, never spoiler)

- **Fires:** on idle/lost detection (`Interaction-Spec` §1 guardrail) or measurable spine drift.
- **Behavior:** points at the **spine** objective only (gold marker in `TODAY`), in-fiction and gentle; **never** reveals optional Threads/Challenges/lore. It rescues a stuck kid without flattening discovery.
- **Rule:** escalating patience — a first nudge is ambient; only sustained idling gets an explicit pointer.

## 4. R3 — Routes reminder (earned-capability surfacing)

- **Fires:** when the player approaches a watched/blocked stretch for which they hold an **owned route** (`Quests-and-NPCs.md` §2A — back-lanes, roofs, dock gate, scaffold shortcut).
- **Behavior:** one optional clause naming the capability they earned; it never hands over a route not yet discovered, and it defers if heat/assessment isn't relevant.
- **Why it's Archive-appropriate:** it rewards prior exploration by making earned knowledge *legible at the moment of use* — the cheap connective tissue of the alive world.

## 5. R4 — Decision-frame (the anti-"pick-risky-for-fun" role)

- **Fires:** at a choice the world *remembers* (moves relationships/heat/Standing/routes). Not on flavor choices.
- **Behavior:** a subtle, skippable, one-clause **frame before** (poses the historical cause→effect the choice hinges on; often POV-based) and, if needed, a **bridge after** (see R5). Never says "don't," never gives the correct answer.
- **Effect:** turns risk into a *historically-grounded gamble with real consequences* — simultaneously a learning delivery (cause→effect, `MICRO.LOYALIST_VIEW` and the pattern SEs) and the thing that makes choices meaningful.
- **Examples:** *"(A boycott only bites if the town holds together.)"* · *"(The watch remembers faces.)"* · *"(Clarke's a Loyalist — he reports what he sees.)"*

## 6. R5 — Reinforcer / implicit→explicit bridge

- **Fires:** after a mechanic that delivered a *feeling* the world won't label on its own (search → "writs of assistance"; boycott choice → "non-importation"; ferry secrecy → "why the Sons of Liberty worked covertly").
- **Behavior:** one line, tied to the concrete action just taken, inside the annoyance budget. **Never a lecture, never a substitute for the mechanic.**
- **Dual-delivered patterns:** the highest-STAAR-value patterns get *both* gameplay and this light Archive safety net (`Concept-Delivery-Map`).

## 7. R6 — Assessor / the mastery gate (Archive Sync)

- **Where:** checkpoints CP0-CP4 (year-jumps). CP1 is the Act-1 debrief.
- **Content:** **always** the 3 macro concepts + **a sample of engaged micros only** (fairness rule — never test what the world didn't show this student, `Micro-Concepts` §4); CP2-CP4 add **spaced retrieval** from prior Acts' engaged sets.
- **Format:** authored, SME-approved, TEKS-tagged STAAR-format items, selected deterministically from the versioned bank (never model-generated — FR-8).
- **The gate (locked behavior):** on an incorrect answer, the student is **never** hard-failed and never bounced back to a world beat. Instead:
  1. **Memory-cued hint** (R7) — drawn from their provenance.
  2. If still wrong → **explicit hint** (states the principle in different words).
  3. If still wrong → **eliminate one distractor**, repeat until **one answer remains** and they pass.
  - Each step adds **deliberate friction** — a required read + a growing pause — so brute-forcing is *slow and unrewarding*, and a hint-heavy pass yields a **lower Understanding/Standing score** (real but bounded stakes). Passing is guaranteed; passing *well* is earned.
- **Cost note:** this is the Archive's most "expensive" role in attention — hence gated to checkpoints, not sprinkled mid-play.

## 8. R7 — Hint engine (memory-cued, provenance-drawn)

- **Source of truth:** the ledger's **provenance log** (`ledger` spec) — every exposure records not just *that* a concept was contacted but *which world moment* delivered it to *this* student.
- **Behavior:** the first hint is always a **memory cue**, not the answer: *"Remember the schedule nailed by the town pump — what did it say needed a stamp?"* It spurs recall from lived experience. Only if recall fails does it escalate (explicit → elimination, per R6).
- **Rule:** it can only cue moments the student actually engaged — so hints feel personal and fair, and reward having explored.

## 9. Codex / logs (passive)

`TODAY` (spine + soft hints) · `PEOPLE` (the 5 named, 4-axis + Standing) · `THREADS` (soft breadcrumbs, no waypoints) · `NOTES` (concepts contacted) · `ROUTES` (owned shortcuts). All passive reference, player-opened, zero push.

---

## 10. The annoyance budget (the governing constraint)

The Archive's power is capped so it never nags:

- **Silence is the default.** A role speaks only if its trigger is *live* and the world hasn't already covered it.
- **Priority ladder (only one Archive voice at a time):** R6 gate > R2 director rescue (lost kid) > R4 decision-frame > R5 bridge > R3 route reminder > R1 narration. Lower priority yields.
- **Frequency caps:** decision-frames and bridges are rate-limited per segment; a concept gets **one** bridge, not repeats. Route reminders fire once per approach, not per step.
- **Dial-able:** a settings toggle can reduce Archive chatter to gate-only (accessibility + player preference).
- **Never mid-skill:** the Archive stays quiet during active traversal/stealth execution; it speaks at entry (frame) or exit (bridge), never over the input.
- **Test:** if two consecutive Archive lines fire without a player action between them, that's a budget violation.

## 11. Why this is the cost-efficient orchestrator

- **Cheap to build/run:** deterministic authored text + existing overlay UI; no Meshy/Blender, no runtime LLM in the assessment path (FR-8).
- **Flexible:** the same instrument narrates, frames, bridges, assesses, and remembers — so we spend expensive world-building only where embodiment matters, and let the Archive net the rest.
- **Bounded:** the annoyance budget guarantees it enhances rather than dominates — the world does the teaching; the Archive does the *connecting*.

## 12. Build hooks & open items

- **Build:** extend `ArchiveOverlay` role-panes; a small `ArchiveDirector` runtime module owns the priority ladder + budget counters; gate/hint logic reads the ledger provenance + engaged-micro set; STAAR bank selection is deterministic.
- **Locked decisions (2026-07-21):**
  1. **Gate friction constants** — per wrong attempt: attempt 1 → memory-cue hint (R7), 3s min read-dwell before the answer re-enables + 2s pause; attempt 2 → explicit hint, 4s dwell + 4s pause; attempt 3+ → eliminate one distractor each, 5s dwell + 6s pause, until one answer remains → forced-correct. Pause grows +2s (cap 8s). Effect: each wrong answer costs ~6-11s of enforced friction, so brute-forcing is slow and dull, but passage is guaranteed.
  2. **Understanding/Standing penalty curve** — clean (0 hints) → `UNDERSTOOD` + small Standing bonus; 1 hint (memory cue) → `UNDERSTOOD`, no bonus; ≥2 hints → passes the gate but sets `pendingReexposure` (spaced re-test next CP) and a small Standing ding. Passing is never blocked; passing *well* is earned. Uses the existing `firstUnderstandingAttemptCount` + `pendingReexposure` fields.
  4. **Dial-able chatter** — three levels: `FULL` (all 7 roles), `STANDARD` (default — R1/R2/R6/R7 always on; R3/R4/R5 rate-limited per §10), `GATE_ONLY` (R6/R7 + R2 rescue only). Default = `STANDARD`.
- **Deferred to SME/content (not a blocker for systems build):**
  3. Author the **STAAR bank** (1-2 items/macro, 1/micro; 2 difficulty variants/macro) — SME-approved, versioned, deterministic selection.
