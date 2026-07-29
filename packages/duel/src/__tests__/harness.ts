// Shared test harness: drives a whole duel to its outcome, one fixed step per
// reducer call, with pluggable verdicts and pluggable intents.
//
// This is also the tuning instrument. The claims in tuning.ts about the
// one-bullet path are checked by running this against the reference arena rather
// than by arithmetic alone, because arithmetic cannot see a boss that dodges.

import { referenceArena, type DuelArena } from "../arena.js";
import { combatView, type CombatIntent, type CombatView } from "../combat.js";
import { FIELD_DT } from "../engine.js";
import type { DuelEvent, DuelOutcome, DuelQuestionRef } from "../events.js";
import {
  createDuel,
  reduceDuel,
  type DuelState,
  type OpponentSource,
  type PartialIntents,
} from "../machine.js";
import { oracleIntent, type OraclePolicyOptions } from "../policy.js";
import type { DuelSide } from "../sides.js";
import { type BulletCarryPolicy } from "../tuning.js";
import { mintVerdict, type CommittedVerdict, type VerdictKind } from "../verdict.js";

/** An authored bank. Not "one per round" any more — a duel can outlast it. */
export function questionSet(size = 18): readonly DuelQuestionRef[] {
  return Array.from({ length: size }, (_unused, index) => ({
    itemId: `BOS.M1.DUEL.ITEM_${index + 1}`,
    itemVersion: "v1",
    conceptId: index % 2 === 0 ? "POSTWAR_REVENUE" : "REPRESENTATION",
  }));
}

/**
 * A bank shaped like a real mission's: `perConcept` authored items for each of
 * `concepts`, which is what the draw's concept ordering acts on.
 *
 * `questionSet` above alternates just two concepts, so it cannot see whether a draw
 * spreads across three — the shape M1 actually ships (three concepts, two items each
 * per attempt). Coverage tests want this one.
 */
export function conceptBank(
  concepts: readonly string[],
  perConcept: number,
): readonly DuelQuestionRef[] {
  const bank: DuelQuestionRef[] = [];
  for (const conceptId of concepts) {
    for (let n = 1; n <= perConcept; n++) {
      bank.push({ itemId: `${conceptId}#ITEM_${n}`, itemVersion: "v1", conceptId });
    }
  }
  return bank;
}

/** M1's per-attempt bank shape: three concepts, two authored items each. */
export const M1_ATTEMPT_CONCEPTS = [
  "BOS.CONCEPT.POSTWAR_REVENUE.v1",
  "BOS.CONCEPT.STAMP_SCOPE.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
] as const;

export function verdictFor(
  kind: VerdictKind,
  item: DuelQuestionRef,
  side: DuelSide,
  round: number,
): CommittedVerdict {
  return mintVerdict({
    kind,
    itemId: item.itemId,
    itemVersion: item.itemVersion,
    source: "CLASSIFIER",
    responseRef: `resp-${side}-r${round}`,
  });
}

export interface RunDuelOptions {
  readonly opponent: OpponentSource;
  readonly verdicts: (side: DuelSide, round: number) => VerdictKind;
  readonly seed?: number;
  /** The termination backstop, not a length. Duels end on health. */
  readonly roundCeiling?: number;
  readonly bankSize?: number;
  /** Drive a specific bank rather than `questionSet(bankSize)`. */
  readonly questions?: readonly DuelQuestionRef[];
  readonly arena?: DuelArena;
  readonly carryPolicy?: BulletCarryPolicy;
  readonly intents?: (side: DuelSide, view: CombatView) => CombatIntent;
  readonly oracleOptions?: OraclePolicyOptions;
  readonly maxSteps?: number;
}

export interface RunDuelResult {
  readonly state: DuelState;
  readonly log: readonly DuelEvent[];
  readonly outcome: DuelOutcome;
  readonly steps: number;
}

export function runDuel(options: RunDuelOptions): RunDuelResult {
  const arena = options.arena ?? referenceArena();
  const created = createDuel({
    duelId: "TEST.DUEL",
    seed: options.seed ?? 20260725,
    world: arena.world,
    opponent: options.opponent,
    questions: options.questions ?? questionSet(options.bankSize ?? 18),
    placement: arena.placement,
    ...(options.roundCeiling ? { roundCeiling: options.roundCeiling } : {}),
    ...(options.carryPolicy ? { carryPolicy: options.carryPolicy } : {}),
  });

  let state: DuelState = created.state;
  const log: DuelEvent[] = [...created.events];
  const intentFor =
    options.intents ??
    ((_side: DuelSide, view: CombatView) => oracleIntent(view, options.oracleOptions));

  // Generous, because a duel has no round count: it runs until a health bar
  // empties, and the machine's own ceiling is what guarantees this terminates.
  const maxSteps = options.maxSteps ?? 400_000;
  let steps = 0;
  while (state.phase !== "DUEL_RESOLVED" && steps < maxSteps) {
    steps += 1;
    if (state.phase === "QUESTION_PENDING") {
      const side = state.awaiting[0]!;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: verdictFor(options.verdicts(side, state.round), state.item, side, state.round),
      });
      if (!result.ok) throw new Error(`verdict rejected: ${result.rejection.code}`);
      state = result.state;
      log.push(...result.events);
      continue;
    }

    const intents: PartialIntents = {};
    if (state.phase === "ENGAGEMENT_LIVE") {
      for (const side of ["A", "B"] as const) {
        if (side === "B" && options.opponent.kind === "BOSS") continue;
        intents[side] = intentFor(side, combatView(arena.world, state.combat, side));
      }
    }
    const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: FIELD_DT, intents });
    if (!result.ok) throw new Error(`advance rejected: ${result.rejection.code}`);
    state = result.state;
    log.push(...result.events);
  }

  if (state.phase !== "DUEL_RESOLVED") {
    throw new Error(`duel did not resolve within ${maxSteps} steps (phase ${state.phase})`);
  }
  return { state, log, outcome: state.outcome, steps };
}

export function countEvents(log: readonly DuelEvent[], type: DuelEvent["type"]): number {
  return log.filter((event) => event.type === type).length;
}

export function bulletsGrantedTo(
  log: readonly DuelEvent[],
  side: DuelSide,
): readonly number[] {
  return log
    .filter((event) => event.type === "BULLETS_GRANTED" && event.side === side)
    .map((event) => (event.type === "BULLETS_GRANTED" ? event.grant.magazine : 0));
}
