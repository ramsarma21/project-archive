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
import type {
  EncounterVariantRef,
  PerspectiveEncounter,
  WayfindSample,
} from "@pa/mission-m1";
import type { DawnRead } from "./dawn.js";
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
 * Where an objective IS, for the one mark the run keeps live.
 *
 * Supplied by the level and optional, because an objective is a predicate and
 * plenty of them have no place: "never be seen" is not somewhere to run to. The
 * container draws at most one of these at a time and draws nothing at all for
 * an objective that declares none, which is the correct behaviour for a
 * condition rather than a destination.
 *
 * THE LEVEL ANSWERS "HOW FAR", not the container. `rangeM` exists because the
 * straight line is the wrong number on a route that goes over a town: only the
 * level knows its own route graph, so only the level can walk it. A level that
 * has no opinion may leave it out and the container measures the straight line
 * itself — which is honest, and says so on the plate.
 */
export interface MissionObjectiveMark {
  /** The thing itself: the nail in the elm, the gate in the wall. */
  readonly pos: Vec3;
  /** Named the way a place is named, not the way a task is. */
  readonly title: string;
  /** One short line under the name. What happens on arrival. */
  readonly detail?: string;
  /**
   * Metres still to travel, along the route where the level can walk it.
   * Returning null means "I cannot answer from there"; the container falls
   * back to the straight line and marks the figure as such.
   */
  rangeM?(from: Vec3): { readonly metres: number; readonly viaRoute: boolean } | null;
  /**
   * The next place on the way there, and what to call that leg. A PURE READ.
   *
   * WHY THE MARK POINTS AT SOMETHING THAT IS NOT THE OBJECTIVE. The plate names
   * a thing eighty metres away and the ring lands on the next thing between
   * here and it, because those answer two different questions and a player
   * mid-run needs both. "Where is the elm" is answered by the name and the
   * distance. "Which way, from inside this square, with a twelve-metre Town
   * House in front of me" is answered by nothing a straight bearing can say —
   * and it is the question that actually stopped the run, three times.
   *
   * THIS PEEKS; IT DOES NOT DECIDE. The waypoint is committed once per fixed
   * step by `advance` below, and both surfaces that draw it — the HUD sample and
   * the in-canvas mark — read it through here, at their own rates, without
   * moving it. A read that advanced the waypoint would let two consumers at two
   * frame rates drive it against each other and walk the mark in a loop, which
   * is exactly the failure the commitment in the wayfinder exists to prevent.
   *
   * Optional, and absent means the mark points at the objective itself, which
   * is right for a short final approach and right for a level with no graph.
   */
  waypoint?(from: Vec3): { readonly pos: Vec3; readonly via: string } | null;
  /**
   * Advance the committed waypoint from a fixed-tick sample. THE ONLY MUTATOR.
   *
   * Called once per fixed step by the mission runtime — see `advanceWayfinding`
   * — and by nothing else, so the runtime is the single owner of the guidance
   * state and every drawing surface is a pure reader of it. The sample carries
   * more than a position — grounded state, the surface underfoot, the verb, and
   * any traversal that completed this tick — so the guidance can tell a finished
   * climb from a body that merely drifted over a node and rejoin the route at the
   * proven place. Optional: a level with no route graph leaves it out and the
   * mark points at the objective itself.
   */
  advance?(sample: WayfindSample): void;
  /**
   * The authored ground speed the current committed leg is walked at, or null
   * when it has no cap. A pure peek: the runtime reads it to hold a Shift-held
   * body to a leg's pace where a sprint would overshoot — the ropewalk tie beam.
   */
  speedCapMps?(from: Vec3): number | null;
  /**
   * The directed action gateway the committed guidance is holding, if any: the
   * authored axis (unit XZ, take-off -> receiver) and the verb family it allows.
   * A pure peek off the committed waypoint, read so the runtime can steer the
   * reader onto the action's line and confine the commit to it (see traversal.ts
   * and flow.ts). Only the safe signal is exposed — not the link ids or the
   * endpoints. Null when the next leg is an ordinary run.
   */
  gateway?(): {
    readonly axisX: number;
    readonly axisZ: number;
    readonly phase: "APPROACH" | "RECEIVER";
    readonly allowedVerbs: readonly TraversalVerb[];
    /**
     * The authored action kind (VAULT / CLIMB / JUMP / DASH_JUMP /
     * LEAP_OF_FAITH / DROP / …), so a reader can NAME the imminent move — the
     * "CLIMB UP" / "VAULT" / "LEAP" cue the run-mark posts on the take-off. It
     * is the WayGateway's own `kind`, carried through unchanged; a string rather
     * than a coupled enum so the generic port stays decoupled from one level's
     * link vocabulary.
     */
    readonly kind: string;
    /**
     * Directed receiver elevation, receiver Y minus take-off Y off the authored
     * link. Positive is a climb. Exposed so a HUD/reader can post the upward
     * affordance — the SPACE·CLIMB cue at the clock — even when the waypoint is
     * pinned to the take-off and its own rise reads flat. See WayGateway.
     */
    readonly riseM: number;
  } | null;
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
  /** Where to point, for a required objective that is a place. See above. */
  readonly mark?: MissionObjectiveMark;
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
 * The body to draw for one watcher.
 *
 * POSITION IS DELIBERATELY ABSENT. Where a watcher is standing is the
 * simulation's answer and changes every tick — the authored patrol, displaced by
 * wherever the pursuit has walked him — so a cast entry that carried a position
 * would be a second opinion about it, and the version on screen would be the
 * wrong one exactly when it mattered. This is the art, keyed by the id the
 * stealth field already tracks; the pose comes off `MissionRuntime.watcherPoses`.
 */
export interface MissionWatcherCast {
  /** Matches an entry in `watcherIds`. */
  readonly id: string;
  /** The imported rig. The level owns its cast. */
  readonly rigKey: string;
  /** Body height, so the drawn man is the height his cone looks out of. */
  readonly capsuleHeight: number;
  /** What he is, in the level's own words. For dev overlays and captions. */
  readonly role?: string;
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

/**
 * One authored encounter, with the attempt's chosen variant.
 *
 * The `def` is the client-safe encounter (speaker, trigger, priorities, prompt);
 * the `variant` is the single item this attempt asks, chosen by the level from
 * the durable seed and ordinal. No rubric or reference answer is present — those
 * live server-side — so nothing here is unsafe to hold in the browser.
 */
export interface MissionEncounterMount {
  readonly def: PerspectiveEncounter;
  readonly variant: EncounterVariantRef;
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
   * Where the watchers are on a given tick, IF NOTHING HAS HAPPENED.
   *
   * The authored patrol, walked on the container's clock. It must be a pure
   * function of tick and seed so a replayed attempt sees the same patrol, and
   * that purity is exactly why it cannot be the last word on where a watcher is:
   * a man who has been shouted at is not where the clock says he is. The
   * container steps `stepWatcherPursuit` against these anchors and hands the
   * result to the stealth field. See stealth/pursuit.ts.
   */
  watcherPosesAtTick(tick: number, seed: number): readonly WatcherPose[];
  /**
   * The bodies to draw for those watchers, or absent for a level that would
   * rather not show them.
   *
   * Absent used to be the only behaviour available and it was not a choice
   * anybody made: the level authored a rig per patrol — a constable for the
   * market watch, an officer at the gaol door — and the mission stage drew the
   * crowd, the player and no watchers at all. Seven cones swept a town nobody
   * was standing in, which is why "is anyone actually chasing me" was not
   * answerable by looking.
   */
  readonly watcherCast?: readonly MissionWatcherCast[];
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
  /**
   * Authored hard cover between the player and the nearest watcher.
   *
   * `watchers` is where those men are ACTUALLY standing this tick, after the
   * pursuit has moved whoever is coming. A level must measure against it rather
   * than against its own authored patrol: cover is geometry between two bodies,
   * and a screen computed from the post a constable left thirty metres ago is a
   * screen against nobody.
   */
  coveredAt?(
    read: MissionPlayerRead,
    watchers: readonly WatcherPose[],
  ): boolean;
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
  /**
   * The authored perspective encounters, with THIS attempt's variant already
   * chosen, or absent for a level with none.
   *
   * The level selects the variant per attempt (deterministically, from the
   * stored seed and ordinal) so the instance is the single source of which stop
   * asks what; the runtime builds a fresh `EncounterInstance` per attempt from
   * these, and the server grades the same item id the same selection produces.
   * Participation in every one of these is required to reach the duel — a WRONG
   * verdict still counts as participation, so a model outage cannot soft-lock
   * the route.
   */
  readonly encounters?: readonly MissionEncounterMount[];
  /** The duel this mission ends in. Handed to the duel view untouched. */
  readonly duel: MissionDuelBrief;
  /**
   * The level's own imported art, or null. Mounted inside the container's
   * canvas; the level owns every GLB, texture and fit in it.
   *
   * `dawn` is handed down because the clock is the container's and the lamps are
   * the level's: a level that lights its own streets has to know how much of the
   * night is left, and the alternative was a second clock inside the scenery
   * reading `performance.now()` — which is the one thing this whole module is
   * written to prevent. It is the same read the HUD and the stage sky get, on
   * the same tick.
   */
  readonly Scenery: ComponentType<{
    readonly reducedMotion: boolean;
    readonly dawn: DawnRead;
  }> | null;
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
