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
  readonly yaw: number;
  readonly capsuleHeight: number;
  readonly health: number;
  readonly ammo: number;
  readonly dashing: boolean;
  readonly invulnerableUntilTick: number;
  readonly dodgeReadyAtTick: number;
  readonly abilityUsesRemaining: Readonly<Record<string, number>>;
}

/** What a client is told about the other fighter. Deliberately partial. */
export interface OpponentView {
  readonly side: DuelSide;
  readonly handle: string;
  readonly rank: number;
  /** Last position the server could see. Stale while `visible` is false. */
  readonly position: Vec3;
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
}

/** Per-side memory of where the opponent was last legitimately visible. */
export interface LastKnownPosition {
  readonly position: Vec3;
  readonly tick: number;
}

export type LastKnownBySide = {
  readonly A: LastKnownPosition;
  readonly B: LastKnownPosition;
};

export function initialLastKnown(combat: CombatState): LastKnownBySide {
  return {
    A: { position: { ...combat.fighters.B.motion.pos }, tick: 0 },
    B: { position: { ...combat.fighters.A.motion.pos }, tick: 0 },
  };
}

/**
 * Refresh each side's last-known record. Called once per authoritative tick, before
 * projecting, so a snapshot never reveals a position the viewer could not see.
 */
export function updateLastKnown(
  world: CollisionWorld,
  combat: CombatState,
  previous: LastKnownBySide,
): LastKnownBySide {
  const forSide = (viewer: DuelSide): LastKnownPosition => {
    const self = combat.fighters[viewer];
    const target = combat.fighters[otherSide(viewer)];
    if (!hasLineOfSight(world, self, target)) return previous[viewer];
    return { position: { ...target.motion.pos }, tick: combat.tick };
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
      yaw: self.motion.yaw,
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
      position: visible ? { ...opponent.motion.pos } : { ...remembered.position },
      capsuleHeight: opponent.motion.capsuleHeight,
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
