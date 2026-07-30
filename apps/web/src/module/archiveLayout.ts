import {
  moduleRequiredCheckIds,
  type LearningModuleDefinition,
  type ModuleCard,
} from "./moduleFormat.js";
import { moduleRunChecksMastered, moduleRunIsComplete } from "./moduleGate.js";

// ---------------------------------------------------------------------------
// The Archive layout (pure, unit-testable).
//
// The lesson is no longer an auto-advancing deck; it is an Archive of case
// files the handler opens, one per concept. The player presses play on a file,
// watches it, answers its one question, and the next file unlocks. Files unlock
// IN ORDER, because the sequence is itself a lesson: a document from 1765 read
// against a 1774 punishment collapses a decade into one grievance, and reading
// the files in order is what stops that.
//
// This file owns the two decisions that make the Archive read like one, as pure
// functions so the whole thing is assertable without a DOM:
//
//   1. WHAT IS A FILE. A case file bundles a document, a generated clip, and one
//      question — which is exactly a concept card that carries a `check`. So the
//      files are DERIVED from the authored deck rather than listed separately: a
//      card with a check is a file, and the cards without one are framing (the
//      opening before the first file, the handoff brief after the last). No
//      second list can drift out of step with the deck.
//
//   2. WHAT UNLOCKS WHEN. A file is DONE when it has been played and its question
//      answered; the next file unlocks only once the current one is DONE. The
//      completion gate is unchanged underneath this framing — see
//      `archiveIsComplete`.
// ---------------------------------------------------------------------------

/** A framing screen: an opening or handoff card that poses no question. */
export interface ArchiveFraming {
  readonly card: ModuleCard;
  /** The card's index in the authored deck, which drives the shot language. */
  readonly deckIndex: number;
}

/** One case file: a concept card that poses exactly one question. */
export interface ArchiveFile {
  readonly card: ModuleCard;
  /** The card's index in the authored deck (drives the shot language). */
  readonly deckIndex: number;
  /** 1-based position among the files, for the index UI. */
  readonly ordinal: number;
}

/** The Archive as the player meets it: an opening, the files, then the brief. */
export interface ArchiveLayout {
  /** Opening framing shown before the files (leading question-less cards). */
  readonly opening: readonly ArchiveFraming[];
  /** The case files, in authored order — one per concept. */
  readonly files: readonly ArchiveFile[];
  /** The handoff into the mission, shown after every file is done. */
  readonly brief: readonly ArchiveFraming[];
}

/**
 * Partition a deck into the Archive's shape.
 *
 * The files are the cards that pose a question (carry a `check`). Everything
 * else is framing: a question-less card BEFORE the first file is opening, and a
 * question-less card from the first file onward is the closing brief — so a
 * synthesis card that sits after the concept cards folds into the handoff, and
 * the deck's own order decides which is which.
 */
export function deriveArchiveLayout(
  definition: LearningModuleDefinition,
): ArchiveLayout {
  const cards = definition.cards;
  const firstFileIndex = cards.findIndex((card) => card.check);
  const opening: ArchiveFraming[] = [];
  const files: ArchiveFile[] = [];
  const brief: ArchiveFraming[] = [];
  let ordinal = 0;
  cards.forEach((card, deckIndex) => {
    if (card.check) {
      ordinal += 1;
      files.push({ card, deckIndex, ordinal });
    } else if (firstFileIndex === -1 || deckIndex < firstFileIndex) {
      opening.push({ card, deckIndex });
    } else {
      brief.push({ card, deckIndex });
    }
  });
  return { opening, files, brief };
}

/** A file is locked until the one before it is done; done once played+answered. */
export type ArchiveFileStatus = "LOCKED" | "READY" | "DONE";

/**
 * A file is DONE when its clip has been played (its cue acknowledged) AND its
 * question answered (its check mastered). It is READY when the file before it is
 * DONE — sequence is the lesson — and LOCKED until then. The very first file is
 * unlocked from the start.
 */
export function archiveFileIsDone(
  file: ArchiveFile,
  acknowledgedCueIds: ReadonlySet<string>,
  masteredCheckIds: ReadonlySet<string>,
): boolean {
  const played = acknowledgedCueIds.has(file.card.cueId);
  const answered = file.card.check ? masteredCheckIds.has(file.card.check.id) : true;
  return played && answered;
}

/** Each file's status, in order, given what has been played and answered. */
export function archiveFileStatuses(
  layout: ArchiveLayout,
  acknowledgedCueIds: Iterable<string>,
  masteredCheckIds: Iterable<string>,
): ArchiveFileStatus[] {
  const cues = new Set(acknowledgedCueIds);
  const checks = new Set(masteredCheckIds);
  return layout.files.map((file, index) => {
    if (archiveFileIsDone(file, cues, checks)) return "DONE";
    const previousDone =
      index === 0 || archiveFileIsDone(layout.files[index - 1]!, cues, checks);
    return previousDone ? "READY" : "LOCKED";
  });
}

/** The next file the player may open, or -1 when none is ready (all done/locked). */
export function nextReadyFileIndex(
  layout: ArchiveLayout,
  acknowledgedCueIds: Iterable<string>,
  masteredCheckIds: Iterable<string>,
): number {
  return archiveFileStatuses(layout, acknowledgedCueIds, masteredCheckIds).indexOf(
    "READY",
  );
}

/** Whether every file has been played and its question answered. */
export function allFilesResolved(
  layout: ArchiveLayout,
  acknowledgedCueIds: Iterable<string>,
  masteredCheckIds: Iterable<string>,
): boolean {
  const cues = new Set(acknowledgedCueIds);
  const checks = new Set(masteredCheckIds);
  return layout.files.every((file) => archiveFileIsDone(file, cues, checks));
}

/**
 * Whether the whole Archive is complete: every file played and every question
 * answered.
 *
 * This is the Archive framing of the SAME gate the server re-derives, not a new
 * one. "Played" is a file's cue acknowledged and "answered" is its check
 * mastered, so this reduces to `moduleRunIsComplete` (the authored deck covered)
 * AND `moduleRunChecksMastered` (every required check answered) — which is what
 * `completeModuleRun` mints its receipt from and what `moduleRequiredCheckIds`
 * hands the server. Moving the presentation to files did not weaken the gate;
 * it renamed its two halves.
 */
export function archiveIsComplete(
  definition: LearningModuleDefinition,
  acknowledgedCueIds: readonly string[],
  masteredCheckIds: readonly string[],
): boolean {
  return (
    moduleRunIsComplete(definition, acknowledgedCueIds) &&
    moduleRunChecksMastered(definition, masteredCheckIds)
  );
}

/** The questions the Archive still owes an answer, by check id. */
export function unansweredQuestionIds(
  definition: LearningModuleDefinition,
  masteredCheckIds: readonly string[],
): string[] {
  const answered = new Set(masteredCheckIds);
  return moduleRequiredCheckIds(definition).filter((id) => !answered.has(id));
}
