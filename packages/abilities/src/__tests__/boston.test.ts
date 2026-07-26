import assert from "node:assert/strict";
import test from "node:test";

import {
  ABILITY_USES_PER_MISSION,
  fitsInsideOneRound,
  missionInvocationContext,
} from "../ability.js";
import {
  BOSTON_ABILITIES,
  FARSIGHT,
  HOLD_FAST,
  KITE_STEP,
  LONGCOAT_HUSH,
  LONG_STRIDE,
  OUT_OF_TIME,
  POWDER_DAMP,
  WARD_CHIME,
  bostonAbility,
} from "../boston.js";
import { ABILITY_USES_PER_DUEL, ticks } from "../duelSurface.js";
import { ABILITY_CHANNELS, assertAbilityCannotGrantVerbs } from "../effects.js";
import { AFFORDANCE_IDS, BOSTON_AFFORDANCES } from "../missions.js";
import { BASE_REACH, abilityGapBand, abilityReach } from "../reach.js";

const CONTEXT = {
  round: 1,
  tick: 100,
  selfHealth: 100,
  selfHealthFraction: 1,
  ammoRemaining: 3,
  hasLineOfSightToOpponent: true,
  grounded: true,
};

test("eight abilities, unique ids, in ascending unlock order", () => {
  assert.equal(BOSTON_ABILITIES.length, 8);
  const ids = new Set(BOSTON_ABILITIES.map((ability) => ability.abilityId));
  assert.equal(ids.size, BOSTON_ABILITIES.length);
  for (let index = 1; index < BOSTON_ABILITIES.length; index += 1) {
    assert.ok(
      BOSTON_ABILITIES[index]!.unlockedAtLevel >
        BOSTON_ABILITIES[index - 1]!.unlockedAtLevel,
      "unlock Levels are distinct and ascending, so the drip never doubles up",
    );
  }
  assert.deepEqual(
    BOSTON_ABILITIES.map((ability) => ability.unlockedAtLevel),
    [3, 5, 7, 8, 11, 15, 21, 27],
  );
});

test("ability ids follow the chapter's namespace convention", () => {
  for (const ability of BOSTON_ABILITIES) {
    assert.match(ability.abilityId, /^BOS\.ABILITY\.[A-Z_]+\.v\d+$/);
    // StableId in @pa/contracts: letters, digits, dot, colon, dash, underscore.
    assert.match(ability.abilityId, /^[A-Za-z0-9._:-]+$/);
    assert.ok(ability.name.length > 0);
    assert.ok(ability.fiction.length > 0);
    assert.equal(bostonAbility(ability.abilityId), ability);
  }
  assert.equal(bostonAbility("BOS.ABILITY.NOT_REAL.v1"), undefined);
});

test("one use per encounter, and the mission number is the duel's number", () => {
  assert.equal(ABILITY_USES_PER_MISSION, ABILITY_USES_PER_DUEL);
  assert.equal(ABILITY_USES_PER_MISSION, 1);
  for (const ability of BOSTON_ABILITIES) {
    assert.equal(ability.usesPerMission, 1);
    // The descriptor has no field to ask for more, which is the point.
    assert.equal("usesPerDuel" in ability, false);
  }
});

test("every effect window fits inside one 20-second engagement", () => {
  for (const ability of BOSTON_ABILITIES) {
    assert.ok(
      fitsInsideOneRound(ability),
      `${ability.abilityId} spills past the round boundary`,
    );
  }
  // The shortest is the movement burst window; the longest is the long,
  // mild concealment.
  assert.equal(LONG_STRIDE.durationTicks, ticks(1.6));
  assert.equal(LONGCOAT_HUSH.durationTicks, ticks(8));
});

test("only three abilities refuse themselves, and each for a hard reason", () => {
  const refusing = BOSTON_ABILITIES.filter(
    (ability) => !ability.canInvoke(CONTEXT) || !ability.canInvoke({ ...CONTEXT, grounded: false }),
  );
  assert.deepEqual(
    refusing.map((ability) => ability.abilityId).sort(),
    [FARSIGHT, KITE_STEP, LONG_STRIDE].map((a) => a.abilityId).sort(),
  );

  // Grounded-only, because beginDash refuses an airborne burst and canInvoke
  // must not promise what the engine will decline.
  for (const ability of [LONG_STRIDE, KITE_STEP]) {
    assert.equal(ability.canInvoke({ ...CONTEXT, grounded: true }), true);
    assert.equal(ability.canInvoke({ ...CONTEXT, grounded: false }), false);
  }

  // Refuses when it would be provably wasted: seeing through cover you are not
  // behind spends the single use for nothing.
  assert.equal(FARSIGHT.canInvoke({ ...CONTEXT, hasLineOfSightToOpponent: true }), false);
  assert.equal(FARSIGHT.canInvoke({ ...CONTEXT, hasLineOfSightToOpponent: false }), true);

  for (const ability of [WARD_CHIME, LONGCOAT_HUSH, HOLD_FAST, POWDER_DAMP, OUT_OF_TIME]) {
    assert.equal(ability.canInvoke(CONTEXT), true);
    assert.equal(ability.canInvoke({ ...CONTEXT, grounded: false }), true);
  }
});

test("the same predicate accepts a mission-built context", () => {
  const grounded = missionInvocationContext({
    tick: 900,
    motion: { grounded: true },
    nearestWatcherHasLineOfSight: false,
  });
  const airborne = missionInvocationContext({
    tick: 900,
    motion: { grounded: false },
    nearestWatcherHasLineOfSight: false,
  });
  // Field for field the shape combat.ts builds, so canInvoke cannot behave
  // differently between the two encounters.
  assert.deepEqual(Object.keys(grounded).sort(), Object.keys(CONTEXT).sort());
  assert.equal(LONG_STRIDE.canInvoke(grounded), true);
  assert.equal(LONG_STRIDE.canInvoke(airborne), false);
  assert.equal(FARSIGHT.canInvoke(grounded), true);
});

test("the movement ability is one number, and it is the duel's own channel", () => {
  const effect = LONG_STRIDE.effectAt(0);
  assert.equal(effect.duel.selfMoveSpeedScale, 1.7);
  // Nothing in the world half: every metre it produces comes from the shared
  // integrator reading the duel's velocity scale.
  assert.deepEqual(effect.world, {
    selfVisibilityScale: 1,
    selfJumpVelocityScale: 1,
    staggerRecoveryScale: 1,
    diversionAttentionScale: 1,
    carriedEvidenceConcealed: false,
  });

  // The section 18.5 claim, answered by the engine's own gap solver rather than by
  // a ratio computed beside it. A ratio would have said 1.70x; the truth is ~1.83x,
  // because the takeoff setback and the capsule radius come off every gap as
  // constants and a constant is a bigger fraction of a short gap than a long one.
  const reach = abilityReach(LONG_STRIDE);
  assert.ok(reach.boostedRunSpeedMps > BASE_REACH.runSpeedMps * 1.6);
  assert.ok(reach.boostedRunSpeedMps < 8, "still a human being");
  assert.ok(
    reach.boostedFlatGapM > BASE_REACH.maxFlatGapM * 1.7,
    `a 1.7x approach opened ${reach.boostedFlatGapM.toFixed(2)}m against a ${BASE_REACH.maxFlatGapM.toFixed(2)}m base`,
  );
  assert.ok(reach.gapGainM > 2.5, "roughly three metres of new gap");

  // And the band a section 18.5 crossing has to sit inside to be a shortcut rather
  // than a wall: wider than level design may author for Level 0, no wider than the
  // ability delivers.
  const band = abilityGapBand(LONG_STRIDE);
  assert.ok(band.floorM >= BASE_REACH.levelDesignMaxFlatGapM);
  assert.ok(band.ceilingM > band.floorM + 2, "a band worth authoring inside");
});

test("the height ability reaches a second-storey sill from a low prop", () => {
  const reach = abilityReach(KITE_STEP);
  // The scale reported is the one the engine will actually honour, after its clamp.
  assert.equal(reach.jumpLaunchScale, 1.45);
  assert.ok(reach.boostedStandingApexM > 2.5 && reach.boostedStandingApexM < 2.8);
  assert.ok(reach.apexGainM > 1.3, "more than a metre of new height");

  // Base climb already reaches 3.2m, so the ability only matters where there is
  // nothing to climb: from a ~1.5m prop this clears a ~4m sill and base does not.
  assert.ok(1.5 + reach.boostedStandingApexM > 4);
  assert.ok(1.5 + BASE_REACH.standingApexM < 3);
  assert.ok(
    reach.boostedStandingApexM + 1.5 > BASE_REACH.maxClimbHeightM,
    "and it beats a plain climb, or there would be no reason to spend it",
  );
});

test("abilities never touch the bullet economy", () => {
  assert.doesNotThrow(assertAbilityCannotGrantVerbs);
  for (const ability of BOSTON_ABILITIES) {
    const modifiers = ability.modifiersAt(0) as unknown as Record<string, unknown>;
    for (const forbidden of ["ammo", "bullets", "magazine", "ammoBonus"]) {
      assert.equal(forbidden in modifiers, false);
    }
  }
});

test("the concealment ladder is strictly ordered, and the strongest is the shortest", () => {
  const hush = LONGCOAT_HUSH.effectAt(0);
  const gone = OUT_OF_TIME.effectAt(0);
  assert.ok(gone.world.selfVisibilityScale < hush.world.selfVisibilityScale);
  assert.equal(gone.world.selfVisibilityScale, 0);
  assert.ok(
    OUT_OF_TIME.durationTicks < LONGCOAT_HUSH.durationTicks,
    "a total break pays for itself with brevity",
  );
  assert.ok(OUT_OF_TIME.unlockedAtLevel > LONGCOAT_HUSH.unlockedAtLevel);

  const defence = [LONGCOAT_HUSH, HOLD_FAST, OUT_OF_TIME].map(
    (ability) => ability.effectAt(0).duel.selfIncomingDamageScale,
  );
  assert.deepEqual(defence, [0.75, 0.35, 0]);
});

test("every §18 affordance has an ability, and no ability duplicates a base verb", () => {
  for (const affordanceId of AFFORDANCE_IDS) {
    const serving = BOSTON_ABILITIES.filter((ability) =>
      ability.affordanceIds.includes(affordanceId),
    );
    assert.ok(serving.length > 0, `${affordanceId} has nothing serving it`);
  }
  // The thrown-diversion ability SCALES the base object rather than replacing it,
  // which is the difference between an amplifier and a fork of the primitive.
  assert.equal(WARD_CHIME.effectAt(0).world.diversionAttentionScale, 2.5);
  assert.equal(
    BOSTON_AFFORDANCES.ATTENTION_RELOCATION.abilityFreeRoute.includes("base thrown diversion"),
    true,
  );
});

test("the front half serves the affordance schedule, the back half serves the duel", () => {
  const front = BOSTON_ABILITIES.filter((ability) => ability.unlockedAtLevel <= 11);
  const back = BOSTON_ABILITIES.filter((ability) => ability.unlockedAtLevel > 11);
  assert.equal(front.length, 5);
  assert.equal(back.length, 3);
  for (const ability of front) {
    assert.equal(
      ability.affordanceIds.length,
      1,
      `${ability.abilityId} should serve exactly one §18 affordance`,
    );
  }
  // Two of the back three touch no mission affordance at all — that half of
  // AbilityModifiers (damage, rate of fire, perception) is untouched by the
  // slate, so it is free design space for the encounter PvP reuses verbatim.
  const noAffordance = BOSTON_ABILITIES.filter(
    (ability) => ability.affordanceIds.length === 0,
  );
  assert.deepEqual(
    noAffordance.map((ability) => ability.abilityId),
    [POWDER_DAMP.abilityId, FARSIGHT.abilityId],
  );
  for (const ability of noAffordance) assert.ok(ability.unlockedAtLevel >= 15);
});

test("the channel registry covers every field of both halves", () => {
  const duelKeys = Object.keys(WARD_CHIME.effectAt(0).duel).sort();
  const worldKeys = Object.keys(WARD_CHIME.effectAt(0).world).sort();
  const registered = (half: "duel" | "world") =>
    ABILITY_CHANNELS.filter((channel) => channel.half === half)
      .map((channel) => channel.channel)
      .sort();
  assert.deepEqual(registered("duel"), duelKeys);
  assert.deepEqual(registered("world"), worldKeys);
});

test("every authored ability touches at least one channel", () => {
  for (const ability of BOSTON_ABILITIES) {
    const effect = ability.effectAt(0);
    const touches =
      effect.duel.selfMoveSpeedScale !== 1 ||
      effect.duel.selfIncomingDamageScale !== 1 ||
      effect.duel.opponentMoveSpeedScale !== 1 ||
      effect.duel.opponentFireIntervalScale !== 1 ||
      effect.duel.revealsOpponentThroughCover ||
      effect.world.selfVisibilityScale !== 1 ||
      effect.world.selfJumpVelocityScale !== 1 ||
      effect.world.staggerRecoveryScale !== 1 ||
      effect.world.diversionAttentionScale !== 1 ||
      effect.world.carriedEvidenceConcealed;
    assert.ok(touches, `${ability.abilityId} does nothing`);
  }
});

test("every ability has a live duel effect, so no PvP slot is ever dead", () => {
  for (const ability of BOSTON_ABILITIES) {
    const duel = ability.effectAt(0).duel;
    const touchesDuel =
      duel.selfMoveSpeedScale !== 1 ||
      duel.selfIncomingDamageScale !== 1 ||
      duel.opponentMoveSpeedScale !== 1 ||
      duel.opponentFireIntervalScale !== 1 ||
      duel.revealsOpponentThroughCover;
    assert.ok(touchesDuel, `${ability.abilityId} is inert in a duel`);
  }
});
