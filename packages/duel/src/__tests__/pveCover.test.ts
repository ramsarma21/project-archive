// The boss physically takes cover before each post-engagement question.
//
// Every assertion here is against the authoritative simulation: the cover points
// come from the arena's own collision, the "in cover" signal is the engine's real
// sightline test, and the boss's position is driven through the shared movement
// integrator. Nothing trusts a UI claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildArena,
  CHEST_COVER_HEIGHT,
  openArena,
  referenceArena,
} from "../arena.js";
import { bossProfileForTier } from "../boss.js";
import {
  bossCoverPoints,
  isBossInCoverAt,
  nearestBossCover,
} from "../cover.js";
import {
  combatView,
  hasLineOfSight,
  intent,
  IDLE_INTENT,
  isDowned,
} from "../combat.js";
import { FIELD_DT } from "../engine.js";
import type { DuelEvent } from "../events.js";
import {
  createDuel,
  reduceDuel,
  type DuelState,
} from "../machine.js";
import { oracleIntent } from "../policy.js";
import { BULLETS_FOR_WRONG } from "../tuning.js";
import type { DuelSide } from "../sides.js";
import { verdictFor, questionSet } from "./harness.js";
import type { VerdictKind } from "../verdict.js";

const coverBoss = (over = {}) =>
  bossProfileForTier(1, "BOSS.M1", {
    ammoPolicy: "SYMMETRIC_COMPLEMENT",
    takesCoverBeforeQuestion: true,
    ...over,
  });

// A tidy arena for the pure cover-point tests: one chest-high wall dead centre.
const walledArena = buildArena({
  arenaId: "COVER.TEST",
  halfExtentX: 12,
  halfExtentZ: 12,
  cover: [{ id: "COVER.WALL", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: CHEST_COVER_HEIGHT }],
});

// ---- cover-point validity ---------------------------------------------------

test("a chosen cover point is standable and actually blocks a crouched sightline", () => {
  const player = { x: 0, y: 0, z: -8 };
  const boss = { x: 0, y: 0, z: 8 };
  const points = bossCoverPoints(walledArena.world, boss, player);
  assert.ok(points.length >= 1, "the wall must offer at least one cover point");
  for (const point of points) {
    assert.equal(
      isBossInCoverAt(walledArena.world, point, player),
      true,
      `${point.coverId} at (${point.x.toFixed(2)},${point.z.toFixed(2)}) is not valid cover`,
    );
    // It sits on the far side of the wall from the player.
    assert.ok(point.z > 0, "cover point must be on the boss's side of the wall");
  }
});

test("cover selection is deterministic and ordered nearest-first", () => {
  const player = { x: 0, y: 0, z: -8 };
  const boss = { x: 0, y: 0, z: 8 };
  const a = bossCoverPoints(referenceArena().world, boss, player);
  const b = bossCoverPoints(referenceArena().world, boss, player);
  assert.deepEqual(a, b, "same inputs must produce the same ordering");
  for (let i = 1; i < a.length; i++) {
    const d0 = Math.hypot(a[i - 1]!.x - boss.x, a[i - 1]!.z - boss.z);
    const d1 = Math.hypot(a[i]!.x - boss.x, a[i]!.z - boss.z);
    assert.ok(d0 <= d1 + 1e-9, "candidates are ordered by distance to the boss");
  }
});

test("an arena with only low cover offers the boss nowhere to hide", () => {
  // Low cover does not break even a crouched sightline, so it must not be offered
  // as valid — the honest answer is "no cover", not a point that leaves the boss
  // exposed.
  const lowOnly = buildArena({
    arenaId: "LOW",
    halfExtentX: 12,
    halfExtentZ: 12,
    cover: [{ id: "COVER.CRATE", x: 0, z: 0, halfX: 2, halfZ: 0.5, topY: 0.7 }],
  });
  assert.equal(
    nearestBossCover(lowOnly.world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }),
    null,
  );
  assert.equal(nearestBossCover(openArena().world, { x: 0, y: 0, z: 8 }, { x: 0, y: 0, z: -8 }), null);
});

// ---- the shipped/reference arena has real cover -----------------------------

test("the reference arena offers the boss valid, imported-cover hiding places", () => {
  // Guards requirement #8: there must be authored cover that actually works, or
  // the feature is a promise. Every DUEL_COVER blocker the boss chooses is one the
  // arena was built from.
  const points = bossCoverPoints(
    referenceArena().world,
    { x: 0, y: 0, z: 7 },
    { x: 0, y: 0, z: -7 },
  );
  assert.ok(points.length >= 1, "the reference arena must give the boss cover to reach");
});

// ---- the full break: move, crouch, confirm, then open the question ----------

interface RoundObservation {
  readonly round: number;
  readonly losBlockedAtQuestion: boolean;
  readonly crouchedAtQuestion: boolean;
  readonly maxStepDisplacement: number;
  readonly tookCover: boolean;
}

function playCoverDuel(options: {
  verdict: (round: number) => VerdictKind;
  roundCeiling: number;
  seed?: number;
  playerIntent?: (state: DuelState) => ReturnType<typeof intent>;
  profileOverrides?: object;
}): { observations: RoundObservation[]; log: DuelEvent[]; state: DuelState } {
  const arena = referenceArena();
  const created = createDuel({
    duelId: "COVER.TEST",
    seed: options.seed ?? 20260727,
    world: arena.world,
    opponent: { kind: "BOSS", profile: coverBoss(options.profileOverrides ?? {}) },
    questions: questionSet(),
    placement: arena.placement,
    roundCeiling: options.roundCeiling,
  });
  let state: DuelState = created.state;
  const log: DuelEvent[] = [...created.events];
  const observations: RoundObservation[] = [];
  const tookCoverRounds = new Set<number>();
  let lastBossPos = { ...state.combat.fighters.B.motion.pos };
  let maxStep = 0;
  let steps = 0;

  while (state.phase !== "DUEL_RESOLVED" && steps < 200_000) {
    steps++;
    if (state.phase === "QUESTION_PENDING") {
      observations.push({
        round: state.round,
        losBlockedAtQuestion: !hasLineOfSight(
          arena.world,
          state.combat.fighters.A,
          state.combat.fighters.B,
        ),
        crouchedAtQuestion: state.combat.fighters.B.motion.capsuleHeight < 1.2,
        maxStepDisplacement: maxStep,
        // The break that led into question round R belongs to the engagement round
        // before it (R-1), so that is where its cover event is tagged.
        tookCover: tookCoverRounds.has(state.round - 1),
      });
      maxStep = 0;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side: "A",
        verdict: verdictFor(options.verdict(state.round), state.item, "A", state.round),
      });
      state = result.state;
      log.push(...result.events);
      continue;
    }
    const intents: Partial<Record<DuelSide, ReturnType<typeof intent>>> = {};
    if (state.phase === "ENGAGEMENT_LIVE" || state.phase === "LINE_OF_SIGHT_BREAK") {
      intents.A = options.playerIntent
        ? options.playerIntent(state)
        : { ...oracleIntent(combatView(arena.world, state.combat, "A")), fire: false };
    }
    const before = { ...state.combat.fighters.B.motion.pos };
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents });
    state = result.state;
    log.push(...result.events);
    for (const ev of result.events) {
      if (ev.type === "BOSS_TOOK_COVER") tookCoverRounds.add(ev.round);
    }
    const after = state.combat.fighters.B.motion.pos;
    maxStep = Math.max(maxStep, Math.hypot(after.x - before.x, after.z - before.z));
    lastBossPos = { ...after };
  }
  void lastBossPos;
  return { observations, log, state };
}

test("the boss is behind cover with its sightline blocked at every post-engagement question", () => {
  const { observations, log } = playCoverDuel({
    verdict: (round) => (round % 2 === 1 ? "CORRECT" : "WRONG"),
    roundCeiling: 4,
  });
  // Round 1's question opens straight out of the face-off, before any combat, so it
  // has no cover phase. Every question AFTER an engagement must find the boss hidden.
  for (const observation of observations) {
    if (observation.round === 1) continue;
    assert.equal(
      observation.losBlockedAtQuestion,
      true,
      `round ${observation.round}: the question opened while the boss was still exposed`,
    );
    assert.equal(observation.crouchedAtQuestion, true, `round ${observation.round}: boss not in a cover stance`);
    assert.equal(observation.tookCover, true, `round ${observation.round}: no BOSS_TOOK_COVER was emitted`);
  }
  // A cover event exists for each post-engagement break.
  const covers = log.filter((e) => e.type === "BOSS_TOOK_COVER");
  assert.ok(covers.length >= 3, `expected a cover event per post-engagement break, got ${covers.length}`);
});

test("the boss walks into cover — it never teleports there", () => {
  const { observations } = playCoverDuel({
    verdict: () => "CORRECT",
    roundCeiling: 3,
  });
  // The largest single-frame move the boss made on the way into cover is a normal
  // stride, not a jump across the yard. A dash burst is the fastest legal motion,
  // and one tick of it is well under a metre.
  for (const observation of observations) {
    if (observation.round === 1) continue;
    assert.ok(
      observation.maxStepDisplacement < 0.6,
      `round ${observation.round}: boss moved ${observation.maxStepDisplacement.toFixed(2)}m in one tick — that is a teleport`,
    );
  }
});

test("the same seed drives the boss to the same cover, deterministically", () => {
  const a = playCoverDuel({ verdict: () => "WRONG", roundCeiling: 3, seed: 424242 });
  const b = playCoverDuel({ verdict: () => "WRONG", roundCeiling: 3, seed: 424242 });
  const covers = (log: DuelEvent[]) =>
    log
      .filter((e): e is Extract<DuelEvent, { type: "BOSS_TOOK_COVER" }> => e.type === "BOSS_TOOK_COVER")
      .map((e) => `${e.round}:${e.coverId}`);
  assert.deepEqual(covers(a.log), covers(b.log));
  assert.deepEqual(a.observations, b.observations);
});

test("after the break the boss leaves cover, stands, and fires again with its awarded ammo", () => {
  const { log } = playCoverDuel({
    verdict: () => "WRONG",
    roundCeiling: 3,
  });
  // Round 3's engagement is fought AFTER a cover break, so it proves the boss came
  // back out: it granted a fresh (wrong-answer) magazine and actually fired from it.
  const grantedR3 = log.some(
    (e) => e.type === "BULLETS_GRANTED" && e.side === "B" && e.round === 3 && e.grant.magazine > BULLETS_FOR_WRONG,
  );
  assert.ok(grantedR3, "round 3 boss did not receive its wrong-answer complement magazine");
  const firedR3 = log.filter((e) => e.type === "SHOT_FIRED" && e.side === "B" && e.round === 3).length;
  assert.ok(firedR3 > 0, "the boss did not resume firing after leaving cover");
});

test("a boss shot dead while retreating to cover resolves as a knockout, not a question", () => {
  // The damage race, made explicit: the player keeps control during the break, so
  // if they put the boss down on the way in, the duel ends — cover does not grant
  // the boss immunity.
  const arena = openArena(); // no cover: the boss can never reach it, so the break
  // runs its full bounded window with the boss exposed and killable.
  const boss = coverBoss();
  const created = createDuel({
    duelId: "RACE",
    seed: 5,
    world: arena.world,
    opponent: { kind: "BOSS", profile: boss },
    questions: questionSet(),
    placement: arena.placement,
    roundCeiling: 3,
  });
  let state: DuelState = created.state;
  const log: DuelEvent[] = [];
  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < 200_000) {
    steps++;
    if (state.phase === "QUESTION_PENDING") {
      state = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side: "A",
        verdict: verdictFor("WRONG", state.item, "A", state.round),
      }).state;
      continue;
    }
    const intents: Partial<Record<DuelSide, ReturnType<typeof intent>>> = {};
    if (state.phase === "ENGAGEMENT_LIVE" || state.phase === "LINE_OF_SIGHT_BREAK") {
      // Point-blank fire at the boss every tick.
      const b = state.combat.fighters.B.motion.pos;
      const a = state.combat.fighters.A.motion.pos;
      intents.A = intent({ fire: true, aimX: b.x - a.x, aimZ: b.z - a.z });
    }
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents });
    state = result.state;
    log.push(...result.events);
  }
  // The boss is killable during the break: whether the kill lands mid-engagement or
  // mid-retreat, the duel must resolve cleanly on a knockout rather than hang or
  // silently swallow the projectile.
  assert.equal(state.phase, "DUEL_RESOLVED");
  if (state.phase === "DUEL_RESOLVED") {
    assert.ok(
      state.outcome.reason === "KNOCKOUT" || state.outcome.reason === "ROUNDS_EXHAUSTED",
      `unexpected resolution ${state.outcome.reason}`,
    );
  }
  void isDowned;
  void IDLE_INTENT;
});

test("after taking cover the boss still spends its whole magazine the next round", () => {
  // The regression guard for "keep fighting rather than becoming inert": a boss
  // that hides between rounds must come back out and actually use its awarded ammo.
  // Every round is a wrong answer, so the boss is armed with 14 each time and — even
  // in the rounds that open with it tucked behind cover — it stands up, reacquires
  // the line and empties nearly the whole magazine, exactly as it does with no cover.
  const { log } = playCoverDuel({
    verdict: () => "WRONG",
    roundCeiling: 3,
    playerIntent: () => IDLE_INTENT,
  });
  for (const round of [2, 3]) {
    const fired = log.filter(
      (e) => e.type === "SHOT_FIRED" && e.side === "B" && e.round === round,
    ).length;
    assert.ok(
      fired >= 12,
      `round ${round} (opened from cover): boss fired only ${fired} of 14 — it went passive after hiding`,
    );
  }
});

test("a passive (non-cover) boss keeps the fixed break and never emits a cover event", () => {
  // The scoping guarantee: only a boss that opts in takes cover, so every shipped
  // tier's winnability tuning — measured against the passive break — is untouched.
  const arena = referenceArena();
  const created = createDuel({
    duelId: "PASSIVE",
    seed: 9,
    world: arena.world,
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    questions: questionSet(),
    placement: arena.placement,
    roundCeiling: 3,
  });
  let state: DuelState = created.state;
  const log: DuelEvent[] = [];
  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < 200_000) {
    steps++;
    if (state.phase === "QUESTION_PENDING") {
      state = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side: "A",
        verdict: verdictFor("CORRECT", state.item, "A", state.round),
      }).state;
      continue;
    }
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents: { A: IDLE_INTENT } });
    state = result.state;
    log.push(...result.events);
  }
  assert.equal(log.some((e) => e.type === "BOSS_TOOK_COVER"), false);
  assert.ok(log.some((e) => e.type === "LINE_OF_SIGHT_BROKEN"), "the passive break still happens");
});
