import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import { loadAuthoredModule } from "../src/module/moduleContent.js";
import { MAX_MISSION_ATTEMPTS } from "@pa/contracts";
import {
  checkCorrectOptionIds,
  checkDefects,
  checkDrawCount,
  checkSelection,
  isExactCheckSelection,
  isPooledCheck,
  type LearningModuleDefinition,
  type ModuleCheck,
} from "../src/module/moduleFormat.js";
import { drawCheckOptions } from "../src/module/checkDraw.js";

// The mastery-check MODEL: how truth is carried (per stable option id, not by
// position), how a single- and a multiple-select are validated, and how an
// answer is graded. The UI and the content lean on all three, so they are
// pinned here independent of any rendering.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;
const CHECKS = M1.cards.map((card) => card.check).filter((c): c is ModuleCheck => Boolean(c));

const DASH = /[\u2014\u2013]/; // em dash, en dash

const single = (correctId: string): ModuleCheck => ({
  id: "T.SINGLE",
  prompt: "p",
  reinforcement: "r",
  options: [
    { id: "a", text: "a", correct: correctId === "a", feedback: "fa" },
    { id: "b", text: "b", correct: correctId === "b", feedback: "fb" },
    { id: "c", text: "c", correct: correctId === "c", feedback: "fc" },
  ],
});

const multi = (correctIds: readonly string[]): ModuleCheck => ({
  id: "T.MULTI",
  prompt: "p",
  selection: "multiple",
  reinforcement: "r",
  options: ["a", "b", "c", "d", "e"].map((id) => ({
    id,
    text: id,
    correct: correctIds.includes(id),
    feedback: `f${id}`,
  })),
});

// ---------------------------------------------------------------------------
// Grading: one rule for both shapes
// ---------------------------------------------------------------------------

test("selection defaults to single when omitted", () => {
  assert.equal(checkSelection(single("b")), "single");
  assert.equal(checkSelection(multi(["a", "c"])), "multiple");
});

test("a single-select accepts exactly its one correct option", () => {
  const check = single("b");
  assert.deepEqual(checkCorrectOptionIds(check), ["b"]);
  assert.equal(isExactCheckSelection(check, ["b"]), true);
  assert.equal(isExactCheckSelection(check, ["a"]), false);
  assert.equal(isExactCheckSelection(check, []), false);
  assert.equal(isExactCheckSelection(check, ["a", "b"]), false, "an extra choice is refused");
  assert.equal(isExactCheckSelection(check, ["ghost"]), false, "an unknown id is refused");
});

test("a multiple-select requires the exact correct set", () => {
  const check = multi(["a", "c", "d"]);
  assert.deepEqual(checkCorrectOptionIds(check), ["a", "c", "d"]);
  assert.equal(isExactCheckSelection(check, ["a", "c", "d"]), true);
  assert.equal(isExactCheckSelection(check, ["c", "d"]), false, "a missing correct choice is refused");
  assert.equal(isExactCheckSelection(check, ["a", "c", "d", "b"]), false, "a distractor is refused");
  assert.equal(isExactCheckSelection(check, ["a", "c", "d", "e"]), false, "a distractor is refused");
  // Order does not matter: a set, not a sequence.
  assert.equal(isExactCheckSelection(check, ["d", "a", "c"]), true);
});

// ---------------------------------------------------------------------------
// Validation: single vs multiple shape rules, and bad content
// ---------------------------------------------------------------------------

test("a well-formed single- and multiple-select report no defects", () => {
  assert.deepEqual(checkDefects("card", single("b")), []);
  assert.deepEqual(checkDefects("card", multi(["a", "c", "d"])), []);
  assert.deepEqual(checkDefects("card", multi(["b", "e"])), []);
});

test("a single-select with zero or two correct options is a defect", () => {
  assert.ok(checkDefects("card", single("none")).some((d) => /exactly one/.test(d)));
  const twoCorrect = single("a");
  (twoCorrect.options[1] as { correct: boolean }).correct = true;
  assert.ok(checkDefects("card", twoCorrect).some((d) => /exactly one/.test(d)));
});

test("a multiple-select with an empty correct set is a defect", () => {
  assert.ok(checkDefects("card", multi([])).some((d) => /correct/.test(d)));
});

test("a multiple-select with only one correct option is a defect", () => {
  assert.ok(checkDefects("card", multi(["a"])).some((d) => /two or three/.test(d)));
});

test("a multiple-select with fewer than two distractors is a defect", () => {
  // Four options, three correct → one distractor: not enough to make a set.
  const check = multi(["a", "b", "c"]);
  check.options = check.options.slice(0, 4);
  assert.ok(checkDefects("card", check).some((d) => /distractor/.test(d)));
});

test("duplicate option ids are a defect", () => {
  const check = single("a");
  (check.options[1] as { id: string }).id = "a";
  assert.ok(checkDefects("card", check).some((d) => /duplicate option id/.test(d)));
});

test("an unknown selection value is refused by the loader, not graded as single", () => {
  const env = {
    contentId: "BOS.MD01.CONTENT.MODULE.v1",
    reviewStatus: "AUTHOR_DRAFT",
    budget: {},
    module: JSON.parse(JSON.stringify(M1)) as LearningModuleDefinition,
  };
  const card = env.module.cards.find((c) => c.check)!;
  (card.check as { selection: string }).selection = "multiselect";
  const loaded = loadAuthoredModule(env);
  assert.equal(loaded.ok, false);
  assert.ok(!loaded.ok && loaded.defects.some((d) => /selection/i.test(d)));
});

// ---------------------------------------------------------------------------
// Deterministic load / resume
// ---------------------------------------------------------------------------

test("loading the same envelope twice is deep-equal, with stable option order", () => {
  const env = () => ({
    contentId: "BOS.MD01.CONTENT.MODULE.v1",
    reviewStatus: "AUTHOR_DRAFT",
    budget: {},
    module: JSON.parse(JSON.stringify(M1)) as LearningModuleDefinition,
  });
  const first = loadAuthoredModule(env());
  const second = loadAuthoredModule(env());
  assert.ok(first.ok && second.ok);
  assert.deepEqual(first.ok && first.definition, second.ok && second.definition);
  // A single-select preserves the "no selection field" shape rather than
  // materialising a default the author never wrote.
  const closure = first.ok
    ? first.definition.cards.find((c) => c.check?.id.includes("CLOSURE"))!.check!
    : undefined;
  assert.equal(closure?.selection, undefined);
});

// ---------------------------------------------------------------------------
// The authored M1 checks
// ---------------------------------------------------------------------------

test("the Coercive-Acts scope check is a pooled single-select with a deep distractor pool", () => {
  // Every M1 check is a pooled single-select, so the "exactly one defensible answer
  // per drawable subset" property holds. See checkDraw.test.ts for the enumerated proof.
  const acts = CHECKS.find((c) => c.id.includes("ACTS"))!;
  assert.ok(isPooledCheck(acts), "the acts-scope check is authored as a distractor pool");
  assert.equal(checkSelection(acts), "single");
  assert.equal(acts.correctOption?.correct, true, "exactly one defensible answer");
  assert.ok(
    (acts.distractorPool?.length ?? 0) >= checkDrawCount(acts),
    "the pool is at least as deep as one drawn option set",
  );
});

/** A check's authored options, resolving the pooled shape to answer + pool. */
function authoredOptions(check: ModuleCheck) {
  return check.options ?? [check.correctOption!, ...(check.distractorPool ?? [])];
}

test("every authored M1 check is well formed and free of em/en dashes", () => {
  for (const check of CHECKS) {
    assert.deepEqual(checkDefects("m1", check), [], `${check.id} is well formed`);
    const opts = authoredOptions(check);
    // No em/en dashes anywhere a learner reads: prompt, options, feedback,
    // reinforcement. The dash is the most obvious tell of synthetic prose.
    const prose = [check.prompt, check.reinforcement, ...opts.flatMap((o) => [o.text, o.feedback])];
    for (const line of prose) {
      assert.doesNotMatch(line, DASH, `em/en dash in ${check.id}: "${line}"`);
    }
    // Option ids are unique within the check.
    const ids = opts.map((o) => o.id);
    assert.equal(new Set(ids).size, ids.length, `${check.id} option ids are unique`);
    // Every option carries feedback, and there is at least one correct and one distractor.
    assert.ok(opts.every((o) => o.feedback.trim().length > 0));
    assert.ok(opts.some((o) => o.correct) && opts.some((o) => !o.correct));
  }
});

test("a drawn check never leaves its answer at a fixed position across attempts", () => {
  // With pooled checks, option order is DRAWN per attempt, not authored — so
  // "the answer is always A" is defeated by the drawer rather than by authoring.
  // The full id-keyed grading proof lives in checkDraw.test.ts.
  for (const check of CHECKS) {
    if (!isPooledCheck(check)) continue;
    const positions = new Set<number>();
    for (let ordinal = 1; ordinal <= MAX_MISSION_ATTEMPTS; ordinal += 1) {
      const drawn = drawCheckOptions(check, ordinal);
      positions.add((drawn.options ?? []).findIndex((o) => o.correct));
    }
    assert.ok(positions.size > 1, `${check.id}: answer sat at one position across all attempts`);
  }
});
