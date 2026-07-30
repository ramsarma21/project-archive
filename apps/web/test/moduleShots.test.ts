import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import {
  SUBTITLE_HARD_MAX_WORDS,
  directorOnCheckMastered,
  directorOnSceneEnd,
  moduleProgressFraction,
  moduleSegmentCount,
  planCardShots,
  planModuleShots,
  segmentBeatText,
  segmentDurations,
} from "../src/module/moduleShots.js";
import { moduleRequiredCheckIds } from "../src/module/moduleFormat.js";

// The cutscene director is pure: subtitle granularity, shot selection and the
// scene-end transitions are all decided here without a DOM, a canvas or a clock,
// so the whole shot language can be pinned by unit tests.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;
const words = (text: string) => text.split(/\s+/).filter(Boolean);

// ---------------------------------------------------------------------------
// Subtitle granularity
// ---------------------------------------------------------------------------

test("a long narration beat is split into short subtitle lines", () => {
  const beat =
    "Boston, the fourteenth of August, 1765. You run printed sheets through " +
    "this town for Mercer's Press, and nobody looks at you twice.";
  const lines = segmentBeatText(beat);
  assert.ok(lines.length >= 2, "a multi-sentence beat becomes several lines");
  for (const line of lines) {
    assert.ok(
      words(line).length <= SUBTITLE_HARD_MAX_WORDS,
      `line over the hard ceiling: "${line}"`,
    );
  }
});

test("segmentation changes granularity but never the words", () => {
  // Every authored beat, rejoined, is the same word sequence in the same order:
  // the history is untouched; only the on-screen chunking changes.
  for (const card of M1.cards) {
    for (const beat of card.scene?.beats ?? []) {
      const rejoined = segmentBeatText(beat.text).join(" ");
      assert.deepEqual(words(rejoined), words(beat.text), `beat ${beat.id}`);
    }
  }
});

test("a short line is left as a single subtitle", () => {
  const lines = segmentBeatText("Not one member.");
  assert.deepEqual(lines, ["Not one member."]);
});

test("every subtitle line in the whole module is within the ceiling", () => {
  for (const list of planModuleShots(M1)) {
    for (const segment of list) {
      assert.ok(
        words(segment.text).length <= SUBTITLE_HARD_MAX_WORDS,
        `over ceiling: "${segment.text}"`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Shot selection
// ---------------------------------------------------------------------------

test("the deck opens on an establishing wide of the room", () => {
  const first = planCardShots(M1.cards[0]!, 0);
  assert.equal(first[0]!.shot, "ESTABLISH");
  assert.equal(first[0]!.visual, undefined, "the opening shot is the room, not an image");
});

test("a historical visual materializes over the shoulder, then pushes in", () => {
  const closureIndex = M1.cards.findIndex((c) => c.id.includes("CLOSURE"));
  const segments = planCardShots(M1.cards[closureIndex]!, closureIndex);

  const firstVisual = segments.find((s) => s.visual);
  assert.ok(firstVisual, "the closure card carries a visual");
  assert.equal(firstVisual!.shot, "OVER_SHOULDER");
  assert.equal(firstVisual!.visualMotion, "assemble");

  // A later segment on the same visual pushes into a focus shot with a pan/zoom.
  const focus = segments.find((s) => s.shot === "VISUAL_FOCUS");
  assert.ok(focus, "the same visual gets a focus shot");
  assert.equal(focus!.visualMotion, "kenburns");
});

test("a card with a check returns to a reaction shot before it", () => {
  const checked = M1.cards.find((c) => c.check)!;
  const index = M1.cards.indexOf(checked);
  const segments = planCardShots(checked, index);
  const last = segments.at(-1)!;
  assert.equal(last.shot, "REACTION");
  assert.equal(last.visual, undefined, "the reaction is on the presenter, not an image");
});

test("the first forty-five seconds move through several compositions", () => {
  // Flatten the module's segments in play order and walk their presentation
  // durations up to 45s; the opening must not be one static composition.
  const flat = planModuleShots(M1).flat();
  const durations = segmentDurations(flat);
  const shots = new Set<string>();
  let withVisual = 0;
  let elapsed = 0;
  for (let at = 0; at < flat.length && elapsed < 45_000; at += 1) {
    shots.add(flat[at]!.shot);
    if (flat[at]!.visual) withVisual += 1;
    elapsed += durations[at]!;
  }
  assert.ok(shots.size >= 3, `only ${shots.size} shot kinds in the first 45s`);
  assert.ok(withVisual >= 1, "no historical visual appears in the first 45s");
});

test("shot planning is deterministic", () => {
  assert.deepEqual(planCardShots(M1.cards[1]!, 1), planCardShots(M1.cards[1]!, 1));
});

// ---------------------------------------------------------------------------
// The progress line
// ---------------------------------------------------------------------------

test("progress is monotonic from zero toward one", () => {
  assert.ok(moduleSegmentCount(M1) > 0);
  const start = moduleProgressFraction(M1, 0, 0);
  const mid = moduleProgressFraction(M1, 3, 0);
  const end = moduleProgressFraction(M1, M1.cards.length - 1, 99);
  assert.ok(start > 0 && start < mid, "progress advances across cards");
  assert.ok(mid < end);
  assert.equal(end, 1, "the last segment of the last card is full");
});

// ---------------------------------------------------------------------------
// Automatic transitions and the check gate
// ---------------------------------------------------------------------------

test("a scene end pauses for an unmastered required check", () => {
  const checkedIndex = M1.cards.findIndex((c) => c.check);
  const check = M1.cards[checkedIndex]!.check!;
  const action = directorOnSceneEnd(M1, checkedIndex, []);
  assert.deepEqual(action, { kind: "SHOW_CHECK", checkId: check.id });
});

test("a mastered check does not pause the cutscene again", () => {
  const checkedIndex = M1.cards.findIndex((c) => c.check);
  const check = M1.cards[checkedIndex]!.check!;
  const action = directorOnSceneEnd(M1, checkedIndex, [check.id]);
  assert.deepEqual(action, { kind: "NEXT_CARD", cardIndex: checkedIndex + 1 });
});

test("a scene with no check rolls straight to the next card", () => {
  // The identity card (0) has no check; playback advances automatically.
  assert.deepEqual(directorOnSceneEnd(M1, 0, []), { kind: "NEXT_CARD", cardIndex: 1 });
});

test("the last card completes the module", () => {
  const last = M1.cards.length - 1;
  const mastered = moduleRequiredCheckIds(M1);
  assert.deepEqual(directorOnSceneEnd(M1, last, mastered), { kind: "COMPLETE" });
});

test("mastering a check resumes into the next card, or completes on the last", () => {
  const checkedIndex = M1.cards.findIndex((c) => c.check);
  assert.deepEqual(directorOnCheckMastered(M1, checkedIndex), {
    kind: "NEXT_CARD",
    cardIndex: checkedIndex + 1,
  });
  assert.deepEqual(directorOnCheckMastered(M1, M1.cards.length - 1), { kind: "COMPLETE" });
});
