// From authoritative snapshots to something drawable, and NOTHING ELSE.
//
// This is the whole of PvP's presentation logic and it is deliberately the only file
// in the arena that holds any state at all. What it does is interpolate: it keeps the
// last two snapshots the server sent and reports where things were at a presentation
// time one poll-gap BEHIND the newest one. What it does not do, anywhere, is decide.
//
// WHY BEHIND RATHER THAN AHEAD. Extrapolating forward from a snapshot is prediction,
// and prediction that is never reconciled is just a client disagreeing with the
// server — the exact thing PvP's server authority exists to rule out. Interpolating
// between two things the server already said cannot disagree with it: every position
// drawn is one the authority actually reported, or a point on the straight line
// between two of them. The cost is a poll of latency and the benefit is that a 90ms
// poll does not read as 11 frames a second.
//
// THE SEAM FOR PREDICTION. `packages/netcode` measures zero reconciliation error out
// to 442ms of round trip, and wiring it in is deliberately not this change. So the
// stage consumes `ArenaSource` — "give me a sample for this instant" — and never sees
// a snapshot. Handing it a predicted source later is a constructor swap; nothing
// downstream of `sample()` knows where a pose came from.
//
// WHAT IS OBSERVED VERSUS WHAT IS INVENTED. Every number below is either copied from
// a snapshot, interpolated between two of them, or derived by comparing two of them
// (a ball that appeared is a shot; health that fell is a hit). Three presentation
// facts are not in the projection at all and each is named where it is decided:
// an out-of-sight opponent's facing, an opponent's dash, and where a ball stopped.
// None of them changes a number the player is scored on.

import { FIELD_DT, FIELD_TICK_HZ, type DuelPhase, type DuelSide } from "@pa/duel";
import { isCrouched } from "@pa/engine-world";
import { lerpPose, normaliseAngle, type ActorPose } from "../duel/duelRuntime.js";
import type { MatchSnapshot, ProjectileView } from "./protocol.js";

/** Which body a cue belongs to. Local words, because the local player may be side B. */
export type ArenaActor = "SELF" | "OPPONENT";

/** Everything PvP can honestly say about when a body last did something visible. */
export interface ArenaCues {
  /** Tick a ball of theirs first appeared, or -1. */
  readonly lastFireTick: number;
  /** Where that ball was first seen, which is close enough to a muzzle. */
  readonly lastFireOrigin: readonly [number, number, number] | null;
  /** Tick their health was first seen lower, or -1. */
  readonly lastHitTick: number;
}

const NO_CUES: ArenaCues = {
  lastFireTick: -1,
  lastFireOrigin: null,
  lastHitTick: -1,
};

/**
 * Where the opponent is, or the honest absence of that.
 *
 * `LAST_SEEN` is the case the projection is built around: once cover breaks the line
 * of sight the server stops refreshing their position and says so, and a client that
 * drew it as current would be showing a position it was told is stale. `UNPLACED` is
 * the defensive case — a projection that carries no usable position at all — and it
 * draws nothing rather than a body at the origin.
 */
export type OpponentSighting =
  | {
      readonly kind: "IN_SIGHT";
      readonly pose: ActorPose;
      readonly health: number;
      readonly ammo: number;
      readonly answering: boolean;
    }
  | {
      readonly kind: "LAST_SEEN";
      readonly pose: ActorPose;
      readonly health: number;
      readonly ammo: number;
      readonly answering: boolean;
      /** Seconds since the server could last see them. */
      readonly ageS: number;
    }
  | {
      readonly kind: "UNPLACED";
      readonly health: number;
      readonly ammo: number;
      readonly answering: boolean;
    };

export interface SelfReadout {
  readonly side: DuelSide;
  readonly health: number;
  readonly ammo: number;
  readonly dashing: boolean;
  readonly dodgeReadyAtTick: number;
  readonly invulnerableUntilTick: number;
}

/** A ball, at the presentation instant. `fade` carries one that has just stopped. */
export interface DrawnBall {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  readonly shooter: ArenaActor;
  readonly fade: number;
}

export interface ArenaSample {
  readonly matchId: string;
  /** Interpolated, so it is fractional. Cue ages are measured against it. */
  readonly tick: number;
  readonly phase: DuelPhase;
  readonly round: number;
  /** Seconds into the face-off, for the draw and the camera drift. */
  readonly faceOffElapsedS: number;
  readonly self: ActorPose;
  readonly selfReadout: SelfReadout;
  readonly opponent: OpponentSighting;
  readonly balls: readonly DrawnBall[];
  readonly cues: Readonly<Record<ArenaActor, ArenaCues>>;
}

/** What the stage draws from. A predicted source satisfies this too. */
export interface ArenaSource {
  sample(nowMs: number): ArenaSample | null;
}

/**
 * How long a body drawn from memory stays on screen after the sight line breaks.
 *
 * Short on purpose. A ghost that lingers is worse than no ghost at all: it is a body
 * standing still in the open, which is a position the player will shoot at and the
 * server will not agree is there. Long enough to read as "he stepped behind that",
 * short enough that nobody aims at it.
 */
export const SIGHTING_GHOST_SECONDS = 1.4;

/**
 * Opacity for a body the server can no longer see, or 0 to stop drawing it.
 *
 * The fade is the whole disclosure: `visible: false` means the position is where they
 * WERE, and a client that drew it at full strength would be presenting a memory as a
 * fact. Once it reaches zero the ground mark carries the sighting on alone.
 */
export function staleBodyOpacity(ageS: number): number {
  if (ageS >= SIGHTING_GHOST_SECONDS) return 0;
  const remaining = 1 - Math.max(0, ageS) / SIGHTING_GHOST_SECONDS;
  return 0.42 * remaining;
}

export interface SnapshotFeed extends ArenaSource {
  observe(snapshot: MatchSnapshot, atMs: number): void;
}

/**
 * Bounds on the gap between two snapshots, for the interpolation clock only.
 *
 * A pause — a backgrounded tab, a stalled network — must not make the next pair
 * interpolate over four seconds, and two responses that land together must not
 * divide by zero. Outside these the feed simply shows the newest snapshot, which is
 * the truthful degradation: no motion invented across a gap nobody observed.
 */
const MIN_GAP_MS = 16;
const MAX_GAP_MS = 400;

/**
 * How long a ball that has stopped keeps being drawn, in seconds.
 *
 * Shorter than a live poll on purpose, so a ball that has reached its end is off
 * screen before the next snapshot rather than hanging in the air.
 */
const BALL_FADE_S = 0.06;

interface Observed {
  readonly snapshot: MatchSnapshot;
  readonly atMs: number;
}

function finite(value: number): boolean {
  return Number.isFinite(value);
}

function placed(position: { x: number; y: number; z: number } | undefined): boolean {
  return (
    position !== undefined &&
    finite(position.x) &&
    finite(position.y) &&
    finite(position.z)
  );
}

/** Facing towards a point, in the engine's yaw convention. */
function yawTowards(fromX: number, fromZ: number, toX: number, toZ: number): number {
  return Math.atan2(toX - fromX, toZ - fromZ);
}

function selfPose(snapshot: MatchSnapshot): ActorPose {
  const self = snapshot.self;
  const speedMps = Math.hypot(self.velocity.x, self.velocity.z);
  let travelOffFacing = 0;
  if (speedMps > 0.05) {
    const travel = Math.atan2(self.velocity.x, self.velocity.z);
    travelOffFacing = Math.abs(normaliseAngle(travel - self.yaw));
  }
  return {
    x: self.position.x,
    y: self.position.y,
    z: self.position.z,
    yaw: self.yaw,
    capsuleHeight: self.capsuleHeight,
    // The engine's own rule: stance is the live capsule, not the phase name.
    crouched: isCrouched(self.capsuleHeight),
    speedMps,
    travelOffFacing,
  };
}

/**
 * The opponent's pose at the newest snapshot.
 *
 * Their velocity is NOT projected — it is not needed to render a duel and would be a
 * free extra about a classmate's body — so speed is measured across the two
 * snapshots instead, and only while both ends were in sight. Facing is the one thing
 * here with no observable source at all: while they are moving it follows the way
 * they are travelling, and when they are standing still or out of sight it turns to
 * the local player, because a duelling body has to point somewhere and pointing at
 * their opponent is the only default that never looks like a mistake.
 */
function opponentPose(
  before: MatchSnapshot | null,
  latest: MatchSnapshot,
  lookAt: { readonly x: number; readonly z: number },
): ActorPose {
  const now = latest.opponent;
  const bracketed =
    before !== null &&
    before.opponent.visible &&
    now.visible &&
    placed(before.opponent.position) &&
    latest.tick > before.tick;
  const stepX = bracketed ? now.position.x - before.opponent.position.x : 0;
  const stepZ = bracketed ? now.position.z - before.opponent.position.z : 0;
  const seconds = bracketed ? (latest.tick - before.tick) * FIELD_DT : 0;
  const speedMps = seconds > 0 ? Math.hypot(stepX, stepZ) / seconds : 0;
  return {
    x: now.position.x,
    y: now.position.y,
    z: now.position.z,
    yaw:
      speedMps > 0.25
        ? Math.atan2(stepX, stepZ)
        : yawTowards(now.position.x, now.position.z, lookAt.x, lookAt.z),
    capsuleHeight: now.capsuleHeight,
    crouched: isCrouched(now.capsuleHeight),
    speedMps,
    travelOffFacing: 0,
  };
}

function ballsAt(
  previous: Observed | null,
  latest: Observed,
  alpha: number,
  gapS: number,
): readonly DrawnBall[] {
  const selfSide = latest.snapshot.self.side;
  const actorOf = (shooter: DuelSide): ArenaActor =>
    shooter === selfSide ? "SELF" : "OPPONENT";
  const now = latest.snapshot.projectiles;
  const before = previous?.snapshot.projectiles ?? [];
  const byId = new Map<number, ProjectileView>();
  for (const ball of before) byId.set(ball.id, ball);

  const out: DrawnBall[] = [];
  for (const ball of now) {
    const older = byId.get(ball.id);
    if (older) {
      out.push({
        id: ball.id,
        x: older.x + (ball.x - older.x) * alpha,
        y: older.y + (ball.y - older.y) * alpha,
        z: older.z + (ball.z - older.z) * alpha,
        vx: ball.vx,
        vz: ball.vz,
        shooter: actorOf(ball.shooter),
        fade: 1,
      });
      byId.delete(ball.id);
      continue;
    }
    // Spawned inside the gap. Reconstructed BACKWARDS down its own known line, the
    // same trick the duel uses between fixed steps: a ball travels straight at a
    // constant speed, so where it was is arithmetic rather than a guess. The offset
    // shrinks to nothing as the presentation instant catches up to this snapshot.
    const back = (1 - alpha) * gapS;
    out.push({
      id: ball.id,
      x: ball.x - ball.vx * back,
      y: ball.y,
      z: ball.z - ball.vz * back,
      vx: ball.vx,
      vz: ball.vz,
      shooter: actorOf(ball.shooter),
      fade: 1,
    });
  }

  // Gone by the newest snapshot: it hit something or it expired, and the server does
  // not say which. It is carried forward along its line to the end of the interval
  // and faded out, so a ball reaches its stopping point instead of blinking away
  // mid-flight. Nothing claims to know what it struck — a landed hit is drawn from
  // the health that changed, which IS in the snapshot.
  for (const ball of byId.values()) {
    const travelled = alpha * gapS;
    const fade = Math.min(1, Math.max(0, 1 - travelled / BALL_FADE_S));
    if (fade <= 0) continue;
    out.push({
      id: ball.id,
      x: ball.x + ball.vx * travelled,
      y: ball.y,
      z: ball.z + ball.vz * travelled,
      vx: ball.vx,
      vz: ball.vz,
      shooter: actorOf(ball.shooter),
      fade,
    });
  }
  return out;
}

export function createSnapshotFeed(): SnapshotFeed {
  let previous: Observed | null = null;
  let latest: Observed | null = null;
  let cues: Record<ArenaActor, ArenaCues> = { SELF: NO_CUES, OPPONENT: NO_CUES };
  let faceOffStartedAtMs: number | null = null;
  const seenBallIds = new Set<number>();

  const noteCues = (snapshot: MatchSnapshot, before: MatchSnapshot | null): void => {
    const selfSide = snapshot.self.side;
    let self = cues.SELF;
    let opponent = cues.OPPONENT;

    for (const ball of snapshot.projectiles) {
      if (seenBallIds.has(ball.id)) continue;
      seenBallIds.add(ball.id);
      const cue = {
        lastFireTick: snapshot.tick,
        lastFireOrigin: [ball.x, ball.y, ball.z] as const,
      };
      if (ball.shooter === selfSide) self = { ...self, ...cue };
      else opponent = { ...opponent, ...cue };
    }
    // Ids are per match and only ever climb, so forgetting the ones already behind
    // the oldest ball in flight keeps this bounded over a long duel.
    const oldest = snapshot.projectiles.reduce(
      (low, ball) => Math.min(low, ball.id),
      Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(oldest)) {
      for (const id of seenBallIds) if (id < oldest - 1) seenBallIds.delete(id);
    }

    if (before) {
      if (snapshot.self.health < before.self.health) {
        self = { ...self, lastHitTick: snapshot.tick };
      }
      if (snapshot.opponent.health < before.opponent.health) {
        opponent = { ...opponent, lastHitTick: snapshot.tick };
      }
    }
    cues = { SELF: self, OPPONENT: opponent };
  };

  return {
    observe(snapshot: MatchSnapshot, atMs: number): void {
      noteCues(snapshot, latest?.snapshot ?? null);
      if (snapshot.phase === "FACE_OFF" && faceOffStartedAtMs === null) {
        faceOffStartedAtMs = atMs;
      }
      // THE PROJECTED TICK IS THE COMBAT TICK, AND IT ONLY MOVES WHILE COMBAT DOES.
      // The duel's clock and its combat clock are separate: nothing steps the fighters
      // during the face-off or while a question is open, so `tick` sits still for
      // twenty seconds at a time and every snapshot in that window carries the same
      // one. An earlier version treated a repeated tick as nothing new and dropped the
      // whole snapshot, which meant the phase, the health and the ammunition all froze
      // at whatever they were when the tick last moved — the arena stayed in the
      // face-off while the question panel was already open beside it.
      //
      // So a repeated tick still replaces the newest snapshot. What it does not do is
      // open a new interpolation window: the arrival time of the FIRST snapshot at this
      // tick is kept, so alpha runs to 1 and stays there instead of restarting from
      // zero and stuttering the bodies backwards.
      if (latest && snapshot.tick === latest.snapshot.tick) {
        latest = { snapshot, atMs: latest.atMs };
        return;
      }
      previous = latest;
      latest = { snapshot, atMs };
    },

    sample(nowMs: number): ArenaSample | null {
      if (!latest) return null;
      const newest = latest.snapshot;
      const rawGap = previous ? latest.atMs - previous.atMs : 0;
      const interpolating =
        previous !== null && rawGap >= MIN_GAP_MS && rawGap <= MAX_GAP_MS;
      const gapS = interpolating ? rawGap / 1000 : 0;
      const alpha = interpolating
        ? Math.min(1, Math.max(0, (nowMs - latest.atMs) / rawGap))
        : 1;
      const from = interpolating ? previous : latest;

      const self = interpolating
        ? lerpPose(selfPose(from!.snapshot), selfPose(newest), alpha)
        : selfPose(newest);
      const tick = interpolating
        ? from!.snapshot.tick + (newest.tick - from!.snapshot.tick) * alpha
        : newest.tick;

      const older = interpolating ? from!.snapshot : null;
      const opponentCommon = {
        health: newest.opponent.health,
        ammo: newest.opponent.ammo,
        answering: newest.opponent.answering,
      };
      let opponent: OpponentSighting;
      // The absence is checked BEFORE a pose is built, not after: `opponentPose` reads
      // coordinates, and a projection that carries none must produce no body rather
      // than a body at the origin or a NaN transform three.js will silently keep.
      if (!placed(newest.opponent.position)) {
        opponent = { kind: "UNPLACED", ...opponentCommon };
      } else if (newest.opponent.visible) {
        const opponentAt = opponentPose(older, newest, self);
        // The POSITION is interpolated, and only while both ends of the interval were
        // in sight: sliding from a remembered position to a fresh one would draw a
        // walk the server never reported, along a path that very likely goes through
        // the cover that broke the sight line in the first place. Facing and speed
        // come from the newest end alone, so neither ramps across the interval.
        const bracketed =
          older !== null &&
          older.opponent.visible &&
          placed(older.opponent.position);
        opponent = {
          kind: "IN_SIGHT",
          pose: bracketed
            ? lerpPose(
                {
                  ...opponentAt,
                  x: older.opponent.position.x,
                  y: older.opponent.position.y,
                  z: older.opponent.position.z,
                },
                opponentAt,
                alpha,
              )
            : opponentAt,
          ...opponentCommon,
        };
      } else {
        opponent = {
          kind: "LAST_SEEN",
          pose: opponentPose(older, newest, self),
          ageS: Math.max(0, (newest.tick - newest.opponent.positionAtTick) / FIELD_TICK_HZ),
          ...opponentCommon,
        };
      }

      return {
        matchId: newest.matchId,
        tick,
        phase: newest.phase,
        round: newest.round,
        // MEASURED IN WALL TIME, AND IT HAS TO BE. The face-off is a countdown on the
        // duel's clock, and the duel's clock is not projected — only the combat tick
        // is, and that one does not move until the fighters do. So the only signal a
        // client has for "how far into the standoff are we" is how long ago the first
        // face-off snapshot arrived. It drives the weapon draw and the camera's drift
        // in, both of them presentation, and nothing derived from it is read back.
        faceOffElapsedS:
          newest.phase === "FACE_OFF" && faceOffStartedAtMs !== null
            ? Math.max(0, (nowMs - faceOffStartedAtMs) / 1000)
            : 0,
        self,
        selfReadout: {
          side: newest.self.side,
          health: newest.self.health,
          ammo: newest.self.ammo,
          dashing: newest.self.dashing,
          dodgeReadyAtTick: newest.self.dodgeReadyAtTick,
          invulnerableUntilTick: newest.self.invulnerableUntilTick,
        },
        opponent,
        balls: ballsAt(interpolating ? previous : null, latest, alpha, gapS),
        cues,
      };
    },
  };
}
