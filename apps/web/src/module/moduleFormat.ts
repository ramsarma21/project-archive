import { LEARNING_MODULE_SECONDS } from "@pa/contracts";

// ---------------------------------------------------------------------------
// Learning module definition format.
//
// The module is the game's teaching surface and its mandatory gate: every
// mission attempt, the first and both retries alike, is preceded by one.
// Thirteen more modules are authored against this format after M1, so a module
// is DATA that a single generic player renders — never a component per mission.
//
// Three of the design's rules are load-bearing, and the shape of this file is
// what holds them rather than a reader's discipline:
//
//   Three minutes, never ninety seconds. TARGET_MODULE_SECONDS is the whole
//   length, and three concepts consume it at roughly forty seconds each.
//
//   Zero XP, always. There is no reward field anywhere in this format. XP has
//   exactly one payer — clearing a mission — and a module is not one, so there
//   is nothing here for a later author to set to a small encouraging number.
//
//   Timings are presentation targets, never reading cutoffs. A card carries
//   only where its window ENDS, so the format cannot express a minimum dwell
//   and no future author can turn a target into a lock-out.
// ---------------------------------------------------------------------------

/**
 * Every module is exactly three minutes. @pa/contracts owns the number because
 * the server compares against the same one; this alias exists so authoring code
 * reads in the module's own vocabulary.
 */
export const TARGET_MODULE_SECONDS = LEARNING_MODULE_SECONDS;

/**
 * A quoted primary source. `sourceId` is the authored id the content package
 * resolves, kept here so a compiled package can replace `lines` with its own
 * verified variant without the player changing.
 *
 * Lines are verbatim. Runtime never generates or paraphrases a source.
 */
export interface ModuleSourceExcerpt {
  sourceId: string;
  title: string;
  attribution: string;
  lines: readonly string[];
}

/** One screen of instruction. */
export interface ModuleCard {
  id: string;
  /**
   * The authored cue this card raises. Stable across every rewording of the
   * body, which is why acknowledgement and coverage are both tracked by cue id
   * rather than by card index or by prose.
   */
  cueId: string;
  /**
   * End of this card's presentation target, in whole seconds from module start.
   * The start is the previous card's end — see `moduleCardWindows` — so a window
   * cannot drift out of step with its neighbour, and the last card's value is
   * the module's whole length.
   */
  throughSeconds: number;
  /** What the card is about, in the panel kicker's voice. */
  kicker: string;
  /** The authored instruction, one paragraph per proposition. */
  body: readonly string[];
  /** Carried by a synthesis card; most cards have none. */
  excerpt?: ModuleSourceExcerpt;
  /**
   * Concepts taught here. A frame card — identity, insertion — teaches none and
   * says so with an empty set rather than by being absent from a list.
   */
  conceptIds: readonly string[];
  /**
   * Codex propositions this card is the sole source for. Every question the
   * following duel may ask has to be answerable from this module alone, so this
   * is the field that makes the claim checkable instead of asserted.
   */
  codexCardIds: readonly string[];
  /** The authored label on the advance control. */
  advanceLabel: string;
}

export interface LearningModuleDefinition {
  moduleId: string;
  chapterId: string;
  /** The mission this module gates. One module per mission. */
  missionId: string;
  title: string;
  /** The System's framing line, above the deck. */
  subtitle: string;
  cards: readonly ModuleCard[];
}

/** A card with its derived presentation window. */
export interface ModuleCardWindow {
  card: ModuleCard;
  index: number;
  fromSeconds: number;
  throughSeconds: number;
}

/**
 * The deck with each card's window resolved. Windows are contiguous by
 * construction: a card begins where the one before it ended.
 */
export function moduleCardWindows(
  definition: LearningModuleDefinition,
): ModuleCardWindow[] {
  let from = 0;
  return definition.cards.map((card, index) => {
    const window: ModuleCardWindow = {
      card,
      index,
      fromSeconds: from,
      throughSeconds: card.throughSeconds,
    };
    from = card.throughSeconds;
    return window;
  });
}

/** The module's whole target length: where its last card's window ends. */
export function moduleTargetSeconds(definition: LearningModuleDefinition): number {
  return definition.cards.at(-1)?.throughSeconds ?? 0;
}

/** Every concept the deck teaches, in first-taught order. */
export function moduleConceptIds(definition: LearningModuleDefinition): string[] {
  const seen = new Set<string>();
  for (const card of definition.cards) {
    for (const conceptId of card.conceptIds) seen.add(conceptId);
  }
  return [...seen];
}

/** Every Codex proposition the deck sources, in first-taught order. */
export function moduleCodexCardIds(definition: LearningModuleDefinition): string[] {
  const seen = new Set<string>();
  for (const card of definition.cards) {
    for (const cardId of card.codexCardIds) seen.add(cardId);
  }
  return [...seen];
}

/** m:ss, for a clock readout and for a window caption. */
export function formatModuleClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Everything wrong with an authored definition, as sentences.
 *
 * Thirteen modules are authored against this format by hand, and the failures
 * that matter are all silent ones: a window that overlaps its neighbour, a
 * duplicated cue id that makes two cards indistinguishable to the gate, a deck
 * that adds up to something other than three minutes. Each is a content defect
 * to report rather than a runtime error to throw, so this returns them all.
 */
export function moduleDefinitionDefects(
  definition: LearningModuleDefinition,
): string[] {
  const defects: string[] = [];
  const { cards } = definition;

  if (cards.length === 0) {
    defects.push("the deck has no cards");
    return defects;
  }

  const ids = new Set<string>();
  const cueIds = new Set<string>();
  let previousThrough = 0;

  for (const card of cards) {
    if (ids.has(card.id)) defects.push(`duplicate card id ${card.id}`);
    ids.add(card.id);
    if (cueIds.has(card.cueId)) defects.push(`duplicate cue id ${card.cueId}`);
    cueIds.add(card.cueId);

    if (!Number.isInteger(card.throughSeconds)) {
      defects.push(`${card.id} has a non-integer window end`);
    } else if (card.throughSeconds <= previousThrough) {
      defects.push(
        `${card.id} ends at ${card.throughSeconds}s, which is not after the ` +
          `previous card's ${previousThrough}s`,
      );
    }
    previousThrough = card.throughSeconds;

    if (card.body.length === 0) defects.push(`${card.id} teaches nothing`);
    if (card.advanceLabel.trim() === "") {
      defects.push(`${card.id} has no advance label`);
    }
  }

  const total = moduleTargetSeconds(definition);
  if (total !== TARGET_MODULE_SECONDS) {
    defects.push(
      `the deck targets ${total}s; every module is exactly ` +
        `${TARGET_MODULE_SECONDS}s`,
    );
  }

  return defects;
}
