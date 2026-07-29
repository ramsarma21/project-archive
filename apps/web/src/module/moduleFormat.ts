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

// ---------------------------------------------------------------------------
// Cinematic layer.
//
// Everything below is OPTIONAL on the authored format and additive to the
// rules above. A card with no `scene` renders as the flat card it always did;
// a deck with no `presenter` shows no hologram. The gate, the zero-XP rule, the
// 180-second target and the manual pacing are untouched — the cinematic data
// decorates a card, it never becomes a second thing a student has to clear.
//
// One exception is load-bearing: a card's `check` is a mastery gate. It does
// not pay XP and it is not timed, but a concept card that carries one cannot be
// advanced past until its correct option is chosen. That is enforced in the
// player and, so a forged client cannot skip it, re-derived on the server from
// module metadata rather than trusted from the request. See moduleGate's
// `moduleRequiredCheckIds` and the server's completeLearningModule.
// ---------------------------------------------------------------------------

/**
 * How a visual relates to the history it depicts. The distinction is the whole
 * point: a 1770 painting of a 1759 death is not documentary evidence, and a
 * project reconstruction is not a period artefact. The player captions each
 * class differently and the loader refuses a PROJECT_RECONSTRUCTION that calls
 * itself 'actual'.
 */
export const MODULE_VISUAL_CLASSIFICATIONS = [
  "PRIMARY_SOURCE",
  "PERIOD_ART",
  "LATER_DEPICTION",
  "PROJECT_RECONSTRUCTION",
] as const;
export type ModuleVisualClassification =
  (typeof MODULE_VISUAL_CLASSIFICATIONS)[number];

/**
 * One floating document/image panel with its full provenance. `src` is a local
 * imported asset path (never a runtime hotlink); the remaining fields are the
 * caption and the record of where the image came from and under what rights.
 */
export interface ModuleVisual {
  id: string;
  /** Local asset path, e.g. /historical/m1/wolfe.jpg. Never an external URL. */
  src: string;
  alt: string;
  title: string;
  caption: string;
  /** The creator or holding collection. */
  attribution: string;
  /** Where the source record lives. Provenance, not a runtime fetch target. */
  sourceUrl: string;
  date: string;
  rights: string;
  classification: ModuleVisualClassification;
}

/**
 * A future external-audio cue. Present so the authored beat can name the audio
 * that will eventually replace browser speech; the default provider ignores it.
 * No URL or key is authored now — only the shape that will carry one.
 */
export interface ModuleBeatAudio {
  cueId: string;
  /** Absent until an external provider is wired. Never a runtime dependency. */
  src?: string;
  startMs?: number;
  durationMs?: number;
}

/** One narration/subtitle beat. The text is both spoken and shown as a subtitle. */
export interface ModuleNarrationBeat {
  id: string;
  /** Spoken by the voiceover provider and shown as the subtitle, verbatim. */
  text: string;
  /** The visual shown during this beat, by id. Must resolve within the scene. */
  visualId?: string;
  audio?: ModuleBeatAudio;
}

/** A card's cinematic scene: an ordered slideshow of beats over a visual set. */
export interface ModuleScene {
  beats: readonly ModuleNarrationBeat[];
  visuals: readonly ModuleVisual[];
}

/** One option of a mastery check. Every option carries its own feedback. */
export interface ModuleCheckOption {
  id: string;
  text: string;
  /**
   * Whether this option belongs to the correct set. Truth is carried on the
   * option itself, keyed by its stable `id`, rather than by a list of indices:
   * an author may reorder the options — and must, so the answer is not always
   * first — without any separate truth list drifting out of step. The set of
   * correct ids is derived by `checkCorrectOptionIds`.
   */
  correct: boolean;
  /** Misconception-specific for a wrong option; reinforcement for the right one. */
  feedback: string;
}

/**
 * How a check is answered.
 *
 *   "single"   — exactly one option is correct; a radio group. This is the
 *                default, so a check authored before this field existed (and
 *                every check that omits it) is a single-select, unchanged.
 *
 *   "multiple" — two or three options are correct and the learner must choose
 *                the exact set: every correct one, no distractor. A checkbox
 *                group with an explicit submit.
 */
export const MODULE_CHECK_SELECTIONS = ["single", "multiple"] as const;
export type ModuleCheckSelection = (typeof MODULE_CHECK_SELECTIONS)[number];

/**
 * A short pre-authored mastery check, placed immediately after a concept card.
 * The learner cannot advance past the concept until they choose the correct
 * answer — exactly one option for a single-select, or the exact correct set for
 * a multiple-select. It pays no XP and is not timed.
 */
export interface ModuleCheck {
  id: string;
  prompt: string;
  /**
   * The concrete options a learner sees. Present on a legacy authored check and
   * on any check AFTER it has been drawn for a sitting (see `drawCheckOptions`).
   * Absent on a pooled check as authored — it carries `correctOption` +
   * `distractorPool` instead, and the drawer materialises `options` from them.
   */
  options?: readonly ModuleCheckOption[];
  /**
   * Pooled shape (single-select only): the one defensible answer.
   *
   * Truth stays on the option (`correct: true`) so nothing downstream is keyed
   * by position. The answer is ALWAYS included in the drawn set, and the pool
   * below holds only distractors, so "exactly one option is correct" holds for
   * every drawable subset by construction rather than by an author remembering.
   */
  correctOption?: ModuleCheckOption;
  /**
   * Pooled shape: the misconception-encoded wrong options. Each sitting draws a
   * subset of these; a pool sized `>= drawCount` guarantees the three mission
   * attempts never present the same option set (see `drawCheckOptions`). Every
   * pool entry must be `correct: false`.
   */
  distractorPool?: readonly ModuleCheckOption[];
  /** How many options a sitting shows (correct + drawn distractors). Default 4. */
  drawCount?: number;
  /**
   * Single- or multiple-select. Optional: an absent value is "single", so
   * existing content keeps its meaning without being rewritten. A pooled check
   * is always single-select.
   */
  selection?: ModuleCheckSelection;
  /** The concept this check reinforces. Display/authoring evidence only. */
  conceptId?: string;
  /** Shown once, concisely, when the correct set is chosen. */
  reinforcement: string;
}

/** Default number of options a check shows per sitting (correct + distractors). */
export const DEFAULT_CHECK_DRAW_COUNT = 4;

/** A check authored as a distractor pool rather than a fixed option list. */
export function isPooledCheck(check: ModuleCheck): boolean {
  return check.correctOption !== undefined && check.distractorPool !== undefined;
}

/** How many options a pooled check shows per sitting; the fixed list otherwise. */
export function checkDrawCount(check: ModuleCheck): number {
  return check.drawCount ?? DEFAULT_CHECK_DRAW_COUNT;
}

/** A check's selection mode, defaulting to single for content that omits it. */
export function checkSelection(check: ModuleCheck): ModuleCheckSelection {
  return check.selection ?? "single";
}

/** The stable ids of a check's correct options, in authored order. */
export function checkCorrectOptionIds(check: ModuleCheck): string[] {
  return (check.options ?? []).filter((option) => option.correct).map((option) => option.id);
}

/**
 * Whether a chosen set of option ids is exactly the correct set: every correct
 * option chosen, no distractor chosen, and nothing chosen that the check does
 * not offer. This is the single gate both the UI and the tests judge an answer
 * by, so a single-select (one correct) and a multiple-select (two or three)
 * are decided by the same rule rather than two.
 */
export function isExactCheckSelection(
  check: ModuleCheck,
  chosenIds: Iterable<string>,
): boolean {
  const chosen = new Set(chosenIds);
  const optionIds = new Set((check.options ?? []).map((option) => option.id));
  for (const id of chosen) {
    if (!optionIds.has(id)) return false;
  }
  const correct = checkCorrectOptionIds(check);
  if (chosen.size !== correct.length) return false;
  return correct.every((id) => chosen.has(id));
}

/**
 * The embodied System presenter: an imported rigged GLB shown in a transparent
 * hologram layer. `glbKey` resolves under /world/characters. Missing or loading
 * renders no presenter and emits a dev QA error — never a primitive stand-in.
 */
export interface ModulePresenter {
  glbKey: string;
  displayName: string;
  /** Clip played while narration is speaking, if the rig carries it. */
  talkClip: string;
  /** Clip played while paused/checking, if the rig carries it. */
  idleClip: string;
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
  /** The card's cinematic slideshow, if authored. Optional and decorative. */
  scene?: ModuleScene;
  /** A mastery check that gates advancing past this card, if authored. */
  check?: ModuleCheck;
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
  /** The embodied System presenter for the cinematic surface, if authored. */
  presenter?: ModulePresenter;
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

/**
 * Every mastery check the deck requires, in card order. These are the ids a
 * completed run must have mastered before the gate opens — the check analogue
 * of the cue set. The server re-derives the same list from module metadata, so
 * a client cannot open a mission by claiming a check it never answered.
 */
export function moduleRequiredCheckIds(
  definition: LearningModuleDefinition,
): string[] {
  const ids: string[] = [];
  for (const card of definition.cards) {
    if (card.check) ids.push(card.check.id);
  }
  return ids;
}

/**
 * The visual to show for a beat: the one it names, or the scene's first visual
 * as a default, or none. Kept pure so the slideshow's selection is testable
 * without rendering the player.
 */
export function sceneBeatVisual(
  scene: ModuleScene | undefined,
  beatIndex: number,
): ModuleVisual | undefined {
  if (!scene) return undefined;
  const beat = scene.beats[beatIndex];
  if (beat?.visualId) {
    const named = scene.visuals.find((visual) => visual.id === beat.visualId);
    if (named) return named;
  }
  return scene.visuals[0];
}

/** The subtitle text for a beat index, or empty when the scene has none. */
export function sceneBeatSubtitle(
  scene: ModuleScene | undefined,
  beatIndex: number,
): string {
  return scene?.beats[beatIndex]?.text ?? "";
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
  const checkIds = new Set<string>();
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

    if (card.scene) defects.push(...sceneDefects(card.id, card.scene));
    if (card.check) {
      if (checkIds.has(card.check.id)) {
        defects.push(`duplicate check id ${card.check.id}`);
      }
      checkIds.add(card.check.id);
      defects.push(...checkDefects(card.id, card.check));
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

/** Reports 'actual' anywhere a reconstruction captions itself as evidence. */
function claimsToBeActual(text: string): boolean {
  return /\bactual\b/i.test(text);
}

/** Everything wrong with a card's scene, as sentences. */
export function sceneDefects(cardId: string, scene: ModuleScene): string[] {
  const defects: string[] = [];
  if (scene.beats.length === 0) {
    defects.push(`${cardId}: scene has no beats`);
  }
  const visualIds = new Set<string>();
  for (const visual of scene.visuals) {
    if (visualIds.has(visual.id)) {
      defects.push(`${cardId}: duplicate visual id ${visual.id}`);
    }
    visualIds.add(visual.id);
    const missing = (["src", "alt", "title", "caption", "attribution", "sourceUrl", "date", "rights"] as const).filter(
      (key) => visual[key].trim() === "",
    );
    if (missing.length > 0) {
      defects.push(`${cardId}: visual ${visual.id} is missing ${missing.join(", ")}`);
    }
    if (!MODULE_VISUAL_CLASSIFICATIONS.includes(visual.classification)) {
      defects.push(
        `${cardId}: visual ${visual.id} has unknown classification ${visual.classification}`,
      );
    }
    // A reconstruction is not evidence. Refuse one that captions itself 'actual'.
    if (
      visual.classification === "PROJECT_RECONSTRUCTION" &&
      (claimsToBeActual(visual.title) ||
        claimsToBeActual(visual.caption) ||
        claimsToBeActual(visual.alt))
    ) {
      defects.push(
        `${cardId}: reconstruction ${visual.id} calls itself 'actual', which it is not`,
      );
    }
  }
  scene.beats.forEach((beat, at) => {
    if (beat.id.trim() === "") defects.push(`${cardId}: beat ${at} has no id`);
    if (beat.text.trim() === "") defects.push(`${cardId}: beat ${beat.id || at} has no text`);
    if (beat.visualId && !visualIds.has(beat.visualId)) {
      defects.push(
        `${cardId}: beat ${beat.id || at} names visual ${beat.visualId}, which the scene does not carry`,
      );
    }
  });
  return defects;
}

/** Everything wrong with a mastery check, as sentences. */
export function checkDefects(cardId: string, check: ModuleCheck): string[] {
  const defects: string[] = [];
  if (check.id.trim() === "") defects.push(`${cardId}: check has no id`);
  if (check.prompt.trim() === "") defects.push(`${cardId}: check ${check.id} has no prompt`);
  if (check.reinforcement.trim() === "") {
    defects.push(`${cardId}: check ${check.id} has no reinforcement`);
  }
  if (
    check.selection !== undefined &&
    !MODULE_CHECK_SELECTIONS.includes(check.selection)
  ) {
    defects.push(
      `${cardId}: check ${check.id} has unknown selection ${String(check.selection)}`,
    );
  }

  // A pooled check carries its answer separately and a bank of distractors, and
  // is drawn per sitting. Its invariants are different from a fixed list: the
  // answer must be the one correct option, the pool must hold ONLY distractors,
  // and it must be deep enough that three attempts never draw the same set.
  if (isPooledCheck(check)) {
    defects.push(...pooledCheckDefects(cardId, check));
    return defects;
  }

  const optionIds = new Set<string>();
  let correct = 0;
  for (const option of check.options ?? []) {
    if (optionIds.has(option.id)) {
      defects.push(`${cardId}: check ${check.id} has duplicate option id ${option.id}`);
    }
    optionIds.add(option.id);
    if (option.id.trim() === "") defects.push(`${cardId}: check ${check.id} has an option with no id`);
    if (option.text.trim() === "") defects.push(`${cardId}: check ${check.id} option ${option.id} has no text`);
    // Feedback is required for EVERY option: a wrong one explains the
    // misconception, the right one reinforces. A missing one is a defect.
    if (option.feedback.trim() === "") {
      defects.push(`${cardId}: check ${check.id} option ${option.id} has no feedback`);
    }
    if (option.correct) correct += 1;
  }
  if ((check.options ?? []).length === 0) {
    defects.push(`${cardId}: check ${check.id} has no options`);
  }

  // Single- and multiple-select carry different shape rules. A single-select is
  // a radio group with one right answer; a multiple-select must have a genuine
  // set to assemble — two or three correct, and at least two distractors so the
  // exact-set gate is not trivially "check everything".
  const selection = checkSelection(check);
  const optionCount = (check.options ?? []).length;
  if (selection === "single") {
    if (optionCount < 3 || optionCount > 4) {
      defects.push(
        `${cardId}: check ${check.id} has ${optionCount} options; a ` +
          `single-select check authors 3 or 4`,
      );
    }
    if (correct !== 1) {
      defects.push(
        `${cardId}: check ${check.id} marks ${correct} options correct; a ` +
          `single-select check must mark exactly one`,
      );
    }
  } else {
    if (optionCount < 4 || optionCount > 5) {
      defects.push(
        `${cardId}: check ${check.id} has ${optionCount} options; a ` +
          `multiple-select check authors 4 or 5`,
      );
    }
    if (correct < 2 || correct > 3) {
      defects.push(
        `${cardId}: check ${check.id} marks ${correct} options correct; a ` +
          `multiple-select check must mark two or three`,
      );
    }
    if ((check.options ?? []).length - correct < 2) {
      defects.push(
        `${cardId}: check ${check.id} has ${(check.options ?? []).length - correct} ` +
          `distractors; a multiple-select check needs at least two`,
      );
    }
  }
  return defects;
}

/**
 * Everything wrong with a POOLED check, as sentences.
 *
 * The pooled shape is `{ stem (=prompt), correctOption, distractorPool[] }`, drawn
 * per sitting by `drawCheckOptions`. The invariants here are what make the drawer
 * safe: exactly one answer (kept out of the pool and always shown), a pool of only
 * distractors, unique ids across answer + pool (so grading by id is unambiguous),
 * and a pool deep enough that the three mission attempts never repeat an option set.
 */
export function pooledCheckDefects(cardId: string, check: ModuleCheck): string[] {
  const defects: string[] = [];
  const where = `${cardId}: check ${check.id}`;

  // Pooled is single-select by definition; a "multiple" here is an authoring error.
  if (check.selection !== undefined && check.selection !== "single") {
    defects.push(`${where} is pooled, which is single-select; remove selection "${check.selection}"`);
  }
  if (check.options !== undefined) {
    defects.push(`${where} is pooled (correctOption + distractorPool); it must not also author a fixed options list`);
  }

  const drawCount = checkDrawCount(check);
  if (!Number.isInteger(drawCount) || drawCount < 3 || drawCount > 5) {
    defects.push(`${where} has drawCount ${drawCount}; a pooled check shows 3 to 5 options`);
  }

  const answer = check.correctOption;
  if (!answer) {
    defects.push(`${where} is missing its correctOption`);
  } else {
    if (!answer.correct) defects.push(`${where} correctOption ${answer.id} must be marked correct`);
    if (answer.id.trim() === "") defects.push(`${where} correctOption has no id`);
    if (answer.text.trim() === "") defects.push(`${where} correctOption ${answer.id} has no text`);
    if (answer.feedback.trim() === "") defects.push(`${where} correctOption ${answer.id} has no feedback`);
  }

  const pool = check.distractorPool ?? [];
  const seen = new Set<string>();
  if (answer) seen.add(answer.id);
  let poolCorrect = 0;
  for (const option of pool) {
    if (seen.has(option.id)) defects.push(`${where} has duplicate option id ${option.id}`);
    seen.add(option.id);
    if (option.id.trim() === "") defects.push(`${where} has a distractor with no id`);
    if (option.text.trim() === "") defects.push(`${where} distractor ${option.id} has no text`);
    if (option.feedback.trim() === "") defects.push(`${where} distractor ${option.id} has no feedback`);
    if (option.correct) poolCorrect += 1;
  }
  if (poolCorrect > 0) {
    defects.push(
      `${where} has ${poolCorrect} distractor(s) marked correct; the pool must hold only ` +
        `wrong options so exactly one answer is ever shown`,
    );
  }
  // Depth: to guarantee the three attempts draw three DISTINCT option sets, the
  // pool must exceed the number of distractors shown, i.e. pool >= drawCount
  // (shown = drawCount, of which one is the answer, so distractors shown = drawCount-1).
  if (pool.length < drawCount) {
    defects.push(
      `${where} has a ${pool.length}-distractor pool; a check showing ${drawCount} options ` +
        `needs at least ${drawCount} so three attempts never repeat an option set`,
    );
  }

  return defects;
}
