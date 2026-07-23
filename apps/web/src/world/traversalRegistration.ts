// Pure registration bridge from authored traversal markers to contextual-F
// resolver endpoints and Player action requests. Keeping this outside React
// makes current-world registration testable without mounting the scene.
import type { AuthoredRequest } from "./Player.js";
import type { TraversalMarker } from "./traversalMarkers.js";
import type {
  AffordanceEndpoint,
  AffordanceKind,
} from "./traversalResolver.js";
import { CROUCH_SPEED } from "./playerMotion.js";

// Marker zones are authored to the visible corridor edges. Keep action
// endpoints one capsule radius plus tolerance inside those edges so world-v3
// wall/building colliders do not invalidate an otherwise clear duck path.
const ZONE_ENDPOINT_INSET = 0.5;

function zoneTravelsAlongZ(marker: TraversalMarker): boolean {
  const zone = marker.zone!;
  const zIsLongAxis = zone.maxZ - zone.minZ >= zone.maxX - zone.minX;
  // A duck beam spans the zone's long axis, so the actor crosses underneath
  // on the short axis. A squeeze zone is the corridor itself, so travel stays
  // on its long/railed axis.
  return marker.kind === "DUCK_ZONE" ? !zIsLongAxis : zIsLongAxis;
}

function segDir(
  from: [number, number, number],
  to: [number, number, number],
): { x: number; z: number } {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, z: dz / len };
}

function affordanceKindFor(marker: TraversalMarker): AffordanceKind {
  switch (marker.kind) {
    case "DUCK_ZONE":
    case "SQUEEZE":
      return "DUCK_UNDER";
    case "VAULT":
      return "VAULT";
    case "CLIMB":
      return "CLIMB";
    case "LADDER":
      return "LADDER";
    case "JUMP":
      return "JUMP";
    case "INTERACT_FLAVOR":
      return "INTERACT_FLAVOR";
    default:
      return "INTERACT_FLAVOR";
  }
}

export function buildTraversalEndpoints(
  markers: readonly TraversalMarker[],
): AffordanceEndpoint[] {
  const out: AffordanceEndpoint[] = [];
  for (const marker of markers) {
    // Legacy JUMP and VAULT labels do not carry measured imported OBB/support
    // metadata. JUMP stays Space-owned; legacy vault prompts fail closed rather
    // than contradict geometry classification. Density/import adapters own
    // measured dynamic vault candidates.
    if (marker.kind === "JUMP" || marker.kind === "VAULT") continue;
    const kind = affordanceKindFor(marker);
    if (marker.zone) {
      const cx =
        marker.zone.rail?.axis === "x"
          ? marker.zone.rail.at
          : (marker.zone.minX + marker.zone.maxX) / 2;
      const cz =
        marker.zone.rail?.axis === "z"
          ? marker.zone.rail.at
          : (marker.zone.minZ + marker.zone.maxZ) / 2;
      const alongZ = zoneTravelsAlongZ(marker);
      if (alongZ) {
        out.push(
          {
            affordanceId: marker.id,
            dir: 1,
            kind,
            label: marker.label,
            pos: [cx, 0, marker.zone.minZ + ZONE_ENDPOINT_INSET],
            approachDirX: 0,
            approachDirZ: 1,
          },
          {
            affordanceId: marker.id,
            dir: -1,
            kind,
            label: marker.label,
            pos: [cx, 0, marker.zone.maxZ - ZONE_ENDPOINT_INSET],
            approachDirX: 0,
            approachDirZ: -1,
          },
        );
      } else {
        out.push(
          {
            affordanceId: marker.id,
            dir: 1,
            kind,
            label: marker.label,
            pos: [marker.zone.minX + ZONE_ENDPOINT_INSET, 0, cz],
            approachDirX: 1,
            approachDirZ: 0,
          },
          {
            affordanceId: marker.id,
            dir: -1,
            kind,
            label: marker.label,
            pos: [marker.zone.maxX - ZONE_ENDPOINT_INSET, 0, cz],
            approachDirX: -1,
            approachDirZ: 0,
          },
        );
      }
      continue;
    }
    if (marker.path.length === 0) continue;
    const first = marker.path[0]!;
    const along = marker.path[1] ?? first;
    const forward =
      marker.path.length > 1
        ? segDir(first.pos, along.pos)
        : marker.facing !== undefined
          ? { x: Math.sin(marker.facing), z: Math.cos(marker.facing) }
          : { x: 0, z: 0 };
    out.push({
      affordanceId: marker.id,
      dir: 1,
      kind,
      label: marker.label,
      pos: first.pos,
      approachDirX: forward.x,
      approachDirZ: forward.z,
    });
    if (marker.bidirectional && marker.path.length > 1) {
      const last = marker.path[marker.path.length - 1]!;
      const reverse = segDir(last.pos, marker.path[marker.path.length - 2]!.pos);
      out.push({
        affordanceId: marker.id,
        dir: -1,
        kind,
        label: marker.reverseLabel ?? marker.label,
        pos: last.pos,
        approachDirX: reverse.x,
        approachDirZ: reverse.z,
      });
    }
  }
  return out;
}

export function duckRequestFor(
  marker: TraversalMarker,
  dir: 1 | -1,
): AuthoredRequest | null {
  const zone = marker.zone;
  if (!zone) return null;
  const alongZ = zoneTravelsAlongZ(marker);
  const cx =
    zone.rail?.axis === "x" ? zone.rail.at : (zone.minX + zone.maxX) / 2;
  const cz =
    zone.rail?.axis === "z" ? zone.rail.at : (zone.minZ + zone.maxZ) / 2;
  let start: [number, number, number];
  let end: [number, number, number];
  if (alongZ) {
    start = [
      cx,
      0,
      dir === 1
        ? zone.minZ + ZONE_ENDPOINT_INSET
        : zone.maxZ - ZONE_ENDPOINT_INSET,
    ];
    end = [
      cx,
      0,
      dir === 1
        ? zone.maxZ - ZONE_ENDPOINT_INSET
        : zone.minZ + ZONE_ENDPOINT_INSET,
    ];
  } else {
    start = [
      dir === 1
        ? zone.minX + ZONE_ENDPOINT_INSET
        : zone.maxX - ZONE_ENDPOINT_INSET,
      0,
      cz,
    ];
    end = [
      dir === 1
        ? zone.maxX - ZONE_ENDPOINT_INSET
        : zone.minX + ZONE_ENDPOINT_INSET,
      0,
      cz,
    ];
  }
  const distance = Math.hypot(end[0] - start[0], end[2] - start[2]);
  return {
    kind: "DUCK_UNDER",
    anchors: [
      { x: start[0], y: 0, z: start[2] },
      { x: end[0], y: 0, z: end[2] },
    ],
    durationMs: Math.max(400, (distance / CROUCH_SPEED) * 1000),
  };
}
