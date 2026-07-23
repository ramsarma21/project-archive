import type { PresenterSpatialState } from "@pa/engine-world";
import {
  ALL_INTERIOR_LOCATIONS,
  EXPLORE_LOCATIONS,
  WORLD_BOUNDS,
  type LocationDef,
} from "./manifest.js";
import { thresholdAnchorForLocation } from "./doorwayContract.js";

// ---------------------------------------------------------------------------
// Resume spatial restore (feel-audit-1 P0-11). Decides where the player body
// re-seats on resume from the persisted presenter snapshot. Pure and
// unit-tested; never consulted by the runtime — replay determinism is owned
// entirely by the committed event log.
//
// Safety rules:
// - The snapshot only applies when the runtime resumed into the SAME
//   location context it was captured in; otherwise the authored anchor wins.
// - A snapshot taken inside a presentation-only explore interior restores to
//   just OUTSIDE that interior's door (the interior-safety fallback): explore
//   rooms are entered through their own live door portals, never by spawn.
// - Positions outside the world bounds are rejected (corrupt/foreign saves).
// ---------------------------------------------------------------------------

export interface SpatialRestoreDecision {
  pos: [number, number, number];
  faceY: number;
}

function withinWorldBounds(pos: readonly [number, number, number]): boolean {
  return (
    Number.isFinite(pos[0]) &&
    Number.isFinite(pos[1]) &&
    Number.isFinite(pos[2]) &&
    pos[0] >= WORLD_BOUNDS.minX - 2 &&
    pos[0] <= WORLD_BOUNDS.maxX + 2 &&
    pos[2] >= WORLD_BOUNDS.minZ - 2 &&
    pos[2] <= WORLD_BOUNDS.maxZ + 2 &&
    pos[1] >= -0.5 &&
    pos[1] <= 12
  );
}

export function resolveSpatialRestore(
  saved: PresenterSpatialState | null | undefined,
  runtimeLoc: LocationDef,
): SpatialRestoreDecision | null {
  if (!saved) return null;
  if (!Number.isFinite(saved.yaw)) return null;
  // The runtime location moved on since the snapshot: authored anchor wins.
  if (saved.locationId !== runtimeLoc.id) return null;
  // Runtime (hero) interiors keep their authored landing: their flows re-run
  // interior choreography on resume and expect the doorway landing.
  if (runtimeLoc.interior) return null;
  if (saved.interiorId) {
    // Presentation-only explore interior: restore to just outside its door.
    const exploreLoc = EXPLORE_LOCATIONS[saved.interiorId];
    const interiorLoc = ALL_INTERIOR_LOCATIONS[saved.interiorId];
    if (!exploreLoc || !interiorLoc) return null;
    const outside = thresholdAnchorForLocation(interiorLoc, "OUTSIDE");
    return {
      pos: [outside[0], 0, outside[2]],
      faceY: Math.PI + interiorLoc.faceY,
    };
  }
  if (!withinWorldBounds(saved.pos)) return null;
  return { pos: [saved.pos[0], 0, saved.pos[2]], faceY: saved.yaw };
}
