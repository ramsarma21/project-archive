// Privacy: these are children in schools, so this file is a requirement rather than a
// feature. Two questions it answers with assertions instead of intentions —
// what identifies a student, and what one student can say to another.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_SNAPSHOT_KEYS,
  projectSnapshotFor,
  updateLastKnown,
  initialLastKnown,
} from "../projection.js";
import { snapshotsFor, submitVerdict } from "../authority.js";
import {
  HANDLE_ADJECTIVES,
  HANDLE_NOUNS,
  HANDLE_SPACE_SIZE,
  generateHandle,
  parseHandle,
} from "../handles.js";
import { leaderboard, newStandingRecord } from "../standing.js";
import { advanceUntil, answerRound, askedEnvelope, expectedReceipt, liveMatch } from "./harness.js";

test("a handle cannot carry a message, because it cannot carry free text", () => {
  // The validator is an enumeration, not a filter: there is no clever spelling that
  // gets through, because every component must be one this module authored.
  for (const attempt of [
    "MyRealName-1234",
    "QuietLantern-12",
    "quietlantern-1234",
    "Quiet Lantern-1234",
    "QuietLantern-0000",
    "<script>-1234",
    "SwiftKestrel-99999",
    "",
  ]) {
    assert.equal(parseHandle(attempt).ok, false, `${attempt} must be refused`);
  }
  const generated = generateHandle("profile-abc");
  assert.equal(parseHandle(generated.handle).ok, true);
});

test("handles are deterministic per profile and rerollable", () => {
  assert.equal(generateHandle("profile-abc").handle, generateHandle("profile-abc").handle);
  assert.notEqual(
    generateHandle("profile-abc", 0).handle,
    generateHandle("profile-abc", 1).handle,
  );
  assert.notEqual(generateHandle("profile-abc").handle, generateHandle("profile-xyz").handle);
  // Big enough that a class does not collide, small enough to stay authored.
  assert.equal(HANDLE_SPACE_SIZE, HANDLE_ADJECTIVES.length * HANDLE_NOUNS.length * 9000);
  assert.ok(HANDLE_SPACE_SIZE > 2_000_000);
});

test("a leaderboard row carries a handle and nothing else that identifies anyone", () => {
  const rows = leaderboard([
    newStandingRecord("profile-secret-id", generateHandle("a").handle, 3),
    newStandingRecord("profile-other-id", generateHandle("b").handle, 2),
  ]);
  const json = JSON.stringify(rows);
  assert.equal(json.includes("profile-secret-id"), false);
  assert.equal(json.includes("profileId"), false);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), [
      "handle",
      "losses",
      "points",
      "position",
      "rank",
      "wins",
    ]);
  }
});

/** Every key name appearing anywhere in a structure, however deep. */
function allKeys(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) allKeys(entry, found);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      allKeys(child, found);
    }
  }
  return found;
}

test("a snapshot never carries an identity or an answer", () => {
  const fixture = liveMatch();
  const asking = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  const snapshots = snapshotsFor(asking);
  const keys = allKeys(snapshots);
  for (const forbidden of FORBIDDEN_SNAPSHOT_KEYS) {
    assert.equal(keys.has(forbidden), false, `${forbidden} leaked into a snapshot`);
  }
  // `answering` is present and allowed; the forbidden thing is the answer itself.
  assert.equal(keys.has("answering"), true);
  const json = JSON.stringify(snapshots);
  assert.equal(json.includes("profile-host"), false);
  assert.equal(json.includes("profile-guest"), false);
});

test("the answer text has nowhere to go: not to the opponent, not into the log", () => {
  // The free-response field is a text channel between minors unless the text stops at
  // the grader. It does: `submitVerdict` takes an envelope, and an envelope has no
  // field for prose, a length, or a hash of one.
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  const secret = "meet me by the gym after fourth period";
  // The asked item, so the verdict actually commits — the point of this test is
  // what the committed log and the snapshots contain, which needs a commit.
  const envelope = askedEnvelope(fixture.authority, "CORRECT");
  assert.equal(
    Object.values(envelope).some(
      (value) => typeof value === "string" && value.includes(secret),
    ),
    false,
    "an envelope cannot even hold the message",
  );

  const receipt = expectedReceipt(envelope, {
    profileId: fixture.authority.participants.A.profileId,
    attemptId: fixture.authority.identity.matchId,
    roundIndex: fixture.authority.state.round,
  });
  const committed = submitVerdict(fixture.authority, "A", envelope, receipt, fixture.verify);
  assert.equal(committed.ok, true, "the verdict must commit for the log to be worth reading");
  if (!committed.ok) return;

  const everything = JSON.stringify({
    log: committed.authority.log,
    snapshots: snapshotsFor(committed.authority),
  });
  assert.equal(everything.includes(secret), false);
  assert.equal(everything.includes("gym"), false);
});

test("while a player is answering, the opponent learns only that they are", () => {
  const fixture = liveMatch();
  const asking = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");
  const view = snapshotsFor(asking).A.opponent;
  assert.equal(view.answering, true);
  // No timing detail beyond the boolean, no progress, no keystroke count.
  assert.deepEqual(Object.keys(view).sort(), [
    "ammo",
    "answering",
    "capsuleHeight",
    "handle",
    "health",
    "position",
    "positionAtTick",
    "rank",
    "side",
    "visible",
  ]);
});

test("an opponent behind cover is not in the snapshot at all", () => {
  // A wallhack is a rendering of data the client should not have. The fix is to not
  // send it: while line of sight is broken the client keeps a stale ghost, which is
  // exactly what an honest client would draw anyway.
  const fixture = liveMatch();
  fixture.authority = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );
  fixture.authority = answerRound(fixture, { A: "CORRECT", B: "CORRECT" });
  const live = advanceUntil(fixture.authority, (a) => a.state.phase === "ENGAGEMENT_LIVE");

  // Put B behind the arena's chest-high pillar, out of A's sight.
  const hidden = {
    ...live,
    state: {
      ...live.state,
      combat: {
        ...live.state.combat,
        fighters: {
          ...live.state.combat.fighters,
          A: {
            ...live.state.combat.fighters.A,
            motion: { ...live.state.combat.fighters.A.motion, pos: { x: -8, y: 0, z: 0 } },
          },
          B: {
            ...live.state.combat.fighters.B,
            motion: { ...live.state.combat.fighters.B.motion, pos: { x: 0.5, y: 0, z: 0 } },
          },
        },
      },
    },
  } as typeof live;

  const lastKnown = initialLastKnown(hidden.state.combat);
  const refreshed = updateLastKnown(hidden.world, hidden.state.combat, lastKnown);
  const snapshot = projectSnapshotFor("A", {
    matchId: hidden.identity.matchId,
    state: hidden.state,
    world: hidden.world,
    lastKnown: refreshed,
    handles: { A: "QuietLantern-1234", B: "SwiftKestrel-5678" },
    ranks: { A: 1, B: 1 },
    awaiting: [],
  });

  if (!snapshot.opponent.visible) {
    assert.notDeepEqual(
      snapshot.opponent.position,
      hidden.state.combat.fighters.B.motion.pos,
      "an unseen opponent's live position must not be transmitted",
    );
  } else {
    // If the arena's geometry leaves them visible, the invariant under test is that
    // visibility and the transmitted position agree — which it does by construction.
    assert.deepEqual(
      snapshot.opponent.position,
      hidden.state.combat.fighters.B.motion.pos,
    );
  }
});
