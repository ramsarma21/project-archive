import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, roundsBeforeRecycling } from "../questions.js";
import { bossProfileForTier } from "../boss.js";
import { referenceArena } from "../arena.js";
import { createDuel } from "../machine.js";
import { serialiseCommitLog, type DuelQuestionRef } from "../events.js";
import {
  conceptBank,
  M1_ATTEMPT_CONCEPTS,
  questionSet,
  runDuel,
} from "./harness.js";

const BANK = questionSet(18);

/** M1's real per-attempt shape: three concepts, two authored items each. */
const M1_BANK = conceptBank(M1_ATTEMPT_CONCEPTS, 2);

function conceptsAsked(
  bank: readonly DuelQuestionRef[],
  rounds: number,
  seed: number,
): Set<string> {
  const seen = new Set<string>();
  for (let round = 1; round <= rounds; round++) {
    seen.add(askQuestion(bank, round, seed).item.conceptId);
  }
  return seen;
}

test("a bank covers its own length before anything repeats", () => {
  assert.equal(roundsBeforeRecycling(BANK), 18);
  const seen = new Set<string>();
  for (let round = 1; round <= BANK.length; round++) {
    const asked = askQuestion(BANK, round, 4242);
    assert.equal(asked.appearance, 1);
    assert.equal(asked.recycled, false);
    assert.equal(seen.has(asked.item.itemId), false, "no repeat inside a pass");
    seen.add(asked.item.itemId);
  }
  assert.equal(seen.size, BANK.length, "and every authored item gets asked");
});

test("PAST THE BOTTOM OF THE BANK IT RECYCLES, AND SAYS SO", () => {
  // An unbounded duel can outlast eighteen authored items. The assessment engine
  // met this first and answered it by disclosing reuse rather than hiding it —
  // @pa/reporting carries mastery on a repeat as RECYCLED_ITEMS and qualifies the
  // claim — and this is the same disclosure one layer down.
  const first = askQuestion(BANK, 1, 4242);
  const second = askQuestion(BANK, BANK.length + 1, 4242);
  assert.equal(first.recycled, false);
  assert.equal(second.recycled, true);
  assert.equal(second.appearance, 2);
  assert.equal(askQuestion(BANK, BANK.length * 2 + 1, 4242).appearance, 3);
});

test("every lap is a permutation, so no item is asked twice inside one", () => {
  // The seam adjustment swaps rather than skips, precisely so this stays true.
  for (const seed of [1, 19, 4242]) {
    for (let pass = 0; pass < 4; pass++) {
      const lap = Array.from({ length: BANK.length }, (_unused, index) =>
        askQuestion(BANK, pass * BANK.length + index + 1, seed).item.itemId,
      );
      assert.equal(new Set(lap).size, BANK.length, `seed ${seed} pass ${pass} repeats`);
    }
  }
});

test("the second lap is a different order from the first", () => {
  // Otherwise a long duel reads as a loop, which is the thing that makes recycling
  // feel like a bug rather than a policy.
  const firstPass = Array.from({ length: BANK.length }, (_unused, index) =>
    askQuestion(BANK, index + 1, 4242).item.itemId,
  );
  const secondPass = Array.from({ length: BANK.length }, (_unused, index) =>
    askQuestion(BANK, BANK.length + index + 1, 4242).item.itemId,
  );
  assert.notDeepEqual(firstPass, secondPass);
  assert.deepEqual([...secondPass].sort(), [...firstPass].sort(), "same items, new order");
});

test("no item is ever asked twice in a row, including across the seam", () => {
  for (const seed of [1, 7, 19, 4242, 90210]) {
    let previous = "";
    for (let round = 1; round <= BANK.length * 3; round++) {
      const asked = askQuestion(BANK, round, seed);
      assert.notEqual(
        asked.item.itemId,
        previous,
        `seed ${seed} asked ${asked.item.itemId} twice running at round ${round}`,
      );
      previous = asked.item.itemId;
    }
  }
});

test("the order is seeded, so an authority and a replay ask the same question", () => {
  const a = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 777).item.itemId,
  );
  const b = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 777).item.itemId,
  );
  assert.deepEqual(a, b);
  const other = Array.from({ length: 40 }, (_unused, index) =>
    askQuestion(BANK, index + 1, 778).item.itemId,
  );
  assert.notDeepEqual(a, other);
});

test("a bank of one is legal and simply repeats, disclosing every time", () => {
  const single = questionSet(1);
  assert.equal(askQuestion(single, 1, 1).recycled, false);
  assert.equal(askQuestion(single, 2, 1).recycled, true);
  assert.equal(askQuestion(single, 9, 1).appearance, 9);
});

test("an empty bank is refused rather than silently skipping the question", () => {
  assert.throws(() => askQuestion([], 1, 1), /at least one authored question/);
  const arena = referenceArena();
  assert.throws(
    () =>
      createDuel({
        duelId: "TEST",
        seed: 1,
        world: arena.world,
        opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
        questions: [],
      }),
    /at least one authored question/,
  );
});

test("a duel that outlasts its bank keeps asking, and the log discloses it", () => {
  // Three items and a duel with nobody firing, so it runs to the backstop and has
  // to ask far more questions than it was given.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "WRONG",
    intents: () => ({
      moveX: 0,
      moveZ: 0,
      sprint: false,
      crouch: false,
      jump: false,
      dodge: false,
      fire: false,
      aimX: 0,
      aimZ: 0,
      abilityId: null,
    }),
    bankSize: 3,
    roundCeiling: 8,
  });
  const opened = result.log.filter((event) => event.type === "QUESTION_OPENED");
  assert.equal(opened.length, 8, "the duel did not stop when the bank ran out");
  const recycled = opened.filter(
    (event) => event.type === "QUESTION_OPENED" && event.recycled,
  );
  assert.equal(recycled.length, 5, "rounds 4 to 8 are repeats, and every one is flagged");
});

test("a reused item is identifiable as a repeat in the PERSISTED record, not just at ask time", () => {
  // Reuse is a stopgap (see questions.ts), and the owner's condition on it is that a
  // repeat must not read as a fresh question to either the player or the learning
  // record. The player half is the "asked again" marker in QuestionPanel. This is the
  // record half: the durable commit log the API's per-concept retrieval ledger reads
  // must carry, per round, whether the graded item was a repeat and its appearance
  // ordinal — so "asked five times, right five times in one match" cannot be booked as
  // five independent retrievals. It rides the committed VERDICT_COMMITTED record
  // because the grading-request wire is a strict allowlist that cannot carry it.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    verdicts: () => "WRONG",
    intents: () => ({
      moveX: 0,
      moveZ: 0,
      sprint: false,
      crouch: false,
      jump: false,
      dodge: false,
      fire: false,
      aimX: 0,
      aimZ: 0,
      abilityId: null,
    }),
    bankSize: 3,
    roundCeiling: 8,
  });

  const committed = serialiseCommitLog(result.log).filter(
    (entry) => entry.type === "VERDICT_COMMITTED" && entry.side === "A",
  );
  assert.equal(committed.length, 8, "every round commits a player verdict");

  // Rounds 1-3 are the first pass: fresh, appearance 1. Rounds 4-8 are reuse: flagged
  // as recycled with a rising appearance ordinal the ledger can weight down.
  for (const entry of committed) {
    const round = entry.round as number;
    const expectedAppearance = Math.floor((round - 1) / 3) + 1;
    assert.equal(
      entry.appearance,
      expectedAppearance,
      `round ${round} should record appearance ${expectedAppearance}`,
    );
    assert.equal(
      entry.recycled,
      round > 3,
      `round ${round} recycled flag`,
    );
  }
  // And the fact is durable specifically — it survives serialisation into the log
  // that leaves the client, rather than living only on the transient QUESTION_OPENED.
  assert.ok(
    committed.some((entry) => entry.recycled === true),
    "at least one repeat is recorded as a repeat in the persisted log",
  );
});

// ---- concept coverage -------------------------------------------------------
//
// WHY THIS SECTION EXISTS. The draw used to be concept-BLIND: a flat seeded
// permutation of the bank, which ignored the `conceptId` every item already
// carries. A duel has no round schedule, so a strong student's fight is short, and
// a short draw from a flat permutation lands on whatever it lands on. Measured over
// M1's six-item per-attempt bank, a three-round fight asked all three concepts only
// 40.2% of the time and a four-round fight 79.9%; driven end to end against the
// tier-1 boss on the correct-answer path, 41.5% of students were never asked about
// one of the three things the lesson taught. Nothing caught it because nothing
// checked which concepts a fight actually asked. That is what these tests check.
//
// They are written to FAIL under the blind draw rather than merely pass under the
// ordered one — the numbers above are the margin they exploit.

test("A SHORT FIGHT STILL ASKS EVERY CONCEPT: three rounds cover M1's three", () => {
  // THE REGRESSION GUARD. Under the concept-blind draw this held for ~40% of seeds,
  // so any one seed had a ~60% chance of failing it and 300 seeds fail it with
  // certainty. Under the concept-ordered draw it is structural: the first rotation
  // takes one item per concept before any concept comes round again.
  for (let seed = 1; seed <= 300; seed++) {
    const asked = conceptsAsked(M1_BANK, 3, seed);
    assert.equal(
      asked.size,
      3,
      `seed ${seed}: a three-round duel asked ${asked.size} of 3 concepts ` +
        `(${[...asked].join(", ")}). The draw is concept-blind again`,
    );
  }
});

test("and four rounds do too, which is the correct-answer ceiling", () => {
  // Four rounds is where a correct-answering student's fight tops out (see
  // structure.ts: the ceiling is arithmetic, and boss health cannot buy past it).
  // The blind draw covered 79.9% of seeds here.
  for (let seed = 1; seed <= 300; seed++) {
    assert.equal(conceptsAsked(M1_BANK, 4, seed).size, 3, `seed ${seed} at four rounds`);
  }
});

test("TWO ROUNDS CANNOT COVER THREE CONCEPTS, and the draw asks the most it can", () => {
  // THE HONEST LIMIT, PINNED SO IT IS NOT MISREAD AS COVERAGE. A duel that lasts R
  // rounds can ask at most R concepts. Ordering the draw cannot conjure a third
  // question out of a two-round fight, and this asserts the ceiling rather than
  // wishing it away: exactly two, never one (the blind draw averaged 1.80 and asked
  // a single concept twice often enough to be common), and never a fabricated three.
  //
  // This is why the coverage GUARANTEE lives in the mission encounters and not here.
  for (let seed = 1; seed <= 300; seed++) {
    assert.equal(
      conceptsAsked(M1_BANK, 2, seed).size,
      2,
      `seed ${seed}: two rounds must ask two distinct concepts — the maximum reachable`,
    );
  }
});

test("the property generalises: N rounds ask min(N, concepts) distinct concepts", () => {
  // Not just M1's shape. Unequal group sizes included, because a bank with four
  // items on one concept and one on another is the case a round-robin deal gets
  // wrong if it assumes equal pools.
  const shapes = [
    { concepts: ["A", "B", "C"], perConcept: 2 },
    { concepts: ["A", "B", "C"], perConcept: 6 },
    { concepts: ["A", "B", "C", "D", "E"], perConcept: 1 },
    { concepts: ["A", "B"], perConcept: 9 },
  ];
  for (const shape of shapes) {
    const bank = conceptBank(shape.concepts, shape.perConcept);
    for (let seed = 1; seed <= 60; seed++) {
      for (let rounds = 1; rounds <= bank.length; rounds++) {
        const expected = Math.min(rounds, shape.concepts.length);
        assert.equal(
          conceptsAsked(bank, rounds, seed).size,
          expected,
          `${shape.concepts.length} concepts x ${shape.perConcept}, ${rounds} rounds, seed ${seed}`,
        );
      }
    }
  }
});

test("an uneven bank still spreads: one concept cannot crowd out the others", () => {
  // The shape a thin authored pool produces — five items on one concept, one each on
  // two others. A blind permutation asks the fat concept first about 71% of the time
  // for two rounds running; the deal cannot, because every concept contributes to the
  // opening rotation before any contributes twice.
  const bank: readonly DuelQuestionRef[] = [
    ...conceptBank(["FAT"], 5),
    ...conceptBank(["THIN_A"], 1),
    ...conceptBank(["THIN_B"], 1),
  ];
  for (let seed = 1; seed <= 200; seed++) {
    assert.equal(conceptsAsked(bank, 3, seed).size, 3, `seed ${seed}: uneven bank`);
  }
});

test("no CONCEPT is asked twice in a row either, including across the seam", () => {
  // The item-level rule was already here; this is the same rule one level up, and it
  // is what a player actually notices — two questions about the stamp's scope back to
  // back read as a stuck duel even when the items differ.
  for (const seed of [1, 7, 19, 4242, 90210]) {
    let previous = "";
    for (let round = 1; round <= M1_BANK.length * 3; round++) {
      const asked = askQuestion(M1_BANK, round, seed);
      assert.notEqual(
        asked.item.conceptId,
        previous,
        `seed ${seed} asked ${asked.item.conceptId} twice running at round ${round}`,
      );
      previous = asked.item.conceptId;
    }
  }
});

test("ordering the draw did not cost determinism", () => {
  // The PvP authority, the client and the grading authority each call askQuestion
  // independently for the same round; they must all land on the same item.
  for (const seed of [1, 4242, 90210]) {
    const a = Array.from(
      { length: 20 },
      (_unused, index) => askQuestion(M1_BANK, index + 1, seed).item.itemId,
    );
    const b = Array.from(
      { length: 20 },
      (_unused, index) => askQuestion(M1_BANK, index + 1, seed).item.itemId,
    );
    assert.deepEqual(a, b);
  }
  // And it is still seeded rather than fixed: two attempts see different orders.
  const first = Array.from(
    { length: 6 },
    (_unused, index) => askQuestion(M1_BANK, index + 1, 1).item.itemId,
  );
  const second = Array.from(
    { length: 6 },
    (_unused, index) => askQuestion(M1_BANK, index + 1, 2).item.itemId,
  );
  assert.notDeepEqual(first, second);
});

test("A REAL FIGHT ASKS EVERY CONCEPT — the gap that let this ship", () => {
  // The draw tests above are the unit. This is the one that would actually have
  // caught it: drive a whole duel against the boss on the correct-answer path and
  // read the concepts out of the event log, because "which concepts did the fight
  // ask" was a property nothing in the suite ever looked at.
  //
  // THE SEED RANGE IS LOAD-BEARING, and it is the second version of this test. The
  // first drove the eight seeds `winnability.test.ts` uses and PASSED against a
  // deliberately re-blinded draw — those eight happen to land on long fights or
  // lucky ones, so it guarded nothing. Seeds 1-40 put 21 three-round and 15
  // four-round fights in the set, which are the lengths where a blind draw covers
  // 40% and 80% of the time, so re-blinding the draw fails this in bulk.
  for (let seed = 1; seed <= 40; seed++) {
    const result = runDuel({
      opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
      verdicts: () => "CORRECT",
      questions: M1_BANK,
      seed,
    });
    const asked = new Set(
      result.log
        .filter((event) => event.type === "QUESTION_OPENED")
        .map((event) => (event.type === "QUESTION_OPENED" ? event.item.conceptId : "")),
    );
    // A duel this short can only be uncovered if it ran fewer rounds than there are
    // concepts, which is the structural limit and not a draw defect.
    const reachable = Math.min(result.state.round, M1_ATTEMPT_CONCEPTS.length);
    assert.equal(
      asked.size,
      reachable,
      `seed ${seed}: a ${result.state.round}-round fight asked ${asked.size} concepts, ` +
        `and ${reachable} were reachable`,
    );
  }
});
