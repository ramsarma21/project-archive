import type { StaminaAssist } from "./stamina.js";
import {
  CHASE_TUNING,
  type ChaseRouteGraph,
  type ChaseWaypoint,
} from "./stealthManifest.js";

export type ChasePhase =
  | "STARTING"
  | "ACTIVE"
  | "SHAKEN"
  | "CAUGHT"
  | "RESOLVING"
  | "ENDED";

export type ChaseOutcome = "ESCAPED" | "REFUGE" | "CAUGHT";

export interface ChasePoint {
  x: number;
  y: number;
  z: number;
}

export interface ChaseSweepResult {
  x: number;
  z: number;
  blockedX: boolean;
  blockedZ: boolean;
}

export interface ChaseWorldQuery {
  segmentClear(a: ChasePoint, b: ChasePoint): boolean;
  sweepXZ(
    from: ChasePoint,
    to: { x: number; z: number },
    radius: number,
    height: number,
  ): ChaseSweepResult;
}

export interface ChaseState {
  phase: ChasePhase;
  pursuer: ChasePoint;
  forward: ChasePoint;
  velocity: ChasePoint;
  elapsedSeconds: number;
  phaseSeconds: number;
  shakeSeconds: number;
  corneredSeconds: number;
  obstacleDelaySeconds: number;
  refugeSeconds: number;
  refugeId: string | null;
  targetWaypointId: string | null;
  lastActionSerial: number;
  pendingOutcome: ChaseOutcome | null;
  outcome: ChaseOutcome | null;
  outcomeSerial: number;
  tick: number;
}

export interface ChaseStepInput {
  tick: number;
  dt: number;
  player: ChasePoint;
  playerStamina: number;
  movementIntent: boolean;
  movementBlocked: boolean;
  actionSerial: number;
  refuge: { id: string; holdSeconds: number } | null;
  graph: ChaseRouteGraph;
  world: ChaseWorldQuery;
  pursuerSpeed: number;
  assist: StaminaAssist;
  confirmResolve?: boolean;
  resolutionCommitted?: boolean;
}

export interface ChaseStepResult {
  state: ChaseState;
  transition: { from: ChasePhase; to: ChasePhase } | null;
}

const PURSUER_RADIUS = 0.32;
const PURSUER_HEIGHT = 1.55;
const EPSILON = 1e-6;

function distanceXZ(a: ChasePoint, b: ChasePoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function eye(point: ChasePoint): ChasePoint {
  return { x: point.x, y: point.y + 1.35, z: point.z };
}

function motorSegmentClear(
  world: ChaseWorldQuery,
  a: ChasePoint,
  b: ChasePoint,
): boolean {
  if (!world.segmentClear(eye(a), eye(b))) return false;
  const sweep = world.sweepXZ(
    a,
    { x: b.x, z: b.z },
    PURSUER_RADIUS,
    PURSUER_HEIGHT,
  );
  return !sweep.blockedX && !sweep.blockedZ;
}

function toPoint(point: readonly [number, number, number]): ChasePoint {
  return { x: point[0], y: point[1], z: point[2] };
}

export function createChaseState(input: {
  tick: number;
  pursuer: ChasePoint;
  player: ChasePoint;
  actionSerial?: number;
}): ChaseState {
  const dx = input.player.x - input.pursuer.x;
  const dz = input.player.z - input.pursuer.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    phase: "STARTING",
    pursuer: { ...input.pursuer },
    forward: { x: dx / length, y: 0, z: dz / length },
    velocity: { x: 0, y: 0, z: 0 },
    elapsedSeconds: 0,
    phaseSeconds: 0,
    shakeSeconds: 0,
    corneredSeconds: 0,
    obstacleDelaySeconds: 0,
    refugeSeconds: 0,
    refugeId: null,
    targetWaypointId: null,
    lastActionSerial: input.actionSerial ?? 0,
    pendingOutcome: null,
    outcome: null,
    outcomeSerial: 0,
    tick: input.tick,
  };
}

function nearestWaypoint(
  graph: ChaseRouteGraph,
  point: ChasePoint,
  world: ChaseWorldQuery,
): ChaseWaypoint | null {
  const candidates = graph.waypoints
    .map((waypoint) => ({
      waypoint,
      distance: distanceXZ(point, toPoint(waypoint.position)),
    }))
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.waypoint.id.localeCompare(b.waypoint.id),
    );
  return (
    candidates.find(({ waypoint }) =>
      motorSegmentClear(world, point, toPoint(waypoint.position)),
    )?.waypoint ??
    candidates[0]?.waypoint ??
    null
  );
}

function authoredPath(
  graph: ChaseRouteGraph,
  from: ChasePoint,
  to: ChasePoint,
  world: ChaseWorldQuery,
): ChaseWaypoint[] {
  const start = nearestWaypoint(graph, from, world);
  const goal = nearestWaypoint(graph, to, world);
  if (!start || !goal) return [];
  if (start.id === goal.id) return [goal];
  const byId = new Map(graph.waypoints.map((point) => [point.id, point]));
  const distance = new Map<string, number>([[start.id, 0]]);
  const previous = new Map<string, string>();
  const open = new Set<string>([start.id]);
  while (open.size > 0) {
    const current = [...open].sort((a, b) => {
      const delta =
        (distance.get(a) ?? Infinity) - (distance.get(b) ?? Infinity);
      return delta || a.localeCompare(b);
    })[0]!;
    open.delete(current);
    if (current === goal.id) break;
    const point = byId.get(current);
    if (!point) continue;
    for (const nextId of [...point.links].sort()) {
      const next = byId.get(nextId);
      if (!next) continue;
      const a = toPoint(point.position);
      const b = toPoint(next.position);
      if (!motorSegmentClear(world, a, b)) continue;
      const candidate =
        (distance.get(current) ?? Infinity) + distanceXZ(a, b);
      if (candidate + EPSILON < (distance.get(nextId) ?? Infinity)) {
        distance.set(nextId, candidate);
        previous.set(nextId, current);
        open.add(nextId);
      }
    }
  }
  if (!distance.has(goal.id)) return [start];
  const ids = [goal.id];
  while (ids[0] !== start.id) {
    const prev = previous.get(ids[0]!);
    if (!prev) break;
    ids.unshift(prev);
  }
  return ids.map((id) => byId.get(id)!).filter(Boolean);
}

export function chaseTarget(
  state: ChaseState,
  input: ChaseStepInput,
): { point: ChasePoint; waypointId: string | null; direct: boolean } {
  if (motorSegmentClear(input.world, state.pursuer, input.player)) {
    return { point: input.player, waypointId: null, direct: true };
  }
  const path = authoredPath(
    input.graph,
    state.pursuer,
    input.player,
    input.world,
  );
  const next =
    path.find(
      (waypoint) =>
        distanceXZ(state.pursuer, toPoint(waypoint.position)) > 0.45,
    ) ?? path[path.length - 1];
  return next
    ? { point: toPoint(next.position), waypointId: next.id, direct: false }
    : { point: input.player, waypointId: null, direct: false };
}

function transition(
  state: ChaseState,
  phase: ChasePhase,
): ChaseStepResult {
  return {
    state: { ...state, phase, phaseSeconds: 0 },
    transition: { from: state.phase, to: phase },
  };
}

function chooseOutcome(
  state: ChaseState,
  outcome: ChaseOutcome,
  assist: StaminaAssist,
  confirmResolve: boolean,
): ChaseStepResult | null {
  if (assist === "CONFIRM_RESOLVE" && !confirmResolve) {
    return {
      state: { ...state, pendingOutcome: outcome },
      transition: null,
    };
  }
  const phase = outcome === "CAUGHT" ? "CAUGHT" : "SHAKEN";
  return transition(
    {
      ...state,
      pendingOutcome: null,
      outcome,
      outcomeSerial: state.outcomeSerial + 1,
    },
    phase,
  );
}

export function stepChase(
  current: ChaseState,
  input: ChaseStepInput,
): ChaseStepResult {
  const dt = Number.isFinite(input.dt) ? Math.max(0, input.dt) : 0;
  let state: ChaseState = {
    ...current,
    elapsedSeconds: current.elapsedSeconds + dt,
    phaseSeconds: current.phaseSeconds + dt,
    tick: input.tick,
  };

  if (state.phase === "ENDED") return { state, transition: null };
  if (state.phase === "RESOLVING") {
    return input.resolutionCommitted
      ? transition(state, "ENDED")
      : { state, transition: null };
  }
  if (state.phase === "SHAKEN" || state.phase === "CAUGHT") {
    return transition(state, "RESOLVING");
  }
  if (state.phase === "STARTING") {
    if (state.phaseSeconds >= CHASE_TUNING.startSeconds) {
      return transition(state, "ACTIVE");
    }
    return { state, transition: null };
  }

  if (
    state.pendingOutcome &&
    input.assist === "CONFIRM_RESOLVE" &&
    input.confirmResolve
  ) {
    return chooseOutcome(
      state,
      state.pendingOutcome,
      input.assist,
      true,
    )!;
  }

  if (input.refuge) {
    const same = state.refugeId === input.refuge.id;
    state = {
      ...state,
      refugeId: input.refuge.id,
      refugeSeconds: same ? state.refugeSeconds + dt : dt,
    };
    if (state.refugeSeconds + EPSILON >= input.refuge.holdSeconds) {
      return chooseOutcome(
        state,
        "REFUGE",
        input.assist,
        Boolean(input.confirmResolve),
      )!;
    }
    // Entering an authored refuge starts its close/settle timing. The player
    // cannot be caught while input is locked in that committed threshold beat.
    return {
      state: {
        ...state,
        velocity: { x: 0, y: 0, z: 0 },
      },
      transition: null,
    };
  } else {
    state = { ...state, refugeId: null, refugeSeconds: 0 };
  }

  const lineOfSight = input.world.segmentClear(
    eye(state.pursuer),
    eye(input.player),
  );
  const gap = distanceXZ(state.pursuer, input.player);
  const shakeSeconds =
    !lineOfSight && gap > CHASE_TUNING.shakeDistanceM
      ? state.shakeSeconds + dt
      : 0;
  const corneredSeconds =
    input.movementIntent && input.movementBlocked
      ? state.corneredSeconds + dt
      : 0;
  state = { ...state, shakeSeconds, corneredSeconds };
  if (shakeSeconds + EPSILON >= CHASE_TUNING.shakeHoldSeconds) {
    return chooseOutcome(
      state,
      "ESCAPED",
      input.assist,
      Boolean(input.confirmResolve),
    )!;
  }
  if (
    (gap < CHASE_TUNING.catchDistanceM && input.playerStamina <= EPSILON) ||
    corneredSeconds + EPSILON >= CHASE_TUNING.corneredHoldSeconds
  ) {
    return chooseOutcome(
      state,
      "CAUGHT",
      input.assist,
      Boolean(input.confirmResolve),
    )!;
  }

  let delay = Math.max(0, state.obstacleDelaySeconds - dt);
  if (input.actionSerial !== state.lastActionSerial) {
    delay = Math.max(delay, CHASE_TUNING.traversalDelaySeconds);
    state = { ...state, lastActionSerial: input.actionSerial };
  }
  if (delay > 0) {
    return {
      state: {
        ...state,
        obstacleDelaySeconds: delay,
        velocity: { x: 0, y: 0, z: 0 },
      },
      transition: null,
    };
  }

  const target = chaseTarget(state, input);
  const dx = target.point.x - state.pursuer.x;
  const dz = target.point.z - state.pursuer.z;
  const length = Math.hypot(dx, dz);
  if (length <= EPSILON) {
    return {
      state: {
        ...state,
        targetWaypointId: target.waypointId,
        velocity: { x: 0, y: 0, z: 0 },
      },
      transition: null,
    };
  }
  const forward = { x: dx / length, y: 0, z: dz / length };
  const distance = Math.min(length, input.pursuerSpeed * dt);
  const intended = {
    x: state.pursuer.x + forward.x * distance,
    z: state.pursuer.z + forward.z * distance,
  };
  const swept = input.world.sweepXZ(
    state.pursuer,
    intended,
    PURSUER_RADIUS,
    PURSUER_HEIGHT,
  );
  const blocked = swept.blockedX || swept.blockedZ;
  const pursuer = {
    x: swept.x,
    y: state.pursuer.y,
    z: swept.z,
  };
  return {
    state: {
      ...state,
      pursuer,
      forward,
      velocity: blocked
        ? { x: 0, y: 0, z: 0 }
        : {
            x: forward.x * input.pursuerSpeed,
            y: 0,
            z: forward.z * input.pursuerSpeed,
          },
      targetWaypointId: target.waypointId,
      obstacleDelaySeconds: blocked
        ? CHASE_TUNING.obstacleDelaySeconds
        : 0,
    },
    transition: null,
  };
}
