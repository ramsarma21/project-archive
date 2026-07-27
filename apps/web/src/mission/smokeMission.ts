import {
  platformFromRect,
  wallFromRect,
  type CollisionWorld,
  type WatcherPose,
} from "@pa/engine-world";
import type { MissionDuelBrief } from "./duelPort.js";
import type { MissionCivilian, MissionInstance } from "./levelPort.js";
import type { MissionDefinition } from "./missionFormat.js";

// ---------------------------------------------------------------------------
// A dev fixture, and a worked example of the level port.
//
// NOT REGISTERED, and not content. It exists for two reasons:
//
//   1. It makes the spine walkable before `@pa/mission-m1` registers itself, so
//      the container's canvas, input, HUD, teardown and result path can be
//      exercised by hand rather than only by its tests. Register it explicitly:
//
//        registerMission(smokeMissionDefinition("m1"));
//
//      and delete that call the moment the real level registers.
//
//   2. It is the shortest complete answer to "what does a MissionInstance have to
//      supply", which is more useful to a level author than the interface alone.
//
// It draws nothing. Its geometry is invisible collision — which the imported-world
// rule explicitly allows — and its `Scenery` is null, so the only thing on screen
// is the imported player rig. That is deliberate: a level is not allowed to fake
// its art with primitives, and neither is a fixture standing in for one.
//
// Its boss profile and questions are placeholders. Nothing reads them until a duel
// view registers, and by then the real level should own them.
// ---------------------------------------------------------------------------

const CORRIDOR_HALF_WIDTH = 7;
const CORRIDOR_LENGTH = 64;

/**
 * A straight run with things to get over: two vault-height crates, a mantle-height
 * ledge, and a raised deck reached by a climb. Enough for the flow reader to fire
 * every base verb it can fire on flat ground.
 */
function smokeWorld(): CollisionWorld {
  return {
    blockers: [
      wallFromRect("crate-a", 0, 14, 1.1, 0.6, { topY: 0.95, landable: true }),
      wallFromRect("crate-b", 1.8, 20, 1.1, 0.6, { topY: 0.95, landable: true }),
      wallFromRect("ledge", -1.4, 28, 2.4, 0.8, { topY: 1.7, landable: true }),
      wallFromRect("scaffold", 2.6, 36, 1.6, 1.6, { topY: 2.9, landable: true }),
      // Walls, so a player cannot simply run around the whole thing.
      wallFromRect("west-wall", -CORRIDOR_HALF_WIDTH, CORRIDOR_LENGTH / 2, 0.4, CORRIDOR_LENGTH / 2),
      wallFromRect("east-wall", CORRIDOR_HALF_WIDTH, CORRIDOR_LENGTH / 2, 0.4, CORRIDOR_LENGTH / 2),
    ],
    platforms: [
      platformFromRect("street", -CORRIDOR_HALF_WIDTH, CORRIDOR_HALF_WIDTH, -4, CORRIDOR_LENGTH, 0),
      platformFromRect("roof", 0.6, 5.4, 40, 52, 2.9, ["roof"]),
    ],
    bounds: { minX: -12, maxX: 12, minZ: -8, maxZ: CORRIDOR_LENGTH + 4 },
  };
}

/** One patrol, walked out and back, so the stealth field has something to do. */
function smokeWatchers(tick: number): readonly WatcherPose[] {
  const period = 60 * 16;
  const phase = (tick % period) / period;
  const along = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const z = 22 + along * 18;
  return [
    {
      id: "WATCH.constable",
      position: { x: 2.2, y: 0, z },
      baseYaw: phase < 0.5 ? 0 : Math.PI,
      halfAngleRad: (28 * Math.PI) / 180,
      rangeM: 10,
    },
  ];
}

/**
 * The market throng, and the three bodies that make a throw missable.
 *
 * Two jobs in one list, which is the point of there being one list. Five bodies in
 * the cluster is one above `crowdBlendMinDensity`, which is the whole requirement
 * for a full break — the blend rule reads density only as a floor and does not
 * scale strength above it. The other three stand between the player's line and the
 * far wall, so a throw aimed past them can be blocked by one, and the noise then
 * happens where the body is rather than where the wall is.
 */
const SMOKE_CIVILIANS: readonly MissionCivilian[] = [
  // The throng, around (0, 46), radius 3.
  { id: "civ-throng-1", clusterId: "dock-square", pos: { x: -0.9, y: 0, z: 45.2 }, capsuleHeight: 1.55, yaw: 0.4, rigKey: "playerboy-rigged", tint: "#b9a98d" },
  { id: "civ-throng-2", clusterId: "dock-square", pos: { x: 0.7, y: 0, z: 45.6 }, capsuleHeight: 1.55, yaw: 2.1, rigKey: "playerboy-rigged", tint: "#8e9a86" },
  { id: "civ-throng-3", clusterId: "dock-square", pos: { x: -0.2, y: 0, z: 46.8 }, capsuleHeight: 1.55, yaw: 3.4, rigKey: "playerboy-rigged", tint: "#a08e7a" },
  { id: "civ-throng-4", clusterId: "dock-square", pos: { x: 1.4, y: 0, z: 47.1 }, capsuleHeight: 1.55, yaw: 5.0, rigKey: "playerboy-rigged", tint: "#7f8b95" },
  { id: "civ-throng-5", clusterId: "dock-square", pos: { x: 0.1, y: 0, z: 44.4 }, capsuleHeight: 1.55, yaw: 1.2, rigKey: "playerboy-rigged", tint: "#94856f" },
  // The screen. Loose bodies, tagged to no cluster: they hide nobody, they only
  // get in the way of a badly aimed throw.
  { id: "civ-screen-1", clusterId: null, pos: { x: 0, y: 0, z: 9 }, capsuleHeight: 1.55, yaw: 3.1, rigKey: "playerboy-rigged", tint: "#9c9384" },
  { id: "civ-screen-2", clusterId: null, pos: { x: -1.1, y: 0, z: 9.6 }, capsuleHeight: 1.55, yaw: 3.0, rigKey: "playerboy-rigged" },
  { id: "civ-screen-3", clusterId: null, pos: { x: 1.2, y: 0, z: 9.4 }, capsuleHeight: 1.55, yaw: 3.2, rigKey: "playerboy-rigged" },
];

/** A placeholder brief. The real level authors the boss and the eighteen items. */
function smokeDuel(seed: number): MissionDuelBrief {
  return {
    duelId: `smoke-duel-${seed >>> 0}`,
    seed,
    rounds: 6,
    world: {
      blockers: [
        wallFromRect("arena-cover-a", -2.4, 0, 0.9, 0.5, { topY: 1.2, landable: true }),
        wallFromRect("arena-cover-b", 2.4, 2, 0.9, 0.5, { topY: 1.2, landable: true }),
      ],
      platforms: [platformFromRect("arena-floor", -9, 9, -9, 9, 0)],
      bounds: { minX: -9, maxX: 9, minZ: -9, maxZ: 9 },
    },
    // Placeholders. Shaped like @pa/duel's BossProfile so a view can read them,
    // and authored by nobody — a real mission supplies bossProfileForTier.
    opponent: {
      kind: "BOSS",
      profile: {
        bossId: "SMOKE.BOSS",
        tier: 1,
        maxHealth: 70,
        shotDamage: 8,
        fireIntervalTicks: 96,
        magazinePerRound: 2,
        ammoPolicy: "AUTHORED_FLAT",
        takesCoverBeforeQuestion: false,
        aimErrorRad: 0.24,
        leadFraction: 0.3,
        dodgeReactionTicks: 30,
        dodgeChance: 0.09,
        moveSpeedScale: 0.82,
        coverSeekHealthFraction: 0.4,
        strafePeriodTicks: 48,
      },
    },
    questions: Array.from({ length: 6 }, (_, index) => ({
      itemId: `SMOKE.ITEM.${index + 1}`,
      itemVersion: "v0",
      conceptId: "SMOKE.CONCEPT",
    })),
    placement: {
      A: { pos: { x: 0, y: 0, z: -4 }, yaw: 0 },
      B: { pos: { x: 0, y: 0, z: 4 }, yaw: Math.PI },
    },
    conceptIds: ["SMOKE.CONCEPT"],
  };
}

function smokeInstance(input: {
  missionId: string;
  attemptOrdinal: number;
  seed: number;
}): MissionInstance {
  const world = smokeWorld();
  return {
    missionId: input.missionId,
    attemptOrdinal: input.attemptOrdinal,
    world,
    spawn: { pos: { x: 0, y: 0, z: 0 }, yaw: 0 },
    briefing: {
      cueId: "SMOKE.CUE.INSERT",
      headline: "This is a fixture, not a mission.",
      lines: [
        "Run north. Get over what is in the way. The far end arms the duel.",
        "Nothing here is authored content and nothing is drawn: the geometry is invisible collision and the only art is your own rig.",
      ],
      targetSeconds: 6,
    },
    traversalBudgetS: 180,
    // Untimed, like a real mission: only the authored fail point and the duel end
    // an attempt.
    traversalTimeoutS: null,
    objectives: [
      {
        id: "reach-the-far-end",
        label: "Reach the far end",
        required: true,
        satisfiedBy: (read) => read.pos.z >= CORRIDOR_LENGTH - 8,
      },
      {
        id: "take-the-roof",
        label: "Take the roof line",
        required: false,
        satisfiedBy: (read) => read.pos.y > 2.5,
      },
    ],
    receivingTargets: [],
    watcherIds: ["WATCH.constable"],
    watcherPosesAtTick: (tick) => smokeWatchers(tick),
    // Extent only. The container counts who is standing in it, so this cannot
    // claim bodies that are not drawn.
    crowdClusters: [{ id: "dock-square", x: 0, z: 46, radiusM: 3 }],
    // Referentially stable: the crowd is stationary, so the container's density
    // count is done once rather than every tick.
    civiliansAtTick: () => SMOKE_CIVILIANS,
    // Being read costs position in a real mission; here it costs nothing, because
    // there is no authored route to close.
    failWhen: () => null,
    duel: smokeDuel(input.seed),
    Scenery: null,
    dispose: () => {
      // Nothing to free: the fixture allocates only plain objects. A real level
      // disposes its GLTF caches, its textures and anything it subscribed to.
    },
  };
}

/**
 * The fixture as a registrable mission. `baseXp` is a round number so the decay
 * schedule reads clearly while walking the loop: 120, then 80, then 40.
 */
export function smokeMissionDefinition(missionId: string): MissionDefinition {
  return {
    missionId,
    chapterId: "boston-1765",
    title: "Container smoke fixture",
    baseXp: 120,
    moduleId: "BOS.MD01.MODULE.BRIEF.v1",
    conceptIds: ["SMOKE.CONCEPT"],
    load: async (context) =>
      smokeInstance({
        missionId: context.missionId,
        attemptOrdinal: context.attemptOrdinal,
        seed: context.seed,
      }),
  };
}
