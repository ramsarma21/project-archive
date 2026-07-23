import {
  RUNTIME_COLLISION_METADATA,
  type RuntimeCollider,
  type RuntimeCollisionAsset,
} from "./collisionManifest.generated.js";
import {
  platformFromPolygon,
  wallFromCapsule,
  wallFromOrientedRect,
  type Blocker,
  type Platform,
  type Vec3,
} from "./collision.js";
import {
  DENSITY_PLACEMENTS,
  TRAVERSAL_AFFORDANCES,
  type DensityPlacement,
} from "./densityManifest.js";
import {
  BARRIERS,
  GATES,
  PROPS,
  type PropDef,
} from "./manifest.js";
import { TRAVERSAL_SET } from "./traversalMarkers.js";
import { CHASE_TOPPLE_STACKS, propInstanceKey } from "./chaseVerbs.js";

// Chase-verb topple stacks follow the same fail-open contract as route-gated
// props: when World3D omits a toppled stack's tuple from exteriorColliders,
// its full-height sidecar hull must vanish with it — the spilled staves are
// low, passable scatter (the pursuer pays the authored stumble instead of
// pathing around a ghost wall).
const TOPPLEABLE_PROP_KEYS = new Set(
  CHASE_TOPPLE_STACKS.map((stack) =>
    propInstanceKey(stack.glb, stack.pos[0], stack.pos[2]),
  ),
);

export type LegacyCollider = [number, number, number, number];

export interface OutdoorCollisionParts {
  blockers: Blocker[];
  platforms: Platform[];
  placementCount: number;
  profiledPlacementCount: number;
  solidPlacementCount: number;
  nonePlacementCount: number;
  skippedTraversalPlacementCount: number;
}

interface RuntimePlacement {
  id: string;
  glb: string;
  pos: [number, number, number];
  rotY: number;
  size?: [number, number, number];
  scale?: number;
  tags: readonly string[];
}

const INFILL_SOLIDS_WITH_DEFERRED_OPENINGS = new Set([
  "infill-lean-to",
  "infill-service-shed",
]);

const TRAVERSAL_PLACEMENT_IDS = new Set(
  TRAVERSAL_AFFORDANCES.filter((record) =>
    record.type === "VAULT" ||
    record.type === "CLIMB_UP" ||
    record.type === "CLIMB_DOWN" ||
    record.type === "DUCK_UNDER",
  ).map((record) => record.placementId),
);

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-4;
}

function tupleMatches(a: LegacyCollider, b: LegacyCollider): boolean {
  return a.every((value, index) => nearlyEqual(value, b[index]!));
}

function legacyTupleForProp(prop: PropDef): LegacyCollider | null {
  return prop.collide
    ? [prop.pos[0], prop.pos[2], prop.collide[0] / 2, prop.collide[1] / 2]
    : null;
}

export function stablePropPlacementId(prop: PropDef): string {
  return `prop:${prop.glb}:${prop.pos[0]}:${prop.pos[1]}:${prop.pos[2]}`;
}

export function isLegacyPropCollider(collider: LegacyCollider): boolean {
  return PROPS.some((prop) => {
    const tuple = legacyTupleForProp(prop);
    return tuple ? tupleMatches(tuple, collider) : false;
  });
}

export function isLegacyTraversalCollider(collider: LegacyCollider): boolean {
  return TRAVERSAL_SET.blockers.some((blocker) =>
    tupleMatches(blocker, collider),
  );
}

export function isLegacyDensityBarrierCollider(
  collider: LegacyCollider,
): boolean {
  const barriers: LegacyCollider[] = BARRIERS.map((barrier) => [
    barrier.pos[0],
    barrier.pos[1],
    barrier.size[0] / 2,
    barrier.size[1] / 2,
  ]);
  const gateWings: LegacyCollider[] = GATES.flatMap((gate) => {
    const wing = (gate.halfSpan - gate.halfOpening) / 2;
    const center = gate.halfOpening + wing;
    return [
      [gate.x, -center, 1, wing],
      [gate.x, center, 1, wing],
    ] as LegacyCollider[];
  });
  return [...barriers, ...gateWings].some((candidate) =>
    tupleMatches(candidate, collider),
  );
}

function actualPropSize(prop: PropDef): [number, number, number] | undefined {
  return (
    prop.size ??
    (prop.glb === "liberty-elm"
      ? [14, 16, 14]
      : prop.glb.startsWith("bldg")
        ? undefined
        : [2.6, 2.6, 2.6])
  );
}

function visibleLegacyProps(
  legacyColliders: readonly LegacyCollider[],
): RuntimePlacement[] {
  return PROPS.flatMap((prop) => {
    const tuple = legacyTupleForProp(prop);
    // A route-gated visual is absent exactly when exteriorColliders omits its
    // tuple, and a toppled chase-verb stack loses its standing hull the same
    // way. Fail open: never retain collision without the imported owner.
    const dynamicallyLifted =
      Boolean(prop.gate) ||
      TOPPLEABLE_PROP_KEYS.has(
        propInstanceKey(prop.glb, prop.pos[0], prop.pos[2]),
      );
    if (
      dynamicallyLifted &&
      (!tuple ||
        !legacyColliders.some((collider) => tupleMatches(tuple, collider)))
    ) {
      return [];
    }
    return [{
      id: stablePropPlacementId(prop),
      glb: prop.glb,
      pos: prop.pos,
      rotY: prop.rotY,
      size: actualPropSize(prop),
      scale: prop.scale,
      tags: [
        "outdoor-prop",
        ...(prop.gate ? [`route:${prop.gate}`, "route-blocker"] : []),
      ],
    }];
  });
}

function densityPlacements(): RuntimePlacement[] {
  return DENSITY_PLACEMENTS.map((placement: DensityPlacement) => ({
    id: placement.id,
    glb: placement.glb,
    pos: placement.pos,
    rotY: placement.rotY,
    size: placement.size,
    tags: ["density", ...placement.tags],
  }));
}

function placementScale(
  placement: RuntimePlacement,
  asset: RuntimeCollisionAsset,
): number | null {
  if (!asset.rawSize || !asset.fittedSize) return null;
  const authoredUniform =
    asset.fittedSize[0] / Math.max(asset.rawSize[0], 1e-6);
  let actualUniform = placement.scale ?? 1;
  if (placement.size) {
    actualUniform = Math.min(
      placement.size[0] / Math.max(asset.rawSize[0], 1e-6),
      placement.size[1] / Math.max(asset.rawSize[1], 1e-6),
      placement.size[2] / Math.max(asset.rawSize[2], 1e-6),
    );
  }
  return actualUniform / Math.max(authoredUniform, 1e-6);
}

function transformPoint(
  point: readonly [number, number, number],
  placement: RuntimePlacement,
  scale: number,
): Vec3 {
  const localX = point[0] * scale;
  const localZ = point[2] * scale;
  const c = Math.cos(placement.rotY);
  const s = Math.sin(placement.rotY);
  return {
    x: placement.pos[0] + localX * c + localZ * s,
    y: placement.pos[1] + point[1] * scale,
    z: placement.pos[2] - localX * s + localZ * c,
  };
}

function tagsFor(
  placement: RuntimePlacement,
  shape: RuntimeCollider,
): string[] {
  return [
    ...placement.tags,
    ...(shape.tags ?? []),
    `placement:${placement.id}`,
    `asset:${placement.glb}`,
    `profile:${shape.id}`,
  ];
}

function convertShape(
  placement: RuntimePlacement,
  scale: number,
  shape: RuntimeCollider,
): { blocker?: Blocker; platform?: Platform } {
  const id = `${placement.id}/${shape.id}`;
  const tags = tagsFor(placement, shape);
  if (shape.shape === "box") {
    const center = transformPoint(shape.center, placement, scale);
    const halfX = shape.half[0] * scale;
    const halfY = shape.half[1] * scale;
    const halfZ = shape.half[2] * scale;
    return {
      blocker: wallFromOrientedRect(
        id,
        center.x,
        center.z,
        halfX,
        halfZ,
        placement.rotY + (shape.yaw ?? 0),
        {
          baseY: center.y - halfY,
          topY: center.y + halfY,
          landable: tags.includes("landable"),
          tags,
        },
      ),
    };
  }
  if (shape.shape === "capsule") {
    const a = transformPoint(shape.a, placement, scale);
    const b = transformPoint(shape.b, placement, scale);
    const radius = shape.radius * scale;
    return {
      blocker: wallFromCapsule(id, a, b, radius, {
        baseY: Math.min(a.y, b.y) - radius,
        topY: Math.max(a.y, b.y) + radius,
        landable: false,
        tags,
      }),
    };
  }
  if (shape.shape === "support") {
    const polygon = shape.polygon.map(([x, z]) => {
      const point = transformPoint([x, shape.y, z], placement, scale);
      return [point.x, point.z] as const;
    });
    return {
      platform: platformFromPolygon(
        id,
        polygon,
        placement.pos[1] + shape.y * scale,
        tags,
      ),
    };
  }
  // Hazards are intentionally not blockers in the on-foot solver.
  return {};
}

function assetAllowed(
  placement: RuntimePlacement,
  asset: RuntimeCollisionAsset,
): boolean {
  if (asset.pendingInteriorPlacement) return false;
  if (
    asset.pendingDoorContract &&
    !INFILL_SOLIDS_WITH_DEFERRED_OPENINGS.has(placement.glb)
  ) {
    return false;
  }
  return true;
}

export function buildOutdoorCollisionParts(
  legacyColliders: readonly LegacyCollider[],
  options: { includeDensity?: boolean } = {},
): OutdoorCollisionParts {
  const placements = [
    ...visibleLegacyProps(legacyColliders),
    ...(options.includeDensity === false ? [] : densityPlacements()),
  ];
  const blockers: Blocker[] = [];
  const platforms: Platform[] = [];
  const ids = new Set<string>();
  let profiledPlacementCount = 0;
  let solidPlacementCount = 0;
  let nonePlacementCount = 0;
  let skippedTraversalPlacementCount = 0;

  for (const placement of placements) {
    if (ids.has(placement.id)) {
      throw new Error(`duplicate outdoor collision placement id ${placement.id}`);
    }
    ids.add(placement.id);
    if (TRAVERSAL_PLACEMENT_IDS.has(placement.id)) {
      skippedTraversalPlacementCount++;
      continue;
    }
    const asset = RUNTIME_COLLISION_METADATA[placement.glb];
    if (!asset || !assetAllowed(placement, asset)) continue;
    profiledPlacementCount++;
    if (asset.profile === "none") {
      nonePlacementCount++;
      continue;
    }
    const scale = placementScale(placement, asset);
    if (scale === null) continue;
    let emitted = false;
    for (const shape of asset.colliders) {
      const converted = convertShape(placement, scale, shape);
      if (converted.blocker) blockers.push(converted.blocker);
      if (converted.platform) platforms.push(converted.platform);
      emitted ||= Boolean(converted.blocker || converted.platform);
    }
    if (emitted) solidPlacementCount++;
  }
  return {
    blockers,
    platforms,
    placementCount: placements.length,
    profiledPlacementCount,
    solidPlacementCount,
    nonePlacementCount,
    skippedTraversalPlacementCount,
  };
}

export const ROUTE_BLOCKER_PAIRINGS = [
  {
    routeId: "THOMAS_DOCK_ROUTE",
    visualPlacementId: "prop:fence-gate:-40:0:22.6",
    assetKey: "fence-gate",
    condition: "route !== UNLOCKED",
    opening: { minX: -40.9, maxX: -37.1, minZ: 20, maxZ: 26.5 },
  },
] as const;

export function routeBlockerMatrix(
  legacyColliders: readonly LegacyCollider[],
  parts = buildOutdoorCollisionParts(legacyColliders),
) {
  return ROUTE_BLOCKER_PAIRINGS.map((pairing) => {
    const prop = PROPS.find(
      (candidate) => stablePropPlacementId(candidate) === pairing.visualPlacementId,
    );
    const tuple = prop ? legacyTupleForProp(prop) : null;
    const visible = Boolean(
      tuple &&
        legacyColliders.some((collider) => tupleMatches(tuple, collider)),
    );
    const collisionIds = parts.blockers
      .filter((blocker) =>
        blocker.tags.has(`placement:${pairing.visualPlacementId}`),
      )
      .map((blocker) => blocker.id);
    return {
      ...pairing,
      state: visible ? "LOCKED" as const : "UNLOCKED" as const,
      visible,
      colliding: collisionIds.length > 0,
      collisionIds,
      valid: visible === (collisionIds.length > 0),
    };
  });
}
