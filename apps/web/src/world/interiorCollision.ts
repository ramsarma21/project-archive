import {
  wallFromOrientedRect,
  wallFromRect,
  type CollisionWorld,
} from "./collision.js";
import type { InteriorDef } from "./interiorManifest.js";

const WALL_HALF = 0.12;
const ENTRANCE_CLEAR_WIDTH = 1.8;

export function buildInteriorCollisionWorld(def: InteriorDef): CollisionWorld {
  const [width, height, depth] = def.dimensions;
  const [ox, , oz] = def.origin;
  const halfW = width / 2;
  const halfD = depth / 2;
  const wallTop = height;
  const frontSideHalf = (width - ENTRANCE_CLEAR_WIDTH) / 4;
  const frontOffset = ENTRANCE_CLEAR_WIDTH / 2 + frontSideHalf;

  const blockers = [
    wallFromRect(
      `${def.id}:wall-back`,
      ox,
      oz + halfD,
      halfW,
      WALL_HALF,
      { topY: wallTop, tags: ["interior", "wall"] },
    ),
    wallFromRect(
      `${def.id}:wall-left`,
      ox - halfW,
      oz,
      WALL_HALF,
      halfD,
      { topY: wallTop, tags: ["interior", "wall"] },
    ),
    wallFromRect(
      `${def.id}:wall-right`,
      ox + halfW,
      oz,
      WALL_HALF,
      halfD,
      { topY: wallTop, tags: ["interior", "wall"] },
    ),
    wallFromRect(
      `${def.id}:wall-front-left`,
      ox - frontOffset,
      oz - halfD,
      frontSideHalf,
      WALL_HALF,
      { topY: wallTop, tags: ["interior", "wall", "door-lane"] },
    ),
    wallFromRect(
      `${def.id}:wall-front-right`,
      ox + frontOffset,
      oz - halfD,
      frontSideHalf,
      WALL_HALF,
      { topY: wallTop, tags: ["interior", "wall", "door-lane"] },
    ),
    // A thin overhead solid spanning the room. It does not overlap a standing
    // capsule but stops ballistic movement from leaving the imported ceiling.
    wallFromRect(
      `${def.id}:ceiling`,
      ox,
      oz,
      halfW,
      halfD,
      {
        baseY: height - 0.14,
        topY: height + 0.18,
        landable: false,
        tags: ["interior", "ceiling"],
      },
    ),
    ...def.colliders.map((collider) =>
      wallFromOrientedRect(
        `${def.id}:prop:${collider.id}`,
        ox + collider.local[0],
        oz + collider.local[2],
        collider.half[0],
        collider.half[2],
        collider.yaw ?? 0,
        {
          baseY: collider.local[1],
          topY: collider.local[1] + collider.half[1] * 2,
          landable: false,
          tags: ["interior", "furniture", ...collider.tags],
        },
      ),
    ),
  ];

  return {
    blockers,
    platforms: [],
    bounds: {
      minX: ox - halfW + 0.45,
      maxX: ox + halfW - 0.45,
      minZ: oz - halfD + 0.45,
      maxZ: oz + halfD - 0.45,
    },
  };
}

export function validateInteriorCollision(def: InteriorDef): string[] {
  const errors: string[] = [];
  const [width, , depth] = def.dimensions;
  const entranceHalfWidth = 1.0;
  const entryMinZ = -depth / 2;
  for (const collider of def.colliders) {
    const cx = collider.local[0];
    const cz = collider.local[2];
    if (
      Math.abs(cx) < entranceHalfWidth + collider.half[0] &&
      cz - collider.half[2] < entryMinZ + 3
    ) {
      errors.push(`${def.id}:${collider.id} blocks the 2x3m entry clear zone`);
    }
    if (
      Math.abs(cx) > width / 2 - 0.05 ||
      Math.abs(cz) > depth / 2 - 0.05
    ) {
      errors.push(`${def.id}:${collider.id} intersects the structural wall`);
    }
  }
  return errors;
}

