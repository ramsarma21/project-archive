import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import { M1_CONTENT } from "../src/module/m1Module.js";
import {
  checkCorrectOptionIds,
  checkDrawCount,
  isExactCheckSelection,
  isPooledCheck,
  pooledCheckDefects,
  type ModuleCheck,
  type ModuleCheckOption,
} from "../src/module/moduleFormat.js";
import { drawCheckOptions } from "../src/module/checkDraw.js";

// The distractor-pool drawer, proving the three properties the owner named:
//  1. exactly one defensible answer for EVERY drawable subset (enumerated);
//  2. grading stays keyed to stable ids under shuffle (never to position);
//  3. three sittings never present the same option set — nor the same order.
// Plus a no-surface-form-tell audit and the teach-everything invariant that the
// pool never removes the answer.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;

/** The pooled checks the authored M1 deck carries. */
const POOLED: readonly ModuleCheck[] = M1.cards
  .map((card) => card.check)
  .filter((check): check is ModuleCheck => check !== undefined && isPooledCheck(check));

/** Every k-subset of `items`, as arrays. */
function combinations<T>(items: readonly T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (k > items.length) return [];
  const [head, ...rest] = items;
  const withHead = combinations(rest, k - 1).map((combo) => [head!, ...combo]);
  const withoutHead = combinations(rest, k);
  return [...withHead, ...withoutHead];
}

/** Every ordering of `items` (small inputs only). */
function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) out.push([item, ...tail]);
  });
  return out;
}

test("M1 authors four pooled checks across the three concepts", () => {
  // INTOLERABLE_ACTS carries two of the lesson's assessable propositions — the
  // closure as collective punishment, and the scope of the four acts — so it is
  // checked twice; representation and non-importation once each. Four checks, three
  // concepts.
  assert.equal(POOLED.length, 4);
  const concepts = POOLED.map((check) => check.conceptId).sort();
  assert.deepEqual(concepts, [
    "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    "BOS.CONCEPT.MERCANTILISM.v1",
    "BOS.CONCEPT.REPRESENTATION.v1",
  ]);
  assert.equal(new Set(concepts).size, 3, "three distinct concepts");
});

test("each pooled check has zero authoring defects", () => {
  for (const check of POOLED) {
    assert.deepEqual(pooledCheckDefects("test", check), []);
  }
});

// ---- Property 1: exactly one defensible answer for every drawable subset. ----
test("property 1: every drawable option subset has exactly one correct option", () => {
  for (const check of POOLED) {
    const pool = check.distractorPool!;
    const answer = check.correctOption!;
    const k = checkDrawCount(check) - 1;

    // Enumerate the WHOLE combinatorial space the drawer can reach, not just the
    // three attempts — a plausible-but-also-correct distractor slips in here.
    const combos = combinations(pool, k);
    assert.ok(combos.length >= MAX_MISSION_ATTEMPTS, `${check.id}: pool too shallow`);
    for (const combo of combos) {
      const shown: ModuleCheckOption[] = [answer, ...combo];
      const correct = shown.filter((option) => option.correct);
      assert.equal(
        correct.length,
        1,
        `${check.id}: a drawable subset had ${correct.length} correct options`,
      );
      assert.equal(correct[0]!.id, answer.id);
    }
  }
});

test("property 1: every actually-drawn attempt shows exactly one correct option", () => {
  for (const check of POOLED) {
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const drawn = drawCheckOptions(check, ordinal);
      const options = drawn.options ?? [];
      assert.equal(options.length, checkDrawCount(check));
      assert.equal(options.filter((option) => option.correct).length, 1);
      // The answer is always present (the pool never removes it).
      assert.ok(options.some((option) => option.id === check.correctOption!.id));
    }
  }
});

// ---- Property 2: grading stays keyed to stable ids, never to position. -------
test("property 2: grading finds the correct option by id under every shuffle", () => {
  for (const check of POOLED) {
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const drawn = drawCheckOptions(check, ordinal);
      const correctId = checkCorrectOptionIds(drawn)[0]!;
      // Re-order the drawn options every possible way; grading must be invariant.
      for (const order of permutations(drawn.options!)) {
        const shuffled: ModuleCheck = { ...drawn, options: order };
        assert.equal(isExactCheckSelection(shuffled, [correctId]), true);
        for (const option of order) {
          if (option.id === correctId) continue;
          assert.equal(isExactCheckSelection(shuffled, [option.id]), false);
        }
      }
    }
  }
});

test("property 2: an index-based grader WOULD mis-grade — the trap is real", () => {
  // Guard on the guard: prove position is not stable, so any code that graded by
  // array index (e.g. 'index 0 is correct') would grade the wrong option. If a
  // future refactor accidentally pinned the answer's position, this test fails and
  // warns that the index trap has quietly become reachable again.
  for (const check of POOLED) {
    const positions = new Set<number>();
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const drawn = drawCheckOptions(check, ordinal);
      positions.add((drawn.options ?? []).findIndex((o) => o.correct));
    }
    assert.ok(
      positions.size > 1,
      `${check.id}: the correct option sat at a fixed position across attempts — an index-based grader would be silently "right"`,
    );
  }
});

// ---- Property 3: three sittings never repeat the option set, nor the order. --
test("property 3: attempts 1..3 present pairwise-distinct option SETS", () => {
  for (const check of POOLED) {
    const sets = [];
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const ids = (drawCheckOptions(check, ordinal).options ?? []).map((o) => o.id).sort();
      sets.push(ids.join("|"));
    }
    assert.equal(new Set(sets).size, sets.length, `${check.id}: two attempts shared an option set`);
  }
});

test("property 3: attempts 1..3 present pairwise-distinct option ORDERS", () => {
  for (const check of POOLED) {
    const orders = [];
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      orders.push((drawCheckOptions(check, ordinal).options ?? []).map((o) => o.id).join("|"));
    }
    assert.equal(new Set(orders).size, orders.length, `${check.id}: two attempts shared an order`);
  }
});

test("the drawer is deterministic in (check.id, attemptOrdinal)", () => {
  for (const check of POOLED) {
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const a = (drawCheckOptions(check, ordinal).options ?? []).map((o) => o.id);
      const b = (drawCheckOptions(check, ordinal).options ?? []).map((o) => o.id);
      assert.deepEqual(a, b);
    }
  }
});

// ---- No surface-form tell: the answer must not be the longest option. --------
test("no-tell audit: the correct answer is not the longest option in any item", () => {
  for (const check of POOLED) {
    const all = [check.correctOption!, ...check.distractorPool!];
    const maxLen = Math.max(...all.map((o) => o.text.length));
    assert.ok(
      check.correctOption!.text.length < maxLen,
      `${check.id}: the correct answer is the longest option — that is a surface-form tell`,
    );
  }
});

test("no-tell audit: correct-answer length rank varies across the three items", () => {
  // If the answer were always, say, the second-longest, that is itself a tell
  // across a paper. Assert the answer's length-rank is not identical for all items.
  const ranks = POOLED.map((check) => {
    const all = [check.correctOption!, ...check.distractorPool!].map((o) => o.text.length);
    const longer = all.filter((len) => len > check.correctOption!.text.length).length;
    return longer;
  });
  assert.ok(new Set(ranks).size > 1, "the correct answer sits at the same length-rank in every item");
});
