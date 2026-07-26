// The identical-behaviour proof.
//
// The owner's constraint is that an ability behaves the same in a parkour mission
// and in a duel. This file is the evidence, and it is deliberately structured so
// that none of it is a claim about two implementations agreeing:
//
//   1. `modifiersAt(t)` IS `effectAt(t).duel`, by reference.
//   2. The duel's modifier vocabulary is total — nothing this package authors is
//      dropped on the way in, and nothing the duel expects is missing.
//   3. A mission session and a duel session driven through the same tick sequence
//      produce byte-identical ledgers and byte-identical duel modifiers, because
//      they are running the same four functions out of @pa/duel.
//   4. A real duel, built by @pa/duel's own `createDuel`, accepts a Boston
//      loadout and enforces one use per ability across all six rounds.

import assert from "node:assert/strict";
import test from "node:test";

import {
  IDLE_INTENT,
  NEUTRAL_ABILITY_MODIFIERS,
  activeModifiers,
  combatView,
  createAbilityLedger,
  createDuel,
  expireAbilityEffects,
  intent,
  invokeAbility,
  mintVerdict,
  playerParams,
  reduceDuel,
  referenceArena,
  bossProfileForTier,
  type CombatIntent,
  type DuelEvent,
  type DuelState,
  type PartialIntents,
} from "@pa/duel";

import { toDuelLoadout } from "../ability.js";
import { BOSTON_ABILITIES, LONG_STRIDE, OUT_OF_TIME, WARD_CHIME } from "../boston.js";
import { BOSTON_CHAPTER_ID } from "../chapters.js";
import { FIELD_DT } from "../duelSurface.js";
import { activeWorldModifiers } from "../effects.js";
import { resolveChapterLoadout } from "../loadout.js";
import {
  createMissionAbilityState,
  invokeMissionAbility,
  missionMoveSpeedScale,
  missionOppositionSpeedScale,
  stepMissionAbilities,
} from "../missionSession.js";
import { missionInvocationContext } from "../ability.js";

const CONTEXT = {
  round: 1,
  tick: 600,
  selfHealth: 100,
  selfHealthFraction: 1,
  ammoRemaining: 3,
  hasLineOfSightToOpponent: false,
  grounded: true,
};

// ---------------------------------------------------------------------------
// 1. one authored timeline, two views of it
// ---------------------------------------------------------------------------

test("modifiersAt returns the very object effectAt produced — not a copy of it", () => {
  for (const ability of BOSTON_ABILITIES) {
    for (const elapsed of [0, 1, 30, ability.durationTicks - 1, ability.durationTicks, 9999]) {
      assert.equal(
        ability.modifiersAt(elapsed),
        ability.effectAt(elapsed).duel,
        `${ability.abilityId} at ${elapsed}: the duel must read the same object, so drift is impossible`,
      );
    }
  }
});

test("outside its window an ability is exactly neutral, in both halves", () => {
  for (const ability of BOSTON_ABILITIES) {
    for (const outside of [-1, ability.durationTicks, ability.durationTicks + 600, NaN]) {
      assert.deepEqual(ability.modifiersAt(outside), NEUTRAL_ABILITY_MODIFIERS);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. the vocabulary is total
// ---------------------------------------------------------------------------

test("the duel half is the duel's own type, field for field", () => {
  const expected = Object.keys(NEUTRAL_ABILITY_MODIFIERS).sort();
  for (const ability of BOSTON_ABILITIES) {
    assert.deepEqual(
      Object.keys(ability.effectAt(0).duel).sort(),
      expected,
      `${ability.abilityId} must carry every channel the duel reads and no extra`,
    );
  }
});

// ---------------------------------------------------------------------------
// 3. a mission runs the duel's runtime, not a second one
// ---------------------------------------------------------------------------

test("a mission session and a duel session produce identical ledgers and modifiers", () => {
  const abilities = [WARD_CHIME, LONG_STRIDE, OUT_OF_TIME];
  const loadout = toDuelLoadout(abilities);

  // The duel-shaped side: exactly the calls combat.ts makes, in that order.
  let duelLedger = createAbilityLedger(loadout);
  // The mission-shaped side, through this package's session helpers.
  let mission = createMissionAbilityState(abilities);

  const invokeAt = new Map<number, string>([
    [10, WARD_CHIME.abilityId],
    [400, LONG_STRIDE.abilityId],
    [401, LONG_STRIDE.abilityId], // already spent; both sides must refuse it
    [800, OUT_OF_TIME.abilityId],
  ]);

  for (let tick = 0; tick < 1200; tick += 1) {
    const abilityId = invokeAt.get(tick);
    const context = missionInvocationContext({
      tick,
      motion: { grounded: true },
      nearestWatcherHasLineOfSight: false,
    });

    duelLedger = expireAbilityEffects(loadout, duelLedger, tick);
    if (abilityId) {
      const outcome = invokeAbility(loadout, duelLedger, abilityId, context);
      if (outcome.ok) duelLedger = outcome.ledger;
    }

    if (abilityId) {
      const invoked = invokeMissionAbility(mission, abilityId, context);
      mission = invoked.state;
    }
    const stepped = stepMissionAbilities(mission, tick);
    mission = stepped.state;

    assert.deepEqual(
      mission.ledger,
      duelLedger,
      `ledgers diverged at tick ${tick}`,
    );
    assert.deepEqual(
      stepped.duel,
      activeModifiers(loadout, duelLedger, tick),
      `duel modifiers diverged at tick ${tick}`,
    );
  }

  // Every ability spent exactly once, in both.
  for (const ability of abilities) {
    assert.equal(mission.ledger[ability.abilityId]?.usesRemaining, 0);
  }
});

test("a mission composes the world half under the duel's own multiply-and-clamp rules", () => {
  const abilities = [WARD_CHIME, OUT_OF_TIME];
  const loadout = toDuelLoadout(abilities);
  let ledger = createAbilityLedger(loadout);
  for (const ability of abilities) {
    const outcome = invokeAbility(loadout, ledger, ability.abilityId, {
      ...CONTEXT,
      tick: 0,
    });
    assert.equal(outcome.ok, true);
    if (outcome.ok) ledger = outcome.ledger;
  }
  const world = activeWorldModifiers(loadout, ledger, 0);
  // 1 x 0 for visibility, 2.5 x 1 for the attention scale, and the boolean ORs.
  assert.equal(world.selfVisibilityScale, 0);
  assert.equal(world.diversionAttentionScale, 2.5);
  assert.equal(world.carriedEvidenceConcealed, true);

  // And the duel half of the same two effects, composed by @pa/duel itself.
  const duel = activeModifiers(loadout, ledger, 0);
  assert.equal(duel.selfIncomingDamageScale, 0);
  assert.ok(Math.abs(duel.opponentFireIntervalScale - 1.5 * 1.8) < 1e-9);
});

test("a bare DuelAbility with no world half composes to neutral rather than throwing", () => {
  // @pa/duel's contract is the minimum; this package's is a superset. A loadout
  // holding a plain duel ability must still be composable.
  const bare = {
    abilityId: "TEST.BARE.v1",
    unlockedAtLevel: 1,
    durationTicks: 60,
    canInvoke: () => true,
    modifiersAt: () => ({ ...NEUTRAL_ABILITY_MODIFIERS, selfMoveSpeedScale: 2 }),
  };
  const loadout = [bare];
  let ledger = createAbilityLedger(loadout);
  const outcome = invokeAbility(loadout, ledger, bare.abilityId, { ...CONTEXT, tick: 0 });
  assert.equal(outcome.ok, true);
  if (outcome.ok) ledger = outcome.ledger;
  assert.equal(activeModifiers(loadout, ledger, 0).selfMoveSpeedScale, 2);
  assert.equal(activeWorldModifiers(loadout, ledger, 0).selfVisibilityScale, 1);
});

test("the mission reads the self term for itself and the opponent term for patrols", () => {
  // Getting this backwards would make a disruption ability slow the player who
  // spent it. In a duel, combat.ts applies the OTHER side's opponent term.
  const abilities = [LONG_STRIDE];
  let mission = createMissionAbilityState(abilities);
  const invoked = invokeMissionAbility(mission, LONG_STRIDE.abilityId, {
    ...CONTEXT,
    tick: 0,
  });
  mission = invoked.state;
  const stepped = stepMissionAbilities(mission, 0);
  assert.equal(missionMoveSpeedScale(stepped), 1.7);
  assert.equal(missionOppositionSpeedScale(stepped), 1);
});

// ---------------------------------------------------------------------------
// 4. a real duel, built by @pa/duel
// ---------------------------------------------------------------------------

test("the real duel accepts a resolved Boston loadout", () => {
  const resolved = resolveChapterLoadout({ chapterId: BOSTON_CHAPTER_ID, level: 34 });
  const params = playerParams(resolved.duelLoadout);
  assert.equal(params.loadout.length, resolved.carried.length);
  // Same objects, widened. No conversion happened anywhere.
  assert.equal(params.loadout[0], resolved.carried[0]);
});

test("one use per ability per duel holds through the real state machine", () => {
  const arena = referenceArena();
  const ability = OUT_OF_TIME;
  const created = createDuel({
    duelId: "ABILITIES.CONFORMANCE",
    seed: 20260725,
    world: arena.world,
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    questions: Array.from({ length: 6 }, (_unused, index) => ({
      itemId: `TEST.ITEM_${index + 1}`,
      itemVersion: "v1",
      conceptId: "TEST.CONCEPT",
    })),
    placement: arena.placement,
    playerLoadout: toDuelLoadout([ability]),
  });

  let state: DuelState = created.state;
  const log: DuelEvent[] = [...created.events];
  // Try to spend the same ability on every engagement tick of every round. The
  // duel must accept exactly one of them.
  const spend: CombatIntent = intent({ abilityId: ability.abilityId });

  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < 60_000) {
    steps += 1;
    if (state.phase === "QUESTION_PENDING") {
      const side = state.awaiting[0]!;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: mintVerdict({
          kind: "CORRECT",
          itemId: state.item.itemId,
          itemVersion: state.item.itemVersion,
          source: "CLASSIFIER",
          responseRef: `resp-${side}-r${state.round}`,
        }),
      });
      assert.equal(result.ok, true);
      if (!result.ok) return;
      state = result.state;
      log.push(...result.events);
      continue;
    }
    const intents: PartialIntents = {};
    if (state.phase === "ENGAGEMENT_LIVE") {
      // combatView is called so the test exercises the same read path a client
      // would; the intent itself is fixed.
      combatView(arena.world, state.combat, "A");
      intents.A = spend;
    } else {
      intents.A = IDLE_INTENT;
    }
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    state = result.state;
    log.push(...result.events);
  }

  const invoked = log.filter(
    (event) => event.type === "ABILITY_INVOKED" && event.side === "A",
  );
  assert.equal(invoked.length, 1, "exactly one use across all six rounds");

  const refusals = log.filter(
    (event) => event.type === "ABILITY_REFUSED" && event.side === "A",
  );
  assert.ok(refusals.length > 0, "every later attempt is refused, not ignored");
  const reasons = new Set(
    refusals.map((event) =>
      event.type === "ABILITY_REFUSED" ? event.reason : "",
    ),
  );
  // While the effect runs the duel says ALREADY_ACTIVE; after it expires,
  // ALREADY_USED. Both are the duel's own reason codes.
  assert.ok(reasons.has("ALREADY_USED"));
});
