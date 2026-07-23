// Authored semantic chase content. These volumes and routes are invisible:
// visible world dressing remains entirely imported GLB/texture content.

export type ChaseVec3 = readonly [number, number, number];

export interface ChaseWaypoint {
  id: string;
  position: ChaseVec3;
  links: readonly string[];
  corner?: boolean;
}

export interface ChaseRouteGraph {
  spaceId: string;
  waypoints: readonly ChaseWaypoint[];
}

export interface StealthVolume {
  id: string;
  kind: "REFUGE" | "HIDE";
  spaceId: string;
  center: ChaseVec3;
  radius: number;
  holdSeconds: number;
  resolution?: "REFUGE";
  doorId?: string;
}

export interface PursuitPortalPolicy {
  locationId: string;
  mode: "TRANSFER";
  transferDelaySeconds: number;
}

export type WatcherKind = "POSTED" | "PATROL";

export interface WatcherDefinition {
  id: "WATCH-customs" | "WATCH-patrol" | "WATCH-house-1" | "WATCH-house-2";
  kind: WatcherKind;
  spaceId: "EXTERIOR";
  position: ChaseVec3;
  baseYaw: number;
  halfAngleRad: number;
  rangeM: number;
  patrol?: {
    waypoints: readonly ChaseVec3[];
    speedMps: number;
  };
}

export interface CoverVolume {
  id: string;
  kind: "STATIC" | "CROWD";
  spaceId: "EXTERIOR";
  center: ChaseVec3;
  halfExtents: readonly [number, number];
}

export interface CheckpointVolume {
  id: string;
  watcherIds: readonly WatcherDefinition["id"][];
  spaceId: "EXTERIOR";
  center: ChaseVec3;
  halfExtents: readonly [number, number];
  rearmDistanceM: number;
  cooldownSeconds: number;
}

const deg = (value: number): number => (value * Math.PI) / 180;

/** The complete M2 watcher roster. There must never be more than these four. */
export const WATCHERS: readonly WatcherDefinition[] = [
  {
    id: "WATCH-customs",
    kind: "POSTED",
    spaceId: "EXTERIOR",
    position: [-56, 0, -2],
    baseYaw: 0,
    halfAngleRad: deg(35),
    rangeM: 12,
  },
  {
    id: "WATCH-patrol",
    kind: "PATROL",
    spaceId: "EXTERIOR",
    position: [-32, 0, 2],
    baseYaw: Math.PI / 2,
    halfAngleRad: deg(28),
    rangeM: 10,
    patrol: {
      waypoints: [
        [-32, 0, 2],
        [-18, 0, 2],
        [-6, 0, 2],
        [6, 0, 2],
      ],
      speedMps: 1.05,
    },
  },
  {
    id: "WATCH-house-1",
    kind: "POSTED",
    spaceId: "EXTERIOR",
    position: [52, 0, 8],
    baseYaw: Math.PI,
    halfAngleRad: deg(35),
    rangeM: 12,
  },
  {
    id: "WATCH-house-2",
    kind: "POSTED",
    spaceId: "EXTERIOR",
    position: [58, 0, 8],
    baseYaw: Math.PI,
    halfAngleRad: deg(35),
    rangeM: 12,
  },
] as const;

export const WATCHER_SCAN = {
  yawAmplitudeRad: 0.6,
  yawRateRadPerSecond: 0.3,
  duskRangeGrowth: 0.15,
  attentionSeconds: 6,
} as const;

/**
 * Semantic cover is authored independently of ambient-rig visibility. Visual
 * crowd culling therefore cannot change a detection result.
 */
export const COVER_VOLUMES: readonly CoverVolume[] = [
  {
    id: "COVER-crowd-market",
    kind: "CROWD",
    spaceId: "EXTERIOR",
    center: [-50, 0, -5],
    halfExtents: [4.5, 3.2],
  },
  {
    id: "COVER-crowd-central",
    kind: "CROWD",
    spaceId: "EXTERIOR",
    center: [-7, 0, 3],
    halfExtents: [5, 3],
  },
  {
    id: "COVER-crowd-custom-house",
    kind: "CROWD",
    spaceId: "EXTERIOR",
    center: [55, 0, 3.5],
    halfExtents: [4.5, 2.4],
  },
  {
    id: "COVER-static-market-cart",
    kind: "STATIC",
    spaceId: "EXTERIOR",
    center: [-52, 0, 5.5],
    halfExtents: [2.2, 1.5],
  },
  {
    id: "COVER-static-central-stalls",
    kind: "STATIC",
    spaceId: "EXTERIOR",
    center: [-13, 0, -5.5],
    halfExtents: [3, 1.7],
  },
  {
    id: "COVER-static-custom-house-board",
    kind: "STATIC",
    spaceId: "EXTERIOR",
    center: [50.6, 0, 16.7],
    halfExtents: [1.8, 1.2],
  },
] as const;

export const CHECKPOINT_VOLUMES: readonly CheckpointVolume[] = [
  {
    id: "CHECKPOINT-customs-route",
    watcherIds: ["WATCH-customs"],
    spaceId: "EXTERIOR",
    center: [-56, 0, -0.5],
    halfExtents: [2.4, 4],
    rearmDistanceM: 5,
    cooldownSeconds: 8,
  },
  {
    id: "CHECKPOINT-custom-house-stretch",
    watcherIds: ["WATCH-house-1", "WATCH-house-2"],
    spaceId: "EXTERIOR",
    center: [55, 0, 5],
    halfExtents: [5, 4],
    rearmDistanceM: 6,
    cooldownSeconds: 10,
  },
] as const;

export function pointInCover(
  position: { x: number; z: number },
  spaceId = "EXTERIOR",
): CoverVolume | null {
  return (
    COVER_VOLUMES.find(
      (volume) =>
        volume.spaceId === spaceId &&
        Math.abs(position.x - volume.center[0]) <= volume.halfExtents[0] &&
        Math.abs(position.z - volume.center[2]) <= volume.halfExtents[1],
    ) ?? null
  );
}

export function watcherRange(baseRangeM: number, dayProgress: number): number {
  const progress = Math.max(0, Math.min(1, dayProgress));
  return baseRangeM * (1 + WATCHER_SCAN.duskRangeGrowth * progress);
}

const X = [-105, -80, -56, -32, -6, 18, 42, 65, 88] as const;

function lane(
  prefix: string,
  z: number,
  xs: readonly number[],
): ChaseWaypoint[] {
  return xs.map((x, index) => ({
    id: `${prefix}_${index}`,
    position: [x, 0, z] as const,
    links: [
      ...(index > 0 ? [`${prefix}_${index - 1}`] : []),
      ...(index < xs.length - 1 ? [`${prefix}_${index + 1}`] : []),
    ],
    corner: true,
  }));
}

const CENTER = lane("CENTER", 0, X);
const NORTH = lane("NORTH", -22, X);
const SOUTH_X = [-32, -6, 18, 42, 65, 88] as const;
const SOUTH = lane("SOUTH", 22, SOUTH_X);
const CONNECTOR_X = [-80, -56, -32, -6, 18, 42, 65, 88] as const;

function addLink(
  points: ChaseWaypoint[],
  a: string,
  b: string,
): void {
  const ai = points.findIndex((point) => point.id === a);
  const bi = points.findIndex((point) => point.id === b);
  if (ai < 0 || bi < 0) return;
  const ap = points[ai]!;
  const bp = points[bi]!;
  points[ai] = { ...ap, links: [...new Set([...ap.links, b])] };
  points[bi] = { ...bp, links: [...new Set([...bp.links, a])] };
}

function exteriorGraph(): ChaseRouteGraph {
  const points = [...CENTER, ...NORTH, ...SOUTH].map((point) => ({
    ...point,
    links: [...point.links],
  }));
  for (const x of CONNECTOR_X) {
    const center = `CENTER_${X.indexOf(x as (typeof X)[number])}`;
    const north = `NORTH_${X.indexOf(x as (typeof X)[number])}`;
    addLink(points, center, north);
    const southIndex = SOUTH_X.indexOf(x as (typeof SOUTH_X)[number]);
    if (southIndex >= 0) addLink(points, center, `SOUTH_${southIndex}`);
  }
  return { spaceId: "EXTERIOR", waypoints: points };
}

export const EXTERIOR_CHASE_GRAPH = exteriorGraph();

export const STEALTH_VOLUMES: readonly StealthVolume[] = [
  {
    id: "REFUGE_TAVERN_DOOR",
    kind: "REFUGE",
    spaceId: "EXTERIOR",
    center: [-18, 0, -9.7],
    radius: 1.35,
    holdSeconds: 0.8,
    resolution: "REFUGE",
    doorId: "EXPLORE_tavern",
  },
  {
    id: "REFUGE_LIBERTY_DEEP_CROWD",
    kind: "REFUGE",
    spaceId: "EXTERIOR",
    center: [89, 0, -19],
    radius: 2.1,
    holdSeconds: 1.1,
    resolution: "REFUGE",
  },
  {
    id: "HIDE_NORTH_ALLEY_CRATES",
    kind: "HIDE",
    spaceId: "EXTERIOR",
    center: [-31, 0, -22],
    radius: 2.2,
    holdSeconds: 0,
  },
  {
    id: "HIDE_SOUTH_MARKET",
    kind: "HIDE",
    spaceId: "EXTERIOR",
    center: [17, 0, 22],
    radius: 2.4,
    holdSeconds: 0,
  },
];

export const INSPECTOR_OFFICE = {
  id: "INSPECTOR_OFFICE",
  locationId: "BOSTON_STREET",
  buildingId: "townhouse",
  anchor: [53.5, 0, -8.6] as ChaseVec3,
  releaseAnchorId: "INSPECTOR_OFFICE_RELEASE",
  releaseAnchor: [49.8, 0, -8.2] as ChaseVec3,
  releaseFacingY: Math.PI / 2,
} as const;

// Player sprint speed itself is owned by playerMotion (SPRINT_SPEED); the
// pursuer speeds below are tuned against it (pursuer slightly slower than a
// full sprint, so stamina management — not raw speed — decides the chase).
// Feel-tuned 2026-07-22: slower pursuer + a real shouted head start.
export const CHASE_TUNING = {
  pursuerMps: 4.0,
  slowPursuerMps: 3.4,
  // Added to pursuerMps when the player is a recognized face (prior comply
  // or prior chase): the watch runs harder for a known runner.
  highHeatBonusMps: 0.2,
  catchDistanceM: 1.2,
  shakeDistanceM: 8,
  shakeHoldSeconds: 4.5,
  corneredHoldSeconds: 2.6,
  // The officer plants his feet and shouts before he runs — the player sees
  // the chase begin and gets a genuine head start.
  startSeconds: 1.2,
  traversalDelaySeconds: 0.42,
  obstacleDelaySeconds: 0.3,
  interiorTransferDelaySeconds: 1.4,
  caughtClockUnits: 2,
  // Chase context verbs (design1 feature 1). A toppled stack costs the
  // pursuer a real, readable stumble; the tavern cut leaves him checking the
  // doorway — briefly if he watched you go in, longer if he lost you.
  stumbleDelaySeconds: 2.0,
  // Spill radius, not stack radius: staves roll across the lane, so a pursuer
  // skirting the stack's collider still hits the spill.
  stumbleRadiusM: 2.6,
  tavernCutSeenPauseSeconds: 0.8,
  tavernCutUnseenPauseSeconds: 1.6,
} as const;

export function volumesForSpace(spaceId: string): readonly StealthVolume[] {
  return STEALTH_VOLUMES.filter((volume) => volume.spaceId === spaceId);
}

// Every current isolated room uses a validated doorway landing and semantic
// collision, so pursuit transfers rather than treating generic doors as refuge.
export function pursuitPortalPolicy(locationId: string): PursuitPortalPolicy {
  return {
    locationId,
    mode: "TRANSFER",
    transferDelaySeconds: CHASE_TUNING.interiorTransferDelaySeconds,
  };
}

// Interior routes use the authored room bounds and validated portal endpoint.
// The four-corner loop gives the pursuer deterministic corner candidates while
// runtime LOS rejects any edge obstructed by room dressing.
export function interiorChaseGraph(input: {
  spaceId: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  portal: ChaseVec3;
}): ChaseRouteGraph {
  const inset = 1.15;
  const points: ChaseWaypoint[] = [
    { id: "PORTAL", position: input.portal, links: ["NW", "NE"], corner: true },
    {
      id: "NW",
      position: [input.minX + inset, 0, input.maxZ - inset],
      links: ["PORTAL", "NE", "SW"],
      corner: true,
    },
    {
      id: "NE",
      position: [input.maxX - inset, 0, input.maxZ - inset],
      links: ["PORTAL", "NW", "SE"],
      corner: true,
    },
    {
      id: "SW",
      position: [input.minX + inset, 0, input.minZ + inset],
      links: ["NW", "SE"],
      corner: true,
    },
    {
      id: "SE",
      position: [input.maxX - inset, 0, input.minZ + inset],
      links: ["NE", "SW"],
      corner: true,
    },
  ];
  return { spaceId: input.spaceId, waypoints: points };
}
