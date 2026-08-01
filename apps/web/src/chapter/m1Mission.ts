import {
  M1_EFFIGY_RUN,
  YARD,
  civiliansAtTick,
  compileLevel,
  coveredAtFor,
  createWayfinder,
  crowdExtents,
  duelQuestionsForAttempt,
  GOLDEN_GUIDED_LINE,
  LIBERTY_CORNER,
  m1DuelId,
  M1_ENCOUNTERS,
  selectEncounterVariant,
  lightLevelAt,
  precisionBeatSpec,
  receivingTargetsOf,
  releaseCivilians,
  watcherIdsOf,
  watcherPosesAtTick,
  type Wayfinder,
} from "@pa/mission-m1";
import {
  M1_POST_OBJECTIVE_ID,
  beatObjective,
  isTerminalPrecisionFailure,
  type BeatOutcome,
  type BeatSpec,
} from "@pa/beat";
import { M1_BOSS_TACTICS, bossProfileForTier } from "@pa/duel";
import type { MissionDuelBrief } from "../mission/duelPort.js";
import type {
  MissionBeatMount,
  MissionFailure,
  MissionInstance,
  MissionObjective,
  MissionPlayerRead,
} from "../mission/levelPort.js";
import type { MissionDefinition } from "../mission/missionFormat.js";

// ---------------------------------------------------------------------------
// M1 — The Effigy Run, as a mission the container can run.
//
// The level package owns the geometry, the patrols, the crowd and the arena.
// This file is only the translation into the container's port: it holds no
// coordinates of its own beyond reading them out of the authored route, because
// a number duplicated here is a number that can drift from the one the
// traversability tests verified.
// ---------------------------------------------------------------------------

const AMBIENT_LIGHT = 0.34;

/** Authored fail clock: seconds of confirmed alert in the final court. */
const FINAL_COURT_FAIL_SECONDS = 3;

function nodePos(id: string): { x: number; y: number; z: number } {
  const node = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id);
  if (!node) throw new Error(`M1 route has no node ${id}`);
  return { x: node.pos[0], y: node.pos[1], z: node.pos[2] };
}

function within(
  read: MissionPlayerRead,
  target: { x: number; y: number; z: number },
  radiusM: number,
  heightToleranceM = 1.5,
): boolean {
  return (
    Math.hypot(read.pos.x - target.x, read.pos.z - target.z) <= radiusM &&
    Math.abs(read.pos.y - target.y) <= heightToleranceM
  );
}

/**
 * The result of this attempt's beat, held for the two predicates that read it.
 *
 * One box per instance, and an instance is one attempt: a retry loads a fresh
 * level against a fresh seed rather than resetting this one, so nothing here can
 * leak into the next run. The container owns the run and the tick loop; this is
 * only where the answer lands.
 */
interface PostState {
  outcome: BeatOutcome | null;
  /** Latched when a burst is opened on Elliot's lip, facing the elm. */
  burstAtTheLip: boolean;
}

/**
 * Where the two required steps ARE, for the mark the run keeps live.
 *
 * Not a coordinate in sight, and that is the same discipline the rest of this
 * file holds to: the nail is the beat's own target and the gate is the route's
 * own node, so a mark cannot end up pointing at a tree the level moved. The
 * range is walked by the level's wayfinder rather than measured straight,
 * because the elm is 78m away and about 115m of route away, and the second
 * number is the one a player on a rooftop is actually spending.
 *
 * Titles name PLACES and details name the WORK. That split is deliberate: the
 * HUD already carries the instruction in the objective's own label, so a plate
 * eighty metres up the street repeating it would be the same sentence twice on
 * one screen. What the plate is for is saying which of the things out there is
 * the one — and the answer to that is a name.
 */
function marks(spec: BeatSpec, way: Wayfinder) {
  const gate = nodePos("G_GATE");
  const range = (toNodeId: string) => (from: MissionPlayerRead["pos"]) =>
    way.rangeTo(from, toNodeId);
  // The next place on the way, named by the section it is in. Section titles
  // are already written the way a person would say them — "The Town House",
  // "Dock Square", "The shambles" — so the leg names itself and no second list
  // of place names has to be kept in step with the route.
  const sectionTitle = new Map(
    M1_EFFIGY_RUN.sections.map((section) => [section.id, section.title]),
  );
  // The mark reads the committed waypoint (peek) and never moves it; the runtime
  // moves it once a tick through `advance`. Splitting the two is what makes the
  // HUD and the in-canvas mark pure readers of one guidance state rather than
  // two consumers fighting over it. See wayfind.ts and traversal's
  // `advanceWayfinding`.
  const peek = (toNodeId: string) => () => {
    const next = way.peekWaypoint(toNodeId);
    if (!next) return null;
    return {
      pos: { x: next.pos[0], y: next.pos[1], z: next.pos[2] },
      via: sectionTitle.get(next.section) ?? "the route",
    };
  };
  // The runtime hands the rich sample straight through; the wayfinder reads a
  // completed traversal off it to rejoin the route at the proven node.
  const advance =
    (toNodeId: string) =>
    (sample: Parameters<Wayfinder["advanceWaypoint"]>[0]) => {
      way.advanceWaypoint(sample, toNodeId);
    };
  // The authored pace of the current committed leg, for the runtime's speed cap.
  const speedCap =
    (toNodeId: string) => (from: MissionPlayerRead["pos"]) =>
      way.legSpeedCap(from, toNodeId);
  // The safe signal of the committed waypoint's directed gateway, if any — the
  // authored axis and the verb family, nothing more. Read off the committed
  // waypoint (peek), so it never moves the guidance.
  const gateway = (toNodeId: string) => () => {
    const g = way.peekWaypoint(toNodeId)?.gateway;
    if (!g) return null;
    return {
      axisX: g.axisX,
      axisZ: g.axisZ,
      phase: g.phase,
      allowedVerbs: g.allowedVerbs,
      riseM: g.riseM,
      kind: g.kind,
    };
  };
  return {
    post: {
      pos: { x: spec.target.x, y: spec.target.y, z: spec.target.z },
      title: "The Liberty Elm",
      detail: "Nail the handbill",
      rangeM: range(M1_EFFIGY_RUN.postNode),
      waypoint: peek(M1_EFFIGY_RUN.postNode),
      advance: advance(M1_EFFIGY_RUN.postNode),
      speedCapMps: speedCap(M1_EFFIGY_RUN.postNode),
      gateway: gateway(M1_EFFIGY_RUN.postNode),
    },
    yard: {
      pos: gate,
      title: "The rope-walk yard",
      detail: "In through the gate",
      rangeM: range(M1_EFFIGY_RUN.arenaNode),
      waypoint: peek(M1_EFFIGY_RUN.arenaNode),
      advance: advance(M1_EFFIGY_RUN.arenaNode),
      speedCapMps: speedCap(M1_EFFIGY_RUN.arenaNode),
      gateway: gateway(M1_EFFIGY_RUN.arenaNode),
    },
  };
}

function objectives(
  spec: BeatSpec,
  post: PostState,
  way: Wayfinder,
): MissionObjective[] {
  const hay = nodePos("A_HAY");
  const elliotLip = nodePos("E_ELLIOT_LIP");
  const ropewalkDoor = nodePos("D2_DOOR");
  const mark = marks(spec, way);
  return [
    // Reaching the bough used to BE this objective: `within(read, post, 2, 1.2)`
    // meant the handbill was considered nailed up the moment the player arrived
    // at the tree, which made the mission's one skill expression optional
    // scenery. Now the sheet going up is what satisfies it, and the sheet going
    // up is the beat's outcome.
    // Spread rather than passed in: `beatObjective` is @pa/beat's, and that
    // package declares the objective shape structurally so it can stay
    // importable from plain Node. Where a mark goes is the container's port and
    // the beat has no business knowing about it.
    {
      ...beatObjective({
        id: M1_POST_OBJECTIVE_ID,
        label: "Nail the handbill to the Liberty Tree",
        spec,
        posted: () => post.outcome?.posted === true,
      }),
      mark: mark.post,
    },
    {
      id: "reach-the-yard",
      label: "Get into the rope-walk yard",
      required: true,
      mark: mark.yard,
      satisfiedBy: (read) =>
        read.pos.x >= YARD.minX &&
        read.pos.x <= YARD.maxX &&
        read.pos.z >= YARD.minZ &&
        read.pos.z <= YARD.maxZ,
    },
    {
      id: "the-hay-dive",
      label: "Take the printshop corner rather than the stairs",
      required: false,
      satisfiedBy: (read) => within(read, hay, 2.2, 1) && read.elapsedS < 30,
    },
    {
      id: "the-leap-of-faith",
      label: "Reach the elm by air",
      required: false,
      satisfiedBy: (read) => read.verb === "LEAP_OF_FAITH",
    },
    /**
     * The burst, and the only place in the mission that asks for one.
     *
     * Two halves, because either alone would be cheap. The latch records a dash
     * opened on the approach to Elliot's lip; the objective is met when that
     * same run then finishes standing at the work. A running jump off that lip
     * carries 3.65m against a 4.71m gap and drops the player a tier onto the low
     * bough — which is where the FAST line goes anyway — so what is being
     * recognised here is the burst having actually bought the crown, not the key
     * having been pressed.
     */
    {
      id: "the-burst",
      label: "Take the crown straight off Elliot's roof",
      required: false,
      satisfiedBy: (read) => {
        if (read.verb === "DASH" && within(read, elliotLip, 3.2, 1.6)) {
          post.burstAtTheLip = true;
        }
        // Against the beat's own stance rather than a second point: what the
        // dash buys is arriving where the work is.
        return (
          post.burstAtTheLip && read.grounded && within(read, spec.stance, 2.6, 0.6)
        );
      },
    },
    {
      id: "the-quiet-way",
      label: "Go through the ropewalk instead of over it",
      required: false,
      satisfiedBy: (read) => within(read, ropewalkDoor, 2.5, 1.5),
    },
  ];
}

// Exported so a test can bind to the PRODUCTION brief rather than hand-copying it.
// The boss's ammo policy lives here, and a fixture that restates it instead of
// importing it is how the SYMMETRIC_COMPLEMENT opt-in went missing from the real
// mission path while a green suite reported the player's 7/14 either way.
export function duelBrief(seed: number, attemptOrdinal: number): MissionDuelBrief {
  return {
    duelId: m1DuelId(attemptOrdinal),
    seed,
    opponent: {
      kind: "BOSS",
      // Tier 1: M1 has one difficulty and it is the bottom of the curve.
      //
      // This is the mission's AUTHORITATIVE boss, and it must match the stand-alone
      // m1Duel.ts descriptor in full — all three opt-ins, not just the first.
      //
      // SYMMETRIC_COMPLEMENT, not the default flat magazine. M1's officer earns the
      // MIRROR of the player's award off the same graded round: a correct answer
      // arms him with 7 and a wrong one with 14 (complementaryBossBullets in
      // @pa/duel). Without it the real mission path fell back to AUTHORED_FLAT and
      // the boss was armed with a flat 7 EVERY round, so a wrong answer never armed
      // the enemy. See packages/duel/src/__tests__/pveComplement.test.ts.
      //
      // takesCoverBeforeQuestion + M1_BOSS_TACTICS, because the duel is now fought
      // in the shared rope-walk arena (see apps/web/src/duel/missionBrief.ts) whose
      // entire design is eight pieces of cover. Without these the officer stood in
      // the open in the middle of a cover-rich yard — the flat 7 bug's twin: the
      // stand-alone descriptor opted in and the mission did not, so the fight a
      // player actually fought ignored the arena. With them the officer breaks off
      // behind imported cover and crouches before each question, and fights to the
      // ammo-aware plan (armed he trades in the open, low he peeks from cover, out
      // of ammo he holds behind cover). The tactics are tuned against THIS arena —
      // it is the one the stand-alone descriptor was measured on — so they fit the
      // cover that is actually there. See @pa/duel bossAi.ts / bossTactics.test.ts.
      profile: bossProfileForTier(1, "BOS.MD01.BOSS.CONSTABLE", {
        ammoPolicy: "SYMMETRIC_COMPLEMENT",
        takesCoverBeforeQuestion: true,
        tactical: M1_BOSS_TACTICS,
      }),
    },
    questions: duelQuestionsForAttempt(seed, attemptOrdinal),
  };
}

/**
 * The instance, with its art injected rather than imported.
 *
 * The Scenery component pulls in three.js and the whole GLB loader, and the
 * level's data is worth checking without any of that — so the definition
 * supplies the component and a headless test supplies null. It also means
 * `missionInstanceDefects` can be run in CI on the real instance.
 */
export function m1Instance(input: {
  missionId: string;
  attemptOrdinal: number;
  seed: number;
  /**
   * The attempt's durable 128-bit seed hex. The perspective-encounter variant is
   * chosen from it (and the ordinal) by the same @pa/mission-m1 helper the server
   * grades with, so the stop the player sees and the item the server grades are
   * one selection. The floor harness has no durable hex and passes none; a stable
   * string derived from the numeric seed keeps the harness deterministic.
   */
  attemptSeedHex?: string;
  /**
   * Which links guidance may walk. Omit it in production: it defaults to the one
   * canonical covert line, and `createWayfinder` PRUNES the graph to exactly that
   * line's links (wayfind.ts), which is the whole point — the mark can then only
   * lead along the sheds and canopies.
   *
   * The consequence, which cost thirteen tests: a body standing on a node that is
   * not on the line has NO links in the graph, so no leg can commit there. No
   * gateway arms, no vault or climb is offered, and `legSpeedCap` returns null.
   * The authored side routes (the ropewalk tie beam and hemp descent, the Dock
   * Square goods vault, the gaol barrels, the tower's east face) are all still
   * authored and still playable — guidance simply no longer detours through them.
   *
   * So a test that deliberately drives one of those legs passes `null` to get the
   * full authored SAFE graph back. That is a HARNESS setting, not a behaviour
   * change: it must never be null on a path a player reaches.
   */
  guidedLine?: readonly string[] | null;
  Scenery: MissionInstance["Scenery"];
}): MissionInstance {
  const attemptSeedHex = input.attemptSeedHex ?? `floor-${input.seed >>> 0}`;
  const guidedLine =
    input.guidedLine === undefined ? GOLDEN_GUIDED_LINE : input.guidedLine;
  const compiled = compileLevel(M1_EFFIGY_RUN);
  // Bound once per attempt, because the patrol phase is drawn from the seed and
  // the predicate closes over it. See `coveredAtFor`.
  const covered = coveredAtFor(input.seed, compiled);
  const start = nodePos("A_START");
  const sheets = nodePos("A_SHEETS");

  // The beat's geometry is the level's own `PRECISION` block, handed through
  // @pa/mission-m1 rather than restated here, so there is one bough.
  const beatSpec = precisionBeatSpec();
  const post: PostState = { outcome: null, burstAtTheLip: false };
  const beat: MissionBeatMount = {
    spec: beatSpec,
    onResolved: (outcome) => {
      post.outcome = outcome;
    },
  };

  return {
    missionId: input.missionId,
    attemptOrdinal: input.attemptOrdinal,
    world: compiled.world,
    spawn: {
      pos: start,
      // Facing the drying rack, which is the first thing to run through.
      yaw: Math.atan2(sheets.x - start.x, sheets.z - start.z),
    },
    briefing: {
      cueId: "BOS.MD01.CUE.HANDOFF.v1",
      headline: "Queen Street, before dawn. 14 August 1765.",
      lines: [
        "They hung Oliver's effigy in the elm at Essex and Orange overnight, and the sheriff has been told to cut it down.",
        "The sheets on the rack behind you are unstamped. Get one onto the tree before the constable reaches the board.",
      ],
      targetSeconds: 10,
    },
    traversalBudgetS: M1_EFFIGY_RUN.missionClockS,
    // Untimed by design: §4.11 lists three ways to lose an attempt and running
    // out of clock is not one of them. The 180 seconds are a pacing budget.
    traversalTimeoutS: null,
    // First run is guided down the SAFE line only — the one whose promise is
    // "always goes" — so a player who has been taught nothing is not aimed at a
    // FAST or EXPERT shortcut that assumes reads they do not have yet. A retry
    // has seen the run and gets the shortest guidance every authored line can
    // find. The distance on the plate is measured over every line regardless;
    // only which way the mark points narrows. See WayfinderOptions.
    objectives: objectives(
      beatSpec,
      post,
      // ONE ROUTE. Owner: "all i want is one real route in m1." Guidance and the
      // visor (which draws off the wayfinder's committed path) always point at the
      // single canopy/rooftop SAFE line, on every attempt — never widening to the
      // FAST/EXPERT branches. A retry no longer gets alternate marks; there is one
      // canonical route and the mission is guided down exactly it. The FAST/EXPERT
      // route DATA and the multi-line wayfinder machinery are retired separately
      // (they are inert once nothing ever guides along them); see the report.
      createWayfinder(M1_EFFIGY_RUN, {
        guidanceLines: ["SAFE"],
        // Pin the mark to the authored covert line, not the cheapest SAFE path:
        // the retired ground street through the Shambles is shorter and was
        // leading the player down onto the open market floor. The guided line
        // stays on the sheds and canopies and touches the cobbles only at the
        // authored drop-to-contact. See WayfinderOptions.guidedLine.
        ...(guidedLine ? { guidedLine } : {}),
      }),
    ),
    beat,
    receivingTargets: receivingTargetsOf(M1_EFFIGY_RUN),
    watcherIds: watcherIdsOf(),
    watcherPosesAtTick: (tick, seed) => watcherPosesAtTick(tick, seed),
    // The seven men, as bodies. The level has always authored a rig and a height
    // per patrol and nothing was ever asked for them, so the mission ran with
    // seven invisible cones sweeping an empty town.
    watcherCast: M1_EFFIGY_RUN.patrols.map((patrol) => ({
      id: patrol.id,
      rigKey: patrol.asset,
      capsuleHeight: patrol.capsuleHeightM,
      role: patrol.role,
    })),
    crowdClusters: crowdExtents(),
    civiliansAtTick: (tick, seed) =>
      civiliansAtTick(tick, seed, M1_EFFIGY_RUN, compiled),
    lightLevelAt: (read) =>
      lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, read.pos.x, read.pos.z),
    // Inside the arcade or the ropewalk the body is broken up by piers and
    // tackle even when nothing is between it and a watcher.
    exposureAt: (read) =>
      lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, read.pos.x, read.pos.z) < 0.15
        ? "PARTIAL"
        : "EXPOSED",
    // Hard cover, against the men as they actually stand. `coverPredicate` and
    // its whole suite have existed since the screens were authored and nothing
    // called them, so the container read `?? false` and every cart, barrel and
    // stall pier in the level was worth nothing to hide behind. It matters more
    // now than it did: a watcher walking toward you is a thing you break sight
    // with, and until this line there was nothing to break it behind.
    coveredAt: (read, watchers) => covered(read, watchers),
    /**
     * The two authored fail points. §4.11 lists three ways to lose an attempt
     * and this level owns two of them: the final court in front of the post, and
     * a torn sheet. Being read anywhere else costs position, not the attempt —
     * that is the whole reason there are three ways off the balcony and two ways
     * across Dock Square.
     */
    failWhen: (read, field): MissionFailure | null => {
      // A torn sheet is terminal. An ABANDONED run is not: the player stepped
      // off the bough with the work undone and may come back to it, and
      // `isTerminalPrecisionFailure` is the function that knows the difference
      // so that no caller has to remember it.
      if (post.outcome && isTerminalPrecisionFailure(post.outcome)) {
        return {
          code: "PRECISION_TORN",
          cueId: "BOS.MD01.CUE.POST_TORN.v1",
          headline: "The sheet tore off the tacks.",
          detail:
            "Half the strokes went wide and the last one split the paper. What is left on the bole is not a handbill anybody in Orange Street will read, and there is no second sheet.",
        };
      }

      // Containment in the elm's own corner, in BOTH axes. An x-only band ran the
      // whole width of the level at every z, so a body alerted on the ropewalk tie
      // beam at z≈21 read as "in front of the post" and could be failed there. The
      // corner is `LIBERTY_CORNER`; the y ceiling and the alert clock are unchanged.
      const inFinalCourt =
        read.pos.x >= LIBERTY_CORNER.minX &&
        read.pos.x <= LIBERTY_CORNER.maxX &&
        read.pos.z >= LIBERTY_CORNER.minZ &&
        read.pos.z <= LIBERTY_CORNER.maxZ;
      const alreadyUpTheTree = read.pos.y >= 6;
      if (!inFinalCourt || alreadyUpTheTree) return null;
      if (field.squadState !== "ALERTED") return null;
      if (field.alertedTicks < FINAL_COURT_FAIL_SECONDS * 60) return null;
      return {
        code: "FINAL_COURT_CONFRONTATION",
        cueId: "BOS.MD01.CUE.POST_LOST.v1",
        headline: "The constable reached the board first.",
        detail:
          "Held in the open under the elm with the crowd watching, there was no way onto the tree. The handbill never went up.",
      };
    },
    // The two forced perspective encounters, with THIS attempt's variant chosen
    // deterministically from the durable seed and ordinal. The runtime builds a
    // fresh machine per attempt; the server recomputes the same item id.
    encounters: M1_ENCOUNTERS.map((def) => ({
      def,
      variant: selectEncounterVariant(def, attemptSeedHex, input.attemptOrdinal),
    })),
    duel: duelBrief(input.seed, input.attemptOrdinal),
    Scenery: input.Scenery,
    dispose: () => {
      releaseCivilians(input.seed, M1_EFFIGY_RUN);
    },
  };
}

export const M1_MISSION_ID = "PA.SEA01.CH02.BOSTON.MD01";

export function m1MissionDefinition(): MissionDefinition {
  return {
    missionId: M1_MISSION_ID,
    chapterId: "boston-1765",
    title: "Nailed to the Post",
    baseXp: 120,
    moduleId: "BOS.MD01.MODULE.v1",
    conceptIds: [
      "BOS.CONCEPT.POSTWAR_REVENUE.v1",
      "BOS.CONCEPT.STAMP_SCOPE.v1",
      "BOS.CONCEPT.REPRESENTATION.v1",
    ],
    load: async (context) => {
      // Code-split, so the hub does not pay for M1's art until it deploys.
      const { M1Scenery } = await import("./M1Scenery.js");
      return m1Instance({
        missionId: context.missionId,
        attemptOrdinal: context.attemptOrdinal,
        seed: context.seed,
        attemptSeedHex: context.seedHex,
        Scenery: M1Scenery,
      });
    },
  };
}
