import {
  FIELD_DT,
  duelClearedMission,
  serialiseCommitLog,
  type DuelEvent,
  type DuelOutcome,
  type DuelQuestionRef,
  type OpponentSource,
} from "@pa/duel";
import type {
  MissionDuelBrief,
  MissionDuelReport,
  MissionDuelRoundReport,
} from "../mission/duelPort.js";
import { M1_MISSION_ID } from "../chapter/m1Mission.js";
import { attachVerdictReceipts, type VerdictReceipt } from "./duelGrading.js";
import { OFFICER_RIG, PLAYER_RIG } from "./m1Duel.js";
import type { DuelDescriptor } from "./DuelScreen.js";

// ---------------------------------------------------------------------------
// The translation between the mission container and this directory.
//
// The container hands over a `MissionDuelBrief` and expects a report back;
// `DuelScreen` runs a fight from a `DuelDescriptor`. Neither was widened to meet
// the other — the brief is a mirror of @pa/duel's `CreateDuelInput` and must stay
// one, and the descriptor is what every other caller of the screen already
// builds — so the translation lives here. It is pure, and it is in its own module
// so a test can drive it without a canvas.
//
// WHAT THE BRIEF IS AUTHORITATIVE ABOUT, and is therefore passed through
// untouched: the duel id, the seed (projected from the server's attempt seed), the
// collision world, where the two fighters stand, the opponent's profile and the
// item bank. Every one of those is simulation input, and a view that adjusted any
// of them would be a second opinion about a fight the server opened.
//
// WHAT THE BRIEF DOES NOT CARRY, and this file therefore owns: what the fight
// LOOKS like — two rigs and the opponent's name. The brief mirrors
// `CreateDuelInput`, which has no notion of a rig, so this is not an omission to
// be fixed by adding fields. It is the line between the fight and the picture of
// it, and it falls in the right place.
//
// FRICTION FOUND, recorded rather than papered over:
//
//   * `brief.rounds` is read by nothing here and cannot be. A duel runs until a
//     health bar empties, so the core takes a round CEILING and not a length, and
//     `DuelRuntimeInput` deliberately omits both. The mission's `ARENA.rounds: 6`
//     is a number the container carries and the duel cannot honour.
//   * The brief has no field for the player's abilities. M1 is Level 0 and holds
//     none, so nothing is lost today, but a later mission's loadout has nowhere to
//     travel and `CreateDuelInput.playerLoadout` is where it would land.
//   * `brief.conceptIds` is the mission's authored concept order and is NOT what
//     the rounds actually asked, so the round reports below take their concepts
//     from `brief.questions` instead — the only list that pairs an item with a
//     concept.
//   * The brief carries no dawn state, so the duel cannot open on the sky the
//     traversal closed on. See DUEL_SKY_LIFT in missionArena.tsx.
//   * `MissionDuelViewProps` has no way to report a duel that cannot be
//     constructed. `onAbandon` is the closest thing and it spends the attempt,
//     which is the honest cost of the container having armed a duel this
//     directory cannot dress — but it charges a content gap to the player, and a
//     `MissionDuelReport` cannot express "not fought".
// ---------------------------------------------------------------------------

/**
 * Who is in the fight, for each mission that has one.
 *
 * The visible cast is content and it is this directory's, because the brief has no
 * field for it and should not: a rig key and a character's name are not inputs to
 * a simulation. Keyed by mission rather than defaulted, so the day MD02 ships its
 * duel says out loud that nobody has cast it instead of quietly sending M1's
 * red-coated officer to the customs house.
 */
export interface MissionCast {
  readonly playerGlbKey: string;
  readonly opponentGlbKey: string;
  /** The name the HUD and the question panel put on the opponent. */
  readonly opponentName: string;
}

export const MISSION_CAST: Readonly<Record<string, MissionCast>> = {
  // Mission-Slate 4.8 calls him the constable and the mission's own boss id says
  // CONSTABLE; the rig the art pipeline produced is a red-coated King's officer.
  // The name follows the rig, because the player can see the coat. That is the
  // same decision m1Duel.ts records for the stand-alone descriptor, and the rigs
  // are imported from there rather than restated, so there is one answer to who
  // M1's duel is between.
  [M1_MISSION_ID]: {
    playerGlbKey: PLAYER_RIG,
    opponentGlbKey: OFFICER_RIG,
    opponentName: "The King's officer",
  },
};

export function missionCast(missionId: string): MissionCast | null {
  return MISSION_CAST[missionId] ?? null;
}

/**
 * The brief, as a descriptor.
 *
 * Two casts and no restructuring, which is exactly what duelPort.ts says this
 * should need: `opponent.profile` is a `BossProfile` and `questions` are
 * `DuelQuestionRef[]`, both owned by @pa/duel, and both are typed `unknown` on the
 * port because @pa/web does not depend on @pa/duel there. It does here.
 */
export function missionDuelDescriptor(
  brief: MissionDuelBrief,
  cast: MissionCast,
): DuelDescriptor {
  return {
    duelId: brief.duelId,
    seed: brief.seed,
    // The world and the placement are the mission's, at the mission's own
    // coordinates. Nothing is recentred: the yard the player dropped into is the
    // yard they fight in, and moving it would break the one thing the level's six
    // break stations were solved against.
    arena: { world: brief.world, placement: brief.placement },
    opponent: brief.opponent as OpponentSource,
    questionBank: brief.questions as readonly DuelQuestionRef[],
    ...cast,
  };
}

/** The concept each item evidences, from the only list that pairs them. */
function conceptsByItem(brief: MissionDuelBrief): Map<string, string> {
  return new Map(
    (brief.questions as readonly DuelQuestionRef[]).map((question) => [
      question.itemId,
      question.conceptId,
    ]),
  );
}

/**
 * One report per round the player answered.
 *
 * SIDE A ONLY, and that is not a simplification. Side B is a boss, whose magazine
 * comes from its authored profile rather than from answering anything — the core's
 * `roundAmmoSources` refuses a verdict-derived magazine for a side that owes no
 * verdict — so a `BULLETS_GRANTED` for B is not knowledge evidence and there is no
 * `VERDICT_COMMITTED` for B to pair it with.
 *
 * `bullets` is `grant.granted`, the number the verdict bought, rather than
 * `grant.magazine`, which is that plus anything carried over the round boundary.
 * The port asks for the figure the reducer derived from the verdict, and under the
 * shipped EXPIRE policy the two are equal — which is precisely why taking the
 * wrong one would never show up.
 */
export function missionDuelRounds(
  brief: MissionDuelBrief,
  commitLog: readonly DuelEvent[],
): MissionDuelRoundReport[] {
  const concepts = conceptsByItem(brief);
  const asked = new Map<number, { itemId: string; verdict: "CORRECT" | "WRONG" }>();
  const granted = new Map<number, number>();

  for (const event of commitLog) {
    if (event.type === "VERDICT_COMMITTED" && event.side === "A") {
      asked.set(event.round, {
        itemId: event.verdict.itemId,
        verdict: event.verdict.kind,
      });
    }
    if (event.type === "BULLETS_GRANTED" && event.side === "A") {
      granted.set(event.round, event.grant.granted);
    }
  }

  return [...asked.keys()]
    .sort((left, right) => left - right)
    .map((round) => {
      const item = asked.get(round)!;
      const conceptId = concepts.get(item.itemId);
      if (conceptId === undefined) {
        // The core draws from the bank the brief supplied, so this cannot happen
        // unless the two came from different places. Loud, because the result
        // screen reads these straight out as the concepts the attempt covered.
        console.error(
          `[duel] round ${round} asked ${item.itemId}, which is not in the brief's bank`,
        );
      }
      return {
        round,
        itemId: item.itemId,
        conceptId: conceptId ?? "",
        verdict: item.verdict,
        // Absent only if the duel ended between the verdict and the grant.
        bullets: granted.get(round) ?? 0,
      };
    });
}

/**
 * What the container is handed back.
 *
 * `won` is `duelClearedMission(outcome)` and nothing else: winning on points
 * clears the mission, that reasoning belongs to @pa/duel, and re-deciding it here
 * would be a second copy of the clear condition.
 *
 * `engagementSeconds` is the core's own `engagementTicks` — the field it keeps for
 * exactly this, "ticks actually spent in engagement: the duel clock the design
 * counts" — converted at the engine's fixed step. Deliberately not measured off
 * the wall clock and not summed out of the event stream: the question phases are
 * untimed, so a wall-clock figure would report how long the student took to type
 * rather than how long the fight lasted.
 */
export function missionDuelReport(input: {
  readonly brief: MissionDuelBrief;
  readonly outcome: DuelOutcome;
  readonly commitLog: readonly DuelEvent[];
  readonly engagementTicks: number;
  /**
   * The grading authority's receipts, joined onto the log's verdict entries.
   *
   * Defaulted so a caller that has none — the dev harness, a stand-in run — still
   * produces a legal report. Every entry then commits `unsigned`, which is the
   * honest description of a verdict no server minted.
   */
  readonly receipts?: readonly VerdictReceipt[];
}): MissionDuelReport {
  return {
    won: duelClearedMission(input.outcome),
    outcome: input.outcome,
    rounds: missionDuelRounds(input.brief, input.commitLog),
    engagementSeconds: input.engagementTicks * FIELD_DT,
    committedEvents: attachVerdictReceipts(
      serialiseCommitLog(input.commitLog),
      input.receipts ?? [],
    ),
  };
}
