// Reflex time: the moment you are spotted becomes a moment of play.
//
// On a first-hand sighting the world slows and the watcher's certainty is HELD
// at the brink rather than being cashed in. If the player breaks line of sight
// before the window closes, the sighting is downgraded to a search and the run
// continues. If they do not, the sighting confirms, the shout goes out, and the
// squad responds. That is the whole verb: it does not save you, it gives you a
// chance to save yourself.
//
// WHY THESE NUMBERS
//
// Duration. The window is 1.6 seconds of world time at a 0.35 time scale, which
// is ~4.6 seconds of real time to react. That is deliberately generous, because
// the design's access rule sets input tolerances once, low, for a player with
// ordinary reflexes on a Chromebook trackpad, and never moves them for anybody.
// A window tuned for a good player would make this a dexterity gate, and a
// dexterity gate on a stealth failure is exactly the thing the design forbids.
//
// Frequency. Three charges per mission, no refunds and no regeneration, plus a
// 12-second cooldown so two guards seeing you back to back cannot chain two
// windows into one long escape. Three windows is 4.8 seconds of slow motion
// across a 180-second mission — under 3% of the run — and about 13.7 seconds of
// real reaction time in total.
//
// Scarcity is the point. Reflex time that always fires is not a reward for
// reacting well, it is a removal of the consequence of being seen, and it would
// delete the tension that makes the other five verbs worth using. Three is
// enough to convert three would-be failures into three moments of play; a fourth
// mistake is a real mistake.
//
// It never fires in an area that is already hot. Once a watcher is INVESTIGATING
// or ALERTED, being spotted is a consequence of a situation the player already
// knew about, not a surprise, and the window would only be an escape valve.
//
// DETERMINISM. Reflex time does not touch the clock. It publishes a time scale;
// the render bridge multiplies its frame delta by that scale before calling
// advanceFieldClock. The fixed step, the tick indices and the seeded kernel are
// identical whether or not a window opened, so a replay is unaffected.

import { STEALTH_TUNING, type StealthTuning } from "./tuning.js";

export interface ReflexState {
  /** True while the window is open. */
  active: boolean;
  /** World ticks left in the window. */
  remainingTicks: number;
  /** Charges left this mission. */
  charges: number;
  /** World tick at which another window may open. */
  readyAtTick: number;
  /** The watcher whose sighting is being held. */
  pendingWatcherId: string | null;
  /** Consecutive ticks of broken contact inside the window. */
  escapeTicks: number;
  /** Windows opened this mission, for telemetry. */
  triggered: number;
}

export type ReflexOutcome = "NONE" | "ESCAPED" | "CONFIRMED" | "EXPIRED";

export interface ReflexResult {
  reflex: ReflexState;
  /** How the window that just closed resolved. */
  outcome: ReflexOutcome;
  /** True on the tick a window opens. */
  opened: boolean;
  /**
   * Simulation time scale to apply to the NEXT render frame delta. 1 when no
   * window is open.
   */
  timeScale: number;
}

export function createReflexState(
  tuning: StealthTuning = STEALTH_TUNING,
): ReflexState {
  return {
    active: false,
    remainingTicks: 0,
    charges: tuning.reflexChargesPerMission,
    readyAtTick: 0,
    pendingWatcherId: null,
    escapeTicks: 0,
    triggered: 0,
  };
}

export interface ReflexTriggerInput {
  tick: number;
  /**
   * The watcher that reached ALERTED through its own eyes this tick, if any.
   * A watcher escalated by a shout is not a trigger: the player was not spotted.
   */
  firstHandSightingWatcherId: string | null;
  /**
   * True when any OTHER watcher was already INVESTIGATING or ALERTED before this
   * sighting. A hot area does not grant a window.
   */
  areaAlreadyHot: boolean;
  /** OS reduced-motion, or an accessibility opt-out. */
  disabled: boolean;
}

/** Would a sighting open a window right now, and why not if not. */
export function reflexTriggerable(
  reflex: ReflexState,
  input: ReflexTriggerInput,
): { triggerable: boolean; reason: string } {
  if (input.disabled) return { triggerable: false, reason: "disabled" };
  if (reflex.active) return { triggerable: false, reason: "already-active" };
  if (input.firstHandSightingWatcherId === null) {
    return { triggerable: false, reason: "no-first-hand-sighting" };
  }
  if (reflex.charges <= 0) return { triggerable: false, reason: "no-charges" };
  if (input.tick < reflex.readyAtTick) {
    return { triggerable: false, reason: "cooldown" };
  }
  if (input.areaAlreadyHot) {
    return { triggerable: false, reason: "area-already-hot" };
  }
  return { triggerable: true, reason: "first-hand-sighting" };
}

export interface ReflexStepInput extends ReflexTriggerInput {
  /**
   * Visibility of the player to the pending watcher this tick. Zero for the
   * escape window's required duration downgrades the sighting.
   */
  pendingVisibility: number;
}

/**
 * One fixed step of reflex time.
 *
 * Call this AFTER visibility is computed and BEFORE alert escalation is cashed
 * in, and pass `suspendConfirmation` from the result into the alert step so the
 * held sighting is not confirmed while the window is open.
 */
export function stepReflex(
  reflexIn: ReflexState,
  input: ReflexStepInput,
  tuning: StealthTuning = STEALTH_TUNING,
): ReflexResult {
  const reflex: ReflexState = { ...reflexIn };
  let outcome: ReflexOutcome = "NONE";
  let opened = false;

  if (!reflex.active) {
    const gate = reflexTriggerable(reflex, input);
    if (gate.triggerable) {
      reflex.active = true;
      reflex.remainingTicks = tuning.reflexWindowTicks;
      reflex.charges -= 1;
      reflex.triggered += 1;
      reflex.pendingWatcherId = input.firstHandSightingWatcherId;
      reflex.escapeTicks = 0;
      opened = true;
    }
    return {
      reflex,
      outcome,
      opened,
      timeScale: reflex.active ? tuning.reflexTimeScale : 1,
    };
  }

  reflex.escapeTicks =
    input.pendingVisibility <= tuning.minAccrualVisibility
      ? reflex.escapeTicks + 1
      : 0;
  reflex.remainingTicks -= 1;

  if (reflex.escapeTicks >= tuning.reflexEscapeTicks) {
    outcome = "ESCAPED";
  } else if (reflex.remainingTicks <= 0) {
    outcome =
      input.pendingVisibility > tuning.minAccrualVisibility
        ? "CONFIRMED"
        : "EXPIRED";
  }

  if (outcome !== "NONE") {
    reflex.active = false;
    reflex.remainingTicks = 0;
    reflex.pendingWatcherId = null;
    reflex.escapeTicks = 0;
    reflex.readyAtTick = input.tick + tuning.reflexCooldownTicks;
  }

  return {
    reflex,
    outcome,
    opened,
    timeScale: reflex.active ? tuning.reflexTimeScale : 1,
  };
}

/**
 * Progress through the open window, [0,1]. For a HUD ring or a vignette; the
 * player has to be able to see how much of their chance is left.
 */
export function reflexProgress(
  reflex: ReflexState,
  tuning: StealthTuning = STEALTH_TUNING,
): number {
  if (!reflex.active || tuning.reflexWindowTicks <= 0) return 0;
  return 1 - reflex.remainingTicks / tuning.reflexWindowTicks;
}
