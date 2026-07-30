import { beatDurationMs } from "./moduleTimeline.js";
import type {
  LearningModuleDefinition,
  ModuleCard,
  ModuleVisual,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The cinematic director (pure, unit-testable).
//
// The module is a cutscene, not a slideshow of prose cards. This file owns the
// two deterministic decisions that make it read like one, and it owns them as
// pure functions so the whole shot language can be asserted without a DOM, a
// canvas, or a clock:
//
//   1. SUBTITLE GRANULARITY. Authored narration beats are whole spoken
//      thoughts, often two or three sentences long. A cutscene never puts a
//      paragraph on screen, so `segmentBeatText` splits each verbatim beat into
//      short subtitle lines — one short sentence / two lines at a time — WITHOUT
//      changing a single word. The same short line is both spoken and shown.
//
//   2. SHOT SELECTION. `planCardShots` turns a card's beats into an ordered list
//      of segments, each tagged with a camera shot from a small fixed
//      vocabulary. The opening card establishes the room; a beat that carries a
//      historical visual materializes it over the presenter's shoulder and then
//      pushes into it; a beat with no visual holds on the presenter; and the
//      last segment before a mastery check returns to a reaction shot. The
//      selection is a deterministic function of the authored structure, so the
//      first forty-five seconds are guaranteed to move through several materially
//      different compositions.
//
//   3. TRANSITIONS. When a scene finishes, `directorOnSceneEnd` decides whether
//      a mastery check interrupts or the file's scene is over. This USED TO read
//      "playback advances itself — nothing here asks the learner to turn a card",
//      and that is now wrong: the lesson is an ARCHIVE of case files, and the
//      player presses play on each file and answers its question before the next
//      unlocks (`ModuleArchive`). So the between-file advance is the learner's,
//      not automatic. What has NOT changed is inside a file: `directorOnSceneEnd`
//      still returns SHOW_CHECK for an unanswered required check, so the gate is
//      never weakened — the file player treats anything else as "this file is
//      done" and hands control back to the Archive.
// ---------------------------------------------------------------------------

/** Target line length for an on-screen subtitle, in words. */
export const SUBTITLE_TARGET_WORDS = 15;
/** Hard ceiling on a subtitle line; only exceeded by a single unbreakable word run. */
export const SUBTITLE_HARD_MAX_WORDS = 22;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Splits an over-long run purely on whitespace, as a last resort. */
function chunkByWords(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= SUBTITLE_HARD_MAX_WORDS) return [text];
  const out: string[] = [];
  for (let at = 0; at < words.length; at += SUBTITLE_TARGET_WORDS) {
    out.push(words.slice(at, at + SUBTITLE_TARGET_WORDS).join(" "));
  }
  return out;
}

/**
 * Splits a clause that is itself too long, first on commas, then on words.
 *
 * Each comma stays attached to the piece it followed, so a subtitle line that ends
 * at a comma boundary still carries its comma. The earlier version split ON the
 * comma (consuming it) and rejoined the survivors with a comma-space, which dropped
 * the comma from every piece that ended a packed line and so changed the authored
 * words. That is the one thing segmentBeatText promises never to do, and it held
 * before only because authored clauses stayed under the ceiling; moduleShots.test.ts
 * now pins it in the code.
 */
function splitLongClause(clause: string): string[] {
  const pieces = (clause.match(/[^,]+,?/g) ?? [clause])
    .map((piece) => piece.trim())
    .filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const piece of pieces) {
    // `piece` already carries its own trailing comma, so join with a space rather
    // than reinserting one — reinserting is what used to duplicate or drop commas.
    const candidate = current ? `${current} ${piece}` : piece;
    if (current && wordCount(candidate) > SUBTITLE_TARGET_WORDS) {
      lines.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.flatMap(chunkByWords);
}

/**
 * Splits one verbatim narration beat into short subtitle lines.
 *
 * Every word is preserved and its order is unchanged — the meaning of the
 * authored history is untouched; only the on-screen granularity changes. Lines
 * break at strong punctuation first, then greedily pack clauses up to the target
 * length, then fall back to comma and word splitting for a clause that is a
 * run-on all by itself.
 */
export function segmentBeatText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean === "") return [];
  const clauses =
    clean.match(/[^.!?;:—]+[.!?;:—]?/g)?.map((clause) => clause.trim()).filter(Boolean) ??
    [clean];

  const lines: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") lines.push(current.trim());
    current = "";
  };

  for (const clause of clauses) {
    if (wordCount(clause) > SUBTITLE_HARD_MAX_WORDS) {
      flush();
      lines.push(...splitLongClause(clause));
      continue;
    }
    const candidate = current ? `${current} ${clause}` : clause;
    if (current && wordCount(candidate) > SUBTITLE_TARGET_WORDS) {
      flush();
      current = clause;
    } else {
      current = candidate;
    }
  }
  flush();
  return lines.length > 0 ? lines : [clean];
}

// ---------------------------------------------------------------------------
// Shot vocabulary
// ---------------------------------------------------------------------------

/**
 * The cutscene's fixed shot language. Each maps to a presenter-camera framing
 * (below) and a stage layout (in module.css keyed on `data-shot`).
 */
export type ModuleShotKind =
  | "ESTABLISH" // wide, the whole holographic room, presenter small and centred
  | "PRESENTER_MEDIUM" // the presenter, chest-up, addressing the learner
  | "OVER_SHOULDER" // presenter to one side as a historical visual materializes
  | "VISUAL_FOCUS" // the historical visual dominates, restrained pan/zoom
  | "REACTION"; // close on the presenter before a mastery check

/** How a visual enters and holds during its shot. */
export type ModuleVisualMotion = "assemble" | "kenburns" | "none";

/** A single-camera framing for the presenter's transparent canvas. */
export interface PresenterFraming {
  /** Camera position in the presenter's local space (feet at y=0, ~1.72m tall). */
  readonly position: readonly [number, number, number];
  /** Point the camera looks at. */
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

/**
 * The framing for each shot. Every framing is a HEAD-AND-SHOULDERS portrait —
 * the bottom of frame sits at the collarbone, so a presenter's chest and below
 * are out of frame entirely. This is a hard modesty requirement for a grade-8
 * product (the shipped rig wears an open jacket), and it is also simply the
 * right cinematography for a talking-head beat; a replacement asset is being
 * commissioned separately. The camera sits at ~face height (y≈1.63) close in,
 * with a narrow fov so she reads large; only z and fov vary between shots. How
 * the presenter ORIENTS within a framing is owned by presenterGaze; the
 * over-shoulder/visual composition is done by the DOM layout (module.css,
 * data-shot) plus the small camera x offset, so she keeps facing the learner.
 *
 * DO NOT lower `target.y` or widen `fov` past what keeps the frame bottom at the
 * collarbone — that re-exposes the chest. Verify any change against the lesson.
 */
export const PRESENTER_FRAMINGS: Record<ModuleShotKind, PresenterFraming> = {
  ESTABLISH: { position: [0, 1.63, 1.5], target: [0, 1.63, 0], fov: 15 },
  PRESENTER_MEDIUM: { position: [0, 1.63, 1.3], target: [0, 1.63, 0], fov: 17 },
  OVER_SHOULDER: { position: [0.16, 1.63, 1.35], target: [0, 1.63, 0], fov: 16 },
  VISUAL_FOCUS: { position: [0.1, 1.63, 1.45], target: [0, 1.63, 0], fov: 15 },
  REACTION: { position: [0, 1.64, 1.15], target: [0, 1.63, 0], fov: 19 },
};

/** One presented segment: a short subtitle line and the shot that carries it. */
export interface ModuleSegment {
  readonly cardId: string;
  readonly cueId: string;
  readonly beatId: string;
  /** The short, spoken-and-shown line. A slice of one authored beat, verbatim. */
  readonly text: string;
  /** The historical visual on screen during this segment, if any. */
  readonly visual?: ModuleVisual;
  readonly shot: ModuleShotKind;
  readonly visualMotion: ModuleVisualMotion;
}

/**
 * Turns one card into its ordered cutscene segments, each tagged with a shot.
 *
 * The rules are deterministic and structural:
 *   · The very first card opens on an establishing wide.
 *   · A beat that names a visual materializes it over the shoulder on its first
 *     segment, then pushes into a focus shot for the rest of that visual.
 *   · A beat with no visual holds on the presenter (medium), or returns to a
 *     reaction if it follows a visual.
 *   · A card that carries a mastery check ends on a reaction shot with no
 *     visual, so the cutscene "turns to face" the learner before the check.
 */
export function planCardShots(
  card: ModuleCard,
  cardIndex: number,
): ModuleSegment[] {
  const scene = card.scene;
  const beats = scene?.beats ?? [];
  const segments: ModuleSegment[] = [];
  let previousVisualId: string | undefined;

  for (const beat of beats) {
    const visual = beat.visualId
      ? scene?.visuals.find((entry) => entry.id === beat.visualId)
      : undefined;
    for (const line of segmentBeatText(beat.text)) {
      let shot: ModuleShotKind;
      let visualMotion: ModuleVisualMotion = "none";
      if (visual) {
        if (visual.id !== previousVisualId) {
          shot = "OVER_SHOULDER";
          visualMotion = "assemble";
        } else {
          shot = "VISUAL_FOCUS";
          visualMotion = "kenburns";
        }
        previousVisualId = visual.id;
      } else {
        shot = previousVisualId ? "REACTION" : "PRESENTER_MEDIUM";
        previousVisualId = undefined;
      }
      segments.push({
        cardId: card.id,
        cueId: card.cueId,
        beatId: beat.id,
        text: line,
        ...(visual ? { visual } : {}),
        shot,
        visualMotion,
      });
    }
  }

  // A scene-less card (defensive; every authored M1 card has a scene) still
  // presents its first body line so the deck never renders an empty frame.
  if (segments.length === 0) {
    segments.push({
      cardId: card.id,
      cueId: card.cueId,
      beatId: `${card.id}::frame`,
      text: segmentBeatText(card.body[0] ?? card.kicker)[0] ?? card.kicker,
      shot: "PRESENTER_MEDIUM",
      visualMotion: "none",
    });
  }

  // The deck opens on the room, not on a talking head.
  if (cardIndex === 0) {
    segments[0] = { ...segments[0]!, shot: "ESTABLISH", visualMotion: "none" };
    // Drop the establishing shot's visual so the opening reads as the room.
    if (segments[0]!.visual) {
      const { visual: _drop, ...rest } = segments[0]!;
      segments[0] = rest;
    }
  }

  // Return to the presenter before a required check.
  if (card.check) {
    const last = segments.length - 1;
    const { visual: _drop, ...rest } = segments[last]!;
    segments[last] = { ...rest, shot: "REACTION", visualMotion: "none" };
  }

  return segments;
}

/** Every card's segments, in deck order. */
export function planModuleShots(
  definition: LearningModuleDefinition,
): ModuleSegment[][] {
  return definition.cards.map((card, index) => planCardShots(card, index));
}

/** Per-segment presentation durations, from each short line's word count. */
export function segmentDurations(segments: readonly ModuleSegment[]): number[] {
  return segments.map((segment) => beatDurationMs(segment.text));
}

/** Total number of segments in the whole module (for the progress line). */
export function moduleSegmentCount(
  definition: LearningModuleDefinition,
): number {
  return planModuleShots(definition).reduce((sum, list) => sum + list.length, 0);
}

/**
 * Overall playback fraction across the whole module: segments already presented
 * before this card, plus the position within the current card. Deterministic and
 * monotonic, so the thin progress line only ever moves forward.
 */
export function moduleProgressFraction(
  definition: LearningModuleDefinition,
  cardIndex: number,
  segmentIndex: number,
): number {
  const perCard = planModuleShots(definition);
  const total = perCard.reduce((sum, list) => sum + list.length, 0);
  if (total === 0) return 0;
  let before = 0;
  for (let at = 0; at < cardIndex && at < perCard.length; at += 1) {
    before += perCard[at]!.length;
  }
  const done = before + Math.min(segmentIndex + 1, perCard[cardIndex]?.length ?? 0);
  return Math.max(0, Math.min(1, done / total));
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/** What the director does when a card's scene finishes playing. */
export type DirectorAction =
  | { readonly kind: "SHOW_CHECK"; readonly checkId: string }
  | { readonly kind: "NEXT_CARD"; readonly cardIndex: number }
  | { readonly kind: "COMPLETE" };

/**
 * Decides the transition when the current card's scene reaches its end.
 *
 * A card carrying a check the run has not mastered pauses here for the check.
 * Otherwise the next card rolls automatically, or — on the last card — the
 * module completes. Playback is automatic; the check is the one thing that
 * interrupts it, and it interrupts every time until it is answered correctly.
 */
export function directorOnSceneEnd(
  definition: LearningModuleDefinition,
  cardIndex: number,
  masteredCheckIds: readonly string[],
): DirectorAction {
  const card = definition.cards[cardIndex];
  if (card?.check && !masteredCheckIds.includes(card.check.id)) {
    return { kind: "SHOW_CHECK", checkId: card.check.id };
  }
  if (cardIndex < definition.cards.length - 1) {
    return { kind: "NEXT_CARD", cardIndex: cardIndex + 1 };
  }
  return { kind: "COMPLETE" };
}

/** Decides the transition after a check on the current card is mastered. */
export function directorOnCheckMastered(
  definition: LearningModuleDefinition,
  cardIndex: number,
): DirectorAction {
  if (cardIndex < definition.cards.length - 1) {
    return { kind: "NEXT_CARD", cardIndex: cardIndex + 1 };
  }
  return { kind: "COMPLETE" };
}
