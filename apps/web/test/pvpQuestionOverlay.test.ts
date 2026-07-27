// The centered PvP overlay's decision: what it shows, and — the load-bearing rule —
// when it shows a countdown. The renderer is verified by looking at it; this pins the
// pure view so the countdown never appears while the opponent is still answering, and
// the overlay disappears the instant combat resumes.

import test from "node:test";
import assert from "node:assert/strict";
import type { DuelPhase } from "@pa/duel";
import { pvpOverlayView } from "../src/pvp/pvpQuestionView.js";
import type { MatchSnapshot, QuestionPayload } from "../src/pvp/protocol.js";

function snap(over: {
  phase: DuelPhase;
  opponentAnswering?: boolean;
  resumeCountdownSeconds?: number | null;
}): MatchSnapshot {
  return {
    matchId: "m",
    tick: 100,
    phase: over.phase,
    round: 2,
    self: {
      side: "A",
      position: { x: 0, y: 0, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 0,
      dashing: false,
      invulnerableUntilTick: 0,
      dodgeReadyAtTick: 0,
      abilityUsesRemaining: {},
    },
    opponent: {
      side: "B",
      handle: "QuietLantern-1234",
      rank: 1,
      position: { x: 0, y: 0, z: 6 },
      velocity: { x: 0, z: 0 },
      aimYaw: 0,
      dashing: false,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 0,
      visible: true,
      positionAtTick: 100,
      answering: over.opponentAnswering ?? false,
    },
    projectiles: [],
    resumeCountdownSeconds: over.resumeCountdownSeconds ?? null,
  };
}

const question: QuestionPayload = {
  itemId: "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1",
  question: "Name the right.",
  appearance: 1,
  recycled: false,
  codexCardIds: ["BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1"],
};

test("the overlay is hidden once combat is live", () => {
  const view = pvpOverlayView({
    snapshot: snap({ phase: "ENGAGEMENT_LIVE" }),
    question: null,
    lastVerdict: "CORRECT",
  });
  assert.equal(view.mode, "HIDDEN");
});

test("a question shows the question form", () => {
  const view = pvpOverlayView({
    snapshot: snap({ phase: "QUESTION_PENDING" }),
    question,
    lastVerdict: null,
  });
  assert.equal(view.mode, "QUESTION");
  if (view.mode === "QUESTION") assert.equal(view.question.itemId, question.itemId);
});

test("after answering, with the opponent still answering, it waits and shows NO countdown", () => {
  const view = pvpOverlayView({
    // This side answered (question is null), opponent still answering, server still
    // QUESTION_PENDING, so there is no authoritative countdown yet.
    snapshot: snap({ phase: "QUESTION_PENDING", opponentAnswering: true, resumeCountdownSeconds: null }),
    question: null,
    lastVerdict: "CORRECT",
  });
  assert.equal(view.mode, "WAITING");
  if (view.mode === "WAITING") {
    assert.equal(view.opponentAnswering, true);
    assert.equal(view.verdict, "CORRECT");
  }
});

test("once both verdicts land, the countdown shows the server's whole seconds", () => {
  for (const seconds of [3, 2, 1]) {
    const view = pvpOverlayView({
      snapshot: snap({ phase: "BULLETS_GRANTED", resumeCountdownSeconds: seconds }),
      question: null,
      lastVerdict: "WRONG",
    });
    assert.equal(view.mode, "COUNTDOWN");
    if (view.mode === "COUNTDOWN") {
      assert.equal(view.seconds, seconds, "the shown number is the server's, not a local timer");
      assert.equal(view.verdict, "WRONG");
    }
  }
});

test("the exact 3 → 2 → 1 sequence flows straight from successive snapshots", () => {
  const shown = [3, 2, 1].map((seconds) => {
    const view = pvpOverlayView({
      snapshot: snap({ phase: "BULLETS_GRANTED", resumeCountdownSeconds: seconds }),
      question: null,
      lastVerdict: null,
    });
    return view.mode === "COUNTDOWN" ? view.seconds : null;
  });
  assert.deepEqual(shown, [3, 2, 1]);
});
