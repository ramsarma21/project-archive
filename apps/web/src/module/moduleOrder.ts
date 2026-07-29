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
  /**
   * Whether this round was actually graded. An infrastructure grant — a grading
   * outage that credited the answer without the classifier running — carries
   * `false`, and such a round is NEVER evidence, either way: a concept whose only
   * "correct" came from an outage must still be re-taught. Absent means graded,
   * so a genuine round recorded before this field existed keeps counting.
   *
   * This is only read by the remediation narrowing (`understoodConcepts`), not by
   * `missedConceptTally`/`retryOrderedModule`, which replay the WHOLE deck and so
   * cannot silently skip a concept an outage falsely credited.
   */
  readonly graded?: boolean;
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
const RETRY_SUBTITLE = "Three minutes again. It opens on what you missed.";

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

// ===========================================================================
// Remediation subset playback (INERT — nothing calls this yet).
//
// The next step on the same rail as `retryOrderedModule`. Today a redo replays
// the FULL deck reordered to open on what was missed. This builds the SUBSET a
// redo could play instead: only the concepts the student has not shown they
// understand, bracketed by the deck's own frames.
//
// It ships inert on purpose (exactly as `retryOrderedModule` first did), because
// wiring it is a cross-lane change: a subset run only acknowledges its own cards,
// and `completeModuleRun` + the server's re-derived required set demand the WHOLE
// cue/check set, so a subset cannot mint a completion and the mission would stay
// locked. That completion contract is `apps/api` + `packages/contracts` and is
// routed to those lanes (see the remediation plan §6 slice 2). Until then this is
// a pure, tested transform with a coherence gate in front of it.
//
// THE LOAD-BEARING INVARIANT: absent evidence means TEACH, never skip. A concept
// leaves the reteach set only on POSITIVE, GRADED, correct evidence — never on an
// empty record and never on an outage grant. `remediationDeck` is written as a
// narrowing of the full concept set for exactly this reason: there is no branch
// where a missing record produces a skip.
// ===========================================================================

/** Said in the remediation pass's own voice. */
const REMEDIATION_SUBTITLE = "Three minutes, cut to what you missed.";

/** The deck grouped into the three structural kinds the reorder already knows. */
export interface ModuleSegments {
  /** Cards teaching no concept: the opening/closing bookends. */
  readonly frames: readonly ModuleCard[];
  /** Cards teaching some-but-not-all concepts: the movable concept segments. */
  readonly conceptSegments: readonly ModuleCard[];
  /** Cards teaching every concept the deck teaches: the synthesis. */
  readonly synthesis: readonly ModuleCard[];
}

/**
 * Groups the deck by the same frame/synthesis/concept classification the reorder
 * pins on, so a subset builder never has to re-derive "which card is a bookend".
 */
export function moduleSegments(definition: LearningModuleDefinition): ModuleSegments {
  const deckConceptCount = moduleConceptIds(definition).length;
  const frames: ModuleCard[] = [];
  const conceptSegments: ModuleCard[] = [];
  const synthesis: ModuleCard[] = [];
  for (const card of definition.cards) {
    if (card.conceptIds.length === 0) frames.push(card);
    else if (card.conceptIds.length >= deckConceptCount) synthesis.push(card);
    else conceptSegments.push(card);
  }
  return { frames, conceptSegments, synthesis };
}

/**
 * The concepts a student has POSITIVELY shown they understand, so they are
 * eligible to be narrowed out of a reteach.
 *
 * The standard (remediation plan §4): `>= 1` graded-correct AND `0` graded-wrong.
 * Infrastructure-grant rounds (`graded === false`) are dropped before counting,
 * so they are evidence NEITHER way — a concept whose only "correct" came from an
 * outage has zero graded-correct signals and is therefore NOT understood, i.e. it
 * is re-taught. Any graded-wrong round disqualifies the concept, matching the
 * repo's mastery rule that "asked twice, right once" is not mastery.
 */
export function understoodConcepts(
  rounds: readonly ModuleConceptVerdict[],
): Set<string> {
  const gradedCorrect = new Map<string, number>();
  const gradedWrong = new Map<string, number>();
  for (const round of rounds) {
    // An ungraded (outage-granted) round is not evidence either way.
    if (round.graded === false) continue;
    const bucket = round.verdict === "CORRECT" ? gradedCorrect : gradedWrong;
    bucket.set(round.conceptId, (bucket.get(round.conceptId) ?? 0) + 1);
  }
  const understood = new Set<string>();
  for (const [conceptId, correct] of gradedCorrect) {
    if (correct >= 1 && (gradedWrong.get(conceptId) ?? 0) === 0) {
      understood.add(conceptId);
    }
  }
  return understood;
}

/**
 * The concepts a redo should re-teach: the deck's concepts MINUS the ones
 * positively understood. Empty/undefined evidence narrows nothing, so the whole
 * set comes back — the teach-everything default, expressed as a narrowing rather
 * than a special case.
 */
export function reteachConcepts(
  definition: LearningModuleDefinition,
  priorRounds: readonly ModuleConceptVerdict[] | undefined,
): Set<string> {
  const understood = understoodConcepts(priorRounds ?? []);
  return new Set(moduleConceptIds(definition).filter((c) => !understood.has(c)));
}

/**
 * The deck a redo should PLAY, narrowed to the concepts still owed understanding.
 *
 * Returns the authored definition UNCHANGED whenever there is nothing to narrow —
 * both when nothing is understood (first run, all-granted, all-wrong: reteach is
 * the whole set) and when everything is understood (reteach is empty). A subset is
 * built ONLY for a proper, non-empty partial reteach. This is where "teach
 * everything on absent/ungraded evidence" is guaranteed structurally.
 *
 * A subset always includes the opening and closing frames (so it opens on the
 * ESTABLISH room shot — `planCardShots` keys that off card index 0 — and ends on
 * the mission hand-off), the concept card for every reteach concept, and the
 * synthesis only when two or more concepts are retaught. Windows travel with their
 * cards via `withRecutWindows`; the subset deliberately no longer totals 180s,
 * because it is a PLAYBACK object, not an authorable module.
 */
export function remediationDeck(
  definition: LearningModuleDefinition | undefined,
  priorRounds: readonly ModuleConceptVerdict[] | undefined,
): LearningModuleDefinition | undefined {
  if (!definition) return definition;

  const concepts = moduleConceptIds(definition);
  const reteach = reteachConcepts(definition, priorRounds);
  // Nothing to narrow: teach everything (identical default to retryOrderedModule).
  if (reteach.size === 0 || reteach.size === concepts.length) return definition;

  const deckConceptCount = concepts.length;
  const openingFrame = definition.cards.find((c) => c.conceptIds.length === 0);
  const closingFrame = [...definition.cards]
    .reverse()
    .find((c) => c.conceptIds.length === 0);
  const includeSynthesis = reteach.size >= 2;

  const kept = definition.cards.filter((card) => {
    if (card.conceptIds.length === 0) {
      return card === openingFrame || card === closingFrame;
    }
    if (card.conceptIds.length >= deckConceptCount) {
      return includeSynthesis;
    }
    return card.conceptIds.some((conceptId) => reteach.has(conceptId));
  });

  return {
    ...definition,
    subtitle: REMEDIATION_SUBTITLE,
    cards: withRecutWindows(definition.cards, kept),
  };
}

/**
 * STRUCTURAL coherence defects that would make a subset play incoherently — the
 * hard gate. A subset with any of these must never be played; `remediationDeck`
 * is built so its output has none, and the gate is the proof (and the backstop
 * for any future caller that assembles a subset by hand).
 *
 * Detects the three couplings the plan named:
 *   · OPENING: the first card must be a frame, or card 0's hardcoded ESTABLISH
 *     shot (in `planCardShots`) would misframe a concept card as the room.
 *   · SYNTHESIS: an "all concepts" card ("three facts, one chain") needs at least
 *     two of its facts present to be coherent.
 *   · DANGLING CHECK: a check may not gate on a concept no included card teaches.
 */
export function remediationCoherenceDefects(
  full: LearningModuleDefinition,
  subset: LearningModuleDefinition,
): string[] {
  const defects: string[] = [];
  // Synthesis is classified against the FULL deck's concept count, not the
  // subset's: in a single-concept subset the one concept card teaches "all" of
  // the subset's concepts and would otherwise look like a synthesis.
  const deckConceptCount = moduleConceptIds(full).length;
  const cards = subset.cards;

  if (cards.length === 0) {
    defects.push("subset has no cards");
    return defects;
  }
  if (cards[0]!.conceptIds.length !== 0) {
    defects.push(
      `subset opens on ${cards[0]!.id}, a concept card; card 0 is forced to the ` +
        "ESTABLISH room shot and would misframe it. Include the opening frame.",
    );
  }

  const conceptSegmentCount = cards.filter(
    (c) => c.conceptIds.length > 0 && c.conceptIds.length < deckConceptCount,
  ).length;
  const hasSynthesis = cards.some((c) => c.conceptIds.length >= deckConceptCount);
  if (hasSynthesis && conceptSegmentCount < 2) {
    defects.push(
      "subset includes the synthesis card but fewer than two concept segments; " +
        '"three facts, one chain" is incoherent without at least two of its facts',
    );
  }

  const taught = new Set(cards.flatMap((c) => c.conceptIds));
  for (const card of cards) {
    const conceptId = card.check?.conceptId;
    if (conceptId && !taught.has(conceptId)) {
      defects.push(
        `${card.id}'s check gates on ${conceptId}, which no included card teaches`,
      );
    }
  }
  return defects;
}

/** A demonstrative back-reference in narration, e.g. "this tax", "that debt". */
const REFERENT_MARKER = /\b(this|that|the)\s+(tax|act|duty|stamp|debt|claim|revenue)\b/i;

/**
 * HEURISTIC, non-fatal detection of narration that refers back to a concept the
 * subset dropped — the "some cards say 'this tax'" coupling. Reported rather than
 * refused: the plan's judgement is that a redo student saw the full deck once this
 * attempt-chain, so a residual referent lands on prior exposure rather than on
 * nothing, and the airtight fix is an authored per-segment lead-in beat (a slice-2
 * content change), not a runtime block. Surfacing them here is what lets an author
 * decide, and keeps the coupling from being invisible.
 *
 * Conservative by design: it only flags a concept card that carries a referent
 * marker when an EARLIER concept card in the authored order was dropped, so the
 * referent could have pointed at the missing one.
 */
export function remediationResidualReferents(
  full: LearningModuleDefinition,
  subset: LearningModuleDefinition,
): string[] {
  const found: string[] = [];
  const keptIds = new Set(subset.cards.map((c) => c.id));
  const conceptCards = full.cards.filter((c) => c.conceptIds.length > 0);
  conceptCards.forEach((card, index) => {
    if (!keptIds.has(card.id)) return;
    const earlierDropped = conceptCards
      .slice(0, index)
      .some((earlier) => !keptIds.has(earlier.id));
    if (!earlierDropped) return;
    const prose = (card.scene?.beats ?? []).map((b) => b.text).join(" ");
    if (REFERENT_MARKER.test(prose)) {
      found.push(
        `${card.id} narration refers back ("${(REFERENT_MARKER.exec(prose) ?? [])[0]}") ` +
          "while an earlier concept card was dropped; consider an authored lead-in beat",
      );
    }
  });
  return found;
}
