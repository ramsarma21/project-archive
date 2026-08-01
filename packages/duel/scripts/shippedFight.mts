// M1'S SHIPPED FIGHT, MEASURED. The instrument `sweep.mts` was missing.
//
//   node --import tsx scripts/shippedFight.mts
//
// `sweep.mts` drives `bossProfileForTier(tier)` in `referenceArena()` — the bare tier
// curve in a 12x12 tuning fixture with four pieces of cover. M1 ships the tier-1 curve
// PLUS three opt-ins (SYMMETRIC_COMPLEMENT ammo, cover-seeking, the ammo-aware
// tactical layer) in an 11x11 yard with eight. Both halves differ, so every number in
// that table describes a fight nobody plays.
//
// This measures the pairing as M1 ships it, and it reports two families:
//
//   BALANCE   the invariants `winnability.test.ts` enforces — does it terminate, can
//             the boss win, does a skilled player still win on wrong answers, does a
//             correct answer buy a fight rather than delete one.
//
//   TEMPO     dead air: the share of live combat in which nothing is in the air and
//             neither fighter holds a ball. Broken out by the boss's tactical state,
//             because the owner's complaint ("he just stands in the open... often
//             times he isnt even shooting") is a tempo defect and the ammo state is
//             where it lives. Reported on the correct, alternating and wrong answer
//             paths, since which path a student is on decides how much of the fight
//             the boss spends low on ammo.
//
// EVERY FIGURE IS READ OFF THE MACHINE'S OWN STATE, never a re-simulation. The boss's
// posture comes from `state.bossAi`, which is the memory the reducer itself advanced;
// its movement is the change in its body position between ticks; its dodges are
// `DODGE_STARTED` events. An instrument that re-derives the behaviour it is measuring
// can disagree with the thing that ships, which is the whole defect this file exists
// to stop repeating.

import { ropewalkYardArena } from "../src/arena.js";
import {
  M1_BOSS_OVERRIDES,
  M1_BOSS_TIER,
  bossProfileForTier,
  projectExchange,
} from "../src/boss.js";
import { bossTacticalState, type BossTacticalState } from "../src/bossAi.js";
import {
  combatView,
  intent as makeIntent,
  isDodging,
  type CombatIntent,
  type CombatView,
} from "../src/combat.js";
import { FIELD_DT, FIELD_TICK_HZ, fieldRandom } from "../src/engine.js";
import { createDuel, reduceDuel, type DuelState, type PartialIntents } from "../src/machine.js";
import { DEFAULT_ORACLE_OPTIONS, nearestThreat, oracleIntent } from "../src/policy.js";
import {
  BULLETS_FOR_WRONG,
  PLAYER_MAX_HEALTH,
  REQUIRED_WRONG_PATH_MARGIN,
} from "../src/tuning.js";
import { DUEL_ROUND_CEILING } from "../src/structure.js";
import { mintVerdict, type VerdictKind } from "../src/verdict.js";
import type { DuelQuestionRef } from "../src/events.js";
import type { DuelSide } from "../src/sides.js";

const SEEDS = [1, 7, 19, 33, 101, 512, 4242, 90210] as const;

/**
 * The wide set, and the one measurement eight seeds cannot make.
 *
 * Reaching the round ceiling is a rare per-seed event, so a rate over eight runs is
 * mostly a fact about which eight: the eight-seed set reported the backstop being hit
 * on the correct path only, while over these 32 it was hit on all three answer paths.
 * Constructed identically to `WIDE_SEEDS` in winnability.test.ts so the two agree.
 */
const WIDE_SEEDS = [
  ...SEEDS,
  ...Array.from({ length: 24 }, (_unused, index) => 1000 + index * 7919),
] as const;

/** M1's boss, exactly as the mission builds it. */
const SHIPPED = bossProfileForTier(M1_BOSS_TIER, "BOS.MD01.BOSS.MEASURED", M1_BOSS_OVERRIDES);

function bank(size = 18): readonly DuelQuestionRef[] {
  return Array.from({ length: size }, (_unused, index) => ({
    itemId: `BOS.M1.DUEL.ITEM_${index + 1}`,
    itemVersion: "v1",
    conceptId: index % 2 === 0 ? "POSTWAR_REVENUE" : "REPRESENTATION",
  }));
}

/** How a run answers its questions. `ALTERNATING` is the realistic middle. */
type AnswerPath = "CORRECT" | "WRONG" | "ALTERNATING";

function verdictOn(path: AnswerPath, round: number): VerdictKind {
  if (path === "ALTERNATING") return round % 2 === 1 ? "CORRECT" : "WRONG";
  return path;
}

/** Movement below this in one tick is a body that is not going anywhere. */
const PLANTED_EPS_M = 1e-4;

/**
 * Above this capsule height the body is standing rather than crouched. Halfway between
 * the engine's two stances, so it does not depend on either exact number.
 */
const CROUCH_STAND_SPLIT_M = 1.2;

interface RunMetrics {
  readonly died: boolean;
  readonly won: boolean;
  readonly knockout: boolean;
  readonly resolvedOnHealth: boolean;
  readonly rounds: number;
  readonly bossHealthFraction: number;
  readonly playerHealth: number;
  readonly engagementTicks: number;
  readonly deadTicks: number;
  readonly deadByState: Record<BossTacticalState, number>;
  readonly ticksByState: Record<BossTacticalState, number>;
  /** Engagement ticks in which the boss's body did not move at all. */
  readonly bossPlantedTicks: number;
  /** The same, restricted to ticks the boss was standing (not tucked in cover). */
  readonly bossPlantedStandingTicks: number;
  readonly bossDodges: number;
  readonly bossShotsFired: number;
  readonly bossHitsLanded: number;
  readonly playerShotsFired: number;
  /**
   * Balls each side fired that a cover blocker ate before they reached anybody.
   *
   * THE MEASUREMENT THAT EXPLAINS THE BOSS'S 4% ACCURACY, and it is not a miss rate.
   * A ball flies flat at the TARGET's chest, so a fighter shooting past cover taller
   * than that chest feeds its own cover — which is what the low-ammo peek does:
   * standing at a yard cover point clears the eye line (so `bossIntent` believes it
   * has a shot) while leaving the ball's lane blocked by the very crate it is
   * standing behind.
   */
  readonly bossShotsEatenByCover: number;
  readonly playerShotsEatenByCover: number;
  /** Boss shots fired in each tactical posture, so the waste can be attributed. */
  readonly bossShotsByState: Record<BossTacticalState, number>;
}

function emptyByState(): Record<BossTacticalState, number> {
  return { ARMED: 0, LOW: 0, EMPTY: 0 };
}

function runShipped(
  path: AnswerPath,
  seed: number,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
): RunMetrics {
  const arena = ropewalkYardArena();
  const created = createDuel({
    duelId: "SHIPPED",
    seed,
    world: arena.world,
    opponent: { kind: "BOSS", profile: SHIPPED },
    questions: bank(),
    placement: arena.placement,
  });

  let state: DuelState = created.state;
  const intentFor = intents ?? ((_side: DuelSide, view: CombatView) => oracleIntent(view));

  let engagementTicks = 0;
  let deadTicks = 0;
  let bossPlantedTicks = 0;
  let bossPlantedStandingTicks = 0;
  let bossDodges = 0;
  let bossShotsEatenByCover = 0;
  let playerShotsEatenByCover = 0;
  const deadByState = emptyByState();
  const ticksByState = emptyByState();
  const bossShotsByState = emptyByState();
  // `SHOT_ABSORBED_BY_COVER` names the ball, not the shooter, so the firing side is
  // carried forward from `SHOT_FIRED` rather than guessed.
  const shooterOf = new Map<number, DuelSide>();

  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < 400_000) {
    steps += 1;
    if (state.phase === "QUESTION_PENDING") {
      const side = state.awaiting[0]!;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: mintVerdict({
          kind: verdictOn(path, state.round),
          itemId: state.item.itemId,
          itemVersion: state.item.itemVersion,
          source: "CLASSIFIER",
          responseRef: `resp-${side}-r${state.round}`,
        }),
      });
      if (!result.ok) throw new Error(result.rejection.code);
      state = result.state;
      continue;
    }

    const engaged = state.phase === "ENGAGEMENT_LIVE";
    const before = engaged ? state.combat.fighters.B.motion.pos : null;
    const intentBundle: PartialIntents = {};
    if (engaged) {
      intentBundle.A = intentFor("A", combatView(arena.world, state.combat, "A"));
    }

    const result = reduceDuel(state, {
      kind: "ADVANCE",
      frameDtS: FIELD_DT,
      intents: intentBundle,
    });
    if (!result.ok) throw new Error(result.rejection.code);
    const next = result.state;

    for (const event of result.events) {
      if (event.type === "SHOT_FIRED") shooterOf.set(event.projectileId, event.side);
      if (event.type === "SHOT_ABSORBED_BY_COVER") {
        if (shooterOf.get(event.projectileId) === "B") bossShotsEatenByCover += 1;
        else playerShotsEatenByCover += 1;
      }
    }

    if (engaged && before) {
      engagementTicks += 1;
      // The posture the reducer itself believes, read off the memory it just advanced.
      // `bossAi` only exists on the engagement/break states, so it is read from
      // whichever of those the step landed in and otherwise carried.
      const posture =
        "bossAi" in next ? bossTacticalState(next.bossAi) : bossTacticalState(state.bossAi);
      ticksByState[posture] += 1;

      const boss = next.combat.fighters.B;
      const moved = Math.hypot(boss.motion.pos.x - before.x, boss.motion.pos.z - before.z);
      if (moved < PLANTED_EPS_M) {
        bossPlantedTicks += 1;
        if (boss.motion.capsuleHeight > CROUCH_STAND_SPLIT_M) bossPlantedStandingTicks += 1;
      }
      bossDodges += result.events.filter(
        (event) => event.type === "DODGE_STARTED" && event.side === "B",
      ).length;
      bossShotsByState[posture] += result.events.filter(
        (event) => event.type === "SHOT_FIRED" && event.side === "B",
      ).length;

      const balls = next.combat.projectiles.length;
      if (balls === 0 && next.combat.fighters.A.ammo === 0 && boss.ammo === 0) {
        deadTicks += 1;
        deadByState[posture] += 1;
      }
    }
    state = next;
  }

  if (state.phase !== "DUEL_RESOLVED") throw new Error("did not resolve");
  const outcome = state.outcome;
  return {
    died: outcome.healthA <= 0,
    won: outcome.winner === "A",
    knockout: outcome.winner === "A" && outcome.reason === "KNOCKOUT",
    resolvedOnHealth: outcome.reason === "KNOCKOUT",
    rounds: state.round,
    bossHealthFraction: outcome.healthB / SHIPPED.maxHealth,
    playerHealth: outcome.healthA,
    engagementTicks,
    deadTicks,
    deadByState,
    ticksByState,
    bossPlantedTicks,
    bossPlantedStandingTicks,
    bossDodges,
    bossShotsFired: state.combat.fighters.B.shotsFired,
    bossHitsLanded: state.combat.fighters.B.hitsLanded,
    playerShotsFired: state.combat.fighters.A.shotsFired,
    bossShotsEatenByCover,
    playerShotsEatenByCover,
    bossShotsByState,
  };
}

// ---- instruments ------------------------------------------------------------

/**
 * The player who can actually be hit: 0.09 rad of aim jitter, sees 55% of incoming
 * balls. `oracleIntent` is untouchable by construction, so its health measures nothing.
 */
function sloppy(view: CombatView, seed: number): CombatIntent {
  const base = oracleIntent(view, { ...DEFAULT_ORACLE_OPTIONS, dodgeWithinTicks: -1 });
  const jitter = (fieldRandom(seed, view.tick, 77) * 2 - 1) * 0.09;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const aimX = base.aimX * cos - base.aimZ * sin;
  const aimZ = base.aimX * sin + base.aimZ * cos;
  const threat = nearestThreat(view);
  const canDodge = view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  const notices = threat !== null && fieldRandom(seed, threat.projectile.id, 55) < 0.55;
  if (notices && canDodge && threat.ticks <= DEFAULT_ORACLE_OPTIONS.dodgeWithinTicks) {
    return makeIntent({ moveX: threat.evadeX, moveZ: threat.evadeZ, dodge: true, aimX, aimZ });
  }
  return { ...base, aimX, aimZ };
}

const SLOPPY = (_side: DuelSide, view: CombatView): CombatIntent => sloppy(view, 20260726);
const PASSIVE = (): CombatIntent => makeIntent({});

// ---- aggregation ------------------------------------------------------------

interface Agg {
  runs: number;
  wins: number;
  deaths: number;
  knockouts: number;
  resolvedOnHealth: number;
  rounds: number;
  bossHealthLeft: number;
  playerHealthLeft: number;
  worstLoss: number;
  /**
   * Seconds of live combat per fight, and seconds of it that were dead air.
   *
   * THE FRACTION ALONE MISLEADS WHEN THE FIGHT'S LENGTH MOVES, which is exactly what
   * the exposed reload did: it cut the correct path from 11.5 rounds to 4.8 while
   * RAISING dead air's share, because a boss the player can always shoot at empties
   * the player's magazine earlier in each round. Share went up, and the seconds a
   * student actually spends with nothing to do went down. Report both.
   */
  engagementSeconds: number;
  deadSeconds: number;
  deadFraction: number;
  deadInLow: number;
  lowFraction: number;
  armedFraction: number;
  emptyFraction: number;
  plantedFraction: number;
  plantedStandingFraction: number;
  dodges: number;
  bossAccuracy: number;
  /** Share of each side's fired balls that a cover blocker ate. */
  bossEatenShare: number;
  playerEatenShare: number;
  /** Share of the boss's balls fired from the low-ammo peek stance. */
  bossShotsFromLow: number;
}

function aggregate(
  path: AnswerPath,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
  seeds: readonly number[] = SEEDS,
): Agg {
  const out: Agg = {
    runs: seeds.length,
    wins: 0,
    deaths: 0,
    knockouts: 0,
    resolvedOnHealth: 0,
    rounds: 0,
    bossHealthLeft: 0,
    playerHealthLeft: 0,
    worstLoss: 0,
    engagementSeconds: 0,
    deadSeconds: 0,
    deadFraction: 0,
    deadInLow: 0,
    lowFraction: 0,
    armedFraction: 0,
    emptyFraction: 0,
    plantedFraction: 0,
    plantedStandingFraction: 0,
    dodges: 0,
    bossAccuracy: 0,
    bossEatenShare: 0,
    playerEatenShare: 0,
    bossShotsFromLow: 0,
  };
  for (const seed of seeds) {
    const run = runShipped(path, seed, intents);
    const n = seeds.length;
    if (run.won) out.wins += 1;
    if (run.died) out.deaths += 1;
    if (run.knockout) out.knockouts += 1;
    if (run.resolvedOnHealth) out.resolvedOnHealth += 1;
    if (run.died) out.worstLoss = Math.max(out.worstLoss, run.bossHealthFraction);
    out.rounds += run.rounds / n;
    out.bossHealthLeft += run.bossHealthFraction / n;
    out.playerHealthLeft += run.playerHealth / n;
    const ticks = Math.max(1, run.engagementTicks);
    out.engagementSeconds += run.engagementTicks / FIELD_TICK_HZ / n;
    out.deadSeconds += run.deadTicks / FIELD_TICK_HZ / n;
    out.deadFraction += run.deadTicks / ticks / n;
    out.deadInLow += (run.deadTicks > 0 ? run.deadByState.LOW / run.deadTicks : 0) / n;
    out.lowFraction += run.ticksByState.LOW / ticks / n;
    out.armedFraction += run.ticksByState.ARMED / ticks / n;
    out.emptyFraction += run.ticksByState.EMPTY / ticks / n;
    out.plantedFraction += run.bossPlantedTicks / ticks / n;
    out.plantedStandingFraction += run.bossPlantedStandingTicks / ticks / n;
    out.dodges += run.bossDodges;
    out.bossAccuracy +=
      (run.bossShotsFired > 0 ? run.bossHitsLanded / run.bossShotsFired : 0) / n;
    const bossShots = Math.max(1, run.bossShotsFired);
    out.bossEatenShare += run.bossShotsEatenByCover / bossShots / n;
    out.playerEatenShare +=
      run.playerShotsEatenByCover / Math.max(1, run.playerShotsFired) / n;
    out.bossShotsFromLow += run.bossShotsByState.LOW / bossShots / n;
  }
  return out;
}

// ---- output -----------------------------------------------------------------

const pct = (value: number): string => `${(value * 100).toFixed(0)}%`;

function table(title: string, rows: readonly (readonly string[])[]): void {
  console.log(`\n${title}`);
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  for (const row of rows) {
    console.log("  " + row.map((cell, i) => cell.padEnd(widths[i]!)).join("  "));
  }
}

const spec = ropewalkYardArena().spec;
console.log("M1'S SHIPPED FIGHT");
console.log(
  `  arena        ${spec.arenaId} (${spec.cover.length} cover, ` +
    `${spec.halfExtentX * 2}x${spec.halfExtentZ * 2})`,
);
console.log(`  ammo policy  ${SHIPPED.ammoPolicy}`);
console.log(`  takes cover  ${SHIPPED.takesCoverBeforeQuestion}`);
console.log(`  tactical     ${SHIPPED.tactical ? "M1_BOSS_TACTICS" : "null"}`);
if (SHIPPED.tactical) {
  console.log(
    `  low at       <=${SHIPPED.tactical.lowAmmoThreshold} balls; ` +
      `peek ${SHIPPED.tactical.peekAimTicks}t / tuck ${SHIPPED.tactical.peekCooldownTicks}t / ` +
      `acquire ${SHIPPED.tactical.reactionDelayTicks}t`,
  );
}
console.log(
  `  dodge        ${(SHIPPED.dodgeChance * 100).toFixed(0)}% per threatening ball, ` +
    `reaction ${SHIPPED.dodgeReactionTicks}t`,
);
const projection = projectExchange(SHIPPED, BULLETS_FOR_WRONG);
console.log(
  `  margin       ${projection.margin.toFixed(2)} against a required ` +
    `${REQUIRED_WRONG_PATH_MARGIN}` +
    `${projection.margin < REQUIRED_WRONG_PATH_MARGIN ? "  FAIL" : ""}`,
);
console.log(`  slack        ${projection.playerHitsOfSlack.toFixed(1)} clean hits`);

const PATHS: readonly AnswerPath[] = ["CORRECT", "ALTERNATING", "WRONG"];
const reference = new Map(PATHS.map((path) => [path, aggregate(path)]));
const student = new Map(PATHS.map((path) => [path, aggregate(path, SLOPPY)]));
const passive = aggregate("WRONG", PASSIVE);

function balanceRow(label: string, path: AnswerPath, agg: Agg): string[] {
  return [
    label,
    path,
    `${agg.wins}/${agg.runs}`,
    String(agg.deaths),
    String(agg.knockouts),
    `${agg.resolvedOnHealth}/${agg.runs}`,
    agg.rounds.toFixed(1),
    pct(agg.bossHealthLeft),
    agg.playerHealthLeft.toFixed(0),
    pct(agg.worstLoss),
  ];
}

const balanceRows: string[][] = [
  ["player", "answers", "wins", "deaths", "KOs", "on health", "rounds", "boss HP", "player HP", "worst loss"],
];
for (const path of PATHS) balanceRows.push(balanceRow("reference", path, reference.get(path)!));
for (const path of PATHS) balanceRows.push(balanceRow("sloppy", path, student.get(path)!));
balanceRows.push(balanceRow("passive", "WRONG", passive));
table(`BALANCE (${SEEDS.length} seeds, player health ${PLAYER_MAX_HEALTH})`, balanceRows);

// The termination picture, on the set wide enough to measure it. `DUEL_ROUND_CEILING`
// is documented as unreachable in normal play, so a non-zero column here is the
// anti-hang backstop carrying the fight instead of guarding it.
const terminationRows: string[][] = [
  ["player", "answers", "rounds", "on health", "hit the backstop", "wins"],
];
for (const path of PATHS) {
  const agg = aggregate(path, undefined, WIDE_SEEDS);
  terminationRows.push([
    "reference",
    path,
    agg.rounds.toFixed(1),
    `${agg.resolvedOnHealth}/${agg.runs}`,
    `${agg.runs - agg.resolvedOnHealth}/${agg.runs}`,
    `${agg.wins}/${agg.runs}`,
  ]);
}
for (const path of PATHS) {
  const agg = aggregate(path, SLOPPY, WIDE_SEEDS);
  terminationRows.push([
    "sloppy",
    path,
    agg.rounds.toFixed(1),
    `${agg.resolvedOnHealth}/${agg.runs}`,
    `${agg.runs - agg.resolvedOnHealth}/${agg.runs}`,
    `${agg.wins}/${agg.runs}`,
  ]);
}
table(
  `TERMINATION (${WIDE_SEEDS.length} seeds, ceiling ${DUEL_ROUND_CEILING} rounds)`,
  terminationRows,
);

function tempoRow(label: string, path: AnswerPath, agg: Agg): string[] {
  return [
    label,
    path,
    agg.engagementSeconds.toFixed(0),
    agg.deadSeconds.toFixed(0),
    pct(agg.deadFraction),
    pct(agg.deadInLow),
    pct(agg.armedFraction),
    pct(agg.lowFraction),
    pct(agg.emptyFraction),
    pct(agg.plantedFraction),
    pct(agg.plantedStandingFraction),
    String(agg.dodges),
    pct(agg.bossAccuracy),
    pct(agg.bossEatenShare),
    pct(agg.bossShotsFromLow),
    pct(agg.playerEatenShare),
  ];
}

const tempoRows: string[][] = [
  [
    "player",
    "answers",
    "combat s",
    "dead s",
    "dead air",
    "dead in LOW",
    "in ARMED",
    "in LOW",
    "in EMPTY",
    "planted",
    "planted standing",
    "dodges",
    "boss acc",
    "boss balls eaten",
    "boss shots from LOW",
    "player balls eaten",
  ],
];
for (const path of PATHS) tempoRows.push(tempoRow("reference", path, reference.get(path)!));
for (const path of PATHS) tempoRows.push(tempoRow("sloppy", path, student.get(path)!));
table("TEMPO — dead air and where the boss spends the fight", tempoRows);
