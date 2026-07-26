// Client-side prediction, and it does not contain a simulation.
//
// THE ONE RULE THIS FILE EXISTS TO OBEY. There is exactly one movement,
// collision and projectile implementation in this repo and it is
// @pa/engine-world's, driven by @pa/duel's `stepCombat`. A second copy written
// "just for the network path" would pass every test on one laptop and drift on two,
// which is the precise bug the whole package is here to prevent. So the prediction
// below calls `stepCombat` — the real one, the same function the authoritative
// server calls, with the same arguments — and adds nothing of its own. Search this
// file for a position update and you will not find one.
//
// PREDICTION IS STATELESS, WHICH IS STRONGER THAN "RECONCILED".
//
// The usual shape is: keep a running predicted state, apply each new input to it,
// and when a server correction arrives, rewind and replay. That works, and it has
// a failure mode — the running state is a second accumulator, and an accumulator
// that is only occasionally corrected is an accumulator that can drift between
// corrections in ways nothing observes.
//
// Here there is no running predicted state at all. The predicted state is a pure
// function, recomputed from scratch every frame:
//
//     predicted = fold(stepCombat, confirmedServerBaseline, pendingInputs)
//
// A newer baseline is not a "correction" that has to be merged into anything; it is
// simply a better argument to the same function. There is no incremental client
// state, so there is nothing for incremental error to accumulate in. The cost is
// re-running up to a round trip's worth of ticks each frame — at 200 ms of RTT that
// is twelve steps of a two-body simulation, which is nothing.
//
// WHAT IS PREDICTED, AND WHAT IS NEVER PREDICTED.
//
//   predicted   the local body: position, velocity, stance, the dash window, the
//               fire cooldown and the local player's own balls leaving the barrel.
//               These are the things whose latency a player can feel.
//   never       health, hits, the opponent's body, the outcome. Those are the
//               server's and are rendered from the snapshot, because predicting a
//               hit means sometimes UN-predicting it, and a health bar that jumps
//               back up is worse than one that lags by a round trip.
//
// `PREDICTED_FIELDS` states that split as data, and a test asserts the reader obeys
// it, so "predict only what you own" is a checkable property rather than a habit.
//
// THE OPPONENT IS A PUPPET, AND IT HAS TO BE THERE.
//
// `stepCombat` takes both fighters, so a prediction needs something in the other
// slot. It gets the opponent's interpolated body — the same one being rendered —
// re-seated before every predicted tick. That is not a simulation of the opponent:
// nothing about the puppet is integrated, it is placed. It exists because the local
// body genuinely depends on it in one place, `resolveFiring`, which aims a shot at
// the height of the target's chest. Predicting a shot without the target's stance
// would put the local player's own tracer at the wrong height.

import {
  otherSide,
  stepCombat,
  IDLE_INTENT,
  type CollisionWorld,
  type CombatParams,
  type CombatState,
  type DuelSide,
  type FighterState,
  type Vec3,
} from "@pa/duel";
import { createGroundedState } from "../enginePort.js";
import { hashPredictable, type StateHash } from "../hash.js";
import { decodeFighter, type RecordedIntent, type WireFighterState } from "../protocol.js";

/**
 * Fields of the local fighter a client may render from its prediction. Everything
 * else on `FighterState` comes from the server snapshot.
 *
 * Health is absent on purpose and it is the most important absence: a predicted
 * health bar is a health bar that can go back up.
 */
export const PREDICTED_FIELDS = [
  "motion",
  "dodge",
  "fireReadyAtTick",
  "aimX",
  "aimZ",
  "shotsFired",
  "ammo",
] as const;

export const SERVER_ONLY_FIELDS = [
  "health",
  "hitsLanded",
  "hitsTaken",
  "abilities",
] as const;

/** The last thing the server said, and the tick it said it about. */
export interface Baseline {
  readonly tick: number;
  readonly round: number;
  readonly self: FighterState;
  /** Where the opponent was, as the server was willing to say. */
  readonly opponentPos: Vec3;
  readonly opponentCapsuleHeight: number;
  /** Highest local sequence the server had applied at `tick`. */
  readonly appliedSeq: number;
  readonly selfHash: StateHash;
}

export function baselineFrom(input: {
  readonly tick: number;
  readonly round: number;
  readonly self: WireFighterState;
  readonly opponentPos: Vec3;
  readonly opponentCapsuleHeight: number;
  readonly appliedSeq: number;
  readonly selfHash: StateHash;
}): Baseline {
  return {
    tick: input.tick,
    round: input.round,
    self: decodeFighter(input.self),
    opponentPos: { ...input.opponentPos },
    opponentCapsuleHeight: input.opponentCapsuleHeight,
    appliedSeq: input.appliedSeq,
    selfHash: input.selfHash,
  };
}

export interface PredictionContext {
  readonly world: CollisionWorld;
  readonly side: DuelSide;
  /**
   * The same `CombatParams` the authority holds. Passed in rather than derived,
   * because it carries resolved ability implementations, which are functions and
   * cannot cross a wire. The app resolves them from @pa/abilities on both sides
   * from the same ability ids.
   */
  readonly params: CombatParams;
}

export interface PredictionResult {
  /** The predicted local body. Read only `PREDICTED_FIELDS` off this. */
  readonly self: FighterState;
  /** Balls the local player has fired that the server has not confirmed yet. */
  readonly localProjectiles: CombatState["projectiles"];
  readonly tick: number;
  readonly stepsReplayed: number;
  /**
   * The digest of the PREDICTABLE subset, which is the only digest a prediction may
   * be compared on.
   *
   * Emphatically not `hashSelf`. The full digest covers health, hits taken and the
   * ability ledger, none of which a prediction computes — so comparing it against the
   * server's full digest would report a divergence on literally every snapshot, and
   * a detector that always fires is a detector that gets switched off.
   */
  readonly predictableHash: StateHash;
}

/**
 * Seat a body at a position without integrating it.
 *
 * Uses engine-world's own `createGroundedState` — reached through @pa/duel, like
 * everything else here — rather than assembling a MotionState literal, so the
 * puppet is built by the same constructor the simulation uses and cannot end up
 * with a field the integrator expects and this file forgot.
 */
function puppet(side: DuelSide, pos: Vec3, capsuleHeight: number, yaw: number): FighterState {
  const motion = createGroundedState(pos, yaw);
  return {
    side,
    motion: { ...motion, capsuleHeight },
    health: 1,
    ammo: 0,
    dodge: { iframeUntilTick: 0, readyAtTick: 0 },
    fireReadyAtTick: 0,
    abilities: {},
    shotsFired: 0,
    hitsLanded: 0,
    hitsTaken: 0,
    aimX: 0,
    aimZ: 1,
  };
}

/** Where the opponent should be seated for a given predicted tick. */
export type OpponentSeat = (tick: number) => {
  readonly pos: Vec3;
  readonly capsuleHeight: number;
};

/**
 * Recompute the predicted local body from the confirmed baseline and every local
 * input the server has not yet applied.
 *
 * Pure. Same arguments, same answer, every time — which is what makes the
 * prediction path itself replayable, and therefore testable against the server's
 * own history rather than merely against itself.
 */
export function predict(
  context: PredictionContext,
  baseline: Baseline,
  pending: readonly RecordedIntent[],
  seatOpponent: OpponentSeat,
): PredictionResult {
  const opponentSide = otherSide(context.side);
  const unapplied = pending.filter((entry) => entry.seq > baseline.appliedSeq);

  let state: CombatState = {
    tick: baseline.tick,
    fighters:
      context.side === "A"
        ? {
            A: baseline.self,
            B: puppet(
              "B",
              baseline.opponentPos,
              baseline.opponentCapsuleHeight,
              baseline.self.motion.yaw,
            ),
          }
        : {
            A: puppet(
              "A",
              baseline.opponentPos,
              baseline.opponentCapsuleHeight,
              baseline.self.motion.yaw,
            ),
            B: baseline.self,
          },
    // Deliberately empty. Server balls are rendered from the snapshot; predicting
    // them here would let a predicted hit apply predicted damage, and damage is
    // never predicted.
    projectiles: [],
    nextProjectileId: 1,
  };

  // The puppet's will. @pa/duel's own IDLE rather than a literal, so a field added
  // to `CombatIntent` upstream cannot be silently missing on the prediction path.
  const idle = IDLE_INTENT;
  for (const entry of unapplied) {
    const seat = seatOpponent(state.tick + 1);
    const seated = puppet(
      opponentSide,
      seat.pos,
      seat.capsuleHeight,
      state.fighters[opponentSide].motion.yaw,
    );
    state = {
      ...state,
      fighters:
        opponentSide === "A"
          ? { A: seated, B: state.fighters.B }
          : { A: state.fighters.A, B: seated },
    };
    const stepped = stepCombat(
      context.world,
      state,
      context.side === "A"
        ? { A: entry.intent, B: idle }
        : { A: idle, B: entry.intent },
      context.params,
      baseline.round,
    );
    state = stepped.state;
  }

  const self = state.fighters[context.side];
  return {
    self,
    localProjectiles: state.projectiles.filter(
      (projectile) => projectile.shooter === context.side,
    ),
    tick: state.tick,
    stepsReplayed: unapplied.length,
    predictableHash: hashPredictable(self),
  };
}

/**
 * Render-space error smoothing.
 *
 * When a newer baseline moves the predicted body, snapping is correct but looks
 * like a stutter. The fix is presentational and stays presentational: keep the
 * VISUAL offset between where the body was drawn and where it is now, and decay it
 * over a few frames. The simulation is never told about this — the offset is added
 * at draw time and never fed back — because an offset that re-entered the
 * prediction would be a second position accumulator, which is the thing this file
 * refuses to have.
 */
export interface SmoothedOffset {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const ZERO_OFFSET: SmoothedOffset = { x: 0, y: 0, z: 0 };

/** Beyond this the correction is too large to hide, so it is shown honestly. */
export const MAX_SMOOTHED_ERROR_M = 1.5;
/** Fraction of the remaining offset retired per rendered frame. */
export const OFFSET_DECAY_PER_FRAME = 0.25;

export function absorbCorrection(
  previous: SmoothedOffset,
  drawnAt: Vec3,
  correctedTo: Vec3,
): SmoothedOffset {
  const x = previous.x + (drawnAt.x - correctedTo.x);
  const y = previous.y + (drawnAt.y - correctedTo.y);
  const z = previous.z + (drawnAt.z - correctedTo.z);
  const magnitude = Math.hypot(x, y, z);
  if (magnitude > MAX_SMOOTHED_ERROR_M) return ZERO_OFFSET;
  return { x, y, z };
}

export function decayOffset(
  offset: SmoothedOffset,
  factor = OFFSET_DECAY_PER_FRAME,
): SmoothedOffset {
  const keep = 1 - factor;
  const next = { x: offset.x * keep, y: offset.y * keep, z: offset.z * keep };
  return Math.hypot(next.x, next.y, next.z) < 1e-4 ? ZERO_OFFSET : next;
}
