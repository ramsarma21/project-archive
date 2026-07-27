import { test } from "node:test";
import assert from "node:assert/strict";
import { M1_CONTENT } from "../src/module/m1Module.js";
import { SUBTITLE_HARD_MAX_WORDS, planModuleShots } from "../src/module/moduleShots.js";

// The owner's note on the rebuilt lesson: the subtitles still read as
// AI-generated. These pin the copy fix so it cannot regress — over the ACTUAL
// rendered subtitle cues (the segmented lines the player shows), not the raw
// authored paragraphs, because the cue is what a learner reads on screen.

if (!M1_CONTENT.ok) {
  throw new Error(`content/m1/module.json did not load: ${M1_CONTENT.defects.join("; ")}`);
}
const M1 = M1_CONTENT.definition;

/** Every subtitle cue the player will actually render, in play order. */
function renderedCues(): string[] {
  return planModuleShots(M1).flat().map((segment) => segment.text);
}

const words = (text: string) => text.split(/\s+/).filter(Boolean);

test("no rendered subtitle cue uses an em dash or an en dash", () => {
  // The single most obvious tell of synthetic prose the note called out. The
  // constraint is on spoken/subtitle prose only; source titles and captions
  // (which may carry a dash in a date or an attribution) are not cues.
  for (const cue of renderedCues()) {
    assert.doesNotMatch(cue, /[\u2014\u2013]/, `em/en dash in subtitle: "${cue}"`);
  }
});

test("the raw authored narration beats are also free of em/en dashes", () => {
  for (const card of M1.cards) {
    for (const beat of card.scene?.beats ?? []) {
      assert.doesNotMatch(beat.text, /[\u2014\u2013]/, `em/en dash in beat ${beat.id}`);
    }
  }
});

test("every rendered subtitle cue stays within the word ceiling", () => {
  for (const cue of renderedCues()) {
    assert.ok(
      words(cue).length <= SUBTITLE_HARD_MAX_WORDS,
      `over ceiling (${words(cue).length}): "${cue}"`,
    );
  }
});

test("subtitle cues read as short spoken lines, not paragraphs", () => {
  // A cutscene cue is one short thought. The vast majority should sit at or
  // under the conversational target; a handful of unbreakable single clauses
  // (a list, a quoted phrase) may run longer but never past the hard ceiling.
  const cues = renderedCues();
  const longish = cues.filter((cue) => words(cue).length > 15);
  assert.ok(
    longish.length <= Math.ceil(cues.length * 0.2),
    `too many long cues: ${longish.length}/${cues.length}`,
  );
});

test("no cue is a robotic label fragment", () => {
  // "Inside it:", "Outside it:" and bare colon-labels were exactly the stacked,
  // machine-cadence habit the note flagged. A cue should be a sentence.
  for (const cue of renderedCues()) {
    assert.doesNotMatch(cue, /^(Inside|Outside|Note|Remember|Fact)\b.*:$/i, `label cue: "${cue}"`);
    assert.doesNotMatch(cue, /:$/, `cue ends on a dangling colon: "${cue}"`);
  }
});

test("the historical claims and item identities survive the rewrite", () => {
  // Meaning is preserved: the load-bearing facts and the concrete items the
  // duel checks against must still be spoken somewhere in the deck.
  const all = renderedCues().join(" ").toLowerCase();
  for (const claim of [
    "1763", // the war's end / the debt's origin
    "army", // an army still to pay for in America
    "november", // the stamp takes effect 1 November
    "playing cards", // inside the tax
    "nails", // outside the tax (ordinary goods)
    "farthing", // the objection is consent, not price
    "parliament", // who laid the tax
    "consent", // the representation claim
  ]) {
    assert.ok(all.includes(claim), `the rewrite dropped the claim/item "${claim}"`);
  }
});
