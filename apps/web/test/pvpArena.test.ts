import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELD_TICK_HZ, buildArena, referenceArena } from "@pa/duel";
import {
  FIRE_CUE_CEILING,
  HIT_CUE_CEILING,
  SIGHTING_GHOST_SECONDS,
  createSnapshotFeed,
  staleBodyOpacity,
  type ArenaSample,
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
import { REQUEST_TIMEOUT_MS } from "../src/pvp/protocol.js";
import type { MatchSnapshot, ProjectileView } from "../src/pvp/protocol.js";

// What the arena renderer is allowed to draw.
//
// The single rule these tests exist to hold is that the renderer DRAWS THE SERVER'S
// SNAPSHOT and does not run a simulation. There is no reducer to assert against here,
// so the assertions are the observable consequences of that rule: nothing is ever
// drawn ahead of the newest snapshot; a position the server withheld is never
// presented as current; the visible cover is the cover that stops a ball.
//
// The feed is a TICK BUFFER with an adaptive render delay. It holds recent snapshots
// sorted by authoritative tick and reports one monotonic presentation tick held a
// short delay behind the newest arrival, so a lost or late poll is bridged by the two
// snapshots that straddle the instant. These tests drive it through a real render loop
// — observe on arrival, sample every 60Hz frame — because the delay, the catch-up and
// the cue timing are all properties of that loop and cannot be seen from a single call.

interface Overrides {
  readonly tick: number;
  readonly selfX?: number;
  readonly selfHealth?: number;
  readonly opponentX?: number;
  readonly opponentZ?: number;
  readonly opponentHealth?: number;
  readonly opponentAimYaw?: number;
  readonly opponentVX?: number;
  readonly opponentVZ?: number;
  readonly opponentDashing?: boolean;
  readonly visible?: boolean;
  readonly positionAtTick?: number;
  readonly projectiles?: readonly ProjectileView[];
  readonly phase?: MatchSnapshot["phase"];
  readonly matchId?: string;
  readonly resumeCountdownSeconds?: number | null;
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
      velocity: { x: over.opponentVX ?? 0, z: over.opponentVZ ?? 0 },
      aimYaw: over.opponentAimYaw ?? 0,
      dashing: over.opponentDashing ?? false,
      capsuleHeight: 1.55,
      health: over.opponentHealth ?? 200,
      ammo: 3,
      visible: over.visible ?? true,
      positionAtTick: over.positionAtTick ?? over.tick,
      answering: false,
    },
    projectiles: over.projectiles ?? [],
    resumeCountdownSeconds: over.resumeCountdownSeconds ?? null,
  };
}

test("the resume countdown is read as discrete state and never counts back up", () => {
  const feed = createSnapshotFeed();
  // BULLETS_GRANTED freezes the combat tick, so each new poll is a same-tick
  // replacement carrying a fresher countdown. The frozen tick is the buffered entry
  // the presentation instant reads.
  feed.observe(
    snapshot({ tick: 300, phase: "BULLETS_GRANTED", resumeCountdownSeconds: 3 }),
    0,
  );
  assert.equal(feed.sample(0)!.resumeCountdownSeconds, 3, "starts at 3");

  feed.observe(
    snapshot({ tick: 300, phase: "BULLETS_GRANTED", resumeCountdownSeconds: 2 }),
    10,
  );
  assert.equal(feed.sample(16)!.resumeCountdownSeconds, 2, "steps down to 2");

  // A stale/out-of-order replacement carrying a HIGHER value must not make the shown
  // number climb — it is clamped to what was already presented.
  feed.observe(
    snapshot({ tick: 300, phase: "BULLETS_GRANTED", resumeCountdownSeconds: 3 }),
    20,
  );
  assert.equal(feed.sample(32)!.resumeCountdownSeconds, 2, "a reordered higher value is held down");

  feed.observe(
    snapshot({ tick: 300, phase: "BULLETS_GRANTED", resumeCountdownSeconds: 1 }),
    30,
  );
  assert.equal(feed.sample(48)!.resumeCountdownSeconds, 1, "and on to 1");
});

test("outside the countdown the sample carries a null countdown", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, phase: "ENGAGEMENT_LIVE" }), 0);
  assert.equal(feed.sample(0)!.resumeCountdownSeconds, null);
});

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

// ---- a render loop, so the delayed buffer can be driven deterministically ----

/** One 60Hz frame, in milliseconds. Every sample below is taken on this grid. */
const FRAME_MS = 1000 / 60;

/** 6 m/s along +x at 60 Hz is exactly this many metres per authoritative tick. */
const M_PER_TICK = 6 / FIELD_TICK_HZ;

interface Arrival {
  readonly atMs: number;
  readonly snap: MatchSnapshot;
}

/**
 * Play a script of arrivals through the feed on the 60Hz grid, collecting every
 * non-null sample. Arrivals are delivered when their wall time is reached, which is how
 * the live loop works — `observe` on the poll response, `sample` on the frame.
 */
function play(script: readonly Arrival[], untilMs: number): ArenaSample[] {
  const feed = createSnapshotFeed();
  const ordered = [...script].sort((a, b) => a.atMs - b.atMs);
  const out: ArenaSample[] = [];
  let next = 0;
  for (let now = 0; now <= untilMs + 1e-6; now += FRAME_MS) {
    while (next < ordered.length && ordered[next]!.atMs <= now) {
      feed.observe(ordered[next]!.snap, ordered[next]!.atMs);
      next += 1;
    }
    const sample = feed.sample(now);
    if (sample) out.push(sample);
  }
  return out;
}

/** A straight run of self-only snapshots at a poll cadence, moving 6 m/s along +x. */
function movingSelf(startMs: number, count: number, pollMs: number): Arrival[] {
  const arrivals: Arrival[] = [];
  for (let i = 0; i < count; i += 1) {
    const atMs = startMs + i * pollMs;
    const tick = Math.round((atMs * FIELD_TICK_HZ) / 1000);
    arrivals.push({ atMs, snap: snapshot({ tick, selfX: tick * M_PER_TICK }) });
  }
  return arrivals;
}

// ---- the feed never runs ahead of the authority -----------------------------

test("one snapshot is drawn exactly as sent, and time passing invents no motion", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 60, selfX: 2 }), 1_000);

  const atArrival = feed.sample(1_000);
  const muchLater = feed.sample(9_000);
  assert.ok(atArrival && muchLater);
  assert.equal(atArrival.self.x, 2);
  assert.equal(atArrival.tick, 60);
  // A single snapshot has nothing to interpolate towards; the presentation tick is
  // pinned to it and no amount of wall time may extrapolate a body off the end of it.
  assert.equal(muchLater.self.x, 2);
  assert.equal(muchLater.tick, 60);
});

test("the presentation tick never runs backward and never passes the newest arrival", () => {
  const script = movingSelf(0, 40, 90);
  const headTicks = script.map((a) => a.snap.tick);
  const samples = play(script, 40 * 90 + 500);
  assert.ok(samples.length > 100);

  let prev = -Infinity;
  for (const s of samples) {
    assert.ok(s.tick >= prev - 1e-9, `tick went backward: ${s.tick} after ${prev}`);
    prev = s.tick;
    // Never ahead of the newest tick the server has actually sent.
    assert.ok(s.tick <= Math.max(...headTicks) + 1e-9);
  }
});

test("motion between snapshots is interpolated, not stepped a whole poll at a time", () => {
  const samples = play(movingSelf(0, 30, 90), 30 * 90);
  let maxStep = 0;
  let travel = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const step = samples[i]!.self.x - samples[i - 1]!.self.x;
    assert.ok(step >= -1e-9, "self never slides backward");
    maxStep = Math.max(maxStep, step);
    travel += step;
  }
  // A whole 90ms poll is 5.4 ticks — 0.54m. If the feed stepped snapshot-to-snapshot
  // rather than interpolating, the largest frame would be that. It is a fraction of it.
  assert.ok(maxStep < 0.2, `largest frame step was ${maxStep}`);
  assert.ok(travel > 5, "the run actually moved");
});

test("presentation holds on an underrun rather than sailing past the newest snapshot", () => {
  // A short burst, then silence. Presentation must converge on the newest tick and STOP
  // there — never extrapolate forward across the gap nobody reported.
  const burst = movingSelf(0, 6, 90);
  const headTick = burst[burst.length - 1]!.snap.tick;
  const samples = play(burst, 6_000);
  const tail = samples.slice(-30);
  for (const s of tail) {
    assert.ok(s.tick <= headTick + 1e-9, `tick ${s.tick} passed the head ${headTick}`);
  }
  // And it has actually caught up to the head by the end (the delay is bounded).
  assert.ok(samples[samples.length - 1]!.tick > headTick - 3);
});

// ---- the buffer is bounded, tick-ordered, and never sheds the active bracket -

test("the buffer trims to its cap once the presentation clock keeps up", () => {
  const feed = createSnapshotFeed();
  // Observe a long run while sampling every frame, so the clock tracks the head and the
  // active lower bracket sits near it — the case where trimming the old tail is safe.
  for (let n = 0; n < 60; n += 1) {
    const atMs = n * 90;
    const tick = Math.round((atMs * FIELD_TICK_HZ) / 1000);
    feed.observe(snapshot({ tick, selfX: tick * M_PER_TICK }), atMs);
    for (let f = 0; f < 6; f += 1) feed.sample(atMs + f * FRAME_MS);
  }
  const ticks = feed.bufferedTicks();
  // Bounded above by the cap, and still deep enough to bracket the delayed instant.
  assert.ok(ticks.length <= 12, `buffer grew to ${ticks.length}`);
  assert.ok(ticks.length >= 8, `buffer shrank to ${ticks.length}`);
  // Tick-sorted and holding the newest arrival.
  for (let i = 1; i < ticks.length; i += 1) assert.ok(ticks[i]! > ticks[i - 1]!);
});

test("a large arrival gap does not resume with a tick jump: the lower bracket is preserved", () => {
  const feed = createSnapshotFeed();
  // Seed the clock at tick 0, then flood forty newer ticks WITHOUT sampling — a tab that
  // was backgrounded, or a burst after a stall. The old trim discarded the oldest tick
  // unconditionally and the next sample snapped the clock up to tick 174; the fix keeps
  // the active lower anchor (tick 0) and the newest entries, compacting the middle so the
  // buffer stays hard-bounded.
  feed.observe(snapshot({ tick: 0, selfX: 0 }), 0);
  const first = feed.sample(0);
  assert.ok(first && first.tick === 0);
  for (let n = 1; n <= 40; n += 1) {
    const tick = 6 * n;
    feed.observe(snapshot({ tick, selfX: tick * M_PER_TICK }), 90 * n);
  }
  // The lower anchor the clock is interpolating from was NOT discarded, and storage is
  // hard-bounded even though the clock never advanced.
  assert.ok(feed.bufferedTicks().includes(0), "the active lower anchor was trimmed away");
  assert.ok(feed.bufferedTicks().length <= 13, `buffer grew to ${feed.bufferedTicks().length}`);

  // Resume. The first frame after a multi-second idle may advance by at most the
  // per-frame ceiling (MAX_ADVANCE_TICKS = 4), NOT jump to the buffer's new oldest tick.
  const resume = feed.sample(90 * 40 + FRAME_MS);
  assert.ok(resume);
  assert.ok(resume.tick <= 4 + 1e-6, `resume jumped to tick ${resume.tick}`);

  // And from there it climbs by the bounded per-frame correction — one tick of real time
  // plus at most the 0.5-tick correction — never a teleport, never backward.
  let prev = resume.tick;
  let now = 90 * 40 + FRAME_MS;
  for (let f = 1; f <= 240; f += 1) {
    now += FRAME_MS;
    const s = feed.sample(now)!;
    const step = s.tick - prev;
    assert.ok(step >= -1e-9, `tick regressed by ${step}`);
    assert.ok(step <= 1.5 + 1e-6, `per-frame advance ${step} exceeded the correction bound`);
    prev = s.tick;
  }
  // It did make real progress catching up — this is bounded recovery, not a freeze.
  assert.ok(prev > 60, `clock only recovered to tick ${prev}`);
});

test("a 10,001-arrival stall stays hard-bounded and recovers monotonically without a jump", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 0, selfX: 0 }), 0);
  assert.equal(feed.sample(0)!.tick, 0, "the anchor seeds at tick 0");

  // Ten thousand and one newer arrivals while the clock is stuck at the anchor. Storage
  // must never exceed the hard cap, however many arrive.
  let atMs = 0;
  for (let n = 1; n <= 10_001; n += 1) {
    atMs += 5;
    feed.observe(snapshot({ tick: n, selfX: n * M_PER_TICK }), atMs);
    if (n % 500 === 0) {
      assert.ok(feed.bufferedTicks().length <= 13, `buffer grew to ${feed.bufferedTicks().length}`);
    }
  }
  const ticks = feed.bufferedTicks();
  assert.ok(ticks.length <= 13, `final buffer ${ticks.length} exceeded the hard cap`);
  assert.ok(ticks.includes(0), "the active lower anchor was displaced");
  assert.equal(ticks[ticks.length - 1], 10_001, "the newest arrival was not retained");

  // Resume: the first frame after the multi-second stall advances by at most the per-frame
  // ceiling, NOT a jump to the buffer's newest tick.
  const resume = feed.sample(atMs + FRAME_MS)!;
  assert.ok(resume.tick <= 4 + 1e-6, `resume jumped to tick ${resume.tick}`);

  // And from there recovery is monotonic and bounded per frame — never a teleport.
  let prev = resume.tick;
  let now = atMs + FRAME_MS;
  for (let f = 0; f < 400; f += 1) {
    now += FRAME_MS;
    const s = feed.sample(now)!;
    const step = s.tick - prev;
    assert.ok(step >= -1e-9, `tick regressed by ${step}`);
    assert.ok(step <= 1.5 + 1e-6, `per-frame advance ${step} exceeded the correction bound`);
    prev = s.tick;
  }
  assert.ok(prev > 4, "recovery made no progress");
});

test("a 10,001-arrival stall keeps the cue journals bounded, loses no pending cue, never re-emits", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 0, selfX: 0 }), 0);
  assert.equal(feed.sample(0)!.tick, 0);

  // Flood 10,001 arrivals while the clock is stuck at the anchor. A shot and an opponent
  // hit are introduced at a MODEST set of ticks; every one of them lands in the middle the
  // buffer compacts away, so their SNAPSHOTS are gone but their CUES must survive.
  const fireTicks: number[] = [];
  let atMs = 0;
  let opponentHealth = 200;
  for (let n = 1; n <= 10_001; n += 1) {
    atMs += 5;
    if (n % 1500 === 0) {
      fireTicks.push(n);
      opponentHealth -= 10;
      feed.observe(
        snapshot({ tick: n, selfX: n * M_PER_TICK, projectiles: [ball({ id: n, x: 0.1, z: 0.2 })], opponentHealth }),
        atMs,
      );
    } else {
      feed.observe(snapshot({ tick: n, selfX: n * M_PER_TICK, opponentHealth }), atMs);
    }
  }

  // BOUNDED by the derived match ceiling, never toward ten thousand.
  const sizes = feed.cueJournalSizes();
  assert.ok(sizes.fire <= FIRE_CUE_CEILING, `fire journal exceeded ceiling at ${sizes.fire}`);
  assert.ok(sizes.hit <= HIT_CUE_CEILING, `hit journal exceeded ceiling at ${sizes.hit}`);
  assert.ok(sizes.fire >= fireTicks.length, "a pending fire cue was lost during the stall");

  // Recover, sampling forward. Each shot flashes exactly once as the clock crosses its
  // tick — even though the snapshot at that tick was compacted away — and the presented
  // fire tick only ever climbs, so nothing re-emits.
  const crossed: number[] = [];
  let prevFire = -1;
  let now = atMs + FRAME_MS;
  for (let f = 0; f < 7200; f += 1) {
    now += FRAME_MS;
    const s = feed.sample(now)!;
    const fire = s.cues.SELF.lastFireTick;
    assert.ok(fire >= prevFire, `fire cue went backward: ${fire} after ${prevFire}`);
    if (fire !== prevFire && fire > 0) crossed.push(fire);
    prevFire = fire;
  }
  // Every shot was presented, once each, in order — none lost, none duplicated.
  assert.deepEqual(crossed, fireTicks, `crossed ${crossed} but fired ${fireTicks}`);
});

test("more than 64 pending cues all emit exactly once, in order — none evicted", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 0 }), 0);
  assert.equal(feed.sample(0)!.tick, 0);

  // Eighty distinct shots, all queued while the clock is held at the anchor — well past
  // the old arbitrary cap of 64, so an evict-oldest policy would have dropped the first
  // sixteen. Each ball spawns at its tick and is gone the next, a genuinely distinct fire.
  const fires: number[] = [];
  let atMs = 0;
  for (let i = 1; i <= 80; i += 1) {
    const tick = i * 3;
    fires.push(tick);
    feed.observe(snapshot({ tick, projectiles: [ball({ id: tick, x: 0.1, z: 0.2 })] }), (atMs += 5));
    feed.observe(snapshot({ tick: tick + 1 }), (atMs += 5));
  }
  // Trailing plain ticks so the head clears the last fire plus the render delay, letting
  // the clock actually cross every shot on recovery.
  for (let tick = 244; tick <= 320; tick += 4) {
    feed.observe(snapshot({ tick }), (atMs += 5));
  }

  // Not one of the 80 pending cues was evicted.
  assert.ok(feed.cueJournalSizes().fire >= 80, `pending cues were evicted: ${feed.cueJournalSizes().fire}`);
  assert.ok(feed.cueJournalSizes().fire <= FIRE_CUE_CEILING, "still under the derived ceiling");

  // Recover: each shot flashes exactly once, in tick order, none lost, none duplicated.
  const crossed: number[] = [];
  let prev = -1;
  let now = atMs + FRAME_MS;
  for (let f = 0; f < 4000; f += 1) {
    now += FRAME_MS;
    const fire = feed.sample(now)!.cues.SELF.lastFireTick;
    assert.ok(fire >= prev, `fire cue went backward: ${fire} after ${prev}`);
    if (fire !== prev && fire > 0) crossed.push(fire);
    prev = fire;
  }
  assert.deepEqual(crossed, fires, `crossed ${crossed.length} of ${fires.length} shots`);
});

test("a long match keeps the cue journals bounded, evicting only presented cues", () => {
  const feed = createSnapshotFeed();
  let maxFire = 0;
  let ballId = 1;
  let atMs = 0;
  // A thousand polls, a distinct shot on each, sampled every frame so the clock tracks the
  // head and presented cues age out of the flash window. If eviction worked the journal
  // holds only a handful at a time — never the thousand shots, and never near the ceiling.
  for (let k = 0; k < 1000; k += 1) {
    const tick = k * 5;
    feed.observe(
      snapshot({ tick, selfX: tick * M_PER_TICK, projectiles: [ball({ id: ballId++, x: 0.1, z: 0.2 })] }),
      atMs,
    );
    for (let f = 0; f < 5; f += 1) feed.sample(atMs + f * FRAME_MS);
    atMs += 90;
    maxFire = Math.max(maxFire, feed.cueJournalSizes().fire);
  }
  assert.ok(maxFire <= FIRE_CUE_CEILING, `fire journal exceeded the match ceiling: ${maxFire}`);
  // And far under it: presented cues really were evicted rather than accumulating.
  assert.ok(maxFire < 64, `presented cues were not evicted; journal held ${maxFire}`);
});

test("reduced-damage hits beyond a health/base-damage count are all retained and emit once", () => {
  const feed = createSnapshotFeed();
  feed.observe(snapshot({ tick: 0, opponentHealth: 200 }), 0);
  assert.equal(feed.sample(0)!.tick, 0);

  // THIRTY hits, each only 1 damage — far more than the ten a 200/20 health-arithmetic
  // ceiling would allow. Damage reduction is legal, so the hit ceiling is the unique-
  // projectile bound, not a health calculation; none of these may be evicted while pending.
  const hits: number[] = [];
  let atMs = 0;
  let health = 200;
  for (let i = 1; i <= 30; i += 1) {
    const tick = i * 3;
    hits.push(tick);
    health -= 1;
    feed.observe(snapshot({ tick, opponentHealth: health }), (atMs += 5));
  }
  // Trailing plain ticks so the clock can clear the last hit plus the render delay.
  for (let tick = 94; tick <= 170; tick += 4) {
    feed.observe(snapshot({ tick, opponentHealth: health }), (atMs += 5));
  }

  const sizes = feed.cueJournalSizes();
  assert.ok(sizes.hit >= 30, `reduced-damage hits were evicted: only ${sizes.hit} retained`);
  assert.ok(sizes.hit <= HIT_CUE_CEILING, `hit journal exceeded the ceiling at ${sizes.hit}`);

  // Each hit flashes exactly once, in tick order, on recovery — none lost, none doubled.
  const crossed: number[] = [];
  let prev = -1;
  let now = atMs + FRAME_MS;
  for (let f = 0; f < 2400; f += 1) {
    now += FRAME_MS;
    const hit = feed.sample(now)!.cues.OPPONENT.lastHitTick;
    assert.ok(hit >= prev, `hit cue went backward: ${hit} after ${prev}`);
    if (hit !== prev && hit > 0) crossed.push(hit);
    prev = hit;
  }
  assert.deepEqual(crossed, hits, `crossed ${crossed.length} of ${hits.length} hits`);
});

test("an out-of-order arrival is placed by tick, not by arrival order", () => {
  const feed = createSnapshotFeed();
  // 60 and 72 land first; 66 arrives late but is still ahead of the presentation clock,
  // so it belongs between them and must be used as the bracket, not appended at the end.
  // A DISTINCT health on the late snapshot is the tell: it is presentable only while the
  // instant sits inside the tick-66 window with 66 as the older end. A collinear x could
  // not prove this — 66 lies on the 60→72 line — but a discrete value not on that line
  // can only appear if 66 was inserted between them.
  feed.observe(snapshot({ tick: 60, selfX: 60 * M_PER_TICK, selfHealth: 200 }), 0);
  feed.observe(snapshot({ tick: 72, selfX: 72 * M_PER_TICK, selfHealth: 50 }), 90);
  feed.observe(snapshot({ tick: 66, selfX: 66 * M_PER_TICK, selfHealth: 130 }), 120);

  let prev = -Infinity;
  let sawInserted = false;
  for (let now = 0; now <= 1_500; now += FRAME_MS) {
    const s = feed.sample(now);
    if (!s) continue;
    assert.ok(s.tick >= prev - 1e-9, "monotonic despite the late insert");
    prev = s.tick;
    if (s.tick >= 66 && s.tick < 72) {
      sawInserted = true;
      assert.equal(s.selfReadout.health, 130, "the late tick-66 snapshot bracketed the interval");
    }
  }
  assert.ok(sawInserted, "presentation passed through the tick-66 window");
});

test("an arrival older than the presented instant is ignored", () => {
  const feed = createSnapshotFeed();
  const script = movingSelf(0, 12, 90);
  let now = 0;
  let atArrival = 0;
  // Run until the presentation clock is well past the early ticks.
  let lastTick = 0;
  for (; now <= 1_500; now += FRAME_MS) {
    while (atArrival < script.length && script[atArrival]!.atMs <= now) {
      feed.observe(script[atArrival]!.snap, script[atArrival]!.atMs);
      atArrival += 1;
    }
    const s = feed.sample(now);
    if (s) lastTick = s.tick;
  }
  assert.ok(lastTick > 30, `clock only reached ${lastTick}`);

  // A snapshot from the distant past arrives late. It is behind the presentation clock,
  // so it must be dropped: the next sample cannot regress to it.
  feed.observe(snapshot({ tick: 6, selfX: 6 * M_PER_TICK }), now);
  const after = feed.sample(now + FRAME_MS);
  assert.ok(after);
  assert.ok(after.tick >= lastTick - 1e-9, `regressed to ${after.tick} from ${lastTick}`);
  assert.ok(after.self.x > 3, "self did not snap back to the stale position");
});

// ---- discrete state is the snapshot at or before the instant ----------------

test("health is the snapshot at or before the instant, and switches within a frame", () => {
  // Health falls at tick 72. Presentation crosses it partway through the run.
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, selfHealth: 200 }) },
    { atMs: 90, snap: snapshot({ tick: 66, selfHealth: 200 }) },
    { atMs: 180, snap: snapshot({ tick: 72, selfHealth: 140 }) },
    { atMs: 270, snap: snapshot({ tick: 78, selfHealth: 140 }) },
    { atMs: 360, snap: snapshot({ tick: 84, selfHealth: 140 }) },
    { atMs: 450, snap: snapshot({ tick: 90, selfHealth: 140 }) },
  ];
  const samples = play(script, 1_500);

  // Coherence: the health drawn is exactly the one attached to the tick at or before the
  // instant. Below 72 it is 200; at or beyond it is 140. Never a value in between.
  for (const s of samples) {
    const expected = s.tick < 72 ? 200 : 140;
    assert.equal(s.selfReadout.health, expected, `health ${s.selfReadout.health} at tick ${s.tick}`);
  }

  // Skew: the frame the health changes, the presentation tick is within one 60Hz frame
  // (one tick) of the authoritative tick it changed on.
  const flip = samples.findIndex((s) => s.selfReadout.health === 140);
  assert.ok(flip > 0, "the health drop was presented");
  assert.ok(Math.abs(samples[flip]!.tick - 72) <= 1 + 1e-9, `flip tick was ${samples[flip]!.tick}`);
});

test("phase and health that change on the same tick are always presented together", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, selfHealth: 200, phase: "ENGAGEMENT_LIVE" }) },
    { atMs: 90, snap: snapshot({ tick: 66, selfHealth: 200, phase: "ENGAGEMENT_LIVE" }) },
    { atMs: 180, snap: snapshot({ tick: 72, selfHealth: 150, phase: "LINE_OF_SIGHT_BREAK" }) },
    { atMs: 270, snap: snapshot({ tick: 78, selfHealth: 150, phase: "LINE_OF_SIGHT_BREAK" }) },
    { atMs: 360, snap: snapshot({ tick: 84, selfHealth: 150, phase: "LINE_OF_SIGHT_BREAK" }) },
    { atMs: 450, snap: snapshot({ tick: 90, selfHealth: 150, phase: "LINE_OF_SIGHT_BREAK" }) },
  ];
  const samples = play(script, 1_500);
  for (const s of samples) {
    // They come from one snapshot, so they can never disagree: no new health under an
    // old phase, no new phase over old health.
    const brokeSight = s.phase === "LINE_OF_SIGHT_BREAK";
    assert.equal(brokeSight, s.selfReadout.health === 150, `phase ${s.phase} with health ${s.selfReadout.health}`);
  }
});

test("a repeated tick still updates the phase, health and ammunition", () => {
  const feed = createSnapshotFeed();
  // The whole face-off, question and grant happen at tick 0. Each poll carries the same
  // tick with fresher discrete state, and the buffer must take the latest.
  feed.observe(snapshot({ tick: 0, phase: "FACE_OFF", selfHealth: 200 }), 1_000);
  feed.observe(snapshot({ tick: 0, phase: "QUESTION_PENDING", selfHealth: 200 }), 1_700);
  feed.observe(snapshot({ tick: 0, phase: "BULLETS_GRANTED", selfHealth: 180 }), 2_400);

  const sample = feed.sample(2_400);
  assert.ok(sample);
  assert.equal(sample.phase, "BULLETS_GRANTED");
  assert.equal(sample.selfReadout.health, 180);
  assert.equal(sample.tick, 0);
});

// ---- the culled opponent ----------------------------------------------------

test("an opponent the server can see is IN_SIGHT and interpolated by tick", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentX: 0 }) },
    { atMs: 90, snap: snapshot({ tick: 66, opponentX: 2 }) },
    { atMs: 180, snap: snapshot({ tick: 72, opponentX: 4 }) },
    { atMs: 270, snap: snapshot({ tick: 78, opponentX: 6 }) },
  ];
  const samples = play(script, 1_000);
  // Somewhere the presentation sits between ticks 60 and 66 with the opponent halfway.
  const mid = samples.find((s) => s.tick > 62 && s.tick < 64);
  assert.ok(mid && mid.opponent.kind === "IN_SIGHT");
  if (mid.opponent.kind !== "IN_SIGHT") return;
  const expectedX = (mid.tick - 60) * (2 / 6); // x climbs 2 per 6 ticks from tick 60
  assert.ok(Math.abs(mid.opponent.pose.x - expectedX) < 0.05, `opponent x ${mid.opponent.pose.x}`);
});

test("the opponent's facing, speed and dash are read from the snapshot, never inferred", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentX: 0 }) },
    {
      atMs: 90,
      snap: snapshot({
        tick: 66,
        opponentX: 2,
        opponentAimYaw: 1.1,
        opponentVX: 3,
        opponentVZ: 4,
        opponentDashing: true,
      }),
    },
    { atMs: 180, snap: snapshot({ tick: 72, opponentX: 4, opponentAimYaw: 1.1, opponentVX: 3, opponentVZ: 4, opponentDashing: true }) },
    { atMs: 270, snap: snapshot({ tick: 78, opponentX: 6, opponentAimYaw: 1.1, opponentVX: 3, opponentVZ: 4, opponentDashing: true }) },
  ];
  const samples = play(script, 1_000);
  // Read once the instant is inside the tick-66 window (so tick 66 is the older end).
  const s = samples.find((entry) => entry.tick >= 66 && entry.tick < 72);
  assert.ok(s && s.opponent.kind === "IN_SIGHT");
  if (!s || s.opponent.kind !== "IN_SIGHT") return;
  assert.equal(s.opponent.pose.yaw, 1.1, "facing is the projected aim yaw, not a guess");
  assert.ok(Math.abs(s.opponent.pose.speedMps - 5) < 1e-6, "speed is |projected velocity|");
  assert.equal(s.opponent.dashing, true, "dash is snapshot-backed");
});

test("a broken sight line reads as a sighting with an age, never as a position", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentX: 4 }) },
    { atMs: 90, snap: snapshot({ tick: 120, opponentX: 4, visible: false, positionAtTick: 60 }) },
    { atMs: 180, snap: snapshot({ tick: 180, opponentX: 4, visible: false, positionAtTick: 60 }) },
    { atMs: 270, snap: snapshot({ tick: 240, opponentX: 4, visible: false, positionAtTick: 60 }) },
  ];
  const samples = play(script, 1_200);
  const seen = samples.find((s) => s.opponent.kind === "LAST_SEEN" && s.tick >= 120);
  assert.ok(seen && seen.opponent.kind === "LAST_SEEN");
  if (!seen || seen.opponent.kind !== "LAST_SEEN") return;
  assert.ok(Math.abs(seen.opponent.ageS - (seen.tick - 60) / FIELD_TICK_HZ) < 1e-6);
  // Health stays public whether or not the body is visible: it is the scoreboard.
  assert.equal(seen.opponent.health, 200);
});

test("a remembered position is never interpolated towards", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, opponentX: 0 }) },
    { atMs: 90, snap: snapshot({ tick: 66, opponentX: 8, visible: false, positionAtTick: 40 }) },
    { atMs: 180, snap: snapshot({ tick: 72, opponentX: 8, visible: false, positionAtTick: 40 }) },
    { atMs: 270, snap: snapshot({ tick: 78, opponentX: 8, visible: false, positionAtTick: 40 }) },
  ];
  const samples = play(script, 1_000);
  // Once the instant is inside the invisible window, the remembered position is the
  // frozen one — never a walk from the last live position towards it.
  const hidden = samples.filter((s) => s.opponent.kind === "LAST_SEEN");
  assert.ok(hidden.length > 0);
  for (const s of hidden) {
    if (s.opponent.kind !== "LAST_SEEN") continue;
    assert.equal(s.opponent.pose.x, 8);
  }
});

test("a snapshot with no usable opponent position draws no opponent at all", () => {
  const broken = snapshot({ tick: 60 });
  const withoutPosition: MatchSnapshot = {
    ...broken,
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

  const feed = createSnapshotFeed();
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

// ---- shots and hits are observed once, when presentation crosses the tick ----

test("a shot fires its cue only when presentation crosses its tick, once", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60 }) },
    { atMs: 90, snap: snapshot({ tick: 66, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })] }) },
    { atMs: 180, snap: snapshot({ tick: 72, projectiles: [ball({ id: 7, x: 0.4, z: -3 })] }) },
    { atMs: 270, snap: snapshot({ tick: 78, projectiles: [ball({ id: 7, x: 0.4, z: -1 })] }) },
    { atMs: 360, snap: snapshot({ tick: 84 }) },
    { atMs: 450, snap: snapshot({ tick: 90 }) },
  ];
  const samples = play(script, 1_500);
  const before = samples.filter((s) => s.tick < 66);
  const after = samples.filter((s) => s.tick >= 66);
  assert.ok(before.length > 0 && after.length > 0, "presentation straddled the fire tick");

  for (const s of before) {
    assert.equal(s.cues.SELF.lastFireTick, -1, "no cue before the instant reaches it");
  }
  for (const s of after) {
    assert.equal(s.cues.SELF.lastFireTick, 66, "the cue is the authoritative fire tick");
    assert.equal(s.cues.OPPONENT.lastFireTick, -1);
  }
  // Origin is the ball's first reported position — close enough to a muzzle.
  assert.deepEqual(after[0]!.cues.SELF.lastFireOrigin, [0.4, 1.12, -5.2]);
});

test("the shooter is resolved against this client's own side, not against A", () => {
  const asSideB = (tick: number, projectiles: readonly ProjectileView[]): MatchSnapshot => {
    const base = snapshot({ tick, projectiles });
    return {
      ...base,
      self: { ...base.self, side: "B" },
      opponent: { ...base.opponent, side: "A" },
    };
  };
  const script: Arrival[] = [
    { atMs: 0, snap: asSideB(60, []) },
    { atMs: 90, snap: asSideB(66, [ball({ id: 3, shooter: "B" })]) },
    { atMs: 180, snap: asSideB(72, [ball({ id: 3, shooter: "B", z: 2 })]) },
    { atMs: 270, snap: asSideB(78, [ball({ id: 3, shooter: "B", z: 4 })]) },
  ];
  const samples = play(script, 1_000);
  const after = samples.find((s) => s.tick >= 66);
  assert.ok(after);
  // Side B's own ball is SELF's, however the authority labelled it.
  assert.equal(after.cues.SELF.lastFireTick, 66);
  assert.equal(after.cues.OPPONENT.lastFireTick, -1);
  const drawn = samples.find((s) => s.balls.length > 0);
  assert.ok(drawn);
  assert.equal(drawn.balls[0]?.shooter, "SELF");
});

test("a hit is health that fell, on whichever body lost it, once per tick", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60 }) },
    { atMs: 90, snap: snapshot({ tick: 66, selfHealth: 160 }) },
    { atMs: 180, snap: snapshot({ tick: 72, selfHealth: 160, opponentHealth: 150 }) },
    { atMs: 270, snap: snapshot({ tick: 78, selfHealth: 160, opponentHealth: 150 }) },
    { atMs: 360, snap: snapshot({ tick: 84, selfHealth: 160, opponentHealth: 150 }) },
    { atMs: 450, snap: snapshot({ tick: 90, selfHealth: 160, opponentHealth: 150 }) },
  ];
  const samples = play(script, 1_500);
  const settled = samples.filter((s) => s.tick >= 72);
  assert.ok(settled.length > 0);
  for (const s of settled) {
    assert.equal(s.cues.SELF.lastHitTick, 66);
    assert.equal(s.cues.OPPONENT.lastHitTick, 72);
  }
});

// ---- projectiles interpolate only between the two ends that agree they exist -

test("a ball is drawn only once presentation reaches its spawn tick", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60 }) },
    { atMs: 90, snap: snapshot({ tick: 66, projectiles: [ball({ id: 5, z: 0 })] }) },
    { atMs: 180, snap: snapshot({ tick: 72, projectiles: [ball({ id: 5, z: 2 })] }) },
    { atMs: 270, snap: snapshot({ tick: 78, projectiles: [ball({ id: 5, z: 4 })] }) },
    { atMs: 360, snap: snapshot({ tick: 84, projectiles: [ball({ id: 5, z: 6 })] }) },
  ];
  const samples = play(script, 1_200);
  const withBall = samples.filter((s) => s.balls.some((b) => b.id === 5));
  assert.ok(withBall.length > 0, "the ball is eventually drawn");
  for (const s of samples) {
    if (s.balls.some((b) => b.id === 5)) {
      // Never reconstructed backwards from the newer end before its spawn tick.
      assert.ok(s.tick >= 66 - 1e-9, `ball drawn at tick ${s.tick}, before it spawned`);
    }
  }
});

test("a removed ball holds its last position until the removal tick, then disappears", () => {
  // Ball 5 travels 60->66 (z 0 -> 2), then the server retires it at tick 72. It must be
  // HELD at its last authoritative position (z = 2) across the whole [66, 72) bracket —
  // not dropped at the midpoint, and not advanced past z = 2 — and gone once the removal
  // tick is presented.
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, projectiles: [ball({ id: 5, z: 0 })] }) },
    { atMs: 90, snap: snapshot({ tick: 66, projectiles: [ball({ id: 5, z: 2 })] }) },
    { atMs: 180, snap: snapshot({ tick: 72 }) },
    { atMs: 270, snap: snapshot({ tick: 78 }) },
    { atMs: 360, snap: snapshot({ tick: 84 }) },
  ];
  const samples = play(script, 1_200);
  let heldFrames = 0;
  let maxZ = -Infinity;
  for (const s of samples) {
    const b = s.balls.find((entry) => entry.id === 5);
    if (b) {
      assert.ok(s.tick < 72 + 1e-6, `ball still drawn at tick ${s.tick}, past its removal`);
      maxZ = Math.max(maxZ, b.z);
      if (s.tick >= 66) {
        heldFrames += 1;
        assert.ok(Math.abs(b.z - 2) < 1e-6, `held ball drifted to z=${b.z}`);
      }
    }
  }
  // The ball survived the removal bracket instead of vanishing early at the midpoint.
  assert.ok(heldFrames > 0, "the ball was removed early, not held to the removal tick");
  // Never carried past its last reported position.
  assert.ok(maxZ <= 2 + 1e-6, `ball advanced to z=${maxZ}, past its last report`);
  // And it is gone exactly once the removal tick is presented.
  assert.ok(
    samples.some((s) => s.tick >= 72 && !s.balls.some((b) => b.id === 5)),
    "the ball outlived its removal tick",
  );
});

test("a ball present in both ends of the bracket is interpolated between them", () => {
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, projectiles: [ball({ id: 9, z: 0 })] }) },
    { atMs: 90, snap: snapshot({ tick: 66, projectiles: [ball({ id: 9, z: 6 })] }) },
    { atMs: 180, snap: snapshot({ tick: 72, projectiles: [ball({ id: 9, z: 12 })] }) },
    { atMs: 270, snap: snapshot({ tick: 78, projectiles: [ball({ id: 9, z: 18 })] }) },
  ];
  const samples = play(script, 1_000);
  for (const s of samples) {
    const b = s.balls.find((entry) => entry.id === 9);
    if (!b) continue;
    // z climbs 1 per tick from tick 60, so the drawn z tracks the presentation tick.
    assert.ok(Math.abs(b.z - (s.tick - 60)) < 0.2, `z ${b.z} at tick ${s.tick} is not on the line`);
  }
});

// ---- the face-off, still timed in wall clock --------------------------------

test("the face-off is timed in wall clock, because its tick is not projected", () => {
  const feed = createSnapshotFeed();
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

// ---- same-tick cue reconciliation -------------------------------------------

test("a same-tick replacement reveals fire and hit cues once, without duplicates", () => {
  const feed = createSnapshotFeed();
  // A run of live ticks, none carrying a shot or a hit yet.
  const ticks = [60, 66, 72, 78, 84, 90, 96, 102, 108];
  for (const t of ticks) feed.observe(snapshot({ tick: t }), ((t - 60) / 6) * 90);

  // A fuller RETRANSMISSION of tick 90 arrives — same tick, now carrying a ball (a shot)
  // and a lower opponent health (a hit) that the first copy of tick 90 did not have.
  const reveal = () =>
    snapshot({ tick: 90, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })], opponentHealth: 150 });
  feed.observe(reveal(), 9000);
  // Replacing it AGAIN, identically, must not double-count: the id and the tick are the
  // stable keys, so the journal reconciles rather than appends.
  feed.observe(reveal(), 9100);

  const seenFire = new Set<number>();
  const seenHit = new Set<number>();
  for (let now = 0; now <= 3000; now += FRAME_MS) {
    const s = feed.sample(now);
    if (!s) continue;
    seenFire.add(s.cues.SELF.lastFireTick);
    seenHit.add(s.cues.OPPONENT.lastHitTick);
  }
  const end = feed.sample(3000)!;
  // The shot is the local player's (ball shooter A === self side A), emitted at tick 90
  // with the ball's first reported position as the muzzle.
  assert.equal(end.cues.SELF.lastFireTick, 90, "the replacement's fire was not reconciled");
  assert.deepEqual(end.cues.SELF.lastFireOrigin, [0.4, 1.12, -5.2]);
  assert.equal(end.cues.OPPONENT.lastHitTick, 90, "the replacement's hit was not reconciled");
  // Once, not twice: the only fire tick ever presented is -1 (before) or 90 (after).
  assert.ok([...seenFire].every((v) => v === -1 || v === 90), `fire flickered: ${[...seenFire]}`);
  assert.ok([...seenHit].every((v) => v === -1 || v === 90), `hit flickered: ${[...seenHit]}`);
});

test("a same-tick replacement reveals a fire-only cue, leaving the hit journal empty", () => {
  const feed = createSnapshotFeed();
  for (const t of [60, 66, 72, 78, 84, 90, 96, 102, 108]) {
    feed.observe(snapshot({ tick: t }), ((t - 60) / 6) * 90);
  }
  feed.observe(snapshot({ tick: 90, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })] }), 9000);
  const end = feed.sample(3000)!;
  assert.equal(end.cues.SELF.lastFireTick, 90);
  assert.deepEqual(end.cues.SELF.lastFireOrigin, [0.4, 1.12, -5.2]);
  assert.equal(end.cues.OPPONENT.lastHitTick, -1, "a fire-only revision must not journal a hit");
  assert.equal(end.cues.SELF.lastHitTick, -1);
});

test("a same-tick replacement reveals a hit-only cue, leaving the fire journal empty", () => {
  const feed = createSnapshotFeed();
  for (const t of [60, 66, 72, 78, 84, 90, 96, 102, 108]) {
    feed.observe(snapshot({ tick: t }), ((t - 60) / 6) * 90);
  }
  feed.observe(snapshot({ tick: 90, opponentHealth: 150 }), 9000);
  const end = feed.sample(3000)!;
  assert.equal(end.cues.OPPONENT.lastHitTick, 90);
  assert.equal(end.cues.SELF.lastFireTick, -1, "a hit-only revision must not journal a fire");
  assert.equal(end.cues.OPPONENT.lastFireTick, -1);
});

test("a same-tick replacement journals a cue with NO adjacent tick to compare against", () => {
  const feed = createSnapshotFeed();
  // A single tick in the buffer: there is no predecessor to diff against, only the
  // previous REVISION of this same tick.
  feed.observe(snapshot({ tick: 60 }), 0);
  assert.equal(feed.sample(0)!.tick, 60);
  feed.observe(snapshot({ tick: 60, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })], opponentHealth: 150 }), 10);
  const s = feed.sample(16)!;
  assert.equal(s.cues.SELF.lastFireTick, 60, "no-adjacent-tick fire was not journalled");
  assert.deepEqual(s.cues.SELF.lastFireOrigin, [0.4, 1.12, -5.2]);
  assert.equal(s.cues.OPPONENT.lastHitTick, 60, "no-adjacent-tick hit was not journalled");
  // Replacing again identically does not re-emit to a new tick or duplicate.
  feed.observe(snapshot({ tick: 60, projectiles: [ball({ id: 7, x: 0.4, z: -5.2 })], opponentHealth: 150 }), 20);
  const s2 = feed.sample(32)!;
  assert.equal(s2.cues.SELF.lastFireTick, 60);
  assert.equal(s2.cues.OPPONENT.lastHitTick, 60);
});

// ---- jitter is measured honestly --------------------------------------------

test("a stale or duplicate arrival is excluded from the jitter estimate", () => {
  const feed = createSnapshotFeed();
  for (let n = 0; n < 8; n += 1) feed.observe(snapshot({ tick: 60 + n * 6 }), n * 90);
  feed.sample(1_000); // seed the clock behind the head
  const before = feed.renderDelayMs();

  // A stale arrival (a tick far behind the instant) and a duplicate of the head tick, both
  // with wildly different arrival spacing, must not move the delay a millisecond.
  feed.observe(snapshot({ tick: 0 }), 5_000);
  feed.observe(snapshot({ tick: 60 + 7 * 6 }), 9_000);
  assert.equal(feed.renderDelayMs(), before, "a stale/duplicate arrival leaked into the window");
});

test("question-cadence polling never inflates the live render delay", () => {
  const feed = createSnapshotFeed();
  for (let n = 0; n < 8; n += 1) {
    feed.observe(snapshot({ tick: 60 + n * 6, phase: "ENGAGEMENT_LIVE" }), n * 90);
  }
  const liveDelay = feed.renderDelayMs();
  assert.ok(liveDelay < 200, `live delay already inflated: ${liveDelay}`);

  // A question opens: the combat tick freezes and polling slows to 700ms. Those are
  // duplicate ticks at a slow cadence, and must not enter the live jitter window.
  const frozenTick = 60 + 7 * 6;
  for (let n = 0; n < 5; n += 1) {
    feed.observe(snapshot({ tick: frozenTick, phase: "QUESTION_PENDING" }), 700 + n * 700);
  }
  assert.ok(
    feed.renderDelayMs() <= liveDelay + 1e-9,
    `question cadence inflated the delay to ${feed.renderDelayMs()}`,
  );

  // Live resumes. The first live advance resets the arrival window, so the delay rebuilds
  // from 90ms live gaps rather than carrying the 700ms question cadence.
  let tick = frozenTick;
  let atMs = 700 * 6;
  for (let n = 0; n < 8; n += 1) {
    tick += 6;
    atMs += 90;
    feed.observe(snapshot({ tick, phase: "ENGAGEMENT_LIVE" }), atMs);
  }
  assert.ok(feed.renderDelayMs() < 200, `resumed live delay stayed inflated at ${feed.renderDelayMs()}`);
});

test("a question->live hand-off on the same frozen tick resets the window, keeping ~live delay", () => {
  const feed = createSnapshotFeed();
  for (let n = 0; n < 8; n += 1) {
    feed.observe(snapshot({ tick: 60 + n * 6, phase: "ENGAGEMENT_LIVE" }), n * 90);
  }
  assert.ok(feed.renderDelayMs() < 200);

  // A question opens: slow 700ms polls of the frozen tick (all duplicates).
  const frozen = 60 + 7 * 6;
  for (let n = 0; n < 4; n += 1) {
    feed.observe(snapshot({ tick: frozen, phase: "QUESTION_PENDING" }), 700 + n * 700);
  }
  // The hand-off arrives as the SAME frozen tick, now live — a DUPLICATE that carries the
  // cadence change. Without a reset in the duplicate branch, the last arrival time still
  // points ~2s back at the pre-question poll, and the next real advance measures a giant
  // gap and inflates the delay to the 750ms ceiling.
  feed.observe(snapshot({ tick: frozen, phase: "ENGAGEMENT_LIVE" }), 3_500);
  let tick = frozen;
  let atMs = 3_500;
  for (let n = 0; n < 8; n += 1) {
    tick += 6;
    atMs += 90;
    feed.observe(snapshot({ tick, phase: "ENGAGEMENT_LIVE" }), atMs);
  }
  assert.ok(
    feed.renderDelayMs() < 200,
    `the same-tick hand-off inflated the delay to ${feed.renderDelayMs()}`,
  );
});

// ---- the banner reads the delayed sample, not the raw snapshot --------------

test("the hidden-opponent banner lags the raw snapshot, reading the same sample as the body", () => {
  const feed = createSnapshotFeed();
  // Visible through tick 66, then the server reports the sight line broken from tick 72.
  const script: Arrival[] = [
    { atMs: 0, snap: snapshot({ tick: 60, visible: true }) },
    { atMs: 90, snap: snapshot({ tick: 66, visible: true }) },
    { atMs: 180, snap: snapshot({ tick: 72, visible: false, positionAtTick: 66 }) },
    { atMs: 270, snap: snapshot({ tick: 78, visible: false, positionAtTick: 66 }) },
    { atMs: 360, snap: snapshot({ tick: 84, visible: false, positionAtTick: 66 }) },
  ];
  // The banner shows "out of sight" from `sample.opponent.kind`, and the body draws from
  // the SAME `sample.opponent` — so they are in parity by construction. The property that
  // the banner reads the DELAYED sample (not the raw newest) is what this proves: there
  // are frames where the raw snapshot already says invisible while the sample still says
  // IN_SIGHT, and the banner must follow the sample.
  let rawHiddenWhileSampleInSight = false;
  let idx = 0;
  let rawVisible = true;
  for (let now = 0; now <= 1_200; now += FRAME_MS) {
    while (idx < script.length && script[idx]!.atMs <= now) {
      feed.observe(script[idx]!.snap, script[idx]!.atMs);
      rawVisible = script[idx]!.snap.opponent.visible;
      idx += 1;
    }
    const s = feed.sample(now);
    if (!s) continue;
    if (!rawVisible && s.opponent.kind === "IN_SIGHT") rawHiddenWhileSampleInSight = true;
  }
  assert.ok(
    rawHiddenWhileSampleInSight,
    "the banner tracked the raw snapshot, not the delayed sample",
  );
  assert.equal(feed.sample(1_200)!.opponent.kind, "LAST_SEEN", "the sample never caught up");
});

// ---- deterministic latency, jitter and loss --------------------------------
//
// The whole point of the buffer is a bound on how far a body can visibly jump in one
// 60Hz frame under a hostile network, with NO extrapolation — every drawn position is
// one the server reported or a point on the line between two of them. These runs prove
// that bound across many seeds, and the accompanying zero-extrapolation check proves it
// is met honestly rather than by guessing ahead.

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface NetParams {
  readonly latencyMs: number;
  readonly jitterMs: number;
  readonly loss: number;
  readonly durationS: number;
}

interface NetResult {
  readonly maxStepM: number;
  readonly maxOverHeadM: number;
  readonly samples: number;
  readonly arrivals: number;
}

// A dropped request stalls until the SHARED transport timeout (imported from protocol.ts,
// so the model and production cannot drift), then the loop's own poll delay.
/** The live poll delay AFTER a response completes — the recursive loop's own cadence. */
const LIVE_POLL_MS = 90;

/**
 * Model the PRODUCTION recursive poll loop, not a fixed emitter.
 *
 * `usePvpSession` sends a request, awaits the response a full round trip later, ingests
 * the snapshot, and only THEN schedules the next request 90ms on. There is never more
 * than one request in flight and emissions never overlap: the inter-arrival gap is
 * `rtt + 90ms`, and a dropped request stalls for a timeout before the next. The server
 * sampled the state it returns roughly mid-flight, so the arriving tick is the server's
 * tick at `requestStart + rtt/2`. The 60Hz render loop samples continuously over the
 * arrivals this produces.
 */
function runRecursive(seed: number, p: NetParams): NetResult {
  const rand = rng(seed);
  const feed = createSnapshotFeed();
  const totalMs = p.durationS * 1000;

  const arrivals: Arrival[] = [];
  let requestStart = 0;
  while (requestStart <= totalMs) {
    const jitter = p.jitterMs > 0 ? (rand() * 2 - 1) * p.jitterMs : 0;
    const rtt = Math.max(1, p.latencyMs + jitter);
    // PRODUCTION TIMEOUT PARITY. A response that would arrive at or after the shared
    // request timeout is not a late response — production aborts it at the deadline and
    // reads it as UNREACHABLE. So it is a drop here too: no arrival, and the recursive
    // loop waits the timeout then its 90ms poll. This is exactly what the transport does.
    if ((p.loss > 0 && rand() < p.loss) || rtt >= REQUEST_TIMEOUT_MS) {
      requestStart += REQUEST_TIMEOUT_MS + LIVE_POLL_MS;
      continue;
    }
    const responseAt = requestStart + rtt;
    const serverSampledMs = requestStart + rtt / 2;
    const tick = Math.round((serverSampledMs * FIELD_TICK_HZ) / 1000);
    arrivals.push({ atMs: responseAt, snap: snapshot({ tick, selfX: tick * M_PER_TICK }) });
    // Next request starts only AFTER this response completes, then the poll delay.
    requestStart = responseAt + LIVE_POLL_MS;
  }
  // Sequential loop, so responses complete in order; sort only defensively.
  arrivals.sort((a, b) => a.atMs - b.atMs);

  let next = 0;
  let observedHeadTick = -Infinity;
  let prevX: number | null = null;
  let prevTick = -Infinity;
  let maxStepM = 0;
  let maxOverHeadM = 0;
  let samples = 0;

  for (let now = 0; now <= totalMs; now += FRAME_MS) {
    while (next < arrivals.length && arrivals[next]!.atMs <= now) {
      feed.observe(arrivals[next]!.snap, arrivals[next]!.atMs);
      observedHeadTick = Math.max(observedHeadTick, arrivals[next]!.snap.tick);
      next += 1;
    }
    const s = feed.sample(now);
    if (!s) continue;
    samples += 1;
    assert.ok(s.tick >= prevTick - 1e-9, `tick regressed: ${s.tick} < ${prevTick}`);
    prevTick = s.tick;
    // No extrapolation: never drawn ahead of the newest position the server sent.
    maxOverHeadM = Math.max(maxOverHeadM, s.self.x - observedHeadTick * M_PER_TICK);
    if (prevX !== null) maxStepM = Math.max(maxStepM, Math.abs(s.self.x - prevX));
    prevX = s.self.x;
  }
  return { maxStepM, maxOverHeadM, samples, arrivals: arrivals.length };
}

const displacementReport: string[] = [];

function sweep(name: string, p: NetParams, boundM: number): void {
  test(`recursive-loop frame displacement stays under ${boundM}m: ${name}`, () => {
    let worst = 0;
    for (let seed = 1; seed <= 24; seed += 1) {
      const r = runRecursive(seed, p);
      assert.ok(r.samples > 500, `${name} seed ${seed} produced too few samples: ${r.samples}`);
      // Honest: nothing was ever drawn ahead of the authority.
      assert.ok(r.maxOverHeadM <= 1e-9, `${name} seed ${seed} extrapolated by ${r.maxOverHeadM}m`);
      // No multi-metre teleport under any seed.
      assert.ok(r.maxStepM < 1, `${name} seed ${seed} teleported ${r.maxStepM}m`);
      worst = Math.max(worst, r.maxStepM);
    }
    displacementReport.push(`${name.padEnd(26)} worst ${worst.toFixed(4)}m (bound ${boundM}m)`);
    assert.ok(worst <= boundM, `${name} worst frame displacement was ${worst.toFixed(4)}m (bound ${boundM}m)`);
  });
}

// >= 20 seeds per scenario (24), modelling the recursive request/response/poll loop.
sweep("localhost", { latencyMs: 1, jitterMs: 0, loss: 0, durationS: 20 }, 0.16);
sweep("50ms", { latencyMs: 50, jitterMs: 0, loss: 0, durationS: 20 }, 0.16);
sweep("100ms", { latencyMs: 100, jitterMs: 0, loss: 0, durationS: 20 }, 0.25);
sweep(
  "200ms jitter and loss",
  { latencyMs: 200, jitterMs: 80, loss: 0.1, durationS: 20 },
  0.5,
);

test("measured recursive-loop displacement (reported)", () => {
  // Printed so the exact numbers are on the record, per the audit's "report measured".
  console.log(`\n  recursive-loop displacement\n    ${displacementReport.join("\n    ")}\n`);
  assert.equal(displacementReport.length, 4, "all four scenarios were measured");
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
