// What the mission container needs from this level, in the container's shapes.
//
// The container owns the clock, the RNG and the attempt; the level owns its
// geometry, its patrols, its crowd and its arena. This file is the translation,
// and it is deliberately in the level package rather than in the app: the app
// should be able to register a mission without knowing how that mission decides
// where its watchers are.
//
// Two contracts matter here and both are about determinism. Patrol poses and
// civilian positions must be pure functions of tick and seed, because a replay
// has to see the same patrol and the same crowd. And the crowd must be a list
// of real bodies, because the container counts blend density from the bodies
// actually standing inside a cluster rather than from an authored number that
// could disagree with what is on screen.

import type { CollisionWorld, Vec3 } from "@pa/engine-world/collision";
import { positionClear, platformFromRect, CAPSULE_RADIUS, CROUCH_HEIGHT, STAND_HEIGHT } from "@pa/engine-world/collision";
import { fieldRandom, projectFieldSeed } from "@pa/engine-world/fieldSimulation";
import type { WatcherPose } from "@pa/engine-world/stealth";
import { ASSETS } from "./assets.js";
import { compileLevel, type CompiledLevel } from "./compile.js";
import { coverPredicate, type CoverRead } from "./cover.js";
import { patrolPoseAt } from "./stealth.js";
import { M1_EFFIGY_RUN } from "./level/index.js";
import { ARENA } from "./level/duelArena.js";
import { GROUND, GROUND_SURFACE, groundPlateY } from "./level/ground.js";
import { CROWD_CIVILIANS } from "./level/opposition.js";
import type { MissionLevel, Rect, Vec3Tuple } from "./types.js";

// ---------------------------------------------------------------------------
// watchers
// ---------------------------------------------------------------------------

/**
 * Which authored patrol phase this attempt runs. §4.13 wants at least three
 * arrangements seeded from the attempt; the container's seed picks one, and the
 * same seed always picks the same one.
 */
export function patrolPhaseIndex(
  seed: number,
  patrolId: string,
  phases: number,
): number {
  if (phases <= 1) return 0;
  return Math.floor(
    fieldRandom(seed, 0, projectFieldSeed([patrolId]) & 0xffff) * phases,
  ) % phases;
}

export function watcherIdsOf(level: MissionLevel = M1_EFFIGY_RUN): string[] {
  return level.patrols.map((patrol) => patrol.id);
}

/**
 * Where every watcher is on a given tick. Patrol movement belongs to the level
 * — the stealth field deliberately moves nobody — so this is the level walking
 * its own authored routes on the container's clock.
 */
export function watcherPosesAtTick(
  tick: number,
  seed: number,
  level: MissionLevel = M1_EFFIGY_RUN,
): WatcherPose[] {
  return level.patrols.map((patrol) => {
    const phase = patrolPhaseIndex(seed, patrol.id, patrol.phaseOffsetsS.length);
    const pose = patrolPoseAt(patrol, tick, phase);
    return {
      id: patrol.id,
      position: pose.position,
      baseYaw: pose.yaw,
      capsuleHeight: patrol.capsuleHeightM,
      halfAngleRad: (patrol.coneHalfAngleDeg * Math.PI) / 180,
      rangeM: patrol.rangeM,
      ignore: new Set(patrol.perchIgnore),
    };
  });
}

// ---------------------------------------------------------------------------
// hard cover
// ---------------------------------------------------------------------------

/**
 * The level's answer to `MissionInstance.coveredAt`, bound to one attempt.
 *
 * Same shape and same lifetime as `watcherPosesAtTick` and `civiliansAtTick`
 * above: a pure function of a player read, with the attempt's seed closed over
 * because the patrol phase is drawn from it. The container's own
 * `MissionPlayerRead` satisfies the argument structurally — position, live
 * capsule height and tick are all it reads — so binding it is
 *
 *   coveredAt: coveredAtFor(input.seed, compiled),
 *
 * and no adapter. Until something binds it the container reads `?? false` and
 * every screen in the level is worth exactly nothing, which is the state this
 * function exists to end.
 *
 * It takes the LIVE watcher poses as a second argument now, and a caller that
 * has them must pass them. Cover is a question about geometry between two
 * bodies, so a watcher who has walked off his post to come and look must be
 * measured from where he is standing; against the mark he left, a player could
 * claim a screen from a man who is beside them.
 */
export function coveredAtFor(
  seed: number,
  compiled?: CompiledLevel,
  level: MissionLevel = M1_EFFIGY_RUN,
): (read: CoverRead, livePoses?: readonly WatcherPose[]) => boolean {
  return coverPredicate(compiled ?? compileLevel(level), seed, level);
}

// ---------------------------------------------------------------------------
// the crowd
// ---------------------------------------------------------------------------

export interface LevelCivilian {
  id: string;
  clusterId: string | null;
  pos: Vec3;
  capsuleHeight: number;
  yaw: number;
  rigKey: string;
  tint?: string;
}

/** A handful of rigs, tinted, so twelve bodies read as more than twelve. */
const CIVILIAN_RIGS = [
  "townsman-rigged",
  "townswoman-rigged",
  "dockhand-rigged",
  "goodwife-rigged",
  "agitator-rigged",
] as const;

const CIVILIAN_TINTS = [
  "#8d7c63",
  "#6f6552",
  "#9a8b74",
  "#7a6a55",
  "#5f5647",
  "#a1927b",
] as const;

/**
 * Bodies for one cluster, placed deterministically inside its radius and clear
 * of the level's own geometry.
 *
 * Placement walks outward from a seeded angle until the capsule fits, so a
 * civilian never ends up inside a cart — a body inside a collider would be
 * counted for blending and unreachable by a thrown object, which is exactly the
 * kind of silent disagreement this whole port exists to avoid.
 */
function placeCluster(
  compiled: CompiledLevel,
  clusterId: string,
  centre: Vec3Tuple,
  radiusM: number,
  count: number,
  seed: number,
): LevelCivilian[] {
  const salt = projectFieldSeed([clusterId]) & 0xffff;
  const bodies: LevelCivilian[] = [];
  for (let index = 0; index < count; index++) {
    const angle = fieldRandom(seed, index * 3 + 1, salt) * Math.PI * 2;
    // sqrt keeps the disc evenly filled instead of bunching at the centre.
    const baseRadius =
      Math.sqrt(fieldRandom(seed, index * 3 + 2, salt)) * (radiusM - 0.6);
    let pos: Vec3 | null = null;
    for (let attempt = 0; attempt < 12 && pos === null; attempt++) {
      const spin = angle + attempt * 0.62;
      const reach = Math.min(radiusM - 0.5, baseRadius + attempt * 0.28);
      const candidate: Vec3 = {
        x: centre[0] + Math.cos(spin) * reach,
        y: centre[1],
        z: centre[2] + Math.sin(spin) * reach,
      };
      if (
        positionClear(compiled.world, candidate, CAPSULE_RADIUS, STAND_HEIGHT)
      ) {
        pos = candidate;
      }
    }
    if (!pos) continue;
    const stooped = fieldRandom(seed, index * 3 + 3, salt) < 0.18;
    bodies.push({
      id: `${clusterId}.${index}`,
      clusterId,
      pos,
      capsuleHeight: stooped ? CROUCH_HEIGHT : STAND_HEIGHT,
      yaw: fieldRandom(seed, index * 7 + 5, salt) * Math.PI * 2,
      rigKey: CIVILIAN_RIGS[index % CIVILIAN_RIGS.length]!,
      tint: CIVILIAN_TINTS[(index * 5 + salt) % CIVILIAN_TINTS.length]!,
    });
  }
  return bodies;
}

const civilianCache = new Map<string, LevelCivilian[]>();

/**
 * Every civilian body, for a seed.
 *
 * The crowds are standing rather than walking, so this returns the SAME array
 * for every tick of an attempt. That is not laziness: the container derives
 * cluster density from array identity and will not recount an unchanged list,
 * so a stable reference is the difference between counting twelve bodies once
 * and counting them sixty times a second.
 */
export function civiliansAtTick(
  _tick: number,
  seed: number,
  level: MissionLevel = M1_EFFIGY_RUN,
  compiled?: CompiledLevel,
): LevelCivilian[] {
  const key = `${level.id}:${seed >>> 0}`;
  const cached = civilianCache.get(key);
  if (cached) return cached;
  const built = compiled ?? compileLevel(level);
  const bodies = level.blend.flatMap((volume) =>
    placeCluster(
      built,
      volume.id,
      volume.centre,
      volume.radiusM,
      volume.civilians,
      seed,
    ),
  );
  civilianCache.set(key, bodies);
  return bodies;
}

/** Frees the memoised crowd for one attempt. Called from `dispose`. */
export function releaseCivilians(seed: number, level: MissionLevel = M1_EFFIGY_RUN): void {
  civilianCache.delete(`${level.id}:${seed >>> 0}`);
}

/** Extent only. The container counts who is standing in it. */
export function crowdExtents(level: MissionLevel = M1_EFFIGY_RUN): Array<{
  id: string;
  x: number;
  z: number;
  radiusM: number;
}> {
  return level.blend.map((volume) => ({
    id: volume.id,
    x: volume.centre[0],
    z: volume.centre[2],
    radiusM: volume.radiusM,
  }));
}

export { CROWD_CIVILIANS };

// ---------------------------------------------------------------------------
// the duel arena
// ---------------------------------------------------------------------------

/**
 * The rope-walk yard as a world of its own.
 *
 * Same coordinates as the floor, so the arena the player dropped into is
 * literally the arena they fight in and the break stations keep their authored
 * positions. Everything outside the yard is dropped: the duel does not need
 * Boston, and a boss pathing around the Town House would be a bug nobody could
 * see.
 */
export function arenaWorld(level: MissionLevel = M1_EFFIGY_RUN): CollisionWorld {
  const compiled = compileLevel(level);
  const inYard = (rect: { minX: number; maxX: number; minZ: number; maxZ: number }) =>
    rect.maxX >= ARENA.bounds.minX - 1 &&
    rect.minX <= ARENA.bounds.maxX + 1 &&
    rect.maxZ >= ARENA.bounds.minZ - 1 &&
    rect.minZ <= ARENA.bounds.maxZ + 1;
  return {
    blockers: compiled.world.blockers.filter((blocker) =>
      inYard({
        minX: blocker.minX,
        maxX: blocker.maxX,
        minZ: blocker.minZ,
        maxZ: blocker.maxZ,
      }),
    ),
    platforms: [
      platformFromRect(
        "YARD_FLOOR",
        ARENA.bounds.minX,
        ARENA.bounds.maxX,
        ARENA.bounds.minZ,
        ARENA.bounds.maxZ,
        ARENA.floorY,
      ),
      ...compiled.world.platforms.filter((platform) =>
        inYard({
          minX: platform.minX,
          maxX: platform.maxX,
          minZ: platform.minZ,
          maxZ: platform.maxZ,
        }),
      ),
    ],
    bounds: {
      minX: ARENA.bounds.minX,
      maxX: ARENA.bounds.maxX,
      minZ: ARENA.bounds.minZ,
      maxZ: ARENA.bounds.maxZ,
    },
  };
}

export function arenaPlacement(): {
  A: { pos: Vec3; yaw: number };
  B: { pos: Vec3; yaw: number };
} {
  const player = ARENA.playerSpawn;
  const boss = ARENA.bossSpawn;
  return {
    A: {
      pos: { x: player[0], y: player[1], z: player[2] },
      yaw: Math.atan2(boss[0] - player[0], boss[2] - player[2]),
    },
    B: {
      pos: { x: boss[0], y: boss[1], z: boss[2] },
      yaw: Math.atan2(player[0] - boss[0], player[2] - boss[2]),
    },
  };
}

// ---------------------------------------------------------------------------
// the ground
// ---------------------------------------------------------------------------

/**
 * One plate of visible ground, resolved to the renderer's shape.
 *
 * The same division as `sceneryPlacements`: the level says which surface goes
 * where, and this is the one place that turns a surface kind into a material and
 * a stacking order into a height. A renderer that had to know that the street is
 * cobbled and sits above the square would be a second copy of the level.
 */
export interface GroundPlacement {
  readonly id: string;
  readonly texturePath: string;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly tileM: number;
  readonly grain: "X" | "Z";
  readonly y: number;
}

/** Every ground plate, bottom first. Order is the layering; see `ground.ts`. */
export function groundPlacements(): GroundPlacement[] {
  return GROUND.map((plate, index) => {
    const surface = GROUND_SURFACE[plate.surface];
    return {
      id: plate.id,
      texturePath: surface.texturePath,
      minX: plate.rect.minX,
      maxX: plate.rect.maxX,
      minZ: plate.rect.minZ,
      maxZ: plate.rect.maxZ,
      tileM: surface.tileM,
      grain: surface.grain,
      y: groundPlateY(index),
    };
  });
}

// ---------------------------------------------------------------------------
// scenery
// ---------------------------------------------------------------------------

export interface SceneryPlacement {
  id: string;
  /** Stable art key; see assets.ts. */
  asset: string;
  /** Where the file is, under the served world root. Declared, never guessed. */
  assetPath: string;
  /** Centre, at the base of the object. */
  pos: Vec3Tuple;
  /** Box the GLB is fitted into. */
  size: Vec3Tuple;
  yaw: number;
  /**
   * Lean, in radians, about the object's own local X axis, applied at its foot
   * AFTER yaw: `place = T(pos) · Ry(yaw) · Rx(pitch)`. Zero for every ordinary
   * upright prop — only a leaning ladder uses it. A yaw-only scenery model draws
   * every ladder bolt upright and fakes the lean inside the mesh, which is how a
   * leaning ladder came to read as a free-standing trestle; a real lean is a
   * rotation, so the model carries one.
   */
  pitch?: number;
  /** Decks sit at their surface; masses sit on their base. */
  kind: "MASS" | "DECK";
  /**
   * How the GLB meets its box. A prop keeps its own proportions and is fitted
   * inside; a structural shell is a module built to be stretched to the room it
   * encloses, and is scaled per axis onto the box exactly. A module is one tile
   * of a run — see MODULE_RUNS — and its box has already been sized to it, so it
   * fills the box rather than fitting inside it.
   */
  fit: "PROP" | "SHELL" | "MODULE";
  /** Every collision entry this one draw stands for. */
  parts: string[];
}

/** A deck is a surface, not a volume. This is how thick its dressing is drawn. */
const DECK_THICKNESS_M = 0.35;

/** A mass with no top is a full-height wall; it is drawn this tall. */
const OPEN_MASS_HEIGHT_M = 12;

/**
 * How far apart two pieces of one object may sit vertically and still be one
 * object: a step. Enough for a tower resting on the roof it rises out of, and
 * for a ring ledge that clears by half a metre the mass carrying it.
 */
const STACK_GAP_M = 0.6;

const EPSILON = 1e-6;

interface ScenerySpan {
  id: string;
  kind: "MASS" | "DECK";
  asset: string;
  rect: Rect;
  minY: number;
  maxY: number;
  yaw: number;
  carriedBy: readonly string[];
}

function overlapsInPlan(a: Rect, b: Rect): boolean {
  return (
    Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > EPSILON &&
    Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > EPSILON
  );
}

function sameFootprint(a: Rect, b: Rect): boolean {
  return (
    Math.abs(a.minX - b.minX) < EPSILON &&
    Math.abs(a.maxX - b.maxX) < EPSILON &&
    Math.abs(a.minZ - b.minZ) < EPSILON &&
    Math.abs(a.maxZ - b.maxZ) < EPSILON
  );
}

/** Do these two spans touch, or come within a step of touching, in height? */
function stacked(a: ScenerySpan, b: ScenerySpan): boolean {
  return Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) <= STACK_GAP_M + EPSILON;
}

/**
 * Is `solid` a soffit over `surface` — a piece of stone standing clear above a
 * floor the same body carries?
 *
 * A soffit rests on nothing, which is what makes it invisible to `stacked`. The
 * Town House's pedimented centre bay is a half-metre slab at 7.30m over a
 * balcony at 5.60m: head height, not a step, so the two never met and the hood
 * became an object of its own — one more contain-fitted draw of the whole Town
 * House, squeezed into 3.6 x 0.5 x 2.6m, a doll's house hanging beside the real
 * building at eye level over the balcony it was meant to shelter.
 *
 * `carriedBy` is what makes this safe to state generally. A surface that names a
 * carrier is a floor OF a body, so a solid of the same asset standing over it is
 * that body's own stonework. A surface that names nobody is a free-standing
 * awning, and a solid over one of those is a second awning — which is exactly
 * the case the author of `oneObject` excluded on purpose, and it stays excluded.
 */
function soffitOver(solid: ScenerySpan, surface: ScenerySpan): boolean {
  return (
    solid.kind === "MASS" &&
    surface.kind === "DECK" &&
    surface.carriedBy.length > 0 &&
    solid.minY >= surface.maxY - EPSILON &&
    overlapsInPlan(solid.rect, surface.rect)
  );
}

/**
 * Are these two collision entries pieces of one physical object?
 *
 * Both already name the same asset; the question is whether that is one object
 * described in parts or two instances of the same prop standing apart. Four
 * relations say "one object", and each is authored rather than guessed:
 *
 *   - a deck names, in `carriedBy`, a mass of the same asset. That is the
 *     format's own statement that the surface belongs to that body: the three
 *     boughs are carried by the elm's bole.
 *   - a solid interpenetrates another piece in plan and stacks against it in
 *     height. Two walls meeting at a corner, a tower on the mass it rises from,
 *     a roof lying on the walls that hold it up.
 *   - a solid stands clear above a carried surface: see `soffitOver`. This is
 *     the only relation that spans a gap, because a soffit is the only piece
 *     that rests on nothing.
 *   - two surfaces with no solid anywhere in the object share a footprint
 *     exactly: staging at two heights on one scaffold.
 *
 * Deliberately NOT a relation: two surfaces that merely overlap in plan. A stall
 * canopy at 2.55m passes under a shed pentice at 3.10m, and they are two awnings
 * on two buildings, not one awning.
 */
function oneObject(a: ScenerySpan, b: ScenerySpan): boolean {
  if (a.kind === "DECK" && b.kind === "MASS" && a.carriedBy.includes(b.id)) return true;
  if (b.kind === "DECK" && a.kind === "MASS" && b.carriedBy.includes(a.id)) return true;
  if (soffitOver(a, b) || soffitOver(b, a)) return true;
  if (a.kind === "MASS" || b.kind === "MASS") {
    return overlapsInPlan(a.rect, b.rect) && stacked(a, b);
  }
  return sameFootprint(a.rect, b.rect);
}

/**
 * Groups one asset's entries into objects. A part can bridge two groups that
 * had not met yet — the ropewalk's south wall is what tells the east wall and
 * the west wall they are the same shed — so joining merges rather than picks.
 */
function clusterSpans(spans: ScenerySpan[]): ScenerySpan[][] {
  const clusters: ScenerySpan[][] = [];
  for (const span of spans) {
    const joins: number[] = [];
    for (let index = 0; index < clusters.length; index++) {
      if (clusters[index]!.some((member) => oneObject(span, member))) joins.push(index);
    }
    const [home, ...bridged] = joins;
    if (home === undefined) {
      clusters.push([span]);
      continue;
    }
    clusters[home]!.push(span);
    for (const index of bridged.reverse()) {
      clusters[home]!.push(...clusters[index]!);
      clusters.splice(index, 1);
    }
  }
  return clusters;
}

function unionRect(rects: Rect[]): Rect {
  return {
    minX: Math.min(...rects.map((r) => r.minX)),
    maxX: Math.max(...rects.map((r) => r.maxX)),
    minZ: Math.min(...rects.map((r) => r.minZ)),
    maxZ: Math.max(...rects.map((r) => r.maxZ)),
  };
}

const ASSET_BY_KEY = new Map(ASSETS.map((asset) => [asset.key, asset]));

// ---------------------------------------------------------------------------
// module runs
// ---------------------------------------------------------------------------

/**
 * Assets that are a LENGTH of something rather than one object.
 *
 * A contain-fit takes the smallest of the three box/mesh ratios, and for these
 * the smallest is always the thin axis of a collision slab. A wall module fitted
 * into a 0.6m-thick blocker draws 27cm of a 3.6m wall; an awning fitted into a
 * deck's 0.35m of notional thickness draws 43cm of a 5.6m pentice. No arithmetic
 * on one box recovers the object, because the box is not the object's shape — it
 * is the shape of the part a player can touch.
 *
 * The answer is the one already shipped for the duel yard in `arenaSpec.ts`:
 * scale the module by the ONE dimension that is real, keep the mesh's own
 * proportions for the rest, and tile it along the run. `stance` says which
 * dimension is real, and it is a statement about the object, not about the box:
 *
 *   SOLID    the blocker IS the wall. Base and top are both authored, and the
 *            module is drawn only as deep as its blocker so the stone a ball
 *            stops against is the stone you can see. Tiled along the run: a wall,
 *            a fence, a rope-laying floor is a REPEAT of one section.
 *   BLOCK    one discrete object that fills its whole blocker — a crate stack, a
 *            loaded cart, a bale block, a tie beam. Same scale rule as SOLID but
 *            never tiled: it is a single thing, not a run, so splitting it into
 *            two instances only invents a seam down its middle that the support
 *            probe then reads as a crack. Drawn as one fitted instance.
 *   CANOPY   a roof on posts. The collision is the roof; the posts stand on the
 *            street, so the module is as tall as the surface is high. Every
 *            canopy in this level stands on ground at y=0; one over a raised
 *            floor would need the floor's height rather than zero.
 *   WALKWAY  boards with rope rails. The collision is the boards, and the boards
 *            are in the MIDDLE of the module: rails stand above them and the
 *            beam or the hangers carrying them hang below. So neither end of the
 *            box is the plane the player walks on, and `deckAtM` is the only
 *            thing that says where it is — see there.
 *   ROW      one house of a terrace. Every dimension of the blocker is real —
 *            it is a town block, and the player is stopped by all four of its
 *            walls and lands on its roof — but the block is not the shape of one
 *            house, so no single scale can be right. See `rowPlacements`.
 *
 * Tiling matters as much as the scale. Two tiles of a 13.2m wall are each within
 * 20% of the module's own aspect; one stretched copy is 66% off, and that is the
 * difference between courses of stone and a smear.
 *
 * `naturalM` is the exported bounding size in metres, measured off the GLB's
 * POSITION accessors. Meshy normalises to roughly two units on the longest axis,
 * so none of it is a real-world dimension until it is fitted.
 */
export interface ModuleRun {
  naturalM: Vec3Tuple;
  stance: "SOLID" | "BLOCK" | "CANOPY" | "WALKWAY" | "ROW";
  /** WALKWAY only: real length of one module. */
  moduleLengthM?: number;
  /**
   * WALKWAY only: how far up the module its walking surface is, in the same
   * natural units as `naturalM`.
   *
   * Measured off the mesh, like `naturalM`, and for the same reason: it is the
   * one fact about a walkway that no box can carry. A SOLID fills its blocker and
   * a CANOPY's roof is its own ceiling, so for both of those the collision and
   * the bounding box agree about where the surface is. A walkway's do not — the
   * boards are half way up it — and bottom-aligning the module on the plane
   * therefore hung the boards 0.69m in the air over the hoist plank and 0.68m
   * over the ropewalk's tie beam, with the player walking under the thing they
   * could see. Registering this height on the plane instead puts the boards
   * underfoot, the rope rail waist-high above them, and the beam below.
   */
  deckAtM?: number;
}

/**
 * Exported so the arithmetic can be checked against this table rather than
 * against a second copy of it: every `naturalM` is a measurement of a shipped
 * mesh, and a transposed axis in one is a silent 40% error in a building.
 */
export const MODULE_RUNS: Record<string, ModuleRun> = {
  // The yard walls, five blockers 0.6m thick and 3.6m to the top. 3.6m is what
  // the dive off the upper limb has to clear, so the height is load-bearing.
  "service-wall-straight": {
    naturalM: [1.901, 0.862, 0.422],
    stance: "SOLID",
  },
  // Stall canopies, street pentices and the Dock Square arcade: eleven entries
  // of one stall-and-canvas module, every one a roof the player runs along.
  "market-awning": {
    naturalM: [1.9, 1.558, 1.566],
    stance: "CANOPY",
  },
  // The hoist plank across Dassett Alley and the ropewalk's tie beam. 5.4m is
  // the module's declared length in assets.ts; the rails come out waist-high on
  // the mesh's own proportions, which is what makes it read as a walkway.
  //
  // 0.2445 of the mesh's 0.478 is where the boards are: the board field reads
  // 0.508 to 0.514 of the module's height over its whole span, dead flat but for
  // the cupping, with the rail rungs at 0.72 and the rail heads at 0.99.
  "roof-walk-board-long": {
    naturalM: [1.899, 0.478, 0.335],
    stance: "WALKWAY",
    moduleLengthM: 5.4,
    deckAtM: 0.2445,
  },
  // Two lean-to sheds, in Dassett Alley and against the Hollis Street meeting
  // house. Same shape of object as the awnings: the collision is the shed roof
  // the player runs onto, and the shed itself stands on the street below it.
  "infill-lean-to": {
    naturalM: [1.899, 1.447, 1.153],
    stance: "CANOPY",
  },
  // The rope-laying floor: the yard's spine, and the stage inside the ropewalk.
  // Both are low solids the length of a run, which is what a ropewalk is. Rebuilt
  // to a closed solid bench with a flat top; naturalM is its aspect at the
  // convention's ~1.9 longest axis, the fill taking the absolute size off each
  // blocker.
  "ropewalk-laying-rig": {
    naturalM: [1.9, 0.28, 0.244],
    stance: "SOLID",
  },
  // The Town House gallery rail, in two lengths either side of the stair head.
  // A balustrade is the plainest run there is — one 3.1m panel was standing on a
  // 5.4m rail, leaving 2.3m of gallery edge with nothing along it at all, on the
  // one balcony in the mission the player runs the whole length of.
  "churchyard-fence": {
    naturalM: [1.898, 0.703, 0.101],
    stance: "SOLID",
  },
  // The three duck beams. Their undersides are authored — 1.20m, 1.20m, 1.25m —
  // because a standing capsule must not fit through and a crouched one must,
  // which SOLID keeps by construction: it takes its base from the blocker's own
  // base and its top from the blocker's own top, so the beam the player ducks
  // cannot drift off the beam the player sees.
  "duck-beam-frame": {
    naturalM: [1.9, 1.247, 1.188],
    stance: "BLOCK",
  },

  // The route-bearing cover props — crate stacks, the crate mound, the loaded
  // carts and the lane hay. Each is drawn as one flat-topped mass FILLED into the
  // blocker it stands for rather than contain-fitted inside it: a contain-fit
  // takes the smallest of three ratios, so a stack whose plan aspect is not the
  // blocker's dropped a wedge of its own footprint and the top the player lands
  // on came up short at the edges. Filled, the blocker IS the object on all three
  // axes — the truth of a stack of crates or a loaded cart the run lands on.
  //
  // naturalM is the mesh's ASPECT at the module convention's ~1.9 longest axis
  // (the same Meshy-export scale every other run here is recorded at); the fill
  // re-derives the absolute scale from the blocker, so only the ratios are read
  // and the shipped mesh's own metres never enter the tiling. The heights below
  // divide out against each blocker's own height, so the vertical scale is 1.0 at
  // BAND.STACK / BAND.CART / the hay's 2.2m and the round cart wheels stay round;
  // only the horizontal footprint takes up the blocker's plan.
  "crate-stack": {
    naturalM: [1.9, 1.641, 1.555],
    stance: "BLOCK",
  },
  "crate-mound": {
    naturalM: [1.9, 1.86, 1.9],
    stance: "BLOCK",
  },
  "hand-cart": {
    naturalM: [1.9, 0.752, 1.267],
    stance: "BLOCK",
  },
  "hay-cart": {
    naturalM: [1.9, 1.493, 1.629],
    stance: "BLOCK",
  },
  // The loaded hay wain, dressing the lane and duel-yard catches as well as the
  // printshop dive. A four-wheeled wagon piled above the sideboards with a flat
  // trodden load on top: filled into its blocker, that load lands at the catch
  // plane. `hay-cart` was standing in on LANE_HAY and COVER_HAY_NW and its mesh
  // is a heaped cart whose crown is 0.21m proud of its flat area, so the flat a
  // diver actually meets sat that far below the authored catch; the wain's load
  // is flat to within 0.08m. naturalM is the mesh's aspect at the ~1.9 convention.
  "hay-wain-loaded": {
    naturalM: [1.311, 1.311, 1.9],
    stance: "BLOCK",
  },
  // The duel yard's loading stage. Its box is 2.6 x 1.8 x 4.2 — the top at 1.8m
  // is the surface the boss fight is fought on and around — but the mesh is a
  // wide, low platform (1.90 x 0.60 x 1.01), so a contain-fit was bound by the
  // width and drew it 2.6 x 0.83 x 1.39: a stage barely knee-high whose top fell
  // 0.97m under the plane the player is told to stand on. A BLOCK fills the
  // blocker on every axis, the same as every other route-bearing mass here, so
  // the deck the duel lives on is the deck the duel is authored against. naturalM
  // is the mesh's aspect at the ~1.9 convention.
  "warehouse-platform-scale": {
    naturalM: [1.9, 0.605, 1.013],
    stance: "BLOCK",
  },
  // The gaol barrels: the one vault on the street line. A BLOCK, not a loose
  // PROP, so the imported barrels FILL their collider on every axis rather than
  // contain-fitting inside it — a contain-fit took the mesh's longest-axis ratio
  // and drew the group barely half the 1.10m height the player actually vaults,
  // so the thing on screen was shorter than the thing the mover reasons about.
  // naturalM is the mesh's aspect at the ~1.9 convention, measured off the GLB's
  // POSITION accessors (1.900 x 0.893 x 1.446 raw); the fill takes the absolute
  // size off the blocker, which is authored 1.10m cubic.
  "barrel-group": {
    naturalM: [1.9, 0.893, 1.446],
    stance: "BLOCK",
  },

  // ---- the terraces -----------------------------------------------------
  // Six blocks of the street, and every one of them a house rather than a block.
  // Each mesh is a single colonial dwelling with its own door, its own windows
  // and its own chimney, and each is exported facing its local +Z — so the
  // frontage runs along local X and the plot runs back along local Z, which is
  // what lets a block be covered by repeating it. The shambles is six shopfronts
  // by three plots deep; Faneuil's south side is three houses on one frontage.
  "bldg-row-shop": {
    naturalM: [1.1, 1.899, 1.276],
    stance: "ROW",
  },
  "bldg-row-brick-a": {
    naturalM: [1.364, 1.899, 1.21],
    stance: "ROW",
  },
  "bldg-row-brick-b": {
    naturalM: [1.269, 1.9, 1.272],
    stance: "ROW",
  },
  "bldg-row-clapboard-a": {
    naturalM: [1.022, 1.899, 1.193],
    stance: "ROW",
  },
  "bldg-row-clapboard-b": {
    naturalM: [1.303, 1.9, 1.145],
    stance: "ROW",
  },
  "bldg-row-clapboard-c": {
    naturalM: [1.29, 1.9, 1.596],
    stance: "ROW",
  },
  // The gaol block on Queen Street. Not named a row, but built like one: a plain
  // brick front between two blank party walls, which is exactly the mesh a
  // terrace repeats. The block is 13 by 14 and the house is 6.5 by 5.6, so the
  // gaol was drawing a single dwelling on a third of a civic block.
  "bldg-brick": {
    naturalM: [1.283, 1.904, 1.107],
    stance: "ROW",
  },
  // Not a house, but the same arithmetic: a bale is a module and a stack of them
  // is a grid. The quiet way down out of the tie beam was landing on a 2.6 x 2.6m
  // pad of hemp that drew one 74cm bundle in the middle of it; rebuilt to a
  // solid flat-topped bale block that FILLS the bale blocker, so the landing is
  // flat edge to edge. naturalM is the block's aspect at the convention's ~1.9
  // longest axis.
  "cargo-net-bundle": {
    naturalM: [1.9, 1.9, 1.781],
    stance: "BLOCK",
  },
};

/**
 * One collision entry, drawn as a run of modules along its longer horizontal
 * axis.
 *
 * The tile count is rounded rather than ceiled and the run is then divided
 * exactly, so the modules end where the blocker ends. Ceiling would overhang,
 * and the two 5m stretches of the yard's west wall are the gap the player walks
 * in through — a module reaching past its blocker would draw that gate shut.
 */
function moduleRunPlacements(
  span: ScenerySpan,
  spec: ModuleRun,
  assetPath: string,
): SceneryPlacement[] {
  const [naturalL, naturalH] = spec.naturalM;
  const top = span.kind === "MASS" ? span.maxY : span.minY;

  let scale: number;
  let baseY: number;
  if (spec.stance === "WALKWAY") {
    scale = (spec.moduleLengthM ?? naturalL) / naturalL;
    // The BOARDS on the plane, not the module's underside. See `deckAtM`.
    baseY = top - (spec.deckAtM ?? 0) * scale;
  } else if (spec.stance === "CANOPY") {
    scale = top / naturalH;
    baseY = 0;
  } else {
    scale = (span.maxY - span.minY) / naturalH;
    baseY = span.minY;
  }

  const moduleLength = naturalL * scale;
  const height = naturalH * scale;
  const width = span.rect.maxX - span.rect.minX;
  const depth = span.rect.maxZ - span.rect.minZ;
  const alongX = width >= depth;
  const run = alongX ? width : depth;
  // Across the run the blocker IS the object, whatever the stance: a wall's
  // thickness, a pentice's projection from the wall it is nailed to, the width of
  // the boards on a staging. So `across` is the depth every tile is drawn at.
  //
  // Taking the mesh's own depth here instead left a strip of every canopy and
  // every walkway undrawn, because none of these modules is as deep in proportion
  // as the surface the level asks it to be: the market awning came out 2.56m over
  // a 3.00m stall roof, and the plank walk 0.95m over a 1.60m tie beam and a
  // 2.40m hoist platform. A MODULE is filled rather than fitted, so the axis it
  // is asked for is the axis it draws — and the player is stopped by, and stands
  // on, all of the blocker.
  const across = alongX ? depth : width;

  // A BLOCK is one object, not a run, so it is never split: a single instance
  // fills the whole blocker and no seam is invented down its middle.
  const tiles = spec.stance === "BLOCK" ? 1 : Math.max(1, Math.round(run / moduleLength));
  const tileLength = run / tiles;
  const start = alongX ? span.rect.minX : span.rect.minZ;
  const centre = alongX
    ? (span.rect.minZ + span.rect.maxZ) / 2
    : (span.rect.minX + span.rect.maxX) / 2;

  const out: SceneryPlacement[] = [];
  for (let index = 0; index < tiles; index++) {
    const at = start + tileLength * (index + 0.5);
    out.push({
      id: tiles === 1 ? span.id : `${span.id}#${index}`,
      asset: span.asset,
      assetPath,
      pos: alongX ? [at, baseY, centre] : [centre, baseY, at],
      // Local to the module: its own length first. The quarter turn is what puts
      // that length along the run.
      size: [tileLength, height, across],
      yaw: alongX ? 0 : Math.PI / 2,
      kind: span.kind,
      fit: "MODULE",
      parts: [span.id],
    });
  }
  return out;
}

/**
 * One town block, drawn as the terrace that fills it.
 *
 * A block is the one kind of collision entry where all six faces are real: the
 * player is stopped by every wall of it and lands on its roof, so unlike a wall
 * slab or an awning there is no thin axis to discount. What is NOT real is the
 * idea that the block is one building. `bldg-row-*` are houses — one door, one
 * chimney, one set of windows — and Boston's street was a run of them, so the
 * block's width is a frontage and its depth is a plot.
 *
 * That is why a stance cannot fix these and a contain-fit ruins them. The scale
 * has to come from the height, because the roof deck the player lands on is the
 * roof they can see; and once it does, the frontage and the plot are decided,
 * and the only honest way to cover 22m of frontage with a 6.9m house is three
 * houses. Stretching one instead is a 22m-wide door.
 *
 * Both counts are ROUNDED, for the reason the walls are: a rounded count divides
 * the block exactly, so the terrace ends where the block ends and the last house
 * neither overhangs the corner nor leaves a gap at it. Rounding down to one is
 * also the answer for a block that is already a house — the tall south row is
 * 9m on a 8.3m frontage — and that case then simply fills, which is what SOLID
 * would have done.
 */
function rowPlacements(
  span: ScenerySpan,
  spec: ModuleRun,
  assetPath: string,
): SceneryPlacement[] {
  const [naturalFrontage, naturalHeight, naturalPlot] = spec.naturalM;
  const height = span.maxY - span.minY;
  const scale = height / naturalHeight;
  const frontage = naturalFrontage * scale;
  const plot = naturalPlot * scale;

  // The mesh fronts its own +Z, so the authored yaw decides which world axis the
  // frontage lies along. Every block in this level is authored square to the
  // street; a quarter-turned one would put its frontage along Z.
  const turned = Math.abs(Math.cos(span.yaw)) < 0.5;
  const width = span.rect.maxX - span.rect.minX;
  const depth = span.rect.maxZ - span.rect.minZ;
  const alongFrontage = turned ? depth : width;
  const alongPlot = turned ? width : depth;

  const houses = Math.max(1, Math.round(alongFrontage / frontage));
  const ranks = Math.max(1, Math.round(alongPlot / plot));
  const houseWidth = alongFrontage / houses;
  const rankDepth = alongPlot / ranks;

  const out: SceneryPlacement[] = [];
  for (let rank = 0; rank < ranks; rank++) {
    for (let house = 0; house < houses; house++) {
      const alongF = houseWidth * (house + 0.5);
      const alongP = rankDepth * (rank + 0.5);
      const x = span.rect.minX + (turned ? alongP : alongF);
      const z = span.rect.minZ + (turned ? alongF : alongP);
      out.push({
        id: houses * ranks === 1 ? span.id : `${span.id}#${rank}_${house}`,
        asset: span.asset,
        assetPath,
        pos: [x, span.minY, z],
        // Local to the house: frontage first, then its height, then its plot.
        size: [houseWidth, height, rankDepth],
        yaw: span.yaw,
        kind: span.kind,
        fit: "MODULE",
        parts: [span.id],
      });
    }
  }
  return out;
}

/**
 * How far up an asset the surface the level stands on is, in the asset's own
 * declared metres.
 *
 * This is the whole of the difference between a deck's DRESSING and a prop that
 * merely stands on a deck, and the level already declares it. `standableAt` says
 * where the walking surface is inside an asset — the top of a hay wain at 2.20,
 * a market stall's counter at 1.10 and its roof at 1.90 — and for a surface's
 * own dressing it is the board: the gambrel walk is 42mm of the 42mm the asset
 * is, the fire board 30mm of 30mm, the sign hood 50mm of 50mm.
 *
 * Nothing was reading it, so a lone deck's dressing was bottom-aligned on the
 * plane and drew itself entirely ABOVE the surface it was there to be. That can
 * never carry the plane, at any height and with any art: `MEETING_RIDGE` is a
 * gambrel walk authored at 11.20m and the walk was drawn 11.200 to 11.242, so
 * the one thing over that deck was the only thing that could not hold it up.
 * Hanging the box by this offset instead puts the boards' top face on the plane
 * and the rest of the dressing under it, which is where a board is.
 *
 * An asset that declares NO standable height is not a dressing — the printer's
 * drying rack is 1.6m of frame on the roof deck, run through rather than stood
 * on — and keeps standing on the plane like any other prop.
 *
 * The HIGHEST declared surface, where an asset declares several. A lone deck
 * cannot say which of them it is, and every asset that declares more than one is
 * a body with solids of its own, so it is placed by the several-entry branch
 * below and never asks this.
 */
function surfaceOffset(declared?: { standableAt?: readonly number[] }): number {
  const heights = declared?.standableAt;
  return heights && heights.length > 0 ? Math.max(...heights) : 0;
}

/**
 * The box one object is drawn into, and the height its base sits at.
 *
 * The rule turns on whether the collision describes the whole object or part of
 * it, and that is exactly the difference between a one-entry cluster and a
 * several-entry one.
 *
 * ONE ENTRY: the entry is the object. A cart is a 3.0 x 2.2 x 2.2 box because
 * that is what the player walks into, and the same key placed elsewhere at a
 * different size is a different cart. Fit to the entry.
 *
 * SEVERAL ENTRIES: the entries are the parts of the object a player can touch,
 * which is always less than the object. The elm's collision is a 1.8m bole
 * solid to 12m and three limb decks; the tree around it is 16 x 18 x 16, and no
 * amount of arithmetic on the hull recovers a canopy nothing can stand on. So
 * the size comes from the asset's own declared dimensions — which assets.ts
 * defines as the dimensions the collision was authored against — and the hull
 * places it rather than sizing it.
 */
function drawBox(
  cluster: ScenerySpan[],
  declared?: { sizeM: [number, number, number]; standableAt?: readonly number[] },
): {
  size: Vec3Tuple;
  baseY: number;
} {
  const solids = cluster.filter((span) => span.kind === "MASS");
  const only = cluster.length === 1 ? cluster[0]! : null;
  if (only) {
    // A deck is a SURFACE. `DECK_THICKNESS_M` is a slab invented so that a
    // surface has a box at all, and it is never the height of the object the
    // surface belongs to — so for any fitting taller than 35cm it becomes the
    // binding ratio of the contain-fit and shrinks the whole object to a
    // miniature. The printer's sign board was drawn 62cm wide on a 3.2m ledge
    // and his drying rack 26cm on a 2.6m one: both correct in every proportion
    // and both too small to find.
    //
    // The asset's own declared height is the height. Where the object really is
    // thinner than the slab — a plank gantry is 3cm of board — the declared
    // height is thinner too, so nothing here inflates a board into a beam.
    const height =
      only.kind === "MASS" ? only.maxY - only.minY : (declared?.sizeM[1] ?? DECK_THICKNESS_M);
    return {
      size: [only.rect.maxX - only.rect.minX, height, only.rect.maxZ - only.rect.minZ],
      // A MASS stands on its base. A lone DECK does not stand anywhere: it is a
      // SURFACE, and the art dressing it has to present its own walking surface
      // AT the plane — which is a height INSIDE the asset, and `standableAt` is
      // the level's own declaration of it. See `surfaceOffset`.
      baseY: only.minY - (only.kind === "DECK" ? surfaceOffset(declared) : 0),
    };
  }

  const hull = unionRect(cluster.map((span) => span.rect));
  const size: Vec3Tuple = declared
    ? [declared.sizeM[0], declared.sizeM[1], declared.sizeM[2]]
    : [
        hull.maxX - hull.minX,
        Math.max(...cluster.map((span) => span.maxY)) -
          Math.min(...cluster.map((span) => span.minY)),
        hull.maxZ - hull.minZ,
      ];

  // A body stands on its own base. An object made only of surfaces hangs below
  // its highest one: a scaffold's staging is at 2.9 and 5.6, and the scaffold
  // itself starts on the ground.
  const baseY =
    solids.length > 0
      ? Math.min(...solids.map((span) => span.minY))
      : Math.max(...cluster.map((span) => span.maxY)) - size[1];
  return { size, baseY };
}

/**
 * Every visible object, derived from the collision the player actually moves
 * through rather than authored twice.
 *
 * This is the whole reason the level owns its own Scenery: the placement of
 * each GLB comes from the hull that was verified traversable, so a prop cannot
 * drift away from what the player feels. Anything with a null asset is
 * invisible collision — ramp strips, the ground — and is skipped.
 *
 * ONE DRAW PER OBJECT, not per collision entry. A collision entry is a piece of
 * geometry the mover has to reason about, and one object routinely needs
 * several: the elm is a bole and three limbs, the ropewalk is five walls and
 * four roof panels. Drawing the asset once per entry drew four elms, each
 * shrunk into one entry's box — a 2m tree and three 31cm specks — and nine
 * copies of a 22m shed each squeezed into a 60cm wall slab.
 *
 * The object is anchored on its solid parts when it has any. Surfaces overhang:
 * limbs, eaves and balconies all reach past the body that carries them, so
 * centring on them would walk the trunk off its own axis.
 */
export function sceneryPlacements(
  level: MissionLevel = M1_EFFIGY_RUN,
): SceneryPlacement[] {
  const spans: ScenerySpan[] = [];
  for (const mass of level.masses) {
    if (!mass.asset) continue;
    spans.push({
      id: mass.id,
      kind: "MASS",
      asset: mass.asset,
      rect: mass.rect,
      minY: mass.baseY,
      maxY: Number.isFinite(mass.topY) ? mass.topY : mass.baseY + OPEN_MASS_HEIGHT_M,
      yaw: mass.yaw ?? 0,
      carriedBy: [],
    });
  }
  for (const deck of level.decks) {
    if (!deck.asset) continue;
    spans.push({
      id: deck.id,
      kind: "DECK",
      asset: deck.asset,
      rect: deck.rect,
      minY: deck.y,
      maxY: deck.y,
      yaw: 0,
      carriedBy: deck.carriedBy,
    });
  }

  const rank = new Map(spans.map((span, index) => [span.id, index]));
  const byAsset = new Map<string, ScenerySpan[]>();
  for (const span of spans) {
    const group = byAsset.get(span.asset);
    if (group) group.push(span);
    else byAsset.set(span.asset, [span]);
  }

  const clusters: ScenerySpan[][] = [];
  for (const group of byAsset.values()) clusters.push(...clusterSpans(group));
  // Masses were collected before decks, so the first member of a cluster is its
  // solid where it has one, and the list comes out in level order.
  const order = (cluster: ScenerySpan[]) =>
    Math.min(...cluster.map((span) => rank.get(span.id)!));
  clusters.sort((a, b) => order(a) - order(b));

  const objects = clusters.flatMap((cluster): SceneryPlacement[] => {
    const head = cluster[0]!;
    const declared = ASSET_BY_KEY.get(head.asset);
    const path = declared?.path ?? `world/props/${head.asset}.glb`;

    // A module run only makes sense where the entry is the whole of what the
    // player touches. A several-entry object already gets its size from the
    // asset's declared dimensions, and the elm is verified against that.
    const moduleRun = MODULE_RUNS[head.asset];
    if (moduleRun && cluster.length === 1) {
      return moduleRun.stance === "ROW"
        ? rowPlacements(head, moduleRun, path)
        : moduleRunPlacements(head, moduleRun, path);
    }

    const { size, baseY } = drawBox(cluster, declared);
    const solids = cluster.filter((span) => span.kind === "MASS");
    // Anchored on the FOOTING — the solids that stand on the object's own base —
    // rather than on every solid it has. Stonework above the ground floor
    // oversails, the same way a surface does: the Town House's pediment hood
    // reaches 2.6m north of the wall it is bolted to, and centring the building
    // on that would slide it 1.3m off the footprint the player walks into.
    const footing = solids.filter((span) => span.minY <= baseY + EPSILON);
    const anchor = footing.length > 0 ? footing : solids.length > 0 ? solids : cluster;
    const body = unionRect(anchor.map((s) => s.rect));
    return [
      {
        id: head.id,
        asset: head.asset,
        assetPath: path,
        pos: [(body.minX + body.maxX) / 2, baseY, (body.minZ + body.maxZ) / 2],
        size,
        yaw: head.yaw,
        kind: solids.length > 0 ? "MASS" : "DECK",
        fit: path.includes("/structures/") ? "SHELL" : "PROP",
        parts: cluster.map((span) => span.id),
      },
    ];
  });

  return [...objects, ...ladderPlacements(level)];
}

// ---------------------------------------------------------------------------
// ladders
// ---------------------------------------------------------------------------

// The generated leaning-ladder family (assets/pipeline/build_work_ladder.mjs).
// One GLB per rung COUNT, each two rails and `N` rungs at a fixed 0.30 m gauge
// over a real length of `N * RUNG_GAP_M`. Rungs come from the COUNT, never from
// scaling one mesh — a uniform contain-fit of a single ladder up a 2.3–3.0 m
// rise spreads the rungs to ~0.4–0.5 m, nothing a leg steps on. The placement
// picks the variant whose natural length is nearest the rail it needs and fills
// the length by <=5 %, so the rungs stay at ~0.30 m at every rise.
const LADDER_RUNG_GAP_M = 0.3;
const LADDER_GAUGE_M = 0.43;
const LADDER_DEPTH_M = 0.05;
const LADDER_MARGIN_M = 0.15; // rail overrun below the first / above the last rung
const LADDER_RUNG_COUNTS = [8, 9, 10, 11] as const;
/**
 * Lean from horizontal. 72° is the mid of the tradesman's 70–75° range (the 4:1
 * rule), so the foot stands out from the wall by rise/tan(72°) and the rail runs
 * rise/sin(72°). A vertical ladder is not a leaning ladder, and the owner's law
 * is that the ladder "genuinely has to be on the outside" leaning on the face.
 */
const LADDER_LEAN_FROM_HORIZONTAL = (72 * Math.PI) / 180;

/** Natural length of a variant GLB, matching build_work_ladder.mjs. */
function ladderVariantLengthM(count: number): number {
  return LADDER_MARGIN_M + (count - 1) * LADDER_RUNG_GAP_M + LADDER_MARGIN_M;
}

/** Height of a served surface: a deck plane, a landable mass top, or the ground. */
function surfaceHeightOf(level: MissionLevel, id: string): number | null {
  for (const deck of level.decks) if (deck.id === id) return deck.y;
  for (const mass of level.masses) {
    if (mass.id === id && mass.landable && Number.isFinite(mass.topY)) return mass.topY;
  }
  if (id === "GROUND") return 0;
  return null;
}

/**
 * The lean geometry one placed ladder is drawn with, derived from the authored
 * `LadderPlacementSpec` and the surface it serves. Exported so the ladder's
 * COLLISION (compile.ts) and its DRAW (below) are computed from one function and
 * cannot drift — a solid the player sees in one place and collides with in
 * another is the whole class of bug this level exists to avoid.
 *
 * The ladder tops out on the served surface's OUTWARD lip and its foot stands
 * `run` metres out from that lip on the ground, so it TOUCHES at both ends: foot
 * on the floor, top rail against the face. It is placed on the exterior face
 * (the `faceX/faceZ` normal points from the wall back at the climber), leaning
 * inward at `pitch` from vertical.
 */
export interface LadderDraw {
  id: string;
  /** Rung count and the variant GLB it selects. */
  count: number;
  asset: string;
  assetPath: string;
  /** Foot of the ladder on the ground (its drawn origin). */
  foot: Vec3Tuple;
  /** Top rail landing, on the served surface lip. */
  top: Vec3Tuple;
  /** Fill box: [gauge, railLength, depth]. */
  size: Vec3Tuple;
  yaw: number;
  /** Lean about local X, radians (0 = upright; ~0.31 = 18° off vertical). */
  pitch: number;
  railLengthM: number;
  rungGapM: number;
}

export function ladderDraws(level: MissionLevel = M1_EFFIGY_RUN): LadderDraw[] {
  const draws: LadderDraw[] = [];
  for (const spec of level.ladders ?? []) {
    const topY = surfaceHeightOf(level, spec.onto);
    if (topY === null) continue;
    const footY = spec.at[1];
    const rise = topY - footY;
    if (rise <= 0) continue;

    const faceLen = Math.sqrt(spec.faceX * spec.faceX + spec.faceZ * spec.faceZ) || 1;
    const fX = spec.faceX / faceLen; // outward, toward the climber
    const fZ = spec.faceZ / faceLen;

    const railLength = rise / Math.sin(LADDER_LEAN_FROM_HORIZONTAL);
    const run = rise / Math.tan(LADDER_LEAN_FROM_HORIZONTAL);

    // The FOOT is the authored climb foot: the exact spot the player stands to
    // climb (`ladder-findings` measured it against the served surface), so the
    // ladder is where the climb is, not metres away at a deck edge. The ladder
    // leans INWARD (−face, toward the surface) by `run`, topping out at the
    // served height over the face it rests on.
    const foot: Vec3Tuple = [spec.at[0], footY, spec.at[2]];
    const top: Vec3Tuple = [foot[0] - fX * run, topY, foot[2] - fZ * run];

    // Pick the variant whose natural length is nearest the rail, clamped to the
    // built set, and fill the length onto the exact rail so rungs stay ~0.30 m.
    let count: number = LADDER_RUNG_COUNTS[0]!;
    let best = Infinity;
    for (const candidate of LADDER_RUNG_COUNTS) {
      const d = Math.abs(ladderVariantLengthM(candidate) - railLength);
      if (d < best) {
        best = d;
        count = candidate;
      }
    }

    // Local +Z maps to the INWARD direction, so a positive pitch about local X
    // tips the top inward against the face.
    const yaw = Math.atan2(-fX, -fZ);
    const pitch = Math.PI / 2 - LADDER_LEAN_FROM_HORIZONTAL;

    draws.push({
      id: `LADDER_${spec.id}`,
      count,
      asset: `work-ladder-${count}`,
      assetPath: `world/props/work-ladder-${count}.glb`,
      foot,
      top,
      size: [LADDER_GAUGE_M, railLength, LADDER_DEPTH_M],
      yaw,
      pitch,
      railLengthM: railLength,
      rungGapM: railLength / count,
    });
  }
  return draws;
}

/**
 * One visible ladder per placed climb affordance, leaning on the face it serves.
 *
 * The ladder is DRAWN as a fill (per-axis) MODULE so its gauge and rail thickness
 * stay human while only its length matches the rise, and it is LEANED on its foot
 * by `pitch` so it stands on the exterior face rather than bolt upright. Its foot
 * is on the ground and its top rail on the served surface's lip — it touches at
 * both ends. See `ladderDraws` for the geometry; collision is emitted in
 * compile.ts from the same function so the solid and the drawn thing agree.
 */
export function ladderPlacements(
  level: MissionLevel = M1_EFFIGY_RUN,
): SceneryPlacement[] {
  return ladderDraws(level).map((draw) => ({
    id: draw.id,
    asset: draw.asset,
    assetPath: draw.assetPath,
    pos: draw.foot,
    size: draw.size,
    yaw: draw.yaw,
    pitch: draw.pitch,
    kind: "MASS",
    fit: "MODULE",
    parts: [draw.id],
  }));
}
