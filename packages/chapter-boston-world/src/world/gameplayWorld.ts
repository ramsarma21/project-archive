// Shared, framework-free gameplay collision/LOS construction. This mirrors the
// collision composition currently performed inside Player so World3D can later
// own one authoritative service without changing locomotion behavior.
import {
  blockerIdsAt,
  platformFromRect,
  segmentClear,
  segmentOccluderIds,
  sweepXZ,
  wallFromRect,
  type CollisionWorld,
  type Vec3,
} from "./collision.js";
import {
  buildDensityTraversalRegistrations,
  type DensityTraversalGateContext,
} from "./densityTraversalAdapter.js";
import {
  buildOutdoorCollisionParts,
  isLegacyDensityBarrierCollider,
  isLegacyPropCollider,
  isLegacyTraversalCollider,
  type LegacyCollider,
} from "./outdoorCollisionAdapter.js";
import { WORLD_BOUNDS } from "./manifest.js";
import {
  TRAVERSAL_SET,
  type TraversalMarker,
} from "./traversalMarkers.js";

export const EXTERIOR_GAMEPLAY_SPACE = { kind: "EXTERIOR" } as const;

export type GameplaySpace =
  | typeof EXTERIOR_GAMEPLAY_SPACE
  | { kind: "INTERIOR"; id: string };

export function interiorGameplaySpace(id: string): GameplaySpace {
  if (!id) throw new Error("interior gameplay space requires a non-empty id");
  return { kind: "INTERIOR", id };
}

export interface ExteriorGameplayWorldInput {
  // Complete legacy tuple list from exteriorColliders + door-aware building
  // overrides + traversalBlockerColliders. Tuple identity is intentionally
  // retained because route and door state are encoded by tuple presence.
  colliders: readonly LegacyCollider[];
  includeDensity?: boolean;
  densityGateContext?: DensityTraversalGateContext;
}

export type InteriorCollisionWorlds =
  | ReadonlyMap<string, CollisionWorld>
  | Readonly<Record<string, CollisionWorld>>;

export interface GameplayWorldBuildInput {
  exterior: ExteriorGameplayWorldInput | CollisionWorld;
  activeSpace: GameplaySpace;
  interiors?: InteriorCollisionWorlds;
}

export interface GameplayWorldService {
  readonly activeSpace: GameplaySpace;
  readonly collision: CollisionWorld;
  // Stable source ids are surfaced directly for camera diagnostics and QA.
  readonly blockerIds: readonly string[];
  readonly platformIds: readonly string[];
  sweepXZ(
    from: Vec3,
    to: { x: number; z: number },
    radius: number,
    height: number,
    ignore?: ReadonlySet<string>,
  ): ReturnType<typeof sweepXZ>;
  segmentClear(a: Vec3, b: Vec3, ignore?: ReadonlySet<string>): boolean;
  segmentOccluderIds(
    a: Vec3,
    b: Vec3,
    ignore?: ReadonlySet<string>,
  ): string[];
  blockerIdsAt(
    pos: Vec3,
    radius: number,
    height: number,
    ignore?: ReadonlySet<string>,
  ): string[];
}

function pathCrossesRect(
  marker: TraversalMarker,
  bx: number,
  bz: number,
  hx: number,
  hz: number,
): boolean {
  for (let segment = 0; segment < marker.path.length - 1; segment++) {
    const a = marker.path[segment]!.pos;
    const b = marker.path[segment + 1]!.pos;
    for (let index = 0; index <= 20; index++) {
      const t = index / 20;
      const x = a[0] + (b[0] - a[0]) * t;
      const z = a[2] + (b[2] - a[2]) * t;
      if (
        x >= bx - hx - 0.05 &&
        x <= bx + hx + 0.05 &&
        z >= bz - hz - 0.05 &&
        z <= bz + hz + 0.05
      ) {
        return true;
      }
    }
  }
  return false;
}

export function buildExteriorGameplayCollision(
  input: ExteriorGameplayWorldInput,
): CollisionWorld {
  const includeDensity = input.includeDensity ?? true;
  const actionMarkers = TRAVERSAL_SET.markers.filter(
    (marker) =>
      marker.kind === "VAULT" ||
      marker.kind === "CLIMB" ||
      marker.kind === "LADDER",
  );
  const outdoor = buildOutdoorCollisionParts(input.colliders, {
    includeDensity,
  });
  const blockers = input.colliders
    .filter(
      (collider) =>
        !isLegacyPropCollider(collider) &&
        !isLegacyDensityBarrierCollider(collider) &&
        !isLegacyTraversalCollider(collider),
    )
    .map(([bx, bz, hx, hz]) => {
      const matches = actionMarkers.filter((marker) =>
        pathCrossesRect(marker, bx, bz, hx, hz),
      );
      const vault = matches.find((marker) => marker.kind === "VAULT");
      return wallFromRect(
        `legacy:${bx}:${bz}:${hx}:${hz}`,
        bx,
        bz,
        hx,
        hz,
        {
          topY: vault
            ? Math.max(0.45, Math.min(1.15, vault.anim.arcHeight ?? 0.75))
            : Infinity,
          landable: false,
          tags: matches.flatMap((marker) => [
            marker.kind.toLowerCase(),
            `affordance:${marker.id}`,
          ]),
        },
      );
    });
  blockers.push(...outdoor.blockers);

  const platforms = TRAVERSAL_SET.roofZones.map((zone) =>
    platformFromRect(
      zone.id,
      zone.minX,
      zone.maxX,
      zone.minZ,
      zone.maxZ,
      zone.y,
    ),
  );
  platforms.push(...outdoor.platforms);

  if (includeDensity) {
    const densityTraversal = buildDensityTraversalRegistrations(
      input.densityGateContext,
    );
    blockers.push(
      ...densityTraversal.flatMap((registration) => registration.blockers),
    );
    platforms.push(
      ...densityTraversal.flatMap((registration) => registration.platforms),
    );
  }

  return {
    blockers,
    platforms,
    bounds: { ...WORLD_BOUNDS },
  };
}

function interiorWorld(
  worlds: InteriorCollisionWorlds | undefined,
  id: string,
): CollisionWorld | undefined {
  if (!worlds) return undefined;
  const map = worlds as ReadonlyMap<string, CollisionWorld>;
  if (typeof map.get === "function") return map.get(id);
  return (worlds as Readonly<Record<string, CollisionWorld>>)[id];
}

export function selectGameplayCollision(
  exterior: CollisionWorld,
  activeSpace: GameplaySpace,
  interiors?: InteriorCollisionWorlds,
): CollisionWorld {
  if (activeSpace.kind === "EXTERIOR") return exterior;
  const selected = interiorWorld(interiors, activeSpace.id);
  if (!selected) {
    throw new Error(`missing collision world for interior ${activeSpace.id}`);
  }
  return selected;
}

export function bindGameplayWorld(
  collision: CollisionWorld,
  activeSpace: GameplaySpace,
): GameplayWorldService {
  return {
    activeSpace,
    collision,
    blockerIds: collision.blockers.map((blocker) => blocker.id),
    platformIds: collision.platforms.map((platform) => platform.id),
    sweepXZ: (from, to, radius, height, ignore) =>
      sweepXZ(collision, from, to, radius, height, ignore),
    segmentClear: (a, b, ignore) => segmentClear(collision, a, b, ignore),
    segmentOccluderIds: (a, b, ignore) =>
      segmentOccluderIds(collision, a, b, ignore),
    blockerIdsAt: (pos, radius, height, ignore) =>
      blockerIdsAt(collision, pos, radius, height, ignore),
  };
}

export function buildGameplayWorld(
  input: GameplayWorldBuildInput,
): GameplayWorldService {
  const exterior =
    "blockers" in input.exterior
      ? input.exterior
      : buildExteriorGameplayCollision(input.exterior);
  const selected = selectGameplayCollision(
    exterior,
    input.activeSpace,
    input.interiors,
  );
  return bindGameplayWorld(selected, input.activeSpace);
}
