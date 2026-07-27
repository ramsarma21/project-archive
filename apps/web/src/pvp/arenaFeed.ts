// From authoritative snapshots to something drawable, and NOTHING ELSE.
//
// This is the whole of PvP's presentation logic and it is deliberately the only file
// in the arena that holds any state at all. What it does is interpolate: it keeps a
// small tick-sorted BUFFER of recent snapshots and reports where things were at one
// monotonic presentation tick held an adaptive delay BEHIND the newest arrival, so a
// lost or late poll is bridged by two snapshots that straddle the instant rather than
// by a freeze or a jump. What it does not do, anywhere, is decide, and it never
// extrapolates: the presentation tick is clamped to the span the buffer covers.
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

import {
  BULLETS_FOR_CORRECT,
  DUEL_ROUND_CEILING,
  FIELD_TICK_HZ,
  type DuelPhase,
  type DuelSide,
} from "@pa/duel";
import { isCrouched } from "@pa/engine-world";
import { lerpAngle, lerpPose, normaliseAngle, type ActorPose } from "../duel/duelRuntime.js";
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
      /** Snapshot-backed, never inferred; frozen with the pose once out of sight. */
      readonly dashing: boolean;
    }
  | {
      readonly kind: "LAST_SEEN";
      readonly pose: ActorPose;
      readonly health: number;
      readonly ammo: number;
      readonly answering: boolean;
      readonly dashing: boolean;
      /** Seconds since the server could last see them. */
      readonly ageS: number;
    }
  | {
      readonly kind: "UNPLACED";
      readonly health: number;
      readonly ammo: number;
      readonly answering: boolean;
      readonly dashing: boolean;
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
  /**
   * The authoritative post-answer countdown in whole seconds, or null. Read as
   * DISCRETE state from the snapshot at or before the instant — never interpolated,
   * because interpolation between two seconds could show a fractional or rising
   * value — and clamped monotone non-increasing across buffered arrivals, so an
   * out-of-order same-tick replacement can never make it count back up. Null outside
   * BULLETS_GRANTED, so the overlay disappears the instant the fight resumes.
   */
  readonly resumeCountdownSeconds: number | null;
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
  /** Diagnostics and tests: the buffered authoritative ticks, ascending. */
  bufferedTicks(): readonly number[];
  /** Diagnostics and tests: the current adaptive render delay, in milliseconds. */
  renderDelayMs(): number;
  /** Diagnostics and tests: the sizes of the fire and hit cue journals. */
  cueJournalSizes(): { readonly fire: number; readonly hit: number };
}

/**
 * Live polling (90ms) versus question polling (700ms) — the two cadences the arrival
 * window must never mix. The combat tick freezes while a question is open, so those
 * slow polls carry a repeated tick; folding their gaps into the jitter estimate would
 * inflate the LIVE render delay to most of a second the moment the fight resumes.
 */
function isLiveCadence(phase: DuelPhase): boolean {
  return phase !== "QUESTION_PENDING" && phase !== "VERDICT_COMMITTED";
}

/**
 * How many snapshots the buffer holds, tick-sorted.
 *
 * The target depth is 8–12: enough to bracket the presentation instant across a lost
 * poll or two and still have something to interpolate between, capped so a long duel
 * does not accumulate. The buffer fills toward this ceiling and trims its oldest tick
 * once full.
 */
const BUFFER_MAX = 12;

/**
 * The HARD ceiling on stored snapshots, honoured even during a stall the clock cannot
 * climb out of. When the active lower anchor is itself the oldest entry — a backgrounded
 * tab, a burst of ten thousand arrivals while the clock is stuck — the buffer keeps the
 * anchor plus the newest entries and compacts the middle away, which the current bracket
 * does not need, so total storage is `anchor + newest <= BUFFER_HARD_CAP` and never grows
 * without bound.
 */
const BUFFER_HARD_CAP = 13;

/**
 * The cue journals NEVER evict an unpresented event. Their capacity is therefore not an
 * arbitrary number but the maximum number of distinct events the AUTHORITY can legally
 * produce over an entire match, derived from @pa/duel's own tuning:
 *
 *   FIRE — one projectile per bullet; both sides are granted at most `BULLETS_FOR_CORRECT`
 *          bullets per round across the `DUEL_ROUND_CEILING` rounds, so no more than this
 *          many distinct balls (and thus fire cues) can ever exist in a match.
 *   HIT  — a hit is a health drop, and every health drop is caused by AT MOST ONE
 *          projectile striking, so there can be no more hits than there are projectiles.
 *          The ceiling is therefore the SAME unique-projectile bound as FIRE — NOT
 *          `health / base-damage`, because damage reduction or any other legal modifier
 *          lowers the damage per hit and so lets a pool absorb MORE hits, which would
 *          overrun a health-arithmetic ceiling. Bounding by projectiles cannot be exceeded.
 *
 * Pending (unpresented) cues are bounded by these because every pending cue is a distinct
 * legal event still ahead of the presentation clock, and presented cues within the flash
 * window are a disjoint subset — so the live journal size can never exceed the ceiling.
 */
export const FIRE_CUE_CEILING = BULLETS_FOR_CORRECT * DUEL_ROUND_CEILING * 2;
export const HIT_CUE_CEILING = FIRE_CUE_CEILING;

/**
 * How long a PRESENTED cue is retained behind the clock before it may be evicted, in
 * ticks. It must outlast the longest cue flash so a live flash is never cut: the muzzle
 * flash lasts 0.1s and the hit flash 0.34s (see ArenaGunplay), and half a second clears
 * both with margin. A presented cue older than this has finished flashing and — because a
 * ball id never recurs and a tick behind the clock can never be re-observed (stale
 * arrivals are rejected) — can never re-emit, so evicting it is safe. Unpresented cues and
 * cues still inside this window are NEVER evicted.
 */
const CUE_RETENTION_TICKS = Math.ceil(0.5 * FIELD_TICK_HZ);

/**
 * The render delay, clamped. Presentation runs this far BEHIND the newest arrival so
 * there is always a pair of snapshots to interpolate between; the actual delay tracks
 * the arrival jitter (see `adaptiveDelayMs`). Never below 100ms — that is one live poll
 * plus a frame — and never above 750ms, past which the fight is too far in the past to
 * steer against.
 */
const RENDER_DELAY_MIN_MS = 100;
const RENDER_DELAY_MAX_MS = 750;

/** How many inter-arrival gaps to keep for the jitter estimate. */
const GAP_SAMPLES = 24;

/**
 * How the presentation clock closes a standing delay error, per frame.
 *
 * The base advance is REAL TIME — one tick per 60Hz frame — so motion is smooth and
 * does not chase the staircase that the delayed head makes as snapshots arrive. On top
 * of that a small fraction of the remaining error is closed each frame (`CORRECTION_GAIN`),
 * capped (`MAX_CORRECTION_TICKS`) so no single frame lurches. Behind the target the
 * correction speeds the clock up a little; ahead of it — the delay just grew, or an
 * underrun pushed the clock toward the head — the correction slows it, never reversing
 * it. The per-frame on-screen step is therefore at most one tick plus this cap.
 */
const CORRECTION_GAIN = 0.1;
const MAX_CORRECTION_TICKS = 0.5;

/**
 * The most the presentation tick may advance in a single frame, whatever the wall gap
 * since the last one. A backgrounded tab returns with a multi-second dt; without this
 * the first frame back would jump the whole real-time distance. With it the advance is
 * spread over frames and the on-screen step stays bounded.
 */
const MAX_ADVANCE_TICKS = 4;

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
 * The opponent's pose at one snapshot — SNAPSHOT-BACKED, NEVER INFERRED.
 *
 * Facing is the projected aim yaw and speed is the magnitude of the projected
 * velocity, both gated on the server's line of sight and frozen with the position
 * when it breaks. The old version guessed both — facing from the direction of travel
 * or a default turn-to-opponent, speed from the step between two snapshots — which
 * showed a facing and a heading the server never sanctioned. The projection now
 * carries them, so the client reads rather than invents.
 */
function opponentPose(snapshot: MatchSnapshot): ActorPose {
  const now = snapshot.opponent;
  return {
    x: now.position.x,
    y: now.position.y,
    z: now.position.z,
    yaw: now.aimYaw,
    capsuleHeight: now.capsuleHeight,
    crouched: isCrouched(now.capsuleHeight),
    speedMps: Math.hypot(now.velocity.x, now.velocity.z),
    travelOffFacing: 0,
  };
}

/** The two buffered snapshots the presentation instant sits between, and where. */
interface Bracket {
  /** The snapshot AT OR BEFORE the presentation tick. Every discrete state reads here. */
  readonly older: Observed;
  /** The snapshot at or after it. Equal to `older` when presentation holds at an end. */
  readonly newer: Observed;
  /** 0 at `older`, 1 at `newer`; 0 when the two are the same tick. */
  readonly alpha: number;
}

/**
 * Locate the presentation tick within a tick-sorted, non-empty buffer.
 *
 * At or before the oldest tick, or at or after the newest, both ends are that one
 * snapshot and alpha is 0 — the hold. In between, the pair straddling the tick, with
 * alpha the fractional position across their tick span. The buffer is small, so a
 * linear scan is both simplest and fastest.
 */
function bracketAt(buffer: readonly Observed[], tick: number): Bracket {
  const first = buffer[0]!;
  const last = buffer[buffer.length - 1]!;
  if (tick <= first.snapshot.tick) return { older: first, newer: first, alpha: 0 };
  if (tick >= last.snapshot.tick) return { older: last, newer: last, alpha: 0 };
  for (let i = 0; i < buffer.length - 1; i += 1) {
    const older = buffer[i]!;
    const newer = buffer[i + 1]!;
    if (older.snapshot.tick <= tick && tick < newer.snapshot.tick) {
      const span = newer.snapshot.tick - older.snapshot.tick;
      const alpha = span > 0 ? (tick - older.snapshot.tick) / span : 0;
      return { older, newer, alpha };
    }
  }
  return { older: last, newer: last, alpha: 0 };
}

/**
 * The balls to draw at the presentation instant.
 *
 * A ball in BOTH ends of the bracket is interpolated along the segment the server
 * reported. A ball in the NEWER end alone has not spawned yet at this instant, and is
 * not drawn — reconstructing it backwards down its line would draw a ball the
 * presentation tick has not reached (no pre-spawn).
 *
 * A ball in the OLDER end alone has been removed by the upper tick, and this is the
 * REMOVAL-TIMING rule: it is NOT dropped at the midpoint of the interval. It is HELD at
 * its last authoritative position — the one the older end reported — for the whole
 * bracket, and it disappears only once the presentation instant reaches the upper tick
 * (when this bracket ends and the ball is no longer in the lower end). Holding a
 * reported position is not extrapolation; advancing it by its velocity would be, and
 * that is exactly what is refused. So a ball reaches the place the server last put it
 * and then vanishes at the tick the server actually retired it, never earlier.
 */
function drawnBalls(bracket: Bracket): readonly DrawnBall[] {
  const { older, newer, alpha } = bracket;
  const selfSide = older.snapshot.self.side;
  const actorOf = (shooter: DuelSide): ArenaActor =>
    shooter === selfSide ? "SELF" : "OPPONENT";
  const laterById = new Map<number, ProjectileView>();
  for (const ball of newer.snapshot.projectiles) laterById.set(ball.id, ball);

  const out: DrawnBall[] = [];
  for (const ball of older.snapshot.projectiles) {
    const later = laterById.get(ball.id);
    out.push(
      later
        ? {
            id: ball.id,
            x: ball.x + (later.x - ball.x) * alpha,
            y: ball.y + (later.y - ball.y) * alpha,
            z: ball.z + (later.z - ball.z) * alpha,
            vx: later.vx,
            vz: later.vz,
            shooter: actorOf(ball.shooter),
            fade: 1,
          }
        : {
            // Removed by the upper tick: held at the last reported position until the
            // instant reaches that tick. No velocity applied — no invented motion.
            id: ball.id,
            x: ball.x,
            y: ball.y,
            z: ball.z,
            vx: ball.vx,
            vz: ball.vz,
            shooter: actorOf(ball.shooter),
            fade: 1,
          },
    );
  }
  return out;
}

export function createSnapshotFeed(): SnapshotFeed {
  // The buffer, always sorted ascending by authoritative tick and tick-unique.
  const buffer: Observed[] = [];
  // Recent inter-arrival gaps in ms, for the adaptive delay's jitter estimate. Only
  // genuine in-order LIVE advances are recorded here (see `observe`).
  const gaps: number[] = [];
  let lastArrivalMs: number | null = null;
  // Whether the previous accepted arrival was live-cadence, so a change (question <->
  // live) can reset the arrival window before its stale cadence inflates the delay.
  let lastCadenceLive: boolean | null = null;
  let lastSampleMs: number | null = null;
  // The one monotonic presentation clock, in fractional ticks. Null until first sample,
  // then only ever moves forward and only ever within the buffer's span.
  let presentationTick: number | null = null;
  let faceOffStartedAtMs: number | null = null;
  // The last resume-countdown second actually presented, held so a buffered or
  // reordered same-tick replacement carrying a stale (higher) value can never make
  // the shown number climb. Reset to null the moment presentation leaves
  // BULLETS_GRANTED, so the next round's countdown starts fresh at 3.
  let lastResumeCountdown: number | null = null;

  // The cue journal, PERSISTENT and keyed by stable identity — a fire by its ball id, a
  // hit by the actor and the authoritative tick its health fell. Cues are journalled at
  // OBSERVATION time from two comparisons: a new tick against its buffered predecessor,
  // and — critically, with NO adjacent tick required — a same-tick REPLACEMENT against
  // the revision it replaces. The keys keep each cue to exactly one emission however many
  // times a tick is retransmitted; the presentation reads the latest journalled cue at or
  // before the instant. Entries behind the retained buffer are pruned to bound memory.
  const fireJournal = new Map<
    number,
    { readonly tick: number; readonly origin: readonly [number, number, number]; readonly actor: ArenaActor }
  >();
  const hitJournal = new Map<string, { readonly tick: number; readonly actor: ArenaActor }>();

  // The render delay tracks the network it is smoothing over: the worst recent gap and
  // the statistical spread, plus a frame of slack, so a bracket almost always exists.
  // Clamped to the honest band — a floor of one poll, a ceiling past which the fight is
  // too stale to steer against.
  const adaptiveDelayMs = (): number => {
    if (gaps.length === 0) return RENDER_DELAY_MIN_MS;
    let sum = 0;
    let max = 0;
    for (const gap of gaps) {
      sum += gap;
      if (gap > max) max = gap;
    }
    const mean = sum / gaps.length;
    let variance = 0;
    for (const gap of gaps) variance += (gap - mean) ** 2;
    const std = Math.sqrt(variance / gaps.length);
    const want = Math.max(max, mean + 3 * std) + 1000 / FIELD_TICK_HZ;
    return Math.min(RENDER_DELAY_MAX_MS, Math.max(RENDER_DELAY_MIN_MS, want));
  };

  const journalFire = (ball: ProjectileView, tick: number, selfSide: DuelSide): void => {
    const actor: ArenaActor = ball.shooter === selfSide ? "SELF" : "OPPONENT";
    const existing = fireJournal.get(ball.id);
    // The earliest observed tick wins, so an out-of-order fill that reveals the shot
    // sooner reconciles the cue backwards rather than duplicating it.
    if (!existing || tick < existing.tick) {
      fireJournal.set(ball.id, { tick, origin: [ball.x, ball.y, ball.z] as const, actor });
    }
  };

  const journalHit = (actor: ArenaActor, tick: number): void => {
    const key = `${actor}:${tick}`;
    if (!hitJournal.has(key)) hitJournal.set(key, { tick, actor });
  };

  // Journal the cues a transition from `from` to `to` INTRODUCES. `from` is the baseline:
  // the buffered predecessor of a new tick, or the previous revision of a replaced one.
  // With no baseline (the oldest tick, a first-ever arrival) nothing is journalled — those
  // balls predate the window and were not observed to spawn, and there is no earlier
  // health for one to have fallen from.
  const journalDelta = (from: MatchSnapshot | null, to: MatchSnapshot): void => {
    if (!from) return;
    const priorIds = new Set(from.projectiles.map((ball) => ball.id));
    for (const ball of to.projectiles) {
      if (!priorIds.has(ball.id)) journalFire(ball, to.tick, to.self.side);
    }
    if (to.self.health < from.self.health) journalHit("SELF", to.tick);
    if (to.opponent.health < from.opponent.health) journalHit("OPPONENT", to.tick);
  };

  // Prune the journals WITHOUT EVER EVICTING AN UNPRESENTED EVENT. Only a cue whose tick
  // the clock has already presented, AND has moved past by more than the flash/dedupe
  // retention, may go — its flash is finished and it can never re-emit. Every pending cue
  // and every cue still within the flash window is kept, so no cue is ever lost before it
  // is shown. Memory stays bounded because the surviving set — pending events plus the few
  // in the retention window — is a subset of a match's legal events (see the ceilings).
  const pruneJournal = (): void => {
    if (presentationTick === null) return;
    const floor = presentationTick - CUE_RETENTION_TICKS;
    for (const [id, cue] of fireJournal) if (cue.tick < floor) fireJournal.delete(id);
    for (const [key, cue] of hitJournal) if (cue.tick < floor) hitJournal.delete(key);
  };

  // The cues at the presentation instant: the latest journalled fire and hit per actor at
  // or before the tick. Read fresh each sample, so a cue fires exactly when the clock
  // crosses its tick and holds after — never twice.
  const cuesAt = (tick: number): Record<ArenaActor, ArenaCues> => {
    let self = NO_CUES;
    let opponent = NO_CUES;
    let selfFire = Number.NEGATIVE_INFINITY;
    let oppFire = Number.NEGATIVE_INFINITY;
    for (const cue of fireJournal.values()) {
      if (cue.tick > tick) continue;
      if (cue.actor === "SELF") {
        if (cue.tick > selfFire) {
          selfFire = cue.tick;
          self = { ...self, lastFireTick: cue.tick, lastFireOrigin: cue.origin };
        }
      } else if (cue.tick > oppFire) {
        oppFire = cue.tick;
        opponent = { ...opponent, lastFireTick: cue.tick, lastFireOrigin: cue.origin };
      }
    }
    let selfHit = Number.NEGATIVE_INFINITY;
    let oppHit = Number.NEGATIVE_INFINITY;
    for (const cue of hitJournal.values()) {
      if (cue.tick > tick) continue;
      if (cue.actor === "SELF") selfHit = Math.max(selfHit, cue.tick);
      else oppHit = Math.max(oppHit, cue.tick);
    }
    if (selfHit > Number.NEGATIVE_INFINITY) self = { ...self, lastHitTick: selfHit };
    if (oppHit > Number.NEGATIVE_INFINITY) opponent = { ...opponent, lastHitTick: oppHit };
    return { SELF: self, OPPONENT: opponent };
  };

  // Trim the buffer, HARD-BOUNDED, without ever discarding the ACTIVE LOWER ANCHOR — the
  // older end the presentation instant is interpolating from right now. Shedding it would
  // snap the clock forward to the new oldest tick, the resume jump this guards against.
  //
  // Normally the tail older than the anchor is shed to the soft cap. But when the anchor
  // is itself the oldest entry — the clock is stalled far behind and cannot free the tail
  // — the buffer must still not grow past the HARD cap: keep the anchor and everything at
  // or below it, plus the newest entries, and compact the MIDDLE away, which the current
  // bracket does not need. Total retained is then `headCount + tailCount = BUFFER_HARD_CAP`.
  const trimBuffer = (): void => {
    if (buffer.length <= BUFFER_MAX) return;
    let anchor = 0;
    if (presentationTick !== null) {
      for (let i = 0; i < buffer.length; i += 1) {
        if (buffer[i]!.snapshot.tick <= presentationTick) anchor = i;
        else break;
      }
    }
    while (buffer.length > BUFFER_MAX && anchor > 0) {
      buffer.shift();
      anchor -= 1;
    }
    if (buffer.length > BUFFER_HARD_CAP) {
      const headCount = anchor + 1; // the anchor and anything at or below it
      const tailCount = BUFFER_HARD_CAP - headCount; // the newest entries kept
      if (tailCount >= 1 && buffer.length - tailCount > headCount) {
        const kept = [
          ...buffer.slice(0, headCount),
          ...buffer.slice(buffer.length - tailCount),
        ];
        buffer.length = 0;
        buffer.push(...kept);
      }
    }
  };

  return {
    bufferedTicks(): readonly number[] {
      return buffer.map((entry) => entry.snapshot.tick);
    },
    renderDelayMs(): number {
      return adaptiveDelayMs();
    },
    cueJournalSizes(): { readonly fire: number; readonly hit: number } {
      return { fire: fireJournal.size, hit: hitJournal.size };
    },

    observe(snapshot: MatchSnapshot, atMs: number): void {
      const tick = snapshot.tick;
      // STALE: behind the presentation instant. Rejected before it can touch the buffer,
      // the cues OR the jitter estimate — it is neither a bracket the clock can use nor a
      // cadence sample worth keeping.
      if (presentationTick !== null && tick < presentationTick) return;

      if (snapshot.phase === "FACE_OFF" && faceOffStartedAtMs === null) {
        faceOffStartedAtMs = atMs;
      }

      const live = isLiveCadence(snapshot.phase);
      const cadenceChanged = lastCadenceLive !== null && lastCadenceLive !== live;

      // DUPLICATE TICK: a replacement carrying fresher discrete state for a tick already
      // held — the frozen combat tick of a face-off or an open question. Reconcile the
      // cue journal so a fire/hit the retransmission reveals is emitted, but record NO
      // gap: the combat tick did not advance, so this is poll cadence, not the inter-tick
      // cadence the delay tracks.
      const existing = buffer.findIndex((entry) => entry.snapshot.tick === tick);
      if (existing >= 0) {
        const previousRevision = buffer[existing]!.snapshot;
        // SAME-TICK CADENCE TRANSITION. A duplicate can itself be the question->live (or
        // live->question) hand-off: the resume carries the frozen tick again, now with a
        // live phase. Reset the arrival window HERE, before any later measurement, so the
        // next real advance is not gapped against a pre-question arrival — the 750ms
        // inflation this guards against.
        if (cadenceChanged) {
          gaps.length = 0;
          lastArrivalMs = live ? atMs : null;
        }
        buffer[existing] = { snapshot, atMs };
        // SAME-TICK REPLACEMENT CUE. Diff the new revision against the one it replaces, so
        // a fire or hit a fuller retransmission reveals is journalled EVEN WITH NO adjacent
        // tick to compare against.
        journalDelta(previousRevision, snapshot);
        pruneJournal();
        lastCadenceLive = live;
        return;
      }

      // Is this the new head (an in-order advance) or a late out-of-order fill?
      const advancingHead =
        buffer.length === 0 || tick > buffer[buffer.length - 1]!.snapshot.tick;

      // Insert keeping the buffer sorted: arrivals can be out of order under jitter, and
      // the interpolation reads ticks, not arrival order.
      let at = buffer.length;
      while (at > 0 && buffer[at - 1]!.snapshot.tick > tick) at -= 1;
      buffer.splice(at, 0, { snapshot, atMs });
      // Journal the cues this insertion introduces: against the buffered predecessor, and
      // — for an out-of-order fill — re-affirm the successor against this new predecessor.
      journalDelta(at > 0 ? buffer[at - 1]!.snapshot : null, snapshot);
      if (at + 1 < buffer.length) journalDelta(snapshot, buffer[at + 1]!.snapshot);
      trimBuffer();
      pruneJournal();

      // JITTER, MEASURED HONESTLY. A gap is recorded only for an IN-ORDER LIVE advance:
      // a stale or duplicate arrival never reaches here, an out-of-order fill is not the
      // head, and the window is reset across a cadence change so 700ms question polling
      // never leaks into the live delay.
      if (cadenceChanged || !live) {
        gaps.length = 0;
        lastArrivalMs = live ? atMs : null;
      } else if (advancingHead && lastArrivalMs !== null) {
        gaps.push(atMs - lastArrivalMs);
        if (gaps.length > GAP_SAMPLES) gaps.shift();
        lastArrivalMs = atMs;
      } else if (advancingHead) {
        lastArrivalMs = atMs;
      }
      lastCadenceLive = live;
    },

    sample(nowMs: number): ArenaSample | null {
      if (buffer.length === 0) return null;
      const dtMs = lastSampleMs === null ? 0 : Math.max(0, nowMs - lastSampleMs);
      lastSampleMs = nowMs;

      const headTick = buffer[buffer.length - 1]!.snapshot.tick;
      const oldestTick = buffer[0]!.snapshot.tick;

      // The target is the delayed head, clamped into what the buffer can actually cover.
      const delayTicks = (adaptiveDelayMs() * FIELD_TICK_HZ) / 1000;
      const target = Math.min(headTick, Math.max(oldestTick, headTick - delayTicks));

      if (presentationTick === null) {
        // Start behind, at the target, so there is no opening jump from the head.
        presentationTick = target;
      } else {
        // REAL TIME plus a bounded correction toward the delay target, FORWARD ONLY.
        // The base is one tick per 60Hz frame, so motion glides rather than chasing the
        // staircase the delayed head makes; the correction closes a standing delay error
        // gently, capped so no frame lurches; the ceiling stops a long-backgrounded frame
        // from advancing the whole real-time gap at once. Never negative, so the clock
        // holds on an underrun and never runs backward.
        const dtTicks = (dtMs * FIELD_TICK_HZ) / 1000;
        const error = target - (presentationTick + dtTicks);
        const correction = Math.max(
          -MAX_CORRECTION_TICKS,
          Math.min(MAX_CORRECTION_TICKS, error * CORRECTION_GAIN),
        );
        const advance = Math.min(MAX_ADVANCE_TICKS, dtTicks + correction);
        presentationTick += Math.max(0, advance);
      }
      // Clamp the clock ITSELF into the buffer's span, not just a copy. Left to run past
      // the head during an underrun it would silently accumulate a huge lead, and the
      // next arrival would then read as a whole-poll teleport as the clamp released. Held
      // at the head instead, the delay is preserved and the catch-up stays per-frame
      // bounded. Never below the oldest, never past the newest: every drawn position is a
      // real snapshot or a point on the straight line between two of them.
      presentationTick = Math.min(headTick, Math.max(oldestTick, presentationTick));
      const tick = presentationTick;

      const bracket = bracketAt(buffer, tick);
      // DISCRETE STATE READS THE SNAPSHOT AT OR BEFORE THE INSTANT — the older end of
      // the bracket. Phase, health, ammo, dash, visibility and the sighting kind all
      // switch as presentation crosses into the tick that changed them, never before.
      const at = bracket.older.snapshot;
      const next = bracket.newer.snapshot;
      const alpha = bracket.alpha;

      // DISCRETE, and clamped monotone non-increasing. Outside BULLETS_GRANTED it is
      // null and the memory resets, so each round's countdown begins at 3 again;
      // inside it, a value that arrived higher than one already shown (a reordered
      // same-tick replacement) is held down rather than allowed to count up.
      let resumeCountdownSeconds: number | null = at.resumeCountdownSeconds ?? null;
      if (resumeCountdownSeconds === null) {
        lastResumeCountdown = null;
      } else {
        if (lastResumeCountdown !== null) {
          resumeCountdownSeconds = Math.min(resumeCountdownSeconds, lastResumeCountdown);
        }
        lastResumeCountdown = resumeCountdownSeconds;
      }

      const self = lerpPose(selfPose(at), selfPose(next), alpha);

      const opp = at.opponent;
      const opponentCommon = {
        health: opp.health,
        ammo: opp.ammo,
        answering: opp.answering,
        // Snapshot-backed: live while in sight, frozen with the pose when not.
        dashing: opp.dashing,
      };
      let opponent: OpponentSighting;
      // The absence is checked BEFORE a pose is built: `opponentPose` reads coordinates,
      // and a projection that carries none must produce no body rather than one at the
      // origin or a NaN transform three.js will silently keep.
      if (!placed(opp.position)) {
        opponent = { kind: "UNPLACED", ...opponentCommon };
      } else if (opp.visible) {
        const base = opponentPose(at);
        // THE POSITION IS INTERPOLATED, and only while BOTH ends of the bracket were in
        // sight: sliding from a remembered position to a fresh one would draw a walk the
        // server never reported, along a path that very likely goes through the cover
        // that broke the sight line. Facing and speed are the older end's alone — the
        // discrete rule — so neither ramps across the interval.
        const later = next.opponent;
        const bracketed =
          next !== at && later.visible && placed(later.position);
        opponent = {
          kind: "IN_SIGHT",
          pose: bracketed
            ? {
                ...base,
                x: base.x + (later.position.x - base.x) * alpha,
                y: base.y + (later.position.y - base.y) * alpha,
                z: base.z + (later.position.z - base.z) * alpha,
                // Facing is interpolated along the SHORTEST arc between the two
                // bracketing authoritative aim yaws, the same as position — both ends
                // are ones the server reported, so this is smoothing, not invention. A
                // discrete per-tick yaw snapped ~20 times a second as the presentation
                // clock crossed each tick, which read as the opponent's body twitching
                // even while it slid smoothly; only interpolated when BOTH ends are in
                // sight (the `bracketed` gate), so a remembered facing never ramps.
                yaw: lerpAngle(base.yaw, later.aimYaw, alpha),
              }
            : base,
          ...opponentCommon,
        };
      } else {
        opponent = {
          kind: "LAST_SEEN",
          pose: opponentPose(at),
          ageS: Math.max(0, (at.tick - opp.positionAtTick) / FIELD_TICK_HZ),
          ...opponentCommon,
        };
      }

      return {
        matchId: at.matchId,
        tick,
        phase: at.phase,
        round: at.round,
        // MEASURED IN WALL TIME, AND IT HAS TO BE. The face-off is a countdown on the
        // duel's clock, which is not projected — only the combat tick is, and that one
        // does not move until the fighters do. So the only signal for "how far into the
        // standoff are we" is how long ago the first face-off snapshot arrived. It
        // drives the weapon draw and the camera drift, both presentation, and nothing
        // derived from it is read back.
        faceOffElapsedS:
          at.phase === "FACE_OFF" && faceOffStartedAtMs !== null
            ? Math.max(0, (nowMs - faceOffStartedAtMs) / 1000)
            : 0,
        self,
        selfReadout: {
          side: at.self.side,
          health: at.self.health,
          ammo: at.self.ammo,
          dashing: at.self.dashing,
          dodgeReadyAtTick: at.self.dodgeReadyAtTick,
          invulnerableUntilTick: at.self.invulnerableUntilTick,
        },
        opponent,
        balls: drawnBalls(bracket),
        cues: cuesAt(tick),
        resumeCountdownSeconds,
      };
    },
  };
}
