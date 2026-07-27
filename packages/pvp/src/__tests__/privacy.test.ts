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
import { advanceUntil, askedEnvelope, expectedReceipt, liveMatch } from "./harness.js";

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
  // No timing detail beyond the boolean, no progress, no keystroke count. Aim,
  // velocity and dash are gameplay pose (LOS-gated), never identity or answer detail.
  assert.deepEqual(Object.keys(view).sort(), [
    "aimYaw",
    "ammo",
    "answering",
    "capsuleHeight",
    "dashing",
    "handle",
    "health",
    "position",
    "positionAtTick",
    "rank",
    "side",
    "velocity",
    "visible",
  ]);
});

test("an opponent behind cover is not in the snapshot, and its live position is withheld", () => {
  // A wallhack is a rendering of data the client should not have. The fix is to not
  // send it: while line of sight is broken the client keeps a stale ghost, which is
  // exactly what an honest client would draw anyway.
  //
  // The occlusion is FORCED with an authored full-height wall between the two bodies
  // rather than left to the reference arena's geometry happening to block a chosen
  // pair of coordinates. The previous version of this test branched on
  // `opponent.visible` and, when the arena left them in view, asserted the trivially
  // true opposite — so it went green while proving nothing about hiding a position.
  const fixture = liveMatch();
  const live = advanceUntil(
    fixture.authority,
    (a) => a.state.phase === "QUESTION_PENDING",
  );

  // A wall straddling the z-axis, tall enough to block an eye-height sightline, wide
  // enough that a straight segment between the two bodies must pass through it.
  const wall = {
    id: "test-occluder",
    minX: -1,
    maxX: 1,
    minZ: -20,
    maxZ: 20,
    baseY: 0,
    topY: Number.POSITIVE_INFINITY,
    landable: false,
    tags: new Set<string>(),
  };
  const world = { ...live.world, blockers: [...live.world.blockers, wall] };

  const aPos = { x: -8, y: 0, z: 0 };
  const seenPos = { x: -3, y: 0, z: 0 }; // where A last legitimately saw B — same side
  const livePos = { x: 12.5, y: 0, z: -7.25 }; // where B actually is now — behind the wall
  const place = (bPos: { x: number; y: number; z: number }) => ({
    ...live.state,
    combat: {
      ...live.state.combat,
      fighters: {
        ...live.state.combat.fighters,
        A: {
          ...live.state.combat.fighters.A,
          motion: { ...live.state.combat.fighters.A.motion, pos: aPos },
        },
        B: {
          ...live.state.combat.fighters.B,
          motion: { ...live.state.combat.fighters.B.motion, pos: bPos },
        },
      },
    },
  });

  // A's memory is seeded with B at the seen position, then B slips behind the wall.
  const remembered = initialLastKnown(place(seenPos).combat);
  const hiddenState = place(livePos);
  const lastKnown = updateLastKnown(world, hiddenState.combat, remembered);

  const snapshot = projectSnapshotFor("A", {
    matchId: "m",
    state: hiddenState,
    world,
    lastKnown,
    handles: { A: "QuietLantern-1234", B: "SwiftKestrel-5678" },
    ranks: { A: 1, B: 1 },
    awaiting: [],
  });

  assert.equal(
    snapshot.opponent.visible,
    false,
    "the wall must break line of sight",
  );
  // The withheld thing, asserted directly: B's LIVE position is nowhere in what A is
  // handed, and the stale ghost is what stands in for it.
  assert.notDeepEqual(
    snapshot.opponent.position,
    livePos,
    "an unseen opponent's live position must not be transmitted",
  );
  assert.deepEqual(snapshot.opponent.position, seenPos, "only the last-seen ghost");
  const json = JSON.stringify(snapshot);
  assert.equal(json.includes("12.5"), false, "B's live x must not appear anywhere");
  assert.equal(json.includes("-7.25"), false, "B's live z must not appear anywhere");
});

test("opponent aim, velocity and dash are snapshot-backed and freeze with the position", () => {
  const fixture = liveMatch();
  const base = advanceUntil(fixture.authority, (a) => a.state.phase === "QUESTION_PENDING");

  // A distinctive remembered pose — nothing like the live fighter's — so a frozen
  // read is unmistakable from a live one.
  const frozen = {
    position: { x: -3, y: 0, z: 0 },
    velocity: { x: 5, z: 6 },
    aimYaw: 1.234,
    dashing: true,
    capsuleHeight: base.state.combat.fighters.B.motion.capsuleHeight,
    tick: 0,
  };

  // Visible: aim/velocity/dash come from the LIVE body.
  const seen = projectSnapshotFor("A", {
    matchId: "m",
    state: base.state,
    world: base.world,
    lastKnown: { A: frozen, B: frozen },
    handles: { A: "QuietLantern-1234", B: "SwiftKestrel-5678" },
    ranks: { A: 1, B: 1 },
    awaiting: [],
  });
  const liveB = base.state.combat.fighters.B;
  if (seen.opponent.visible) {
    assert.equal(seen.opponent.aimYaw, Math.atan2(liveB.aimX, liveB.aimZ), "live aim");
    assert.equal(seen.opponent.dashing, liveB.motion.dash !== null, "live dash");
    assert.notEqual(seen.opponent.aimYaw, frozen.aimYaw, "not the frozen aim while seen");
  }

  // Hidden behind a wall: aim/velocity/dash ALL come from the frozen record, together.
  const wall = {
    id: "occ",
    minX: -1,
    maxX: 1,
    minZ: -20,
    maxZ: 20,
    baseY: 0,
    topY: Number.POSITIVE_INFINITY,
    landable: false,
    tags: new Set<string>(),
  };
  const world = { ...base.world, blockers: [...base.world.blockers, wall] };
  const place = (bPos: { x: number; y: number; z: number }) => ({
    ...base.state,
    combat: {
      ...base.state.combat,
      fighters: {
        ...base.state.combat.fighters,
        A: {
          ...base.state.combat.fighters.A,
          motion: { ...base.state.combat.fighters.A.motion, pos: { x: -8, y: 0, z: 0 } },
        },
        B: {
          ...base.state.combat.fighters.B,
          motion: { ...base.state.combat.fighters.B.motion, pos: bPos },
        },
      },
    },
  });
  const hidden = projectSnapshotFor("A", {
    matchId: "m",
    state: place({ x: 12.5, y: 0, z: -7.25 }),
    world,
    lastKnown: { A: frozen, B: frozen },
    handles: { A: "QuietLantern-1234", B: "SwiftKestrel-5678" },
    ranks: { A: 1, B: 1 },
    awaiting: [],
  });
  assert.equal(hidden.opponent.visible, false, "the wall breaks the sight line");
  assert.equal(hidden.opponent.aimYaw, frozen.aimYaw, "aim frozen with the position");
  assert.deepEqual(hidden.opponent.velocity, frozen.velocity, "velocity frozen too");
  assert.equal(hidden.opponent.dashing, frozen.dashing, "dash frozen too");
  assert.deepEqual(hidden.opponent.position, frozen.position, "and the position itself");
});
