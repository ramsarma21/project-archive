// Rendering the opponent, which is an entirely different problem from predicting
// yourself.
//
// You cannot predict an opponent, because you do not have their inputs and by
// design you never will. What you have is a sequence of positions the server has
// vouched for, arriving at 20 Hz over a link that reorders and drops them. So the
// opponent is rendered in the PAST — far enough back that the next snapshot has
// almost always arrived before it is needed — and moved smoothly between the two
// snapshots that bracket the render time.
//
// THE DELAY IS THE WHOLE DESIGN DECISION AND IT IS A TRADE.
//
// Too small and the buffer runs dry on a jittery link, the opponent freezes and
// then teleports, and a duel becomes unreadable exactly when the network is worst —
// which for a school is most of the time. Too large and you are shooting at where
// someone used to be, which on a ranked ladder is unfair in a way players can feel
// but not name.
//
// It is therefore ADAPTIVE, derived from the jitter actually observed on this link
// rather than from a constant somebody picked: one snapshot interval to bridge the
// normal gap between packets, plus a jitter allowance, clamped. On a quiet link it
// settles near the floor and the opponent is ~50 ms behind. On a bad one it grows
// and the opponent is smooth but further behind, which is the correct thing to
// trade away.
//
// WHY THIS IS NOT A SECOND SIMULATION. Nothing here integrates. There is no
// velocity applied over a timestep, no collision, no gravity. It is a weighted
// average of two positions the server has already computed, which is arithmetic on
// authoritative output, not a re-derivation of it. When the buffer runs dry the
// code HOLDS the last known position rather than extrapolating forward, because
// extrapolation is exactly where a presentation layer starts quietly becoming a
// physics engine — and because a body that slides through a wall while the network
// hiccups is worse than one that pauses.

import type { Vec3 } from "@pa/duel";
import type { MatchSnapshot } from "../pvpPort.js";

/** One observed opponent position, with the tick the server captured it at. */
export interface OpponentSample {
  readonly tick: number;
  readonly pos: Vec3;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  /** False once cover breaks the server's line of sight. The ghost goes stale. */
  readonly visible: boolean;
  /** Server tick the position was actually captured; stale while invisible. */
  readonly positionAtTick: number;
  readonly receivedAtMs: number;
}

export interface InterpolationConfig {
  readonly snapshotEveryTicks: number;
  readonly minDelayTicks: number;
  readonly maxDelayTicks: number;
  /** How much of the measured jitter to allow for. Two sigma-ish, by feel. */
  readonly jitterAllowance: number;
}

export const DEFAULT_INTERPOLATION: InterpolationConfig = {
  snapshotEveryTicks: 3,
  // One snapshot interval. Below this the buffer is empty by definition and every
  // frame is a hold.
  minDelayTicks: 3,
  // 250 ms. Past this the opponent is so far in the past that aiming at them is
  // misleading, and a snapping ghost is the more honest failure.
  maxDelayTicks: 15,
  jitterAllowance: 2,
};

export interface OpponentBuffer {
  readonly samples: readonly OpponentSample[];
  /** Inter-arrival gaps in milliseconds, most recent last. */
  readonly arrivalGapsMs: readonly number[];
  readonly lastArrivalMs: number | null;
  readonly config: InterpolationConfig;
}

const GAP_WINDOW = 16;
/** Two snapshot intervals of history plus slack; older samples cannot be needed. */
const SAMPLE_WINDOW_TICKS = 60;

export function createOpponentBuffer(
  config: InterpolationConfig = DEFAULT_INTERPOLATION,
): OpponentBuffer {
  return {
    samples: [],
    arrivalGapsMs: [],
    lastArrivalMs: null,
    config,
  };
}

export function observeSnapshot(
  buffer: OpponentBuffer,
  snapshot: MatchSnapshot,
  receivedAtMs: number,
): OpponentBuffer {
  const sample: OpponentSample = {
    tick: snapshot.tick,
    pos: { ...snapshot.opponent.position },
    capsuleHeight: snapshot.opponent.capsuleHeight,
    health: snapshot.opponent.health,
    ammo: snapshot.opponent.ammo,
    visible: snapshot.opponent.visible,
    positionAtTick: snapshot.opponent.positionAtTick,
    receivedAtMs,
  };

  // Reordered arrivals are inserted rather than appended: a packet that overtook
  // its predecessor still carries a usable position for its own tick, and throwing
  // it away would make a reordering link look like a lossy one.
  const merged = buffer.samples.filter((entry) => entry.tick !== sample.tick);
  merged.push(sample);
  merged.sort((left, right) => left.tick - right.tick);
  const newest = merged[merged.length - 1]!.tick;
  const kept = merged.filter((entry) => entry.tick >= newest - SAMPLE_WINDOW_TICKS);

  const gaps =
    buffer.lastArrivalMs === null
      ? buffer.arrivalGapsMs
      : [...buffer.arrivalGapsMs, receivedAtMs - buffer.lastArrivalMs].slice(-GAP_WINDOW);

  return { ...buffer, samples: kept, arrivalGapsMs: gaps, lastArrivalMs: receivedAtMs };
}

/**
 * Observed jitter as the spread of packet inter-arrival times, in milliseconds.
 *
 * Mean absolute deviation rather than a standard deviation: it needs no square
 * root, it is far less swayed by the single 400 ms outlier that a congested school
 * access point produces every few seconds, and the number it feeds is a render
 * delay rather than anything the simulation reads.
 */
export function observedJitterMs(buffer: OpponentBuffer): number {
  if (buffer.arrivalGapsMs.length < 2) return 0;
  const mean =
    buffer.arrivalGapsMs.reduce((sum, gap) => sum + gap, 0) / buffer.arrivalGapsMs.length;
  const deviation =
    buffer.arrivalGapsMs.reduce((sum, gap) => sum + Math.abs(gap - mean), 0) /
    buffer.arrivalGapsMs.length;
  return deviation;
}

/** How far behind the newest snapshot the opponent should be drawn, in ticks. */
export function interpolationDelayTicks(buffer: OpponentBuffer, tickHz: number): number {
  const jitterTicks = Math.ceil((observedJitterMs(buffer) / 1000) * tickHz);
  const wanted =
    buffer.config.snapshotEveryTicks + jitterTicks * buffer.config.jitterAllowance;
  return Math.min(
    buffer.config.maxDelayTicks,
    Math.max(buffer.config.minDelayTicks, wanted),
  );
}

export interface InterpolatedOpponent {
  readonly pos: Vec3;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  readonly visible: boolean;
  /** True when the buffer had nothing to interpolate and the last pose was held. */
  readonly held: boolean;
  /** The render tick this pose represents. */
  readonly atTick: number;
}

/**
 * The opponent's pose at a render tick, interpolated between the bracketing
 * snapshots.
 *
 * `renderTick` is normally `newestServerTick - interpolationDelayTicks`. Passing it
 * in rather than computing it here keeps the same function usable for the
 * prediction puppet, which needs a pose for a tick slightly in the FUTURE of the
 * render tick and must get a held pose rather than a guess.
 */
export function opponentAt(
  buffer: OpponentBuffer,
  renderTick: number,
): InterpolatedOpponent | null {
  if (buffer.samples.length === 0) return null;

  let before: OpponentSample | null = null;
  let after: OpponentSample | null = null;
  for (const sample of buffer.samples) {
    if (sample.tick <= renderTick) before = sample;
    else if (after === null) after = sample;
  }

  // Past the newest sample, or before the oldest: hold rather than invent. An
  // extrapolated body walks through walls; a held one merely pauses.
  if (before === null) {
    const first = buffer.samples[0]!;
    return pose(first, first.tick, true);
  }
  if (after === null || after.tick === before.tick) {
    return pose(before, renderTick, true);
  }

  const span = after.tick - before.tick;
  const t = (renderTick - before.tick) / span;
  // Only positions are blended, and only when the server could see the body at
  // both ends. Blending across a visibility edge would slide a ghost out of cover
  // it never left.
  if (!before.visible || !after.visible) return pose(before, renderTick, true);

  return {
    pos: {
      x: before.pos.x + (after.pos.x - before.pos.x) * t,
      y: before.pos.y + (after.pos.y - before.pos.y) * t,
      z: before.pos.z + (after.pos.z - before.pos.z) * t,
    },
    capsuleHeight:
      before.capsuleHeight + (after.capsuleHeight - before.capsuleHeight) * t,
    // Discrete quantities take the older value: health that arrives early would
    // show a hit before the ball is drawn reaching the body.
    health: before.health,
    ammo: before.ammo,
    visible: true,
    held: false,
    atTick: renderTick,
  };
}

function pose(
  sample: OpponentSample,
  atTick: number,
  held: boolean,
): InterpolatedOpponent {
  return {
    pos: { ...sample.pos },
    capsuleHeight: sample.capsuleHeight,
    health: sample.health,
    ammo: sample.ammo,
    visible: sample.visible,
    held,
    atTick,
  };
}

export function newestTick(buffer: OpponentBuffer): number | null {
  return buffer.samples[buffer.samples.length - 1]?.tick ?? null;
}
