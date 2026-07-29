import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import {
  TARGET_MODULE_SECONDS,
  moduleConceptIds,
  moduleDefinitionDefects,
  type LearningModuleDefinition,
} from "../src/module/moduleFormat.js";
import {
  moduleSegments,
  reteachConcepts,
  understoodConcepts,
  remediationDeck,
  remediationCoherenceDefects,
  remediationResidualReferents,
  type ModuleConceptVerdict,
} from "../src/module/moduleOrder.js";

// The remediation subset slice (inert). Proves: the teach-everything default on
// absent/ungraded evidence, correct concept-addressable subsets, the coherence
// gate that refuses an incoherent subset, and — the load-bearing one — that an
// outage-granted "correct" is never evidence, so its concept is still re-taught.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;
const POSTWAR = "BOS.CONCEPT.POSTWAR_REVENUE.v1";
const STAMP = "BOS.CONCEPT.STAMP_SCOPE.v1";
const REP = "BOS.CONCEPT.REPRESENTATION.v1";
const ALL = [POSTWAR, STAMP, REP];

/** Graded rounds crediting exactly the named concepts (all correct, all graded). */
function gradedCorrect(...concepts: string[]): ModuleConceptVerdict[] {
  return concepts.map((conceptId) => ({ conceptId, verdict: "CORRECT", graded: true }));
}

/** The concept card teaching one concept (not a frame, not the synthesis). */
function conceptCard(definition: LearningModuleDefinition, conceptId: string) {
  const deckConceptCount = moduleConceptIds(definition).length;
  return definition.cards.find(
    (c) =>
      c.conceptIds.length > 0 &&
      c.conceptIds.length < deckConceptCount &&
      c.conceptIds.includes(conceptId),
  )!;
}

const SYNTHESIS = M1.cards.find((c) => c.conceptIds.length === ALL.length)!;
const FRAMES = M1.cards.filter((c) => c.conceptIds.length === 0);

/** Every proper, non-empty reteach set over the three concepts. */
const PROPER_SUBSETS: string[][] = [
  [POSTWAR],
  [STAMP],
  [REP],
  [POSTWAR, STAMP],
  [POSTWAR, REP],
  [STAMP, REP],
];

test("moduleSegments classifies frames, concept segments and synthesis", () => {
  const seg = moduleSegments(M1);
  assert.equal(seg.frames.length, 2, "IDENTITY + INSERT are frames");
  assert.equal(seg.conceptSegments.length, 3, "three one-concept cards");
  assert.equal(seg.synthesis.length, 1, "one all-concepts synthesis");
});

// ---- The load-bearing default: absent/ungraded evidence teaches everything. --
test("no evidence returns the full authored deck unchanged", () => {
  assert.equal(remediationDeck(M1, undefined), M1);
  assert.equal(remediationDeck(M1, []), M1);
});

test("all-correct (graded) evidence returns the full deck (nothing to narrow)", () => {
  assert.equal(remediationDeck(M1, gradedCorrect(...ALL)), M1);
});

test("all-GRANTED evidence teaches everything: an outage credits nothing", () => {
  // Every concept "correct" but from an outage grant (graded: false). None counts,
  // so reteach is the whole set and the full deck comes back.
  const granted = ALL.map((conceptId) => ({ conceptId, verdict: "CORRECT", graded: false }));
  assert.deepEqual([...understoodConcepts(granted)], []);
  assert.equal(remediationDeck(M1, granted), M1);
});

test("a concept whose only 'correct' was an outage grant is still re-taught", () => {
  // POSTWAR credited by an outage only; STAMP and REP genuinely graded-correct.
  const rounds: ModuleConceptVerdict[] = [
    { conceptId: POSTWAR, verdict: "CORRECT", graded: false },
    ...gradedCorrect(STAMP, REP),
  ];
  assert.ok(!understoodConcepts(rounds).has(POSTWAR), "outage grant is not understanding");
  assert.deepEqual([...reteachConcepts(M1, rounds)], [POSTWAR]);
  const subset = remediationDeck(M1, rounds)!;
  assert.notEqual(subset, M1, "a proper subset is built");
  const ids = subset.cards.map((c) => c.id);
  assert.ok(ids.includes(conceptCard(M1, POSTWAR).id), "the outage concept is re-taught");
  assert.ok(!ids.includes(conceptCard(M1, STAMP).id), "an understood concept is dropped");
});

test("any graded-wrong round disqualifies a concept even with a graded-correct", () => {
  const rounds: ModuleConceptVerdict[] = [
    { conceptId: POSTWAR, verdict: "CORRECT", graded: true },
    { conceptId: POSTWAR, verdict: "WRONG", graded: true },
    ...gradedCorrect(STAMP, REP),
  ];
  assert.ok(!understoodConcepts(rounds).has(POSTWAR), "asked twice, right once is not mastery");
  assert.ok(reteachConcepts(M1, rounds).has(POSTWAR));
});

test("an absent `graded` flag counts as graded (legacy rounds still credit)", () => {
  const rounds: ModuleConceptVerdict[] = ALL.map((conceptId) => ({ conceptId, verdict: "CORRECT" }));
  assert.deepEqual([...understoodConcepts(rounds)].sort(), [...ALL].sort());
});

// ---- Concept-addressable subsets over every proper reteach set. --------------
test("every proper reteach set produces a correct, coherent subset", () => {
  for (const reteach of PROPER_SUBSETS) {
    const understood = ALL.filter((c) => !reteach.includes(c));
    const subset = remediationDeck(M1, gradedCorrect(...understood))!;
    assert.notEqual(subset, M1, `${reteach.join("+")}: a subset is built`);
    const ids = new Set(subset.cards.map((c) => c.id));

    // Exactly the reteach concept cards are present; understood ones are dropped.
    for (const conceptId of reteach) {
      assert.ok(ids.has(conceptCard(M1, conceptId).id), `${reteach}: ${conceptId} present`);
    }
    for (const conceptId of understood) {
      assert.ok(!ids.has(conceptCard(M1, conceptId).id), `${reteach}: ${conceptId} dropped`);
    }
    // Both frames are always present (the bookends).
    for (const frame of FRAMES) assert.ok(ids.has(frame.id), `${reteach}: frame ${frame.id}`);
    // Synthesis only when two or more concepts are retaught.
    assert.equal(ids.has(SYNTHESIS.id), reteach.length >= 2, `${reteach}: synthesis rule`);

    // The subset is a PLAYBACK object: it is coherent, but it is deliberately no
    // longer 180s — that is the one authored-module defect it is allowed to have.
    assert.deepEqual(remediationCoherenceDefects(M1, subset), [], `${reteach}: coherent`);
    const defects = moduleDefinitionDefects(subset);
    assert.ok(
      defects.every((d) => /180s|exactly/.test(d)),
      `${reteach}: only the 180s total may fail, got: ${defects.join("; ")}`,
    );
    assert.notEqual(subset.cards.at(-1)!.throughSeconds, TARGET_MODULE_SECONDS);
    // The first card is a frame, so card 0's ESTABLISH shot frames the room.
    assert.equal(subset.cards[0]!.conceptIds.length, 0, `${reteach}: opens on a frame`);
  }
});

test("subset windows travel with their cards (durations preserved, contiguous)", () => {
  const subset = remediationDeck(M1, gradedCorrect(STAMP, REP))!; // reteach = POSTWAR
  const authoredDuration = (id: string) => {
    let prev = 0;
    for (const c of M1.cards) {
      const d = c.throughSeconds - prev;
      prev = c.throughSeconds;
      if (c.id === id) return d;
    }
    return 0;
  };
  let prev = 0;
  for (const card of subset.cards) {
    const d = card.throughSeconds - prev;
    prev = card.throughSeconds;
    assert.equal(d, authoredDuration(card.id), `${card.id} keeps its authored duration`);
    assert.ok(card.throughSeconds > 0);
  }
});

// ---- The coherence gate refuses an incoherent subset (detect + refuse). ------
test("coherence gate flags a subset that opens on a concept card", () => {
  const bad: LearningModuleDefinition = {
    ...M1,
    cards: [conceptCard(M1, STAMP), FRAMES[FRAMES.length - 1]!],
  };
  assert.ok(remediationCoherenceDefects(M1, bad).some((d) => /opens on|ESTABLISH/i.test(d)));
});

test("coherence gate flags a synthesis card with fewer than two concepts", () => {
  const bad: LearningModuleDefinition = {
    ...M1,
    cards: [FRAMES[0]!, conceptCard(M1, POSTWAR), SYNTHESIS, FRAMES[FRAMES.length - 1]!],
  };
  assert.ok(remediationCoherenceDefects(M1, bad).some((d) => /synthesis/i.test(d)));
});

test("coherence gate flags a check gating on a dropped concept", () => {
  // A frame whose (illegitimate) check names a concept no included card teaches.
  const frameWithCheck = {
    ...FRAMES[0]!,
    check: {
      id: "T.DANGLING",
      prompt: "p",
      reinforcement: "r",
      conceptId: STAMP,
      options: [
        { id: "a", text: "a", correct: true, feedback: "f" },
        { id: "b", text: "b", correct: false, feedback: "f" },
        { id: "c", text: "c", correct: false, feedback: "f" },
      ],
    },
  };
  const bad: LearningModuleDefinition = {
    ...M1,
    cards: [frameWithCheck, conceptCard(M1, POSTWAR), FRAMES[FRAMES.length - 1]!],
  };
  assert.ok(remediationCoherenceDefects(M1, bad).some((d) => /gates on|no included card/i.test(d)));
});

// ---- Residual narration referents are DETECTED (non-fatal, reported). --------
test("dropping POSTWAR detects STAMP's back-reference to 'the tax'", () => {
  const subset = remediationDeck(M1, gradedCorrect(POSTWAR))!; // reteach = STAMP, REP
  const referents = remediationResidualReferents(M1, subset);
  assert.ok(
    referents.some((r) => r.includes(conceptCard(M1, STAMP).id)),
    `expected a residual-referent finding for STAMP, got: ${referents.join(" | ")}`,
  );
});

test("no residual referent is reported when no earlier concept card was dropped", () => {
  // reteach = STAMP, REP (POSTWAR understood) drops the FIRST concept card, so a
  // referent is expected above. Here reteach = POSTWAR alone drops the LATER
  // cards; POSTWAR has nothing earlier dropped, so it must not be flagged.
  const subset = remediationDeck(M1, gradedCorrect(STAMP, REP))!; // reteach = POSTWAR
  const referents = remediationResidualReferents(M1, subset);
  assert.ok(!referents.some((r) => r.includes(conceptCard(M1, POSTWAR).id)));
});
