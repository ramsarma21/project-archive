import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import { M1_CONTENT, moduleForMission } from "../src/module/m1Module.js";
import { loadAuthoredModule } from "../src/module/moduleContent.js";
import {
  TARGET_MODULE_SECONDS,
  moduleCardWindows,
  moduleCodexCardIds,
  moduleConceptIds,
  moduleDefinitionDefects,
  moduleRequiredCheckIds,
  moduleTargetSeconds,
} from "../src/module/moduleFormat.js";
import {
  EMPTY_MODULE_GATE_LEDGER,
  canEnterMission,
  completeModuleRun,
  deployDecision,
  moduleRunIsComplete,
  newMissionTally,
  recordAttemptResolved,
  recordModuleCompletion,
  unacknowledgedCueIds,
  type MissionAttemptTally,
  type ModuleGateLedger,
} from "../src/module/moduleGate.js";

// The gate, not the player. Every one of these is a rule from §1.5 and §4.7 that
// a later change could quietly soften: the module is mandatory, a retry redoes
// it, and nothing about it pays or forces a clock.

const AT = "2026-07-25T18:00:00.000Z";

// The authored deck, loaded from content/m1/module.json. Read once and up front:
// a load failure is the first thing worth reporting, and every case below would
// otherwise fail for the same reason without saying so.
if (!M1_CONTENT.ok) {
  throw new Error(
    `content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`,
  );
}
const M1_MODULE = M1_CONTENT.definition;
const M1_MISSION_ID = M1_MODULE.missionId;

function unlockedM1(): MissionAttemptTally {
  return newMissionTally(M1_MISSION_ID);
}

/** Reads every card, the way the player does. */
function readWholeDeck(): string[] {
  return M1_MODULE.cards.map((card) => card.cueId);
}

/** Masters every gate check, the way a learner who answers correctly does. */
function masterEveryCheck(): string[] {
  return moduleRequiredCheckIds(M1_MODULE);
}

function clearTheModule(
  ledger: ModuleGateLedger,
  attemptOrdinal: number,
  observedSeconds = TARGET_MODULE_SECONDS,
): ModuleGateLedger {
  const completion = completeModuleRun({
    definition: M1_MODULE,
    attemptOrdinal,
    acknowledgedCueIds: readWholeDeck(),
    acknowledgedCheckIds: masterEveryCheck(),
    observedSeconds,
    at: AT,
  });
  if (!completion) throw new Error("a fully read deck must complete");
  return recordModuleCompletion(ledger, completion);
}

function deploy(ledger: ModuleGateLedger, tally: MissionAttemptTally) {
  return deployDecision({
    ledger,
    tally,
    unlocked: true,
    definition: moduleForMission(tally.missionId),
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

test("a mission is unreachable until its module is complete", () => {
  const tally = unlockedM1();
  const first = deploy(EMPTY_MODULE_GATE_LEDGER, tally);
  assert.equal(first.kind, "RUN_MODULE");
  assert.equal(
    canEnterMission({
      ledger: EMPTY_MODULE_GATE_LEDGER,
      tally,
      unlocked: true,
      definition: M1_MODULE,
    }),
    false,
  );

  const cleared = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 1);
  const second = deploy(cleared, tally);
  assert.equal(second.kind, "ENTER_MISSION");
  assert.equal(second.kind === "ENTER_MISSION" && second.attemptOrdinal, 1);
});

test("a partly read deck does not open the gate", () => {
  const shortOfTheEnd = readWholeDeck().slice(0, -1);
  assert.equal(moduleRunIsComplete(M1_MODULE, shortOfTheEnd), false);
  assert.deepEqual(unacknowledgedCueIds(M1_MODULE, shortOfTheEnd), [
    M1_MODULE.cards.at(-1)?.cueId,
  ]);
  assert.equal(
    completeModuleRun({
      definition: M1_MODULE,
      attemptOrdinal: 1,
      acknowledgedCueIds: shortOfTheEnd,
      observedSeconds: TARGET_MODULE_SECONDS,
      at: AT,
    }),
    null,
  );
});

test("re-reading a card does not re-lock the gate behind it", () => {
  // Acknowledgement is a high-water mark, so a student who goes back to the
  // representation card is not made to walk the rest of the deck again.
  const withRepeats = [...readWholeDeck(), M1_MODULE.cards[3]!.cueId];
  assert.ok(moduleRunIsComplete(M1_MODULE, withRepeats));
});

test("a retry re-arms the gate", () => {
  let ledger = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 1);
  let tally = unlockedM1();
  assert.equal(deploy(ledger, tally).kind, "ENTER_MISSION");

  // Attempt 1 is spent, so attempt 2 is what Deploy would open next — and the
  // ledger holds a completion for attempt 1 only.
  tally = recordAttemptResolved(tally, "FAILED");
  const afterFailure = deploy(ledger, tally);
  assert.equal(afterFailure.kind, "RUN_MODULE");
  assert.equal(afterFailure.kind === "RUN_MODULE" && afterFailure.attemptOrdinal, 2);

  ledger = clearTheModule(ledger, 2);
  const afterRedoing = deploy(ledger, tally);
  assert.equal(afterRedoing.kind, "ENTER_MISSION");
  assert.equal(afterRedoing.kind === "ENTER_MISSION" && afterRedoing.attemptOrdinal, 2);
});

test("every one of the three attempts is gated, and the third exhausts it", () => {
  let ledger = EMPTY_MODULE_GATE_LEDGER;
  let tally = unlockedM1();

  for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
    const before = deploy(ledger, tally);
    assert.equal(before.kind, "RUN_MODULE", `attempt ${ordinal} is gated`);
    ledger = clearTheModule(ledger, ordinal);
    const after = deploy(ledger, tally);
    assert.equal(after.kind, "ENTER_MISSION", `attempt ${ordinal} opens`);
    tally = recordAttemptResolved(tally, "FAILED");
  }

  assert.equal(tally.outcome, "FAILED_PERMANENT");
  const spent = deploy(ledger, tally);
  assert.equal(spent.kind, "BLOCKED");
  assert.equal(spent.kind === "BLOCKED" && spent.reason, "MISSION_SPENT");
});

test("a completed module for one attempt never satisfies another", () => {
  const ledger = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 2);
  // The ordinal is the whole key. A completion filed against attempt 2 does
  // nothing for the attempt the player is actually about to open.
  const decision = deploy(ledger, unlockedM1());
  assert.equal(decision.kind, "RUN_MODULE");
});

test("clearing the module still leaves a cleared mission spent", () => {
  const ledger = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 2);
  const cleared: MissionAttemptTally = {
    missionId: M1_MISSION_ID,
    attemptsUsed: 1,
    outcome: "CLEARED",
  };
  const decision = deploy(ledger, cleared);
  assert.equal(decision.kind, "BLOCKED");
  assert.equal(decision.kind === "BLOCKED" && decision.reason, "MISSION_SPENT");
});

test("the gate fails closed on a locked mission and on a missing module", () => {
  const ledger = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 1);
  const locked = deployDecision({
    ledger,
    tally: unlockedM1(),
    unlocked: false,
    definition: M1_MODULE,
  });
  assert.equal(locked.kind, "BLOCKED");
  assert.equal(locked.kind === "BLOCKED" && locked.reason, "MISSION_LOCKED");

  // Thirteen missions have no authored module yet. An unauthored module is a
  // reason to block, never a reason to wave a player through to the mission.
  const unauthored = deployDecision({
    ledger,
    tally: newMissionTally("m7"),
    unlocked: true,
    definition: moduleForMission("m7"),
  });
  assert.equal(unauthored.kind, "BLOCKED");
  assert.equal(unauthored.kind === "BLOCKED" && unauthored.reason, "MODULE_MISSING");
});

// ---------------------------------------------------------------------------
// What the module pays, and what it does not enforce
// ---------------------------------------------------------------------------

test("a module pays zero XP however long it took", () => {
  for (const observedSeconds of [0, 12, TARGET_MODULE_SECONDS, 900]) {
    const completion = completeModuleRun({
      definition: M1_MODULE,
      attemptOrdinal: 1,
      acknowledgedCueIds: readWholeDeck(),
      acknowledgedCheckIds: masterEveryCheck(),
      observedSeconds,
      at: AT,
    });
    assert.equal(completion?.awardedXp, 0);
  }
});

test("the three minutes are a target and never a cutoff", () => {
  // A fast reader is finished and a slow reader is not timed out: observed time
  // is recorded on the completion and is not consulted by the gate.
  const quick = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 1, 41);
  assert.equal(deploy(quick, unlockedM1()).kind, "ENTER_MISSION");

  const unhurried = clearTheModule(EMPTY_MODULE_GATE_LEDGER, 1, 12 * 60);
  assert.equal(deploy(unhurried, unlockedM1()).kind, "ENTER_MISSION");
  assert.equal(
    unhurried.completions[0]?.observedSeconds,
    12 * 60,
    "the time is kept, just not enforced",
  );
});

// ---------------------------------------------------------------------------
// M1's authored deck
// ---------------------------------------------------------------------------

test("the authored M1 deck has no defects", () => {
  assert.deepEqual(moduleDefinitionDefects(M1_MODULE), []);
});

// These pin the invariants the format guarantees, not the numbers Mission-Slate
// §4.7 happened to write down. The authored deck re-cut its windows to a measured
// 140-wpm reading rate and added a ninth Codex card, and both are improvements on
// the document — so a test that froze §4.7's figures would be a test that stopped
// content from getting better. What may never drift is the shape.

test("M1 is six cards whose windows tile exactly three minutes", () => {
  assert.equal(M1_MODULE.cards.length, 6);
  assert.equal(TARGET_MODULE_SECONDS, 180);
  assert.equal(moduleTargetSeconds(M1_MODULE), TARGET_MODULE_SECONDS);

  const windows = moduleCardWindows(M1_MODULE);
  assert.equal(windows[0]?.fromSeconds, 0, "the deck opens at zero");
  assert.equal(windows.at(-1)?.throughSeconds, TARGET_MODULE_SECONDS);
  windows.forEach((window, at) => {
    assert.ok(
      window.throughSeconds > window.fromSeconds,
      `card ${at} occupies no time`,
    );
    if (at > 0) {
      // Contiguous: a card begins where the one before it ended, so the six
      // windows tile the three minutes with no gap and no overlap.
      assert.equal(window.fromSeconds, windows[at - 1]?.throughSeconds);
    }
  });
});

test("M1 teaches three concepts, and every card names its own coverage", () => {
  // Three concepts at roughly forty seconds each is what §4.7 spends the three
  // minutes on. The ids themselves are the registry's to canonicalise.
  assert.equal(moduleConceptIds(M1_MODULE).length, 3);

  // The field that makes the duel's answerable-from-the-module claim checkable.
  // The count is free to grow as authoring splits a proposition that was being
  // carried implicitly; what matters is that every card the duel rests on is
  // sourced by a card in this deck and nowhere else.
  const codexCardIds = moduleCodexCardIds(M1_MODULE);
  assert.ok(codexCardIds.length >= 8, "§4.9 authored at least eight");
  assert.equal(
    new Set(codexCardIds).size,
    codexCardIds.length,
    "a proposition has one sole source, not two",
  );

  const teaching = M1_MODULE.cards.filter((card) => card.conceptIds.length > 0);
  assert.ok(
    teaching.every((card) => card.codexCardIds.length > 0),
    "a card that teaches a concept sources at least one proposition",
  );
});

test("the identity and insertion cards frame the deck and teach no concepts", () => {
  const [identity] = M1_MODULE.cards;
  const insertion = M1_MODULE.cards.at(-1);
  assert.deepEqual(identity?.conceptIds, []);
  assert.deepEqual(insertion?.conceptIds, []);
  // The forty-seconds-each budget belongs to the three concept cards.
  const taught = M1_MODULE.cards.filter((card) => card.conceptIds.length === 1);
  assert.equal(taught.length, 3);
});

test("exactly one card carries a source excerpt, and it is the synthesis card", () => {
  const withExcerpts = M1_MODULE.cards.filter((card) => card.excerpt);
  assert.equal(withExcerpts.length, 1);
  assert.equal(withExcerpts[0]?.cueId, "BOS.MD01.CUE.BRIEF_SYNTHESIS.v1");
  // Verbatim quotation, so an excerpt has to know where it came from. Runtime
  // never generates or paraphrases a source, and an unattributed one could not
  // be checked against the Act.
  const excerpt = withExcerpts[0]?.excerpt;
  assert.ok(excerpt && excerpt.sourceId.length > 0);
  assert.ok(excerpt && excerpt.attribution.length > 0);
  assert.ok(excerpt && excerpt.lines.length > 0);
});

test("the authored deck is the one the loader accepted", () => {
  // The registry is loaded content now, not a constant. This is the seam worth a
  // test of its own: a JSON edit that breaks the format must surface here rather
  // than as an undeployable mission the player discovers.
  assert.equal(M1_CONTENT.ok, true);
  assert.equal(moduleForMission(M1_MISSION_ID), M1_MODULE);
  assert.equal(moduleForMission("m7"), undefined);
});

test("a defective deck is reported rather than tolerated", () => {
  const overlapping = {
    ...M1_MODULE,
    cards: [
      { ...M1_MODULE.cards[0]!, throughSeconds: 50 },
      { ...M1_MODULE.cards[1]!, throughSeconds: 50 },
      ...M1_MODULE.cards.slice(2),
    ],
  };
  const defects = moduleDefinitionDefects(overlapping);
  assert.equal(defects.length, 1);
  assert.match(defects[0]!, /is not after the previous card's 50s/);

  // A deck that stops short is a deck that is not three minutes, whatever the
  // authored windows happen to be.
  const shortDeck = { ...M1_MODULE, cards: M1_MODULE.cards.slice(0, 3) };
  const shortDefects = moduleDefinitionDefects(shortDeck);
  assert.equal(shortDefects.length, 1);
  assert.match(shortDefects[0]!, /^the deck targets \d+s; every module is exactly 180s$/);
});

test("a JSON envelope missing a required field is refused, not defaulted", () => {
  // `conceptIds: []` and no `conceptIds` key are different claims: the first says
  // a frame card teaches nothing, the second says the author forgot. Only one of
  // them is a module.
  const { conceptIds, ...withoutConcepts } = M1_MODULE.cards[0]!;
  const loaded = loadAuthoredModule({
    module: { ...M1_MODULE, cards: [withoutConcepts, ...M1_MODULE.cards.slice(1)] },
  });
  assert.equal(loaded.ok, false);
  assert.ok(
    !loaded.ok && loaded.defects.some((d) => /conceptIds/.test(d)),
    "the missing array is named",
  );

  assert.equal(loadAuthoredModule({}).ok, false);
  assert.equal(loadAuthoredModule(null).ok, false);
});
