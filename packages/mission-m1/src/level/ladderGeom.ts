// The one source of a placed ladder's geometry, so its DRAW (runtime.ts) and its
// COLLISION (compile.ts) are the same leaning line and cannot drift — a solid the
// player sees in one place and collides with in another is the whole class of bug
// this level exists to avoid.
//
// A ladder leans on its foot at 72° from horizontal (the tradesman's 4:1 rule),
// foot on the ground and top on the surface it serves. It is now SOLID: the
// climber walks up to it and is stopped a body-radius in front of it (they cannot
// walk through it — the owner's "still phasing through, this time on a ladder"),
// then climbs from that spot, staying outside the inward-leaning rails so the body
// never ends a tick inside the solid.

import type { MissionLevel, Vec3Tuple } from "../types.js";

export const LADDER_RUNG_GAP_M = 0.3;
export const LADDER_GAUGE_M = 0.43;
export const LADDER_DEPTH_M = 0.05;
export const LADDER_MARGIN_M = 0.15; // rail overrun below the first / above the last rung
export const LADDER_RUNG_COUNTS = [8, 9, 10, 11] as const;
/**
 * Half-width of the ladder's COLLISION, as a capsule footprint along its leaning
 * run. Narrower than the drawn 0.43 m gauge — it is the central rail-and-rung mass
 * the body cannot pass through, not the outer edges — and small enough that a
 * climber stopped a full body-radius in front of the foot rests tangent to it
 * (zero embed) rather than inside it, which is what keeps the non-penetration
 * invariant clean during the climb.
 */
export const LADDER_COLLISION_HALF_M = 0.08;
/**
 * Lean from horizontal. 72° is the mid of the tradesman's 70–75° range, so the
 * foot stands out from the wall by rise/tan(72°) and the rail runs rise/sin(72°).
 */
export const LADDER_LEAN_FROM_HORIZONTAL = (72 * Math.PI) / 180;
/**
 * How far BESIDE the climb foot the ladder stands, along the served surface's
 * wide (lateral) axis. The owner's fix: "stand beside... rather than occupying"
 * the standing spot, "so it can be solid and still leave somewhere to stand."
 * The climb rises at the authored foot; the solid ladder sits this far to one
 * side, so the route node is clear (no invisible wall where the player must
 * stand), the climbing body never ends a tick inside the rails, and the near
 * rail is still at the climber's hand. Just over a body-radius plus the
 * collision half-width, so the standing capsule is clear of the solid.
 */
export const LADDER_SIDE_OFFSET_M = 0.5;

/** Natural length of a variant GLB, matching build_work_ladder.mjs. */
export function ladderVariantLengthM(count: number): number {
  return LADDER_MARGIN_M + (count - 1) * LADDER_RUNG_GAP_M + LADDER_MARGIN_M;
}

/** Height of a served surface: a deck plane, a landable mass top, or the ground. */
export function ladderSurfaceHeightOf(level: MissionLevel, id: string): number | null {
  for (const deck of level.decks) if (deck.id === id) return deck.y;
  for (const mass of level.masses) {
    if (mass.id === id && mass.landable && Number.isFinite(mass.topY)) return mass.topY;
  }
  if (id === "GROUND") return 0;
  return null;
}

/** The resolved leaning line of one placed ladder, shared by draw and collision. */
export interface LadderLine {
  id: string;
  /** Rung count and the variant GLB it selects. */
  count: number;
  /** Foot on the ground (the drawn origin) — the authored climb foot. */
  foot: Vec3Tuple;
  /** Top rail landing, on the served surface. */
  top: Vec3Tuple;
  footY: number;
  topY: number;
  /** Outward face normal in XZ (unit; points from the wall back at the climber). */
  faceX: number;
  faceZ: number;
  railLengthM: number;
  rungGapM: number;
}

export function ladderLines(level: MissionLevel): LadderLine[] {
  const lines: LadderLine[] = [];
  for (const spec of level.ladders ?? []) {
    const topY = ladderSurfaceHeightOf(level, spec.onto);
    if (topY === null) continue;
    const footY = spec.at[1];
    const rise = topY - footY;
    if (rise <= 0) continue;

    const faceLen = Math.sqrt(spec.faceX * spec.faceX + spec.faceZ * spec.faceZ) || 1;
    const fX = spec.faceX / faceLen; // outward, toward the climber
    const fZ = spec.faceZ / faceLen;

    const railLength = rise / Math.sin(LADDER_LEAN_FROM_HORIZONTAL);
    const run = rise / Math.tan(LADDER_LEAN_FROM_HORIZONTAL);

    // BESIDE the climb foot, along the surface's wide (lateral) axis — the face
    // normal rotated a quarter turn in XZ. The climb rises at the authored foot;
    // the ladder stands this far to the side so the node stays clear and the
    // solid never walls the spot the player must stand on.
    const latX = -fZ;
    const latZ = fX;
    const off = LADDER_SIDE_OFFSET_M;
    const footX = spec.at[0] + latX * off;
    const footZ = spec.at[2] + latZ * off;
    // Foot on the ground; top leans INWARD (−face) onto the surface, keeping the
    // same lateral offset so the whole ladder sits to one side of the climb line.
    const foot: Vec3Tuple = [footX, footY, footZ];
    const top: Vec3Tuple = [footX - fX * run, topY, footZ - fZ * run];

    let count: number = LADDER_RUNG_COUNTS[0]!;
    let best = Infinity;
    for (const candidate of LADDER_RUNG_COUNTS) {
      const d = Math.abs(ladderVariantLengthM(candidate) - railLength);
      if (d < best) {
        best = d;
        count = candidate;
      }
    }

    lines.push({
      id: `LADDER_${spec.id}`,
      count,
      foot,
      top,
      footY,
      topY,
      faceX: fX,
      faceZ: fZ,
      railLengthM: railLength,
      rungGapM: railLength / count,
    });
  }
  return lines;
}
