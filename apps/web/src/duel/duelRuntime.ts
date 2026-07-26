// The presentation layer's single hold on the duel core.
//
// The core is authoritative and this file does not argue with it. It holds one
// DuelState, hands the reducer a frame delta and the local player's intents, and
// projects what came back into three read models:
//
//   getHud()      what the DOM overlay draws. Published only when it CHANGES, so
//                 the HUD re-renders a handful of times a round rather than 60
//                 times a second.
//   getPoses()    the previous and current fixed-step poses plus the core clock's
//                 own leftover accumulator, which is all the renderer needs to
//                 interpolate. Nothing is integrated here.
//   getCues()     when each side last fired, was hit, dodged or slipped a ball, so
//                 a one-shot animation and a muzzle flash have something to fire on.
//
// There is exactly one clock and it belongs to the core: `advance` hands
// `reduceDuel` the real frame delta and the core decides how many fixed steps that
// buys. No accumulator, no timer, no second stepping loop lives here.
//
// Nothing in this file computes a hit, a health value, a bullet count or a round
// transition. Every one of those is read out of the state the reducer returned.
// The one thing it reconstructs is WHERE a ball stopped, because the core's impact
// events carry a projectile id and not a position.
//
// ---- CONVERGENCE, AND WHY IT IS THIS LAYER'S PROBLEM ------------------------
//
// A duel now runs until a health bar empties, so the player no longer gets a free
// sense of progress from "round 4 of 6". Take that away and give nothing back and
// the fight reads as possibly endless, which is worse than long.
//
// The fix is NOT to reintroduce a countdown in another costume. A progress bar over
// an unknown total would be a lie, and a timer would put a clock on a format whose
// answering phase is deliberately untimed. What this layer does instead is show the
// termination condition itself, in three projections below:
//
//   hitsToFall          how many clean hits each side is from falling, at the other
//                       side's own shot damage. The number the duel actually ends
//                       on, and it only ever goes down.
//   roundOpeningHealth  where each bar stood when this round's engagement opened, so
//                       the round's damage is a visible step rather than a silent
//                       slide.
//   roundExchange       what the round has cost each side so far, so a round that
//                       moved nothing is legible AS a round that moved nothing.
//
// None of the three is invented. Health is the core's, shot damage is the core's
// authored parameter, and the arithmetic between them is the same arithmetic the
// core will use to end the duel.

import { chestPosition, isCrouched } from "@pa/engine-world";
import {
  MUZZLE_OFFSET_M,
  assistedAim,
  createDuel,
  currentAmmo,
  currentHealth,
  duelMode,
  hasLineOfSight,
  isDowned,
  reduceDuel,
  FIELD_DT,
  type BulletGrant,
  type BySide,
  type CombatIntent,
  type CommittedVerdict,
  type CreateDuelInput,
  type DuelEvent,
  type DuelOutcome,
  type DuelPhase,
  type DuelQuestionRef,
  type DuelRejection,
  type DuelSide,
  type DuelState,
  type FighterState,
  type PartialIntents,
  type Projectile,
  type RoundSummary,
  type VerdictEntry,
  type VerdictKind,
  type VerdictSource,
} from "@pa/duel";

// ---- read models -----------------------------------------------------------

export interface DuelVerdictReadout {
  readonly round: number;
  readonly side: DuelSide;
  readonly kind: VerdictKind;
  readonly source: VerdictSource;
}

/** Everything the DOM overlay draws, and nothing that changes every tick. */
export interface DuelHud {
  readonly phase: DuelPhase;
  /**
   * Which round is being fought. AN ORDINAL AND NEVER A FRACTION — there is no
   * total here to pair it with, because the duel does not have one.
   */
  readonly round: number;
  readonly mode: "BOSS" | "PVP";
  readonly health: BySide<number>;
  readonly maxHealth: BySide<number>;
  /**
   * Clean hits each side is from falling, at the OTHER side's authored shot
   * damage. This is the duel's real termination condition expressed as a small
   * integer, and it is the presentation's answer to an open-ended round count:
   * see the note on convergence below.
   */
  readonly hitsToFall: BySide<number>;
  /** Health when this round's engagement opened, so its damage is visible on the bar. */
  readonly roundOpeningHealth: BySide<number>;
  /**
   * Health each side has lost since then. Anchored on ENGAGEMENT_OPENED rather than
   * on the round summary, because the line-of-sight break — where this gets read out
   * — happens BEFORE the core resolves the round, and a break panel reporting the
   * previous round's damage would be worse than reporting none.
   */
  readonly roundExchange: BySide<number>;
  readonly ammo: BySide<number>;
  /** The magazine this round was loaded with, so spent sockets stay drawable. */
  readonly magazine: BySide<number>;
  readonly downed: BySide<boolean>;
  /** The item being asked, while one is. Content is resolved elsewhere. */
  readonly item: DuelQuestionRef | null;
  /**
   * How many times this item has been asked in this duel, and whether that makes
   * it a repeat. The core marks recycling rather than hiding it — a long duel
   * outruns any bank — and the question panel says so out loud for the same reason.
   */
  readonly itemAppearance: number;
  readonly itemRecycled: boolean;
  readonly awaitingVerdictFrom: readonly DuelSide[];
  /** Survives past VERDICT_COMMITTED so the grant beat can name the verdict. */
  readonly lastVerdict: DuelVerdictReadout | null;
  readonly grants: BySide<BulletGrant> | null;
  readonly summary: RoundSummary | null;
  readonly outcome: DuelOutcome | null;
  /** Whole seconds left on the phase's own countdown; null when untimed. */
  readonly secondsRemaining: number | null;
}

export interface ActorPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Facing, from the aim vector: a duelling body points where it shoots. */
  readonly yaw: number;
  readonly capsuleHeight: number;
  readonly crouched: boolean;
  readonly speedMps: number;
  /** Angle between travel and facing, radians, for the back-step cycle. */
  readonly travelOffFacing: number;
}

export interface PoseFrame {
  /** Fraction of the way from `prev` to `next`, from the core clock's own leftover. */
  readonly alpha: number;
  readonly prev: BySide<ActorPose>;
  readonly next: BySide<ActorPose>;
}

export interface SideCues {
  readonly lastFireTick: number;
  readonly lastFireOrigin: readonly [number, number, number] | null;
  readonly lastHitTick: number;
  readonly lastDodgeTick: number;
  readonly lastEvadeTick: number;
  readonly lastReloadRound: number;
}

export type DuelCues = BySide<SideCues>;

export type ImpactKind = "HIT" | "COVER" | "SPENT";

export interface DuelImpact {
  readonly projectileId: number;
  readonly kind: ImpactKind;
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly dirX: number;
  readonly dirZ: number;
}

/**
 * What the runtime needs, which is the core's input minus every way of expressing
 * a duel length.
 *
 * Both omissions are deliberate rather than forgotten. `rounds` is the core's
 * deprecated alias for its own termination backstop, and `roundCeiling` is that
 * backstop — neither is the presentation layer's to set, and a caller-supplied
 * round count is a round cap wearing a different name.
 */
export type DuelRuntimeInput = Omit<CreateDuelInput, "rounds" | "roundCeiling">;

export interface DuelRuntime {
  readonly duelId: string;
  readonly mode: "BOSS" | "PVP";
  getState(): DuelState;
  getHud(): DuelHud;
  getPoses(): PoseFrame;
  getCues(): DuelCues;
  /** Recent impacts, newest last. Bounded; old entries are dropped. */
  getImpacts(): readonly DuelImpact[];
  /** Every event the core has emitted, in order. The commit log projects from this. */
  getEvents(): readonly DuelEvent[];
  /**
   * Hand the core one frame's real delta and get back how many fixed steps it
   * bought. THE RETURN VALUE IS LOAD-BEARING: a caller that edge-latches a press
   * must hold the latch until a tick consumes it, and on a high-refresh display
   * most frames buy no tick at all. See the note in duelInput.ts.
   */
  advance(frameDtS: number, intents?: PartialIntents): number;
  /**
   * Hand the core a verdict minted by the grading authority. The client cannot
   * express a bullet count anywhere in this call, and does not try.
   */
  commitVerdict(side: DuelSide, verdict: CommittedVerdict): DuelRejection | null;
  subscribe(listener: () => void): () => void;
}

const IMPACT_HISTORY = 24;
const NEVER = -1;

const IDLE_CUES: SideCues = {
  lastFireTick: NEVER,
  lastFireOrigin: null,
  lastHitTick: NEVER,
  lastDodgeTick: NEVER,
  lastEvadeTick: NEVER,
  lastReloadRound: NEVER,
};

// ---- projections -----------------------------------------------------------

function phaseSecondsRemaining(state: DuelState): number | null {
  const tick = state.clock.tick;
  switch (state.phase) {
    case "FACE_OFF":
      return Math.max(0, (state.endsAtTick - tick) / 60);
    case "BULLETS_GRANTED":
      return Math.max(0, (state.resumesAtTick - tick) / 60);
    case "ENGAGEMENT_LIVE":
      return Math.max(0, (state.endsAtTick - tick) / 60);
    case "LINE_OF_SIGHT_BREAK":
      return Math.max(0, (state.endsAtTick - tick) / 60);
    default:
      // QUESTION_PENDING is genuinely untimed, and the resolved phases have
      // nothing left to count.
      return null;
  }
}

/** Sub-second remaining on the live phase, for a ring or a bar. */
export function phaseProgressSeconds(state: DuelState): number | null {
  return phaseSecondsRemaining(state);
}

function actorPose(fighter: FighterState): ActorPose {
  const speedMps = Math.hypot(fighter.motion.vel.x, fighter.motion.vel.z);
  const facing = Math.atan2(fighter.aimX, fighter.aimZ);
  let travelOffFacing = 0;
  if (speedMps > 0.05) {
    const travel = Math.atan2(fighter.motion.vel.x, fighter.motion.vel.z);
    travelOffFacing = Math.abs(normaliseAngle(travel - facing));
  }
  return {
    x: fighter.motion.pos.x,
    y: fighter.motion.pos.y,
    z: fighter.motion.pos.z,
    yaw: facing,
    capsuleHeight: fighter.motion.capsuleHeight,
    // Stance from the live capsule, not the phase name: a burst out of a crouch is
    // phase DASH and still crouched. This is the engine's own rule.
    crouched: isCrouched(fighter.motion.capsuleHeight),
    speedMps,
    travelOffFacing,
  };
}

export function normaliseAngle(radians: number): number {
  let value = radians;
  while (value > Math.PI) value -= Math.PI * 2;
  while (value < -Math.PI) value += Math.PI * 2;
  return value;
}

/** Shortest-path angle interpolation, so facing never spins the long way round. */
export function lerpAngle(from: number, to: number, alpha: number): number {
  return from + normaliseAngle(to - from) * alpha;
}

export function lerpPose(prev: ActorPose, next: ActorPose, alpha: number): ActorPose {
  const t = Math.min(1, Math.max(0, alpha));
  return {
    x: prev.x + (next.x - prev.x) * t,
    y: prev.y + (next.y - prev.y) * t,
    z: prev.z + (next.z - prev.z) * t,
    yaw: lerpAngle(prev.yaw, next.yaw, t),
    capsuleHeight: prev.capsuleHeight + (next.capsuleHeight - prev.capsuleHeight) * t,
    crouched: next.crouched,
    speedMps: prev.speedMps + (next.speedMps - prev.speedMps) * t,
    travelOffFacing: next.travelOffFacing,
  };
}

/**
 * Where a ball is between fixed steps.
 *
 * Reconstructed backwards from the authoritative position rather than integrated
 * forwards: a projectile travels in a straight line at a constant velocity, so its
 * previous tick is exactly `position - velocity * FIELD_DT`. That keeps the
 * renderer a pure function of core state and means a ball spawned this tick still
 * enters the frame smoothly.
 */
export function interpolatedProjectile(
  projectile: Projectile,
  alpha: number,
): { x: number; y: number; z: number } {
  const back = (1 - Math.min(1, Math.max(0, alpha))) * FIELD_DT;
  return {
    x: projectile.x - projectile.vx * back,
    y: projectile.y,
    z: projectile.z - projectile.vz * back,
  };
}

function verdictReadout(entry: VerdictEntry, round: number): DuelVerdictReadout {
  return {
    round,
    side: entry.side,
    kind: entry.verdict.kind,
    source: entry.verdict.source,
  };
}

/**
 * Clean hits from falling. The damage is the shooter's authored `shotDamage` and
 * the health is the core's, so this is a division and not a damage model.
 */
export function hitsToFall(health: number, damagePerHit: number): number {
  if (!(damagePerHit > 0)) return 0;
  return Math.max(0, Math.ceil(Math.max(0, health) / damagePerHit));
}

export interface ReticleReadout {
  /** Where the ball will actually go, at the distance the pointer was cast to. */
  readonly x: number;
  readonly z: number;
  /** True when the assist moved the line off the raw pointer ray. */
  readonly snapped: boolean;
  /** 0 while reloading, 1 when the next ball is available. */
  readonly reloaded: number;
  readonly hasAmmo: boolean;
}

/**
 * Where to draw the reticle, which is NOT where the pointer is.
 *
 * The core corrects a shot toward the intercept solution whenever the raw aim falls
 * within a cone of it, so against a moving target the ball leaves along a different
 * line from the one under the cursor. Drawing the cursor's line would make the
 * assist look like the gun misfiring; drawing this makes it look like a lock.
 *
 * The correction comes from the core's own `assistedAim`, called with the arguments
 * `resolveFiring` will pass it, so the mark and the ball cannot disagree.
 */
/**
 * Furthest the mark is drawn from the shooter.
 *
 * A pointer near the horizon casts a ray almost parallel to the aim plane, and the
 * intersection lands hundreds of metres out — off the yard, a pixel wide, and no use
 * to anyone. The aim DIRECTION is unaffected by this clamp because it is normalised;
 * only the distance the mark is drawn at changes. Comfortably past the face-off
 * separation, so a shot at the officer is never foreshortened.
 */
export const RETICLE_MAX_REACH_M = 24;

export function reticleReadout(
  state: DuelState,
  aimAtX: number,
  aimAtZ: number,
  side: DuelSide = "A",
): ReticleReadout {
  const shooter = state.combat.fighters[side];
  const target = state.combat.fighters[side === "A" ? "B" : "A"];
  const rawX = aimAtX - shooter.motion.pos.x;
  const rawZ = aimAtZ - shooter.motion.pos.z;
  const rawLength = Math.hypot(rawX, rawZ);
  const interval = Math.max(1, state.params[side].fireIntervalTicks);
  const ticksLeft = Math.max(0, shooter.fireReadyAtTick - state.combat.tick);
  const base = {
    reloaded: 1 - Math.min(1, ticksLeft / interval),
    hasAmmo: shooter.ammo > 0,
  };
  if (rawLength <= 1e-3) return { x: aimAtX, z: aimAtZ, snapped: false, ...base };

  const reach = Math.min(RETICLE_MAX_REACH_M, rawLength);
  const along = (dirX: number, dirZ: number) => ({
    x: shooter.motion.pos.x + dirX * reach,
    z: shooter.motion.pos.z + dirZ * reach,
  });
  const raw = { x: rawX / rawLength, z: rawZ / rawLength };

  // The assist's own sight condition. `revealsOpponentThroughCover` is the only
  // other input and nothing sets it yet, so this is the whole test today.
  const canTarget = hasLineOfSight(state.config.world, shooter, target);
  const aimed = assistedAim(
    shooter,
    target,
    rawX,
    rawZ,
    state.params[side].aimAssist,
    canTarget,
  );
  if (Math.hypot(aimed.x, aimed.z) <= 1e-6) {
    return { ...along(raw.x, raw.z), snapped: false, ...base };
  }
  const alignment = aimed.x * raw.x + aimed.z * raw.z;
  return { ...along(aimed.x, aimed.z), snapped: alignment < 0.99995, ...base };
}

interface RoundLedger {
  readonly opening: BySide<number>;
  readonly magazine: BySide<number>;
}

function buildHud(
  state: DuelState,
  lastVerdict: DuelVerdictReadout | null,
  summary: RoundSummary | null,
  ledger: RoundLedger,
): DuelHud {
  const health = currentHealth(state);
  const ammo = currentAmmo(state);
  return {
    phase: state.phase,
    round: state.round,
    mode: duelMode(state.config.opponent),
    health,
    maxHealth: { A: state.params.A.maxHealth, B: state.params.B.maxHealth },
    // Each side falls to the OTHER side's shot damage.
    hitsToFall: {
      A: hitsToFall(health.A, state.params.B.shotDamage),
      B: hitsToFall(health.B, state.params.A.shotDamage),
    },
    roundOpeningHealth: ledger.opening,
    roundExchange: {
      A: Math.max(0, ledger.opening.A - health.A),
      B: Math.max(0, ledger.opening.B - health.B),
    },
    ammo,
    magazine: ledger.magazine,
    downed: {
      A: isDowned(state.combat.fighters.A),
      B: isDowned(state.combat.fighters.B),
    },
    item:
      state.phase === "QUESTION_PENDING" || state.phase === "VERDICT_COMMITTED"
        ? state.item
        : null,
    itemAppearance:
      state.phase === "QUESTION_PENDING" || state.phase === "VERDICT_COMMITTED"
        ? state.asked.appearance
        : 0,
    itemRecycled:
      (state.phase === "QUESTION_PENDING" || state.phase === "VERDICT_COMMITTED") &&
      state.asked.recycled,
    awaitingVerdictFrom: state.phase === "QUESTION_PENDING" ? state.awaiting : [],
    lastVerdict,
    grants: state.phase === "BULLETS_GRANTED" ? state.grants : null,
    summary: state.phase === "ROUND_RESOLVED" ? state.summary : summary,
    outcome: state.phase === "DUEL_RESOLVED" ? state.outcome : null,
    secondsRemaining: (() => {
      const seconds = phaseSecondsRemaining(state);
      return seconds === null ? null : Math.max(0, Math.ceil(seconds));
    })(),
  };
}

function sameHud(a: DuelHud, b: DuelHud): boolean {
  return (
    a.phase === b.phase &&
    a.round === b.round &&
    a.health.A === b.health.A &&
    a.health.B === b.health.B &&
    a.roundOpeningHealth === b.roundOpeningHealth &&
    a.ammo.A === b.ammo.A &&
    a.ammo.B === b.ammo.B &&
    a.magazine.A === b.magazine.A &&
    a.magazine.B === b.magazine.B &&
    a.downed.A === b.downed.A &&
    a.downed.B === b.downed.B &&
    a.item === b.item &&
    a.itemAppearance === b.itemAppearance &&
    a.awaitingVerdictFrom === b.awaitingVerdictFrom &&
    a.lastVerdict === b.lastVerdict &&
    a.grants === b.grants &&
    a.summary === b.summary &&
    a.outcome === b.outcome &&
    a.secondsRemaining === b.secondsRemaining
  );
}

// ---- the runtime -----------------------------------------------------------

export function createDuelRuntime(input: DuelRuntimeInput): DuelRuntime {
  const created = createDuel(input);
  let state: DuelState = created.state;
  const events: DuelEvent[] = [...created.events];

  let prev = { A: actorPose(state.combat.fighters.A), B: actorPose(state.combat.fighters.B) };
  let next = prev;
  let cues: DuelCues = { A: IDLE_CUES, B: IDLE_CUES };
  let impacts: DuelImpact[] = [];
  let lastVerdict: DuelVerdictReadout | null = null;
  let lastSummary: RoundSummary | null = null;
  // The ledger is the only memory this file keeps, and it remembers core numbers
  // rather than deriving new ones: the health each bar had when the round's
  // engagement opened, and the magazine the core granted for it.
  let ledger: RoundLedger = {
    opening: { A: state.params.A.maxHealth, B: state.params.B.maxHealth },
    magazine: { A: 0, B: 0 },
  };
  let hud = buildHud(state, lastVerdict, lastSummary, ledger);

  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  /** Last seen position of every ball in flight, so an impact has a place. */
  const trail = new Map<
    number,
    { x: number; z: number; y: number; vx: number; vz: number; tick: number }
  >();

  function rememberProjectiles(): void {
    const live = new Set<number>();
    for (const projectile of state.combat.projectiles) {
      live.add(projectile.id);
      trail.set(projectile.id, {
        x: projectile.x,
        y: projectile.y,
        z: projectile.z,
        vx: projectile.vx,
        vz: projectile.vz,
        tick: state.combat.tick,
      });
    }
    for (const id of [...trail.keys()]) {
      if (!live.has(id)) trail.delete(id);
    }
  }

  function impactFor(
    projectileId: number,
    tick: number,
    kind: ImpactKind,
  ): DuelImpact | null {
    const seen = trail.get(projectileId);
    if (!seen) return null;
    // The event carries the tick it happened on, so the ball's last known position
    // can be carried forward exactly rather than approximately.
    const steps = Math.max(0, tick - seen.tick);
    const speed = Math.hypot(seen.vx, seen.vz) || 1;
    return {
      projectileId,
      kind,
      tick,
      x: seen.x + seen.vx * FIELD_DT * steps,
      y: seen.y,
      z: seen.z + seen.vz * FIELD_DT * steps,
      dirX: seen.vx / speed,
      dirZ: seen.vz / speed,
    };
  }

  function muzzleOf(side: DuelSide): readonly [number, number, number] {
    const fighter = state.combat.fighters[side];
    const chest = chestPosition(fighter.motion);
    return [
      chest.x + fighter.aimX * MUZZLE_OFFSET_M,
      chest.y,
      chest.z + fighter.aimZ * MUZZLE_OFFSET_M,
    ];
  }

  function absorbEvents(fresh: readonly DuelEvent[]): void {
    if (fresh.length === 0) return;
    const nextImpacts: DuelImpact[] = [];
    let cueA = cues.A;
    let cueB = cues.B;
    const patch = (side: DuelSide, change: Partial<SideCues>): void => {
      if (side === "A") cueA = { ...cueA, ...change };
      else cueB = { ...cueB, ...change };
    };

    for (const event of fresh) {
      events.push(event);
      switch (event.type) {
        case "SHOT_FIRED":
          patch(event.side, {
            lastFireTick: event.tick,
            lastFireOrigin: muzzleOf(event.side),
          });
          break;
        case "HIT_LANDED": {
          patch(event.target, { lastHitTick: event.tick });
          const impact = impactFor(event.projectileId, event.tick, "HIT");
          if (impact) nextImpacts.push(impact);
          break;
        }
        case "SHOT_ABSORBED_BY_COVER": {
          const impact = impactFor(event.projectileId, event.tick, "COVER");
          if (impact) nextImpacts.push(impact);
          break;
        }
        case "SHOT_EXPIRED": {
          const impact = impactFor(event.projectileId, event.tick, "SPENT");
          if (impact) nextImpacts.push(impact);
          break;
        }
        case "SHOT_EVADED":
          patch(event.side, { lastEvadeTick: event.tick });
          break;
        case "DODGE_STARTED":
          patch(event.side, { lastDodgeTick: event.tick });
          break;
        case "BULLETS_GRANTED":
          patch(event.side, { lastReloadRound: event.round });
          ledger = {
            ...ledger,
            magazine: { ...ledger.magazine, [event.side]: event.grant.magazine },
          };
          break;
        case "VERDICT_COMMITTED":
          lastVerdict = verdictReadout(
            { side: event.side, verdict: event.verdict },
            event.round,
          );
          break;
        case "ENGAGEMENT_OPENED": {
          // Re-anchor the bars here rather than at ROUND_RESOLVED, so the break beat
          // reads out the round it is ending and not the one before it.
          const health = currentHealth(state);
          ledger = { ...ledger, opening: { A: health.A, B: health.B } };
          break;
        }
        case "ROUND_RESOLVED":
          lastSummary = event.summary;
          break;
        default:
          break;
      }
    }

    if (cueA !== cues.A || cueB !== cues.B) cues = { A: cueA, B: cueB };
    if (nextImpacts.length > 0) {
      impacts = [...impacts, ...nextImpacts].slice(-IMPACT_HISTORY);
    }
  }

  function republish(): void {
    const candidate = buildHud(state, lastVerdict, lastSummary, ledger);
    if (!sameHud(hud, candidate)) {
      hud = candidate;
      notify();
    }
  }

  return {
    duelId: state.config.duelId,
    mode: duelMode(state.config.opponent),
    getState: () => state,
    getHud: () => hud,
    getPoses: () => ({
      // The core's own leftover time is the interpolation cursor. Nothing else
      // measures time in the presentation layer.
      alpha: Math.min(1, Math.max(0, state.clock.accumulatorS / FIELD_DT)),
      prev,
      next,
    }),
    getCues: () => cues,
    getImpacts: () => impacts,
    getEvents: () => events,

    advance(frameDtS: number, intents: PartialIntents = {}): number {
      if (state.phase === "DUEL_RESOLVED") return 0;
      const tickBefore = state.combat.tick;
      rememberProjectiles();
      const result = reduceDuel(state, {
        kind: "ADVANCE",
        frameDtS,
        intents,
      });
      if (!result.ok) {
        // The only legal rejection for ADVANCE is a resolved duel, which the guard
        // above already covers. Anything else is a defect worth seeing.
        console.warn(`[duel] advance rejected: ${result.rejection.code}`);
        return 0;
      }
      state = result.state;
      absorbEvents(result.events);
      if (state.combat.tick !== tickBefore) {
        prev = next;
        next = {
          A: actorPose(state.combat.fighters.A),
          B: actorPose(state.combat.fighters.B),
        };
      }
      republish();
      return result.ticksAdvanced;
    },

    commitVerdict(side: DuelSide, verdict: CommittedVerdict): DuelRejection | null {
      const result = reduceDuel(state, { kind: "COMMIT_VERDICT", side, verdict });
      if (!result.ok) return result.rejection;
      state = result.state;
      absorbEvents(result.events);
      republish();
      return null;
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** Convenience for a defeat overlay: which side the local player is. */
export const LOCAL_SIDE: DuelSide = "A";

export function opponentSide(): DuelSide {
  return "B";
}

/** Intent with nothing pressed, for a phase where the player has no input. */
export const NO_INTENT: CombatIntent = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  crouch: false,
  jump: false,
  dodge: false,
  fire: false,
  aimX: 0,
  aimZ: 0,
  abilityId: null,
};
