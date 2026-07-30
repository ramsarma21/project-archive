import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import {
  TARGET_MODULE_SECONDS,
  moduleCardWindows,
  moduleDefinitionDefects,
  moduleTargetSeconds,
} from "../src/module/moduleFormat.js";
import { moduleRunIsComplete } from "../src/module/moduleGate.js";
import {
  EMPTY_MODULE_KNOWLEDGE,
  knowledgeForMission,
  missedConceptTally,
  recordMissionKnowledge,
  retryOrderedModule,
  type ModuleConceptVerdict,
} from "../src/module/moduleOrder.js";

// Retry ordering. The module still runs in full before every attempt — these are
// about WHICH card a student who just lost reads first, and about the three
// things the reorder is not allowed to disturb on the way: the cue set the gate
// checks, the module id the completion names, and the three minutes.
//
// The 1774 deck is six cards: identity(frame), the four case files (closure and
// acts on INTOLERABLE_ACTS, consent on REPRESENTATION, answer on MERCANTILISM),
// and the handoff brief(frame). The two frames teach no concept and are pinned;
// the four case files permute by what the last attempt missed. There is no
// synthesis card teaching all three concepts, so nothing is pinned for that
// reason — the one source excerpt rides an ordinary case file (the answer).

if (!M1_CONTENT.ok) {
  throw new Error(
    `content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`,
  );
}
const M1 = M1_CONTENT.definition;

const INTOLERABLE = "BOS.CONCEPT.INTOLERABLE_ACTS.v1";
const REPRESENTATION = "BOS.CONCEPT.REPRESENTATION.v1";
const MERCANTILISM = "BOS.CONCEPT.MERCANTILISM.v1";

/** The duel's report, narrowed to what ordering reads. */
function asked(
  ...rounds: readonly (readonly [string, "CORRECT" | "WRONG"])[]
): ModuleConceptVerdict[] {
  return rounds.map(([conceptId, verdict]) => ({ conceptId, verdict }));
}

/** Six rounds, two per concept, all correct. A duel won on knowledge. */
function everythingRight(): ModuleConceptVerdict[] {
  return asked(
    [INTOLERABLE, "CORRECT"],
    [INTOLERABLE, "CORRECT"],
    [REPRESENTATION, "CORRECT"],
    [REPRESENTATION, "CORRECT"],
    [MERCANTILISM, "CORRECT"],
    [MERCANTILISM, "CORRECT"],
  );
}

function kickers(definition: { cards: readonly { kicker: string }[] }): string[] {
  return definition.cards.map((card) => card.kicker);
}

const AUTHORED_ORDER = kickers(M1);

// ---------------------------------------------------------------------------
// When the deck must not move
// ---------------------------------------------------------------------------

test("a first attempt reads the authored order", () => {
  // No prior attempt, so no evidence. The authored sequence is the default and
  // the definition comes back untouched rather than rebuilt.
  assert.equal(retryOrderedModule(M1, undefined), M1);
  assert.equal(retryOrderedModule(M1, []), M1);
});

test("an attempt lost on mechanics with every answer right is not reshuffled", () => {
  // The player knew the material and lost the fight. There is nothing to lead
  // with, so nothing moves — including the subtitle.
  const next = retryOrderedModule(M1, everythingRight());
  assert.equal(next, M1);
  assert.deepEqual(kickers(next!), AUTHORED_ORDER);
  assert.equal(next!.subtitle, M1.subtitle);
});

test("a deck already leading with the missed concept is left alone", () => {
  // The Coercive Acts are the first thing the deck teaches (two case files). A
  // miss there already leads, so the reorder is a no-op — and a no-op must not
  // present itself as a changed deck.
  const next = retryOrderedModule(M1, asked([INTOLERABLE, "WRONG"]));
  assert.equal(next, M1);
});

test("an undefined module stays undefined", () => {
  // Thirteen missions have no authored deck. Ordering must not invent one.
  assert.equal(retryOrderedModule(undefined, asked([INTOLERABLE, "WRONG"])), undefined);
});

// ---------------------------------------------------------------------------
// When the deck moves
// ---------------------------------------------------------------------------

test("a retry after missing representation opens on representation", () => {
  const next = retryOrderedModule(M1, asked([REPRESENTATION, "WRONG"]))!;
  assert.notEqual(next, M1);
  assert.deepEqual(kickers(next), [
    "Identity",
    "Consent",
    "The closure",
    "What the law says",
    "The answer",
    "The brief",
  ]);
});

test("the concept missed most often leads", () => {
  // Two misses on non-importation against one on representation. Both are
  // unsettled; the deck opens on the bigger hole and the clean concept keeps its
  // place. The Coercive-Acts files, answered clean, stay in their authored order.
  const next = retryOrderedModule(
    M1,
    asked(
      [MERCANTILISM, "WRONG"],
      [MERCANTILISM, "WRONG"],
      [REPRESENTATION, "WRONG"],
      [INTOLERABLE, "CORRECT"],
    ),
  )!;
  assert.deepEqual(kickers(next), [
    "Identity",
    "The answer",
    "Consent",
    "The closure",
    "What the law says",
    "The brief",
  ]);
});

test("concepts answered correctly keep their authored order behind the missed one", () => {
  const next = retryOrderedModule(M1, asked([MERCANTILISM, "WRONG"]))!;
  assert.deepEqual(kickers(next), [
    "Identity",
    "The answer",
    "The closure",
    "What the law says",
    "Consent",
    "The brief",
  ]);
});

test("a reordered deck says so, and an unchanged one does not", () => {
  const moved = retryOrderedModule(M1, asked([REPRESENTATION, "WRONG"]))!;
  assert.notEqual(moved.subtitle, M1.subtitle);
  // The retry subtitle signals the reorder. Its copy no longer claims "three
  // minutes" (the owner retired that framing); it now names the retry itself.
  assert.match(moved.subtitle, /what you missed/i);
});

// ---------------------------------------------------------------------------
// What the reorder is pinned by
// ---------------------------------------------------------------------------

test("the frame cards hold the two ends however the middle is ranked", () => {
  // Identity gives the player a job and the brief ends on the constable saying he
  // will ask. Neither is a thing a student can be wrong about, and both are held
  // in place by teaching no concepts rather than by being named here.
  for (const rounds of [
    asked([REPRESENTATION, "WRONG"]),
    asked([MERCANTILISM, "WRONG"], [REPRESENTATION, "WRONG"]),
    asked([INTOLERABLE, "WRONG"], [MERCANTILISM, "WRONG"], [REPRESENTATION, "WRONG"]),
  ]) {
    const next = retryOrderedModule(M1, rounds)!;
    assert.equal(next.cards[0]?.kicker, "Identity");
    assert.equal(next.cards.at(-1)?.kicker, "The brief");
  }
});

test("the excerpt card is an ordinary case file, not a pinned synthesis", () => {
  // The 1774 deck has no synthesis card teaching all three concepts, so nothing is
  // pinned for covering the whole deck. The one source excerpt sits on the answer
  // card, which teaches one concept and reorders like any other: missing
  // non-importation floats it to the front rather than holding it back.
  const next = retryOrderedModule(M1, asked([MERCANTILISM, "WRONG"]))!;
  const excerptAt = next.cards.findIndex((card) => card.excerpt !== undefined);
  assert.equal(excerptAt, 1, "the answer card leads when its concept was missed");
  assert.equal(next.cards[excerptAt]?.kicker, "The answer");
});

// ---------------------------------------------------------------------------
// What the reorder may not disturb
// ---------------------------------------------------------------------------

test("a reordered deck is still a valid three-minute module", () => {
  const next = retryOrderedModule(M1, asked([REPRESENTATION, "WRONG"]))!;
  assert.deepEqual(moduleDefinitionDefects(next), []);
  assert.equal(moduleTargetSeconds(next), TARGET_MODULE_SECONDS);
  assert.equal(next.cards.length, M1.cards.length);

  const windows = moduleCardWindows(next);
  assert.equal(windows[0]?.fromSeconds, 0);
  windows.forEach((window, at) => {
    assert.ok(window.throughSeconds > window.fromSeconds);
    if (at > 0) assert.equal(window.fromSeconds, windows[at - 1]?.throughSeconds);
  });
});

test("a card keeps its own seconds when it moves", () => {
  // The window was measured from the card's word count at 140 wpm, so it is a
  // property of the card and not of the slot. Consent needs its own seconds
  // wherever it is read.
  const authored = moduleCardWindows(M1);
  const spanById = new Map(
    authored.map((w) => [w.card.id, w.throughSeconds - w.fromSeconds]),
  );

  const next = retryOrderedModule(M1, asked([REPRESENTATION, "WRONG"]))!;
  for (const window of moduleCardWindows(next)) {
    assert.equal(
      window.throughSeconds - window.fromSeconds,
      spanById.get(window.card.id),
      `${window.card.id} changed length`,
    );
  }
});

test("the gate cannot tell a reordered run from an authored one", () => {
  // The cue set and the module id are what the completion is checked against —
  // here and, when persistence lands, on the server through the same rule. If
  // reordering could move either, a retry would file against a module that does
  // not exist.
  const next = retryOrderedModule(M1, asked([REPRESENTATION, "WRONG"]))!;
  assert.equal(next.moduleId, M1.moduleId);
  assert.equal(next.missionId, M1.missionId);
  assert.deepEqual(
    [...next.cards.map((c) => c.cueId)].sort(),
    [...M1.cards.map((c) => c.cueId)].sort(),
  );
  // Read in the order the reordered deck presents them, the authored deck is
  // covered — acknowledgement was never keyed by position.
  assert.ok(moduleRunIsComplete(M1, next.cards.map((card) => card.cueId)));
});

// ---------------------------------------------------------------------------
// Reading the evidence
// ---------------------------------------------------------------------------

test("a concept answered right once and wrong once is still missed", () => {
  // Mastery is 100% or nothing in @pa/contracts' summarizeAssessmentForm. A
  // retry deck that called this concept settled would teach against the record.
  const tally = missedConceptTally(
    asked([REPRESENTATION, "CORRECT"], [REPRESENTATION, "WRONG"]),
  );
  assert.equal(tally.get(REPRESENTATION), 1);
});

test("a verdict this file has never heard of counts as missed", () => {
  // The duel is being reworked for open-ended rounds. Anything that is not a
  // clear pass re-teaches, so a new verdict cannot silently stop the reorder.
  const next = retryOrderedModule(M1, [
    { conceptId: REPRESENTATION, verdict: "PARTIAL" },
  ])!;
  assert.equal(next.cards[1]?.kicker, "Consent");
});

test("ordering reads no round count and no bullet economy", () => {
  // Fourteen rounds rather than six changes the number of entries and nothing
  // else, which is what keeps the duel's rework off this path.
  const long = Array.from({ length: 14 }, (_, at) => ({
    conceptId: at % 2 === 0 ? MERCANTILISM : REPRESENTATION,
    verdict: at < 3 ? "WRONG" : "CORRECT",
  }));
  const next = retryOrderedModule(M1, long)!;
  assert.equal(next.cards[1]?.kicker, "The answer");
});

// ---------------------------------------------------------------------------
// The ledger
// ---------------------------------------------------------------------------

test("evidence is keyed by mission, not by whichever attempt resolved last", () => {
  // A player who fails M1, plays something else, and comes back must get M1's
  // evidence. Concept ids recur across chapters by design — SPIRAL concepts are
  // reinforced deliberately — so the wrong mission's rounds is not a harmless
  // mismatch.
  let ledger = EMPTY_MODULE_KNOWLEDGE;
  ledger = recordMissionKnowledge(ledger, "m1", asked([REPRESENTATION, "WRONG"]));
  ledger = recordMissionKnowledge(ledger, "m2", asked([INTOLERABLE, "WRONG"]));

  assert.deepEqual(knowledgeForMission(ledger, "m1"), asked([REPRESENTATION, "WRONG"]));
  assert.deepEqual(knowledgeForMission(ledger, "m3"), []);
  assert.equal(
    retryOrderedModule(M1, knowledgeForMission(ledger, "m1"))!.cards[1]?.kicker,
    "Consent",
  );
});

test("a second attempt on one mission replaces its evidence rather than adding to it", () => {
  // Only the last attempt describes what the player knows now. Accumulating
  // would let attempt one's misses outvote what attempt two just demonstrated.
  let ledger = recordMissionKnowledge(
    EMPTY_MODULE_KNOWLEDGE,
    "m1",
    asked([REPRESENTATION, "WRONG"], [REPRESENTATION, "WRONG"]),
  );
  ledger = recordMissionKnowledge(ledger, "m1", asked([MERCANTILISM, "WRONG"]));

  const next = retryOrderedModule(M1, knowledgeForMission(ledger, "m1"))!;
  assert.equal(next.cards[1]?.kicker, "The answer");
});
