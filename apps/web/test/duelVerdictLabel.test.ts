// The verdict beat must never call an UNGRADED round "Correct".
//
// The boss-fight owner played `?verdict=live` with no classifier credential set, so
// every round came back as the generous outage grant (kind CORRECT, source
// GRADING_TIMEOUT) and the beat labelled each one "Correct". He read that, correctly,
// as "I'm getting it wrong and still getting the right answer". The grant itself is
// deliberate (a student is never punished for infrastructure); calling an ungraded
// grant "Correct" is the lie. These pin the label so that regression cannot return
// silently — it is exactly the class of defect this repo keeps rediscovering in play.

import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { verdictBeatTone } from "../src/duel/verdictLabel.js";
import { VerdictBeat } from "../src/duel/DuelOverlay.js";
import type { DuelHud } from "../src/duel/duelRuntime.js";

test("an ungraded generous grant is NOT labelled Correct", () => {
  // The exact shape a classifier-off round produces: a generous CORRECT the grader
  // never decided.
  const ungraded = verdictBeatTone({ kind: "CORRECT", source: "GRADING_TIMEOUT" });
  assert.equal(ungraded.tone, "UNGRADED");
  assert.equal(ungraded.label, "Not graded");
  assert.notEqual(ungraded.label, "Correct");
  // And it must not wear the "correct" colour.
  assert.equal(ungraded.cssModifier, " is-ungraded");
});

test("a genuinely graded verdict still reads Correct or Wrong", () => {
  const correct = verdictBeatTone({ kind: "CORRECT", source: "CLASSIFIER" });
  assert.equal(correct.tone, "GRADED_CORRECT");
  assert.equal(correct.label, "Correct");
  assert.equal(correct.cssModifier, " is-correct");

  const wrong = verdictBeatTone({ kind: "WRONG", source: "CLASSIFIER" });
  assert.equal(wrong.tone, "GRADED_WRONG");
  assert.equal(wrong.label, "Wrong");
  assert.equal(wrong.cssModifier, " is-wrong");
});

test("no verdict yet reads as pending, never as a judgement", () => {
  for (const v of [null, undefined]) {
    const pending = verdictBeatTone(v);
    assert.equal(pending.tone, "PENDING");
    assert.equal(pending.label, "Verdict in");
  }
});

// The rendered beat, not just the helper: prove the panel a player actually sees for
// an ungraded round says "Not graded" and never "Correct". This is the exact on-screen
// text the owner read as "still getting the right answer".
function hudWith(verdict: { kind: string; source: string }): DuelHud {
  return {
    grants: { A: { granted: 14, carriedIn: 0, expired: 0, magazine: 14 } },
    lastVerdict: verdict,
    secondsRemaining: 3,
  } as unknown as DuelHud;
}

function renderText(element: React.ReactElement): string {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(element);
  });
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") texts.push(node);
    else if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object" && "children" in (node as object)) {
      walk((node as { children: unknown }).children);
    }
  };
  walk(renderer.toJSON());
  act(() => renderer.unmount());
  return texts.join(" ");
}

test("the rendered VerdictBeat shows 'Not graded', not 'Correct', for an outage grant", () => {
  const text = renderText(
    React.createElement(VerdictBeat, {
      hud: hudWith({ kind: "CORRECT", source: "GRADING_TIMEOUT" }),
      grantOrigin: "AUTHORITY",
      serverFallbackDiagnosis: "NO_CREDENTIAL",
    }),
  );
  assert.ok(text.includes("Not graded"), `expected "Not graded" in: ${text}`);
  assert.ok(!/\bCorrect\b/.test(text), `must not say "Correct" for an ungraded round: ${text}`);
});

test("the rendered VerdictBeat still shows 'Correct' for a graded CLASSIFIER verdict", () => {
  const text = renderText(
    React.createElement(VerdictBeat, {
      hud: hudWith({ kind: "CORRECT", source: "CLASSIFIER" }),
      grantOrigin: "AUTHORITY",
      serverFallbackDiagnosis: null,
    }),
  );
  assert.ok(text.includes("Correct"), `expected "Correct" in: ${text}`);
});
