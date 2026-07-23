// Adapter from the density pass's immutable authored records to the finalized
// contextual-F and semantic collision/runtime formats. Density placements own
// visuals; this module creates no render geometry.
import {
  DENSITY_PLACEMENTS,
  TRAVERSAL_AFFORDANCES,
  type DensityPlacement,
  type TraversalAffordance,
  type TraversalAffordanceType,
} from "./densityManifest.js";
import {
  wallFromRect,
  platformFromRect,
  type Blocker,
  type Platform,
} from "./collision.js";
import type { AuthoredRequest } from "./Player.js";
import type { AffordanceEndpoint } from "./traversalResolver.js";
import { CROUCH_SPEED } from "./playerMotion.js";
import {
  BARRIERS,
  BUILDINGS,
  GATES,
  PROPS,
  WORLD_BOUNDS,
} from "./manifest.js";
import {
  classifyTraversalGeometry,
  resolveVaultApproach,
  type GeometryTraversalClass,
  type GeometryWorld,
  type ObstacleObb,
  type TraversalProfile,
  type VaultApproachPlan,
} from "./traversalClassifier.js";

export type DensityTraversalStatus =
  | "ENABLED"
  | "DISABLED_UNSUPPORTED"
  | "DISABLED_MISSING_PLACEMENT"
  | "DISABLED_GATE"
  | "DISABLED_RUN_JUMP_CLEARABLE"
  | "DISABLED_GEOMETRY";

export interface DensityTraversalGateContext {
  routes?: Readonly<Record<string, string>>;
  storyFlags?: ReadonlySet<string>;
}

export interface DensityTraversalRegistration {
  record: TraversalAffordance;
  placement: DensityPlacement | null;
  status: DensityTraversalStatus;
  reason: string | null;
  endpoints: AffordanceEndpoint[];
  blockers: Blocker[];
  platforms: Platform[];
  classification: GeometryTraversalClass | "AUTHORED_DUCK" | "UNSUPPORTED";
  profile: TraversalProfile | null;
}

const SUPPORTED_TYPES: ReadonlySet<TraversalAffordanceType> = new Set([
  "VAULT",
  "CLIMB_UP",
  "CLIMB_DOWN",
  "DUCK_UNDER",
]);

const LABELS: Partial<Record<TraversalAffordanceType, string>> = {
  VAULT: "Vault",
  CLIMB_UP: "Climb",
  CLIMB_DOWN: "Climb down",
  DUCK_UNDER: "Duck",
};

const placementsById = new Map(
  DENSITY_PLACEMENTS.map((placement) => [placement.id, placement]),
);

function placementObb(placement: DensityPlacement): ObstacleObb {
  return {
    id: placement.id,
    centerX: placement.pos[0],
    centerZ: placement.pos[2],
    halfX: placement.size[0] / 2,
    halfZ: placement.size[2] / 2,
    yaw: placement.rotY,
    height: placement.size[1],
  };
}

const DENSITY_GEOMETRY_WORLD: GeometryWorld = {
  bounds: { ...WORLD_BOUNDS },
  blockers: [
    ...DENSITY_PLACEMENTS.map(placementObb),
    ...BUILDINGS.map((building) => ({
      id: `building:${building.id}`,
      centerX: building.pos[0],
      centerZ: building.pos[2],
      halfX: building.size[0] / 2,
      halfZ: building.size[2] / 2,
      yaw: building.rotY,
      height: building.size[1],
    })),
    ...PROPS.filter((prop) => prop.collide).map((prop, index) => ({
      id: `world-prop:${index}:${prop.glb}`,
      centerX: prop.pos[0],
      centerZ: prop.pos[2],
      halfX: prop.collide![0] / 2,
      halfZ: prop.collide![1] / 2,
      yaw: prop.rotY,
      height: prop.size?.[1] ?? 2,
    })),
    ...BARRIERS.map((barrier, index) => ({
      id: `barrier:${index}:${barrier.kind}`,
      centerX: barrier.pos[0],
      centerZ: barrier.pos[1],
      halfX: barrier.size[0] / 2,
      halfZ: barrier.size[1] / 2,
      yaw: 0,
      height: 3,
    })),
    ...GATES.flatMap((gate) => {
      const halfWing = (gate.halfSpan - gate.halfOpening) / 2;
      const center = gate.halfOpening + halfWing;
      return [-1, 1].map((side) => ({
        id: `gate:${gate.key}:${side}`,
        centerX: gate.x,
        centerZ: side * center,
        halfX: 1,
        halfZ: halfWing,
        yaw: 0,
        height: 4,
      }));
    }),
  ],
};

function profileFor(
  record: TraversalAffordance,
  placement: DensityPlacement,
): TraversalProfile {
  return {
    obstacle: placementObb(placement),
    hasReachableTop:
      record.type === "CLIMB_UP" || record.type === "CLIMB_DOWN",
    topY: record.surfaceHeight,
    standingHeadroom: record.landing.standingHeight,
    topLanding: [record.landing.center[0], record.landing.center[2]],
  };
}

export function densityGateAllows(
  record: TraversalAffordance,
  context: DensityTraversalGateContext = {},
): boolean {
  if (
    record.routeGate &&
    context.routes?.[record.routeGate] !== "UNLOCKED"
  ) {
    return false;
  }
  if (record.storyGate && !context.storyFlags?.has(record.storyGate)) {
    return false;
  }
  return true;
}

function rotatedFootprint(placement: DensityPlacement): [number, number] {
  const c = Math.abs(Math.cos(placement.rotY));
  const s = Math.abs(Math.sin(placement.rotY));
  return [
    placement.size[0] * c + placement.size[2] * s,
    placement.size[0] * s + placement.size[2] * c,
  ];
}

function ordinarySolidCollision(
  record: TraversalAffordance,
  placement: DensityPlacement,
): Blocker[] {
  const [widthX, widthZ] = rotatedFootprint(placement);
  return [
    wallFromRect(
      placement.id,
      placement.pos[0],
      placement.pos[2],
      widthX / 2,
      widthZ / 2,
      {
        topY: placement.pos[1] + placement.size[1],
        landable: false,
        tags: [
          "density",
          "ordinary-solid",
          `affordance:${record.id}`,
          `placement:${placement.id}`,
        ],
      },
    ),
  ];
}

function endpointFor(
  record: TraversalAffordance,
  dir: 1 | -1,
): AffordanceEndpoint {
  const pose = dir === 1 ? record.start : record.end;
  const facing = pose.facing;
  const approach =
    dir === 1
      ? record.approach
      : ([Math.sin(facing), Math.cos(facing)] as [number, number]);
  const type =
    record.type === "CLIMB_UP" || record.type === "CLIMB_DOWN"
      ? dir === 1
        ? record.type
        : record.type === "CLIMB_UP"
          ? "CLIMB_DOWN"
          : "CLIMB_UP"
      : record.type;
  return {
    affordanceId: record.id,
    dir,
    kind:
      type === "CLIMB_UP" || type === "CLIMB_DOWN"
        ? type
        : type === "DUCK_UNDER"
          ? "DUCK_UNDER"
          : "VAULT",
    label:
      dir === -1 && type === "CLIMB_DOWN"
        ? "Climb down"
        : LABELS[type] ?? "Interact",
    pos: pose.pos,
    approachDirX: approach[0],
    approachDirZ: approach[1],
    acquireRange: record.interactionRadius,
    releaseRange: record.interactionRadius + 0.2,
    minFacingDot: record.minApproachDot,
    cooldownMs: record.cooldownMs,
    strictApproachSide: true,
    source: "DENSITY",
    obstacleId: record.placementId,
  };
}

function semanticCollision(
  record: TraversalAffordance,
  placement: DensityPlacement,
): { blockers: Blocker[]; platforms: Platform[] } {
  const tags = [
    "density",
    record.type.toLowerCase(),
    `affordance:${record.id}`,
    `placement:${placement.id}`,
  ];
  const [widthX, widthZ] = rotatedFootprint(placement);

  if (record.type === "DUCK_UNDER") {
    return {
      blockers: [
        wallFromRect(
          placement.id,
          placement.pos[0],
          placement.pos[2],
          widthX / 2,
          widthZ / 2,
          {
            baseY: record.clearance.height,
            topY: Math.max(
              record.clearance.height + 0.1,
              placement.pos[1] + placement.size[1],
            ),
            landable: false,
            tags,
          },
        ),
      ],
      platforms: [],
    };
  }

  if (record.type === "VAULT") {
    return {
      blockers: [
        wallFromRect(placement.id, placement.pos[0], placement.pos[2], widthX / 2, widthZ / 2, {
          topY: placement.pos[1] + placement.size[1],
          landable: false,
          tags,
        }),
      ],
      platforms: [],
    };
  }

  // The collision runtime's global depenetration currently runs before
  // authored-motion target ignores are applied. A ladder body collider would
  // therefore cancel its own climb on the next frame. Keep the exact authored
  // support here, but defer ladder-body collision until depenetration accepts
  // an action ignore set. Placement id remains the stable adapter boundary.
  const landing = record.landing;
  return {
    blockers: [],
    platforms: [
      platformFromRect(
        `support:${placement.id}:${record.id}`,
        landing.center[0] - landing.radius,
        landing.center[0] + landing.radius,
        landing.center[2] - landing.radius,
        landing.center[2] + landing.radius,
        landing.center[1],
        tags,
      ),
    ],
  };
}

export function buildDensityTraversalRegistrations(
  context: DensityTraversalGateContext = {},
): DensityTraversalRegistration[] {
  return TRAVERSAL_AFFORDANCES.map((record) => {
    const placement = placementsById.get(record.placementId) ?? null;
    if (!placement) {
      return {
        record,
        placement,
        status: "DISABLED_MISSING_PLACEMENT",
        reason: `missing density placement ${record.placementId}`,
        endpoints: [],
        blockers: [],
        platforms: [],
        classification: "UNSUPPORTED",
        profile: null,
      };
    }
    const profile = profileFor(record, placement);
    const classification =
      record.type === "DUCK_UNDER"
        ? "AUTHORED_DUCK"
        : classifyTraversalGeometry(profile, DENSITY_GEOMETRY_WORLD);
    if (classification === "RUN_JUMP_CLEARABLE") {
      return {
        record,
        placement,
        status: "DISABLED_RUN_JUMP_CLEARABLE",
        reason: "existing Shift+Space ballistic arc safely clears this object",
        endpoints: [],
        blockers: ordinarySolidCollision(record, placement),
        platforms: [],
        classification,
        profile,
      };
    }
    if (!SUPPORTED_TYPES.has(record.type)) {
      return {
        record,
        placement,
        status: "DISABLED_UNSUPPORTED",
        reason: `${record.type} has no dedicated safe locomotion behavior`,
        endpoints: [],
        blockers: ordinarySolidCollision(record, placement),
        platforms: [],
        classification,
        profile,
      };
    }
    if (!densityGateAllows(record, context)) {
      return {
        record,
        placement,
        status: "DISABLED_GATE",
        reason: "route/story gate closed",
        endpoints: [],
        blockers: [],
        platforms: [],
        classification: "UNSUPPORTED",
        profile,
      };
    }
    const requiredClass =
      record.type === "VAULT" ? "VAULT_REQUIRED" : "CLIMB_REQUIRED";
    if (
      classification !== "AUTHORED_DUCK" &&
      classification !== requiredClass
    ) {
      return {
        record,
        placement,
        status: "DISABLED_GEOMETRY",
        reason: `${classification} does not satisfy ${requiredClass}`,
        endpoints: [],
        // Ordinary solids remain even when no F action is exposed.
        blockers: semanticCollision(record, placement).blockers,
        platforms: [],
        classification,
        profile,
      };
    }
    const collision = semanticCollision(record, placement);
    return {
      record,
      placement,
      status: "ENABLED",
      reason: null,
      endpoints:
        classification === "VAULT_REQUIRED"
          ? []
          : [
              endpointFor(record, 1),
              ...(record.bidirectional ? [endpointFor(record, -1)] : []),
            ],
      blockers: collision.blockers,
      platforms: collision.platforms,
      classification,
      profile,
    };
  });
}

export function resolveDensityDynamicEndpoints(
  registrations: readonly DensityTraversalRegistration[],
  playerX: number,
  playerZ: number,
): AffordanceEndpoint[] {
  const out: AffordanceEndpoint[] = [];
  for (const registration of registrations) {
    if (
      registration.status !== "ENABLED" ||
      registration.classification !== "VAULT_REQUIRED" ||
      !registration.profile
    ) continue;
    const plan = resolveVaultApproach(
      registration.profile,
      playerX,
      playerZ,
      DENSITY_GEOMETRY_WORLD,
    );
    if (!plan) continue;
    const record = registration.record;
    out.push({
      affordanceId: record.id,
      dir: 1,
      kind: "VAULT",
      label: "Vault",
      pos: plan.start,
      approachDirX: -plan.normalX,
      approachDirZ: -plan.normalZ,
      acquireRange: Math.min(0.85, record.interactionRadius),
      releaseRange: Math.min(1.05, record.interactionRadius + 0.2),
      minFacingDot: -0.15,
      cooldownMs: record.cooldownMs,
      strictApproachSide: false,
      source: "DENSITY",
      obstacleId: record.placementId,
      vaultPlan: plan,
    });
  }
  return out;
}

export function densityActionRequest(
  registration: DensityTraversalRegistration,
  dir: 1 | -1,
  vaultPlan?: VaultApproachPlan,
): AuthoredRequest | null {
  if (registration.status !== "ENABLED") return null;
  const record = registration.record;
  const start = dir === 1 ? record.start : record.end;
  const end = dir === 1 ? record.end : record.start;
  const anchors = [
    { x: start.pos[0], y: start.pos[1], z: start.pos[2], yaw: start.facing },
    { x: end.pos[0], y: end.pos[1], z: end.pos[2], yaw: end.facing },
  ];
  if (record.type === "DUCK_UNDER") {
    const distance = Math.hypot(
      end.pos[0] - start.pos[0],
      end.pos[2] - start.pos[2],
    );
    return {
      kind: "DUCK_UNDER",
      affordanceId: record.id,
      anchors,
      durationMs: Math.max(400, (distance / CROUCH_SPEED) * 1000),
    };
  }
  if (record.type === "VAULT") {
    if (!vaultPlan) return null;
    return {
      kind: "VAULT",
      affordanceId: record.id,
      anchors: [
        {
          x: vaultPlan.start[0],
          y: vaultPlan.start[1],
          z: vaultPlan.start[2],
          yaw: Math.atan2(-vaultPlan.normalX, -vaultPlan.normalZ),
        },
        {
          x: vaultPlan.contact[0],
          y: vaultPlan.contact[1],
          z: vaultPlan.contact[2],
        },
        {
          x: vaultPlan.clearance[0],
          y: vaultPlan.clearance[1],
          z: vaultPlan.clearance[2],
        },
        {
          x: vaultPlan.landing[0],
          y: vaultPlan.landing[1],
          z: vaultPlan.landing[2],
          yaw: Math.atan2(-vaultPlan.normalX, -vaultPlan.normalZ),
        },
      ],
      durationMs: 950,
      arcHeight: 0,
    };
  }
  if (record.type !== "CLIMB_UP" && record.type !== "CLIMB_DOWN") {
    return null;
  }
  return {
    kind:
      dir === 1
        ? record.type
        : record.type === "CLIMB_UP"
          ? "CLIMB_DOWN"
          : "CLIMB_UP",
    affordanceId: record.id,
    anchors,
    durationMs: Math.max(
      900,
      (Math.hypot(
        end.pos[0] - start.pos[0],
        end.pos[1] - start.pos[1],
        end.pos[2] - start.pos[2],
      ) /
        1.25) *
        1000,
    ),
  };
}

export function alignDensityActionStart(
  request: AuthoredRequest,
  player: { x: number; y: number; z: number },
  maxSnap = 0.25,
): AuthoredRequest | null {
  const first = request.anchors[0];
  if (!first) return null;
  const distance = Math.hypot(
    first.x - player.x,
    first.y - player.y,
    first.z - player.z,
  );
  if (distance > maxSnap) return null;
  return {
    ...request,
    anchors: [
      { ...first, x: player.x, y: player.y, z: player.z },
      ...request.anchors.slice(1),
    ],
  };
}

// Explicit migration aliases only: proximity-based dedupe can hide unrelated
// objects in a dense district (the Liberty ladder sits near an older shed
// climb). The density wharf ladder intentionally replaces the same crane path.
export const DENSITY_LEGACY_ALIASES: Readonly<Record<string, string>> = {
  WHARF_CRANE_LADDER: "DENSITY.WHARF.CLIMB",
};

export function mergeDensityTraversalEndpoints(
  legacy: readonly AffordanceEndpoint[],
  registrations: readonly DensityTraversalRegistration[],
): AffordanceEndpoint[] {
  const density = registrations.flatMap((registration) => registration.endpoints);
  const enabledDensityIds = new Set(
    registrations
      .filter((registration) => registration.status === "ENABLED")
      .map((registration) => registration.record.id),
  );
  const retainedLegacy = legacy.filter((candidate) => {
    const replacement = DENSITY_LEGACY_ALIASES[candidate.affordanceId];
    return !replacement || !enabledDensityIds.has(replacement);
  });
  return [...density, ...retainedLegacy];
}

export const DENSITY_TRAVERSAL_TYPE_STATUS: Readonly<
  Record<TraversalAffordanceType, "ENABLED" | "DISABLED">
> = {
  VAULT: "ENABLED",
  CLIMB_UP: "ENABLED",
  CLIMB_DOWN: "ENABLED",
  DUCK_UNDER: "ENABLED",
  JUMP_GAP: "DISABLED",
  MANTLE: "DISABLED",
  BALANCE: "DISABLED",
  PUSH: "DISABLED",
  SQUEEZE: "DISABLED",
  FLAVOR: "DISABLED",
};
