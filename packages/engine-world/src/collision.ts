// Semantic collision + support model for player locomotion physics
// (World-Built-State §locomotion). Pure, deterministic, and THREE-free so
// it runs under `node --test` and inside the render loop without allocation
// churn. All positions are plain {x,y,z}; the caller bridges to THREE.
//
// The world is described as:
//   - blockers: axis-aligned XZ boxes with a solid vertical span [baseY, topY].
//     Buildings/barriers are full-height walls (topY = Infinity). Authored
//     low obstacles (vault crates, benches) are solid only up to their height
//     and expose their top as a landable support surface.
//   - platforms: thin support rects at a fixed y (authored roofs/scaffolds).
//   - the implicit ground plane at y = 0.
//
// A player is a vertical capsule: a foot point at footY, a head at
// footY + height, and a horizontal radius. Horizontal sweeps and support
// queries are height-aware so a jump collides with a wall it passes through
// but clears a crate it arcs over, and standing on a roof does not collide
// with the building footprint beneath the feet.

export type Vec3 = { x: number; y: number; z: number };

// Fixed integration substep: physics never advances more than this per step,
// so landings/apex are frame-rate independent and reproducible in tests.
export const PHYSICS_SUBSTEP = 1 / 120;

// ---- the shared body model -------------------------------------------------
//
// THE BODY IS ONE CAPSULE AND IT IS DESCRIBED BY FIVE NUMBERS, ALL OF THEM HERE:
// a radius, a standing height, a crouched height, and the two landmarks anything
// aiming at or looking at a body needs. They live together because splitting them
// is how a game ends up with a guard whose sightline and a projectile's aim point
// disagree about where a crouching person's chest is.
//
// The landmarks are FRACTIONS of the live capsule height, never absolute metres.
// That is the whole point: a crouched silhouette is automatically the same
// silhouette to a patrol's vision cone, to an incoming ball, and to the collision
// capsule itself, with no per-system stance table to keep in step.
export const CAPSULE_RADIUS = 0.35;
export const STAND_HEIGHT = 1.55;
export const CROUCH_HEIGHT = 0.98;

/** Eye line, as a fraction of capsule height. Eyes sit just below the crown. */
export const EYE_HEIGHT_FRACTION = 0.92;
/** Torso centre, as a fraction of capsule height. The aim point for a body shot. */
export const CHEST_HEIGHT_FRACTION = 0.72;

/** A body of `capsuleHeight` has its eyes here, above its feet. */
export function eyeHeightForCapsule(capsuleHeight: number): number {
  return capsuleHeight * EYE_HEIGHT_FRACTION;
}

/** A body of `capsuleHeight` has its chest here, above its feet. */
export function chestHeightForCapsule(capsuleHeight: number): number {
  return capsuleHeight * CHEST_HEIGHT_FRACTION;
}

/**
 * The minimum a body needs: where its feet are and how tall it currently is.
 * MotionState satisfies this structurally, and so does any actor that is not a
 * MotionState — a patrol, a civilian, a duel opponent.
 */
export interface BodyPose {
  pos: Vec3;
  capsuleHeight: number;
}

/** Where this body's eyes are. Line of sight starts and ends here. */
export function eyePosition(body: BodyPose): Vec3 {
  return {
    x: body.pos.x,
    y: body.pos.y + eyeHeightForCapsule(body.capsuleHeight),
    z: body.pos.z,
  };
}

/** Where this body's chest is. Aimed shots and sight targets resolve here. */
export function chestPosition(body: BodyPose): Vec3 {
  return {
    x: body.pos.x,
    y: body.pos.y + chestHeightForCapsule(body.capsuleHeight),
    z: body.pos.z,
  };
}

/** Is this body crouched? Derived from the capsule, so stance has one source. */
export function isCrouched(capsuleHeight: number): boolean {
  return capsuleHeight < STAND_HEIGHT - 0.05;
}

// Vertical tolerances.
export const CONTACT_EPS = 0.01; // "on the surface" band (<=1cm support snap)
export const SUPPORT_SNAP_UP = 0.06; // step-up tolerance onto a near-flush ledge
const HEIGHT_EPS = 1e-4;

export interface Blocker {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  baseY: number;
  topY: number; // Infinity for a full-height wall
  // Solid boxes with a finite topY also act as a landable surface at topY.
  landable: boolean;
  tags: ReadonlySet<string>;
  // Exact horizontal footprint. min/max remain as a broad phase and for
  // diagnostics; collision tests use this local-space shape when present.
  footprint?:
    | {
        kind: "obb";
        cx: number;
        cz: number;
        halfX: number;
        halfZ: number;
        yaw: number;
      }
    | {
        kind: "capsule";
        ax: number;
        az: number;
        bx: number;
        bz: number;
        radius: number;
      };
}

export interface Platform {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
  tags: ReadonlySet<string>;
  polygon?: ReadonlyArray<readonly [number, number]>;
}

/**
 * An authored permission to climb straight up.
 *
 * Everything else the parkour reader knows, it works out by looking: it walks
 * forward until the ground steps up, or backwards until a surface overhead
 * stops, and decides from the shape of what it found. That inference covers a
 * ledge you approach across open ground and it cannot cover a pure vertical
 * ascent — two decks with the same footprint, one above the other, where the
 * player stands in the middle of a floor and goes up. There is no lip to find,
 * no face to meet, nothing to measure. The distinction between "this scaffold
 * has a ladder up its middle" and "you are underneath a canopy" is not in the
 * geometry at all; it is intent, and intent has to be authored.
 *
 * So a climb volume is the level saying it outright: a body standing inside
 * this footprint, with its feet in this band, may be offered a rise onto
 * `toSurface`. It grants nothing else. The rise still has to pass every test a
 * climb normally passes — a standable landing, head room, a clear path — and
 * the volume only exempts the reader's reachability bound, which exists to
 * refuse exactly the guess this volume replaces with a fact.
 */
export interface ClimbVolume {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Feet band. A body standing outside it is not at the foot of this climb. */
  minY: number;
  maxY: number;
  /** Deck or landable mass top the ascent arrives on. */
  toSurface: string;
}

/**
 * A volume that stops the CAMERA but never the body.
 *
 * The chase and cinematic cameras keep themselves clear of geometry by marching
 * in until the line from the focus to the lens is unobstructed. That march reads
 * `blockers` — the solids a body collides with. But a great deal of the world is
 * DRAWN without any collision: a tree's leaf canopy and boughs, a market awning,
 * a hanging sign, a bolt of cloth. A body is meant to pass those, so they carry
 * no blocker; the camera then sails straight into them and the frame fills with
 * leaves or canvas while `camInsideCollision` reports nothing, because to the
 * collision world the camera is in open air. The owner hit exactly this
 * descending the Liberty Elm: the lens buried in the canopy, a green/orange
 * smear, collision "clear".
 *
 * A camera occluder is the missing half: an INVISIBLE box (an XZ rect with a
 * vertical span) that represents that drawn mass to the camera alone. It is not
 * a blocker and must never become one — the body still walks through the leaves,
 * the awning is still steppable, nothing about traversal, sight lines, cover or
 * projectiles changes, because only the camera-clearance queries
 * (`cameraSegmentOccluderIds` / `cameraSegmentClear`) consult it. It is also not
 * drawn: it is pure simulation, allowed under the imported-world rule the same
 * way an invisible wall or a trigger is, and it must stay that way — never a
 * visible fallback shell.
 *
 * Absent in worlds that have no drawn-only geometry (the duel arena, most
 * tests): no occluder simply means the camera treats only solids as obstacles,
 * which is the pre-existing behaviour.
 */
export interface CameraOccluder {
  id: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Bottom of the drawn mass the camera should not enter. */
  baseY: number;
  /** Top of it. */
  topY: number;
}

export interface CollisionWorld {
  blockers: Blocker[];
  platforms: Platform[];
  // Invisible volumes that stop the CAMERA but not the body: drawn-only geometry
  // (a tree canopy, an awning, a sign) that carries no blocker because a body
  // passes it, yet the camera must not sit inside. Only the camera-clearance
  // queries read this; every body/sight/cover/projectile query ignores it.
  cameraOccluders?: CameraOccluder[];
  // Outer world clamp (walkable bounds); horizontal sweeps clamp to it.
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  // Authored vertical ascents. Absent in worlds that have none (the duel arena,
  // most tests): no volume simply means no ascent is exempted.
  climbVolumes?: ClimbVolume[];
  // Placed climb ladders, the self-describing affordance `alignClimbToLadder`
  // consumes. The compile pipe forwards them from the authored
  // LadderPlacementSpec; refusal (`climbAffordanceAt`) requires one of these — or
  // a grip below — for every climb-volume ascent.
  ladders?: LadderSpec[];
  // Placed climb GRIPS: a climb up a VISIBLE STRUCTURE that is not a ladder —
  // stepped masonry set-offs, a tree's boughs — where bolting a ladder would read
  // worse than the honest holds already drawn. A grip is not an exemption: it
  // names the drawn `support` mass and is validated (`alignClimbToGrip`) that the
  // structure genuinely spans the rise and tops out with clearance, exactly as a
  // ladder is. "Ladder OR grip", the owner's own words.
  grips?: GripSpec[];
}

/**
 * Is a body at (x, footY, z) standing at the foot of an authored ascent onto
 * `toSurface`?
 */
export function climbVolumeAt(
  world: CollisionWorld,
  x: number,
  footY: number,
  z: number,
  toSurface: string,
): ClimbVolume | null {
  const volumes = world.climbVolumes;
  if (!volumes) return null;
  for (const volume of volumes) {
    if (volume.toSurface !== toSurface) continue;
    if (footY < volume.minY - HEIGHT_EPS || footY > volume.maxY + HEIGHT_EPS) {
      continue;
    }
    if (!pointInRect(x, z, volume.minX, volume.maxX, volume.minZ, volume.maxZ)) {
      continue;
    }
    return volume;
  }
  return null;
}

// ---- ladder-aligned climb --------------------------------------------------
//
// The owner's rule: a climb-up is only real when it runs up a VISIBLE LADDER,
// and the ascent must read as the body ON the ladder's outer face with hands on
// the rungs — not sliding up a surface near one. A ladder is a self-describing
// affordance: a base, a top, an outward face and fixed rungs, every one of them
// MEASURED FROM THE OBJECT rather than typed as a coordinate and trusted. This
// is the engine half of that rule. It answers two questions off the object and
// the world alone — "may a climb arm here?" and "where does the body ride?" —
// so the arming test is decidable and cheap, not a swept-spline residual check.

/**
 * A placed climb affordance. The base sits on the ground the player stands on;
 * the top is the deck it tops out onto; the face normal (unit, XZ) points away
 * from the wall, back at the climber, and is the side the body grabs and rides.
 * Rung spacing is the fixed geometry hand and foot placement read off.
 */
export interface LadderSpec {
  id: string;
  base: Vec3;
  topY: number;
  /** Outward face normal in XZ (points from the wall toward the climber). */
  faceX: number;
  faceZ: number;
  /** Deck / landable mass id the top-out lands on. */
  toSurface: string;
  /** Rail-to-rail width; the body must be within it to be on the ladder. */
  widthM: number;
  /** Fixed rung spacing, for hand/foot placement. */
  rungGapM: number;
}

/**
 * A validated ascent off a ladder. The rise runs up the ladder's OUTER FACE —
 * the capsule centre held a radius out along the face normal so the body is
 * tangent to the rungs and never inside them — and the top-out steps INWARD
 * onto the served surface once the feet are at the top. Both ends are derived
 * from the ladder, so the path is identical from every approach heading.
 */
export interface LadderClimb {
  riseFoot: Vec3;
  riseTop: Vec3;
  topOut: Vec3;
  faceX: number;
  faceZ: number;
}

/** Footprint + height of a standable surface (deck platform or landable box top). */
export function surfaceRectById(
  world: CollisionWorld,
  id: string,
): { minX: number; maxX: number; minZ: number; maxZ: number; y: number } | null {
  for (const platform of world.platforms) {
    if (platform.id === id) {
      return {
        minX: platform.minX,
        maxX: platform.maxX,
        minZ: platform.minZ,
        maxZ: platform.maxZ,
        y: platform.y,
      };
    }
  }
  for (const blocker of world.blockers) {
    if (blocker.id === id && blocker.landable && Number.isFinite(blocker.topY)) {
      return {
        minX: blocker.minX,
        maxX: blocker.maxX,
        minZ: blocker.minZ,
        maxZ: blocker.maxZ,
        y: blocker.topY,
      };
    }
  }
  return null;
}

/**
 * The inward direction from a foot standing under (or beside) a served surface
 * toward that surface's interior — the way the top-out steps once the feet clear
 * the top. Read off the surface footprint, so it does not depend on which way
 * the player happened to walk in: the defect behind "from any other angle it
 * goes through the ceiling" was a top-out projected along the APPROACH heading,
 * which lands off the deck when the approach is off-axis. Returns null when the
 * surface is unknown or the foot is already at its centre (nothing to derive).
 */
export function surfaceInteriorDir(
  world: CollisionWorld,
  toSurface: string,
  footX: number,
  footZ: number,
): { x: number; z: number } | null {
  const rect = surfaceRectById(world, toSurface);
  if (!rect) return null;
  const cx = (rect.minX + rect.maxX) / 2;
  const cz = (rect.minZ + rect.maxZ) / 2;
  const dx = cx - footX;
  const dz = cz - footZ;
  // sqrt(dx*dx + dz*dz), not Math.hypot: only IEEE-754-pinned ops, so the result
  // is identical on every engine (hypot is implementation-defined in the last bits).
  const len = Math.sqrt(dx * dx + dz * dz);
  if (len < 1e-3) return null;
  return { x: dx / len, z: dz / len };
}

// Ids of ladder-tagged solids, cached per blocker array. Ladders are now SOLID
// (a body cannot walk through one), but to CLIMB ARMING they are transparent: a
// ladder overhead at the next storey — a stacked scaffold ladder, the lean-to
// ladder above the buttress — is not a ceiling that refuses the climb below it,
// it is the next thing to climb. So the top-out clearance a climb is armed on
// ignores ladder solids, exactly as the reader (probe) does.
const ladderTaggedIdsCache = new WeakMap<object, ReadonlySet<string>>();
export function ladderTaggedIds(world: CollisionWorld): ReadonlySet<string> {
  const cached = ladderTaggedIdsCache.get(world.blockers);
  if (cached) return cached;
  const ids = new Set<string>();
  for (const b of world.blockers) if (b.tags.has("ladder")) ids.add(b.id);
  ladderTaggedIdsCache.set(world.blockers, ids);
  return ids;
}

/**
 * A placed climb GRIP — a climb up a visible structure that is not a ladder.
 *
 * The owner's law is "ladder OR grip": a bolted ladder on a tree crown, or over
 * masonry set-offs already drawn as holds, reads worse than the honest structure
 * there. A grip names that structure (`support`, a drawn solid mass) and its
 * kind, and is validated exactly as a ladder is — it is NOT an exemption list.
 * The merit test is that the named support genuinely spans the rise (there is
 * something drawn to grip the whole way up) and the top-out has standing room.
 */
export interface GripSpec {
  id: string;
  /** Foot, on the ground the player stands on. */
  base: Vec3;
  /** Deck / landable mass top the top-out lands on; its Y is the grip top. */
  topY: number;
  /** Outward face normal in XZ (points from the structure toward the climber). */
  faceX: number;
  faceZ: number;
  toSurface: string;
  /** The drawn solid the body grips — masonry buttress, tree bole. */
  support: string;
  kind: "STEPPED_MASONRY" | "BOUGHS";
}

/**
 * Validate a grip: the served surface exists, the named support is a drawn solid
 * that spans from the foot up to the served height (so there is a visible thing
 * to grip the whole way up, not a bare face), and the top-out accepts a standing
 * body. Produces the same ascent path a ladder does, so the mover treats a grip
 * climb and a ladder climb identically.
 */
export function alignClimbToGrip(
  world: CollisionWorld,
  grip: GripSpec,
): LadderClimb | null {
  const faceLen = Math.sqrt(grip.faceX * grip.faceX + grip.faceZ * grip.faceZ);
  if (faceLen < 1e-6) return null;
  const fX = grip.faceX / faceLen;
  const fZ = grip.faceZ / faceLen;

  const rect = surfaceRectById(world, grip.toSurface);
  if (!rect) return null;

  // The named support must be a real solid whose vertical span reaches from the
  // foot up to (near) the served height — the honest "there is a structure to
  // grip the whole rise" merit. A bare wall has no such AUTHORED grip pointing at
  // it; this is what a masonry set-off or a bole provides and a blank face does
  // not claim.
  const support = world.blockers.find((b) => b.id === grip.support);
  if (!support) return null;
  const spansFoot = support.baseY <= grip.base.y + 0.25;
  const spansTop = support.topY >= grip.topY - 0.35;
  if (!spansFoot || !spansTop) return null;

  const riseFoot: Vec3 = {
    x: grip.base.x + fX * CAPSULE_RADIUS,
    y: grip.base.y,
    z: grip.base.z + fZ * CAPSULE_RADIUS,
  };
  const riseTop: Vec3 = { x: riseFoot.x, y: grip.topY, z: riseFoot.z };

  // The top-out is on the served surface itself — a stepped set-off or a bough is
  // often shallow, so a fixed inward inset can overshoot its far edge. Land where
  // the surface actually is: the base's XZ clamped INTO the served footprint (a
  // capsule radius clear of the near lip), which is the point a body pulling onto
  // the structure comes to rest on.
  const clampInto = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(v, lo + CAPSULE_RADIUS), hi - CAPSULE_RADIUS);
  const topOut: Vec3 = {
    x: rect.maxX - rect.minX > 2 * CAPSULE_RADIUS ? clampInto(grip.base.x, rect.minX, rect.maxX) : (rect.minX + rect.maxX) / 2,
    y: grip.topY,
    z: rect.maxZ - rect.minZ > 2 * CAPSULE_RADIUS ? clampInto(grip.base.z, rect.minZ, rect.maxZ) : (rect.minZ + rect.maxZ) / 2,
  };
  const ignoreDest = new Set<string>([grip.toSurface, grip.support, ...ladderTaggedIds(world)]);
  if (
    !landingValid(world, topOut.x, topOut.z, CAPSULE_RADIUS, grip.topY, STAND_HEIGHT, ignoreDest)
  ) {
    return null;
  }
  return { riseFoot, riseTop, topOut, faceX: fX, faceZ: fZ };
}

/**
 * The visible climb means at a foot standing on `toSurface`'s ascent, or null.
 *
 * THE REFUSAL PREDICATE, in one place: a climb-volume ascent may arm ONLY where a
 * ladder or a grip validates against the world at this foot. Matches by served
 * surface and by proximity of the affordance's own base to the foot (a surface
 * with two ladders — the meeting-house ridge has two — picks the near one), then
 * requires it to arm. No ladder and no grip means no climb.
 */
export function climbAffordanceAt(
  world: CollisionWorld,
  x: number,
  y: number,
  z: number,
  toSurface: string,
  maxBaseDistM = 3,
): LadderClimb | null {
  const near = (bx: number, bz: number) =>
    Math.sqrt((bx - x) * (bx - x) + (bz - z) * (bz - z)) <= maxBaseDistM;
  for (const ladder of world.ladders ?? []) {
    if (ladder.toSurface !== toSurface) continue;
    if (!near(ladder.base.x, ladder.base.z)) continue;
    const climb = alignClimbToLadder(world, ladder);
    if (climb) return climb;
  }
  for (const grip of world.grips ?? []) {
    if (grip.toSurface !== toSurface) continue;
    if (!near(grip.base.x, grip.base.z)) continue;
    const climb = alignClimbToGrip(world, grip);
    if (climb) return climb;
  }
  return null;
}

/**
 * Validate a ladder against the world and produce the ascent path, or null when
 * the object does not support a climb. This is the arming predicate: NO LADDER,
 * NO CLIMB. A ladder fails to arm when its top-out has no standing clearance (it
 * points into a ceiling — the "forced straight up and through" the owner saw
 * cannot happen, because a ladder into a ceiling refuses), or when its outer
 * face is buried in solid (there is nothing to climb on the outside of).
 */
export function alignClimbToLadder(
  world: CollisionWorld,
  ladder: LadderSpec,
): LadderClimb | null {
  const faceLen = Math.sqrt(ladder.faceX * ladder.faceX + ladder.faceZ * ladder.faceZ);
  if (faceLen < 1e-6) return null;
  const fX = ladder.faceX / faceLen;
  const fZ = ladder.faceZ / faceLen;

  // A ladder that tops onto no known surface is misconfigured; it cannot arm a
  // climb. This is the object side of "no ladder, no climb": the ladder has to
  // name a deck or landable top the world actually has.
  if (!surfaceRectById(world, ladder.toSurface)) return null;

  // The rise rides a radius OUT along the face normal so the capsule is tangent
  // to the rungs, never inside them. This is last night's tangent-rise principle
  // taken off the probe heading and put on the ladder's own normal, which is why
  // it holds from any approach angle rather than only head-on.
  const riseFoot: Vec3 = {
    x: ladder.base.x + fX * CAPSULE_RADIUS,
    y: ladder.base.y,
    z: ladder.base.z + fZ * CAPSULE_RADIUS,
  };
  const riseTop: Vec3 = { x: riseFoot.x, y: ladder.topY, z: riseFoot.z };

  // Step inward (−face) onto the served surface. The rise already stands a
  // radius OUT from the ladder base (which sits at the wall foot / deck edge), so
  // stepping in one radius only reaches the edge; a second radius plants the
  // whole capsule clear of the lip, so the body finishes standing ON the deck
  // rather than teetering on it.
  const inset = 2 * CAPSULE_RADIUS + 0.05;
  const topOut: Vec3 = {
    x: riseTop.x - fX * inset,
    y: ladder.topY,
    z: riseTop.z - fZ * inset,
  };

  // The top-out must accept a standing body — the destination surface itself is
  // exempt (topping onto it is not piercing it), as are ladder solids (the next
  // storey's ladder overhead is not a ceiling that refuses this climb); every
  // other solid is a ceiling.
  const ignoreDest = new Set<string>([ladder.toSurface, ...ladderTaggedIds(world)]);
  if (
    !landingValid(
      world,
      topOut.x,
      topOut.z,
      CAPSULE_RADIUS,
      ladder.topY,
      STAND_HEIGHT,
      ignoreDest,
    )
  ) {
    return null;
  }
  return { riseFoot, riseTop, topOut, faceX: fX, faceZ: fZ };
}

// ---- deterministic semantic broad phase -----------------------------------
// A uniform XZ grid indexes conservative blocker AABBs only. Query results are
// restored to authored blocker order before exact AABB/OBB/capsule tests, so
// first-hit behavior, stable IDs, ignore sets, and all narrow-phase semantics
// remain byte-for-byte deterministic.
const BROAD_PHASE_CELL_SIZE = 12;
// OBB narrow phase expands each local axis by the player radius. Rotating that
// expanded square back to world space can grow either broad axis by sqrt(2).
const BROAD_PHASE_RADIUS_FACTOR = Math.SQRT2;

interface BroadPhaseIndex {
  blockers: Blocker[];
  blockerCount: number;
  cells: Map<string, number[]>;
  marks: Uint32Array;
  stamp: number;
  scratch: number[];
}

interface BroadPhaseBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY?: number;
  maxY?: number;
}

const broadPhaseByWorld = new WeakMap<CollisionWorld, BroadPhaseIndex>();

function broadPhaseCell(value: number): number {
  return Math.floor(value / BROAD_PHASE_CELL_SIZE);
}

function broadPhaseKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function buildBroadPhase(world: CollisionWorld): BroadPhaseIndex {
  const cells = new Map<string, number[]>();
  world.blockers.forEach((blocker, blockerIndex) => {
    const minCellX = broadPhaseCell(blocker.minX);
    const maxCellX = broadPhaseCell(blocker.maxX);
    const minCellZ = broadPhaseCell(blocker.minZ);
    const maxCellZ = broadPhaseCell(blocker.maxZ);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const key = broadPhaseKey(cellX, cellZ);
        const entries = cells.get(key);
        if (entries) entries.push(blockerIndex);
        else cells.set(key, [blockerIndex]);
      }
    }
  });
  return {
    blockers: world.blockers,
    blockerCount: world.blockers.length,
    cells,
    marks: new Uint32Array(world.blockers.length),
    stamp: 0,
    scratch: [],
  };
}

function broadPhaseIndex(world: CollisionWorld): BroadPhaseIndex {
  let index = broadPhaseByWorld.get(world);
  // GameplayWorld replaces collision arrays atomically for door, route, and
  // traversal lifecycle changes. Rebuild automatically for either a new array
  // or a changed count; explicit invalidation covers intentional in-place edits.
  if (
    !index ||
    index.blockers !== world.blockers ||
    index.blockerCount !== world.blockers.length
  ) {
    index = buildBroadPhase(world);
    broadPhaseByWorld.set(world, index);
  }
  return index;
}

export function invalidateCollisionBroadPhase(world: CollisionWorld): void {
  broadPhaseByWorld.delete(world);
}

function broadPhaseCandidates(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): readonly number[] {
  const index = broadPhaseIndex(world);
  index.stamp = (index.stamp + 1) >>> 0;
  if (index.stamp === 0) {
    index.marks.fill(0);
    index.stamp = 1;
  }
  const stamp = index.stamp;
  const result = index.scratch;
  result.length = 0;
  const minCellX = broadPhaseCell(bounds.minX);
  const maxCellX = broadPhaseCell(bounds.maxX);
  const minCellZ = broadPhaseCell(bounds.minZ);
  const maxCellZ = broadPhaseCell(bounds.maxZ);
  for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
    for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
      const entries = index.cells.get(broadPhaseKey(cellX, cellZ));
      if (!entries) continue;
      for (const blockerIndex of entries) {
        if (index.marks[blockerIndex] === stamp) continue;
        index.marks[blockerIndex] = stamp;
        const blocker = world.blockers[blockerIndex]!;
        if (
          blocker.maxX < bounds.minX ||
          blocker.minX > bounds.maxX ||
          blocker.maxZ < bounds.minZ ||
          blocker.minZ > bounds.maxZ
        ) {
          continue;
        }
        if (
          bounds.minY !== undefined &&
          bounds.maxY !== undefined &&
          !spanOverlaps(bounds.minY, bounds.maxY, blocker.baseY, blocker.topY)
        ) {
          continue;
        }
        result.push(blockerIndex);
      }
    }
  }
  result.sort((a, b) => a - b);
  return result;
}

export function collisionBroadPhaseCandidateCount(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): number {
  return broadPhaseCandidates(world, bounds).length;
}

export function collisionBroadPhaseCandidateIds(
  world: CollisionWorld,
  bounds: BroadPhaseBounds,
): string[] {
  return broadPhaseCandidates(world, bounds).map(
    (blockerIndex) => world.blockers[blockerIndex]!.id,
  );
}

// ---- builders --------------------------------------------------------------

export function wallFromRect(
  id: string,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const topY = opts.topY ?? Infinity;
  return {
    id,
    minX: cx - halfX,
    maxX: cx + halfX,
    minZ: cz - halfZ,
    maxZ: cz + halfZ,
    baseY: opts.baseY ?? 0,
    topY,
    landable: opts.landable ?? Number.isFinite(topY),
    tags: new Set(opts.tags ?? []),
  };
}

export function wallFromOrientedRect(
  id: string,
  cx: number,
  cz: number,
  halfX: number,
  halfZ: number,
  yaw: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  const broadX = halfX * c + halfZ * s;
  const broadZ = halfX * s + halfZ * c;
  return {
    ...wallFromRect(id, cx, cz, broadX, broadZ, opts),
    footprint: { kind: "obb", cx, cz, halfX, halfZ, yaw },
  };
}

export function wallFromCapsule(
  id: string,
  a: Vec3,
  b: Vec3,
  radius: number,
  opts: { topY?: number; baseY?: number; landable?: boolean; tags?: Iterable<string> } = {},
): Blocker {
  const minX = Math.min(a.x, b.x) - radius;
  const maxX = Math.max(a.x, b.x) + radius;
  const minZ = Math.min(a.z, b.z) - radius;
  const maxZ = Math.max(a.z, b.z) + radius;
  return {
    id,
    minX,
    maxX,
    minZ,
    maxZ,
    baseY: opts.baseY ?? Math.min(a.y, b.y) - radius,
    topY: opts.topY ?? Math.max(a.y, b.y) + radius,
    landable: opts.landable ?? false,
    tags: new Set(opts.tags ?? []),
    footprint: {
      kind: "capsule",
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z,
      radius,
    },
  };
}

export function platformFromRect(
  id: string,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
  tags: Iterable<string> = [],
): Platform {
  return { id, minX, maxX, minZ, maxZ, y, tags: new Set(tags) };
}

export function platformFromPolygon(
  id: string,
  polygon: ReadonlyArray<readonly [number, number]>,
  y: number,
  tags: Iterable<string> = [],
): Platform {
  if (polygon.length < 3) {
    throw new Error(`platform ${id} requires at least three points`);
  }
  const xs = polygon.map((point) => point[0]);
  const zs = polygon.map((point) => point[1]);
  return {
    id,
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minZ: Math.min(...zs),
    maxZ: Math.max(...zs),
    y,
    tags: new Set(tags),
    polygon: polygon.map(([x, z]) => [x, z] as const),
  };
}

// ---- geometry helpers ------------------------------------------------------

function pointInRect(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  margin = 0,
): boolean {
  return x >= minX - margin && x <= maxX + margin && z >= minZ - margin && z <= maxZ + margin;
}

function pointInPolygon(
  x: number,
  z: number,
  polygon: ReadonlyArray<readonly [number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i]!;
    const [xj, zj] = polygon[j]!;
    if (
      zi > z !== zj > z &&
      x < ((xj - xi) * (z - zi)) / (zj - zi || Number.EPSILON) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Is (x,z) over this platform's surface, allowing for the body's own width?
 *
 * Exported because a platform is a floor and something other than the support
 * query has to be able to say so: an authored traversal path walks a capsule
 * along anchors, and without this it can rise straight through a staging.
 *
 * The margin is NEGATIVE against the footprint — the point has to be inside by
 * the radius rather than merely near it — because a body pulling onto the lip
 * of a deck legitimately has its capsule overlapping the edge on the way up,
 * and refusing that would refuse every mantle in the game.
 */
export function platformCovers(
  platform: Platform,
  x: number,
  z: number,
  radius = 0,
): boolean {
  if (platform.polygon) {
    if (!pointInPolygon(x, z, platform.polygon)) return false;
    if (radius <= 0) return true;
    // Inside by at least `radius`, matching the rect branch's negative margin: a
    // polygon deck used to ignore the radius entirely, so a swept path skimming
    // its edge read as never crossing it while an identical rect deck read as
    // crossing — the far side of the same "you rise through the boards" defect,
    // just for the polygon half of the world. The point has to sit a body's
    // radius clear of every edge, not merely inside the outline.
    const poly = platform.polygon;
    let minDistSq = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = pointSegmentDistanceSq(
        x,
        z,
        poly[j]![0],
        poly[j]![1],
        poly[i]![0],
        poly[i]![1],
      );
      if (d < minDistSq) minDistSq = d;
    }
    return minDistSq >= radius * radius;
  }
  return pointInRect(
    x,
    z,
    platform.minX,
    platform.maxX,
    platform.minZ,
    platform.maxZ,
    -radius,
  );
}

/**
 * Does a capsule of `radius` centred at (x,z) overlap this platform's footprint?
 *
 * A COLLISION TEST EXPANDS THE FOOTPRINT, IT DOES NOT ERODE IT. A body whose
 * capsule so much as clips a deck's boards is over the deck for the purpose of
 * "may it pass through" — the opposite margin from `platformCovers`, which asks
 * whether the body is safely ON the surface and deliberately shrinks the deck so
 * a mantle onto the lip is not read as standing. Eroding here let a capsule pass
 * through the outer radius of every deck, and made a plank narrower than the
 * body invisible to the sweep entirely. So this dilates: inside the outline, or
 * within a radius of any edge, counts — which also means a platform thinner than
 * a body's diameter is still a wall to it.
 */
export function platformFootprintOverlaps(
  platform: Platform,
  x: number,
  z: number,
  radius: number,
): boolean {
  if (platform.polygon) {
    if (pointInPolygon(x, z, platform.polygon)) return true;
    if (radius <= 0) return false;
    const poly = platform.polygon;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = pointSegmentDistanceSq(
        x,
        z,
        poly[j]![0],
        poly[j]![1],
        poly[i]![0],
        poly[i]![1],
      );
      if (d <= radius * radius) return true;
    }
    return false;
  }
  // EXACT point-to-rect distance, with ROUNDED corners. Expanding the rect by the
  // radius on each axis (a square-cornered dilation) falsely reports a body near a
  // corner but a clean radius away diagonally as overlapping — a point 0.30m off
  // in each of x and z is 0.30m inside an axis-expanded 0.35m rect yet 0.424m from
  // the true corner. The Minkowski sum of a rect and a disc has quarter-circle
  // corners, so the honest test is the squared distance from the point to the rect.
  const dx = Math.max(platform.minX - x, 0, x - platform.maxX);
  const dz = Math.max(platform.minZ - z, 0, z - platform.maxZ);
  return dx * dx + dz * dz <= radius * radius;
}

/**
 * Squared minimum distance between two 2D segments — zero when they cross, else
 * the least of the four endpoint-to-segment distances. Exact; no sampling.
 */
function segmentSegmentDistanceSq(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): number {
  if (segmentsIntersect2d(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  return Math.min(
    pointSegmentDistanceSq(ax, az, cx, cz, dx, dz),
    pointSegmentDistanceSq(bx, bz, cx, cz, dx, dz),
    pointSegmentDistanceSq(cx, cz, ax, az, bx, bz),
    pointSegmentDistanceSq(dx, dz, ax, az, bx, bz),
  );
}

/**
 * Does the swept capsule of `radius` whose CENTRE travels the segment (ax,az)->
 * (bx,bz) overlap this platform's footprint? EXACT, not sampled: the swept
 * capsule is the Minkowski sum of the segment and a disc — a stadium of radius r
 * around the segment — and it overlaps the footprint exactly when the minimum
 * distance from the segment to the footprint is at most the radius. Zero distance
 * (the segment enters the interior or crosses an edge) is a hit; otherwise the
 * true distance to the edges decides, with correctly rounded corners. Tangency —
 * the segment exactly a radius away — counts as contact (a body grazing the
 * boards is over them), which is the safe boundary for a floor test.
 */
function sweptSegmentOverlapsPlatform(
  platform: Platform,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  radius: number,
): boolean {
  const r2 = radius * radius;
  if (platform.polygon) {
    const poly = platform.polygon;
    // Interior contact: either end inside the outline.
    if (pointInPolygon(ax, az, poly) || pointInPolygon(bx, bz, poly)) return true;
    let minSq = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const d = segmentSegmentDistanceSq(
        ax, az, bx, bz,
        poly[j]![0], poly[j]![1], poly[i]![0], poly[i]![1],
      );
      if (d <= r2) return true;
      if (d < minSq) minSq = d;
    }
    return minSq <= r2;
  }
  const { minX, maxX, minZ, maxZ } = platform;
  if (segmentIntersectsRect(ax, az, bx, bz, minX, maxX, minZ, maxZ)) return true;
  const edges: Array<[number, number, number, number]> = [
    [minX, minZ, maxX, minZ],
    [maxX, minZ, maxX, maxZ],
    [maxX, maxZ, minX, maxZ],
    [minX, maxZ, minX, minZ],
  ];
  for (const [px, pz, qx, qz] of edges) {
    if (segmentSegmentDistanceSq(ax, az, bx, bz, px, pz, qx, qz) <= r2) return true;
  }
  return false;
}

/**
 * The first platform plane a swept CAPSULE passes THROUGH, or null.
 *
 * THE ONE PLACE THAT KNOWS A DECK IS A FLOOR TO A MOVING BODY, and it is a TRUE
 * swept test over the whole segment and the whole capsule, not a check at the
 * endpoints. A platform has a single y and no solid span, so `sweepXZ`,
 * `headClearance` and the intrusion predicate are all blind to it — correct for
 * the side (you walk under a roof) and wrong for the plane (a body must not drive
 * its head, its middle, or its feet through the boards). Every path that is
 * placed rather than swept — an authored vault, a reduced-motion completion, a
 * validated move whose world then changed — has to ask this.
 *
 * THE TEST, STATED ONCE: the plane is crossed when, at some point along the
 * motion, the plane lies STRICTLY inside the capsule's vertical span AND the
 * capsule's disc (its footprint, expanded by the radius) overlaps the platform.
 * That single condition covers every way a body can drive through a deck:
 *
 *   - a horizontal passage clean THROUGH a deck, outside-to-outside, where both
 *     endpoints are clear of the footprint but the swept disc crosses it;
 *   - a diagonal crossing;
 *   - the head rising up through the underside;
 *   - a descent passing through an INTERMEDIATE deck on the way down.
 *
 * And it deliberately does NOT catch a legitimate landing, because a body coming
 * down onto a deck's top has its feet AT the plane and its body ABOVE it — the
 * plane is at the boundary of the span, never strictly inside — so support and
 * `landingValid` own that. The surfaces the move legitimately touches (the deck
 * it leaves, the deck it tops out on, a crate it vaults) are named in `ignore`;
 * everything else is a floor. The span is opened by a contact epsilon at both
 * ends so standing on, or leaving, a plane is never a crossing.
 */
export function sweptCapsuleCrossesPlatform(
  world: CollisionWorld,
  from: Vec3,
  to: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): Platform | null {
  const eps = CONTACT_EPS;
  const foot0 = from.y;
  const dfoot = to.y - foot0;
  for (const platform of world.platforms) {
    if (ignore?.has(platform.id)) continue;
    const py = platform.y;
    // The band of foot heights for which the plane is STRICTLY inside the span:
    //   foot + eps < py < foot + height - eps   <=>   py - height + eps < foot < py - eps
    const footLo = py - height + eps;
    const footHi = py - eps;
    // Solve for the sub-interval of t in [0,1] where foot(t) is in (footLo, footHi).
    let tLo: number;
    let tHi: number;
    if (Math.abs(dfoot) < HEIGHT_EPS) {
      if (!(foot0 > footLo && foot0 < footHi)) continue; // never straddles
      tLo = 0;
      tHi = 1;
    } else {
      const ta = (footLo - foot0) / dfoot;
      const tb = (footHi - foot0) / dfoot;
      tLo = Math.max(0, Math.min(ta, tb));
      tHi = Math.min(1, Math.max(ta, tb));
      if (tLo >= tHi) continue; // the straddle band is outside [0,1]
    }
    // The swept capsule's centre travels this straddling sub-segment. Whether it
    // touches the footprint is an EXACT segment-vs-footprint distance test, not a
    // march of point samples — no coarse step to slip a thin plank through or to
    // clip a rounded corner on.
    const ax = from.x + (to.x - from.x) * tLo;
    const az = from.z + (to.z - from.z) * tLo;
    const bx = from.x + (to.x - from.x) * tHi;
    const bz = from.z + (to.z - from.z) * tHi;
    if (sweptSegmentOverlapsPlatform(platform, ax, az, bx, bz, radius)) {
      return platform;
    }
  }
  return null;
}

/**
 * The lowest platform plane strictly above a standing capsule's crown at (x,z),
 * or Infinity. A deck is a ceiling to a rising body the way a blocker base is —
 * `headClearance` cannot see it — so the ballistic step clamps the rise against
 * this. The footprint is expanded by the radius, so a body rising beside a deck's
 * edge stops on the boards rather than shooting up past their overhang.
 */
export function platformCeilingAt(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  height: number,
  ignore?: ReadonlySet<string>,
): number {
  const headY = footY + height;
  let ceiling = Infinity;
  for (const platform of world.platforms) {
    if (ignore?.has(platform.id)) continue;
    if (platform.y < headY - CONTACT_EPS) continue;
    if (!platformFootprintOverlaps(platform, x, z, radius)) continue;
    if (platform.y < ceiling) ceiling = platform.y;
  }
  return ceiling;
}

// Does a vertical capsule span [footY, headY] intersect a solid box's span?
function spanOverlaps(footY: number, headY: number, baseY: number, topY: number): boolean {
  return headY > baseY + HEIGHT_EPS && footY < topY - HEIGHT_EPS;
}

// ---- zero-radius line of sight ---------------------------------------------

// LOS is a mathematical, zero-radius segment. Blocker footprints and vertical
// spans are closed: touching a face/edge/corner, including at either query
// endpoint, is occluded. Callers that intentionally begin/end on an owning
// collider must pass that collider id in `ignore`. Platforms are support-only
// and never occlude. No player-capsule radius or tolerance is added.
function segmentSpanInterval(
  start: number,
  end: number,
  min: number,
  max: number,
): readonly [number, number] | null {
  const delta = end - start;
  if (delta === 0) {
    return start >= min && start <= max ? [0, 1] : null;
  }
  const first = (min - start) / delta;
  const second = (max - start) / delta;
  const enter = Math.max(0, Math.min(first, second));
  const exit = Math.min(1, Math.max(first, second));
  return enter <= exit ? [enter, exit] : null;
}

function segmentIntersectsRect(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): boolean {
  const xInterval = segmentSpanInterval(ax, bx, minX, maxX);
  if (!xInterval) return false;
  const zInterval = segmentSpanInterval(az, bz, minZ, maxZ);
  if (!zInterval) return false;
  return Math.max(xInterval[0], zInterval[0]) <= Math.min(xInterval[1], zInterval[1]);
}

function pointSegmentDistanceSq(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t =
    lengthSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lengthSq));
  const nearestX = ax + dx * t;
  const nearestZ = az + dz * t;
  const offsetX = px - nearestX;
  const offsetZ = pz - nearestZ;
  return offsetX * offsetX + offsetZ * offsetZ;
}

function cross2d(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
): number {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function pointOnSegment2d(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  return (
    cross2d(ax, az, bx, bz, px, pz) === 0 &&
    px >= Math.min(ax, bx) &&
    px <= Math.max(ax, bx) &&
    pz >= Math.min(az, bz) &&
    pz <= Math.max(az, bz)
  );
}

function segmentsIntersect2d(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
): boolean {
  const abC = cross2d(ax, az, bx, bz, cx, cz);
  const abD = cross2d(ax, az, bx, bz, dx, dz);
  const cdA = cross2d(cx, cz, dx, dz, ax, az);
  const cdB = cross2d(cx, cz, dx, dz, bx, bz);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  ) {
    return true;
  }
  return (
    (abC === 0 && pointOnSegment2d(cx, cz, ax, az, bx, bz)) ||
    (abD === 0 && pointOnSegment2d(dx, dz, ax, az, bx, bz)) ||
    (cdA === 0 && pointOnSegment2d(ax, az, cx, cz, dx, dz)) ||
    (cdB === 0 && pointOnSegment2d(bx, bz, cx, cz, dx, dz))
  );
}

function segmentIntersectsCapsule(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  dx: number,
  dz: number,
  radius: number,
): boolean {
  if (segmentsIntersect2d(ax, az, bx, bz, cx, cz, dx, dz)) return true;
  const distanceSq = Math.min(
    pointSegmentDistanceSq(ax, az, cx, cz, dx, dz),
    pointSegmentDistanceSq(bx, bz, cx, cz, dx, dz),
    pointSegmentDistanceSq(cx, cz, ax, az, bx, bz),
    pointSegmentDistanceSq(dx, dz, ax, az, bx, bz),
  );
  return distanceSq <= radius * radius;
}

function segmentIntersectsFootprint(
  blocker: Blocker,
  a: Vec3,
  b: Vec3,
  fromT: number,
  toT: number,
): boolean {
  const startX = a.x + (b.x - a.x) * fromT;
  const startZ = a.z + (b.z - a.z) * fromT;
  const endX = a.x + (b.x - a.x) * toT;
  const endZ = a.z + (b.z - a.z) * toT;
  const footprint = blocker.footprint;
  if (!footprint) {
    return segmentIntersectsRect(
      startX,
      startZ,
      endX,
      endZ,
      blocker.minX,
      blocker.maxX,
      blocker.minZ,
      blocker.maxZ,
    );
  }
  if (footprint.kind === "obb") {
    const c = Math.cos(footprint.yaw);
    const s = Math.sin(footprint.yaw);
    const toLocal = (x: number, z: number) => {
      const dx = x - footprint.cx;
      const dz = z - footprint.cz;
      return { x: dx * c - dz * s, z: dx * s + dz * c };
    };
    const localStart = toLocal(startX, startZ);
    const localEnd = toLocal(endX, endZ);
    return segmentIntersectsRect(
      localStart.x,
      localStart.z,
      localEnd.x,
      localEnd.z,
      -footprint.halfX,
      footprint.halfX,
      -footprint.halfZ,
      footprint.halfZ,
    );
  }
  return segmentIntersectsCapsule(
    startX,
    startZ,
    endX,
    endZ,
    footprint.ax,
    footprint.az,
    footprint.bx,
    footprint.bz,
    footprint.radius,
  );
}

export function segmentOccluderIds(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const candidates = broadPhaseCandidates(world, {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  });
  for (const blockerIndex of candidates) {
    const blocker = world.blockers[blockerIndex]!;
    if (ignore?.has(blocker.id)) continue;
    const vertical = segmentSpanInterval(a.y, b.y, blocker.baseY, blocker.topY);
    if (!vertical) continue;
    if (segmentIntersectsFootprint(blocker, a, b, vertical[0], vertical[1])) {
      ids.push(blocker.id);
    }
  }
  return ids;
}

export function segmentClear(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): boolean {
  return segmentOccluderIds(world, a, b, ignore).length === 0;
}

/**
 * Everything the CAMERA is blocked by along a->b: the solids `segmentOccluderIds`
 * finds, PLUS the drawn-only `cameraOccluders` a body would pass through.
 *
 * This is deliberately a separate entry point from `segmentOccluderIds`. That
 * one decides sight lines, cover and projectiles, where an invisible box with no
 * collision must NOT count — a guard cannot be blinded by a volume that stops
 * nothing, and a thrown object cannot be stopped by one. The camera is the one
 * consumer for which "drawn but not solid" is still an obstacle, so it gets its
 * own query and nothing else inherits the canopy.
 *
 * Camera occluders are few (one per canopy/awning), so they are scanned
 * linearly; the solid broad phase inside `segmentOccluderIds` is unchanged.
 */
export function cameraSegmentOccluderIds(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids = segmentOccluderIds(world, a, b, ignore);
  const occluders = world.cameraOccluders;
  if (occluders) {
    for (const occ of occluders) {
      if (ignore?.has(occ.id)) continue;
      const vertical = segmentSpanInterval(a.y, b.y, occ.baseY, occ.topY);
      if (!vertical) continue;
      const startX = a.x + (b.x - a.x) * vertical[0];
      const startZ = a.z + (b.z - a.z) * vertical[0];
      const endX = a.x + (b.x - a.x) * vertical[1];
      const endZ = a.z + (b.z - a.z) * vertical[1];
      if (
        segmentIntersectsRect(
          startX,
          startZ,
          endX,
          endZ,
          occ.minX,
          occ.maxX,
          occ.minZ,
          occ.maxZ,
        )
      ) {
        ids.push(occ.id);
      }
    }
  }
  return ids;
}

/** Is the camera's line a->b clear of both solids and drawn-only occluders? */
export function cameraSegmentClear(
  world: CollisionWorld,
  a: Vec3,
  b: Vec3,
  ignore?: ReadonlySet<string>,
): boolean {
  return cameraSegmentOccluderIds(world, a, b, ignore).length === 0;
}

// ---- segment vs actor ------------------------------------------------------
//
// Actors are NOT blockers. A person must not occlude a sightline and must not
// block traversal, so they are absent from the CollisionWorld entirely — which
// means a projectile that should hit or pass a body cannot use the world queries
// above. This is that test: the same closest-approach maths the blocker footprints
// use, against a free-standing vertical capsule, with the vertical band included.
//
// The vertical band is not a shortcut. It is what makes crouching mean something
// in both directions: a ball aimed at a standing torso genuinely passes over a
// body that has dropped below it, and a thrown object arcing down genuinely
// catches a body on the way past.

export interface SegmentCapsuleHit {
  /** Parametric position along the segment, 0..1, of the closest approach. */
  readonly t: number;
  /** Squared horizontal distance at closest approach. */
  readonly distanceSq: number;
}

/**
 * Does the segment a->b touch a vertical capsule standing at `footPos`?
 *
 * Returns the closest approach WITHIN the span of the segment that is actually
 * inside the body's vertical band, so a sloped or arcing segment is handled
 * correctly rather than being judged by one of its endpoints.
 */
export function segmentHitsCapsule(
  a: Vec3,
  b: Vec3,
  footPos: Vec3,
  height: number,
  radius: number = CAPSULE_RADIUS,
): SegmentCapsuleHit | null {
  if (height <= 0 || radius < 0) return null;
  const vertical = segmentSpanInterval(a.y, b.y, footPos.y, footPos.y + height);
  if (!vertical) return null;
  const [enter, exit] = vertical;

  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  // Closest approach to the capsule axis, clamped to the part of the segment that
  // is inside the vertical band.
  const unclamped =
    lengthSq <= 1e-12
      ? enter
      : ((footPos.x - a.x) * dx + (footPos.z - a.z) * dz) / lengthSq;
  const t = Math.max(enter, Math.min(exit, unclamped));
  const offsetX = footPos.x - (a.x + dx * t);
  const offsetZ = footPos.z - (a.z + dz * t);
  const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
  return distanceSq <= radius * radius ? { t, distanceSq } : null;
}

/**
 * The first actor a segment hits, in authored order on a tie. Callers pass their
 * own actor list because actor bookkeeping (sides, teams, downed state) is theirs;
 * only the geometry is the engine's.
 */
export function firstActorHit<T extends BodyPose & { id: string }>(
  a: Vec3,
  b: Vec3,
  actors: readonly T[],
  radius: number = CAPSULE_RADIUS,
): { actor: T; hit: SegmentCapsuleHit } | null {
  let best: { actor: T; hit: SegmentCapsuleHit } | null = null;
  for (const actor of actors) {
    const hit = segmentHitsCapsule(
      a,
      b,
      actor.pos,
      actor.capsuleHeight,
      radius,
    );
    if (!hit) continue;
    if (!best || hit.t < best.hit.t - 1e-12) best = { actor, hit };
  }
  return best;
}

// Would a capsule footprint at (x,z) intrude into this blocker's XZ box,
// expanded by the capsule radius?
function intrudesXZ(b: Blocker, x: number, z: number, radius: number): boolean {
  if (!b.footprint) {
    return pointInRect(x, z, b.minX, b.maxX, b.minZ, b.maxZ, radius);
  }
  if (b.footprint.kind === "obb") {
    const dx = x - b.footprint.cx;
    const dz = z - b.footprint.cz;
    const c = Math.cos(b.footprint.yaw);
    const s = Math.sin(b.footprint.yaw);
    // Inverse of Three's Y rotation used by the placement adapter:
    // worldX = localX*c + localZ*s; worldZ = -localX*s + localZ*c.
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    return (
      Math.abs(localX) <= b.footprint.halfX + radius &&
      Math.abs(localZ) <= b.footprint.halfZ + radius
    );
  }
  const shape = b.footprint;
  const abX = shape.bx - shape.ax;
  const abZ = shape.bz - shape.az;
  const lenSq = abX * abX + abZ * abZ;
  const t =
    lenSq > 1e-12
      ? Math.max(
          0,
          Math.min(
            1,
            ((x - shape.ax) * abX + (z - shape.az) * abZ) / lenSq,
          ),
        )
      : 0;
  const nearestX = shape.ax + abX * t;
  const nearestZ = shape.az + abZ * t;
  const offX = x - nearestX;
  const offZ = z - nearestZ;
  return Math.sqrt(offX * offX + offZ * offZ) <= shape.radius + radius;
}

export function positionClear(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): boolean {
  return blockerIdsAt(world, pos, radius, height, ignore).length === 0;
}

export function blockerIdsAt(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: pos.x - broadRadius,
    maxX: pos.x + broadRadius,
    minZ: pos.z - broadRadius,
    maxZ: pos.z + broadRadius,
    minY: pos.y,
    maxY: pos.y + height,
  });
  for (const blockerIndex of candidates) {
    const blocker = world.blockers[blockerIndex]!;
    if (ignore?.has(blocker.id)) continue;
    if (intrudesXZ(blocker, pos.x, pos.z, radius)) ids.push(blocker.id);
  }
  return ids;
}

/**
 * How many resolution passes a single step gets, and how far it may move a body.
 *
 * Four is the number every commercial controller lands on — Unreal, Unity and
 * Source all iterate three or four times — because one pass resolves one
 * contact and a body wedged in a corner has two. Re-measuring between passes is
 * what makes it converge instead of oscillate: after the deepest overlap is
 * pushed out, the second one is measured from where the body now is, so a
 * corner walks out diagonally rather than being pushed twice in the same frame.
 *
 * The budget is a safety rail, not a tuning knob. A body that is somehow half a
 * metre inside something is in a situation this function cannot honestly fix,
 * and shoving it that far in one frame would look like a teleport; better to
 * move it as far as the budget allows and let the next frame continue.
 */
const DEPENETRATION_PASSES = 4;
const DEPENETRATION_BUDGET_M = 0.5;
// Clear of the face rather than exactly on it, matching the sweep's own skin.
const DEPENETRATION_SKIN = 1e-4;

export interface OverlapResolution {
  x: number;
  z: number;
  /** True when the body ended the resolution touching nothing. */
  clear: boolean;
  /** How far the body was pushed, for diagnostics and event thresholds. */
  movedM: number;
}

/**
 * Push a body out of anything it is standing inside.
 *
 * THE SWEEP CANNOT DO THIS AND IS NOT SUPPOSED TO. `sweepXZ` stops a body
 * before it enters a blocker, which is the whole job while the body is moving
 * under its own power. It has nothing to say about a body that is ALREADY
 * inside one, and there are several honest ways to get there: an authored verb
 * whose path was validated and whose world then changed, a door or route swap
 * that registers a collider where a player is standing, a spawn onto a spot
 * something else occupies, or the accumulated 1e-5 skins of a long slide along
 * a corner. Before this existed such a body stayed embedded indefinitely — it
 * escaped only if the player happened to push outward, which is the "you glitch
 * on objects" the owner reported.
 *
 * WHAT HAPPENS WITH TWO BLOCKERS AT ONCE, since that is the case that makes
 * naive implementations misbehave: the overlaps are measured, sorted deepest
 * first, and only the deepest is resolved per pass, with everything re-measured
 * from the new position on the next pass. Resolving each independently and
 * summing the pushes is the tempting version and it is wrong twice over — in an
 * inside corner it ejects the body roughly twice as far as either wall needs,
 * and between two facing walls the two pushes cancel and it never moves at all.
 * Deepest-first with re-measurement converges on the corner instead, and when
 * no solution exists — a slot narrower than the body — the loop notices it is
 * not making progress and stops rather than jittering. Ties are broken by
 * authored blocker order, so the result is identical on every machine.
 *
 * A body this cannot free is left where it is and reported with `clear: false`.
 * That is deliberate: it is still recoverable by walking (the sweep lets an
 * embedded body move outward), and a caller that wants a stronger remedy can
 * fall back to `depenetrateXZ`'s ring search. Teleporting somebody several
 * metres is worse than the problem.
 */
export function resolveOverlapXZ(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): OverlapResolution {
  let x = pos.x;
  let z = pos.z;
  let budget = DEPENETRATION_BUDGET_M;
  let clear = false;

  for (let pass = 0; pass < DEPENETRATION_PASSES; pass++) {
    const candidates = broadPhaseCandidates(world, {
      minX: x - radius * BROAD_PHASE_RADIUS_FACTOR,
      maxX: x + radius * BROAD_PHASE_RADIUS_FACTOR,
      minZ: z - radius * BROAD_PHASE_RADIUS_FACTOR,
      maxZ: z + radius * BROAD_PHASE_RADIUS_FACTOR,
      minY: pos.y,
      maxY: pos.y + height,
    });
    let deepest: { depth: number; nx: number; nz: number } | null = null;
    for (const blockerIndex of candidates) {
      const blocker = world.blockers[blockerIndex]!;
      if (ignore?.has(blocker.id)) continue;
      const mtv = minimumTranslationXZ(blocker, x, z, radius);
      if (!mtv) continue;
      // Strictly deeper, so an earlier authored blocker wins a tie.
      if (!deepest || mtv.depth > deepest.depth) deepest = mtv;
    }
    if (!deepest) {
      clear = true;
      break;
    }
    const push = Math.min(deepest.depth + DEPENETRATION_SKIN, budget);
    if (push <= 0) break;
    x += deepest.nx * push;
    z += deepest.nz * push;
    budget -= push;
  }

  return {
    x,
    z,
    clear,
    movedM: Math.sqrt((x - pos.x) * (x - pos.x) + (z - pos.z) * (z - pos.z)),
  };
}

export interface CapsulePenetration {
  id: string;
  /** How far the capsule is inside the blocker's nearest face, in metres. */
  depthM: number;
}

/**
 * The solid blockers the capsule at `pos` is embedded in beyond a skin
 * tolerance — the canonical non-penetration invariant.
 *
 * THIS IS THE ONE PREDICATE the dev/test runtime asserts every tick and the
 * traversal fuzzer gates on: a non-empty result is a capsule that ended a frame
 * inside something solid, which is the "glitch through objects" the owner sees.
 * It is radius- and span-aware (the same expanded footprint the sweep uses) and
 * it ignores the sub-skin "resting against a wall" contact the sweep leaves on
 * purpose, so a body merely leaning on a wall does not read as a violation.
 *
 * `ignore` is the caller's legitimate set — the low kerbs the grounded solver
 * steps through, the obstacle an authored vault is crossing — passed exactly as
 * the solver passes it, so the invariant never flags the solver's own intent.
 */
export function capsuleEmbeddedIn(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
  skin = CONTACT_EPS,
): CapsulePenetration[] {
  const out: CapsulePenetration[] = [];
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: pos.x - broadRadius,
    maxX: pos.x + broadRadius,
    minZ: pos.z - broadRadius,
    maxZ: pos.z + broadRadius,
    minY: pos.y,
    maxY: pos.y + height,
  });
  for (const blockerIndex of candidates) {
    const blocker = world.blockers[blockerIndex]!;
    if (ignore?.has(blocker.id)) continue;
    const mtv = minimumTranslationXZ(blocker, pos.x, pos.z, radius);
    if (mtv && mtv.depth > skin) out.push({ id: blocker.id, depthM: mtv.depth });
  }
  return out;
}

/**
 * The shortest push that would take a body at (x, z) out of `blocker`, or null
 * when it is not meaningfully inside it. Shares its axis choice with
 * `blockerContactNormal` so a depenetration and a slide never disagree about
 * which face the body is against.
 *
 * "Meaningfully" is doing work: `sweepXZ` deliberately leaves a body a hair's
 * breadth off every face it stops against, and `intrudesXZ` treats a footprint
 * as closed, so a body resting on a wall is a rounding error away from reading
 * as inside it. Ignoring sub-skin depths keeps a player leaning on a wall from
 * being nudged a tenth of a millimetre every frame for the rest of the run.
 */
function minimumTranslationXZ(
  blocker: Blocker,
  x: number,
  z: number,
  radius: number,
): { depth: number; nx: number; nz: number } | null {
  if (!intrudesXZ(blocker, x, z, radius)) return null;
  const footprint = blocker.footprint;

  if (footprint?.kind === "capsule") {
    const abX = footprint.bx - footprint.ax;
    const abZ = footprint.bz - footprint.az;
    const lengthSq = abX * abX + abZ * abZ;
    const t =
      lengthSq > 1e-12
        ? Math.max(
            0,
            Math.min(
              1,
              ((x - footprint.ax) * abX + (z - footprint.az) * abZ) / lengthSq,
            ),
          )
        : 0;
    const dx = x - (footprint.ax + abX * t);
    const dz = z - (footprint.az + abZ * t);
    const distance = Math.sqrt(dx * dx + dz * dz);
    const depth = footprint.radius + radius - distance;
    if (depth <= DEPENETRATION_SKIN) return null;
    const [nx, nz] = blockerContactNormal(blocker, x, z, radius);
    return { depth, nx, nz };
  }

  let localX = x;
  let localZ = z;
  let halfX = (blocker.maxX - blocker.minX) / 2;
  let halfZ = (blocker.maxZ - blocker.minZ) / 2;
  let centerX = (blocker.minX + blocker.maxX) / 2;
  let centerZ = (blocker.minZ + blocker.maxZ) / 2;
  if (footprint?.kind === "obb") {
    const dx = x - footprint.cx;
    const dz = z - footprint.cz;
    const c = Math.cos(footprint.yaw);
    const s = Math.sin(footprint.yaw);
    localX = dx * c - dz * s;
    localZ = dx * s + dz * c;
    halfX = footprint.halfX;
    halfZ = footprint.halfZ;
    centerX = 0;
    centerZ = 0;
  }
  const dx = localX - centerX;
  const dz = localZ - centerZ;
  const escapeX = halfX + radius - Math.abs(dx);
  const escapeZ = halfZ + radius - Math.abs(dz);
  const depth = Math.min(escapeX, escapeZ);
  if (depth <= DEPENETRATION_SKIN) return null;
  const [nx, nz] = blockerContactNormal(blocker, x, z, radius);
  return { depth, nx, nz };
}

// Bounded deterministic recovery for a position that became embedded after a
// route/collision registration change. Search nearest rings first; callers may
// roll back to their last-safe point if no local solution exists.
export function depenetrateXZ(
  world: CollisionWorld,
  pos: Vec3,
  radius: number,
  height: number,
  maxDistance = 0.8,
): Vec3 | null {
  if (positionClear(world, pos, radius, height)) return { ...pos };
  const step = 0.05;
  const directions = 24;
  for (let distance = step; distance <= maxDistance + 1e-6; distance += step) {
    for (let index = 0; index < directions; index++) {
      const angle = (index / directions) * Math.PI * 2;
      const candidate = {
        x: pos.x + Math.cos(angle) * distance,
        y: pos.y,
        z: pos.z + Math.sin(angle) * distance,
      };
      if (
        candidate.x < world.bounds.minX ||
        candidate.x > world.bounds.maxX ||
        candidate.z < world.bounds.minZ ||
        candidate.z > world.bounds.maxZ
      ) continue;
      if (positionClear(world, candidate, radius, height)) return candidate;
    }
  }
  return null;
}

// ---- horizontal sweep ------------------------------------------------------

export interface SweepResult {
  x: number;
  z: number;
  blockedX: boolean;
  blockedZ: boolean;
  hitIds: string[];
  /** Outward contact normals, in deterministic hit order. */
  hitNormals: ReadonlyArray<readonly [number, number]>;
}

const SWEEP_SAMPLE_DISTANCE = CAPSULE_RADIUS * 0.25;
const SWEEP_BINARY_STEPS = 18;
const SWEEP_MAX_CONTACTS = 4;
const SWEEP_SKIN = 1e-5;

function blockerContactNormal(
  blocker: Blocker,
  x: number,
  z: number,
  radius: number,
): readonly [number, number] {
  const footprint = blocker.footprint;
  if (footprint?.kind === "capsule") {
    const abX = footprint.bx - footprint.ax;
    const abZ = footprint.bz - footprint.az;
    const lengthSq = abX * abX + abZ * abZ;
    const t =
      lengthSq > 1e-12
        ? Math.max(
            0,
            Math.min(
              1,
              ((x - footprint.ax) * abX + (z - footprint.az) * abZ) /
                lengthSq,
            ),
          )
        : 0;
    const nearestX = footprint.ax + abX * t;
    const nearestZ = footprint.az + abZ * t;
    const dx = x - nearestX;
    const dz = z - nearestZ;
    const length = Math.sqrt(dx * dx + dz * dz);
    if (length > 1e-9) return [dx / length, dz / length];
    const segmentLength = Math.sqrt(abX * abX + abZ * abZ);
    return segmentLength > 1e-9
      ? [-abZ / segmentLength, abX / segmentLength]
      : [1, 0];
  }

  let localX = x;
  let localZ = z;
  let halfX = (blocker.maxX - blocker.minX) / 2;
  let halfZ = (blocker.maxZ - blocker.minZ) / 2;
  let centerX = (blocker.minX + blocker.maxX) / 2;
  let centerZ = (blocker.minZ + blocker.maxZ) / 2;
  let yaw = 0;
  if (footprint?.kind === "obb") {
    centerX = footprint.cx;
    centerZ = footprint.cz;
    halfX = footprint.halfX;
    halfZ = footprint.halfZ;
    yaw = footprint.yaw;
    const dx = x - centerX;
    const dz = z - centerZ;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    localX = dx * c - dz * s;
    localZ = dx * s + dz * c;
    centerX = 0;
    centerZ = 0;
  }
  const dx = localX - centerX;
  const dz = localZ - centerZ;
  const expandedX = halfX + radius;
  const expandedZ = halfZ + radius;
  const distanceX = expandedX - Math.abs(dx);
  const distanceZ = expandedZ - Math.abs(dz);
  let nx = 0;
  let nz = 0;
  if (distanceX <= distanceZ) nx = dx < 0 ? -1 : 1;
  else nz = dz < 0 ? -1 : 1;
  if (footprint?.kind === "obb") {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [nx * c + nz * s, -nx * s + nz * c];
  }
  return [nx, nz];
}

function firstIntrusionTime(
  blocker: Blocker,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): number | null {
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance <= 1e-12) return null;
  const startInside = intrudesXZ(blocker, x, z, radius);
  if (startInside) {
    const normal = blockerContactNormal(blocker, x, z, radius);
    return dx * normal[0] + dz * normal[1] < -1e-10 ? 0 : null;
  }
  const samples = Math.max(1, Math.ceil(distance / SWEEP_SAMPLE_DISTANCE));
  let clearT = 0;
  for (let sample = 1; sample <= samples; sample++) {
    const t = sample / samples;
    if (!intrudesXZ(blocker, x + dx * t, z + dz * t, radius)) {
      clearT = t;
      continue;
    }
    let low = clearT;
    let high = t;
    for (let step = 0; step < SWEEP_BINARY_STEPS; step++) {
      const mid = (low + high) * 0.5;
      if (intrudesXZ(blocker, x + dx * mid, z + dz * mid, radius)) {
        high = mid;
      } else {
        low = mid;
      }
    }
    return low;
  }
  return null;
}

/**
 * The blockers a grounded body walks up instead of into.
 *
 * EVERY CHARACTER CONTROLLER HAS A STEP OFFSET AND THIS ONE DID NOT. The sweep
 * stops the capsule the same distance short of a blocker whatever its height,
 * so a 3cm doorstep and a cathedral wall were the same wall to a running body:
 * measured, a 3cm blocker stopped a full-speed run dead. The parkour ladder was
 * papering over it in play with a 750ms scripted vault over a 10cm kerb, which
 * is a verb doing a job a tolerance should be doing silently.
 *
 * Unreal, Unity and Source all implement this as lift-sweep-drop, which assumes
 * a capsule cast for the drop. This engine's support query is a point at the
 * body's centre, and lift-sweep-drop against a point query lands the body back
 * on the floor in front of the kerb every frame — a 7cm frame of travel never
 * carries the centre far enough to find the top. So the same result is reached
 * the other way round: a low landable top is simply not solid to a body that
 * could stand on it, and the support snap below carries the rise. The body
 * walks at the kerb, through the last third of a metre of it, and steps up as
 * its centre crosses. Same outcome, no lift, nothing to jitter.
 *
 * Only landable finite tops qualify. A non-landable lip of the same height is
 * still a wall, which is what keeps a low parapet from being walked over.
 */
export function lowStepIds(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  maxStepM: number,
): ReadonlySet<string> | undefined {
  if (maxStepM <= 0) return undefined;
  let ids: Set<string> | null = null;
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: x - broadRadius,
    maxX: x + broadRadius,
    minZ: z - broadRadius,
    maxZ: z + broadRadius,
  });
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (!b.landable || !Number.isFinite(b.topY)) continue;
    if (b.topY <= footY + HEIGHT_EPS) continue;
    if (b.topY > footY + maxStepM) continue;
    (ids ??= new Set()).add(b.id);
  }
  return ids ?? undefined;
}

/**
 * Support under a body that is also about to be somewhere.
 *
 * Straight `supportBelow` is a point query at the centre, so a body is held up
 * only once its middle is over a surface — which for a step means the feet
 * would clip a third of a metre into the kerb before rising. Sampling a second
 * point a radius ahead along the travel direction puts the rise at the moment
 * of contact instead, where a person would take it.
 *
 * Deliberately forward only, not a ring. Forward-biased, a body rises early and
 * still falls when its centre leaves a lip, which is the generous direction on
 * both counts; a full ring would also hold it up a radius PAST the lip, which
 * is a body standing on air and a different change (see P4 in the audit).
 */
export function supportAhead(
  world: CollisionWorld,
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  radius: number,
  footY: number,
  snapUp: number,
): Support | null {
  const here = supportBelow(world, x, z, footY, snapUp);
  const length = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (length <= 1e-9) return here;
  const ahead = supportBelow(
    world,
    x + (dirX / length) * radius,
    z + (dirZ / length) * radius,
    footY,
    snapUp,
  );
  if (!here) return ahead;
  if (!ahead) return here;
  return ahead.y > here.y ? ahead : here;
}

/**
 * Projects horizontal velocity onto all contact planes in authored hit order.
 * Keeping this pure and shared prevents grounded and ballistic motion from
 * disagreeing about wall-slide response.
 */
export function slideVelocityXZ(
  velocity: { x: number; z: number },
  normals: ReadonlyArray<readonly [number, number]>,
): { x: number; z: number } {
  let x = velocity.x;
  let z = velocity.z;
  for (const [nx, nz] of normals) {
    const inward = x * nx + z * nz;
    if (inward < 0) {
      x -= nx * inward;
      z -= nz * inward;
    }
  }
  return {
    x: Math.abs(x) < 1e-10 ? 0 : x,
    z: Math.abs(z) < 1e-10 ? 0 : z,
  };
}

// Deterministic swept-capsule slide from `from` to `to`. Each contact advances
// to the earliest clear point, removes only the inward normal component, then
// consumes the tangent remainder. This keeps forward momentum along walls and
// settles cleanly at corners instead of alternating X-first/Z-first dead stops.
// A bounded spatial march plus fixed binary refinement covers AABB, OBB, and
// capsule footprints with the exact same intrusion predicate as positionClear.
export function sweepXZ(
  world: CollisionWorld,
  from: Vec3,
  to: { x: number; z: number },
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): SweepResult {
  const footY = from.y;
  const headY = footY + height;
  const clampedX = Math.min(Math.max(to.x, world.bounds.minX), world.bounds.maxX);
  const clampedZ = Math.min(Math.max(to.z, world.bounds.minZ), world.bounds.maxZ);
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const travelDistance = Math.sqrt(
    (clampedX - from.x) * (clampedX - from.x) + (clampedZ - from.z) * (clampedZ - from.z),
  );
  // Contact projection can bend the remaining path outside the direct
  // start-to-end AABB. Every projected segment preserves or shortens its
  // remaining length, so the start-centred travel radius is a conservative
  // bound for every possible slide contact.
  const active = broadPhaseCandidates(world, {
    minX: from.x - travelDistance - broadRadius,
    maxX: from.x + travelDistance + broadRadius,
    minZ: from.z - travelDistance - broadRadius,
    maxZ: from.z + travelDistance + broadRadius,
    minY: footY,
    maxY: headY,
  });
  const hitIds: string[] = [];
  const hitNormals: Array<readonly [number, number]> = [];
  let x = from.x;
  let z = from.z;
  let dx = clampedX - from.x;
  let dz = clampedZ - from.z;

  for (let contact = 0; contact < SWEEP_MAX_CONTACTS; contact++) {
    if (Math.sqrt(dx * dx + dz * dz) <= 1e-10) break;
    let bestT = 1;
    let best: Blocker | null = null;
    for (const blockerIndex of active) {
      const blocker = world.blockers[blockerIndex]!;
      if (ignore?.has(blocker.id)) continue;
      const t = firstIntrusionTime(blocker, x, z, dx, dz, radius);
      if (t !== null && t < bestT - 1e-12) {
        bestT = t;
        best = blocker;
      }
    }
    if (!best) {
      x += dx;
      z += dz;
      dx = 0;
      dz = 0;
      break;
    }

    x += dx * bestT;
    z += dz * bestT;
    const normal = blockerContactNormal(best, x, z, radius);
    if (!hitIds.includes(best.id)) hitIds.push(best.id);
    hitNormals.push(normal);
    // A microscopic outward skin prevents the closed intrusion predicate from
    // re-hitting the same face while preserving sub-millimetre correctness.
    x += normal[0] * SWEEP_SKIN;
    z += normal[1] * SWEEP_SKIN;
    const remaining = 1 - bestT;
    const slid = slideVelocityXZ(
      { x: dx * remaining, z: dz * remaining },
      hitNormals,
    );
    dx = slid.x;
    dz = slid.z;
  }

  x = Math.min(Math.max(x, world.bounds.minX), world.bounds.maxX);
  z = Math.min(Math.max(z, world.bounds.minZ), world.bounds.maxZ);
  const boundBlockedX = clampedX !== to.x;
  const boundBlockedZ = clampedZ !== to.z;
  const blockedX =
    boundBlockedX || hitNormals.some(([nx]) => Math.abs(nx) > 1e-8);
  const blockedZ =
    boundBlockedZ || hitNormals.some(([, nz]) => Math.abs(nz) > 1e-8);
  return { x, z, blockedX, blockedZ, hitIds, hitNormals };
}

// ---- support queries -------------------------------------------------------

export interface Support {
  y: number;
  id: string;
}

// Highest support surface at (x,z) whose top is at or below footY + snapUp.
// Considers the ground plane (y=0), landable blocker tops, and platforms.
// Returns null when nothing (including the ground) is within reach below.
//
// A CENTRE-POINT query, deliberately. What a body rests ON when its footprint
// overlaps a mass but its centre does not — the sliver a fall can drop it into —
// is `rideOutOfEmbed`'s job, gated on the honest landing actually embedding, so
// that edges and authored drops keep their point-query semantics and only a body
// that genuinely ended up inside a mass is lifted onto it.
export function supportBelow(
  world: CollisionWorld,
  x: number,
  z: number,
  footY: number,
  snapUp = SUPPORT_SNAP_UP,
): Support | null {
  const ceil = footY + snapUp;
  let best: Support | null = null;
  const consider = (y: number, id: string) => {
    if (y > ceil + HEIGHT_EPS) return;
    if (!best || y > best.y) best = { y, id };
  };
  // Ground plane.
  consider(0, "GROUND");
  const candidates = broadPhaseCandidates(world, {
    minX: x,
    maxX: x,
    minZ: z,
    maxZ: z,
  });
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (!b.landable || !Number.isFinite(b.topY)) continue;
    if (intrudesXZ(b, x, z, 0)) consider(b.topY, b.id);
  }
  for (const p of world.platforms) {
    const inside = p.polygon
      ? pointInPolygon(x, z, p.polygon)
      : pointInRect(x, z, p.minX, p.maxX, p.minZ, p.maxZ);
    if (inside) consider(p.y, p.id);
  }
  return best;
}

/**
 * The support a body actually comes to rest on when the honest point support
 * would leave it EMBEDDED in a solid mass.
 *
 * Pass the point support (`supportBelow`/`supportAhead`) as `base`. If standing
 * at `base.y` leaves the capsule clear, `base` is returned unchanged — so an
 * ordinary walk-off, a step, and every authored drop that lands in the open keep
 * their exact point-query behaviour and nothing becomes sticky. Only when the
 * base landing genuinely embeds the capsule — the body fell into the sliver
 * between a landable cart/crate top and the wall behind it, an overlap the sweep
 * never had a chance to refuse because the entry was vertical — does this ride
 * the body up onto the LOWEST landable mass top it overlaps that it can actually
 * stand on (clear, with head room). The body then rests ON the thing it fell
 * against instead of inside it, which is the whole non-penetration invariant on
 * the vertical axis, and it holds the body there on subsequent grounded ticks so
 * it cannot jitter back down into the embed.
 */
export function rideOutOfEmbed(
  world: CollisionWorld,
  x: number,
  z: number,
  base: Support | null,
  radius: number,
  height: number,
  ignore?: ReadonlySet<string>,
): Support | null {
  if (!base) return base;
  if (capsuleEmbeddedIn(world, { x, y: base.y, z }, radius, height, ignore).length === 0) {
    return base;
  }
  let best: Support | null = null;
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  // SNAPSHOT the candidate indices. `broadPhaseCandidates` returns a per-world
  // scratch array it reuses on every call, and the loop below calls
  // `capsuleEmbeddedIn` (and, through it, `broadPhaseCandidates`) again per
  // candidate — which would clear and refill that same scratch mid-iteration,
  // corrupting not only this loop but any collision query in flight. Copying the
  // indices once makes the iteration independent of the shared buffer.
  const candidates = [
    ...broadPhaseCandidates(world, {
      minX: x - broadRadius,
      maxX: x + broadRadius,
      minZ: z - broadRadius,
      maxZ: z + broadRadius,
    }),
  ];
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (ignore?.has(b.id)) continue;
    if (!b.landable || !Number.isFinite(b.topY)) continue;
    if (b.topY <= base.y + HEIGHT_EPS) continue; // above the honest floor
    if (!intrudesXZ(b, x, z, radius)) continue; // the capsule is over this mass
    // The CENTRE must be beside the mass, not over it. A body whose centre is
    // over a mass top is landing on it the ordinary way — the point support
    // already found it — and a body DESCENDING OFF a mass (an authored drop) has
    // its centre over that mass until its momentum carries it clear, so riding it
    // back up would cancel the drop. Only a body wedged in the SLIVER beside a
    // mass, its centre out over the floor of the gap, is the case this exists for.
    if (intrudesXZ(b, x, z, 0)) continue;
    // Standing on this top must itself be clear. `capsuleEmbeddedIn` is the right
    // arbiter: it ignores the sub-skin "resting against the wall" contact that a
    // body wedged in a sliver necessarily has, and it already catches a beam or
    // soffit whose solid span would cut the standing capsule (that reads as a
    // lateral embed), so no separate head-clearance test is needed — and the
    // head-clearance test would wrongly reject the cart top here, because the
    // capsule touches the tall wall behind it at exactly a radius.
    if (capsuleEmbeddedIn(world, { x, y: b.topY, z }, radius, height, ignore).length > 0) {
      continue;
    }
    // A deck has no solid span for the embed test to see, so guard it explicitly:
    // do not rest the body where a deck plane would cut its torso.
    if (deckThroughBody(world, x, z, b.topY, height)) continue;
    if (!best || b.topY < best.y) best = { y: b.topY, id: b.id };
  }
  return best ?? base;
}

// The platform the feet currently rest on (within its rect and within
// CONTACT_EPS of its surface), if any. Used to drive on-roof clamping.
export function platformUnderFoot(
  world: CollisionWorld,
  x: number,
  z: number,
  footY: number,
): Platform | null {
  let best: Platform | null = null;
  for (const p of world.platforms) {
    const inside = p.polygon
      ? pointInPolygon(x, z, p.polygon)
      : pointInRect(x, z, p.minX, p.maxX, p.minZ, p.maxZ);
    if (!inside) continue;
    if (Math.abs(footY - p.y) > 0.5) continue;
    if (!best || p.y > best.y) best = p;
  }
  return best;
}

// Vertical clearance above the feet at (x,z): distance from footY up to the
// lowest solid box that starts above the feet. Infinity when nothing is above.
// Used for full-height stand checks (never stand without clearance) and duck
// validation.
export function headClearance(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  ignore?: ReadonlySet<string>,
): number {
  let clearance = Infinity;
  const broadRadius = radius * BROAD_PHASE_RADIUS_FACTOR;
  const candidates = broadPhaseCandidates(world, {
    minX: x - broadRadius,
    maxX: x + broadRadius,
    minZ: z - broadRadius,
    maxZ: z + broadRadius,
  });
  for (const blockerIndex of candidates) {
    const b = world.blockers[blockerIndex]!;
    if (ignore && ignore.has(b.id)) continue;
    if (!intrudesXZ(b, x, z, radius)) continue;
    if (b.baseY <= footY + HEIGHT_EPS) {
      // A box we are already inside/beneath its base: if it is a full wall
      // spanning the feet, there is no vertical clearance here.
      if (b.topY > footY + HEIGHT_EPS) return 0;
      continue;
    }
    clearance = Math.min(clearance, b.baseY - footY);
  }
  return clearance;
}

/**
 * A deck plane that would cut a body standing at (x, z, footY), if any.
 *
 * A platform is a support surface with no thickness and therefore no underside,
 * which is what lets a player walk beneath a roof — but it means `headClearance`
 * cannot see one, and a landing under a low awning passed every test the game
 * had while putting the player's head visibly through the boards. Mantling onto
 * a market counter with its own canopy 0.65m above it was the worst of them.
 *
 * Tested at the body's centre with no radius, the same way `supportBelow` finds
 * the floor, so the two agree about which deck a body is on. An awning whose
 * edge merely clips a shoulder is not a ceiling.
 */
export function deckThroughBody(
  world: CollisionWorld,
  x: number,
  z: number,
  footY: number,
  height: number,
): Platform | null {
  for (const p of world.platforms) {
    if (p.y <= footY + CONTACT_EPS) continue;
    if (p.y >= footY + height - CONTACT_EPS) continue;
    const inside = p.polygon
      ? pointInPolygon(x, z, p.polygon)
      : pointInRect(x, z, p.minX, p.maxX, p.minZ, p.maxZ);
    if (inside) return p;
  }
  return null;
}

// A landing at (x,z, landY) is valid when a support surface sits within
// CONTACT_EPS of landY and a standing capsule of `height` fits above it.
export function landingValid(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  landY: number,
  height: number,
  ignore?: ReadonlySet<string>,
): boolean {
  const support = supportBelow(world, x, z, landY + CONTACT_EPS, CONTACT_EPS + 0.02);
  if (!support) return false;
  if (Math.abs(support.y - landY) > CONTACT_EPS + 0.05) return false;
  if (deckThroughBody(world, x, z, support.y, height)) return false;
  return headClearance(world, x, z, radius, support.y, ignore) >= height - 0.05;
}

// Standing room: is there full standing clearance at (x,z) with feet at footY?
export function canStand(
  world: CollisionWorld,
  x: number,
  z: number,
  radius: number,
  footY: number,
  ignore?: ReadonlySet<string>,
): boolean {
  return headClearance(world, x, z, radius, footY, ignore) >= STAND_HEIGHT - 0.05;
}
