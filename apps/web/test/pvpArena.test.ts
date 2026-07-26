import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_TICK_HZ, buildArena, referenceArena } from "@pa/duel";
import {
  SIGHTING_GHOST_SECONDS,
  createSnapshotFeed,
  staleBodyOpacity,
} from "../src/pvp/arenaFeed.js";
import {
  answeringCameraSettles,
  cameraPhaseFor,
  isAnsweringBeat,
} from "../src/pvp/arenaCamera.js";
import {
  blockerCells,
  containFit,
  drawnArena,
  fillBlocker,
  pushOutside,
} from "../src/pvp/arenaScene.js";
import type { MatchSnapshot, ProjectileView } from "../src/pvp/protocol.js";

// What the arena renderer is allowed to draw.
//
// The single rule these tests exist to hold is that the renderer DRAWS THE SERVER'S
// SNAPSHOT and does not run a simulation. There is no reducer to assert against here,
// so the assertions are the observable consequences of that rule: nothing is ever
// drawn ahead of the newest snapshot; a position the server withheld is never
// presented as current; the visible cover is the cover that stops a ball.

interface Overrides {
  readonly tick: number;
  readonly selfX?: number;
  readonly selfHealth?: number;
  readonly opponentX?: number;
  readonly opponentZ?: number;
  readonly opponentHealth?: number;
  readonly visible?: boolean;
  readonly positionAtTick?: number;
  readonly projectiles?: readonly ProjectileView[];
  readonly phase?: MatchSnapshot["phase"];
  readonly matchId?: string;
}

function snapshot(over: Overrides): MatchSnapshot {
  return {
    matchId: over.matchId ?? "pvp_TEST_1",
    tick: over.tick,
    phase: over.phase ?? "ENGAGEMENT_LIVE",
    round: 1,
    self: {
      side: "A",
      position: { x: over.selfX ?? 0, y: 0, z: -6 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      capsuleHeight: 1.55,
      health: over.selfHealth ?? 200,
      ammo: 3,
      dashing: false,
      invulnerableUntilTick: 0,
      dodgeReadyAtTick: 0,
      abilityUsesRemaining: {},
    },
    opponent: {
      side: "B",
      handle: "QuietLantern-1234",
      rank: 1,
      position: { x: over.opponentX ?? 0, y: 0, z: over.opponentZ ?? 6 },
      capsuleHeight: 1.55,
      health: over.opponentHealth ?? 200,
      ammo: 3,
      visible: over.visible ?? true,
      positionAtTick: over.positionAtTick ?? over.tick,
      answering: false,
    },
    projectiles: over.projectiles ?? [],
  };
}

function ball(over: Partial<ProjectileView> & { id: number }): ProjectileView {
  return {
    id: over.id,
    x: over.x ?? 0,
    y: over.y ?? 1.12,
    z: over.z ?? 0,
    vx: over.vx ?? 0,
    vz: over.vz ?? 22,
    shooter: over.shooter ?? "A",
  };
}

// ---- the feed never runs ahead of the authority -----------------------------

test("one snapshot is drawn exactly as sent, with no extrapolation over time", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, selfX: 2 }), 1_000);

  const atArrival = feed.sample(1_000);
  const muchLater = feed.sample(9_000);
  assert.ok(atArrival && muchLater);
  assert.equal(atArrival.self.x, 2);
  // A single snapshot has nothing to interpolate towards, and time passing must not
  // invent motion: an extrapolating client is a client that disagrees with the server.
  assert.equal(muchLater.self.x, 2);
  assert.equal(muchLater.tick, 60);
});

test("two snapshots interpolate between them and stop at the newer one", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, selfX: 0 }), 1_000);
  feed.observe(snapshot({ tick: 66, selfX: 3 }), 1_090);

  const start = feed.sample(1_090);
  const middle = feed.sample(1_135);
  const end = feed.sample(1_180);
  const overdue = feed.sample(1_600);
  assert.ok(start && middle && end && overdue);

  // Presentation runs one poll behind, so the instant the new snapshot lands the
  // screen is still showing the old one.
  assert.equal(start.self.x, 0);
  assert.ok(Math.abs(middle.self.x - 1.5) < 1e-6, `midpoint was ${middle.self.x}`);
  assert.equal(end.self.x, 3);
  // A late poll freezes at the newest position rather than sailing past it.
  assert.equal(overdue.self.x, 3);
  assert.equal(overdue.tick, 66);
});

test("a repeated tick does not collapse the interpolation window", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, selfX: 0 }), 1_000);
  feed.observe(snapshot({ tick: 66, selfX: 3 }), 1_090);
  // Two polls can land between authoritative steps; the second carries no motion.
  feed.observe(snapshot({ tick: 66, selfX: 3 }), 1_120);

  const middle = feed.sample(1_135);
  assert.ok(middle);
  assert.ok(Math.abs(middle.self.x - 1.5) < 1e-6, `midpoint was ${middle.self.x}`);
});

// ---- the culled opponent ----------------------------------------------------

test("an opponent the server can see is IN_SIGHT and interpolated", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, opponentX: 0 }), 1_000);
  feed.observe(snapshot({ tick: 66, opponentX: 2 }), 1_090);

  const middle = feed.sample(1_135);
  assert.ok(middle);
  assert.equal(middle.opponent.kind, "IN_SIGHT");
  if (middle.opponent.kind !== "IN_SIGHT") return;
  assert.ok(Math.abs(middle.opponent.pose.x - 1) < 1e-6);
});

test("a broken sight line reads as a sighting with an age, never as a position", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, opponentX: 4 }), 1_000);
  feed.observe(
    snapshot({ tick: 120, opponentX: 4, visible: false, positionAtTick: 60 }),
    1_090,
  );

  const sample = feed.sample(1_180);
  assert.ok(sample);
  assert.equal(sample.opponent.kind, "LAST_SEEN");
  if (sample.opponent.kind !== "LAST_SEEN") return;
  assert.ok(Math.abs(sample.opponent.ageS - 60 / FIELD_TICK_HZ) < 1e-6);
  // Health stays public: it is the scoreboard of the fight and the projection sends it
  // whether or not the body is visible.
  assert.equal(sample.opponent.health, 200);
});

test("a remembered position is never interpolated towards", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, opponentX: 0 }), 1_000);
  feed.observe(
    snapshot({ tick: 66, opponentX: 8, visible: false, positionAtTick: 40 }),
    1_090,
  );

  // Halfway through the interval. Sliding from the live position to the remembered one
  // would draw a two-metre walk the server never reported, along a line that goes
  // through whatever cover broke the sighting.
  const middle = feed.sample(1_135);
  assert.ok(middle && middle.opponent.kind === "LAST_SEEN");
  if (middle.opponent.kind !== "LAST_SEEN") return;
  assert.equal(middle.opponent.pose.x, 8);
});

test("a snapshot with no usable opponent position draws no opponent at all", () => {
  const feed = createSnapshotFeed();
  const broken = snapshot({ tick: 60 });
  const withoutPosition: MatchSnapshot = {
    ...broken,
    // What a projection that stops sending a position looks like on the wire, and what
    // a hand-edited client would produce. The renderer must not put a body at the
    // origin or hand three.js a NaN transform.
    opponent: {
      ...broken.opponent,
      position: undefined as unknown as MatchSnapshot["opponent"]["position"],
    },
  };
  const feedB = createSnapshotFeed();
  feedB.observe(withoutPosition, 1_000);
  const sample = feedB.sample(1_000);
  assert.ok(sample);
  assert.equal(sample.opponent.kind, "UNPLACED");

  feed.observe(
    { ...broken, opponent: { ...broken.opponent, position: { x: Number.NaN, y: 0, z: 0 } } },
    1_000,
  );
  const nan = feed.sample(1_000);
  assert.ok(nan);
  assert.equal(nan.opponent.kind, "UNPLACED");
});

test("a stale body fades out and then stops being drawn", () => {
  assert.ok(staleBodyOpacity(0) > 0.3, "a fresh sighting is visible");
  assert.ok(staleBodyOpacity(0) < 1, "and never at full strength: it is a memory");
  assert.ok(staleBodyOpacity(0.7) < staleBodyOpacity(0.1));
  assert.equal(staleBodyOpacity(SIGHTING_GHOST_SECONDS), 0);
  assert.equal(staleBodyOpacity(30), 0);
});

// ---- shots and hits are observed, not decided -------------------------------

test("a ball nobody has seen before is a shot, and its first position is the muzzle", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60 }), 1_000);
  feed.observe(
    snapshot({ tick: 66, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })] }),
    1_090,
  );

  const sample = feed.sample(1_180);
  assert.ok(sample);
  assert.equal(sample.cues.SELF.lastFireTick, 66);
  assert.deepEqual(sample.cues.SELF.lastFireOrigin, [0.4, 1.12, -5.2]);
  assert.equal(sample.cues.OPPONENT.lastFireTick, -1);
});

test("the shooter is resolved against this client's own side, not against A", () => {
  const feed = createSnapshotFeed();
  const asSideB = (tick: number, projectiles: readonly ProjectileView[]): MatchSnapshot => {
    const base = snapshot({ tick, projectiles });
    return {
      ...base,
      self: { ...base.self, side: "B" },
      opponent: { ...base.opponent, side: "A" },
    };
  };
  feed.observe(asSideB(60, []), 1_000);
  feed.observe(asSideB(66, [ball({ id: 3, shooter: "B" })]), 1_090);

  const sample = feed.sample(1_180);
  assert.ok(sample);
  // Side B's own ball is SELF's, however the authority labelled it.
  assert.equal(sample.cues.SELF.lastFireTick, 66);
  assert.equal(sample.cues.OPPONENT.lastFireTick, -1);
  assert.equal(sample.balls[0]?.shooter, "SELF");
});

test("a hit is health that fell, on whichever body lost it", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60 }), 1_000);
  feed.observe(snapshot({ tick: 66, selfHealth: 160 }), 1_090);
  feed.observe(snapshot({ tick: 72, selfHealth: 160, opponentHealth: 150 }), 1_180);

  const sample = feed.sample(1_270);
  assert.ok(sample);
  assert.equal(sample.cues.SELF.lastHitTick, 66);
  assert.equal(sample.cues.OPPONENT.lastHitTick, 72);
});

test("a ball that stops is carried to its end and faded, not blinked away", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, projectiles: [ball({ id: 9, z: 0, vz: 22 })] }), 1_000);
  feed.observe(snapshot({ tick: 66, projectiles: [] }), 1_090);

  const early = feed.sample(1_090);
  assert.ok(early);
  const flying = early.balls.find((entry) => entry.id === 9);
  assert.ok(flying, "the ball is still on screen at the start of the interval");
  assert.equal(flying.fade, 1);
  assert.ok(Math.abs(flying.z - 0) < 1e-6);

  const late = feed.sample(1_180);
  assert.ok(late);
  assert.equal(late.balls.length, 0, "and gone by the end of it");
});

test("a ball spawned inside the gap enters from behind its reported position", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60 }), 1_000);
  feed.observe(snapshot({ tick: 66, projectiles: [ball({ id: 4, z: 2, vz: 22 })] }), 1_090);

  const start = feed.sample(1_090);
  const end = feed.sample(1_180);
  assert.ok(start && end);
  const entering = start.balls[0];
  const arrived = end.balls[0];
  assert.ok(entering && arrived);
  // Reconstructed backwards down its own known line, never forwards past it.
  assert.ok(entering.z < arrived.z, `${entering.z} should be behind ${arrived.z}`);
  assert.ok(Math.abs(arrived.z - 2) < 1e-6);
});

test("the face-off is timed in wall clock, because its tick is not projected", () => {
  const feed = createSnapshotFeed();
  // Every snapshot of a face-off carries tick 0: nothing steps the fighters, so the
  // combat tick — the only one projected — does not move for ten seconds.
  feed.observe(snapshot({ tick: 0, phase: "FACE_OFF" }), 1_000);
  feed.observe(snapshot({ tick: 0, phase: "FACE_OFF" }), 1_700);

  const sample = feed.sample(3_500);
  assert.ok(sample);
  assert.ok(Math.abs(sample.faceOffElapsedS - 2.5) < 1e-6);

  const live = createSnapshotFeed();
  live.observe(snapshot({ tick: 600 }), 1_000);
  const engaged = live.sample(1_000);
  assert.ok(engaged);
  assert.equal(engaged.faceOffElapsedS, 0);
});

test("a repeated tick still updates the phase, health and ammunition", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 0, phase: "FACE_OFF" }), 1_000);
  // The whole of the face-off, the question and the grant happen at tick 0. Dropping
  // these as "nothing new" froze the arena in the face-off while the question panel was
  // already open beside it.
  feed.observe(snapshot({ tick: 0, phase: "QUESTION_PENDING" }), 1_700);
  feed.observe(snapshot({ tick: 0, phase: "BULLETS_GRANTED", selfHealth: 180 }), 2_400);

  const sample = feed.sample(2_400);
  assert.ok(sample);
  assert.equal(sample.phase, "BULLETS_GRANTED");
  assert.equal(sample.selfReadout.health, 180);
  assert.equal(sample.tick, 0);
});

test("a repeated tick does not restart the interpolation window", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, selfX: 0 }), 1_000);
  feed.observe(snapshot({ tick: 66, selfX: 3 }), 1_090);
  // A second poll landing on the same authoritative tick. Reopening the window here
  // would drag the bodies back to the older position and stutter.
  feed.observe(snapshot({ tick: 66, selfX: 3 }), 1_150);

  const end = feed.sample(1_180);
  assert.ok(end);
  assert.equal(end.self.x, 3);
});

// ---- the camera is the gameplay camera --------------------------------------

test("every fighting phase gets the duel's own camera, unsubstituted", () => {
  for (const phase of [
    "FACE_OFF",
    "BULLETS_GRANTED",
    "ENGAGEMENT_LIVE",
    "LINE_OF_SIGHT_BREAK",
    "ROUND_RESOLVED",
    "DUEL_RESOLVED",
  ] as const) {
    assert.equal(cameraPhaseFor(phase), phase, `${phase} should not be substituted`);
    assert.equal(answeringCameraSettles(phase), false);
  }
});

test("the answering beat holds the gameplay camera instead of framing the opponent", () => {
  // The duel's reverse angle exists because in a boss fight the officer is the one
  // asking. In PvP the System asks, so pointing the camera at the other student would
  // dramatise a relationship that is not there — and hold a motionless stranger in
  // frame for as long as it takes somebody to type.
  for (const phase of ["QUESTION_PENDING", "VERDICT_COMMITTED"] as const) {
    assert.equal(cameraPhaseFor(phase), "ENGAGEMENT_LIVE");
    assert.equal(isAnsweringBeat(phase), true);
    // And it settles rather than tracking: nobody is steering, and a pointer on its
    // way to the Send button must not turn the camera under the player.
    assert.equal(answeringCameraSettles(phase), true);
  }
});

// ---- the drawn yard is the simulated yard ----------------------------------

test("every blocker is filled by props that sit inside it", () => {
  const arena = referenceArena();
  for (const cover of arena.spec.cover) {
    const props = fillBlocker(cover);
    assert.ok(props.length >= 1, `${cover.id} drew nothing`);
    for (const prop of props) {
      const halfX = prop.size[0] / 2;
      const halfZ = prop.size[2] / 2;
      const overhangX = Math.abs(prop.x - cover.x) + halfX - cover.halfX;
      const overhangZ = Math.abs(prop.z - cover.z) + halfZ - cover.halfZ;
      assert.ok(overhangX <= 1e-9, `${prop.id} overhangs the blocker on x by ${overhangX}`);
      assert.ok(overhangZ <= 1e-9, `${prop.id} overhangs the blocker on z by ${overhangZ}`);
      // The prop stands as tall as the blocker, or the player hides behind something
      // that visibly is not there.
      assert.ok(
        prop.size[1] <= cover.topY + 1e-9 && prop.size[1] > cover.topY * 0.85,
        `${prop.id} stands ${prop.size[1]} against a ${cover.topY} blocker`,
      );
    }
  }
});

test("a long blocker is tiled rather than stretched", () => {
  // 1.8m across and 3.2m deep is the reference arena's own pillar footprint.
  assert.deepEqual(blockerCells(1.8, 3.2), { alongX: 1, alongZ: 2 });
  assert.deepEqual(blockerCells(2.8, 1.4), { alongX: 2, alongZ: 1 });
  assert.deepEqual(blockerCells(1.4, 1.4), { alongX: 1, alongZ: 1 });

  const fitted = containFit("crate-mound", [1.8, 1.25, 1.6]);
  // Contain-fit, so the aspect ratio is the asset's and nothing is distorted.
  const natural = 1.9 / 1.21;
  assert.ok(Math.abs(fitted[0] / fitted[1] - natural) < 1e-6);
});

test("the wall is drawn at the bounds the core actually clamps movement to", () => {
  const drawn = drawnArena();
  const { halfExtentX, halfExtentZ } = drawn.bounds;
  assert.equal(halfExtentX, 12);
  assert.equal(halfExtentZ, 12);
  const reach = (props: readonly { x: number; z: number }[]): number =>
    props.reduce((low, prop) => Math.min(low, Math.max(Math.abs(prop.x), Math.abs(prop.z))), Infinity);
  // Every wall module is outside the yard, so a player can never stand past a wall
  // they can see; and every unblocked fixture is outside the wall.
  assert.ok(reach(drawn.wall) > halfExtentX, `wall reach ${reach(drawn.wall)}`);
  assert.ok(
    reach(drawn.dressing) > reach(drawn.wall),
    `dressing reach ${reach(drawn.dressing)} vs wall ${reach(drawn.wall)}`,
  );
});

test("a fixture already clear of the yard is left where the duel authored it", () => {
  const outside = { glbKey: "timber-crane", x: -13.4, z: -8.6, heightM: 4.6, yaw: 0.5 };
  assert.deepEqual(pushOutside(outside, 13), outside);
  const pushed = pushOutside({ ...outside, x: -6.7, z: -4.3 }, 13.4);
  assert.ok(Math.abs(pushed.x) >= 13.4 - 1e-9);
});

test("a different arena produces a different yard, so nothing is hardcoded twice", () => {
  const wide = buildArena({
    arenaId: "DUEL.ARENA.TEST",
    halfExtentX: 16,
    halfExtentZ: 16,
    cover: [{ id: "COVER.ONE", x: 1, z: 2, halfX: 0.7, halfZ: 0.7, topY: 1.3 }],
  });
  const drawn = drawnArena(wide);
  assert.equal(drawn.bounds.halfExtentX, 16);
  assert.equal(drawn.cover.length, 1);
  assert.ok(Math.abs(drawn.cover[0]!.x - 1) < 1e-9);
  assert.ok(Math.abs(drawn.cover[0]!.z - 2) < 1e-9);
});
