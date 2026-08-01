// The movement envelope this level is authored against.
//
// Nothing here is a copied number. The parkour system publishes
// MOVEMENT_CAPABILITIES, derived from the shared physics constants, and this
// file re-exports it plus the handful of *authoring policies* that are this
// level's own choice (how much of the budget a SAFE line is allowed to spend,
// what a drop chain may cost). If gravity, jump velocity or a tuning threshold
// moves, every cap here moves with it and the tests fail instead of the route
// silently becoming impossible.
//
// Reconciled against packages/engine-world/src/parkour/tuning.ts.

import {
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  STAND_HEIGHT,
} from "@pa/engine-world/collision";
import {
  CROUCH_SPEED,
  GRAVITY,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STEP_DOWN,
  WALK_SPEED,
} from "@pa/engine-world/playerMotion";
import {
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  jumpAirtimeForDrop,
  levelDesignMaxGapM,
  maxGapMetersForDrop,
  type TraversalVerb,
} from "@pa/engine-world/parkour";

export {
  CAPSULE_RADIUS,
  CROUCH_HEIGHT,
  CROUCH_SPEED,
  GRAVITY,
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STAND_HEIGHT,
  STEP_DOWN,
  WALK_SPEED,
  jumpAirtimeForDrop,
  levelDesignMaxGapM,
  maxGapMetersForDrop,
};
export type { TraversalVerb };

/**
 * How much of the published gap budget each line is allowed to spend.
 *
 * There is one physical budget — `levelDesignMaxGapM(drop)` — and it already
 * carries the engine's own 0.35m safety margin and the 0.43m takeoff setback.
 * This is purely an authoring policy on top of it: a gap on the guaranteed path
 * should feel like nothing, a gap on the skill line may sit against the wall.
 */
export const LINE_GAP_FRACTION = {
  SAFE: 0.8,
  FAST: 1.0,
  EXPERT: 1.0,
} as const;

export type RouteLine = keyof typeof LINE_GAP_FRACTION;

/** Largest lip-to-lip gap this line may author at this drop. */
export function gapBudgetM(dropM: number, line: RouteLine): number {
  return levelDesignMaxGapM(Math.max(0, dropM)) * LINE_GAP_FRACTION[line];
}

/**
 * How the parkour reader will resolve running off a lip of this height. Above
 * `edgeBrakeDropM` the player brakes at the lip instead of running off, so a
 * route that expects a sprint over the edge there reads as broken.
 */
export type DropResolution = "RUN_OFF" | "HANG_DROP" | "ROLL" | "EDGE_BRAKE";

export function resolveDrop(dropM: number): DropResolution {
  if (dropM <= PARKOUR_TUNING.runOffMaxDropM) return "RUN_OFF";
  if (dropM <= PARKOUR_TUNING.hangDropMaxDropM) return "HANG_DROP";
  if (dropM <= PARKOUR_TUNING.rollMaxDropM) return "ROLL";
  return "EDGE_BRAKE";
}

/** Landing flavour a drop produces, which is what sets its noise. */
export function landingKindForDrop(dropM: number): "RUN" | "ROLL" | "HARD" {
  if (dropM <= PARKOUR_TUNING.runOffMaxDropM) return "RUN";
  if (dropM <= PARKOUR_TUNING.rollMaxDropM) return "ROLL";
  return "HARD";
}

/** Noise intensity and audible radius of a landing from this height. */
export function landingNoise(dropM: number): {
  intensity: number;
  radiusM: number;
} {
  const intensity = PARKOUR_TUNING.landingNoise[landingKindForDrop(dropM)];
  return {
    intensity,
    radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
  };
}

/** Noise intensity and audible radius of an authored verb. */
export function verbNoise(verb: TraversalVerb): {
  intensity: number;
  radiusM: number;
} {
  const intensity = PARKOUR_TUNING.verbNoise[verb];
  return {
    intensity,
    radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
  };
}

/** Which vertical verb the reader will pick for a rise of this height. */
export function verbForRise(riseM: number, topStandable: boolean): TraversalVerb {
  if (riseM <= PARKOUR_TUNING.stepUpMaxHeightM && topStandable) return "STEP_UP";
  // The old mantle band folded into CLIMB_UP; CLIMB_OVER stays distinct.
  if (riseM <= PARKOUR_TUNING.mantleMaxHeightM && topStandable) return "CLIMB_UP";
  if (
    riseM <= PARKOUR_TUNING.climbOverMaxHeightM &&
    !topStandable
  ) return "CLIMB_OVER";
  if (riseM <= PARKOUR_TUNING.climbMaxHeightM && topStandable) return "CLIMB_UP";
  return "BLOCKED";
}

/**
 * The chain window is 90 ticks. Obstacles further apart than this at sprint
 * speed drop the chain, and the flow reward — not losing speed — never pays.
 */
export const CHAIN_REACH_M =
  (PARKOUR_TUNING.chainWindowTicks / MOVEMENT_CAPABILITIES.tickHz) * RUN_SPEED;

/** The spacing the chain controller was tuned against. */
export const CHAIN_SWEET_SPOT_M = 3.5;

/**
 * A ramp is emitted as stepped strips. STEP_UP absorbs half a metre at speed,
 * so a strip may be that tall; the margin keeps it clearly inside the verb.
 */
export const RAMP_STEP_RISE_M = MOVEMENT_CAPABILITIES.maxStepUpM - 0.1;

/**
 * A capsule needs its centre this far off a wall face, so every roof deck
 * oversails the mass that carries it. That is also how the city was built.
 */
export const WALL_STANDOFF_M = CAPSULE_RADIUS;
export const JETTY_M = 0.7;

/** A blocker whose underside sits in this band is slid under, not climbed. */
export const SLIDE_MIN_HEADROOM_M = PARKOUR_TUNING.slideMinHeadroomM;
export const SLIDE_MAX_HEADROOM_M = PARKOUR_TUNING.slideMaxHeadroomM;

/** Authored durations, straight off the shipped tuning. */
export const ACTION_MS = PARKOUR_TUNING.durationsMs;

/**
 * The vertical vocabulary. Every walkable surface snaps to one of these bands
 * so the player learns to read height at a glance, and so the legal moves
 * between bands are a small memorisable set.
 */
export const BAND = {
  STREET: 0,
  CART: 0.95,
  BARREL: 1.1,
  STACK: 1.9,
  TREE_AWNING: 2.2,
  STALL_ROOF: 2.55,
  SCAFFOLD_1: 2.9,
  SHED: 3.85,
  GALLERY: 5.6,
  PENTICE: 5.35,
  LOW_ROOF: 7.1,
  MEETING_EAVE: 8.2,
  /**
   * The Town House clock ledge. 7.9, not 8.4, and it moved DOWN to widen the gap
   * above it rather than the gap above it moving up.
   *
   * The squeeze this fixes: a cornice may only hang as far below its own deck as
   * the headroom under it allows, which is the gap to the next deck down less a
   * 1.55m runner. At 8.4 the gap from here to CORNICE was 1.8m, so CORNICE_E was
   * capped at 0.20m of moulding — a plate, and the last pagoda cue on the
   * building. The steeple had exactly this at 1.8m centres and gained the most of
   * anything from the gaps widening.
   *
   * Why from below. The ascent from the balcony at 5.6 to the leads at 12.4 is a
   * fixed 6.8m, so its two intermediate ledges only have their SPACING to give;
   * raising CORNICE would take from the roof's cornice what it gave to this one,
   * and CORNICE also carries Old Brick's eaves, so moving it moves a second
   * landmark's roofline. CLOCK_LEDGE is used by this building alone. Dropping it
   * 0.5m makes the three hops 2.3 / 2.3 / 2.2 — as near equal as the band values
   * allow — and takes CORNICE_E from 0.20m to 0.72m for no cascade at all.
   */
  CLOCK_LEDGE: 7.9,
  MID_ROOF: 9.6,
  CORNICE: 10.2,
  // The monitor's north half, on open posts beside the walk rather than under
  // it. It exists so 8.20 -> 11.20 is two mantles instead of one 3.0m ladder
  // climb; the stagger onto a disjoint footprint is what keeps either target
  // out from under the other. See geometry.ts.
  MEETING_STEP: 10.0,
  MEETING_RIDGE: 11.2,
  // The belfry's two staggered set-offs, replacing the LOUVRE_SILL full-shaft
  // ring at 14.0 that the mesh never drew. See geometry.ts.
  STEEPLE_LEDGE_N: 13.0,
  STEEPLE_LEDGE_E: 14.7,
  LEADS: 12.4,
  TOWER_PLINTH: 15.2,
  STEEPLE_GALLERY: 15.8,
  TOWER_GALLERY: 17.6,
  // 2.4m above the gallery and 2.4m above that, rather than 1.8m twice.
  //
  // 1.8m left a 1.55m runner 250mm of architecture between two rings, and the
  // steeple's own verifier reports what that bought: the crockets ring was
  // crouch-only over 17% of its area, and the leap of faith off the gallery
  // passed UNDER the crockets plane 0.18m out with the art's cornice hanging
  // 167mm below it. Neither is fixable in the mesh — the ring is a surface the
  // player stands on, so it cannot move out of the way of the dive that starts
  // beneath it. 2.4m is the smallest gap that clears both and is still inside
  // climbMaxHeightM, which is what an EXPERT climb between them needs.
  STEEPLE_CROCKETS: 18.2,
  STEEPLE_VANE: 20.6,
  /**
   * Top of the finial. Nothing stands here; it exists so the spire can be drawn.
   *
   * 30.0, not 22.2. At 22.2 the spire was 1.6m — 7% of the tower, against roughly
   * 40% on Old South and Old North — and 1.6m of tapered lead is a finial, not a
   * spire, which is exactly how the built mesh read. 9.4m puts it at 31% and gives
   * the taper a base-to-height of about 1:9 against the 1.0m the vane balcony can
   * spare, which is slender but is what a needle spire is.
   *
   * Free, in the sense that matters: nothing stands above STEEPLE_VANE at 20.6, so
   * no ledge, gap, drop or leap changes. The only coupled number is the asset's
   * declared sizeM, because a mesh 30m tall drawn into a 22.2m box contain-fits at
   * 0.74 and brings every ring down with it.
   */
  STEEPLE_FINIAL: 30.0,
  // The elm.
  BOUGH_LOW: 6.4,
  BOUGH_CROWN: 8.3,
  BOUGH_UPPER: 11.2,
} as const;
