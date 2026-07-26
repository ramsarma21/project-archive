// The round state machine.
//
// Illegal transitions are unrepresentable rather than merely unlikely, by three
// separate mechanisms:
//
//   1. Each phase is its own type carrying ONLY the data that is legal in it.
//      There is no `verdicts` field on ENGAGEMENT_LIVE to leave stale, no
//      `grants` field on QUESTION_PENDING to fill in early, and no `outcome`
//      anywhere but DUEL_RESOLVED.
//   2. VERDICT_COMMITTED cannot be constructed without a verdict for every side
//      that owed one — its `verdicts` array is the complete set, and the only
//      code path that builds it is the one where `awaiting` just emptied.
//   3. Every per-phase step function declares its legal successors as its return
//      type, so an illegal transition is a compile error at the definition site
//      rather than a runtime check. `stepQuestionPending` cannot return an
//      engagement; `stepEngagement` cannot return a question.
//
// Commands cannot express a bullet count. `COMMIT_VERDICT` carries a
// CommittedVerdict and nothing else, `ADVANCE` carries a frame delta and intents.
// There is no field a client could put a 3 in.
//
// PvE and PvP are the same machine. The only difference is `OpponentSource`:
// which sides owe a verdict, and where side B's intents come from.

import {
  advanceFieldClock,
  createFieldClock,
  pauseFieldClock,
  resumeFieldClock,
  type CollisionWorld,
  type FieldClock,
  type Vec3,
} from "./engine.js";
import {
  clearFieldForBoundary,
  combatView,
  createCombatState,
  IDLE_INTENT,
  isDowned,
  loadMagazine,
  playerParams,
  stepCombat,
  type CombatIntent,
  type CombatParams,
  type CombatState,
} from "./combat.js";
import {
  assertBossWinnableOnWrongAnswers,
  bossFighterParams,
  type BossProfile,
} from "./boss.js";
import { bossIntent } from "./policy.js";
import {
  grantRoundBullets,
  type AmmoSource,
  type BulletGrant,
} from "./bullets.js";
import type { AbilityLoadout } from "./abilities.js";
import {
  type AskedQuestion,
  type DuelEvent,
  type DuelOutcome,
  type DuelQuestionRef,
  type RoundSummary,
} from "./events.js";
import { askQuestion } from "./questions.js";
import { DUEL_SIDES, otherSide, type BySide, type DuelSide } from "./sides.js";
import {
  BULLET_CARRY_POLICY,
  DUEL_ROUND_CEILING,
  ENGAGEMENT_TICKS,
  FACE_OFF_SEPARATION_M,
  FACE_OFF_TICKS,
  LINE_OF_SIGHT_BREAK_TICKS,
  RESUME_COUNTDOWN_TICKS,
  type BulletCarryPolicy,
} from "./tuning.js";
import type { CommittedVerdict } from "./verdict.js";

// ---- configuration ----------------------------------------------------------

/**
 * The one field that separates a boss duel from a PvP duel.
 *
 * BOSS  — side B is driven by `bossIntent` and its magazine is authored.
 * REMOTE — side B is a person: it owes a verdict, and its intents arrive with
 *          the ADVANCE command from the transport.
 */
export type OpponentSource =
  | { readonly kind: "BOSS"; readonly profile: BossProfile }
  | {
      readonly kind: "REMOTE";
      readonly handle: string;
      readonly loadout?: AbilityLoadout;
      readonly maxHealth?: number;
    };

export interface DuelConfig {
  readonly duelId: string;
  readonly seed: number;
  /**
   * The hard backstop, NOT the duel's length. A duel ends when a health bar
   * empties; this only exists so the loop provably terminates. See
   * DUEL_ROUND_CEILING.
   */
  readonly roundCeiling: number;
  /**
   * @deprecated Equal to `roundCeiling`, and retained only so the web client keeps
   * compiling through the format change. A duel has no round count to render — the
   * HUD's "round 3 of 6" has no "of" any more. Read `round` and drop the total.
   */
  readonly rounds: number;
  readonly world: CollisionWorld;
  readonly opponent: OpponentSource;
  readonly playerLoadout: AbilityLoadout;
  /**
   * The authored bank. NOT one item per round any more — the duel can outlast it,
   * and `askQuestion` recycles with disclosure when it does.
   */
  readonly questions: readonly DuelQuestionRef[];
  readonly carryPolicy: BulletCarryPolicy;
  readonly placement: BySide<{ readonly pos: Vec3; readonly yaw: number }>;
}

export interface CreateDuelInput {
  readonly duelId: string;
  readonly seed: number;
  readonly world: CollisionWorld;
  readonly opponent: OpponentSource;
  /** At least one authored item. A short bank recycles; it does not fail. */
  readonly questions: readonly DuelQuestionRef[];
  readonly playerLoadout?: AbilityLoadout;
  /** Override the termination backstop. Almost nothing should. */
  readonly roundCeiling?: number;
  /** @deprecated Compatibility alias for `roundCeiling`. */
  readonly rounds?: number;
  readonly carryPolicy?: BulletCarryPolicy;
  readonly placement?: BySide<{ readonly pos: Vec3; readonly yaw: number }>;
}

/** Sides that must answer a question. This is the PvE/PvP fork, in one line. */
export function answeringSides(opponent: OpponentSource): readonly DuelSide[] {
  return opponent.kind === "REMOTE" ? DUEL_SIDES : (["A"] as const);
}

export function duelMode(opponent: OpponentSource): "BOSS" | "PVP" {
  return opponent.kind === "BOSS" ? "BOSS" : "PVP";
}

function defaultPlacement(): BySide<{ pos: Vec3; yaw: number }> {
  const half = FACE_OFF_SEPARATION_M / 2;
  return {
    A: { pos: { x: 0, y: 0, z: -half }, yaw: 0 },
    B: { pos: { x: 0, y: 0, z: half }, yaw: Math.PI },
  };
}

function combatParams(config: DuelConfig): CombatParams {
  const a = playerParams(config.playerLoadout);
  if (config.opponent.kind === "BOSS") {
    return { A: a, B: bossFighterParams(config.opponent.profile) };
  }
  return {
    A: a,
    B: {
      ...playerParams(config.opponent.loadout ?? []),
      maxHealth: config.opponent.maxHealth ?? a.maxHealth,
    },
  };
}

// ---- phases -----------------------------------------------------------------

export type DuelPhase =
  | "FACE_OFF"
  | "QUESTION_PENDING"
  | "VERDICT_COMMITTED"
  | "BULLETS_GRANTED"
  | "ENGAGEMENT_LIVE"
  | "LINE_OF_SIGHT_BREAK"
  | "ROUND_RESOLVED"
  | "DUEL_RESOLVED";

interface DuelCore {
  readonly config: DuelConfig;
  readonly clock: FieldClock;
  readonly combat: CombatState;
  readonly params: CombatParams;
  /** Ticks actually spent in engagement: the "duel clock" the design counts. */
  readonly engagementTicks: number;
}

export interface VerdictEntry {
  readonly side: DuelSide;
  readonly verdict: CommittedVerdict;
}

export interface FaceOffState extends DuelCore {
  readonly phase: "FACE_OFF";
  readonly round: 0;
  readonly endsAtTick: number;
}

export interface QuestionPendingState extends DuelCore {
  readonly phase: "QUESTION_PENDING";
  readonly round: number;
  readonly item: DuelQuestionRef;
  /** Whether this item is a repeat, and its appearance ordinal. Disclosed, never hidden. */
  readonly asked: AskedQuestion;
  /** Non-empty by construction: an empty awaiting list is VERDICT_COMMITTED. */
  readonly awaiting: readonly DuelSide[];
  readonly verdicts: readonly VerdictEntry[];
}

export interface VerdictCommittedState extends DuelCore {
  readonly phase: "VERDICT_COMMITTED";
  readonly round: number;
  readonly item: DuelQuestionRef;
  readonly asked: AskedQuestion;
  /** Complete: one entry for every side that owed a verdict. */
  readonly verdicts: readonly VerdictEntry[];
  readonly ammoSources: BySide<AmmoSource>;
}

export interface BulletsGrantedState extends DuelCore {
  readonly phase: "BULLETS_GRANTED";
  readonly round: number;
  readonly grants: BySide<BulletGrant>;
  /** The 3-second countdown that resumes play once verdicts have landed. */
  readonly resumesAtTick: number;
}

export interface EngagementLiveState extends DuelCore {
  readonly phase: "ENGAGEMENT_LIVE";
  readonly round: number;
  readonly endsAtTick: number;
}

export interface LineOfSightBreakState extends DuelCore {
  readonly phase: "LINE_OF_SIGHT_BREAK";
  readonly round: number;
  readonly endsAtTick: number;
  readonly unspent: BySide<number>;
}

export interface RoundResolvedState extends DuelCore {
  readonly phase: "ROUND_RESOLVED";
  readonly round: number;
  readonly summary: RoundSummary;
}

export interface DuelResolvedState extends DuelCore {
  readonly phase: "DUEL_RESOLVED";
  readonly round: number;
  readonly outcome: DuelOutcome;
}

export type DuelState =
  | FaceOffState
  | QuestionPendingState
  | VerdictCommittedState
  | BulletsGrantedState
  | EngagementLiveState
  | LineOfSightBreakState
  | RoundResolvedState
  | DuelResolvedState;

// ---- commands ---------------------------------------------------------------

export type PartialIntents = Partial<Record<DuelSide, CombatIntent>>;

export type DuelCommand =
  | {
      readonly kind: "ADVANCE";
      readonly frameDtS: number;
      readonly intents?: PartialIntents;
    }
  | {
      readonly kind: "COMMIT_VERDICT";
      readonly side: DuelSide;
      readonly verdict: CommittedVerdict;
    };

export type DuelRejectionCode =
  | "COMMAND_NOT_LEGAL_IN_PHASE"
  | "SIDE_DOES_NOT_ANSWER"
  | "SIDE_ALREADY_COMMITTED"
  | "DUEL_ALREADY_RESOLVED";

export interface DuelRejection {
  readonly code: DuelRejectionCode;
  readonly detail: string;
}

export type DuelReduceResult =
  | {
      readonly ok: true;
      readonly state: DuelState;
      readonly events: readonly DuelEvent[];
      /**
       * Fixed steps this command actually consumed. Zero is normal and common: a
       * frame shorter than 1/60s buys no tick.
       *
       * Exposed because a client that edge-latches a press — a shot, a dodge — must
       * hold the latch until a tick consumes it. On a 120 Hz display half of all
       * frames advance no tick, so a latch cleared per FRAME silently discards half
       * of all clicks, and the symptom is "the game feels unresponsive" rather than
       * anything that shows up in a test.
       */
      readonly ticksAdvanced: number;
    }
  | {
      readonly ok: false;
      readonly state: DuelState;
      readonly rejection: DuelRejection;
    };

// ---- construction -----------------------------------------------------------

export function createDuel(input: CreateDuelInput): {
  state: FaceOffState;
  events: readonly DuelEvent[];
} {
  const roundCeiling = input.roundCeiling ?? input.rounds ?? DUEL_ROUND_CEILING;
  // The bank no longer has to cover the duel — it cannot, since the duel has no
  // length — so the only requirement is that there is something to ask.
  if (input.questions.length === 0) {
    throw new Error("a duel needs at least one authored question");
  }
  if (input.opponent.kind === "BOSS") {
    assertBossWinnableOnWrongAnswers(input.opponent.profile);
  }
  const config: DuelConfig = {
    duelId: input.duelId,
    seed: input.seed >>> 0,
    roundCeiling,
    rounds: roundCeiling,
    world: input.world,
    opponent: input.opponent,
    playerLoadout: input.playerLoadout ?? [],
    questions: input.questions,
    carryPolicy: input.carryPolicy ?? BULLET_CARRY_POLICY,
    placement: input.placement ?? defaultPlacement(),
  };
  const params = combatParams(config);
  const state: FaceOffState = {
    phase: "FACE_OFF",
    round: 0,
    config,
    params,
    clock: createFieldClock(config.seed),
    combat: createCombatState(params, config.placement),
    engagementTicks: 0,
    endsAtTick: FACE_OFF_TICKS,
  };
  return {
    state,
    events: [
      {
        type: "DUEL_STARTED",
        seed: config.seed,
        roundCeiling,
        bankSize: config.questions.length,
        mode: duelMode(config.opponent),
        opponentId:
          config.opponent.kind === "BOSS"
            ? config.opponent.profile.bossId
            : config.opponent.handle,
      },
    ],
  };
}

// ---- the reducer ------------------------------------------------------------

export function reduceDuel(
  state: DuelState,
  command: DuelCommand,
): DuelReduceResult {
  if (state.phase === "DUEL_RESOLVED") {
    return {
      ok: false,
      state,
      rejection: { code: "DUEL_ALREADY_RESOLVED", detail: command.kind },
    };
  }
  if (command.kind === "COMMIT_VERDICT") {
    if (state.phase !== "QUESTION_PENDING") {
      return {
        ok: false,
        state,
        rejection: { code: "COMMAND_NOT_LEGAL_IN_PHASE", detail: state.phase },
      };
    }
    return commitVerdict(state, command.side, command.verdict);
  }
  return advance(state, command.frameDtS, command.intents ?? {});
}

/**
 * Untimed phases freeze the shared clock rather than running a second one, which
 * is how the design's "the duel clock stops for the question" is expressed
 * without owning a clock. QUESTION_PENDING is genuinely untimed (Mission-Slate
 * §1.11), so ADVANCE in that phase legally does nothing but wait.
 */
function advance(
  state: Exclude<DuelState, DuelResolvedState>,
  frameDtS: number,
  intents: PartialIntents,
): DuelReduceResult {
  if (state.phase === "QUESTION_PENDING") {
    return { ok: true, state, events: [], ticksAdvanced: 0 };
  }
  if (state.phase === "VERDICT_COMMITTED") {
    const next = grantBullets(state);
    return { ok: true, state: next.state, events: next.events, ticksAdvanced: 0 };
  }
  if (state.phase === "ROUND_RESOLVED") {
    const next = openNextRoundOrResolve(state);
    return { ok: true, state: next.state, events: next.events, ticksAdvanced: 0 };
  }

  const advanced = advanceFieldClock(resumeFieldClock(state.clock), frameDtS);
  let current: DuelState = { ...state, clock: advanced.clock };
  const events: DuelEvent[] = [];
  let ticksAdvanced = 0;

  for (let tick = advanced.firstTick; tick <= advanced.lastTick; tick++) {
    ticksAdvanced += 1;
    if (current.phase === "FACE_OFF") {
      const stepped = stepFaceOff(current, tick);
      current = stepped.state;
      events.push(...stepped.events);
    } else if (current.phase === "BULLETS_GRANTED") {
      const stepped = stepBulletsGranted(current, tick);
      current = stepped.state;
      events.push(...stepped.events);
    } else if (current.phase === "ENGAGEMENT_LIVE") {
      const stepped = stepEngagement(current, tick, intents);
      current = stepped.state;
      events.push(...stepped.events);
    } else if (current.phase === "LINE_OF_SIGHT_BREAK") {
      const stepped = stepLineOfSightBreak(current, tick);
      current = stepped.state;
      events.push(...stepped.events);
    }
    // A phase that does not consume ticks stops the loop: the remaining fixed
    // steps belong to the next ADVANCE, after the caller has had a chance to
    // deliver a verdict or read the round summary.
    if (current.phase === "QUESTION_PENDING" || current.phase === "ROUND_RESOLVED") {
      break;
    }
  }

  return { ok: true, state: current, events, ticksAdvanced };
}

interface Stepped<T extends DuelState> {
  readonly state: T;
  readonly events: readonly DuelEvent[];
}

// Each step function's return type IS the transition table. Adding an illegal
// destination is a type error here, not a bug in production.

function stepFaceOff(
  state: FaceOffState,
  tick: number,
): Stepped<FaceOffState | QuestionPendingState> {
  if (tick < state.endsAtTick) {
    return { state: withTick(state, tick), events: [] };
  }
  const opened = openQuestion(withTick(state, tick), 1);
  return {
    state: opened.state,
    events: [{ type: "FACE_OFF_COMPLETED", tick }, ...opened.events],
  };
}

function openQuestion(
  state: DuelCore & { readonly phase: DuelPhase },
  round: number,
): Stepped<QuestionPendingState> {
  // Not `questions[round - 1]`: a duel can outlast its bank now, so which item a
  // round asks is a seeded policy rather than an index, and a repeat is disclosed.
  const asked = askQuestion(state.config.questions, round, state.config.seed);
  const awaiting = answeringSides(state.config.opponent);
  const next: QuestionPendingState = {
    phase: "QUESTION_PENDING",
    round,
    item: asked.item,
    asked,
    awaiting,
    verdicts: [],
    config: state.config,
    params: state.params,
    // The clock stops: answering is untimed and must not spend duel time.
    clock: pauseFieldClock(state.clock),
    combat: clearFieldForBoundary(state.combat),
    engagementTicks: state.engagementTicks,
  };
  return {
    state: next,
    events: [
      {
        type: "QUESTION_OPENED",
        round,
        item: asked.item,
        appearance: asked.appearance,
        recycled: asked.recycled,
        awaiting,
      },
    ],
  };
}

function commitVerdict(
  state: QuestionPendingState,
  side: DuelSide,
  verdict: CommittedVerdict,
): DuelReduceResult {
  if (!answeringSides(state.config.opponent).includes(side)) {
    return {
      ok: false,
      state,
      rejection: { code: "SIDE_DOES_NOT_ANSWER", detail: side },
    };
  }
  if (!state.awaiting.includes(side)) {
    return {
      ok: false,
      state,
      rejection: { code: "SIDE_ALREADY_COMMITTED", detail: side },
    };
  }
  const verdicts = [...state.verdicts, { side, verdict }];
  const awaiting = state.awaiting.filter((entry) => entry !== side);
  const committed: DuelEvent = {
    type: "VERDICT_COMMITTED",
    round: state.round,
    side,
    verdict,
  };
  if (awaiting.length > 0) {
    return {
      ok: true,
      state: { ...state, awaiting, verdicts },
      events: [committed],
      ticksAdvanced: 0,
    };
  }
  // Every verdict is in: the complete-by-construction phase.
  const next: VerdictCommittedState = {
    phase: "VERDICT_COMMITTED",
    round: state.round,
    item: state.item,
    asked: state.asked,
    verdicts,
    ammoSources: roundAmmoSources(state.config, verdicts),
    config: state.config,
    params: state.params,
    clock: state.clock,
    combat: state.combat,
    engagementTicks: state.engagementTicks,
  };
  return { ok: true, state: next, events: [committed], ticksAdvanced: 0 };
}

/**
 * Where a round's bullets come from, per side.
 *
 * A side that owes a verdict gets VERDICT and nothing else — there is no branch
 * that could hand it an authored number. A side that owes no verdict (a boss) is
 * the only consumer of AUTHORED, and its number comes from the authored profile.
 */
export function roundAmmoSources(
  config: DuelConfig,
  verdicts: readonly VerdictEntry[],
): BySide<AmmoSource> {
  const answering = answeringSides(config.opponent);
  const sourceFor = (side: DuelSide): AmmoSource => {
    if (answering.includes(side)) {
      const entry = verdicts.find((candidate) => candidate.side === side);
      if (!entry) {
        throw new Error(`no committed verdict for answering side ${side}`);
      }
      return { kind: "VERDICT", verdict: entry.verdict.kind };
    }
    if (config.opponent.kind === "BOSS") {
      return { kind: "AUTHORED", bullets: config.opponent.profile.magazinePerRound };
    }
    throw new Error(`side ${side} neither answers nor has an authored magazine`);
  };
  return { A: sourceFor("A"), B: sourceFor("B") };
}

function grantBullets(state: VerdictCommittedState): Stepped<BulletsGrantedState> {
  const grants: BySide<BulletGrant> = {
    A: grantRoundBullets({
      source: state.ammoSources.A,
      unspentFromPreviousRound: state.combat.fighters.A.ammo,
      policy: state.config.carryPolicy,
    }),
    B: grantRoundBullets({
      source: state.ammoSources.B,
      unspentFromPreviousRound: state.combat.fighters.B.ammo,
      policy: state.config.carryPolicy,
    }),
  };
  let combat = loadMagazine(state.combat, "A", grants.A.magazine);
  combat = loadMagazine(combat, "B", grants.B.magazine);
  const clock = resumeFieldClock(state.clock);
  const next: BulletsGrantedState = {
    phase: "BULLETS_GRANTED",
    round: state.round,
    grants,
    resumesAtTick: clock.tick + RESUME_COUNTDOWN_TICKS,
    config: state.config,
    params: state.params,
    clock,
    combat,
    engagementTicks: state.engagementTicks,
  };
  return {
    state: next,
    events: [
      { type: "BULLETS_GRANTED", round: state.round, side: "A", grant: grants.A },
      { type: "BULLETS_GRANTED", round: state.round, side: "B", grant: grants.B },
    ],
  };
}

function stepBulletsGranted(
  state: BulletsGrantedState,
  tick: number,
): Stepped<BulletsGrantedState | EngagementLiveState> {
  if (tick < state.resumesAtTick) {
    return { state: withTick(state, tick), events: [] };
  }
  const next: EngagementLiveState = {
    phase: "ENGAGEMENT_LIVE",
    round: state.round,
    endsAtTick: tick + ENGAGEMENT_TICKS,
    config: state.config,
    params: state.params,
    clock: { ...state.clock, tick },
    combat: state.combat,
    engagementTicks: state.engagementTicks,
  };
  return {
    state: next,
    events: [{ type: "ENGAGEMENT_OPENED", round: state.round, tick }],
  };
}

function stepEngagement(
  state: EngagementLiveState,
  tick: number,
  intents: PartialIntents,
): Stepped<EngagementLiveState | LineOfSightBreakState | RoundResolvedState> {
  const resolvedIntents = resolveIntents(state, intents);
  const stepped = stepCombat(
    state.config.world,
    state.combat,
    resolvedIntents,
    state.params,
    state.round,
  );
  const base: EngagementLiveState = {
    ...state,
    clock: { ...state.clock, tick },
    combat: stepped.state,
    engagementTicks: state.engagementTicks + 1,
  };
  const events = [...stepped.events];

  const downed = DUEL_SIDES.find((side) => isDowned(stepped.state.fighters[side]));
  if (downed) {
    const resolved = resolveRound(base, tick);
    return { state: resolved.state, events: [...events, ...resolved.events] };
  }
  if (tick >= state.endsAtTick) {
    const unspent: BySide<number> = {
      A: stepped.state.fighters.A.ammo,
      B: stepped.state.fighters.B.ammo,
    };
    const next: LineOfSightBreakState = {
      phase: "LINE_OF_SIGHT_BREAK",
      round: state.round,
      endsAtTick: tick + LINE_OF_SIGHT_BREAK_TICKS,
      unspent,
      config: base.config,
      params: base.params,
      clock: base.clock,
      combat: base.combat,
      engagementTicks: base.engagementTicks,
    };
    events.push({
      type: "LINE_OF_SIGHT_BROKEN",
      round: state.round,
      tick,
      unspentA: unspent.A,
      unspentB: unspent.B,
    });
    return { state: next, events };
  }
  return { state: base, events };
}

function stepLineOfSightBreak(
  state: LineOfSightBreakState,
  tick: number,
): Stepped<LineOfSightBreakState | RoundResolvedState> {
  if (tick < state.endsAtTick) {
    return { state: withTick(state, tick), events: [] };
  }
  return resolveRound(withTick(state, tick), tick);
}

function resolveRound(
  state: EngagementLiveState | LineOfSightBreakState,
  tick: number,
): Stepped<RoundResolvedState> {
  const unspent =
    state.phase === "LINE_OF_SIGHT_BREAK"
      ? state.unspent
      : { A: state.combat.fighters.A.ammo, B: state.combat.fighters.B.ammo };
  const summary: RoundSummary = {
    round: state.round,
    healthA: state.combat.fighters.A.health,
    healthB: state.combat.fighters.B.health,
    unspentA: unspent.A,
    unspentB: unspent.B,
  };
  const next: RoundResolvedState = {
    phase: "ROUND_RESOLVED",
    round: state.round,
    summary,
    config: state.config,
    params: state.params,
    clock: { ...state.clock, tick },
    // The carry policy is applied when the next round's bullets are granted, so
    // the unspent count survives here and is consumed by grantBullets.
    combat: state.combat,
    engagementTicks: state.engagementTicks,
  };
  return { state: next, events: [{ type: "ROUND_RESOLVED", summary }] };
}

/**
 * The termination rule, and the whole of what "unbounded" means in this machine.
 *
 * A duel ends when somebody's health reaches zero. Full stop — there is no round
 * budget to run out of, so the loop's exit condition is `downed.length > 0` and the
 * ceiling below is a safety net rather than a rule of the game. Reaching the
 * ceiling is not a designed outcome; it means neither fighter could finish, and the
 * healthier one takes it on the same health-fraction comparison the old
 * rounds-exhausted path used.
 *
 * IT IS ALSO THE ONE BRANCH THAT WOULD MAKE THE DUEL ASK EVERY OTHER ROUND, AND IT
 * DELIBERATELY DOES NOT. A fun audit proposed exactly that change here — open rounds
 * 2, 4, 6 straight into the engagement and let the last verdict's grant stand — on the
 * measurement that typing is about 47% of a duel's wall clock and the longest unbroken
 * stretch of play is 20 seconds at any round count. It would have worked: ~30% typing
 * and a ~41-second play window.
 *
 * It was rejected on the mechanism rather than the rhythm. A question every round is
 * what keeps each round's bullets EARNED BY THAT ROUND'S QUESTION; under alternating,
 * half of every fight runs on ammunition earned by an answer given a minute earlier,
 * which loosens the exact coupling the mode exists to create. See structure.ts for the
 * full argument. The invariant it leaves behind is worth stating positively, because
 * several things downstream quietly rely on it: A ROUND AND A QUESTION ARE 1:1, so
 * every round the machine reaches has a verdict of its own, and no round is ever fought
 * on a grant it did not earn.
 */
function openNextRoundOrResolve(
  state: RoundResolvedState,
): Stepped<QuestionPendingState | DuelResolvedState> {
  const downed = DUEL_SIDES.filter((side) => isDowned(state.combat.fighters[side]));
  const hitCeiling = state.round >= state.config.roundCeiling;
  if (downed.length > 0 || hitCeiling) {
    const outcome = decideOutcome(state, downed);
    const next: DuelResolvedState = {
      phase: "DUEL_RESOLVED",
      round: state.round,
      outcome,
      config: state.config,
      params: state.params,
      clock: pauseFieldClock(state.clock),
      combat: state.combat,
      engagementTicks: state.engagementTicks,
    };
    return { state: next, events: [{ type: "DUEL_RESOLVED", outcome }] };
  }
  return openQuestion(state, state.round + 1);
}

function decideOutcome(
  state: RoundResolvedState,
  downed: readonly DuelSide[],
): DuelOutcome {
  const healthA = state.combat.fighters.A.health;
  const healthB = state.combat.fighters.B.health;
  if (downed.length === 1) {
    return {
      winner: otherSide(downed[0]!),
      reason: "KNOCKOUT",
      healthA,
      healthB,
      tiebreak: "NONE",
    };
  }
  if (downed.length === 2) {
    // Both down on the same tick. Zero-sum requires a decision, and hits landed
    // is the only remaining evidence of who fought better.
    return breakTie(state, "KNOCKOUT");
  }
  // Rounds exhausted, so the duel is decided on remaining health as a fraction of
  // each side's own pool. That comparison is identical to "who dealt more damage"
  // — A's fraction beating B's is the same inequality as A's damage dealt beating
  // B's — which is why turtling cannot win here: a fighter who deals nothing and
  // takes nothing draws on fraction and then draws again on hits landed. Using the
  // fraction rather than the raw number is what keeps a 70-health boss comparable
  // to a 100-health player, and it is exact in a PvP mirror match.
  const fractionA = healthA / state.params.A.maxHealth;
  const fractionB = healthB / state.params.B.maxHealth;
  if (Math.abs(fractionA - fractionB) > 1e-9) {
    return {
      winner: fractionA > fractionB ? "A" : "B",
      reason: "ROUNDS_EXHAUSTED",
      healthA,
      healthB,
      tiebreak: "HEALTH",
    };
  }
  return breakTie(state, "ROUNDS_EXHAUSTED");
}

function breakTie(
  state: RoundResolvedState,
  reason: DuelOutcome["reason"],
): DuelOutcome {
  const healthA = state.combat.fighters.A.health;
  const healthB = state.combat.fighters.B.health;
  const hitsA = state.combat.fighters.A.hitsLanded;
  const hitsB = state.combat.fighters.B.hitsLanded;
  if (hitsA !== hitsB) {
    return {
      winner: hitsA > hitsB ? "A" : "B",
      reason,
      healthA,
      healthB,
      tiebreak: "HITS_LANDED",
    };
  }
  return { winner: null, reason, healthA, healthB, tiebreak: "DRAWN" };
}

/**
 * Where side B's will comes from. This is the whole of "one machine, different
 * opponent source": a boss's intent is computed from its profile and the shared
 * seeded RNG, a remote player's arrives with the command.
 */
function resolveIntents(
  state: EngagementLiveState,
  intents: PartialIntents,
): BySide<CombatIntent> {
  const a = intents.A ?? IDLE_INTENT;
  if (state.config.opponent.kind === "REMOTE") {
    return { A: a, B: intents.B ?? IDLE_INTENT };
  }
  const view = combatView(state.config.world, state.combat, "B");
  return {
    A: a,
    B: bossIntent(state.config.opponent.profile, view, state.config.seed),
  };
}

function withTick<T extends DuelState>(state: T, tick: number): T {
  return { ...state, clock: { ...state.clock, tick } };
}

// ---- read models ------------------------------------------------------------

export function currentAmmo(state: DuelState): BySide<number> {
  return { A: state.combat.fighters.A.ammo, B: state.combat.fighters.B.ammo };
}

export function currentHealth(state: DuelState): BySide<number> {
  return {
    A: state.combat.fighters.A.health,
    B: state.combat.fighters.B.health,
  };
}

export function isEngagementLive(state: DuelState): state is EngagementLiveState {
  return state.phase === "ENGAGEMENT_LIVE";
}

export function isAwaitingVerdict(
  state: DuelState,
): state is QuestionPendingState {
  return state.phase === "QUESTION_PENDING";
}

export function duelOutcome(state: DuelState): DuelOutcome | null {
  return state.phase === "DUEL_RESOLVED" ? state.outcome : null;
}
