// M1's symmetric-complement boss: the ammo award and the firing schedule.
//
// Two properties, proven together because they are the two halves of the owner's
// requirement — "the boss uses the same 14/7 allocation in the opposite direction"
// and "it must keep fighting with its awarded ammo rather than becoming inert".

import { test } from "node:test";
import assert from "node:assert/strict";
import { openArena, referenceArena } from "../arena.js";
import { bossProfileForTier } from "../boss.js";
import { complementaryBossBullets } from "../bullets.js";
import {
  IDLE_INTENT,
  combatView,
  createCombatState,
  loadMagazine,
  playerParams,
  type CombatState,
} from "../combat.js";
import { FIELD_DT } from "../engine.js";
import type { DuelEvent } from "../events.js";
import {
  createDuel,
  currentAmmo,
  reduceDuel,
  roundAmmoSources,
  type DuelState,
} from "../machine.js";
import { bossIntent } from "../policy.js";
import { BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG } from "../tuning.js";
import { mintVerdict, type VerdictKind } from "../verdict.js";
import { questionSet, runDuel, verdictFor } from "./harness.js";

const arena = referenceArena();
const complementBoss = bossProfileForTier(1, "BOSS.M1", {
  ammoPolicy: "SYMMETRIC_COMPLEMENT",
});
const flatBoss = bossProfileForTier(1, "BOSS.FLAT", { ammoPolicy: "AUTHORED_FLAT" });

function start(profile = complementBoss) {
  return createDuel({
    duelId: "TEST",
    seed: 4242,
    world: arena.world,
    opponent: { kind: "BOSS", profile },
    questions: questionSet(),
    placement: arena.placement,
  });
}

/** Advance one fixed step at a time until the phase changes. */
function advanceUntilPhaseChange(from: DuelState, limit = 5000): DuelState {
  let state = from;
  for (let i = 0; i < limit; i++) {
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT });
    if (!result.ok) throw new Error(result.rejection.code);
    state = result.state;
    if (state.phase !== from.phase) return state;
  }
  throw new Error(`phase ${from.phase} never advanced`);
}

/** Drive one round to BULLETS_GRANTED with the player's verdict, return ammo. */
function ammoAfter(kind: VerdictKind, profile = complementBoss) {
  const question = advanceUntilPhaseChange(start(profile).state);
  if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
  const committed = reduceDuel(question, {
    kind: "COMMIT_VERDICT",
    side: "A",
    verdict: verdictFor(kind, question.item, "A", 1),
  });
  if (!committed.ok) throw new Error("verdict rejected");
  const granted = reduceDuel(committed.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
  if (!granted.ok || granted.state.phase !== "BULLETS_GRANTED") {
    throw new Error("expected bullets granted");
  }
  return { state: granted.state, ammo: currentAmmo(granted.state) };
}

// ---- the award --------------------------------------------------------------

test("complementaryBossBullets is exactly the mirror of the player's award", () => {
  assert.equal(complementaryBossBullets("CORRECT"), BULLETS_FOR_WRONG);
  assert.equal(complementaryBossBullets("WRONG"), BULLETS_FOR_CORRECT);
  // The two magazines always sum to the same total, whichever way the answer went.
  assert.equal(
    complementaryBossBullets("CORRECT") + BULLETS_FOR_CORRECT,
    complementaryBossBullets("WRONG") + BULLETS_FOR_WRONG,
  );
});

test("a correct answer arms the player 14 and the boss 7", () => {
  const { ammo } = ammoAfter("CORRECT");
  assert.equal(ammo.A, BULLETS_FOR_CORRECT, "player earns 14 for a correct answer");
  assert.equal(ammo.B, BULLETS_FOR_WRONG, "the complement boss earns 7");
});

test("a wrong answer arms the player 7 and the boss 14", () => {
  const { ammo } = ammoAfter("WRONG");
  assert.equal(ammo.A, BULLETS_FOR_WRONG, "player earns 7 for a wrong answer");
  assert.equal(ammo.B, BULLETS_FOR_CORRECT, "a wrong answer arms the boss with 14");
});

test("a flat boss ignores the player's verdict, as its tuning requires", () => {
  assert.equal(ammoAfter("CORRECT", flatBoss).ammo.B, flatBoss.magazinePerRound);
  assert.equal(ammoAfter("WRONG", flatBoss).ammo.B, flatBoss.magazinePerRound);
});

test("roundAmmoSources derives the boss magazine from the committed verdict", () => {
  const config = start().state.config;
  const correct = mintVerdict({ kind: "CORRECT", itemId: "X", itemVersion: "v1", source: "CLASSIFIER" });
  const wrong = mintVerdict({ kind: "WRONG", itemId: "X", itemVersion: "v1", source: "CLASSIFIER" });
  assert.deepEqual(roundAmmoSources(config, [{ side: "A", verdict: correct }]).B, {
    kind: "AUTHORED",
    bullets: BULLETS_FOR_WRONG,
  });
  assert.deepEqual(roundAmmoSources(config, [{ side: "A", verdict: wrong }]).B, {
    kind: "AUTHORED",
    bullets: BULLETS_FOR_CORRECT,
  });
  // The player's own source is always its verdict, never an authored number.
  assert.deepEqual(roundAmmoSources(config, [{ side: "A", verdict: correct }]).A, {
    kind: "VERDICT",
    verdict: "CORRECT",
  });
});

// ---- exactly once -----------------------------------------------------------

test("a replayed verdict cannot double-arm either magazine", () => {
  const question = advanceUntilPhaseChange(start().state);
  if (question.phase !== "QUESTION_PENDING") throw new Error("expected a question");
  const verdict = verdictFor("WRONG", question.item, "A", 1);
  const first = reduceDuel(question, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.state.phase, "VERDICT_COMMITTED");
  // The verdict has already landed; the phase has moved on. A replayed delivery —
  // a retried fetch, a StrictMode double-invoke — is refused, not re-applied.
  const replay = reduceDuel(first.state, { kind: "COMMIT_VERDICT", side: "A", verdict });
  assert.equal(replay.ok, false);
  if (!replay.ok) assert.equal(replay.rejection.code, "COMMAND_NOT_LEGAL_IN_PHASE");

  const granted = reduceDuel(first.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
  if (!granted.ok || granted.state.phase !== "BULLETS_GRANTED") throw new Error("expected grant");
  assert.equal(currentAmmo(granted.state).A, BULLETS_FOR_WRONG);
  assert.equal(currentAmmo(granted.state).B, BULLETS_FOR_CORRECT);
  // Advancing again does not re-grant: the magazine only holds one round's award.
  const again = reduceDuel(granted.state, { kind: "ADVANCE", frameDtS: FIELD_DT });
  if (!again.ok) throw new Error("advance rejected");
  assert.ok(currentAmmo(again.state).B <= BULLETS_FOR_CORRECT, "no second grant stacked on");
});

test("the same seed and verdicts replay both magazines identically (resume is exact)", () => {
  // A resume/refresh rebuilds the runtime from the seed and the committed verdicts.
  // Determinism is what makes that safe: the same inputs restore the same two
  // magazines rather than re-awarding or drifting.
  const options = {
    opponent: { kind: "BOSS", profile: complementBoss } as const,
    verdicts: (_side: "A" | "B", round: number) => (round % 2 === 1 ? "CORRECT" : "WRONG") as VerdictKind,
    roundCeiling: 3,
    intents: () => IDLE_INTENT,
    seed: 20260727,
  };
  const a = runDuel(options);
  const b = runDuel(options);
  const magsB = (log: readonly DuelEvent[]) =>
    log.filter((e) => e.type === "BULLETS_GRANTED" && e.side === "B").map((e) => (e.type === "BULLETS_GRANTED" ? e.grant.magazine : 0));
  assert.deepEqual(magsB(a.log), magsB(b.log));
  assert.deepEqual(magsB(a.log), [BULLETS_FOR_WRONG, BULLETS_FOR_CORRECT, BULLETS_FOR_WRONG]);
});

// ---- the firing schedule ----------------------------------------------------

const openWorld = openArena().world;

function viewWith(patch: { ammoB?: number; healthBFraction?: number }) {
  // A minimal open-field combat state: the two fighters face each other with a
  // clear line and no cover, so LOS is true and the only variables are ammo and
  // health.
  let state: CombatState = createCombatState(
    { A: playerParams(), B: playerParams() },
    { A: { pos: { x: 0, y: 0, z: -5 }, yaw: 0 }, B: { pos: { x: 0, y: 0, z: 5 }, yaw: Math.PI } },
  );
  state = loadMagazine(state, "B", patch.ammoB ?? 3);
  if (patch.healthBFraction !== undefined) {
    state = {
      ...state,
      fighters: {
        ...state.fighters,
        B: { ...state.fighters.B, health: complementBoss.maxHealth * patch.healthBFraction },
      },
    };
  }
  return combatView(openWorld, state, "B");
}

test("with ammo and a clear line the boss fires — even wounded, it never goes inert", () => {
  for (const healthBFraction of [1, 0.2]) {
    const view = viewWith({ ammoB: 5, healthBFraction });
    const decision = bossIntent(complementBoss, view, 1);
    assert.equal(
      decision.fire,
      true,
      `a boss at ${healthBFraction * 100}% health with 5 balls and a clear shot must fire`,
    );
  }
});

test("out of ammo the boss does not fire — truthful, not inert-with-a-loaded-pistol", () => {
  const view = viewWith({ ammoB: 0 });
  assert.equal(bossIntent(complementBoss, view, 1).fire, false);
});

test("while alive, in ammo and with a target, the boss's fire gap stays bounded", () => {
  // The scheduler property. Drive a full engagement with an idle player and assert
  // the boss never leaves a gap longer than one reload interval between shots while
  // it still holds ammo — i.e. it never enters an unbounded idle with ammo. On a
  // wrong round it is armed with 14, which a 20s round cannot even fully discharge,
  // so the whole window is live fire.
  const result = runDuel({
    opponent: { kind: "BOSS", profile: complementBoss },
    verdicts: () => "WRONG",
    roundCeiling: 1,
    intents: () => IDLE_INTENT,
  });
  const shots = result.log.filter(
    (e): e is Extract<DuelEvent, { type: "SHOT_FIRED" }> => e.type === "SHOT_FIRED" && e.side === "B",
  );
  assert.ok(shots.length >= 12, `boss fired only ${shots.length} of its 14 balls in a full round`);
  const interval = complementBoss.fireIntervalTicks;
  for (let i = 1; i < shots.length; i++) {
    const gap = shots[i]!.tick - shots[i - 1]!.tick;
    assert.ok(
      gap <= interval + 1,
      `boss left ${gap} ticks between shots ${i - 1} and ${i}, above the ${interval}-tick cadence: that is the "randomly stops shooting" pause`,
    );
  }
});

test("the boss decrements ammo exactly once per shot, and the count matches the events", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: complementBoss },
    verdicts: () => "WRONG",
    roundCeiling: 1,
    intents: () => IDLE_INTENT,
  });
  const shots = result.log.filter((e) => e.type === "SHOT_FIRED" && e.side === "B").length;
  const broke = result.log.find((e) => e.type === "LINE_OF_SIGHT_BROKEN");
  assert.ok(broke && broke.type === "LINE_OF_SIGHT_BROKEN");
  // Awarded 14, fired `shots`, and the unspent count the machine reports is exactly
  // the remainder — no ball invented, none lost.
  assert.equal(broke.unspentB, BULLETS_FOR_CORRECT - shots);
});

// ---- the full alternating sequence -----------------------------------------

test("across alternating answers the boss consumes 7 then 14 and keeps shooting", () => {
  const result = runDuel({
    opponent: { kind: "BOSS", profile: complementBoss },
    verdicts: (_side, round) => (round % 2 === 1 ? "CORRECT" : "WRONG"),
    roundCeiling: 4,
    intents: () => IDLE_INTENT,
  });
  const mags = result.log
    .filter((e) => e.type === "BULLETS_GRANTED" && e.side === "B")
    .map((e) => (e.type === "BULLETS_GRANTED" ? e.grant.magazine : 0));
  assert.deepEqual(mags, [
    BULLETS_FOR_WRONG,
    BULLETS_FOR_CORRECT,
    BULLETS_FOR_WRONG,
    BULLETS_FOR_CORRECT,
  ]);
  // And it actually spends them: every round has boss fire, none is a silent round.
  for (const round of [1, 2, 3, 4]) {
    const fired = result.log.filter(
      (e) => e.type === "SHOT_FIRED" && e.side === "B" && e.round === round,
    ).length;
    assert.ok(fired > 0, `boss fired nothing in round ${round}`);
  }
});
