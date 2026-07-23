// ---------------------------------------------------------------------------
// Chase context verbs (design1 feature 1, fun-verdict improvement #1).
//
// Two authored mid-chase actions turn "running" into "escaping":
//   (a) TOPPLE — knock an existing imported barrel/crate stack over behind
//       you. A pursuer who runs into the spill stumbles for a fixed ~2s
//       (deterministic, one-shot per stack — a toppled stack stays down for
//       the whole session and can never be toppled twice).
//   (b) TAVERN CUT — duck through the Bunch of Grapes' back door from the
//       north alley and come out the front onto the street. Breaks line of
//       sight through the whole north row; if the pursuer SAW you go in, the
//       watch remembers your face (recognized) and your Standing takes a
//       small ding, and his doorway pause is shorter.
//
// Everything visible is an existing imported asset: the stacks are the same
// manifest PROPS instances (hidden from the static batch and re-rendered
// tipped by ChaseVerbDirector), and both tavern doors are the imported
// colonial door kit. This module is pure data + pure predicates so the
// verbs are unit-testable without a scene.
// ---------------------------------------------------------------------------

import { PROPS } from "./manifest.js";
import { EXPLORE_LOCATIONS } from "./manifest.js";
import { thresholdAnchorForLocation } from "./doorwayContract.js";
import { CHASE_TUNING } from "./stealthManifest.js";
import type { ChaseObstacleEvent } from "./chaseModel.js";

export interface ChaseToppleStack {
  id: string;
  /** Must reference an existing manifest PROPS entry (glb + position). */
  glb: "barrel-group" | "crate-stack";
  pos: readonly [number, number, number];
  rotY: number;
  /** Player interaction radius for the F prompt. */
  reachM: number;
}

// Stacks chosen along the three chase lanes (center street, north alley,
// south alley) plus the market and civic stretches, each an existing PROPS
// entry (asserted in chaseVerbs.test.ts so the manifest and this list can
// never drift apart).
export const CHASE_TOPPLE_STACKS: readonly ChaseToppleStack[] = [
  { id: "TOPPLE_STREET_EAST_CRATES", glb: "crate-stack", pos: [24, 0, -8.6], rotY: -0.5, reachM: 2.3 },
  { id: "TOPPLE_STREET_TAVERN_BARRELS", glb: "barrel-group", pos: [-19, 0, 8.6], rotY: 0.2, reachM: 2.3 },
  { id: "TOPPLE_STREET_MERCER_BARRELS", glb: "barrel-group", pos: [-9.5, 0, 9.2], rotY: 2.1, reachM: 2.2 },
  { id: "TOPPLE_MARKET_BARRELS", glb: "barrel-group", pos: [-52.5, 0, -8.9], rotY: 1.4, reachM: 2.3 },
  { id: "TOPPLE_WEST_STREET_BARRELS", glb: "barrel-group", pos: [-73, 0, 9.2], rotY: 0.8, reachM: 2.2 },
  { id: "TOPPLE_CIVIC_BARRELS", glb: "barrel-group", pos: [46, 0, 9.3], rotY: 0.4, reachM: 2.2 },
  { id: "TOPPLE_NORTH_ALLEY_CRATES", glb: "crate-stack", pos: [-15.5, 0, -22.3], rotY: -0.2, reachM: 2.3 },
  { id: "TOPPLE_SOUTH_ALLEY_CRATES", glb: "crate-stack", pos: [10, 0, 23.4], rotY: -0.4, reachM: 2.3 },
] as const;

/** Stable hide-key for a manifest prop instance (glb + planar position). */
export function propInstanceKey(glb: string, x: number, z: number): string {
  return `${glb}@${x},${z}`;
}

export function toppleStackPropKeys(
  toppledIds: ReadonlySet<string> | readonly string[],
): Set<string> {
  const ids = toppledIds instanceof Set ? toppledIds : new Set(toppledIds);
  const keys = new Set<string>();
  for (const stack of CHASE_TOPPLE_STACKS) {
    if (ids.has(stack.id)) {
      keys.add(propInstanceKey(stack.glb, stack.pos[0], stack.pos[2]));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Tavern cut-through. The tavern building sits at x -24..-12, z -19.5..-10.5:
// its front door (the EXPLORE_tavern threshold) opens onto the street and its
// authored back door opens onto the north alley. The cut is one-way,
// alley -> street: the front door is already the REFUGE_TAVERN_DOOR resolve
// volume, so the two verbs never compete for the same doorway.
// ---------------------------------------------------------------------------

const TAVERN_FRONT_OUTSIDE = thresholdAnchorForLocation(
  EXPLORE_LOCATIONS.EXPLORE_tavern!,
  "OUTSIDE",
);

export const TAVERN_CUT = {
  id: "CHASE_TAVERN_CUT",
  /** Imported door-kit leaf seated on the tavern's alley-side wall. */
  backDoorLeaf: [-18, 0, -19.62] as readonly [number, number, number],
  backDoorYaw: Math.PI,
  /** Where the F prompt anchors (just outside the back door, in the alley). */
  backEntry: [-18, 0, -20.45] as readonly [number, number, number],
  reachM: 1.9,
  /**
   * Where the player emerges: a full stride out of the front doorway into the
   * street. Deliberately OUTSIDE the REFUGE_TAVERN_DOOR volume (radius 1.35 at
   * the threshold) — the cut breaks line of sight and hands the street back
   * to the runner; it must never auto-resolve the pursuit as a refuge.
   */
  frontExit: [
    TAVERN_FRONT_OUTSIDE[0] + 1.4,
    0,
    TAVERN_FRONT_OUTSIDE[2] + 1.9,
  ] as readonly [number, number, number],
  /** Emerging from a north-row front door faces the street (+z). */
  frontFaceY: 0,
  /** Seconds of input-locked door beat before the reposition lands. */
  transitSeconds: 0.85,
} as const;

// ---------------------------------------------------------------------------
// Pure eligibility + obstacle builders (unit-tested).
// ---------------------------------------------------------------------------

export interface ChaseVerbContext {
  chaseActive: boolean;
  /** Live sim phase from the stealth store ("ACTIVE", "STARTING", …). */
  chasePhase: string;
  spaceId: string;
  toppledStackIds: ReadonlySet<string>;
  /** Chase ids that already used the tavern cut (one cut per chase). */
  usedTavernCutChaseIds: ReadonlySet<string>;
  chaseId: string | null;
}

const VERB_PHASES = new Set(["STARTING", "ACTIVE"]);

export function chaseVerbsAvailable(ctx: ChaseVerbContext): boolean {
  return (
    ctx.chaseActive &&
    ctx.chaseId !== null &&
    ctx.spaceId === "EXTERIOR" &&
    VERB_PHASES.has(ctx.chasePhase)
  );
}

export function eligibleToppleStacks(
  ctx: ChaseVerbContext,
): readonly ChaseToppleStack[] {
  if (!chaseVerbsAvailable(ctx)) return [];
  return CHASE_TOPPLE_STACKS.filter((stack) => !ctx.toppledStackIds.has(stack.id));
}

export function tavernCutEligible(ctx: ChaseVerbContext): boolean {
  return (
    chaseVerbsAvailable(ctx) &&
    ctx.chaseId !== null &&
    !ctx.usedTavernCutChaseIds.has(ctx.chaseId)
  );
}

/** Obstacle event for a stack toppled at `tick` (pursuer stumbles ~2s). */
export function toppleObstacle(
  stack: ChaseToppleStack,
  tick: number,
): ChaseObstacleEvent {
  return {
    id: stack.id,
    x: stack.pos[0],
    z: stack.pos[2],
    tick,
    delaySeconds: CHASE_TUNING.stumbleDelaySeconds,
    radiusM: CHASE_TUNING.stumbleRadiusM,
  };
}

/**
 * Obstacle event for the tavern back doorway after a cut. A pursuer who SAW
 * the player duck in barely pauses (he knows where you went); an unseen cut
 * leaves him checking the doorway for noticeably longer.
 */
export function tavernCutObstacle(
  tick: number,
  seen: boolean,
): ChaseObstacleEvent {
  return {
    id: `${TAVERN_CUT.id}_DOOR`,
    x: TAVERN_CUT.backEntry[0],
    z: TAVERN_CUT.backEntry[2],
    tick,
    delaySeconds: seen
      ? CHASE_TUNING.tavernCutSeenPauseSeconds
      : CHASE_TUNING.tavernCutUnseenPauseSeconds,
    radiusM: 1.6,
  };
}

// Manifest-sync guard used by the unit test AND by the director in dev: every
// authored stack must exactly match a live PROPS entry.
export function toppleStackManifestMismatches(): string[] {
  const mismatches: string[] = [];
  for (const stack of CHASE_TOPPLE_STACKS) {
    const match = PROPS.find(
      (prop) =>
        prop.glb === stack.glb &&
        prop.pos[0] === stack.pos[0] &&
        prop.pos[2] === stack.pos[2] &&
        prop.rotY === stack.rotY,
    );
    if (!match) mismatches.push(stack.id);
  }
  return mismatches;
}
