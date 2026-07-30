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
  "BOS.CONCEPT.INTOLERABLE_ACTS.v1": "the Coercive Acts",
  "BOS.CONCEPT.REPRESENTATION.v1": "representation",
  "BOS.CONCEPT.MERCANTILISM.v1": "non-importation",
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
    itemId: "BOS.MD01.DUEL.ACTS.WHO_IT_FALLS_ON.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "The Port Act has shut the harbour. Some men put the tea in the water; most of this town never went near it. When the port closes, who does it fall on?",
  },
  {
    itemId: "BOS.MD01.DUEL.ACTS.NOT_A_FINE.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "If Parliament only wanted the tea paid for, it could have fined the men who dumped it, or tried them. It did neither. What did it do instead, and what does the difference tell you?",
  },
  {
    itemId: "BOS.MD01.DUEL.ACTS.WHY_THE_TOWN.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "A loyalist tells you the closure is just: the town let the tea be dumped, so the town should pay. Answer him. Is punishing the whole town for what a crowd did the same as justice?",
  },
  {
    itemId: "BOS.MD01.DUEL.ACTS.STILL_LAWFUL.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "The port is shut, the town meeting is banned, and soldiers are in the parlours. You are about to carry a printed sheet through these streets. Are you breaking any of the four Acts by doing it? Say why.",
  },
  {
    itemId: "BOS.MD01.DUEL.ACTS.FOUR_NOT_ONE.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "People call it 'the Intolerable Act', as if it were one law. It is four. Pick any two of the four, and name what each of those two actually does, kept straight from each other.",
  },
  {
    itemId: "BOS.MD01.DUEL.ACTS.WHICH_ACT.v1",
    conceptId: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    prompt:
      "The selectmen want to call a town meeting to answer the port's closing. A neighbour says they cannot; it is against the law now. Which of the four Acts is he thinking of, and is he right?",
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
      "Say London kept its word and appointed the fairest, most honest men in all England to set Boston's taxes, men who would never take a penny more than the town could bear. Would that answer the claim on your sheet? Tell me who alone may rightly lay a tax here, and why upright men chosen in London still fall short.",
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
  {
    itemId: "BOS.MD01.DUEL.RESIST.HOW_THEY_ANSWER.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "The town cannot fight the Navy and cannot make laws for London. So what is left? What do the colonists actually DO to answer the Acts?",
  },
  {
    itemId: "BOS.MD01.DUEL.RESIST.NOT_WAR.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "A hothead in the crowd says the Continental Congress is meeting to declare war on Britain. Is that what a congress does here? Say what it actually does instead.",
  },
  {
    itemId: "BOS.MD01.DUEL.RESIST.NOT_COUNTERTAX.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "Britain taxes the goods it sends here. A man says the fair answer is simple: the colonies should tax the goods Britain sends, penny for penny, and see how London likes it. Can they? What do they do instead?",
  },
  {
    itemId: "BOS.MD01.DUEL.RESIST.WHY_IT_BITES.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "A boycott sounds like a small thing, just some shopkeepers refusing goods. Why would Parliament, three thousand miles away, ever feel a handful of Boston merchants deciding not to buy?",
  },
  {
    itemId: "BOS.MD01.DUEL.RESIST.THE_COVENANT.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "The sheet in your hand is the Solemn League and Covenant. A signer asks you what, plainly, he is putting his name to. What does signing it commit him to do?",
  },
  {
    itemId: "BOS.MD01.DUEL.RESIST.PETITION_AND_CONGRESS.v1",
    conceptId: "BOS.CONCEPT.MERCANTILISM.v1",
    prompt:
      "Name me the lawful ways this town answers the Acts, the ones that are not a musket. Give me two.",
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
