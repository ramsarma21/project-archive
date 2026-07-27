// Traversability verification against the shipped movement envelope.
//
// Nothing here re-implements movement. Ballistic links are checked by running
// @pa/engine-world's own `simulateBallistic`; dives are checked by asking
// `solveLeapOfFaith` whether the parkour system would even offer them;
// authored affordances are checked by asking `beginAuthored` whether it would
// start; and every distance is checked against `levelDesignMaxGapM`, which is
// derived from the physics constants rather than restated here.
//
// A link passes only if the shipped systems perform it. The arithmetic is
// checked as well, because a gap that only just works at full sprint should be
// on a FAST line and say so.

import {
  CAPSULE_RADIUS,
  CONTACT_EPS,
  CROUCH_HEIGHT,
  STAND_HEIGHT,
  type CollisionWorld,
  type Vec3,
  headClearance,
  positionClear,
  supportBelow,
} from "@pa/engine-world/collision";
import {
  COYOTE_MS,
  RUNNING_JUMP_VY,
  RUN_SPEED,
  STEP_DOWN,
  beginAuthored,
  createGroundedState,
  dashSpeed,
  simulateBallistic,
} from "@pa/engine-world/playerMotion";
import {
  DASH_ENVELOPE,
  MOVEMENT_CAPABILITIES,
  PARKOUR_TUNING,
  planVerb,
  probeAhead,
  solveLeapOfFaith,
  type ReceivingTarget,
  type SelectContext,
} from "@pa/engine-world/parkour";
import {
  ACTION_MS,
  gapBudgetM,
  jumpAirtimeForDrop,
  landingKindForDrop,
  levelDesignMaxGapM,
  resolveDrop,
  verbForRise,
} from "./envelope.js";
import type { CompiledLevel } from "./compile.js";
import type {
  MissionLevel,
  Rect,
  RouteLink,
  RouteNode,
  Vec3Tuple,
} from "./types.js";

const BALLISTIC_KINDS = new Set(["DROP", "JUMP", "DASH_JUMP", "LEAP_OF_FAITH"]);
const AUTHORED_KINDS = new Set(["VAULT", "CLIMB", "MANTLE", "DUCK_UNDER"]);

/**
 * Margin a dash gap must leave under the burst's own reach.
 *
 * The same idea as `LEVEL_DESIGN_GAP_MARGIN_M` and for the same reason: a gap
 * authored to the exact millimetre of what the physics can do only clears on a
 * flawless approach, and the whole point of a shortcut is that a confident
 * player takes it at speed rather than measuring it.
 */
const DASH_GAP_MARGIN_M = 0.5;

export interface LinkVerdict {
  id: string;
  kind: RouteLink["kind"];
  line: RouteLink["line"];
  ok: boolean;
  problems: string[];
  /** Horizontal lip-to-lip gap for ballistic links. */
  gapM: number | null;
  /** Positive when the landing is below the take-off. */
  dropM: number;
  /** What this line is allowed to author at that drop. */
  budgetM: number | null;
  /** The verb the parkour reader will resolve for this geometry. */
  verb: string;
  landedOn: string | null;
  distanceM: number;
  durationS: number;
  /** Noise this link emits, and how far it carries. */
  noise: { intensity: number; radiusM: number; at: Vec3Tuple } | null;
}

function toVec(t: Vec3Tuple): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

function horizontal(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

function unit(a: Vec3Tuple, b: Vec3Tuple): { x: number; z: number } {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const length = Math.hypot(dx, dz) || 1;
  return { x: dx / length, z: dz / length };
}

export function surfaceRectOf(compiled: CompiledLevel, id: string): Rect | null {
  return (
    compiled.deckById.get(id)?.rect ?? compiled.massById.get(id)?.rect ?? null
  );
}

/**
 * Walk forward from a supported point until the surface underfoot stops being
 * the one we started on. Returns the last supported point — the lip the player
 * actually leaves from.
 */
export function findLip(
  world: CollisionWorld,
  from: Vec3,
  dir: { x: number; z: number },
  maxDistance = 40,
): { point: Vec3; distance: number } {
  const step = 0.05;
  let last = { ...from };
  let travelled = 0;
  for (let d = step; d <= maxDistance; d += step) {
    const probe = { x: from.x + dir.x * d, y: from.y, z: from.z + dir.z * d };
    const support = supportBelow(world, probe.x, probe.z, probe.y);
    if (!support || Math.abs(support.y - from.y) > MOVEMENT_CAPABILITIES.maxStepUpM) {
      break;
    }
    last = probe;
    travelled = d;
  }
  return { point: last, distance: travelled };
}

/** Distance along a ray at which it first enters an axis-aligned rect. */
function rayEnterRect(
  origin: { x: number; z: number },
  dir: { x: number; z: number },
  box: Rect,
): number | null {
  const slab = (
    start: number,
    delta: number,
    min: number,
    max: number,
  ): [number, number] | null => {
    if (Math.abs(delta) < 1e-9) {
      return start >= min && start <= max ? [0, Infinity] : null;
    }
    const a = (min - start) / delta;
    const b = (max - start) / delta;
    return [Math.min(a, b), Math.max(a, b)];
  };
  const xs = slab(origin.x, dir.x, box.minX, box.maxX);
  if (!xs) return null;
  const zs = slab(origin.z, dir.z, box.minZ, box.maxZ);
  if (!zs) return null;
  const enter = Math.max(xs[0], zs[0]);
  const exit = Math.min(xs[1], zs[1]);
  if (enter > exit || exit < 0) return null;
  return Math.max(0, enter);
}

function verifyLeap(
  compiled: CompiledLevel,
  from: RouteNode,
  to: RouteNode,
  spec: RouteLink,
  targets: readonly ReceivingTarget[],
): LinkVerdict {
  const problems: string[] = [];
  const dir = unit(from.pos, to.pos);
  const lip = findLip(compiled.world, toVec(from.pos), dir);
  const drop = from.pos[1] - to.pos[1];

  if (drop < PARKOUR_TUNING.leapMinDropM) {
    problems.push(
      `${drop.toFixed(2)}m drop is below the ${PARKOUR_TUNING.leapMinDropM}m dive floor, so the reader will never offer a leap here`,
    );
  }

  const solution = solveLeapOfFaith(lip.point, dir.x, dir.z, targets);
  if (!solution) {
    problems.push("solveLeapOfFaith offers nothing from this lip");
  } else {
    if (spec.target && solution.target.id !== spec.target) {
      problems.push(
        `the solver picks ${solution.target.id}, not the authored ${spec.target}`,
      );
    }
    if (Math.abs(solution.target.y - to.pos[1]) > 0.2) {
      problems.push(
        `target rests at y=${solution.target.y.toFixed(2)} but the node is at ${to.pos[1].toFixed(2)}`,
      );
    }
  }

  const landing = PARKOUR_TUNING.landingNoise.RECEIVED;
  return {
    id: spec.id,
    kind: spec.kind,
    line: spec.line,
    ok: problems.length === 0,
    problems,
    gapM: solution?.distanceM ?? null,
    dropM: drop,
    budgetM: null,
    verb: "LEAP_OF_FAITH",
    landedOn: solution?.target.id ?? null,
    distanceM: horizontal(from.pos, to.pos),
    durationS:
      (solution ? solution.flightTicks / MOVEMENT_CAPABILITIES.tickHz : 0) +
      ACTION_MS.LEAP_OF_FAITH / 1000 +
      0.35,
    noise: {
      intensity: landing,
      radiusM: landing * PARKOUR_TUNING.noiseRadiusPerIntensityM,
      at: to.pos,
    },
  };
}

function verifyBallistic(
  compiled: CompiledLevel,
  from: RouteNode,
  to: RouteNode,
  spec: RouteLink,
): LinkVerdict {
  const world = compiled.world;
  const problems: string[] = [];
  const bursting = spec.kind === "DASH_JUMP";
  // A burst's speed is the engine's, never the author's. `speedMps` on a
  // ballistic link is how fast the player is assumed to be RUNNING when they
  // reach the lip, and a dash is not running — it is one shared constant the
  // duel's dodge uses too, so letting a level name a number here would be
  // letting it tune the burst.
  const speed = bursting ? dashSpeed(RUN_SPEED) : (spec.speedMps ?? RUN_SPEED);
  const dir = unit(from.pos, to.pos);
  const drop = from.pos[1] - to.pos[1];
  const jumping = spec.kind === "JUMP" || bursting;

  const lip = findLip(world, toVec(from.pos), dir);
  const targetRect = surfaceRectOf(compiled, to.surface);
  const gap = targetRect
    ? rayEnterRect({ x: lip.point.x, z: lip.point.z }, dir, targetRect)
    : null;

  const budget = gapBudgetM(Math.max(0, drop), spec.line);
  if (!bursting && jumping && gap !== null && drop >= 0 && gap > budget) {
    problems.push(
      `gap ${gap.toFixed(2)}m exceeds the ${spec.line} budget ${budget.toFixed(2)}m (hard cap ${levelDesignMaxGapM(Math.max(0, drop)).toFixed(2)}m) for a ${drop.toFixed(2)}m drop`,
    );
  }
  // A dash gap is checked against the burst's published reach instead, and
  // against the running jump's from the other side. Both directions matter: too
  // wide and the shortcut is a lie, too narrow and the link claims to need a
  // verb that it does not, which is how a level ends up "requiring" a dash by
  // accident.
  if (bursting && gap !== null) {
    const reach = DASH_ENVELOPE.jumpGapM - DASH_GAP_MARGIN_M;
    if (gap > reach) {
      problems.push(
        `gap ${gap.toFixed(2)}m is past what a dash-jump reaches with any margin: ` +
          `${DASH_ENVELOPE.jumpGapM.toFixed(2)}m less ${DASH_GAP_MARGIN_M}m`,
      );
    }
    if (drop >= 0 && gap <= levelDesignMaxGapM(Math.max(0, drop))) {
      problems.push(
        `gap ${gap.toFixed(2)}m is inside the ${levelDesignMaxGapM(Math.max(0, drop)).toFixed(2)}m a level may author for a running jump, ` +
          "so this is an ordinary JUMP and calling it a dash overstates what it costs",
      );
    }
  }
  const rise = -drop;
  if (jumping && rise > 0 && rise > MOVEMENT_CAPABILITIES.jumpApexM - 0.1) {
    problems.push(
      `needs ${rise.toFixed(2)}m of rise; a running jump apexes at ${MOVEMENT_CAPABILITIES.jumpApexM.toFixed(2)}m`,
    );
  }

  // A DROP is the player running off a lip, so the reader's edge ladder decides
  // what actually happens. Above the brake threshold it is not a drop at all.
  let verb = bursting ? "DASH" : "JUMP_GAP";
  if (!jumping) {
    const resolution = resolveDrop(drop);
    verb = resolution;
    if (resolution === "EDGE_BRAKE") {
      problems.push(
        `${drop.toFixed(2)}m exceeds the ${PARKOUR_TUNING.rollMaxDropM}m roll ceiling, so the reader brakes at the lip instead of running off`,
      );
    }
  }

  const carry = jumping
    ? -MOVEMENT_CAPABILITIES.jumpTakeoffSetbackM
    : speed * (COYOTE_MS / 1000);
  const start: Vec3 = {
    x: lip.point.x + dir.x * carry,
    y: from.pos[1],
    z: lip.point.z + dir.z * carry,
  };
  const prediction = simulateBallistic(
    world,
    start,
    { x: dir.x * speed, y: jumping ? RUNNING_JUMP_VY : 0, z: dir.z * speed },
    spec.ignore ? new Set(spec.ignore) : undefined,
  );

  if (!prediction.landed) {
    problems.push("the arc never lands");
  } else if (!prediction.valid) {
    problems.push(`lands on ${prediction.landingId} without standing clearance`);
  } else if (prediction.landingId !== to.surface) {
    problems.push(
      `lands on ${prediction.landingId}, not the authored ${to.surface}`,
    );
  } else if (Math.abs(prediction.pos.y - to.pos[1]) > 0.12) {
    problems.push(
      `lands at y=${prediction.pos.y.toFixed(2)} but the node is at ${to.pos[1].toFixed(2)}`,
    );
  }

  const intensity =
    PARKOUR_TUNING.landingNoise[landingKindForDrop(Math.max(0, drop))];
  return {
    id: spec.id,
    kind: spec.kind,
    line: spec.line,
    ok: problems.length === 0,
    problems,
    gapM: gap,
    dropM: drop,
    budgetM: budget,
    verb,
    landedOn: prediction.landingId,
    distanceM: horizontal(from.pos, to.pos),
    durationS: jumpAirtimeForDrop(Math.max(0, drop)),
    noise: {
      intensity,
      radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
      at: to.pos,
    },
  };
}

/**
 * Verify a VAULT the way the RUNTIME reads it, with no separate trajectory.
 *
 * The static verifier used to hand `beginAuthored` a three-point arc peaking at
 * `vaultArcHeightM` above the two endpoints — both on the ground — which cleared
 * far lower than the arc the live reader actually flies. `planVerb` anchors a
 * vault on the OBSTACLE TOP (start, near-top, far-top, far side), so the real arc
 * rises over the barrels and, at the old GAOL line, clipped the two flanking
 * stall canopies to either side. The static arc missed them; the live arc did
 * not, and the runtime then silently fell back to MANTLE. This asks the exact
 * question the runtime asks: probe the travel line, plan the VAULT, preflight it.
 */
function liveVaultRefusal(
  world: CollisionWorld,
  from: RouteNode,
  to: RouteNode,
): string | null {
  const dx = to.pos[0] - from.pos[0];
  const dz = to.pos[2] - from.pos[2];
  const len = Math.hypot(dx, dz) || 1;
  const dirX = dx / len;
  const dirZ = dz / len;
  const yaw = Math.atan2(dirX, dirZ);
  const speed = RUN_SPEED;
  const start = {
    ...createGroundedState(toVec(from.pos), yaw),
    vel: { x: dirX * speed, y: 0, z: dirZ * speed },
  };
  const probe = probeAhead(world, {
    pos: toVec(from.pos),
    velX: dirX * speed,
    velZ: dirZ * speed,
    yaw,
  });
  const ctx: SelectContext = {
    grounded: true,
    // Sprint is the parkour consent the reader requires; a verifier stands in for
    // a player holding it.
    sprintHeld: true,
    jumpBuffered: false,
    crouchHeld: false,
    chaining: false,
    receivingTargets: [],
    reducedMotion: false,
  };
  const choice = planVerb(world, probe, ctx, "VAULT", toVec(from.pos));
  if (!choice || choice.motion.kind !== "AUTHORED") {
    return "the reader finds no vault on the travel line (no far side read)";
  }
  const started = beginAuthored(world, start, {
    kind: choice.motion.authored,
    anchors: choice.motion.anchors,
    durationMs: choice.motion.durationMs,
    ignore: choice.motion.ignore,
    arcHeight: choice.motion.arcHeight,
  });
  return started
    ? null
    : "beginAuthored refuses the live vault arc (obstacle-top trajectory clips geometry)";
}

function verifyAuthored(
  compiled: CompiledLevel,
  from: RouteNode,
  to: RouteNode,
  spec: RouteLink,
): LinkVerdict {
  const world = compiled.world;
  const problems: string[] = [];
  const rise = to.pos[1] - from.pos[1];
  const distance = horizontal(from.pos, to.pos);
  let durationS = 0;
  let verb = spec.kind as string;

  let kind: "VAULT" | "CLIMB_UP" | "CLIMB_DOWN" | "DUCK_UNDER";
  const anchors: Array<{ x: number; y: number; z: number }> = [];
  // A VAULT is preflighted by the live reader (see `liveVaultRefusal`) rather
  // than by the hand-built arc below, so the verifier and the runtime cannot
  // disagree about which trajectory it flies.
  let liveVerified = false;

  if (spec.kind === "VAULT") {
    kind = "VAULT";
    verb = "VAULT";
    durationS = ACTION_MS.VAULT / 1000;
    for (const id of spec.ignore ?? []) {
      const mass = compiled.massById.get(id);
      if (!mass) {
        problems.push(`vault obstacle ${id} does not exist`);
        continue;
      }
      const height = mass.topY - mass.baseY;
      const depth = Math.min(
        mass.rect.maxX - mass.rect.minX,
        mass.rect.maxZ - mass.rect.minZ,
      );
      if (height > PARKOUR_TUNING.vaultMaxHeightM + 1e-6) {
        problems.push(
          `${id} is ${height.toFixed(2)}m tall; the vault envelope stops at ${PARKOUR_TUNING.vaultMaxHeightM}m`,
        );
      }
      if (depth > PARKOUR_TUNING.vaultMaxDepthM + 1e-6) {
        problems.push(
          `${id} is ${depth.toFixed(2)}m deep; the vault envelope stops at ${PARKOUR_TUNING.vaultMaxDepthM}m`,
        );
      }
      // The reader also refuses a vault whose far side drops too far.
      const farDrop = from.pos[1] - to.pos[1];
      if (farDrop > PARKOUR_TUNING.vaultMaxLandingDropM + 1e-6) {
        problems.push(
          `far side drops ${farDrop.toFixed(2)}m; a vault only accepts ${PARKOUR_TUNING.vaultMaxLandingDropM}m`,
        );
      }
    }
    // The trajectory is the runtime's, not a static counterfactual. This is the
    // check that used to pass a vault the live reader refuses.
    const refusal = liveVaultRefusal(world, from, to);
    if (refusal) problems.push(refusal);
    liveVerified = true;
  } else if (spec.kind === "DUCK_UNDER") {
    kind = "DUCK_UNDER";
    verb = "SLIDE";
    durationS = ACTION_MS.SLIDE / 1000;
    const midX = (from.pos[0] + to.pos[0]) / 2;
    const midZ = (from.pos[2] + to.pos[2]) / 2;
    const clear = headClearance(world, midX, midZ, CAPSULE_RADIUS, from.pos[1]);
    if (clear >= STAND_HEIGHT) {
      problems.push(
        `nothing to slide under: ${clear.toFixed(2)}m of headroom at the midpoint`,
      );
    }
    if (clear < PARKOUR_TUNING.slideMinHeadroomM) {
      problems.push(
        `${clear.toFixed(2)}m of headroom is below the ${PARKOUR_TUNING.slideMinHeadroomM}m slide minimum`,
      );
    }
    if (distance > PARKOUR_TUNING.slideMaxDepthM + 1e-6) {
      problems.push(
        `slide spans ${distance.toFixed(2)}m; the envelope stops at ${PARKOUR_TUNING.slideMaxDepthM}m`,
      );
    }
    anchors.push(toVec(from.pos), toVec(to.pos));
  } else {
    kind = rise >= 0 ? "CLIMB_UP" : "CLIMB_DOWN";
    // The verb comes from the obstacle, not from the height difference between
    // the endpoints: crossing a partition leaves you at the same level you
    // started, and the thing that makes it a CLIMB_OVER is that its top is too
    // narrow to stand on.
    const crossed = (spec.ignore ?? [])
      .map((id) => compiled.massById.get(id))
      .find((mass) => mass !== undefined);
    const crossedTopDepth = crossed
      ? Math.min(
          crossed.rect.maxX - crossed.rect.minX,
          crossed.rect.maxZ - crossed.rect.minZ,
        )
      : Infinity;
    const crossedHeight = crossed ? crossed.topY - crossed.baseY : 0;
    const overNotOnto =
      crossed !== undefined &&
      !crossed.landable &&
      crossedTopDepth < MOVEMENT_CAPABILITIES.minStandableTopDepthM &&
      crossedHeight <= PARKOUR_TUNING.climbOverMaxHeightM &&
      crossedTopDepth <= PARKOUR_TUNING.climbOverMaxDepthM;
    const resolved = overNotOnto
      ? "CLIMB_OVER"
      : verbForRise(Math.abs(rise), true);
    verb = rise >= 0 ? resolved : "HANG_DROP";
    durationS =
      (rise >= 0
        ? ACTION_MS[resolved as keyof typeof ACTION_MS] ?? ACTION_MS.CLIMB_UP
        : ACTION_MS.HANG_DROP) / 1000;
    if (rise >= 0 && resolved === "BLOCKED") {
      problems.push(
        `${rise.toFixed(2)}m of climb; above ${PARKOUR_TUNING.climbMaxHeightM}m the geometry reads as BLOCKED`,
      );
    }
    if (rise < 0 && Math.abs(rise) > PARKOUR_TUNING.hangDropMaxDropM + 1e-6) {
      problems.push(
        `${Math.abs(rise).toFixed(2)}m hang drop; the envelope stops at ${PARKOUR_TUNING.hangDropMaxDropM}m`,
      );
    }
    anchors.push(toVec(from.pos), toVec(to.pos));
  }

  // A VAULT was already preflighted through the live reader above; every other
  // authored kind is checked here against its own endpoints.
  if (!liveVerified) {
    const started = beginAuthored(world, createGroundedState(toVec(from.pos), 0), {
      kind,
      anchors,
      durationMs: Math.round(durationS * 1000),
      ...(spec.ignore ? { ignore: spec.ignore } : {}),
    });
    if (!started) {
      problems.push("beginAuthored refuses this affordance (endpoint or trajectory)");
    }
  }

  const intensity =
    PARKOUR_TUNING.verbNoise[verb as keyof typeof PARKOUR_TUNING.verbNoise] ?? 0;
  return {
    id: spec.id,
    kind: spec.kind,
    line: spec.line,
    ok: problems.length === 0,
    problems,
    gapM: null,
    dropM: -rise,
    budgetM: null,
    verb,
    landedOn: to.surface,
    distanceM: distance,
    durationS,
    noise: {
      intensity,
      radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
      at: to.pos,
    },
  };
}

function verifyGrounded(
  compiled: CompiledLevel,
  from: RouteNode,
  to: RouteNode,
  spec: RouteLink,
): LinkVerdict {
  const world = compiled.world;
  const problems: string[] = [];
  const distance = horizontal(from.pos, to.pos);
  const crouched = from.tags.includes("crouch") || to.tags.includes("crouch");
  const height = crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
  const steps = Math.max(2, Math.ceil(distance / 0.25));
  let previousY = from.pos[1];
  let stepUps = 0;
  // Anything no taller than STEP_UP is crossed by the verb, which commits half
  // a metre before contact. A capsule can never stand in the 0.35m ring around
  // such a kerb, and it never has to, so a grounded path must not be failed for
  // passing through one.
  const kerbs = new Set(
    [...compiled.massById.values()]
      .filter(
        (mass) =>
          mass.landable &&
          Number.isFinite(mass.topY) &&
          mass.topY - mass.baseY <= MOVEMENT_CAPABILITIES.maxStepUpM + 1e-9,
      )
      .map((mass) => mass.id),
  );

  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const x = from.pos[0] + (to.pos[0] - from.pos[0]) * t;
    const z = from.pos[2] + (to.pos[2] - from.pos[2]) * t;
    const support = supportBelow(
      world,
      x,
      z,
      previousY + MOVEMENT_CAPABILITIES.maxStepUpM,
    );
    if (!support) {
      problems.push(`no surface underfoot at t=${t.toFixed(2)}`);
      break;
    }
    const rise = support.y - previousY;
    if (rise > MOVEMENT_CAPABILITIES.maxStepUpM + 1e-6) {
      problems.push(
        `step up of ${rise.toFixed(2)}m at t=${t.toFixed(2)} exceeds the ${MOVEMENT_CAPABILITIES.maxStepUpM}m STEP_UP ceiling`,
      );
      break;
    }
    if (rise > 1e-4) stepUps += 1;
    // Below the free step-down it costs nothing; above it, up to the run-off
    // ceiling, it is a RUN_OFF the player crosses without stopping. Only past
    // that does a walk become a fall.
    if (support.y < previousY - MOVEMENT_CAPABILITIES.maxRunOffDropM - 1e-6) {
      problems.push(
        `drop of ${(previousY - support.y).toFixed(2)}m at t=${t.toFixed(2)} turns this run into a fall`,
      );
      break;
    }
    if (support.y < previousY - STEP_DOWN - 1e-6) stepUps += 1;
    if (
      !positionClear(world, { x, y: support.y, z }, CAPSULE_RADIUS, height, kerbs)
    ) {
      problems.push(
        `body does not fit at t=${t.toFixed(2)} (${x.toFixed(2)}, ${z.toFixed(2)})`,
      );
      break;
    }
    previousY = support.y;
  }

  if (Math.abs(previousY - to.pos[1]) > CONTACT_EPS + MOVEMENT_CAPABILITIES.maxStepUpM) {
    problems.push(
      `walk ends at y=${previousY.toFixed(2)} but the node is at ${to.pos[1].toFixed(2)}`,
    );
  }

  const speed = spec.speedMps ?? RUN_SPEED;
  const intensity = stepUps > 0 ? PARKOUR_TUNING.verbNoise.STEP_UP : 0;
  return {
    id: spec.id,
    kind: spec.kind,
    line: spec.line,
    ok: problems.length === 0,
    problems,
    gapM: null,
    dropM: from.pos[1] - to.pos[1],
    budgetM: null,
    verb: stepUps > 0 ? "STEP_UP" : "NONE",
    landedOn: to.surface,
    distanceM: distance,
    durationS: distance / speed + (stepUps * ACTION_MS.STEP_UP) / 1000,
    noise:
      intensity > 0
        ? {
            intensity,
            radiusM: intensity * PARKOUR_TUNING.noiseRadiusPerIntensityM,
            at: to.pos,
          }
        : null,
  };
}

export function receivingTargetsOf(level: MissionLevel): ReceivingTarget[] {
  return level.catches
    .filter((catchVolume) => catchVolume.offersLeap)
    .map((catchVolume) => ({
      id: catchVolume.id,
      x: catchVolume.centre[0],
      y: catchVolume.centre[1],
      z: catchVolume.centre[2],
      radiusM: catchVolume.radiusM,
      kind: catchVolume.kind.toLowerCase(),
    }));
}

export function verifyLink(
  compiled: CompiledLevel,
  nodes: Map<string, RouteNode>,
  spec: RouteLink,
  targets: readonly ReceivingTarget[],
): LinkVerdict {
  const from = nodes.get(spec.from);
  const to = nodes.get(spec.to);
  if (!from || !to) {
    return {
      id: spec.id,
      kind: spec.kind,
      line: spec.line,
      ok: false,
      problems: [`unknown node ${!from ? spec.from : spec.to}`],
      gapM: null,
      dropM: 0,
      budgetM: null,
      verb: "NONE",
      landedOn: null,
      distanceM: 0,
      durationS: 0,
      noise: null,
    };
  }
  if (spec.kind === "LEAP_OF_FAITH") {
    return verifyLeap(compiled, from, to, spec, targets);
  }
  if (BALLISTIC_KINDS.has(spec.kind)) {
    return verifyBallistic(compiled, from, to, spec);
  }
  if (AUTHORED_KINDS.has(spec.kind)) {
    return verifyAuthored(compiled, from, to, spec);
  }
  return verifyGrounded(compiled, from, to, spec);
}

/** Every node must stand on the surface it claims, with room for a body. */
export function verifyNode(compiled: CompiledLevel, spec: RouteNode): string[] {
  const world = compiled.world;
  const problems: string[] = [];
  const crouched = spec.tags.includes("crouch");
  const height = crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
  const support = supportBelow(
    world,
    spec.pos[0],
    spec.pos[2],
    spec.pos[1] + CONTACT_EPS,
  );
  if (!support) {
    problems.push("nothing underfoot");
  } else {
    if (support.id !== spec.surface) {
      problems.push(`stands on ${support.id}, not the declared ${spec.surface}`);
    }
    if (Math.abs(support.y - spec.pos[1]) > CONTACT_EPS) {
      problems.push(
        `declared y=${spec.pos[1].toFixed(2)} but the surface is at ${support.y.toFixed(2)}`,
      );
    }
  }
  if (
    !positionClear(
      world,
      { x: spec.pos[0], y: spec.pos[1], z: spec.pos[2] },
      CAPSULE_RADIUS,
      height,
    )
  ) {
    problems.push("the body does not fit here");
  }
  // A ledge only reads as somewhere to stand if a body's worth of it is clear.
  // Below minStandableTopDepthM the parkour reader classifies the top as not
  // standable and degrades a mantle to a climb-over, so a route node on one is
  // a place the player cannot actually be left.
  const span = standableSpanM(world, spec.pos, height);
  if (span < MOVEMENT_CAPABILITIES.minStandableTopDepthM - 1e-6) {
    problems.push(
      `only ${span.toFixed(2)}m of standable surface across the narrow axis; the reader needs ${MOVEMENT_CAPABILITIES.minStandableTopDepthM.toFixed(2)}m`,
    );
  }
  return problems;
}

/**
 * Width of the clear, continuously supported band through a point, measured on
 * whichever horizontal axis is tighter. This is the number the parkour reader's
 * `topStandable` is really asking about.
 */
export function standableSpanM(
  world: CollisionWorld,
  pos: Vec3Tuple,
  height: number,
  limit = 3,
): number {
  const step = 0.05;
  const reach = (dx: number, dz: number): number => {
    let travelled = 0;
    for (let d = step; d <= limit; d += step) {
      const x = pos[0] + dx * d;
      const z = pos[2] + dz * d;
      const support = supportBelow(world, x, z, pos[1] + CONTACT_EPS);
      if (!support || Math.abs(support.y - pos[1]) > CONTACT_EPS) break;
      if (!positionClear(world, { x, y: pos[1], z }, CAPSULE_RADIUS, height)) break;
      travelled = d;
    }
    return travelled;
  };
  const spanX = reach(1, 0) + reach(-1, 0);
  const spanZ = reach(0, 1) + reach(0, -1);
  return Math.min(spanX, spanZ);
}

export function verifyLevel(
  level: MissionLevel,
  compiled: CompiledLevel,
): { nodeProblems: Map<string, string[]>; linkVerdicts: LinkVerdict[] } {
  const nodes = new Map(level.nodes.map((n) => [n.id, n]));
  const targets = receivingTargetsOf(level);
  const nodeProblems = new Map<string, string[]>();
  for (const spec of level.nodes) {
    const problems = verifyNode(compiled, spec);
    if (problems.length) nodeProblems.set(spec.id, problems);
  }
  return {
    nodeProblems,
    linkVerdicts: level.links.map((spec) =>
      verifyLink(compiled, nodes, spec, targets),
    ),
  };
}
