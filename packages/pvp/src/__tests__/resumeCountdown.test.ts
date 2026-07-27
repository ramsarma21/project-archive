// The authoritative post-answer countdown, projected.
//
// @pa/duel already owns the 3-second BULLETS_GRANTED window (`resumesAtTick`, 180
// ticks at 60 Hz). These tests prove the projection exposes it as whole display
// seconds derived ONLY from the server tick, never as a second timer:
//
//   - it is null while a side still owes an answer, so no false countdown shows;
//   - it is exactly 3 the instant both verdicts land and the machine grants bullets;
//   - it steps 3 → 2 → 1 monotonically as the server tick advances;
//   - it is null again the moment the fight resumes into ENGAGEMENT_LIVE.

import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_DT, FIELD_TICK_HZ } from "@pa/duel";
import { resumeCountdownSecondsFor, snapshotsFor } from "../index.js";
import { advanceMatch } from "../authority.js";
import { advanceUntil, answerRound, liveMatch } from "./harness.js";

test("no countdown is shown while a side still owes an answer", () => {
  const fixture = liveMatch();
  const asking = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  // A question is open: neither side has answered, so there is nothing to count down.
  assert.equal(snapshotsFor(asking).A.resumeCountdownSeconds, null);
  assert.equal(snapshotsFor(asking).B.resumeCountdownSeconds, null);
  assert.equal(resumeCountdownSecondsFor(asking.state), null);
});

test("the countdown is exactly 3 the instant both verdicts land, then steps 3 → 2 → 1", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  // Both answer, so the machine leaves QUESTION_PENDING for VERDICT_COMMITTED.
  let authority = answerRound(fixture, { A: "CORRECT", B: "CORRECT" });
  // Advancing grants bullets and opens the 3-second countdown.
  authority = advanceUntil(authority, (a) => a.state.phase === "BULLETS_GRANTED");
  assert.equal(authority.state.phase, "BULLETS_GRANTED", "bullets are granted after both verdicts");
  assert.equal(
    snapshotsFor(authority).A.resumeCountdownSeconds,
    3,
    "the first shown value is a full 3 seconds",
  );

  // Walk the whole BULLETS_GRANTED window a tick at a time, recording each shown
  // second, until the fight resumes.
  const shown: number[] = [];
  let guard = 0;
  while (authority.state.phase === "BULLETS_GRANTED" && guard < 10 * FIELD_TICK_HZ) {
    shown.push(snapshotsFor(authority).A.resumeCountdownSeconds as number);
    authority = advanceMatch(authority, FIELD_DT).authority;
    guard += 1;
  }

  // Every value is one of 3, 2, 1 (0 is the boundary tick, at which the machine has
  // already resumed), and the sequence never counts up.
  assert.ok(shown.length > 0);
  for (let i = 1; i < shown.length; i += 1) {
    assert.ok(shown[i]! <= shown[i - 1]!, `monotone non-increasing at ${i}: ${shown.join(",")}`);
  }
  assert.equal(shown[0], 3, "starts at 3");
  assert.ok(shown.includes(2), "passes through 2");
  assert.ok(shown.includes(1), "passes through 1");
  // The distinct values shown are exactly {3, 2, 1}: 0 belongs to ENGAGEMENT_LIVE.
  assert.deepEqual([...new Set(shown)].sort((x, y) => y - x), [3, 2, 1]);
});

test("the countdown is null again the instant the fight resumes", () => {
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  let authority = answerRound(fixture, { A: "CORRECT", B: "CORRECT" });
  authority = advanceUntil(authority, (a) => a.state.phase === "ENGAGEMENT_LIVE");
  assert.equal(
    snapshotsFor(authority).A.resumeCountdownSeconds,
    null,
    "no countdown once combat is live",
  );
  assert.equal(resumeCountdownSecondsFor(authority.state), null);
});
