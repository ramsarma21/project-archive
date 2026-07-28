// The perspective-encounter state machine.
//
// One of these runs per authored stop. It is a deterministic fixed-step machine
// — the same discipline as stealth/pursuit.ts — so a replay of the same tick
// sequence, seed and inputs produces the same approach, the same open, and the
// same consequence. Nothing here draws a random number and nothing reads wall
// time; the caller's clock is the whole clock.
//
// THE PHASES, and what each is for:
//
//   DORMANT     Nothing yet. Arms only when the player is GROUNDED inside the
//               trigger — never by falling past the stop and never by spawning
//               in the air above it, which is the "first trigger requires a
//               grounded drop" the design insists on.
//   APPROACH    Player locomotion is locked and one-shot inputs are cleared, but
//               the world is NOT frozen: the scripted watchers walk from their
//               actual simulation poses to the authored standoff through the
//               collision world with a swept capsule (no teleport, no clipping,
//               believable personal space). The question opens when the SPEAKER
//               reaches conversational distance and faces the player; a secondary
//               who cannot get there does not hold it open forever — a bounded
//               timeout opens it while he stays where collision left him.
//   QUESTION    The overlay owns input and gameplay time is frozen: pursuit and
//               detection do not advance and buffered movement/jump/throw cannot
//               fire on close. The player types and submits.
//   SUBMITTING  Still frozen and owned, waiting on the authority's verdict.
//   RESOLVED    The verdict is in. Participation is recorded and the CONSEQUENCE
//               is emitted once — a scoped, bounded reprieve on a correct answer,
//               or a scoped pursuit toward the confrontation position on a wrong
//               one. Control returns to the player immediately so a wrong answer
//               can be run from; the world is no longer frozen.
//   RELEASED    Terminal. The machine stops overriding the actors and hands them
//               back to the ordinary patrol/pursuit systems.
//
// WHAT IT DOES NOT DECIDE. It does not grade — the verdict is handed in, from the
// server authority or the dev stand-in. It does not own the suppression ledger or
// the pursuit state; it emits an EFFECT describing the consequence and the runtime
// applies it to the real systems, so this file mutates no private field of either.

import {
  CAPSULE_RADIUS,
  STAND_HEIGHT,
  positionClear,
  sweepXZ,
  supportBelow,
  type CollisionWorld,
  type Vec3,
} from "@pa/engine-world/collision";
import { FIELD_TICK_HZ } from "@pa/engine-world/fieldSimulation";
import type {
  EncounterId,
  EncounterVariantRef,
  PerspectiveEncounter,
} from "./bank.js";
import type { Vec3Tuple } from "../types.js";

function ticks(seconds: number): number {
  return Math.round(seconds * FIELD_TICK_HZ);
}

/** Actors close on the player at a purposeful stride — never a run, never a snap. */
const APPROACH_SPEED_MPS = 2.0;
/**
 * The farthest a watcher will WALK his real path in before the machine seeds his
 * approach at a bounded reachable placement instead. Within this, he walks the
 * whole way from his post with no teleport at all (the ideal); beyond it — a
 * patrol that has roamed right across the district — a full stroll would make the
 * player wait too long, so he is placed a few metres out on a reachable open side
 * and walks the last stretch (the design's sanctioned single arm-tick placement).
 */
const APPROACH_MAX_WALK_M = 14;
/** Within this of the goal, an actor has arrived. Keeps personal space. */
const ARRIVE_M = 0.65;
/**
 * The vertical band, in metres, within which the player counts as standing ON a
 * stop's own surface — the SAME-SURFACE qualifier on both arming and opening.
 *
 * A trigger's `radiusM` is a HORIZONTAL approach zone authored on the beat's own
 * deck; on its own it is height-blind, and a height-blind XZ radius arms from the
 * wrong storey. The relocated STAMP_SCOPE stop sits on the Hollis Meeting leads
 * (y=8.20); the cobbles of Orange Street run directly beneath it at y≈0, well
 * inside the 3.6m XZ radius. Without this band the stop armed from the street,
 * the speaker was eight metres of open air above the player and could never close
 * the 2.2m conversational gate, and the machine sat in APPROACH forever while the
 * mission clock (which runs during APPROACH) drained — the soft-lock the roof
 * relocation exposed. The player must be grounded on the beat's surface, not
 * merely inside its footprint on another floor.
 *
 * Sized well under any inter-storey gap on the route (the smallest here is the
 * 8.2m from the cobbles to the leads) yet generous enough for a crouch, a low
 * kerb, and asset-thickness variance in where "grounded" resolves.
 */
const SAME_SURFACE_BAND_M = 2.0;
/**
 * How close the SPEAKER closes to the player — a conversational distance, not
 * an authored world point. The old fixed `speakerStandoff` was computed for a
 * player standing dead-centre on the trigger, but a player arms the stop
 * anywhere inside `radiusM` (and the watcher may start metres down his patrol),
 * so a fixed standoff left the officer talking from several metres away: the
 * "standing a bit away" the report rejected. Closing to a distance measured
 * FROM THE PLAYER makes the officer come up to wherever the player actually is.
 */
const SPEAKER_CONVO_M = 1.7;
/**
 * The HARD gate on opening the question: the speaker's capsule-to-capsule
 * separation from the player must be within this before QUESTION can open. There
 * is NO time-based fallback that opens at range — a stop that opened on a timer
 * while the officer was still metres away behind a cart is exactly the bug the
 * user's screenshot showed. The approach re-paths and re-anchors until the
 * speaker is genuinely at conversational distance; only then does the overlay
 * become answerable. Kept a touch above `SPEAKER_CONVO_M + ARRIVE_M` so a
 * speaker who settled just shy of his goal still counts as arrived.
 */
const SPEAKER_OPEN_M = 2.2;
/** A secondary hangs a pace further back, so the two never stack on the player. */
const SECONDARY_CONVO_M = 2.6;
/** Greatest foot-height an actor STEPS UP in one step. A kerb, not a stair. */
const ACTOR_MAX_STEP_M = 0.55;
/**
 * Greatest foot-height an actor STEPS DOWN in one step. Asymmetric with the
 * step-up on purpose: an officer will step or hop DOWN off a low market object
 * he is standing on far more readily than he will climb UP one, and it is the
 * descent that the approach actually needs. A watcher whose patrol pose is
 * resolved onto a low landable top (a handcart, a crate — CART_0's top is 0.95m)
 * used to be STRANDED there: `walk` rejected every step whose support dropped
 * more than a kerb, so he could never come down off the cart to close the last
 * couple of metres, the SPEAKER never reached conversational range, and the
 * question never opened on the Shambles line. Sized to clear a market cart with
 * margin while staying well under any authored drop an actor is never placed at.
 */
const ACTOR_MAX_DROP_M = 1.25;
/**
 * How far an actor must have crept over `REANCHOR_TICKS` to count as "making
 * progress". Below this the straight line to his goal is blocked by clutter, and
 * the machine re-anchors him onto a reachable conversational anchor on an open
 * side of the player rather than letting him grind into a cart forever.
 */
const PROGRESS_EPSILON_M = 0.25;
/** How often a stalled actor's goal is re-anchored around the player. */
const REANCHOR_TICKS = ticks(1.2);
/**
 * After this long without progress the machine replans the speaker's route every
 * tick rather than once per re-anchor window — the aggressive last-ditch attempt
 * to rescue a hard-but-possible approach before the abort ceiling below.
 */
const REPLAN_ESCALATE_TICKS = ticks(8);
/**
 * The HARD ceiling on APPROACH. A speaker who still cannot reach conversational
 * distance by now is on an impossible approach, and the machine ABORTS the stop
 * to RELEASED and hands control back — it NEVER opens the question at range, and
 * it never holds the player past this. This is what makes a stalled approach
 * impossible rather than merely unlikely: even if a future edge case slips past
 * the same-surface arming gate, the player is freed within a bounded time instead
 * of being trapped while the world clock drains. Sized comfortably above the
 * longest legitimate approach (a cross-district placement walks its last few
 * metres in ~2s; a blocked detour closes in a handful), so a reachable speaker
 * always opens the question well before it.
 */
const APPROACH_ABORT_TICKS = ticks(16);
/**
 * Deterministic bearings, in radians, scanned around the player when the direct
 * line to a conversational goal is blocked. Ordered from the actor's own side
 * outward so he prefers the shortest honest detour and only swings wide when he
 * must. The first reachable one becomes the new goal.
 */
const ANCHOR_BEARINGS_RAD: readonly number[] = [
  0,
  Math.PI / 6,
  -Math.PI / 6,
  Math.PI / 3,
  -Math.PI / 3,
  Math.PI / 2,
  -Math.PI / 2,
  (2 * Math.PI) / 3,
  -(2 * Math.PI) / 3,
  (5 * Math.PI) / 6,
  -(5 * Math.PI) / 6,
  Math.PI,
];
/** How long the in-character result card holds before the machine releases. */
const RESOLVED_HOLD_TICKS = ticks(3);
/** How fast a walking actor's body turns to face where it is going / the player. */
const TURN_RAD_PER_SECOND = 5;

export type EncounterPhase =
  | "DORMANT"
  | "APPROACH"
  | "QUESTION"
  | "SUBMITTING"
  | "RESOLVED"
  | "RELEASED";

/**
 * How a verdict lands, from the machine's point of view. GRANTED is the generous
 * infrastructure grant — a service outage must not trap a player — and it earns
 * the same reprieve a CORRECT answer does, because the player cannot be punished
 * for the model being unreachable.
 */
export type EncounterVerdictKind = "CORRECT" | "WRONG" | "GRANTED";

function isReprieve(kind: EncounterVerdictKind): boolean {
  return kind === "CORRECT" || kind === "GRANTED";
}

/** One watcher the machine is walking during the stop. */
export interface EncounterActor {
  readonly id: string;
  readonly kind: "SPEAKER" | "SECONDARY";
  pos: Vec3;
  yaw: number;
  goal: Vec3;
  arrived: boolean;
  /** Remaining planned waypoints to the goal (collision-aware), goal last. */
  path: Vec3[];
  /** Position at the last re-anchor check, to measure whether he is still moving. */
  progressPos: Vec3;
  /** Tick of the last re-anchor check. */
  progressTick: number;
}

/**
 * The consequence, emitted once on entry to RESOLVED. The runtime translates it
 * into the suppression ledger and the pursuit state; the machine never touches
 * either directly.
 */
export interface EncounterResolution {
  readonly encounterId: EncounterId;
  readonly itemId: string;
  readonly verdictKind: EncounterVerdictKind;
  readonly resolvedAtTick: number;
  /** Always true once RESOLVED is reached: the stop counts as participated in. */
  readonly participate: true;
  /** CORRECT/GRANTED: suppress these watchers' perception for this many ticks. */
  readonly suppress: {
    readonly ids: readonly string[];
    readonly durationTicks: number;
  } | null;
  /** WRONG: put these watchers into pursuit toward this confrontation position. */
  readonly pursue: {
    readonly ids: readonly string[];
    readonly toward: Vec3;
  } | null;
}

export interface EncounterInstance {
  readonly def: PerspectiveEncounter;
  readonly variant: EncounterVariantRef;
  phase: EncounterPhase;
  actors: EncounterActor[];
  approachTicks: number;
  /** The player's position when the question opened. The pursuit's target. */
  confrontationPos: Vec3 | null;
  resolvedAtTick: number;
  resolvedHoldTicks: number;
  verdictKind: EncounterVerdictKind | null;
  /** Emitted once, on the tick RESOLVED is entered; null before and (read) after. */
  resolution: EncounterResolution | null;
}

export interface EncounterStepInput {
  readonly world: CollisionWorld;
  readonly tick: number;
  readonly player: { readonly pos: Vec3; readonly grounded: boolean };
  /**
   * The controlled actors' live simulation poses. Read only to SEED the approach
   * start on the tick the stop arms, so the watcher walks from where he actually
   * was standing rather than from the origin.
   */
  readonly actorPoses: readonly { readonly id: string; readonly pos: Vec3; readonly yaw: number }[];
  readonly dt: number;
  /** True the tick the player submits an answer. QUESTION -> SUBMITTING. */
  readonly submit: boolean;
  /** The verdict once the authority answers, else null. SUBMITTING -> RESOLVED. */
  readonly verdict: EncounterVerdictKind | null;
  /** True the tick the player dismisses the result card. RESOLVED -> RELEASED. */
  readonly dismiss: boolean;
}

export interface EncounterStepResult {
  readonly phase: EncounterPhase;
  /** True while the player may not move: APPROACH, QUESTION, SUBMITTING. */
  readonly locksLocomotion: boolean;
  /** True while the overlay owns input and one-shot presses must be dropped. */
  readonly ownsInput: boolean;
  /** True while gameplay time, pursuit and detection must be frozen. */
  readonly freezeTime: boolean;
  /** True on the ticks QUESTION is live and the prompt should be shown. */
  readonly questionOpen: boolean;
  /** The actor poses the machine is overriding this tick, for the renderer. */
  readonly actorPoses: readonly { readonly id: string; readonly pos: Vec3; readonly yaw: number }[];
  /** The consequence, on the single tick RESOLVED is entered; null otherwise. */
  readonly resolution: EncounterResolution | null;
}

function toVec(t: Vec3Tuple): Vec3 {
  return { x: t[0], y: t[1], z: t[2] };
}

function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function yawToward(from: Vec3, to: Vec3): number {
  return Math.atan2(to.x - from.x, to.z - from.z);
}

/**
 * A point `distM` from the player, on the line from the player toward where the
 * actor is standing now — i.e. the actor closes toward the player and stops a
 * conversational distance short of them, on his own side. This is what makes the
 * officers come UP to the player instead of halting on a fixed authored mark.
 *
 * The authored `speakerStandoff` in the bank is retained as the seed for the
 * approach direction only; the stop distance is measured from the player so it
 * cannot drift into a standoff when the player triggers off-centre.
 */
function conversationalGoal(player: Vec3, actorStart: Vec3, distM: number): Vec3 {
  let dx = actorStart.x - player.x;
  let dz = actorStart.z - player.z;
  let len = Math.hypot(dx, dz);
  // Degenerate (actor on top of the player): face them out along +z so the
  // divide is safe and the officer still keeps personal space.
  if (len < 1e-3) {
    dx = 0;
    dz = 1;
    len = 1;
  }
  return {
    x: player.x + (dx / len) * distM,
    y: actorStart.y,
    z: player.z + (dz / len) * distM,
  };
}

function turnToward(from: number, to: number, dt: number, rate: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  const step = rate * dt;
  if (Math.abs(delta) <= step) return to;
  return from + Math.sign(delta) * step;
}

/**
 * One swept step of an actor toward a point, through the collision world.
 *
 * The same `sweepXZ` + `supportBelow` the player and the pursuit use, so an actor
 * is stopped by the same stalls and walls and refuses a step that changes his
 * foot height by more than a kerb. Routing AROUND clutter is the waypoint
 * planner's job (`detourWaypoint`), not this call's — this only takes one honest
 * step toward whatever target it is handed.
 */
function walk(
  world: CollisionWorld,
  from: Vec3,
  toward: Vec3,
  dt: number,
): Vec3 {
  const dx = toward.x - from.x;
  const dz = toward.z - from.z;
  const away = Math.hypot(dx, dz);
  if (away < 1e-6) return from;
  const travel = Math.min(away, APPROACH_SPEED_MPS * dt);
  const swept = sweepXZ(
    world,
    from,
    { x: from.x + (dx / away) * travel, z: from.z + (dz / away) * travel },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
    undefined,
  );
  const support = supportBelow(
    world,
    swept.x,
    swept.z,
    from.y + ACTOR_MAX_STEP_M,
    ACTOR_MAX_STEP_M,
  );
  if (!support) return from;
  // Asymmetric footing: step UP at most a kerb (`ACTOR_MAX_STEP_M`), but step
  // DOWN off a low object more freely (`ACTOR_MAX_DROP_M`). An officer whose
  // patrol pose is resolved onto a market cart top must be able to come down off
  // it to close on the player; the old symmetric guard stranded him there and
  // the question never opened. A step-down beyond the drop budget (a real ledge)
  // is still refused, so he never walks off an authored drop.
  const rise = support.y - from.y;
  if (rise > ACTOR_MAX_STEP_M || rise < -ACTOR_MAX_DROP_M) return from;
  return { x: swept.x, y: support.y, z: swept.z };
}

/**
 * Whether a capsule can walk the whole way from `a` to `b` in a straight line —
 * a single long swept-capsule slide that either reaches `b` or is stopped short
 * by geometry. The routing primitive both the waypoint planner and the anchor
 * scan test with, so "reachable" means the same thing everywhere: the same
 * collision the actor's own steps obey.
 */
function clearWalk(world: CollisionWorld, a: Vec3, b: Vec3): boolean {
  const swept = sweepXZ(
    world,
    a,
    { x: b.x, z: b.z },
    CAPSULE_RADIUS,
    STAND_HEIGHT,
    undefined,
  );
  if (Math.hypot(swept.x - b.x, swept.z - b.z) > ARRIVE_M) return false;
  const support = supportBelow(world, b.x, b.z, a.y + ACTOR_MAX_STEP_M, ACTOR_MAX_STEP_M);
  return support != null;
}

// ---------------------------------------------------------------------------
// The approach planner.
//
// The M1 market is a maze of stalls, carts and barrels: an officer's patrol post
// can sit on the far side of a stall from where the player triggers the stop, and
// the only way to him is a multi-segment detour through the south lane. A single
// perpendicular sidestep cannot express that, and the old "walk straight, and if
// blocked open the question anyway" is exactly what put the constables 8–12 m off
// in the user's screenshot. So the approach runs a small deterministic grid A*
// over the local collision world and follows the string-pulled path — real
// collision-aware locomotion, no navmesh asset, no teleport, and a path or a
// re-anchor rather than a fall-through at range.
// ---------------------------------------------------------------------------

/**
 * The visible-walk length of a placed approach: when a watcher's patrol pose is
 * boxed off from the player (a market pinch a capsule cannot thread), his
 * approach is SEEDED this far out on a reachable open side and he walks in from
 * there. Long enough to read as "he comes up to you", short enough to be a
 * believable last stretch rather than a cross-market hike.
 */
const PLACED_START_M = 4;

/** Grid spacing for the approach planner. Fine enough to thread a stall gap. */
const PLAN_SPACING_M = 0.5;
/** How far past the from/goal box the grid extends, so a detour has room. */
const PLAN_MARGIN_M = 5;
/** Hard ceiling on grid cells, so a pathological span cannot stall the tick. */
const PLAN_MAX_CELLS = 6000;

/**
 * The settled, capsule-clear standing point at (x,z), or null if there is no
 * ground or the capsule would overlap a blocker there. The one walkability test
 * the planner and the placement fallback both use.
 */
function groundClear(world: CollisionWorld, x: number, z: number, refY: number): Vec3 | null {
  const support = supportBelow(world, x, z, refY + ACTOR_MAX_STEP_M, ACTOR_MAX_STEP_M);
  if (!support) return null;
  const p: Vec3 = { x, y: support.y, z };
  if (!positionClear(world, p, CAPSULE_RADIUS, STAND_HEIGHT, undefined)) return null;
  return p;
}

/**
 * A collision-aware path from `from` to `goal`, as a short list of waypoints
 * (ending at `goal`), or null if the goal is unreachable on the local grid.
 *
 * Deterministic: a fixed grid, a fixed neighbour order and a stable lowest-f
 * tie-break, so a replay plans the identical route. Cheap enough to run at the
 * stop's arm and on the rare re-plan, and string-pulled so the officer walks a
 * few straight legs rather than a staircase.
 */
function planPath(world: CollisionWorld, from: Vec3, goal: Vec3): Vec3[] | null {
  if (clearWalk(world, from, goal)) return [{ ...goal }];
  const minX = Math.min(from.x, goal.x) - PLAN_MARGIN_M;
  const maxX = Math.max(from.x, goal.x) + PLAN_MARGIN_M;
  const minZ = Math.min(from.z, goal.z) - PLAN_MARGIN_M;
  const maxZ = Math.max(from.z, goal.z) + PLAN_MARGIN_M;
  const cols = Math.floor((maxX - minX) / PLAN_SPACING_M) + 1;
  const rows = Math.floor((maxZ - minZ) / PLAN_SPACING_M) + 1;
  if (cols < 2 || rows < 2 || cols * rows > PLAN_MAX_CELLS) return null;
  const N = cols * rows;
  const cellX = (c: number): number => minX + c * PLAN_SPACING_M;
  const cellZ = (r: number): number => minZ + r * PLAN_SPACING_M;

  // Walkable-cell cache: undefined = unknown, null = blocked, number = ground y.
  const groundY: (number | null | undefined)[] = new Array(N).fill(undefined);
  const walkY = (c: number, r: number): number | null => {
    const i = r * cols + c;
    const cached = groundY[i];
    if (cached !== undefined) return cached;
    const support = supportBelow(
      world,
      cellX(c),
      cellZ(r),
      from.y + ACTOR_MAX_STEP_M,
      ACTOR_MAX_STEP_M,
    );
    let y: number | null = null;
    if (
      support &&
      positionClear(
        world,
        { x: cellX(c), y: support.y, z: cellZ(r) },
        CAPSULE_RADIUS,
        STAND_HEIGHT,
        undefined,
      )
    ) {
      y = support.y;
    }
    groundY[i] = y;
    return y;
  };

  const nearestCell = (p: Vec3): number | null => {
    let best = -1;
    let bestD = Infinity;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        if (walkY(c, r) === null) continue;
        const d = (cellX(c) - p.x) ** 2 + (cellZ(r) - p.z) ** 2;
        if (d < bestD) {
          bestD = d;
          best = r * cols + c;
        }
      }
    }
    return best >= 0 ? best : null;
  };

  const startI = nearestCell(from);
  const goalI = nearestCell(goal);
  if (startI === null || goalI === null) return null;

  const gScore = new Array<number>(N).fill(Infinity);
  const came = new Array<number>(N).fill(-1);
  gScore[startI] = 0;
  const gc = goalI % cols;
  const gr = (goalI - gc) / cols;
  const heuristic = (i: number): number => {
    const c = i % cols;
    const r = (i - c) / cols;
    return Math.hypot(c - gc, r - gr) * PLAN_SPACING_M;
  };
  const open = new Set<number>([startI]);
  const neighbours: readonly (readonly [number, number])[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  let reached = startI === goalI;
  while (open.size > 0) {
    let cur = -1;
    let curF = Infinity;
    for (const i of open) {
      const f = gScore[i]! + heuristic(i);
      if (f < curF) {
        curF = f;
        cur = i;
      }
    }
    if (cur === goalI) {
      reached = true;
      break;
    }
    open.delete(cur);
    const cc = cur % cols;
    const cr = (cur - cc) / cols;
    const cy = walkY(cc, cr)!;
    for (const [dc, dr] of neighbours) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ny = walkY(nc, nr);
      if (ny === null) continue;
      if (
        !clearWalk(
          world,
          { x: cellX(cc), y: cy, z: cellZ(cr) },
          { x: cellX(nc), y: ny, z: cellZ(nr) },
        )
      ) {
        continue;
      }
      const ni = nr * cols + nc;
      const tentative = gScore[cur]! + Math.hypot(dc, dr) * PLAN_SPACING_M;
      if (tentative < gScore[ni]!) {
        gScore[ni] = tentative;
        came[ni] = cur;
        open.add(ni);
      }
    }
  }
  if (!reached) return null;

  const cells: number[] = [];
  let cur = goalI;
  while (cur !== -1) {
    cells.push(cur);
    if (cur === startI) break;
    cur = came[cur]!;
  }
  cells.reverse();
  const pts: Vec3[] = cells.map((i) => {
    const c = i % cols;
    const r = (i - c) / cols;
    return { x: cellX(c), y: walkY(c, r)!, z: cellZ(r) };
  });
  pts.push({ ...goal });

  // String-pull: from the current anchor, jump to the farthest waypoint still on
  // a clear straight walk, so the officer takes a few long legs, not a staircase.
  const pulled: Vec3[] = [];
  let anchor = from;
  let j = 0;
  while (j < pts.length) {
    let k = j;
    for (let m = pts.length - 1; m >= j; m -= 1) {
      if (clearWalk(world, anchor, pts[m]!)) {
        k = m;
        break;
      }
    }
    pulled.push(pts[k]!);
    anchor = pts[k]!;
    j = k + 1;
  }
  return pulled.length > 0 ? pulled : [{ ...goal }];
}

/**
 * A reachable point to SEED a watcher's visible approach when his patrol pose is
 * boxed off from the player by clutter a capsule cannot thread.
 *
 * Scans outward from `PLACED_START_M` for a standing point that is capsule-clear
 * AND has a clear straight walk to the goal, preferring the largest radius on the
 * bearing nearest the officer's real side — so the placed officer still comes IN
 * from roughly where he was and walks the last few metres, rather than opening
 * the question at range or grinding into a stall. The design's sanctioned single
 * placement at the arm tick, made reachable by construction. Null only if nothing
 * near the player is both clear and clear-to-goal (the caller then keeps the
 * bounded start, and the distance gate still refuses to open at range).
 */
function placedApproachStart(
  world: CollisionWorld,
  player: Vec3,
  truePose: Vec3,
  goal: Vec3,
): Vec3 | null {
  let dirX = truePose.x - player.x;
  let dirZ = truePose.z - player.z;
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-3) {
    dirX = 0;
    dirZ = 1;
  } else {
    dirX /= len;
    dirZ /= len;
  }
  for (let radius = PLACED_START_M; radius >= SPEAKER_CONVO_M + 0.3; radius -= 0.5) {
    for (const bearing of ANCHOR_BEARINGS_RAD) {
      const cos = Math.cos(bearing);
      const sin = Math.sin(bearing);
      const bx = dirX * cos - dirZ * sin;
      const bz = dirX * sin + dirZ * cos;
      const cand = groundClear(world, player.x + bx * radius, player.z + bz * radius, truePose.y);
      if (!cand) continue;
      if (clearWalk(world, cand, goal)) return cand;
    }
  }
  return null;
}

/**
 * A capsule-clear conversational anchor `distM` from the player, preferring the
 * bearing toward `towardPose` (the officer's real side) and swinging outward
 * until it finds open ground. This is the point the officer will stand at to
 * speak: it must be somewhere he can actually STAND (not lodged in a stall), so
 * a conversational point aimed straight into a market stall is rejected in favour
 * of the nearest open side of the player. Falls back to the direct point when
 * nothing scans clear.
 */
function reachableConversationAnchor(
  world: CollisionWorld,
  player: Vec3,
  towardPose: Vec3,
  distM: number,
): Vec3 {
  let baseX = towardPose.x - player.x;
  let baseZ = towardPose.z - player.z;
  const len = Math.hypot(baseX, baseZ);
  if (len < 1e-3) {
    baseX = 0;
    baseZ = 1;
  } else {
    baseX /= len;
    baseZ /= len;
  }
  for (const bearing of ANCHOR_BEARINGS_RAD) {
    const cos = Math.cos(bearing);
    const sin = Math.sin(bearing);
    const dirX = baseX * cos - baseZ * sin;
    const dirZ = baseX * sin + baseZ * cos;
    const cand = groundClear(
      world,
      player.x + dirX * distM,
      player.z + dirZ * distM,
      towardPose.y,
    );
    if (cand) return cand;
  }
  return conversationalGoal(player, towardPose, distM);
}

export function createEncounterInstance(
  def: PerspectiveEncounter,
  variant: EncounterVariantRef,
): EncounterInstance {
  return {
    def,
    variant,
    phase: "DORMANT",
    actors: [],
    approachTicks: 0,
    confrontationPos: null,
    resolvedAtTick: -1,
    resolvedHoldTicks: 0,
    verdictKind: null,
    resolution: null,
  };
}

const NO_ACTORS: readonly { readonly id: string; readonly pos: Vec3; readonly yaw: number }[] = [];

function actorViews(instance: EncounterInstance) {
  return instance.actors.map((actor) => ({
    id: actor.id,
    pos: actor.pos,
    yaw: actor.yaw,
  }));
}

/** Should this stop arm from the player's read this tick? */
function armed(instance: EncounterInstance, player: EncounterStepInput["player"]): boolean {
  const trigger = instance.def.trigger;
  // Grounded is required for BOTH stops: it is the whole of what distinguishes a
  // grounded landing from falling past the volume or hanging in the air above it.
  // `requiresGroundedApproach` documents that the OPENING stop leans on this; the
  // interior stop still only arms on a grounded arrival, which is the same test.
  if (!player.grounded) return false;
  // SAME-SURFACE qualifier. `radiusM` is a horizontal approach zone; without a
  // height check it arms from the wrong storey (the cobbles under the roof-top
  // stop), and the speaker can never close the vertical gap — the soft-lock. The
  // player must be grounded on the beat's own surface, not merely above or below
  // its footprint. See SAME_SURFACE_BAND_M.
  if (Math.abs(player.pos.y - trigger.at[1]) > SAME_SURFACE_BAND_M) return false;
  return distXZ(player.pos, toVec(trigger.at)) <= trigger.radiusM;
}

function beginApproach(
  instance: EncounterInstance,
  input: EncounterStepInput,
): void {
  const speaker = instance.def.speaker;
  const player = input.player.pos;
  const poseById = new Map(input.actorPoses.map((pose) => [pose.id, pose]));
  const actors: EncounterActor[] = [];
  const seed = (
    id: string,
    kind: "SPEAKER" | "SECONDARY",
    pose: { pos: Vec3; yaw: number },
    convo: number,
  ): void => {
    // Start from where he actually stands — no teleport — so when a route exists
    // within the walk budget he walks the whole way in from his real post.
    let start: Vec3 = { ...pose.pos };
    let goal = conversationalGoal(player, pose.pos, convo);
    // First choice: a real collision-aware route from where he stands, so long as
    // his post is within the walk budget; a patrol that roamed across the district
    // is placed closer instead (below) rather than making the player wait.
    let path =
      distXZ(pose.pos, player) <= APPROACH_MAX_WALK_M
        ? planPath(input.world, start, goal)
        : null;
    if (path === null) {
      // His patrol pose is boxed off from the player by clutter no capsule can
      // thread (a market pinch). Choose a conversational anchor he can actually
      // STAND at (an open side of the player, not lodged in a stall), seed his
      // approach a few metres out on that side, and walk him in — the design's
      // single arm-tick placement — rather than stalling or opening at range.
      goal = reachableConversationAnchor(input.world, player, pose.pos, convo);
      const placed = placedApproachStart(input.world, player, pose.pos, goal);
      if (placed) start = placed;
      path = planPath(input.world, start, goal) ?? [{ ...goal }];
    }
    actors.push({
      id,
      kind,
      pos: { ...start },
      yaw: pose.yaw,
      goal,
      arrived: false,
      path,
      progressPos: { ...start },
      progressTick: input.tick,
    });
  };

  const speakerPose = poseById.get(speaker.watcherId);
  if (speakerPose) seed(speaker.watcherId, "SPEAKER", speakerPose, SPEAKER_CONVO_M);
  if (speaker.secondaryWatcherId && instance.def.trigger.secondaryStandoff) {
    const secondaryPose = poseById.get(speaker.secondaryWatcherId);
    if (secondaryPose) {
      seed(speaker.secondaryWatcherId, "SECONDARY", secondaryPose, SECONDARY_CONVO_M);
    }
  }
  instance.actors = actors;
  instance.approachTicks = 0;
  // Lock the confrontation point at the arm position (the player is held for the
  // whole approach), so the pursuit consequence on a wrong answer and the actor
  // goals share one authoritative "where the player is".
  instance.confrontationPos = { ...player };
  instance.phase = "APPROACH";
}

function stepApproach(
  instance: EncounterInstance,
  input: EncounterStepInput,
): void {
  instance.approachTicks += 1;
  const player = input.player.pos;
  const convoFor = (actor: EncounterActor): number =>
    actor.kind === "SPEAKER" ? SPEAKER_CONVO_M : SECONDARY_CONVO_M;
  // Arrival is measured FROM THE PLAYER, not from a goal mark that a re-anchor
  // may have moved. The SPEAKER must reach the open band (so arriving and the
  // question opening are the same instant, never a settle just outside it); a
  // secondary may hold a pace further back.
  const arriveBandFor = (actor: EncounterActor): number =>
    actor.kind === "SPEAKER" ? SPEAKER_OPEN_M : SECONDARY_CONVO_M + ARRIVE_M;

  for (const actor of instance.actors) {
    const toPlayer = distXZ(actor.pos, player);
    const convo = convoFor(actor);
    if (toPlayer <= arriveBandFor(actor)) actor.arrived = true;

    if (actor.arrived) {
      // Hold position, but keep facing the player once arrived.
      actor.yaw = turnToward(
        actor.yaw,
        yawToward(actor.pos, player),
        input.dt,
        TURN_RAD_PER_SECOND,
      );
      continue;
    }

    // Drop planned waypoints the actor has already reached, so the next step aims
    // at the next leg (and finally at the goal).
    while (actor.path.length > 1 && distXZ(actor.pos, actor.path[0]!) <= ARRIVE_M) {
      actor.path.shift();
    }

    // Re-plan a stalled actor: if he has crept less than an epsilon over the
    // re-anchor window, his planned route no longer fits (a moving player, a
    // patrol pose that drifted) — re-run the planner, re-anchoring to a reachable
    // open side of the player if the direct goal is boxed in. This is the
    // deterministic re-path the design asks for, and it is why there is no range
    // timeout that opens the question while he is stuck. Past
    // REPLAN_ESCALATE_TICKS the re-plan runs every tick to give the geometry the
    // best chance to yield before APPROACH_ABORT_TICKS ends the stop; the overlay
    // is NEVER opened at range along the way.
    const escalated = instance.approachTicks >= REPLAN_ESCALATE_TICKS;
    if (escalated || input.tick - actor.progressTick >= REANCHOR_TICKS) {
      if (escalated || distXZ(actor.pos, actor.progressPos) < PROGRESS_EPSILON_M) {
        // Re-plan the ROUTE to the stable goal first — the goal itself does not
        // move (the player is locked during the approach), so recomputing it each
        // re-plan is what made the officer oscillate. Only if the goal has become
        // unreachable do we re-anchor to an open side of the player.
        let path = planPath(input.world, actor.pos, actor.goal);
        if (path === null) {
          actor.goal = reachableConversationAnchor(input.world, player, actor.pos, convo);
          path = planPath(input.world, actor.pos, actor.goal) ?? [{ ...actor.goal }];
        }
        actor.path = path;
      }
      actor.progressPos = { ...actor.pos };
      actor.progressTick = input.tick;
    }

    const target = actor.path[0] ?? actor.goal;
    const moved = walk(input.world, actor.pos, target, input.dt);
    if (distXZ(moved, actor.pos) > 1e-6) {
      actor.yaw = turnToward(
        actor.yaw,
        yawToward(actor.pos, moved),
        input.dt,
        TURN_RAD_PER_SECOND,
      );
    }
    actor.pos = moved;
    if (distXZ(actor.pos, player) <= arriveBandFor(actor)) actor.arrived = true;
  }

  const speaker = instance.actors.find((actor) => actor.kind === "SPEAKER");
  // THE ONLY GATE IS PROXIMITY. The question opens strictly when the speaker is
  // within conversational separation of the player — never on a timer, never
  // while he is still crossing the market. Proximity is checked in BOTH the
  // horizontal plane AND height: a speaker who is within `SPEAKER_OPEN_M` in XZ
  // but a storey above or below the player (the height-blind arming case) is NOT
  // "at conversational distance", and opening there would frame an empty scene
  // with the speaker off-screen overhead. The same-surface arming gate already
  // prevents that; this is belt-and-braces on the open itself.
  const speakerClose =
    speaker != null &&
    distXZ(speaker.pos, player) <= SPEAKER_OPEN_M &&
    Math.abs(speaker.pos.y - player.y) <= SAME_SURFACE_BAND_M;
  if (speakerClose) {
    for (const actor of instance.actors) {
      actor.yaw = yawToward(actor.pos, player);
    }
    instance.confrontationPos = { ...player };
    instance.phase = "QUESTION";
    return;
  }
  // FAILSAFE: a stalled approach must never hold the player forever. If the
  // speaker still has not reached conversational distance by the hard ceiling,
  // the approach is impossible (a reachable speaker always opens well before
  // this); abandon the stop to RELEASED and hand control back rather than sitting
  // in APPROACH while the mission clock drains. `encounterResolved` counts a
  // RELEASED stop as participated, so aborting frees the player without leaving
  // the traversal's encounter gate forever unmet. This is the structural
  // guarantee that there is no state in which the player is held with no way out.
  if (instance.approachTicks >= APPROACH_ABORT_TICKS) {
    instance.phase = "RELEASED";
  }
}

function enterResolved(
  instance: EncounterInstance,
  input: EncounterStepInput,
  kind: EncounterVerdictKind,
): void {
  instance.phase = "RESOLVED";
  instance.verdictKind = kind;
  instance.resolvedAtTick = input.tick;
  instance.resolvedHoldTicks = 0;
  const ids = instance.def.speaker.secondaryWatcherId
    ? [instance.def.speaker.watcherId, instance.def.speaker.secondaryWatcherId]
    : [instance.def.speaker.watcherId];
  const confrontation =
    instance.confrontationPos ?? { ...input.player.pos };
  instance.resolution = {
    encounterId: instance.def.id,
    itemId: instance.variant.itemId,
    verdictKind: kind,
    resolvedAtTick: input.tick,
    participate: true,
    suppress: isReprieve(kind)
      ? { ids, durationTicks: ticks(instance.def.reprieveWorldSeconds) }
      : null,
    pursue: isReprieve(kind) ? null : { ids, toward: confrontation },
  };
}

/**
 * One fixed step of the encounter. Mutates `instance` in place (the mission
 * runtime holds these behind a ref, like the pursuit state) and returns the
 * frame's presentation and any consequence.
 */
export function stepEncounter(
  instance: EncounterInstance,
  input: EncounterStepInput,
): EncounterStepResult {
  switch (instance.phase) {
    case "DORMANT":
      if (armed(instance, input.player)) beginApproach(instance, input);
      break;
    case "APPROACH":
      stepApproach(instance, input);
      break;
    case "QUESTION":
      if (input.submit) instance.phase = "SUBMITTING";
      break;
    case "SUBMITTING":
      if (input.verdict !== null) enterResolved(instance, input, input.verdict);
      break;
    case "RESOLVED":
      instance.resolvedHoldTicks += 1;
      if (input.dismiss || instance.resolvedHoldTicks >= RESOLVED_HOLD_TICKS) {
        instance.phase = "RELEASED";
      }
      break;
    case "RELEASED":
      break;
  }

  const phase = instance.phase;
  const locksLocomotion =
    phase === "APPROACH" || phase === "QUESTION" || phase === "SUBMITTING";
  const ownsInput = phase === "QUESTION" || phase === "SUBMITTING";
  const controlling =
    phase === "APPROACH" ||
    phase === "QUESTION" ||
    phase === "SUBMITTING" ||
    phase === "RESOLVED";
  // The resolution is emitted on exactly one tick — the one that entered
  // RESOLVED. `enterResolved` set it; we hand it out and clear it so a caller
  // applies the consequence once and never twice.
  const resolution = instance.resolution;
  instance.resolution = null;
  return {
    phase,
    locksLocomotion,
    ownsInput,
    freezeTime: ownsInput,
    questionOpen: phase === "QUESTION",
    actorPoses: controlling ? actorViews(instance) : NO_ACTORS,
    resolution,
  };
}

/** Has this stop reached a server/stand-in verdict state? Read for gating. */
export function encounterResolved(instance: EncounterInstance): boolean {
  return instance.phase === "RESOLVED" || instance.phase === "RELEASED";
}

/** Is this stop completely finished, control handed back? */
export function encounterReleased(instance: EncounterInstance): boolean {
  return instance.phase === "RELEASED";
}
