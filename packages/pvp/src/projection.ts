// What each client is told, which is deliberately less than the server knows.
//
// Two different requirements land on the same function, and it is worth naming both
// because they are usually treated as separate problems:
//
// ANTI-CHEAT. A snapshot containing the opponent's exact position is a wallhack for
// any modified client, and no amount of rendering discipline fixes that, because the
// data is already in the browser. So an opponent's position is only sent while the
// server can see a line of sight between the two bodies. Once cover breaks it, the
// client keeps the LAST KNOWN position and is told `visible: false`. A cheating client
// then draws a stale ghost, which is exactly what an honest one draws. This is the
// engine's own `segmentClear` deciding, through @pa/duel's `hasLineOfSight`, so
// "what the server thinks you can see" and "what cover actually blocks" are the same
// query rather than two that drift.
//
// PRIVACY. A projection is also the boundary a classmate's identity must not cross.
// `profileId` is absent by construction — this type has no field for it — and so is
// the opponent's answer text, its length, and its hash. What the opponent's side
// carries about the question is a boolean while they are answering and a verdict KIND
// once both are committed, because the resulting bullet count is visible in the fight
// anyway and pretending otherwise would be theatre.
//
// Both are enforced by building the projection field by field rather than by spreading
// the authoritative state and deleting from it. A field added to the server's state
// cannot leak by omission, because omission is the default here.

import {
  FIELD_TICK_HZ,
  hasLineOfSight,
  type CollisionWorld,
  type CombatState,
  type DuelPhase,
  type DuelSide,
  type DuelState,
  type Vec3,
} from "@pa/duel";
import { otherSide } from "@pa/duel";

/** What a client is told about its own fighter. Complete: it is their own body. */
export interface SelfView {
  readonly side: DuelSide;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /**
   * AIM yaw, not motion yaw. The self body points where the player is aiming, which
   * is what the client's own look owns; deriving it from `motion.yaw` (the direction
   * of travel) fed a lagged body facing back into a camera that followed it. See
   * @pa/engine-world's `playerLook` for why look is an input, never a follow.
   */
  readonly yaw: number;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  readonly dashing: boolean;
  readonly invulnerableUntilTick: number;
  readonly dodgeReadyAtTick: number;
  readonly abilityUsesRemaining: Readonly<Record<string, number>>;
}

/**
 * What a client is told about the other fighter. Deliberately partial, and every
 * pose detail is GATED ON THE SAME LINE OF SIGHT the position is: aim, velocity and
 * dash are refreshed only while the server can legitimately see them, and freeze
 * TOGETHER with the position the instant cover breaks — so a client cannot infer a
 * facing, a heading or a roll the server did not sanction, and the frozen values are
 * the last legitimately-seen ones, not a live leak.
 */
export interface OpponentView {
  readonly side: DuelSide;
  readonly handle: string;
  readonly rank: number;
  /** Last position the server could see. Stale while `visible` is false. */
  readonly position: Vec3;
  /** Ground velocity, m/s. Frozen with the position when `visible` is false. */
  readonly velocity: { readonly x: number; readonly z: number };
  /** Aim yaw — snapshot-backed so a client never infers facing. Frozen when unseen. */
  readonly aimYaw: number;
  /** Whether they are mid-dash. Snapshot-backed; frozen when unseen. */
  readonly dashing: boolean;
  readonly capsuleHeight: number;
  /** Health is public: it is the scoreboard of the fight. */
  readonly health: number;
  readonly ammo: number;
  readonly visible: boolean;
  /** Tick the position was captured. Lets a client fade a stale ghost honestly. */
  readonly positionAtTick: number;
  /** Whether they are still answering. No text, no length, no timing detail. */
  readonly answering: boolean;
}

export interface ProjectileView {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vz: number;
  /** Whose ball. Needed to render it; carries nothing about the shooter. */
  readonly shooter: DuelSide;
}

export interface MatchSnapshot {
  readonly matchId: string;
  readonly tick: number;
  readonly phase: DuelPhase;
  readonly round: number;
  readonly self: SelfView;
  readonly opponent: OpponentView;
  readonly projectiles: readonly ProjectileView[];
  /**
   * The authoritative post-answer countdown, in WHOLE display seconds, or null.
   *
   * Non-null ONLY during BULLETS_GRANTED — the 3-second window @pa/duel opens once
   * both verdicts have landed and before the fighters may engage again. It is the
   * duel core's own `resumesAtTick` minus the current tick, divided by the fixed
   * rate, so it is 3 then 2 then 1 and is never a second timer this layer runs. In
   * every other phase it is null: a client shows a countdown exactly when the server
   * is counting down, and never while a side still owes an answer.
   */
  readonly resumeCountdownSeconds: number | null;
}

/**
 * The authoritative resume countdown as whole display seconds, or null outside
 * BULLETS_GRANTED.
 *
 * Derived only from `resumesAtTick - clock.tick`, the duel core's own values, so it
 * cannot disagree with the simulation. `ceil` gives a clean 3 → 2 → 1: the first
 * whole second shows 3 (180..121 ticks left), the next 2, the last 1, and it reaches
 * 0 at the tick the machine itself resumes into ENGAGEMENT_LIVE — where the phase is
 * no longer BULLETS_GRANTED and this returns null. It only ever decreases as the tick
 * advances, so a presentation that clamps to it can never count up.
 */
export function resumeCountdownSecondsFor(state: DuelState): number | null {
  if (state.phase !== "BULLETS_GRANTED") return null;
  const remainingTicks = state.resumesAtTick - state.clock.tick;
  return Math.max(0, Math.ceil(remainingTicks / FIELD_TICK_HZ));
}

/**
 * Per-side memory of the opponent AS LAST LEGITIMATELY SEEN — the whole pose, not
 * just where they stood. Position, velocity, aim and dash are remembered together and
 * handed out together while the sight line is broken, so nothing about the opponent's
 * body updates behind cover.
 */
export interface LastKnownPose {
  readonly position: Vec3;
  readonly velocity: { readonly x: number; readonly z: number };
  readonly aimYaw: number;
  readonly dashing: boolean;
  readonly capsuleHeight: number;
  readonly tick: number;
}

export type LastKnownBySide = {
  readonly A: LastKnownPose;
  readonly B: LastKnownPose;
};

function poseOf(fighter: CombatState["fighters"]["A"], tick: number): LastKnownPose {
  return {
    position: { ...fighter.motion.pos },
    velocity: { x: fighter.motion.vel.x, z: fighter.motion.vel.z },
    aimYaw: Math.atan2(fighter.aimX, fighter.aimZ),
    dashing: fighter.motion.dash !== null,
    capsuleHeight: fighter.motion.capsuleHeight,
    tick,
  };
}

export function initialLastKnown(combat: CombatState): LastKnownBySide {
  return {
    A: poseOf(combat.fighters.B, 0),
    B: poseOf(combat.fighters.A, 0),
  };
}

/**
 * Refresh each side's last-known record. Called once per authoritative tick, before
 * projecting, so a snapshot never reveals a pose the viewer could not see. On a broken
 * sight line the previous record is kept WHOLE — position, velocity, aim and dash all
 * freeze at the same instant.
 */
export function updateLastKnown(
  world: CollisionWorld,
  combat: CombatState,
  previous: LastKnownBySide,
): LastKnownBySide {
  const forSide = (viewer: DuelSide): LastKnownPose => {
    const self = combat.fighters[viewer];
    const target = combat.fighters[otherSide(viewer)];
    if (!hasLineOfSight(world, self, target)) return previous[viewer];
    return poseOf(target, combat.tick);
  };
  return { A: forSide("A"), B: forSide("B") };
}

export interface ProjectionInput {
  readonly matchId: string;
  readonly state: DuelState;
  readonly world: CollisionWorld;
  readonly lastKnown: LastKnownBySide;
  readonly handles: { readonly A: string; readonly B: string };
  readonly ranks: { readonly A: number; readonly B: number };
  /** Sides that still owe a verdict this round, from the machine's own awaiting list. */
  readonly awaiting: readonly DuelSide[];
}

export function projectSnapshotFor(
  viewer: DuelSide,
  input: ProjectionInput,
): MatchSnapshot {
  const combat = input.state.combat;
  const self = combat.fighters[viewer];
  const opponentSide = otherSide(viewer);
  const opponent = combat.fighters[opponentSide];
  const visible = hasLineOfSight(input.world, self, opponent);
  const remembered = input.lastKnown[viewer];

  const abilityUsesRemaining: Record<string, number> = {};
  for (const [abilityId, record] of Object.entries(self.abilities)) {
    abilityUsesRemaining[abilityId] = record.usesRemaining;
  }

  return {
    matchId: input.matchId,
    tick: combat.tick,
    phase: input.state.phase,
    round: input.state.round,
    self: {
      side: viewer,
      position: { ...self.motion.pos },
      velocity: { ...self.motion.vel },
      // Aim, not travel: the body points where the player is aiming.
      yaw: Math.atan2(self.aimX, self.aimZ),
      capsuleHeight: self.motion.capsuleHeight,
      health: self.health,
      ammo: self.ammo,
      dashing: self.motion.dash !== null,
      invulnerableUntilTick: self.dodge.iframeUntilTick,
      dodgeReadyAtTick: self.dodge.readyAtTick,
      abilityUsesRemaining,
    },
    opponent: {
      side: opponentSide,
      handle: input.handles[opponentSide],
      rank: input.ranks[opponentSide],
      // Position, velocity, aim and dash all come from the live body while visible,
      // and ALL from the frozen last-known record while not — never a mix, so nothing
      // about the opponent updates behind cover.
      position: visible ? { ...opponent.motion.pos } : { ...remembered.position },
      velocity: visible
        ? { x: opponent.motion.vel.x, z: opponent.motion.vel.z }
        : { ...remembered.velocity },
      aimYaw: visible ? Math.atan2(opponent.aimX, opponent.aimZ) : remembered.aimYaw,
      dashing: visible ? opponent.motion.dash !== null : remembered.dashing,
      capsuleHeight: visible ? opponent.motion.capsuleHeight : remembered.capsuleHeight,
      health: opponent.health,
      ammo: opponent.ammo,
      visible,
      positionAtTick: visible ? combat.tick : remembered.tick,
      answering: input.awaiting.includes(opponentSide),
    },
    // Balls are world objects and both players can see them in flight; hiding an
    // incoming ball would make dodging a lottery rather than a skill.
    projectiles: combat.projectiles.map((projectile) => ({
      id: projectile.id,
      x: projectile.x,
      y: projectile.y,
      z: projectile.z,
      vx: projectile.vx,
      vz: projectile.vz,
      shooter: projectile.shooter,
    })),
    // Server-authoritative, derived from the same clock the fight runs on. Null in
    // every phase but BULLETS_GRANTED — see `resumeCountdownSecondsFor`.
    resumeCountdownSeconds: resumeCountdownSecondsFor(input.state),
  };
}

/**
 * Keys that must never appear anywhere in a snapshot. Asserted over real serialised
 * snapshots in `projection.test.ts`, so this is a check on behaviour rather than a
 * comment about intent.
 */
export const FORBIDDEN_SNAPSHOT_KEYS: readonly string[] = [
  "profileId",
  "answerText",
  "responseText",
  "answer",
  "responseRef",
  "email",
  "displayName",
  "givenName",
  "familyName",
  "answerLength",
  "answerHash",
];
