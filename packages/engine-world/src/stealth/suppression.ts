// Watcher-scoped perception suppression.
//
// WHAT THIS IS FOR. An answered encounter has to be able to buy the player a
// believable moment of peace from the guards they just talked down — the
// constable who accepts your justification turns back to his post and does not
// look at you for a few seconds — WITHOUT turning stealth off. "Off" is the
// wrong shape twice over: it would hide the player from watchers who never took
// part in the encounter, and it would be permanent, which the design forbids
// (a guard talked down is a guard who can chase again later).
//
// So suppression is a LEDGER keyed by watcher id and an EXPIRY TICK, and it is
// only ever read, never a hidden mutation of a watcher's cone. A watcher is
// suppressed if his id is in the ledger and the current tick is before his
// expiry; after it he is an ordinary watcher again with no memory of having been
// suppressed. Two properties fall straight out of that shape and both are
// requirements:
//
//   * SCOPED. Only the ids named are suppressed. Everyone else sees normally,
//     so an answered SHAMBLES stop cannot blind the ropewalk night man.
//   * DETERMINISTIC AND BOUNDED. The expiry is a tick, computed from the tick
//     the grant was made plus a fixed world-second duration, so a replay of the
//     same tick sequence suppresses the same men for the same window.
//
// The ledger is immutable: `suppressWatchers` returns a new one. That keeps it
// safe to hold in a reducer's state and safe to compare by identity.

import { FIELD_TICK_HZ } from "../fieldSimulation.js";
import type { Vec3 } from "../collision.js";
import type { WatcherAlert } from "./alert.js";
import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";

export interface PerceptionSuppression {
  /** watcherId -> the first tick at which the watcher is NO LONGER suppressed. */
  readonly until: ReadonlyMap<string, number>;
}

export const NO_SUPPRESSION: PerceptionSuppression = { until: new Map() };

/** World seconds to fixed ticks, so a grant reads in the design's own units. */
export function suppressionTicks(worldSeconds: number): number {
  return Math.round(worldSeconds * FIELD_TICK_HZ);
}

/**
 * Suppress a set of watchers for `durationTicks`, starting from `fromTick`.
 *
 * A fresh grant for an id already suppressed takes the LATER expiry, so a second
 * reprieve extends the first rather than cutting it short — but a grant is never
 * shortened by an earlier one that has already lapsed.
 */
export function suppressWatchers(
  base: PerceptionSuppression,
  ids: Iterable<string>,
  fromTick: number,
  durationTicks: number,
): PerceptionSuppression {
  const next = new Map(base.until);
  const expiry = fromTick + Math.max(0, durationTicks);
  for (const id of ids) {
    const existing = next.get(id);
    next.set(id, existing === undefined ? expiry : Math.max(existing, expiry));
  }
  return { until: next };
}

/** Is this specific watcher suppressed on this tick? */
export function isPerceptionSuppressed(
  suppression: PerceptionSuppression,
  id: string,
  tick: number,
): boolean {
  const expiry = suppression.until.get(id);
  return expiry !== undefined && tick < expiry;
}

/** Every watcher suppressed on this tick, as a set the field input can read. */
export function suppressedIdsAt(
  suppression: PerceptionSuppression,
  tick: number,
): Set<string> {
  const active = new Set<string>();
  for (const [id, expiry] of suppression.until) {
    if (tick < expiry) active.add(id);
  }
  return active;
}

/** Is anybody suppressed on this tick? A HUD reprieve indicator reads this. */
export function anySuppressed(
  suppression: PerceptionSuppression,
  tick: number,
): boolean {
  for (const expiry of suppression.until.values()) {
    if (tick < expiry) return true;
  }
  return false;
}

/**
 * Drop lapsed entries. Purely an economy — a lapsed entry reads as not
 * suppressed anyway — so a caller that never prunes is correct, just holding a
 * handful of dead keys. Returns the same reference when nothing changed.
 */
export function pruneSuppression(
  suppression: PerceptionSuppression,
  tick: number,
): PerceptionSuppression {
  let changed = false;
  const next = new Map<string, number>();
  for (const [id, expiry] of suppression.until) {
    if (tick < expiry) next.set(id, expiry);
    else changed = true;
  }
  return changed ? { until: next } : suppression;
}

/**
 * The watcher poses the stealth field should read this tick: the input list
 * minus whoever is suppressed.
 *
 * This is the integration seam. A suppressed watcher is dropped from the poses
 * handed to `stepStealthField`, so his cone accrues nothing and he cannot detect
 * — while his body is still drawn from the FULL pose list the renderer keeps, so
 * the man turning back to his post is on screen the whole time. Scoped by id, so
 * only the named men go quiet; bounded by expiry, so they come back on their own.
 */
export function posesWithoutSuppressed<T extends { readonly id: string }>(
  poses: readonly T[],
  suppression: PerceptionSuppression,
  tick: number,
): readonly T[] {
  if (suppression.until.size === 0) return poses;
  const filtered = poses.filter(
    (pose) => !isPerceptionSuppressed(suppression, pose.id, tick),
  );
  return filtered.length === poses.length ? poses : filtered;
}

// ---------------------------------------------------------------------------
// Explicit consequence APIs.
//
// A resolved encounter needs to move ONLY its own actors — into a pursuit on a
// wrong answer, or back to calm on a right one — and it must do that through a
// named function that returns a fresh alert array rather than by reaching into a
// private field of the field state. These two are those functions. Both are
// scoped by id: an actor not named is returned by reference, untouched.
// ---------------------------------------------------------------------------

/**
 * Put the named watchers into INVESTIGATING with their last-known set to the
 * confrontation point.
 *
 * This is the WRONG consequence. The pursuit system reads `lastKnown` off an
 * INVESTIGATING alert and walks the watcher toward it, so the guards close on
 * where the player stood — and, finding nobody, they search and stand down on
 * the field's own timers afterwards, which is what keeps a wrong answer a real
 * threat the player can outrun rather than a permanent one.
 */
export function investigateWatchers(
  alerts: readonly WatcherAlert[],
  ids: Iterable<string>,
  at: Vec3,
  tuning: StealthTuning = STEALTH_TUNING,
): WatcherAlert[] {
  const set = new Set(ids);
  if (set.size === 0) return [...alerts];
  return alerts.map((alert) => {
    if (!set.has(alert.id)) return alert;
    return {
      ...alert,
      state: "INVESTIGATING",
      stateTicks: 0,
      noContactTicks: 0,
      suspicion: Math.max(alert.suspicion, tuning.thresholds.investigating),
      lastKnown: { x: at.x, y: at.y, z: at.z },
      attention: { x: at.x, y: at.y, z: at.z },
      attentionIsDiversion: false,
      attentionTicks: 0,
      firstHand: false,
      called: false,
    };
  });
}

/**
 * Reset the named watchers to calm (UNAWARE), out of any active contact.
 *
 * The CORRECT consequence's other half: the actors the player just talked down
 * are dropped from any pursuit they were in and returned to their patrol, while
 * `suppressWatchers` keeps them from re-detecting for the reprieve window. Their
 * facing is preserved so the reset does not visibly snap the body's head round.
 */
export function calmWatchers(
  alerts: readonly WatcherAlert[],
  ids: Iterable<string>,
): WatcherAlert[] {
  const set = new Set(ids);
  if (set.size === 0) return [...alerts];
  return alerts.map((alert) => {
    if (!set.has(alert.id)) return alert;
    return {
      ...alert,
      state: "UNAWARE",
      stateTicks: 0,
      noContactTicks: 0,
      suspicion: 0,
      lastKnown: null,
      attention: null,
      attentionIsDiversion: false,
      attentionTicks: 0,
      firstHand: false,
      called: false,
      searchYawOffset: 0,
    };
  });
}
