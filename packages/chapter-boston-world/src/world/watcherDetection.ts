import type {
  ConcealmentState,
  HeatBand,
  HeatDecayProgress,
  StandingBand,
} from "@pa/contracts";
import type { GameplayWorldService } from "./gameplayWorld.js";
import type {
  CheckpointVolume,
  ChaseVec3,
  WatcherDefinition,
} from "./stealthManifest.js";
import { FIELD_TICK_HZ } from "./fieldSimulation.js";
import { WATCHER_SCAN, watcherRange } from "./stealthManifest.js";
import { SUSPICION_THRESHOLDS } from "@pa/engine-world";

export type WatcherMotion =
  | "STILL"
  | "CROUCH"
  | "WALK"
  | "SPRINT"
  | "VAULT_CLIMB";

export interface WatcherPose {
  position: { x: number; y: number; z: number };
  forward: { x: number; y: number; z: number };
  velocity: { x: number; y: number; z: number };
  yaw: number;
}

export interface VisibilityInput {
  watcherPosition: { x: number; y: number; z: number };
  watcherForward: { x: number; y: number; z: number };
  playerPosition: { x: number; y: number; z: number };
  halfAngleRad: number;
  rangeM: number;
  concealment: ConcealmentState;
  motion: WatcherMotion;
  covered: boolean;
  segmentClear: GameplayWorldService["segmentClear"];
}

export interface VisibilityResult {
  visibility: number;
  inCone: boolean;
  hasLos: boolean;
  distanceM: number;
  coneFactor: number;
  distanceFactor: number;
  exposureFactor: number;
  motionFactor: number;
  coverFactor: number;
}

export interface SuspicionState {
  value: number;
  toldWary: boolean;
  toldAlerted: boolean;
  confronted: boolean;
}

export interface SuspicionStep {
  state: SuspicionState;
  crossed: readonly ("WARY" | "ALERTED" | "CONFRONTATION")[];
}

export interface CheckpointState {
  inside: boolean;
  armed: boolean;
  ordinal: number;
  cooldownUntilTick: number;
}

export interface CheckpointStep {
  state: CheckpointState;
  crossed: boolean;
  ordinal: number | null;
}

export function watcherAttentionPolicy(input: {
  exterior: boolean;
  active: boolean;
  chaseActive: boolean;
  suspended: boolean;
  interruptActive: boolean;
}): { simulationActive: boolean; canAccrue: boolean } {
  const simulationActive =
    input.exterior && input.active && !input.chaseActive;
  return {
    simulationActive,
    canAccrue:
      simulationActive && !input.suspended && !input.interruptActive,
  };
}

const EXPOSURE_FACTORS: Record<ConcealmentState, number> = {
  EXPOSED: 1,
  WRAPPED: 0.5,
  HIDDEN: 0.15,
};

const MOTION_FACTORS: Record<WatcherMotion, number> = {
  STILL: 0.5,
  CROUCH: 0.4,
  WALK: 0.8,
  SPRINT: 1.3,
  VAULT_CLIMB: 1.5,
};

const HEAT_FACTORS: Record<HeatBand, number> = {
  CALM: 0.8,
  NOTICED: 1,
  WATCHED: 1.25,
  HUNTED: 1.6,
};

const STANDING_FACTORS: Record<StandingBand, number> = {
  TRUSTED: 0.7,
  FAMILIAR: 0.7,
  NEUTRAL: 1,
  MARKED: 1.4,
};

// Sub-threshold glimpses at the feathered cone edge, through cover, or while
// concealed should make the watcher lose the player, not accumulate forever.
// The floor is applied after LOS/facing/distance/motion/cover factors.
export const MIN_ACCRUAL_VISIBILITY = 0.1;
export const SUSPICION_ACCRUAL_PER_SECOND = 0.6;
export const SUSPICION_DECAY_PER_SECOND = 0.55;
const TELL_RESET = {
  WARY: 0.2,
  ALERTED: 0.5,
  CONFRONTATION: 0.65,
} as const;

const HEAT_DECAY_SECONDS: Record<HeatBand, number | null> = {
  CALM: null,
  NOTICED: 90,
  WATCHED: 60,
  HUNTED: 45,
};

const LOWER_HEAT: Record<Exclude<HeatBand, "CALM">, HeatBand> = {
  NOTICED: "CALM",
  WATCHED: "NOTICED",
  HUNTED: "WATCHED",
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export function visibilityFactors(input: VisibilityInput): VisibilityResult {
  const eye = {
    x: input.watcherPosition.x,
    y: input.watcherPosition.y + 1.62,
    z: input.watcherPosition.z,
  };
  const chest = {
    x: input.playerPosition.x,
    y: input.playerPosition.y + 1.05,
    z: input.playerPosition.z,
  };
  const dx = chest.x - eye.x;
  const dz = chest.z - eye.z;
  const distanceM = Math.hypot(dx, dz);
  const invDistance = distanceM > 1e-9 ? 1 / distanceM : 0;
  const forwardLength =
    Math.hypot(input.watcherForward.x, input.watcherForward.z) || 1;
  const dot =
    (input.watcherForward.x / forwardLength) * dx * invDistance +
    (input.watcherForward.z / forwardLength) * dz * invDistance;
  const coneFactor =
    distanceM <= input.rangeM
      ? smoothstep(Math.cos(input.halfAngleRad), 1, dot)
      : 0;
  const distanceFactor = clamp01(1 - distanceM / input.rangeM);
  const exposureFactor = EXPOSURE_FACTORS[input.concealment];
  const motionFactor = MOTION_FACTORS[input.motion];
  const coverFactor = input.covered ? 0.3 : 1;
  const inCone =
    distanceM <= input.rangeM &&
    dot + 1e-12 >= Math.cos(input.halfAngleRad);
  const hasLos = inCone && input.segmentClear(eye, chest);
  const visibility = hasLos
    ? clamp01(
        coneFactor *
          distanceFactor *
          exposureFactor *
          motionFactor *
          coverFactor,
      )
    : 0;
  return {
    visibility,
    inCone,
    hasLos,
    distanceM,
    coneFactor,
    distanceFactor,
    exposureFactor,
    motionFactor,
    coverFactor,
  };
}

export function initialSuspicionState(): SuspicionState {
  return {
    value: 0,
    toldWary: false,
    toldAlerted: false,
    confronted: false,
  };
}

export function stepSuspicion(
  state: SuspicionState,
  input: {
    dt: number;
    visibility: number;
    heat: HeatBand;
    standing: StandingBand;
  },
): SuspicionStep {
  const increasing = input.visibility > MIN_ACCRUAL_VISIBILITY;
  const legibleVisibility = increasing
    ? (input.visibility - MIN_ACCRUAL_VISIBILITY) /
      (1 - MIN_ACCRUAL_VISIBILITY)
    : 0;
  const delta = increasing
    ? SUSPICION_ACCRUAL_PER_SECOND *
      legibleVisibility *
      HEAT_FACTORS[input.heat] *
      STANDING_FACTORS[input.standing] *
      input.dt
    : -SUSPICION_DECAY_PER_SECOND * input.dt;
  const value = clamp01(state.value + delta);
  const crossed: ("WARY" | "ALERTED" | "CONFRONTATION")[] = [];
  const toldWary =
    value >= SUSPICION_THRESHOLDS.WARY ||
    (state.toldWary && value > TELL_RESET.WARY);
  const toldAlerted =
    value >= SUSPICION_THRESHOLDS.ALERTED ||
    (state.toldAlerted && value > TELL_RESET.ALERTED);
  const confronted =
    value >= SUSPICION_THRESHOLDS.CONFRONTATION ||
    (state.confronted && value > TELL_RESET.CONFRONTATION);
  if (!state.toldWary && toldWary) crossed.push("WARY");
  if (!state.toldAlerted && toldAlerted) crossed.push("ALERTED");
  if (!state.confronted && confronted) crossed.push("CONFRONTATION");
  return {
    state: { value, toldWary, toldAlerted, confronted },
    crossed,
  };
}

function triangleScan(seconds: number): number {
  const amplitude = WATCHER_SCAN.yawAmplitudeRad;
  const period = (4 * amplitude) / WATCHER_SCAN.yawRateRadPerSecond;
  const phase = ((seconds % period) + period) % period;
  const quarter = period / 4;
  if (phase < quarter) return (phase / quarter) * amplitude;
  if (phase < quarter * 3) {
    return amplitude - ((phase - quarter) / (quarter * 2)) * amplitude * 2;
  }
  return -amplitude + ((phase - quarter * 3) / quarter) * amplitude;
}

function planarYaw(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

function postedPose(
  definition: WatcherDefinition,
  tick: number,
  attentionTarget?: ChaseVec3 | null,
): WatcherPose {
  const position = {
    x: definition.position[0],
    y: definition.position[1],
    z: definition.position[2],
  };
  const yaw = attentionTarget
    ? planarYaw(position, { x: attentionTarget[0], z: attentionTarget[2] })
    : definition.baseYaw + triangleScan(tick / FIELD_TICK_HZ);
  return {
    position,
    forward: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
    velocity: { x: 0, y: 0, z: 0 },
    yaw,
  };
}

function patrolPose(
  definition: WatcherDefinition,
  tick: number,
  attentionTarget?: ChaseVec3 | null,
): WatcherPose {
  const route = definition.patrol!;
  const points = route.waypoints;
  const legs: {
    from: ChaseVec3;
    to: ChaseVec3;
    length: number;
  }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]!;
    const to = points[i + 1]!;
    legs.push({
      from,
      to,
      length: Math.hypot(to[0] - from[0], to[2] - from[2]),
    });
  }
  for (let i = points.length - 1; i > 0; i--) {
    const from = points[i]!;
    const to = points[i - 1]!;
    legs.push({
      from,
      to,
      length: Math.hypot(to[0] - from[0], to[2] - from[2]),
    });
  }
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  let progress = ((tick / FIELD_TICK_HZ) * route.speedMps) % total;
  let leg = legs[0]!;
  for (const candidate of legs) {
    if (progress <= candidate.length) {
      leg = candidate;
      break;
    }
    progress -= candidate.length;
  }
  const t = leg.length > 0 ? progress / leg.length : 0;
  const position = {
    x: leg.from[0] + (leg.to[0] - leg.from[0]) * t,
    y: leg.from[1] + (leg.to[1] - leg.from[1]) * t,
    z: leg.from[2] + (leg.to[2] - leg.from[2]) * t,
  };
  const baseYaw = planarYaw(
    { x: leg.from[0], z: leg.from[2] },
    { x: leg.to[0], z: leg.to[2] },
  );
  const yaw = attentionTarget
    ? planarYaw(position, { x: attentionTarget[0], z: attentionTarget[2] })
    : baseYaw;
  return {
    position,
    forward: { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) },
    velocity: {
      x: Math.sin(baseYaw) * route.speedMps,
      y: 0,
      z: Math.cos(baseYaw) * route.speedMps,
    },
    yaw,
  };
}

export function watcherPoseAt(
  definition: WatcherDefinition,
  tick: number,
  attentionTarget?: ChaseVec3 | null,
): WatcherPose {
  return definition.kind === "PATROL"
    ? patrolPose(definition, tick, attentionTarget)
    : postedPose(definition, tick, attentionTarget);
}

export function rangeAtDayProgress(
  definition: WatcherDefinition,
  dayProgress: number,
): number {
  return watcherRange(definition.rangeM, dayProgress);
}

export function initialCheckpointState(): CheckpointState {
  return { inside: false, armed: true, ordinal: 0, cooldownUntilTick: 0 };
}

function insideCheckpoint(
  volume: CheckpointVolume,
  position: { x: number; z: number },
): boolean {
  return (
    Math.abs(position.x - volume.center[0]) <= volume.halfExtents[0] &&
    Math.abs(position.z - volume.center[2]) <= volume.halfExtents[1]
  );
}

export function stepCheckpoint(
  state: CheckpointState,
  volume: CheckpointVolume,
  position: { x: number; z: number },
  tick: number,
): CheckpointStep {
  const inside = insideCheckpoint(volume, position);
  const centerDistance = Math.hypot(
    position.x - volume.center[0],
    position.z - volume.center[2],
  );
  let armed = state.armed;
  if (
    !inside &&
    tick >= state.cooldownUntilTick &&
    centerDistance >= volume.rearmDistanceM
  ) {
    armed = true;
  }
  const crossed = inside && !state.inside && armed;
  const ordinal = crossed ? state.ordinal + 1 : state.ordinal;
  return {
    state: {
      inside,
      armed: crossed ? false : armed,
      ordinal,
      cooldownUntilTick: crossed
        ? tick + Math.round(volume.cooldownSeconds * FIELD_TICK_HZ)
        : state.cooldownUntilTick,
    },
    crossed,
    ordinal: crossed ? ordinal : null,
  };
}

export function checkpointChallenges(input: {
  heat: HeatBand;
  standing: StandingBand;
  concealment: ConcealmentState;
}): boolean {
  // Carrying EXPOSED goods through a customs checkpoint always draws the
  // stop, even at CALM — the writs search is the authored teaching encounter
  // (Mechanics-Spec: the historical constraint IS the game constraint).
  // Concealment is the earned pass: wrapped goods at CALM cross unchallenged,
  // and a known face (high Standing) with concealed goods passes at any heat.
  const concealed = input.concealment !== "EXPOSED";
  if (input.heat === "CALM") return !concealed;
  const highStanding =
    input.standing === "FAMILIAR" || input.standing === "TRUSTED";
  return !(highStanding && concealed);
}

export function stepHeatDecay(
  progress: HeatDecayProgress,
  dt: number,
  paused: boolean,
): {
  progress: HeatDecayProgress;
  transition: { from: HeatBand; to: HeatBand } | null;
} {
  const requiredSeconds = HEAT_DECAY_SECONDS[progress.band];
  if (requiredSeconds === null) {
    return {
      progress: {
        band: "CALM",
        elapsedSeconds: 0,
        requiredSeconds: null,
        paused,
      },
      transition: null,
    };
  }
  const elapsedSeconds = paused
    ? progress.elapsedSeconds
    : Math.min(requiredSeconds, progress.elapsedSeconds + Math.max(0, dt));
  if (elapsedSeconds >= requiredSeconds) {
    return {
      progress: {
        band: progress.band,
        elapsedSeconds: requiredSeconds,
        requiredSeconds,
        paused,
      },
      transition: {
        from: progress.band,
        to: LOWER_HEAT[progress.band as Exclude<HeatBand, "CALM">],
      },
    };
  }
  return {
    progress: {
      band: progress.band,
      elapsedSeconds,
      requiredSeconds,
      paused,
    },
    transition: null,
  };
}

export function nearestEligibleWatcher<T extends { position: { x: number; z: number } }>(
  watchers: readonly T[],
  target: { x: number; z: number },
): T | null {
  let nearest: T | null = null;
  let nearestDistance = Infinity;
  for (const watcher of watchers) {
    const distance = Math.hypot(
      watcher.position.x - target.x,
      watcher.position.z - target.z,
    );
    if (distance < nearestDistance) {
      nearest = watcher;
      nearestDistance = distance;
    }
  }
  return nearest;
}
