// Question text, which the duel core deliberately does not own.
//
// The core's `DuelQuestionRef` carries an item id, an item version and a concept
// id — identity, never content — because the authored bank belongs to the
// curriculum layer and the grading authority holds the rubric. This file is the
// seam: a `DuelItemSource` resolves a ref into the words a player reads.
//
// STUB, AND KNOWINGLY SO. The content compiler that turns Mission-Slate 4.9 into
// typed artefacts has not landed, so the prompts below are transcribed verbatim
// from `content/m1/duel-items.json` — the authored file — under the item ids
// `@pa/mission-m1` and the server's item bank already use. When the compiler lands,
// this map is deleted and `M1_ITEM_SOURCE` becomes a call into it. Nothing else in
// the presentation layer changes.
//
// ALL EIGHTEEN, AND THAT IS THE POINT. This map held six of them, which is the six
// `m1QuestionBank` offered the dev harness — and the harness is the only caller
// that reads its bank from here. A MISSION BRINGS ITS OWN LIST: the brief carries
// `duelQuestionsForAttempt`, which partitions each concept's six authored items
// into three disjoint pairs so that a player's three attempts never repeat a
// question. Twelve of the eighteen were therefore unreachable from the harness and
// perfectly reachable in play, where they rendered as `missingItemContent` — "this
// round's authored item is not in the loaded bank" — in place of the question. The
// server graded them the whole time; its bank has always had all eighteen. Found by
// playing the mission through to its duel, on attempt one, round one.
//
// The rubric, the acceptable answers and the verdict are NOT here and never will
// be. The authored file carries all three next to the prompt, which is exactly why
// this is a transcription and not an import of it: a client that held the rubric
// could grade itself, and grading is server-authoritative because this format
// decides PvP standing.
//
// A DUEL NO LONGER HAS A KNOWN NUMBER OF ROUNDS, so a duel no longer has a known
// number of questions. What a mission hands over is therefore a BANK and never a
// schedule: six authored prompts is a property of the bank and of nothing else, and
// the length of that array is not the length of the fight.
//
// WHICH ITEM ROUND N ASKS IS THE CORE'S DECISION, NOT THIS FILE'S. `askQuestion` in
// the core walks the bank in a seeded permutation, reshuffles for each pass, rotates
// the seam so nothing is asked twice running, and marks a repeat with `appearance`
// and `recycled`. That is selection policy with a determinism requirement attached —
// the PvP authority and a replay must ask the same question on round 40 — so a
// client-side cycler would be a fork of it that silently disagrees. This file
// supplies the words and nothing else.

import type { DuelQuestionRef } from "@pa/duel";
import {
  duelItemCodexCards,
  evidenceHandProjection,
  m1EvidencePolicy,
  type DuelCodexCardRef,
  type EvidenceHandProjection,
} from "@pa/mission-m1";

export interface DuelItemContent {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly conceptId: string;
  /** Short label for the round kicker, e.g. "postwar revenue". */
  readonly conceptLabel: string;
  readonly prompt: string;
  /**
   * The Codex cards this question draws on — id and title only, the safe projection
   * from @pa/mission-m1. It is PROVENANCE, not a reward: it tells the player which of
   * their learned cards the officer is testing, and is derived from the item id (the
   * server-authoritative selection), never from anything the client chooses. The card
   * PROPOSITION is deliberately absent, because it usually contains the answer.
   */
  readonly codexCards: readonly DuelCodexCardRef[];
  /**
   * The offered evidence hand for this item — the ids to deal, the minimum to place,
   * and the most that may be placed. The SAFE PROJECTION only: which cards are
   * relevant is never here, so nothing the client renders can reveal the answer before
   * grading. Deterministic in the item id (the server-authoritative selection), so the
   * hand the player is dealt is exactly the one the server validates the submission
   * against.
   */
  readonly evidence: EvidenceHandProjection;
}

export interface DuelItemSource {
  get(ref: DuelQuestionRef): DuelItemContent | null;
}

const CONCEPT_LABELS: Readonly<Record<string, string>> = {
  "BOS.CONCEPT.POSTWAR_REVENUE.v1": "postwar revenue",
  "BOS.CONCEPT.STAMP_SCOPE.v1": "stamp scope",
  "BOS.CONCEPT.REPRESENTATION.v1": "representation",
};

interface AuthoredItem {
  readonly itemId: string;
  readonly conceptId: string;
  readonly prompt: string;
}

/**
 * All eighteen authored prompts, in the authored order: six per concept, and each
 * concept's six in the pair order the attempt partition walks.
 *
 * The prompts are the officer's own words as written, not paraphrases. The shorter
 * versions this file used to carry were a summary of six of them, and a summary is
 * a different question — several of these turn on how they are put ("a bare yes or
 * no earns you nothing"), and the server grades the authored item.
 */
const M1_AUTHORED: readonly AuthoredItem[] = [
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt:
      "This town has stood a hundred and thirty years and Parliament never wanted a penny of it. Why is it reaching into Boston for money now?",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt:
      "The war with France ended two years ago and Britain won it. What problem did that victory leave Britain holding, and how is Parliament trying to solve it on my board?",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt:
      "Say plainly who Parliament decided should help pay this down, and what that money is meant to clear.",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.WHICH_CAME_FIRST.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt: "Which came first, the debt or the tax? And which one is the answer to the other?",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt:
      "A printer told me this Act came out of nowhere, that Parliament woke one morning and invented it to spite you. Start at the end of the war and show me it did not.",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1",
    conceptId: "BOS.CONCEPT.POSTWAR_REVENUE.v1",
    prompt:
      "Here is what I cannot follow. The debt is owed in London. The stamp is paid in Boston. Give me the line that joins those two.",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.DEED_OR_CLOTH.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt:
      "Two things on this table: a deed drawn up in court, and a bolt of cloth off a ship. Come November one of them needs the Crown's paid stamp. Which is it, and what makes you sure?",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt:
      "Parliament passed this Act back in the spring, so the law is already made. Then why is this town still free to stand at my board and argue about it tonight, instead of already paying the stamp? What has not happened yet?",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.WHY_A_PRINTER.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt:
      "Of every trade in Boston, the coopers, the ropemakers, the fishmongers, why does this Act fall hardest on the shop you run for?",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.CORRECT_THE_APPRENTICE.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt:
      "My apprentice has it that this Act taxes everything Boston buys, bread, cloth, nails, the lot. Correct him.",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.NAME_TWO.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt: "Name me two things in this town that will need the stamp come November.",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.PRIVATE_LETTER.v1",
    conceptId: "BOS.CONCEPT.STAMP_SCOPE.v1",
    prompt:
      "A woman writes to her sister in Salem, in her own hand, and seals it. Does the Act catch that letter? Tell me why; a bare yes or no earns you nothing.",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.WHAT_RIGHT.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "You nailed that sheet to my board and it says this town has been denied a right. Name the right.",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "You write that this town elects nobody. That is false. Boston votes; I have watched it vote. So tell me what Boston does elect, and why that does not settle the matter.",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "Three pence on a sheet of paper. Is this noise about the price, or something else? Name what the objection truly is, and say why this town has the standing to make it.",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.FINISH_THE_CLAIM.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "Finish the claim your sheet makes. A tax on this town may rightly be laid only by whom?",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.SPEAKS_FOR_ALL.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "A member of Parliament told me he speaks for every British subject there is, Boston included, whether Boston voted for him or not. Answer him.",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
    conceptId: "BOS.CONCEPT.REPRESENTATION.v1",
    prompt:
      "Parliament passed this Act by a lawful vote, in the proper form, in the proper place. I have the statute in my hand. On what ground do you still call it unjust?",
  },
];

export const M1_ITEM_VERSION = "v1";

/**
 * M1's authored bank. NOT A ROUND SCHEDULE — the core draws from it in its own
 * seeded order and recycles it openly once a long duel exhausts it.
 *
 * All eighteen the mission authors, so the stand-alone descriptor and the dev
 * harness now draw from the same depth a real attempt can ask from. A mission does
 * not read this: its brief carries the six `duelQuestionsForAttempt` chose. What
 * matters for a mission is that `M1_ITEM_SOURCE` below can resolve any id that list
 * may contain, which is what makes the eighteen load-bearing rather than tidy.
 */
export function m1QuestionBank(): readonly DuelQuestionRef[] {
  return M1_AUTHORED.map((item) => ({
    itemId: item.itemId,
    itemVersion: M1_ITEM_VERSION,
    conceptId: item.conceptId,
  }));
}

const M1_BY_ID = new Map(M1_AUTHORED.map((item) => [item.itemId, item]));

export const M1_ITEM_SOURCE: DuelItemSource = {
  get(ref: DuelQuestionRef): DuelItemContent | null {
    const item = M1_BY_ID.get(ref.itemId);
    if (!item) return null;
    return {
      itemId: item.itemId,
      itemVersion: ref.itemVersion,
      conceptId: item.conceptId,
      conceptLabel: CONCEPT_LABELS[item.conceptId] ?? "this mission's concepts",
      prompt: item.prompt,
      // Keyed by the item id the core selected, so the chips name exactly the cards
      // the graded item draws on. Titles only — never the propositions.
      codexCards: duelItemCodexCards(ref.itemId),
      // The offered hand is derived from the same server-authoritative item id, by the
      // same deterministic policy the server re-derives to grade. Safe projection only.
      evidence: evidenceHandProjection(m1EvidencePolicy(ref.itemId)),
    };
  },
};

/**
 * What to show when the bank cannot resolve a ref. Never a fabricated question:
 * the player is told the content is missing, because a duel that invents a prompt
 * would be grading them on something nobody authored.
 */
export function missingItemContent(ref: DuelQuestionRef): DuelItemContent {
  return {
    itemId: ref.itemId,
    itemVersion: ref.itemVersion,
    conceptId: ref.conceptId,
    conceptLabel: CONCEPT_LABELS[ref.conceptId] ?? "unknown concept",
    prompt: `This round's authored item (${ref.itemId}) is not in the loaded bank.`,
    // An unresolved item still has authored provenance keyed by its id; if even that
    // is unknown this is simply empty, never fabricated.
    codexCards: duelItemCodexCards(ref.itemId),
    // An unknown item deals no hand — the policy resolves no relevant cards — which
    // renders as an empty offer rather than a fabricated one.
    evidence: evidenceHandProjection(m1EvidencePolicy(ref.itemId)),
  };
}

/**
 * Who is asking.
 *
 * A property of the duel, not of the item: the M1 prompts are written as the
 * enforcing officer's own challenges, but the identical items serve PvP, where there
 * is no antagonist and the System asks. So the speaker comes from the opponent the
 * mode actually has.
 */
export function questionSpeaker(mode: "BOSS" | "PVP", opponentName: string): string {
  return mode === "BOSS" ? opponentName : "The System";
}
