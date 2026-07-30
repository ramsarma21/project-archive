import {
  moduleConceptIds,
  type LearningModuleDefinition,
  type ModuleCard,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// Retry ordering.
//
// The module runs in full before every attempt, retries included. What changes
// on a retry is the ORDER: the deck opens on the concepts the last attempt got
// wrong. Same six cards, same three minutes, same cue set — a student who lost
// on representation reads representation first instead of reading four cards to
// reach it for the third time in one sitting.
//
// The reorder is presentation and nothing else, and three invariants are what
// make that safe to do on the client:
//
//   The cue set is untouched, so `moduleRunIsComplete` — and the server's
//   `moduleDeckCovered`, which is the same rule — cannot tell a reordered run
//   from an authored one. Acknowledgement was never keyed by position.
//
//   `moduleId` is untouched, so the completion still names the authored module
//   row rather than a variant of it. There is no second module here to persist.
//
//   Durations travel with their cards, so the deck still totals exactly three
//   minutes. A card's window was measured from its own word count at 140 wpm
//   (see content/m1/module.json's windowRecut), which makes the seconds a
//   property of the card and not of the slot it sits in.
//
// Two kinds of card are pinned rather than permuted, and both identify
// themselves from the data instead of by id:
//
//   A card teaching NO concepts is a frame. M1's are the identity card that
//   gives the player a job and the insertion card whose last line is the
//   constable saying he will ask — one has to open and the other has to close,
//   and neither is a thing a student can be wrong about.
//
//   A card teaching EVERY concept the deck teaches is a synthesis. Leading with
//   "three facts, one chain" before the three facts is incoherent, and ranking
//   by how much a card covers would float a synthesis to the front every time.
// ---------------------------------------------------------------------------

/**
 * One round's knowledge evidence, narrowed to what ordering needs.
 *
 * Declared structurally rather than imported from ../mission: that directory
 * imports this one, and naming its types here would close the cycle. The duel's
 * round report satisfies this as it stands.
 *
 * It deliberately names neither a round number nor a bullet count, so the duel's
 * move to open-ended rounds and a 14/7 economy reaches this file as a different
 * number of entries and nothing more.
 */
export interface ModuleConceptVerdict {
  readonly conceptId: string;
  /**
   * Widened past the duel's current `"CORRECT" | "WRONG"` on purpose. Anything
   * that is not a clear pass counts as missed below, so a verdict this file has
   * never heard of re-teaches the concept rather than being dropped, and adding
   * one upstream cannot silently stop the reorder from firing.
   */
  readonly verdict: string;
}

/**
 * Prior knowledge evidence per mission.
 *
 * Keyed by mission rather than read from the session's single `lastResult`,
 * because the two diverge the moment a player fails M1, plays something else,
 * and comes back: `lastResult` would then describe the wrong mission. Mostly
 * that misfires harmlessly — foreign concept ids match no card and the deck
 * keeps its authored order — but SPIRAL concepts are reinforced across chapters
 * by design, so the ids genuinely do recur and the collision is real.
 */
export interface ModuleKnowledgeLedger {
  readonly byMission: Readonly<Record<string, readonly ModuleConceptVerdict[]>>;
}

export const EMPTY_MODULE_KNOWLEDGE: ModuleKnowledgeLedger = { byMission: {} };

/** Records one resolved attempt's evidence, replacing that mission's previous. */
export function recordMissionKnowledge(
  ledger: ModuleKnowledgeLedger,
  missionId: string,
  rounds: readonly ModuleConceptVerdict[],
): ModuleKnowledgeLedger {
  return {
    byMission: { ...ledger.byMission, [missionId]: [...rounds] },
  };
}

export function knowledgeForMission(
  ledger: ModuleKnowledgeLedger,
  missionId: string,
): readonly ModuleConceptVerdict[] {
  return ledger.byMission[missionId] ?? [];
}

/**
 * How many times each concept was missed. Absent means never missed.
 *
 * A concept asked twice and answered right once is still missed, which matches
 * @pa/contracts' mastery rule — `summarizeAssessmentForm` marks a concept
 * mastered only when every item served for it was correct. A retry deck that
 * disagreed with the mastery table about what a student knows would be teaching
 * against the record.
 */
export function missedConceptTally(
  rounds: readonly ModuleConceptVerdict[],
): Map<string, number> {
  const tally = new Map<string, number>();
  for (const round of rounds) {
    if (round.verdict === "CORRECT") continue;
    tally.set(round.conceptId, (tally.get(round.conceptId) ?? 0) + 1);
  }
  return tally;
}

/** Whether this card may be permuted. See the header: frames and syntheses stay. */
function isMovable(card: ModuleCard, deckConceptCount: number): boolean {
  return card.conceptIds.length > 0 && card.conceptIds.length < deckConceptCount;
}

/** Total misses across everything this card teaches. Zero for a clean concept. */
function missWeight(
  card: ModuleCard,
  missed: ReadonlyMap<string, number>,
): number {
  let weight = 0;
  for (const conceptId of card.conceptIds) weight += missed.get(conceptId) ?? 0;
  return weight;
}

/**
 * The deck re-laid onto contiguous windows, each card keeping its own duration.
 *
 * Keyed by card id because the format's defect check already refuses a deck with
 * a duplicate one. The total is preserved for free: same durations, same sum.
 */
function withRecutWindows(
  authored: readonly ModuleCard[],
  ordered: readonly ModuleCard[],
): ModuleCard[] {
  const durations = new Map<string, number>();
  let previous = 0;
  for (const card of authored) {
    durations.set(card.id, card.throughSeconds - previous);
    previous = card.throughSeconds;
  }

  let through = 0;
  return ordered.map((card) => {
    through += durations.get(card.id) ?? 0;
    return { ...card, throughSeconds: through };
  });
}

/**
 * Said in the retry's own voice, and only when the deck actually moved.
 *
 * A student who has read this deck once and is shown a different order needs to
 * know the difference is deliberate, and the subtitle is the module's one line
 * of framing. Authored copy otherwise belongs to the content file; if a chapter
 * wants its own wording here, the right home is a `retrySubtitle` on the
 * envelope rather than more strings in this function.
 */
const RETRY_SUBTITLE = "It opens again on what you missed.";

/**
 * The deck a retry should read, given what the last attempt got wrong.
 *
 * Returns the definition UNCHANGED — the same reference, so nothing downstream
 * re-renders — whenever there is nothing to act on. That covers both cases the
 * design cares about, and covers them through the ranking rather than through a
 * special case:
 *
 *   A first attempt has no evidence at all, so no concept carries a miss, every
 *   card weighs zero, and the authored order is what a stable sort of equal
 *   weights returns.
 *
 *   An attempt lost on mechanics with every question right produces evidence in
 *   which nothing is missed, which is the same zero-weight deck. A student who
 *   knew the material is not handed a shuffled deck as a consolation prize.
 */
export function retryOrderedModule(
  definition: LearningModuleDefinition | undefined,
  priorRounds: readonly ModuleConceptVerdict[] | undefined,
): LearningModuleDefinition | undefined {
  if (!definition) return definition;

  const missed = missedConceptTally(priorRounds ?? []);
  if (missed.size === 0) return definition;

  const cards = definition.cards;
  const deckConceptCount = moduleConceptIds(definition).length;

  // The slots the permutation may write to. Every other index keeps its card,
  // which is what holds the frames at the two ends.
  const slots: number[] = [];
  cards.forEach((card, at) => {
    if (isMovable(card, deckConceptCount)) slots.push(at);
  });
  if (slots.length < 2) return definition;

  // Most-missed first, authored order as the tiebreak. The tiebreak is explicit
  // rather than leaning on sort stability, and it is also what keeps the
  // untouched concepts in the sequence their author built them in.
  const ordered = slots
    .map((index) => ({ index, weight: missWeight(cards[index]!, missed) }))
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map((entry) => entry.index);

  if (ordered.every((index, at) => index === slots[at])) return definition;

  const next = [...cards];
  slots.forEach((slot, at) => {
    next[slot] = cards[ordered[at]!]!;
  });

  return {
    ...definition,
    subtitle: RETRY_SUBTITLE,
    cards: withRecutWindows(cards, next),
  };
}
