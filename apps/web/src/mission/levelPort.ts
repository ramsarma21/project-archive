import type { ComponentType } from "react";
import type { BeatOutcome, BeatSpec } from "@pa/beat";
import type {
  AlertState,
  CollisionWorld,
  PlayerExposure,
  ReceivingTarget,
  TraversalVerb,
  Vec3,
  WatcherPose,
} from "@pa/engine-world";
import type { MissionDuelBrief } from "./duelPort.js";

// ---------------------------------------------------------------------------
// The level boundary.
//
// The container runs fourteen missions and knows none of them. Everything that
// varies between a Boston alley and a wharf arrives through this port, and
// everything that does not — the clock, the RNG, the attempt rules, the XP
// decay, the teardown — lives in the container.
//
// Two rules shape the shape of it.
//
// A level supplies DATA and PREDICATES, never a second engine. The world is one
// CollisionWorld, the same one the player moves through and the same one sight
// lines are traced against. Where a level needs to make a judgement the
// container cannot make for it — is this objective met, has the attempt been
// lost — it supplies a pure function of the player's read, evaluated inside the
// container's fixed step. It never gets a tick loop of its own.
//
// A level supplies its own art. `Scenery` is a component the level owns, so the
// container never guesses at an asset key or a fitted footprint, and the
// imported-visible-world rule stays enforceable by whoever authored the assets.
// A level with no scenery renders nothing physical, which is the correct
// failure: a visible primitive stand-in is worse than an empty stage.
// ---------------------------------------------------------------------------

/** What the player is doing this tick. The argument to every level predicate. */
export interface MissionPlayerRead {
  readonly pos: Vec3;
  readonly yaw: number;
  readonly speedMps: number;
  readonly capsuleHeight: number;
  readonly crouched: boolean;
  readonly grounded: boolean;
  readonly verb: TraversalVerb;
  /** Fixed-step index from the shared clock. */
  readonly tick: number;
  /** Seconds of traversal elapsed, derived from ticks and never from wall time. */
  readonly elapsedS: number;
}

/** What the stealth field currently thinks. The second argument to `failWhen`. */
export interface MissionFieldRead {
  readonly suspicion: number;
  readonly squadState: AlertState;
  /** True on the tick a sighting is confirmed and cannot be taken back. */
  readonly detected: boolean;
  /** Ticks the squad has been ALERTED for. An authored fail clock reads this. */
  readonly alertedTicks: number;
  readonly contactIds: readonly string[];
}

/**
 * How an attempt was lost on the floor, in the level's own words.
 *
 * The copy belongs to the level because it is authored per mission — M1's is
 * "The constable has closed the route to the post." — and the cue id is carried
 * so the terminal notice stays traceable to the authored beat.
 */
export interface MissionFailure {
  readonly code: string;
  readonly cueId: string | null;
  readonly headline: string;
  readonly detail: string;
}

/**
 * One thing the run has to achieve. Required objectives are the clear
 * condition for the traversal phase; optional ones are recorded and reported.
 *
 * Satisfaction latches. A player who crosses the terminal volume and steps back
 * out has still reached it, and no objective may become unmet again.
 */
export interface MissionObjective {
  readonly id: string;
  readonly label: string;
  readonly required: boolean;
  satisfiedBy(read: MissionPlayerRead): boolean;
}

/**
 * One civilian body.
 *
 * The single most important thing about this type is that there is exactly one of
 * these lists per tick and three consumers read it: the thrown diversion, which
 * can strike a body; crowd blending, whose density is COUNTED from it; and the
 * renderer, which instances exactly it. A crowd that renders twelve bodies while
 * the field believes there are forty-two would hide the player behind people who
 * are not there, and the only reliable defence against that is for the second
 * number not to exist. See `MissionCrowdCluster`, which deliberately has no
 * density field for a level to author.
 *
 * Shaped to satisfy @pa/engine-world's `DiversionActor` (a `BodyPose` with an id)
 * so the same array is handed to the throw physics without being copied.
 */
export interface MissionCivilian {
  readonly id: string;
  /**
   * Authoring intent: which crowd this body was placed for, or null for a
   * passer-by. Grouping and defect-checking only — a cluster's density is counted
   * from the bodies actually standing inside its radius, so a crowd that drifts
   * apart loses its cover instead of claiming bodies that have walked away.
   */
  readonly clusterId: string | null;
  /** Feet position. A thrown object is tested against the capsule above it. */
  readonly pos: Vec3;
  /** Standing or stooped. A throw can arc over a crouching body. */
  readonly capsuleHeight: number;
  readonly yaw: number;
  /** The imported rig this body is drawn with. The level owns its cast. */
  readonly rigKey: string;
  /** Multiplicative hue, so a handful of shared rigs read as a throng. */
  readonly tint?: string;
  /** Clip to play. Defaults to a standing idle. */
  readonly clip?: string;
}

/**
 * Where a crowd is, and how big. NOT how many are in it.
 *
 * `CrowdCluster` in @pa/engine-world carries a `density` that the blend rule reads
 * against `crowdBlendMinDensity`. That number is derived by the container from the
 * civilians actually present, never authored here, because an authored density is a
 * second count that can disagree with the bodies on screen.
 */
export interface MissionCrowdCluster {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly radiusM: number;
}

/**
 * A precision beat the level has authored, and where to send the result.
 *
 * The level supplies the SPEC — where the work is, which verb, which chart
 * vocabulary — and the container supplies everything else: one run per attempt,
 * a chart derived once from the attempt seed, a fixed step, and the noise going
 * into the stealth field. This is the same division as everywhere else in this
 * port: a level supplies data and predicates and never gets a loop.
 *
 * `onResolved` fires once, on the tick the run ends, and it is how a level
 * learns whether the sheet went up — which is what its `beatObjective` reads and
 * what its `failWhen` tests for a torn one. It is called for an abandoned run
 * too, because a level may want to know; `isTerminalPrecisionFailure` is the
 * function that knows an abandoned run is not a failure.
 */
export interface MissionBeatMount {
  readonly spec: BeatSpec;
  onResolved?(outcome: BeatOutcome): void;
}

/** The non-interactive authored handoff that opens some missions. */
export interface MissionBriefing {
  readonly cueId: string;
  readonly headline: string;
  readonly lines: readonly string[];
  /** Authored length, in seconds. A presentation target, never a lock-out. */
  readonly targetSeconds: number;
}

/**
 * One mission, loaded and ready to run, for exactly one attempt.
 *
 * The lifetime is the attempt: a retry loads a fresh instance against a fresh
 * seed rather than resetting this one, so nothing an attempt mutated can leak
 * into the next. `dispose` is called exactly once on every exit path, including
 * the ones nobody plans for — an abandoned run, a failed load that resolved
 * late, an unmounted hub.
 */
export interface MissionInstance {
  readonly missionId: string;
  readonly attemptOrdinal: number;
  /** The one collision representation. Movement, sight and cover all read it. */
  readonly world: CollisionWorld;
  readonly spawn: { readonly pos: Vec3; readonly yaw: number };
  /** Authored handoff, or null when the mission drops the player straight in. */
  readonly briefing: MissionBriefing | null;
  /** Authored pacing budget for traversal, in seconds. Drawn, not enforced. */
  readonly traversalBudgetS: number;
  /**
   * Hard limit, or null when traversal is untimed.
   *
   * Null is the default and the design's position: §4.11 lists exactly three
   * ways an attempt is lost — the authored detection point, the precision beat,
   * and the duel — and running out of clock is not one of them. The 180 seconds
   * in §4.5 are a pacing budget. A level that genuinely wants a timer has to
   * ask for one here, in the open.
   */
  readonly traversalTimeoutS: number | null;
  readonly objectives: readonly MissionObjective[];
  /**
   * The mission's one precision beat, or absent for a level with none.
   *
   * At most one: the design gives a mission a single mechanical-skill
   * expression, and two would make the second one a chore rather than a peak.
   */
  readonly beat?: MissionBeatMount;
  readonly receivingTargets: readonly ReceivingTarget[];
  /** Every watcher the stealth field should track, in a stable order. */
  readonly watcherIds: readonly string[];
  /**
   * Where the watchers are on a given tick. Patrol movement belongs to the
   * level — the stealth field deliberately does not move anybody — and it must
   * be a pure function of tick and seed so a replayed attempt sees the same
   * patrol.
   */
  watcherPosesAtTick(tick: number, seed: number): readonly WatcherPose[];
  /**
   * Where the crowds are. Extent only; the container counts who is in them.
   */
  readonly crowdClusters: readonly MissionCrowdCluster[];
  /**
   * Every civilian body this tick, or an empty list for a mission with no crowd.
   *
   * Must be a pure function of tick and seed, and should return a referentially
   * stable array while the crowd is stationary — the container derives cluster
   * density from array identity and will not recount an unchanged list.
   */
  civiliansAtTick?(tick: number, seed: number): readonly MissionCivilian[];
  /** Authored cover state at a position. Defaults to EXPOSED. */
  exposureAt?(read: MissionPlayerRead): PlayerExposure;
  /** Authored light level in [0,1]. Defaults to full daylight. */
  lightLevelAt?(read: MissionPlayerRead): number;
  /** Authored hard cover between the player and the nearest watcher. */
  coveredAt?(read: MissionPlayerRead): boolean;
  /**
   * The authored fail boundary. Returning a failure ends the attempt on the
   * floor. Called once per fixed step, after the field has resolved.
   */
  failWhen?(read: MissionPlayerRead, field: MissionFieldRead): MissionFailure | null;
  /**
   * Route cost. Called on the tick a sighting is confirmed, so the level can
   * close the advantageous crossover, force a lower line, or push the player
   * behind the next cover — being read costs position, not the attempt.
   *
   * Whatever this changes must be a function of the tick and the seed, because a
   * committed route penalty has to reproduce on replay.
   */
  onDetected?(read: MissionPlayerRead, field: MissionFieldRead): void;
  /** The duel this mission ends in. Handed to the duel view untouched. */
  readonly duel: MissionDuelBrief;
  /**
   * The level's own imported art, or null. Mounted inside the container's
   * canvas; the level owns every GLB, texture and fit in it.
   */
  readonly Scenery: ComponentType<{ readonly reducedMotion: boolean }> | null;
  /** Frees whatever the loader allocated. Idempotent by contract. */
  dispose(): void;
}

/**
 * Everything wrong with a loaded instance, as sentences.
 *
 * Checked when the instance arrives, so a level with no way to finish is refused
 * before the player is put inside it. The load-bearing one is the required
 * objective: with none, "every required objective is met" is vacuously true, and a
 * level author who forgot to declare the terminal volume would ship a mission that
 * clears on its first fixed step and pays full XP. Failing closed here turns that
 * into a refused deploy, which is the direction to be wrong in.
 */
export function missionInstanceDefects(instance: MissionInstance): string[] {
  const defects: string[] = [];
  if (!instance.objectives.some((objective) => objective.required)) {
    defects.push(
      "the level declares no required objective, so the floor has no completion",
    );
  }
  const ids = new Set<string>();
  for (const objective of instance.objectives) {
    if (ids.has(objective.id)) defects.push(`duplicate objective id ${objective.id}`);
    ids.add(objective.id);
  }
  if (instance.world.platforms.length === 0 && instance.world.blockers.length === 0) {
    defects.push("the level has no collision geometry to stand on");
  }

  const clusterIds = new Set(instance.crowdClusters.map((cluster) => cluster.id));
  if (clusterIds.size !== instance.crowdClusters.length) {
    defects.push("two crowd clusters share an id");
  }
  // A civilian assigned to a cluster that does not exist is invisible to blending
  // and would be counted by nobody, which is the silent half of the parity bug
  // this port exists to prevent.
  const civilians = instance.civiliansAtTick?.(0, 0) ?? [];
  const orphans = new Set<string>();
  for (const civilian of civilians) {
    if (civilian.clusterId !== null && !clusterIds.has(civilian.clusterId)) {
      orphans.add(civilian.clusterId);
    }
  }
  for (const clusterId of orphans) {
    defects.push(`civilians name a crowd cluster "${clusterId}" that is not declared`);
  }
  if (instance.crowdClusters.length > 0 && civilians.length === 0) {
    defects.push(
      "the level declares crowd clusters and no civilians, so blending would " +
        "hide the player behind nobody",
    );
  }
  return defects;
}
