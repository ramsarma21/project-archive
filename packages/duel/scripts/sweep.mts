// The tuning instrument. Run it before and after any change to dash, damage,
// health, magazine, fire rate or boss aggression, and put the two tables in the
// report.
//
//   node --import tsx scripts/sweep.mts
//
// Five things are measured, and they answer different questions.
//
//   SPENDABILITY   how many balls can a player physically fire in one round? This
//                  is the number the whole economy rests on: a grant larger than
//                  this expires unfired, and 14 and 7 become the same round with
//                  every test still green.
//
//   WINNABILITY    the design's one non-negotiable — a mechanically strong player
//                  who answers every question wrong must still win. Unbounded
//                  rounds make this a race between two health pools rather than a
//                  shot budget, so it is measured as rounds-to-resolve.
//
//   THE BOSS'S     can the boss win AT ALL, and how fast? Every other measurement
//   SIDE           here drives the player and asks whether the PLAYER can win, and
//                  for a while that was the only question anybody asked. A tier 1
//                  boss turned out to need the full 24-round backstop — 585 seconds
//                  — to put down a player who did nothing whatsoever, and it was
//                  invisible because no table had a column for it. Under a fixed
//                  six rounds a boss that could not win merely lost on schedule;
//                  with health-based termination it produces a fight that cannot
//                  end. Measured against a passive player, so what it reports is
//                  the boss's offence and nothing else.
//
//   KNOWLEDGE      does answering correctly actually decide matches? Two identical
//                  players, one granted 14 a round and one granted 7, same policy,
//                  same arena, same seeds. If 2:1 does not separate them this is
//                  where it shows.
//
//   TEMPO          what is a player DOING for twenty seconds? `dead air` is the
//                  share of the engagement in which nothing is in the air and
//                  neither fighter holds a ball — no threat, no opportunity, no
//                  decision. It is the number most predictive of a boring round.

import {
  bossProfileForTier,
  projectExchange,
  type BossProfile,
  type BossTier,
} from "../src/boss.js";
import { openArena, referenceArena } from "../src/arena.js";
import {
  combatView,
  createCombatState,
  intent as makeIntent,
  isDodging,
  loadMagazine,
  playerParams,
  stepCombat,
  type CombatIntent,
  type CombatParams,
  type CombatView,
} from "../src/combat.js";
import { FIELD_DT, fieldRandom } from "../src/engine.js";
import { DEFAULT_ORACLE_OPTIONS, nearestThreat, oracleIntent } from "../src/policy.js";
import {
  createDuel,
  reduceDuel,
  type DuelState,
  type PartialIntents,
} from "../src/machine.js";
import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  ENGAGEMENT_SECONDS,
  ENGAGEMENT_TICKS,
  FIRE_INTERVAL_SECONDS,
  LINE_OF_SIGHT_BREAK_SECONDS,
  MAX_SPENDABLE_SHOTS_PER_ROUND,
  PLAYER_MAX_HEALTH,
  REQUIRED_WRONG_PATH_MARGIN,
  RESUME_COUNTDOWN_SECONDS,
} from "../src/tuning.js";
import { mintVerdict, type VerdictKind } from "../src/verdict.js";
import type { DuelQuestionRef } from "../src/events.js";
import type { DuelSide } from "../src/sides.js";

const SEEDS = [1, 7, 19, 33, 101, 512, 4242, 90210] as const;
const TIERS: readonly BossTier[] = [1, 2, 3, 4, 5];

function bank(size = 18): readonly DuelQuestionRef[] {
  return Array.from({ length: size }, (_unused, index) => ({
    itemId: `BOS.M1.DUEL.ITEM_${index + 1}`,
    itemVersion: "v1",
    conceptId: index % 2 === 0 ? "POSTWAR_REVENUE" : "REPRESENTATION",
  }));
}

// ---- 1. spendability --------------------------------------------------------
//
// Measured against the real combat step rather than derived, because an off-by-one
// between the arithmetic and the machine is exactly the silent failure the guard
// exists to prevent.

function measureMaxSpendableShots(): number {
  const arena = openArena();
  const params: CombatParams = { A: playerParams(), B: playerParams() };
  let state = createCombatState(params, {
    A: { pos: { x: 0, y: 0, z: -5 }, yaw: 0 },
    B: { pos: { x: 0, y: 0, z: 5 }, yaw: Math.PI },
  });
  // Far more ammo than any grant, so the reload is the only thing limiting us.
  state = loadMagazine(state, "A", 999);
  let fired = 0;
  for (let step = 0; step < ENGAGEMENT_TICKS; step++) {
    const result = stepCombat(
      arena.world,
      state,
      {
        // Aim off-axis so the target is never hit and the round never ends early.
        A: makeIntent({ fire: true, aimX: 1, aimZ: 0 }),
        B: makeIntent({}),
      },
      params,
      1,
    );
    state = result.state;
    fired += result.events.filter((event) => event.type === "SHOT_FIRED").length;
  }
  return fired;
}

// ---- 2 + 4. duels against a boss -------------------------------------------

export type ProfileTweak = (profile: BossProfile) => BossProfile;

interface RunMetrics {
  readonly winner: DuelSide | null;
  readonly knockout: boolean;
  readonly died: boolean;
  readonly rounds: number;
  readonly bossHealthFraction: number;
  readonly playerHealthFraction: number;
  readonly shotsFired: number;
  readonly hitsLanded: number;
  readonly bossShotsFired: number;
  readonly bossHitsLanded: number;
  readonly engagementTicks: number;
  readonly idleTicks: number;
  readonly liveBallTicks: number;
  readonly armedTicks: number;
  readonly recycledQuestions: number;
}

function runBossDuel(
  tier: BossTier,
  verdict: VerdictKind,
  seed: number,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
  tweak?: ProfileTweak,
): RunMetrics {
  const arena = referenceArena();
  const base = bossProfileForTier(tier);
  const profile = tweak ? tweak(base) : base;
  const created = createDuel({
    duelId: "SWEEP",
    seed,
    world: arena.world,
    opponent: { kind: "BOSS", profile },
    questions: bank(),
    placement: arena.placement,
  });

  let state: DuelState = created.state;
  const intentFor =
    intents ?? ((_side: DuelSide, view: CombatView) => oracleIntent(view));

  let engagementTicks = 0;
  let idleTicks = 0;
  let liveBallTicks = 0;
  let armedTicks = 0;
  let recycledQuestions = 0;

  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < 400_000) {
    steps += 1;
    if (state.phase === "QUESTION_PENDING") {
      if (state.asked.recycled) recycledQuestions += 1;
      const side = state.awaiting[0]!;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: mintVerdict({
          kind: verdict,
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

    const wasEngaged = state.phase === "ENGAGEMENT_LIVE";
    const intentBundle: PartialIntents = {};
    if (wasEngaged) {
      intentBundle.A = intentFor("A", combatView(arena.world, state.combat, "A"));
    }
    const result = reduceDuel(state, {
      kind: "ADVANCE",
      frameDtS: FIELD_DT,
      intents: intentBundle,
    });
    if (!result.ok) throw new Error(result.rejection.code);
    state = result.state;

    if (wasEngaged) {
      engagementTicks += 1;
      const balls = state.combat.projectiles.length;
      const player = state.combat.fighters.A;
      const boss = state.combat.fighters.B;
      if (balls > 0) liveBallTicks += 1;
      if (player.ammo > 0) armedTicks += 1;
      if (balls === 0 && player.ammo === 0 && boss.ammo === 0) idleTicks += 1;
    }
  }

  if (state.phase !== "DUEL_RESOLVED") throw new Error("did not resolve");
  const outcome = state.outcome;
  return {
    winner: outcome.winner,
    knockout: outcome.winner === "A" && outcome.reason === "KNOCKOUT",
    died: outcome.healthA <= 0,
    rounds: state.round,
    bossHealthFraction: outcome.healthB / profile.maxHealth,
    playerHealthFraction: outcome.healthA / PLAYER_MAX_HEALTH,
    shotsFired: state.combat.fighters.A.shotsFired,
    hitsLanded: state.combat.fighters.A.hitsLanded,
    bossShotsFired: state.combat.fighters.B.shotsFired,
    bossHitsLanded: state.combat.fighters.B.hitsLanded,
    engagementTicks,
    idleTicks,
    liveBallTicks,
    armedTicks,
    recycledQuestions,
  };
}

interface Aggregate {
  wins: number;
  knockouts: number;
  deaths: number;
  rounds: number;
  bossHealthLeft: number;
  playerHealthLeft: number;
  accuracy: number;
  bossAccuracy: number;
  idleFraction: number;
  liveBallFraction: number;
  armedFraction: number;
  recycled: number;
  runs: number;
}

function aggregate(
  tier: BossTier,
  verdict: VerdictKind,
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
  tweak?: ProfileTweak,
): Aggregate {
  const out: Aggregate = {
    wins: 0,
    knockouts: 0,
    deaths: 0,
    rounds: 0,
    bossHealthLeft: 0,
    playerHealthLeft: 0,
    accuracy: 0,
    bossAccuracy: 0,
    idleFraction: 0,
    liveBallFraction: 0,
    armedFraction: 0,
    recycled: 0,
    runs: SEEDS.length,
  };
  for (const seed of SEEDS) {
    const run = runBossDuel(tier, verdict, seed, intents, tweak);
    if (run.winner === "A") out.wins += 1;
    if (run.knockout) out.knockouts += 1;
    if (run.died) out.deaths += 1;
    out.rounds += run.rounds / SEEDS.length;
    out.bossHealthLeft += run.bossHealthFraction / SEEDS.length;
    out.playerHealthLeft += run.playerHealthFraction / SEEDS.length;
    out.accuracy +=
      (run.shotsFired > 0 ? run.hitsLanded / run.shotsFired : 0) / SEEDS.length;
    out.bossAccuracy +=
      (run.bossShotsFired > 0 ? run.bossHitsLanded / run.bossShotsFired : 0) /
      SEEDS.length;
    out.idleFraction += run.idleTicks / run.engagementTicks / SEEDS.length;
    out.liveBallFraction += run.liveBallTicks / run.engagementTicks / SEEDS.length;
    out.armedFraction += run.armedTicks / run.engagementTicks / SEEDS.length;
    out.recycled += run.recycledQuestions / SEEDS.length;
  }
  return out;
}

// ---- 3. the knowledge advantage, head to head ------------------------------
//
// The question the owner asked directly: does a 2:1 economy actually decide a
// match? Two players, identical policy, identical health, identical arena. The
// ONLY difference between them is that A answers every question correctly and B
// answers every question wrong. Anything other than A winning almost always means
// the economy has stopped converting knowledge into power.

interface HeadToHead {
  readonly correctWins: number;
  readonly wrongWins: number;
  readonly draws: number;
  readonly meanRounds: number;
  readonly knockouts: number;
  readonly healthCorrect: number;
  readonly healthWrong: number;
  readonly hitsCorrect: number;
  readonly hitsWrong: number;
  readonly shotsCorrect: number;
  readonly shotsWrong: number;
  readonly runs: number;
}

function knowledgeHeadToHead(
  intents?: (side: DuelSide, view: CombatView) => CombatIntent,
): HeadToHead {
  let correctWins = 0;
  let wrongWins = 0;
  let draws = 0;
  let rounds = 0;
  let knockouts = 0;
  let healthCorrect = 0;
  let healthWrong = 0;
  let hitsCorrect = 0;
  let hitsWrong = 0;
  let shotsCorrect = 0;
  let shotsWrong = 0;
  for (const seed of SEEDS) {
    const arena = referenceArena();
    const created = createDuel({
      duelId: "SWEEP.PVP",
      seed,
      world: arena.world,
      opponent: { kind: "REMOTE", handle: "opponent" },
      questions: bank(),
      placement: arena.placement,
    });
    let state: DuelState = created.state;
    const intentFor =
      intents ?? ((_side: DuelSide, view: CombatView) => oracleIntent(view));

    let steps = 0;
    while (state.phase !== "DUEL_RESOLVED" && steps < 400_000) {
      steps += 1;
      if (state.phase === "QUESTION_PENDING") {
        const side = state.awaiting[0]!;
        const result = reduceDuel(state, {
          kind: "COMMIT_VERDICT",
          side,
          // A knows the history. B does not. Nothing else differs.
          verdict: mintVerdict({
            kind: side === "A" ? "CORRECT" : "WRONG",
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
      const intentBundle: PartialIntents = {};
      if (state.phase === "ENGAGEMENT_LIVE") {
        intentBundle.A = intentFor("A", combatView(arena.world, state.combat, "A"));
        intentBundle.B = intentFor("B", combatView(arena.world, state.combat, "B"));
      }
      const result = reduceDuel(state, {
        kind: "ADVANCE",
        frameDtS: FIELD_DT,
        intents: intentBundle,
      });
      if (!result.ok) throw new Error(result.rejection.code);
      state = result.state;
    }
    if (state.phase !== "DUEL_RESOLVED") throw new Error("did not resolve");
    if (state.outcome.winner === "A") correctWins += 1;
    else if (state.outcome.winner === "B") wrongWins += 1;
    else draws += 1;
    if (state.outcome.reason === "KNOCKOUT") knockouts += 1;
    rounds += state.round / SEEDS.length;
    healthCorrect += state.outcome.healthA / PLAYER_MAX_HEALTH / SEEDS.length;
    healthWrong += state.outcome.healthB / PLAYER_MAX_HEALTH / SEEDS.length;
    hitsCorrect += state.combat.fighters.A.hitsLanded / SEEDS.length;
    hitsWrong += state.combat.fighters.B.hitsLanded / SEEDS.length;
    shotsCorrect += state.combat.fighters.A.shotsFired / SEEDS.length;
    shotsWrong += state.combat.fighters.B.shotsFired / SEEDS.length;
  }
  return {
    correctWins,
    wrongWins,
    draws,
    meanRounds: rounds,
    knockouts,
    healthCorrect,
    healthWrong,
    hitsCorrect,
    hitsWrong,
    shotsCorrect,
    shotsWrong,
    runs: SEEDS.length,
  };
}

// ---- instruments ------------------------------------------------------------

/**
 * The player who can actually be hit. `oracleIntent` dodges everything predicted
 * to pass within 0.56 m and the burst clears 2.22 m, so a perfect player's health
 * measures nothing. This one models the real failure of a thirteen-year-old: not a
 * bad roll, but not seeing the ball. `awareness` is rolled once per BALL, because
 * per tick compounds to certainty over a flight.
 */
function sloppy(
  view: CombatView,
  seed: number,
  jitterRad: number,
  awareness: number,
): CombatIntent {
  const base = oracleIntent(view, {
    ...DEFAULT_ORACLE_OPTIONS,
    dodgeWithinTicks: -1,
  });
  const jitter = (fieldRandom(seed, view.tick, 77) * 2 - 1) * jitterRad;
  const cos = Math.cos(jitter);
  const sin = Math.sin(jitter);
  const aimX = base.aimX * cos - base.aimZ * sin;
  const aimZ = base.aimX * sin + base.aimZ * cos;

  const threat = nearestThreat(view);
  const canDodge = view.tick >= view.self.dodge.readyAtTick && !isDodging(view.self);
  const notices =
    threat !== null && fieldRandom(seed, threat.projectile.id, 55) < awareness;
  if (notices && canDodge && threat.ticks <= DEFAULT_ORACLE_OPTIONS.dodgeWithinTicks) {
    return makeIntent({
      moveX: threat.evadeX,
      moveZ: threat.evadeZ,
      dodge: true,
      aimX,
      aimZ,
    });
  }
  return { ...base, aimX, aimZ };
}

const SLOPPY = (_side: DuelSide, view: CombatView): CombatIntent =>
  sloppy(view, 20260726, 0.09, 0.55);

/**
 * A player who does nothing: no fire, no movement, no dodge. The instrument for
 * the boss's own offence, because against a target that never shoots back the only
 * thing that decides the duel is whether the boss can land enough to finish.
 */
const PASSIVE = (): CombatIntent => makeIntent({});

// ---- output -----------------------------------------------------------------

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function table(title: string, rows: readonly (readonly string[])[]): void {
  console.log(`\n${title}`);
  const widths = rows[0]!.map((_, column) =>
    Math.max(...rows.map((row) => row[column]!.length)),
  );
  for (const row of rows) {
    console.log(
      "  " + row.map((cell, column) => cell.padEnd(widths[column]!)).join("  "),
    );
  }
}

const spendable = measureMaxSpendableShots();
console.log("\nSPENDABILITY");
console.log(`  reload                        ${FIRE_INTERVAL_SECONDS}s`);
console.log(`  round                         ${ENGAGEMENT_TICKS / 60}s`);
console.log(`  max shots measured in a round ${spendable}`);
console.log(`  max shots predicted           ${MAX_SPENDABLE_SHOTS_PER_ROUND}`);
console.log(`  correct-answer grant          ${BULLETS_FOR_CORRECT}`);
console.log(`  wrong-answer grant            ${BULLETS_FOR_WRONG}`);
console.log(
  `  slack over the larger grant   ${spendable - BULLETS_FOR_CORRECT} balls`,
);

const header = [
  "tier",
  "ammo",
  "wins",
  "KOs",
  "deaths",
  "rounds",
  "acc",
  "boss HP",
  "player HP",
  "dead air",
  "ball up",
  "armed",
  "recycled Qs",
];

function row(tier: number, verdict: VerdictKind, result: Aggregate): string[] {
  return [
    String(tier),
    verdict === "WRONG" ? String(BULLETS_FOR_WRONG) : String(BULLETS_FOR_CORRECT),
    `${result.wins}/${result.runs}`,
    String(result.knockouts),
    String(result.deaths),
    result.rounds.toFixed(1),
    pct(result.accuracy),
    pct(result.bossHealthLeft),
    pct(result.playerHealthLeft),
    pct(result.idleFraction),
    pct(result.liveBallFraction),
    pct(result.armedFraction),
    result.recycled.toFixed(1),
  ];
}

const rows: string[][] = [header];
for (const tier of TIERS) {
  for (const verdict of ["WRONG", "CORRECT"] as const) {
    rows.push(row(tier, verdict, aggregate(tier, verdict)));
  }
}
table("REFERENCE SKILLED PLAYER vs BOSS", rows);

// ---- can the boss win? ------------------------------------------------------
//
// The column that was missing. `finishes` must be runs/runs at every tier: a boss
// that cannot put down a player who never fires is a duel with no ending, and the
// second number says how long it takes it. Read `hits to fall` next to it — that is
// what the HUD opens the player's health bar at, and the two are the same fact.

// A round of play end to end: the engagement, the line-of-sight break the boss
// reloads behind, and the countdown that resumes it. The question is untimed and
// therefore not part of the clock a duel's length is measured on.
const ROUND_SECONDS =
  ENGAGEMENT_SECONDS + LINE_OF_SIGHT_BREAK_SECONDS + RESUME_COUNTDOWN_SECONDS;

const bossRows: string[][] = [
  [
    "tier",
    "finishes",
    "rounds",
    "seconds",
    "boss acc",
    "hits to fall",
    "margin",
    "slack",
  ],
];
for (const tier of TIERS) {
  const result = aggregate(tier, "WRONG", PASSIVE);
  const profile = bossProfileForTier(tier);
  const projection = projectExchange(profile, BULLETS_FOR_WRONG);
  bossRows.push([
    String(tier),
    `${result.deaths}/${result.runs}`,
    result.rounds.toFixed(1),
    (result.rounds * ROUND_SECONDS).toFixed(0),
    pct(result.bossAccuracy),
    String(Math.ceil(PLAYER_MAX_HEALTH / profile.shotDamage)),
    // The gate's own numbers, printed beside the measurement they cannot see, so
    // "the margin is fine and the boss still cannot finish" is legible in one table.
    `${projection.margin.toFixed(2)}${projection.margin < REQUIRED_WRONG_PATH_MARGIN ? " FAIL" : ""}`,
    projection.playerHitsOfSlack.toFixed(1),
  ]);
}
table("CAN THE BOSS WIN? (passive player: no fire, no move, no dodge)", bossRows);

const sloppyRows: string[][] = [header];
for (const tier of [1, 3, 5] as const) {
  for (const verdict of ["WRONG", "CORRECT"] as const) {
    sloppyRows.push(row(tier, verdict, aggregate(tier, verdict, SLOPPY)));
  }
}
table("SLOPPY PLAYER vs BOSS (0.09 rad jitter, sees 55% of incoming)", sloppyRows);

const skilled = knowledgeHeadToHead();
const careless = knowledgeHeadToHead(SLOPPY);
function headRow(label: string, result: HeadToHead): string[] {
  return [
    label,
    `${result.correctWins}/${result.runs}`,
    String(result.wrongWins),
    String(result.draws),
    result.meanRounds.toFixed(1),
    `${result.knockouts}/${result.runs}`,
    pct(result.healthCorrect),
    pct(result.healthWrong),
    `${result.hitsCorrect.toFixed(1)}/${result.shotsCorrect.toFixed(0)}`,
    `${result.hitsWrong.toFixed(1)}/${result.shotsWrong.toFixed(0)}`,
  ];
}

table("KNOWLEDGE HEAD TO HEAD — PvP, identical skill, only the answers differ", [
  [
    "players",
    "correct wins",
    "wrong wins",
    "draws",
    "rounds",
    "by KO",
    "HP correct",
    "HP wrong",
    "hits/shots correct",
    "hits/shots wrong",
  ],
  headRow("reference", skilled),
  headRow("sloppy", careless),
]);
