// The combat HUD's pure model — every number the Overwatch-style HUD draws, derived
// and nothing invented.
//
// This file holds NO React and NO state. It exists so the two things the HUD must get
// right can be asserted rather than eyeballed: that health/ammo/enemy readouts are a
// pure function of authoritative state (the boss duel's `DuelHud`, or a PvP snapshot),
// and that a hit cue fires exactly once per authoritative hit and never on a duplicated
// or replayed event. The components in `CombatHud.tsx` are thin skins over these.
//
// WHY DROP-DETECTION IS THE DEDUP. A landed hit is a fall in the target's health, and
// authoritative health is monotone non-increasing within a round of fighting (nothing
// here heals, and the PvP presentation clock is monotone so a replayed or duplicated
// snapshot carries the SAME health, not a lower one). So "fire on a strict drop" is
// already dedup-safe on both paths: a duplicate has an equal health and produces no
// drop. The optional tick guard is defence in depth for the PvP feed, never the primary
// mechanism.

/** Below this fraction the pool is critical: red, and marked with words, never colour alone. */
export const CRITICAL_FRACTION = 0.25;
/** Below this fraction the pool is damaged: the bar warms and the panel takes a warning edge. */
export const DAMAGED_FRACTION = 0.5;

export type HealthTone = "healthy" | "damaged" | "critical" | "down";

export function healthFraction(value: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/**
 * The state a health pool is in, for both colour AND a non-colour cue (a label, a
 * pulse). `down` is distinct from `critical`: a body at zero is out, not merely low.
 */
export function healthTone(value: number, max: number): HealthTone {
  if (value <= 0) return "down";
  const fraction = healthFraction(value, max);
  if (fraction <= CRITICAL_FRACTION) return "critical";
  if (fraction <= DAMAGED_FRACTION) return "damaged";
  return "healthy";
}

/** A short, non-colour label for the pool's state, for the aria/live region. */
export function healthToneLabel(tone: HealthTone): string {
  switch (tone) {
    case "down":
      return "down";
    case "critical":
      return "critical";
    case "damaged":
      return "hurt";
    default:
      return "steady";
  }
}

// ---- the hit cue -----------------------------------------------------------

export type HitKind = "NORMAL" | "CRITICAL" | "FATAL";

/**
 * What a health change is, for the bar's animation: a strict fall is damage, a strict
 * rise is a heal, and anything else (equal — a duplicated or stale snapshot — or a max
 * change) is neither. This is the guard that keeps the impact pulse and the chip from
 * replaying on a repeated poll: the pulse only fires on `"damage"`, and a duplicate
 * carries an EQUAL health, so it reports `"none"`.
 */
export type HealthChange = "damage" | "heal" | "none";

export function healthDelta(previous: number, next: number): HealthChange {
  if (next < previous) return "damage";
  if (next > previous) return "heal";
  return "none";
}

/**
 * Classify the hit a health change represents, or null if it is not a hit.
 *
 * A strict fall is a landed shot. It is FATAL if the pool reaches zero, CRITICAL if the
 * shot is the one that crosses the pool into the critical band (a differentiated cue at
 * the threshold, per the brief), and NORMAL otherwise. Equal or rising health is not a
 * hit, which is what makes a replayed or duplicated event produce no cue.
 */
export function classifyHit(
  previousHealth: number,
  nextHealth: number,
  max: number,
): HitKind | null {
  if (!(nextHealth < previousHealth)) return null;
  if (nextHealth <= 0) return "FATAL";
  const wasAboveCritical = healthFraction(previousHealth, max) > CRITICAL_FRACTION;
  const nowAtOrBelow = healthFraction(nextHealth, max) <= CRITICAL_FRACTION;
  if (wasAboveCritical && nowAtOrBelow) return "CRITICAL";
  return "NORMAL";
}

/**
 * A tiny reducer for the enemy hit cue, carrying the last health AND the last
 * authoritative tick it was seen at. The tick guard means an out-of-order or duplicated
 * arrival that carries the same tick can never re-fire, even in the theoretical case a
 * feed replays a lower health at a tick already presented.
 */
export interface HitTracker {
  readonly health: number;
  /** Authoritative tick this health was observed at; -1 before the first observation. */
  readonly tick: number;
}

export function initialHitTracker(health: number, tick = -1): HitTracker {
  return { health, tick };
}

export interface HitObservation {
  readonly tracker: HitTracker;
  /** The cue to fire this observation, or null. */
  readonly hit: HitKind | null;
}

/**
 * Fold one authoritative observation in. Fires at most once per real drop: a tick that
 * has already been presented (`tick <= tracker.tick`) is a duplicate and never fires,
 * and an equal or higher health never fires. The stored health is the LOWER of the two
 * and the stored tick the HIGHER, so the tracker cannot be walked backwards by a late
 * arrival.
 */
export function observeHealth(
  tracker: HitTracker,
  health: number,
  max: number,
  tick = tracker.tick + 1,
): HitObservation {
  const isNewTick = tracker.tick < 0 || tick > tracker.tick;
  const hit = isNewTick ? classifyHit(tracker.health, health, max) : null;
  return {
    tracker: {
      health: Math.min(tracker.health, health),
      tick: Math.max(tracker.tick, tick),
    },
    hit,
  };
}

// ---- ammunition, Cassidy-style ---------------------------------------------

export interface AmmoReadout {
  /** Bullets loaded right now. The large primary number. */
  readonly current: number;
  /** The round's magazine — the "reserve"/total the current reads against. */
  readonly total: number;
  readonly empty: boolean;
  /** A quarter of the magazine or less (but not empty): the low-ammo warning state. */
  readonly low: boolean;
}

/**
 * Bullets remaining and the round's magazine, in the Cassidy "current / reserve"
 * reading. The total is the larger of the two so a spent magazine still reports what it
 * held, and a mid-round pickup that pushes ammo above the recorded magazine still reads.
 */
export function ammoReadout(ammo: number, magazine: number): AmmoReadout {
  const current = Math.max(0, Math.round(ammo));
  const total = Math.max(current, Math.round(magazine), 0);
  return {
    current,
    total,
    empty: current <= 0,
    low: current > 0 && current <= Math.max(1, Math.ceil(total * CRITICAL_FRACTION)),
  };
}

/**
 * Track the round's magazine from a PvP feed, where the snapshot carries only current
 * ammo and no granted total. The magazine is the PEAK ammo observed since the round
 * changed — an observation of the authoritative value, never an assumed constant, in
 * the same spirit as `progress.ts` deriving the health maximum from what it has seen.
 */
export interface AmmoRoundTracker {
  readonly round: number;
  readonly magazine: number;
}

export function observeRoundAmmo(
  tracker: AmmoRoundTracker,
  round: number,
  ammo: number,
): AmmoRoundTracker {
  if (round !== tracker.round) return { round, magazine: Math.max(0, ammo) };
  return { round, magazine: Math.max(tracker.magazine, Math.max(0, ammo)) };
}
