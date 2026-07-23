// Pure geometry/physics traversal classification and dynamic face resolution.
// No React/THREE dependency: density and legacy adapters can share the rule.
import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
} from "./collision.js";
import {
  GRAVITY,
  RUNNING_JUMP_VY,
  RUN_SPEED,
} from "./playerMotion.js";

export type GeometryTraversalClass =
  | "RUN_JUMP_CLEARABLE"
  | "VAULT_REQUIRED"
  | "CLIMB_REQUIRED"
  | "BLOCKED";

export interface ObstacleObb {
  id: string;
  centerX: number;
  centerZ: number;
  halfX: number;
  halfZ: number;
  yaw: number;
  height: number;
}

export interface TraversalProfile {
  obstacle: ObstacleObb;
  hasReachableTop: boolean;
  topY: number;
  standingHeadroom: number;
  topLanding?: [number, number];
}

export interface GeometryWorld {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  blockers: readonly ObstacleObb[];
}

export interface TraversalClassifierConfig {
  sprintSpeed: number;
  jumpVY: number;
  gravity: number;
  capsuleRadius: number;
  capsuleHeight: number;
  takeoffMargin: number;
  landingMargin: number;
  clearanceMargin: number;
  vaultMaxHeight: number;
  vaultMaxDepth: number;
  vaultMaxDistance: number;
  climbMaxHeight: number;
}

export const DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG: TraversalClassifierConfig = {
  sprintSpeed: RUN_SPEED,
  jumpVY: RUNNING_JUMP_VY,
  gravity: GRAVITY,
  capsuleRadius: CAPSULE_RADIUS,
  capsuleHeight: STAND_HEIGHT,
  takeoffMargin: 1.25,
  landingMargin: 0.45,
  clearanceMargin: 0.12,
  vaultMaxHeight: 1.15,
  vaultMaxDepth: 1.2,
  vaultMaxDistance: 2.5,
  climbMaxHeight: 3.2,
};

export interface VaultApproachPlan {
  face: "POS_X" | "NEG_X" | "POS_Z" | "NEG_Z";
  normalX: number;
  normalZ: number;
  start: [number, number, number];
  contact: [number, number, number];
  clearance: [number, number, number];
  landing: [number, number, number];
  crossingDepth: number;
  totalDistance: number;
}

export interface ClimbApproachPlan {
  face: VaultApproachPlan["face"];
  normalX: number;
  normalZ: number;
  start: [number, number, number];
  top: [number, number, number];
}

interface Face {
  name: VaultApproachPlan["face"];
  normalX: number;
  normalZ: number;
  tangentX: number;
  tangentZ: number;
  halfDepth: number;
  halfWidth: number;
}

function axes(obb: ObstacleObb) {
  return {
    xX: Math.cos(obb.yaw),
    xZ: Math.sin(obb.yaw),
    zX: -Math.sin(obb.yaw),
    zZ: Math.cos(obb.yaw),
  };
}

function faces(obb: ObstacleObb): Face[] {
  const a = axes(obb);
  return [
    { name: "POS_X", normalX: a.xX, normalZ: a.xZ, tangentX: a.zX, tangentZ: a.zZ, halfDepth: obb.halfX, halfWidth: obb.halfZ },
    { name: "NEG_X", normalX: -a.xX, normalZ: -a.xZ, tangentX: a.zX, tangentZ: a.zZ, halfDepth: obb.halfX, halfWidth: obb.halfZ },
    { name: "POS_Z", normalX: a.zX, normalZ: a.zZ, tangentX: a.xX, tangentZ: a.xZ, halfDepth: obb.halfZ, halfWidth: obb.halfX },
    { name: "NEG_Z", normalX: -a.zX, normalZ: -a.zZ, tangentX: a.xX, tangentZ: a.xZ, halfDepth: obb.halfZ, halfWidth: obb.halfX },
  ];
}

function ballisticY(
  time: number,
  config: TraversalClassifierConfig,
): number {
  return config.jumpVY * time - 0.5 * config.gravity * time * time;
}

function pointInsideObb(
  x: number,
  z: number,
  obb: ObstacleObb,
  margin: number,
): boolean {
  const a = axes(obb);
  const dx = x - obb.centerX;
  const dz = z - obb.centerZ;
  const lx = dx * a.xX + dz * a.xZ;
  const lz = dx * a.zX + dz * a.zZ;
  return (
    Math.abs(lx) <= obb.halfX + margin &&
    Math.abs(lz) <= obb.halfZ + margin
  );
}

export function landingPointSafe(
  x: number,
  z: number,
  targetId: string,
  world: GeometryWorld,
  config: TraversalClassifierConfig = DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG,
): boolean {
  if (
    x < world.bounds.minX + config.capsuleRadius ||
    x > world.bounds.maxX - config.capsuleRadius ||
    z < world.bounds.minZ + config.capsuleRadius ||
    z > world.bounds.maxZ - config.capsuleRadius
  ) return false;
  return !world.blockers.some(
    (blocker) =>
      blocker.id !== targetId &&
      pointInsideObb(x, z, blocker, config.capsuleRadius),
  );
}

function runJumpClearsFace(
  profile: TraversalProfile,
  face: Face,
  world: GeometryWorld,
  config: TraversalClassifierConfig,
): boolean {
  const depth = face.halfDepth * 2;
  const nearTime = config.takeoffMargin / config.sprintSpeed;
  const farTime =
    (config.takeoffMargin + depth + config.capsuleRadius * 2) /
    config.sprintSpeed;
  const flightTime = (2 * config.jumpVY) / config.gravity;
  const flightRange = config.sprintSpeed * flightTime;
  const requiredRange =
    config.takeoffMargin +
    depth +
    config.capsuleRadius * 2 +
    config.landingMargin;
  if (requiredRange > flightRange || farTime >= flightTime) return false;
  const requiredY = profile.obstacle.height + config.clearanceMargin;
  if (
    Math.min(ballisticY(nearTime, config), ballisticY(farTime, config)) <
    requiredY
  ) return false;
  const takeoffX =
    profile.obstacle.centerX +
    face.normalX *
      (face.halfDepth + config.capsuleRadius + config.takeoffMargin);
  const takeoffZ =
    profile.obstacle.centerZ +
    face.normalZ *
      (face.halfDepth + config.capsuleRadius + config.takeoffMargin);
  const landingX = takeoffX - face.normalX * flightRange;
  const landingZ = takeoffZ - face.normalZ * flightRange;
  return landingPointSafe(
    landingX,
    landingZ,
    profile.obstacle.id,
    world,
    config,
  );
}

function vaultFaceValid(
  profile: TraversalProfile,
  face: Face,
  world: GeometryWorld,
  config: TraversalClassifierConfig,
): boolean {
  const depth = face.halfDepth * 2;
  if (
    profile.obstacle.height > config.vaultMaxHeight ||
    depth > config.vaultMaxDepth
  ) return false;
  const landingX =
    profile.obstacle.centerX -
    face.normalX *
      (face.halfDepth + config.capsuleRadius + config.landingMargin);
  const landingZ =
    profile.obstacle.centerZ -
    face.normalZ *
      (face.halfDepth + config.capsuleRadius + config.landingMargin);
  return landingPointSafe(
    landingX,
    landingZ,
    profile.obstacle.id,
    world,
    config,
  );
}

export function classifyTraversalGeometry(
  profile: TraversalProfile,
  world: GeometryWorld,
  config: TraversalClassifierConfig = DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG,
): GeometryTraversalClass {
  const obstacleFaces = faces(profile.obstacle);
  if (
    obstacleFaces.some((face) =>
      runJumpClearsFace(profile, face, world, config),
    )
  ) return "RUN_JUMP_CLEARABLE";
  if (
    obstacleFaces.some((face) =>
      vaultFaceValid(profile, face, world, config),
    )
  ) return "VAULT_REQUIRED";
  if (
    profile.hasReachableTop &&
    profile.topY > config.vaultMaxHeight &&
    profile.topY <= config.climbMaxHeight &&
    profile.standingHeadroom >= config.capsuleHeight &&
    (!profile.topLanding ||
      landingPointSafe(
        profile.topLanding[0],
        profile.topLanding[1],
        profile.obstacle.id,
        world,
        config,
      ))
  ) return "CLIMB_REQUIRED";
  return "BLOCKED";
}

export function resolveVaultApproach(
  profile: TraversalProfile,
  playerX: number,
  playerZ: number,
  world: GeometryWorld,
  config: TraversalClassifierConfig = DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG,
): VaultApproachPlan | null {
  if (
    classifyTraversalGeometry(profile, world, config) !== "VAULT_REQUIRED"
  ) return null;
  const options = faces(profile.obstacle)
    .map((face) => {
      const faceX =
        profile.obstacle.centerX + face.normalX * face.halfDepth;
      const faceZ =
        profile.obstacle.centerZ + face.normalZ * face.halfDepth;
      const along =
        (playerX - faceX) * face.tangentX +
        (playerZ - faceZ) * face.tangentZ;
      const clampedAlong = Math.max(
        -face.halfWidth + config.capsuleRadius,
        Math.min(face.halfWidth - config.capsuleRadius, along),
      );
      const contactX = faceX + face.tangentX * clampedAlong;
      const contactZ = faceZ + face.tangentZ * clampedAlong;
      return {
        face,
        contactX,
        contactZ,
        distance: Math.hypot(playerX - contactX, playerZ - contactZ),
      };
    })
    .filter(({ face }) => vaultFaceValid(profile, face, world, config))
    .sort((a, b) => a.distance - b.distance);

  for (const option of options) {
    const { face, contactX, contactZ } = option;
    const depth = face.halfDepth * 2;
    const startGap = config.capsuleRadius + 0.1;
    const landingGap = config.capsuleRadius + config.landingMargin;
    const totalDistance = startGap + depth + landingGap;
    if (totalDistance > config.vaultMaxDistance) continue;
    const start: [number, number, number] = [
      contactX + face.normalX * startGap,
      0,
      contactZ + face.normalZ * startGap,
    ];
    const farContactX = contactX - face.normalX * depth;
    const farContactZ = contactZ - face.normalZ * depth;
    const landing: [number, number, number] = [
      farContactX - face.normalX * landingGap,
      0,
      farContactZ - face.normalZ * landingGap,
    ];
    if (
      !landingPointSafe(
        landing[0],
        landing[2],
        profile.obstacle.id,
        world,
        config,
      )
    ) continue;
    return {
      face: face.name,
      normalX: face.normalX,
      normalZ: face.normalZ,
      start,
      contact: [contactX, profile.obstacle.height, contactZ],
      clearance: [
        profile.obstacle.centerX,
        profile.obstacle.height + config.clearanceMargin,
        profile.obstacle.centerZ,
      ],
      landing,
      crossingDepth: depth,
      totalDistance,
    };
  }
  return null;
}

export function resolveClimbApproach(
  profile: TraversalProfile,
  playerX: number,
  playerZ: number,
  world: GeometryWorld,
  allowedFaces?: readonly VaultApproachPlan["face"][],
  config: TraversalClassifierConfig = DEFAULT_TRAVERSAL_CLASSIFIER_CONFIG,
): ClimbApproachPlan | null {
  if (
    classifyTraversalGeometry(profile, world, config) !== "CLIMB_REQUIRED"
  ) return null;
  const allowed = allowedFaces ? new Set(allowedFaces) : null;
  const options = faces(profile.obstacle)
    .filter((face) => !allowed || allowed.has(face.name))
    .filter(
      (face) =>
        (playerX - profile.obstacle.centerX) * face.normalX +
          (playerZ - profile.obstacle.centerZ) * face.normalZ >
        0.05,
    )
    .map((face) => {
      const faceX =
        profile.obstacle.centerX + face.normalX * face.halfDepth;
      const faceZ =
        profile.obstacle.centerZ + face.normalZ * face.halfDepth;
      return {
        face,
        distance: Math.hypot(playerX - faceX, playerZ - faceZ),
      };
    })
    .sort((a, b) => a.distance - b.distance);
  const selected = options[0]?.face;
  if (!selected) return null;
  const gap = config.capsuleRadius + 0.12;
  const start: [number, number, number] = [
    profile.obstacle.centerX +
      selected.normalX * (selected.halfDepth + gap),
    0,
    profile.obstacle.centerZ +
      selected.normalZ * (selected.halfDepth + gap),
  ];
  const landingX = profile.topLanding?.[0] ?? profile.obstacle.centerX;
  const landingZ = profile.topLanding?.[1] ?? profile.obstacle.centerZ;
  if (
    !landingPointSafe(
      landingX,
      landingZ,
      profile.obstacle.id,
      world,
      config,
    )
  ) return null;
  return {
    face: selected.name,
    normalX: selected.normalX,
    normalZ: selected.normalZ,
    start,
    top: [landingX, profile.topY, landingZ],
  };
}
