// THE BOSTON ABILITY SET.
//
// Eight abilities. Five serve the slate's functional affordance schedule and land
// in the first eleven Levels; three are combat-shaped and land in the back half,
// where the player is about to need a PvP loadout.
//
// The licence: Mission-Slate section 1.6 permits magic and the fantastical, on one
// narrow condition — "the world, the events, the documents, and every historical
// claim stay accurate. The runner's abilities are the licensed exception, because
// the runner is the one thing in the scene that does not belong to 1765." Every
// ability below is therefore an anomaly the RUNNER carries, and none of them
// changes Boston. Nobody in 1765 acquires a power; a man out of time occasionally
// stops behaving like one.
//
// ============================================================================
// WHAT IS NOT HERE, AND WHY
// ============================================================================
//
// Base movement and stealth are NOT abilities and are not duplicated here.
// Chained parkour, the leap of faith, reflex time, the thrown diversion and crowd
// blending all exist in engine-world and all belong to every player at Level 0.
// An ability that re-implemented one of them would be a fork of the engine and
// would also make the base verb pointless.
//
// So each ability below either SCALES a base verb (a speed, a launch, a
// visibility, a thrown object's pull) or changes what an observer LEARNS. None
// adds a verb. That is what keeps every mission completable at Level 0, and it is
// enforced structurally by `assertAbilityCannotGrantVerbs` in effects.ts.
//
// ============================================================================
// WHY THE UNLOCK LEVELS ARE 3, 5, 7, 8, 11, 15, 21, 27
// ============================================================================
//
// The first five are DERIVED from the worst-paying player who still finishes, not
// chosen. Take the archetype who clears all fourteen missions on the third
// attempt — the persistent, mechanically weak student the design explicitly
// refuses to abandon. That player holds 40 XP after M1, 85 after M2, 135 after M3,
// and so on, which puts them at Level 4 arriving at M5, Level 5 at M6, Level 7 at
// M8, Level 8 at M9 and Level 11 at M11 (all computed in trajectory.ts and
// asserted in verify.test.ts).
//
// Those are exactly the missions the slate introduces the five affordances at. So
// each of the first five unlocks sits AT that arrival Level:
//
//     ATTENTION_RELOCATION            introduced M5   -> Level 3
//     ISOLATED_HEIGHT_ACCESS          introduced M6   -> Level 5
//     CARRIED_EVIDENCE_CONCEALMENT    introduced M8   -> Level 7
//     CONTACT_RECOVERY                introduced M9   -> Level 8
//     UNSUPPORTED_GAP                 introduced M11  -> Level 11
//
// The consequence is the one the brief asked for: the worst player who keeps
// playing meets every affordance holding the ability it was authored for. Levels 7
// and 8 are adjacent because M8 and M9 introduce affordances in consecutive
// missions and that archetype gains almost exactly one Level per mission — pushing
// them apart for tidiness would cost the guarantee, which is a bad trade.
//
// The last three sit at 15, 21 and 27 with widening gaps, mirroring the widening
// cost of a Level. They are combat-shaped because that half of
// `AbilityModifiers` — damage, rate of fire, perception — is untouched by any
// mission affordance, so it is free design space, and because a player reaching
// the back half of Boston is a player about to unlock PvP.
//
// Levels 28-34 mint no ability on purpose. The top of the curve pays RANK. The
// last mission or two of a strong run is about the ladder, not the kit.
//
// ============================================================================
// DECISION — THE MEDIAN FINISHER EARNS THE WHOLE KIT
// ============================================================================
//
// `Out of Time` sits at Level 27 and the median finisher reaches Level 29, so they
// get it with two missions to spare. Level 30 was the alternative and would have
// made it a strong-player trophy (the median tops out at 29).
//
// Level 27 wins because abilities and Rank measure different things. Abilities are
// the visible reward for PLAYING; Rank is the measure of PLAYING WELL, and it is
// Rank that feeds matchmaking. Withholding the ability the owner personally
// approved from the median student for an entire chapter punishes them twice for
// the same missions. If playtest disagrees, this is one number.
//
// A pleasant property falls out of the pool and the bracket sharing a source: both
// derive from Levels, so a player never meets an opponent with a materially deeper
// pool than their own — the Rank 4 bracket is exactly the players who unlocked the
// Rank 4 kit.

import { defineAbility, type GameAbility } from "./ability.js";
import { abilityEffect } from "./effects.js";
import { ticks } from "./duelSurface.js";

// ---------------------------------------------------------------------------
// 1. Ward Chime — Level 3 — attention relocation
// ---------------------------------------------------------------------------
//
// Amplifies the base thrown object rather than replacing it, which is the whole
// design of it. engine-world already flies a real bottle on the shared substep; it
// arcs, it can strike a wall short of the aim point, and the noise happens where
// it actually landed. A guaranteed beacon would delete the skill in aiming and
// fork a working primitive. Ward Chime instead arms the throw: for four seconds,
// anything you throw lands with two and a half times the pull and holds a
// watcher's attention two and a half times as long (4s of hold becomes 10s).
//
// In a duel the same anomaly rings somewhere behind the boss. He checks the wrong
// angle, so his shots come half again as slowly and he gives ground. Six 20-second
// rounds means that window is worth roughly two free shots.
export const WARD_CHIME: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.WARD_CHIME.v1",
  name: "Ward Chime",
  fiction:
    "A resonance struck into a chosen point — a note nothing in 1765 can make, and nobody can ignore.",
  unlockedAtLevel: 3,
  durationTicks: ticks(4),
  affordanceIds: ["ATTENTION_RELOCATION"],
  effect: abilityEffect({
    world: { diversionAttentionScale: 2.5 },
    duel: { opponentFireIntervalScale: 1.5, opponentMoveSpeedScale: 0.9 },
  }),
});

// ---------------------------------------------------------------------------
// 2. Kite Step — Level 5 — isolated height access
// ---------------------------------------------------------------------------
//
// 1.45x on the launch velocity, which is 2.1x on the apex, because apex goes as
// the square of the launch (see `abilityReach`). The engine's standing jump peaks
// at 1.25m; Kite Step peaks at 2.63m.
//
// That number is sized against the slate's actual problem. Base climb already
// reaches 3.2m and base mantle 1.9m, so an "isolated upper opening" only needs an
// ability when there is nothing to climb. Level design authors a low prop — a
// crate, a barrel stack, a cart bed at ~1.5m — under the sill: base players reach
// 2.75m from it and fall short, a Kite Step reaches 4.13m and catches the ledge.
// The stairs are still there, which is exactly how section 18.2 authored M6.
//
// Note it carries a duel channel as well as a world one, and that both are the
// same effect. The duel's `stepFighterMotion` already calls `beginRunningJump`, so
// the jump scale applies there the moment the engine accepts a launch scale, with
// no change here. The move-speed component is the readable part today: lighter on
// your feet, in either encounter.
//
// Grounded-only. The lift is taken from a standing start, and an air jump is a
// second locomotion family the slate forbids.
export const KITE_STEP: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.KITE_STEP.v1",
  name: "Kite Step",
  fiction: "For five seconds the runner borrows a later century's thinner air.",
  unlockedAtLevel: 5,
  durationTicks: ticks(5),
  affordanceIds: ["ISOLATED_HEIGHT_ACCESS"],
  effect: abilityEffect({
    world: { selfJumpVelocityScale: 1.45 },
    duel: { selfMoveSpeedScale: 1.2 },
  }),
  canInvoke: (context) => context.grounded,
});

// ---------------------------------------------------------------------------
// 3. Longcoat Hush — Level 7 — carried evidence concealment
// ---------------------------------------------------------------------------
//
// The long, mild one: eight seconds at half visibility, and for that window an
// observer cannot read the face of what you are carrying.
//
// Half rather than zero on purpose. Full concealment is `Out of Time` twenty
// Levels later, and this ability has to remain worse than that one. 0.5 multiplies
// into `visibility()` alongside stance, cover, light and crowd blend, so it makes a
// bad crossing survivable and a reckless one still fatal.
//
// In a duel there is nothing to carry, so the effect is the part that transfers:
// a man who cannot read you is slower to commit and lands less when he does.
export const LONGCOAT_HUSH: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.LONGCOAT_HUSH.v1",
  name: "Longcoat Hush",
  fiction:
    "Ink, cloth and outline stop agreeing with each other; eyes slide off both the man and the paper.",
  unlockedAtLevel: 7,
  durationTicks: ticks(8),
  affordanceIds: ["CARRIED_EVIDENCE_CONCEALMENT"],
  effect: abilityEffect({
    world: { selfVisibilityScale: 0.5, carriedEvidenceConcealed: true },
    duel: { selfIncomingDamageScale: 0.75, opponentFireIntervalScale: 1.25 },
  }),
});

// ---------------------------------------------------------------------------
// 4. Hold Fast — Level 8 — contact recovery
// ---------------------------------------------------------------------------
//
// The short, hard one: three seconds in which a body that hits you barely costs
// you. Recovery from non-lethal contact runs at a quarter time, and in a duel a
// ball that lands takes roughly a third of its damage.
//
// Named for the Sons of Liberty phrase, which is the joke: the one ability whose
// name is genuinely of the period is the one that does the least fantastical thing.
//
// Section 18.4 is explicit that contact recovery introduces no combat, and this
// respects that — the runner is not hitting back, only refusing to be stopped.
export const HOLD_FAST: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.HOLD_FAST.v1",
  name: "Hold Fast",
  fiction:
    "Momentum the runner did not bring with him. Shoulders, elbows and musket butts all arrive late.",
  unlockedAtLevel: 8,
  durationTicks: ticks(3),
  affordanceIds: ["CONTACT_RECOVERY"],
  effect: abilityEffect({
    world: { staggerRecoveryScale: 0.25 },
    duel: { selfIncomingDamageScale: 0.35 },
  }),
});

// ---------------------------------------------------------------------------
// 5. Long Stride — Level 11 — unsupported gap
// ---------------------------------------------------------------------------
//
// THE movement ability, and the one that most vindicates the architecture: it is a
// single number in a single channel, and that channel is the duel's own.
//
// 1.7x on the target velocity for 1.6 seconds. Nothing else. What that produces is
// entirely the shared integrator's business:
//
//   * running: 4.6 m/s becomes 7.82 m/s, so ~12.5m of ground inside the window;
//   * a gap: 3.65m becomes 6.70m flat, and 9.00m at a 2m drop. Note that is 1.83x,
//     not 1.7x. A gap does not scale with speed, it scales BETTER than speed,
//     because the takeoff setback and the capsule radius come off every gap as
//     constants and a constant is a much larger fraction of a short gap than a long
//     one. `reach.ts` asks engine-world's own `maxGapMetersForDrop` rather than
//     computing a ratio, which is how that was caught;
//   * a duel dodge: `combat.ts` opens the burst with
//     `dashSpeed(RUN_SPEED * speedScale)` and `selfMoveSpeedScale` is a factor of
//     that `speedScale`, so the dodge gets 1.7x too, automatically.
//
// The third bullet is the point. Nobody wrote a duel version of Long Stride. The
// duel already multiplies the target velocity it hands to `stepMotion`, the burst
// phase already substitutes its velocity into the same `stepGrounded`, and so a
// long stride across a rooftop and a long stride out of a boss's line are not two
// behaviours that match — they are one behaviour.
//
// Grounded-only, because `beginDash` refuses a burst that is not grounded and
// `canInvoke` should not promise what the engine will decline. Boston takes no air
// burst: engine-world leaves that decision to the ability layer, and this is the
// decision.
export const LONG_STRIDE: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.LONG_STRIDE.v1",
  name: "Long Stride",
  fiction:
    "The distance between two of the runner's steps stops being a fixed quantity.",
  unlockedAtLevel: 11,
  durationTicks: ticks(1.6),
  affordanceIds: ["UNSUPPORTED_GAP"],
  effect: abilityEffect({
    duel: { selfMoveSpeedScale: 1.7 },
  }),
  canInvoke: (context) => context.grounded,
});

// ---------------------------------------------------------------------------
// 6. Powder Damp — Level 15 — disruption
// ---------------------------------------------------------------------------
//
// Three seconds in which the opponent's powder will not take: shots come at
// 2.2x the interval and he moves at four-fifths speed. In a fight built on a
// six-shot budget, three seconds of a silent opponent is three seconds of free
// aim.
//
// In a mission the surviving channel is the movement one — a patrol that walks
// slower is a patrol you can cross behind. It is honestly the weaker half, and
// that is fine: this is the first ability whose reason to exist is the duel.
export const POWDER_DAMP: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.POWDER_DAMP.v1",
  name: "Powder Damp",
  fiction:
    "The air in another man's pan turns to the inside of a November morning.",
  unlockedAtLevel: 15,
  durationTicks: ticks(3),
  affordanceIds: [],
  effect: abilityEffect({
    duel: { opponentFireIntervalScale: 2.2, opponentMoveSpeedScale: 0.8 },
  }),
});

// ---------------------------------------------------------------------------
// 7. Farsight — Level 21 — perception
// ---------------------------------------------------------------------------
//
// Six seconds of knowing where he is through the wall he is behind. Strictly
// information: `revealsOpponentThroughCover` is an input to targeting and never a
// change to occlusion itself, so the wall still stops the ball. It mints nothing —
// bullets come from verdicts, and an ability that touched the bullet economy would
// break the one rule the duel rests on.
//
// It refuses itself when the holder already has line of sight, which is the only
// interesting thing about its `canInvoke`. With one use per encounter, the worst
// outcome is a player spending their single charge on a boss standing in the open;
// the ability declines rather than let that happen.
//
// In a mission it is the same boolean pointed at watchers: read the room, then
// choose the route.
export const FARSIGHT: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.FARSIGHT.v1",
  name: "Farsight",
  fiction:
    "The runner's own eyes, six seconds from now, borrowed back to the present.",
  unlockedAtLevel: 21,
  durationTicks: ticks(6),
  affordanceIds: [],
  effect: abilityEffect({
    duel: { revealsOpponentThroughCover: true },
  }),
  canInvoke: (context) => !context.hasLineOfSightToOpponent,
});

// ---------------------------------------------------------------------------
// 8. Out of Time — Level 27 — total concealment
// ---------------------------------------------------------------------------
//
// The chapter's last unlock and the strongest thing in the kit: three seconds in
// which nothing in 1765 can see the runner at all.
//
// `selfVisibilityScale: 0` is a complete break of every cone, anywhere, needing no
// crowd and no cover. In a duel a man who cannot see you cannot land a shot and
// will not spend one blind, which is what the two duel channels say: incoming
// damage to zero, his firing interval most of the way doubled.
//
// Three seconds because a full break has to be short. Crowd blending — the base
// verb it most resembles — needs a dense cluster, needs walking pace, takes 0.7s
// to take hold, and a close watcher who saw you walk in is not fooled by it. Out
// of Time answers all four of those objections at once, so it pays for that with
// brevity and with a single use.
export const OUT_OF_TIME: GameAbility = defineAbility({
  abilityId: "BOS.ABILITY.OUT_OF_TIME.v1",
  name: "Out of Time",
  fiction: "For three seconds the runner is not in 1765 at all.",
  unlockedAtLevel: 27,
  durationTicks: ticks(3),
  affordanceIds: ["CARRIED_EVIDENCE_CONCEALMENT"],
  effect: abilityEffect({
    world: { selfVisibilityScale: 0, carriedEvidenceConcealed: true },
    duel: { selfIncomingDamageScale: 0, opponentFireIntervalScale: 1.8 },
  }),
});

// ---------------------------------------------------------------------------
// the set
// ---------------------------------------------------------------------------

/** Every Boston ability, in unlock order. */
export const BOSTON_ABILITIES: readonly GameAbility[] = [
  WARD_CHIME,
  KITE_STEP,
  LONGCOAT_HUSH,
  HOLD_FAST,
  LONG_STRIDE,
  POWDER_DAMP,
  FARSIGHT,
  OUT_OF_TIME,
];

const BY_ID = new Map(BOSTON_ABILITIES.map((ability) => [ability.abilityId, ability]));

export function bostonAbility(abilityId: string): GameAbility | undefined {
  return BY_ID.get(abilityId);
}
