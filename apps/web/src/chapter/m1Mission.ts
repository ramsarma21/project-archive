import {
  ARENA,
  M1_EFFIGY_RUN,
  YARD,
  arenaPlacement,
  arenaWorld,
  civiliansAtTick,
  compileLevel,
  crowdExtents,
  duelQuestionsForAttempt,
  lightLevelAt,
  precisionBeatSpec,
  receivingTargetsOf,
  releaseCivilians,
  watcherIdsOf,
  watcherPosesAtTick,
} from "@pa/mission-m1";
import {
  M1_POST_OBJECTIVE_ID,
  beatObjective,
  isTerminalPrecisionFailure,
  type BeatOutcome,
  type BeatSpec,
} from "@pa/beat";
import { bossProfileForTier } from "@pa/duel";
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

function objectives(spec: BeatSpec, post: PostState): MissionObjective[] {
  const hay = nodePos("A_HAY");
  const elliotLip = nodePos("E_ELLIOT_LIP");
  const ropewalkDoor = nodePos("D2_DOOR");
  return [
    // Reaching the bough used to BE this objective: `within(read, post, 2, 1.2)`
    // meant the handbill was considered nailed up the moment the player arrived
    // at the tree, which made the mission's one skill expression optional
    // scenery. Now the sheet going up is what satisfies it, and the sheet going
    // up is the beat's outcome.
    beatObjective({
      id: M1_POST_OBJECTIVE_ID,
      label: "Nail the handbill to the Liberty Tree",
      spec,
      posted: () => post.outcome?.posted === true,
    }),
    {
      id: "reach-the-yard",
      label: "Get into the rope-walk yard",
      required: true,
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

function duelBrief(seed: number, attemptOrdinal: number): MissionDuelBrief {
  const placement = arenaPlacement();
  return {
    duelId: `${M1_EFFIGY_RUN.id}#duel@${attemptOrdinal}`,
    seed,
    rounds: ARENA.rounds,
    world: arenaWorld(),
    opponent: {
      kind: "BOSS",
      // Tier 1: M1 has one difficulty and it is the bottom of the curve.
      profile: bossProfileForTier(1, "BOS.MD01.BOSS.CONSTABLE"),
    },
    questions: duelQuestionsForAttempt(seed, attemptOrdinal),
    placement,
    conceptIds: [
      "BOS.CONCEPT.POSTWAR_REVENUE.v1",
      "BOS.CONCEPT.STAMP_SCOPE.v1",
      "BOS.CONCEPT.REPRESENTATION.v1",
    ],
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
  Scenery: MissionInstance["Scenery"];
}): MissionInstance {
  const compiled = compileLevel(M1_EFFIGY_RUN);
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
    objectives: objectives(beatSpec, post),
    beat,
    receivingTargets: receivingTargetsOf(M1_EFFIGY_RUN),
    watcherIds: watcherIdsOf(),
    watcherPosesAtTick: (tick, seed) => watcherPosesAtTick(tick, seed),
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

      const inFinalCourt = read.pos.x >= 74 && read.pos.x <= 88;
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
        Scenery: M1Scenery,
      });
    },
  };
}
