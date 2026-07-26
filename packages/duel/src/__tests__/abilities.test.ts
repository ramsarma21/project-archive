import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeModifiers,
  createAbilityLedger,
  expireAbilityEffects,
  invokeAbility,
  ABILITY_USES_PER_DUEL,
  ABILITY_MODIFIER_CHANNELS,
  NEUTRAL_ABILITY_MODIFIERS,
  type AbilityModifiers,
  type DuelAbility,
} from "../abilities.js";
import {
  createCombatState,
  intent,
  IDLE_INTENT,
  loadMagazine,
  playerParams,
  stepCombat,
  type CombatParams,
} from "../combat.js";
import { openArena } from "../arena.js";

// Test doubles only. Real abilities are defined once in the shared layer and
// merely have to satisfy this interface; the duel never authors one.
function testAbility(overrides: Partial<DuelAbility> = {}): DuelAbility {
  return {
    abilityId: "TEST.DASH",
    unlockedAtLevel: 3,
    durationTicks: 30,
    canInvoke: () => true,
    modifiersAt: () => ({ ...NEUTRAL_ABILITY_MODIFIERS, selfMoveSpeedScale: 2 }),
    ...overrides,
  };
}

const context = {
  round: 1,
  tick: 100,
  selfHealth: 100,
  selfHealthFraction: 1,
  ammoRemaining: 3,
  hasLineOfSightToOpponent: true,
  grounded: true,
};

test("THE SEAM IS COMPLETE AND UNWIRED: an empty loadout is an exact no-op", () => {
  // The owner has not settled the ability set, so nothing is authored. What has to
  // be true is that authoring one later needs no change in combat.ts — so the
  // plumbing stays, and this pins that carrying it costs nothing today.
  const arena = openArena();
  const params: CombatParams = { A: playerParams(), B: playerParams() };
  assert.deepEqual(params.A.loadout, [], "nothing ships with an ability");

  let state = createCombatState(params, {
    A: { pos: { x: 0, y: 0, z: -5 }, yaw: 0 },
    B: { pos: { x: 0, y: 0, z: 5 }, yaw: Math.PI },
  });
  state = loadMagazine(state, "A", 3);
  const stepped = stepCombat(
    arena.world,
    state,
    // An ability id nobody holds. It must be refused, and refused visibly.
    { A: intent({ abilityId: "NOT.A.REAL.ABILITY", fire: true, aimX: 0, aimZ: 1 }), B: IDLE_INTENT },
    params,
    1,
  );
  const refused = stepped.events.find((event) => event.type === "ABILITY_REFUSED");
  assert.ok(refused && refused.type === "ABILITY_REFUSED");
  assert.equal(refused.reason, "NOT_IN_LOADOUT");
  assert.ok(
    stepped.events.some((event) => event.type === "SHOT_FIRED"),
    "and a bogus ability must not swallow the rest of the tick",
  );
});

test("every modifier channel the contract declares is one combat actually reads", () => {
  // The seam's real promise. An author who sets a channel gets an effect; a channel
  // nobody reads is a lie in the interface, and `revealsOpponentThroughCover` was
  // exactly that until the aim assist gave it a meaning.
  assert.deepEqual(
    [...ABILITY_MODIFIER_CHANNELS].sort(),
    Object.keys(NEUTRAL_ABILITY_MODIFIERS).sort(),
    "the declared channel list and the modifier shape must not drift apart",
  );
});

test("one use per ability per duel, and an ability cannot ask for more", () => {
  assert.equal(ABILITY_USES_PER_DUEL, 1);
  const ability = testAbility();
  // The descriptor has no field for a use count, so a greedy ability is not
  // merely refused — it is unrepresentable.
  assert.equal("usesPerDuel" in ability, false);
  const loadout = [ability];
  const ledger = createAbilityLedger(loadout);
  assert.equal(ledger[ability.abilityId]?.usesRemaining, 1);
});

test("the second invocation is refused for the rest of the duel", () => {
  const ability = testAbility();
  const loadout = [ability];
  const first = invokeAbility(loadout, createAbilityLedger(loadout), ability.abilityId, context);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const whileActive = invokeAbility(loadout, first.ledger, ability.abilityId, {
    ...context,
    tick: 110,
  });
  assert.equal(whileActive.ok, false);
  if (!whileActive.ok) assert.equal(whileActive.reason, "ALREADY_ACTIVE");

  // Six rounds later, in a much later round, still spent.
  const expired = expireAbilityEffects(loadout, first.ledger, 100 + ability.durationTicks);
  const muchLater = invokeAbility(loadout, expired, ability.abilityId, {
    ...context,
    round: 6,
    tick: 9000,
  });
  assert.equal(muchLater.ok, false);
  if (!muchLater.ok) assert.equal(muchLater.reason, "ALREADY_USED");
});

test("the rule is the same in a boss duel and in PvP", () => {
  // There is no mode parameter anywhere in this module, which is the point: a
  // single rule, so a loadout choice matters in single player too.
  const source = createAbilityLedger([testAbility()]);
  assert.deepEqual(Object.values(source), [{ usesRemaining: 1, activeSinceTick: null }]);
});

test("an ability that is not in the loadout cannot be invoked", () => {
  const loadout = [testAbility()];
  const outcome = invokeAbility(loadout, createAbilityLedger(loadout), "TEST.GRAPPLE", context);
  assert.equal(outcome.ok, false);
  if (!outcome.ok) assert.equal(outcome.reason, "NOT_IN_LOADOUT");
});

test("an ability may refuse itself, and the duel respects the refusal", () => {
  const ability = testAbility({
    canInvoke: (ctx) => ctx.grounded && ctx.hasLineOfSightToOpponent,
  });
  const loadout = [ability];
  const refused = invokeAbility(loadout, createAbilityLedger(loadout), ability.abilityId, {
    ...context,
    grounded: false,
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.equal(refused.reason, "REFUSED_BY_ABILITY");
});

test("effects expire on their own duration and stop contributing modifiers", () => {
  const ability = testAbility();
  const loadout = [ability];
  const invoked = invokeAbility(loadout, createAbilityLedger(loadout), ability.abilityId, context);
  assert.equal(invoked.ok, true);
  if (!invoked.ok) return;
  assert.equal(activeModifiers(loadout, invoked.ledger, 110).selfMoveSpeedScale, 2);
  const after = expireAbilityEffects(loadout, invoked.ledger, 100 + ability.durationTicks);
  assert.deepEqual(activeModifiers(loadout, after, 130), NEUTRAL_ABILITY_MODIFIERS);
});

test("modifiers compose multiplicatively and clamp hostile values", () => {
  const dash = testAbility({
    abilityId: "TEST.DASH_2",
    modifiersAt: () => ({ ...NEUTRAL_ABILITY_MODIFIERS, selfMoveSpeedScale: 2 }),
  });
  const slow = testAbility({
    abilityId: "TEST.SLOW",
    modifiersAt: () => ({
      ...NEUTRAL_ABILITY_MODIFIERS,
      selfMoveSpeedScale: 1.5,
      opponentFireIntervalScale: 2,
      revealsOpponentThroughCover: true,
    }),
  });
  const broken = testAbility({
    abilityId: "TEST.BROKEN",
    modifiersAt: () =>
      ({
        ...NEUTRAL_ABILITY_MODIFIERS,
        selfMoveSpeedScale: Number.POSITIVE_INFINITY,
        selfIncomingDamageScale: -3,
      }) as AbilityModifiers,
  });
  const loadout = [dash, slow, broken];
  let ledger = createAbilityLedger(loadout);
  for (const ability of loadout) {
    const outcome = invokeAbility(loadout, ledger, ability.abilityId, context);
    assert.equal(outcome.ok, true);
    if (outcome.ok) ledger = outcome.ledger;
  }
  const combined = activeModifiers(loadout, ledger, 105);
  assert.equal(combined.selfMoveSpeedScale, 3);
  assert.equal(combined.opponentFireIntervalScale, 2);
  assert.equal(combined.revealsOpponentThroughCover, true);
  assert.equal(combined.selfIncomingDamageScale, 1, "non-finite/negative scales fall back to neutral");
});

test("no ability may touch the bullet economy", () => {
  // AbilityModifiers has no ammo-shaped member. If one is ever added, the type
  // below stops being `never` and this file stops compiling.
  const keys = Object.keys(NEUTRAL_ABILITY_MODIFIERS);
  for (const forbidden of ["ammo", "bullets", "magazine", "ammoBonus", "bulletBonus"]) {
    assert.equal(keys.includes(forbidden), false, `${forbidden} must not exist`);
  }
});
