import {
  MODULE_CHECK_SELECTIONS,
  MODULE_VISUAL_CLASSIFICATIONS,
  moduleDefinitionDefects,
  type LearningModuleDefinition,
  type ModuleCard,
  type ModuleCheck,
  type ModuleCheckOption,
  type ModuleCheckSelection,
  type ModuleNarrationBeat,
  type ModulePresenter,
  type ModuleScene,
  type ModuleSourceExcerpt,
  type ModuleVisual,
  type ModuleVisualClassification,
} from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// Loading an authored module.
//
// Authored decks arrive as JSON envelopes under content/<mission>/module.json.
// The envelope's `module` property is exactly a LearningModuleDefinition and its
// schema pins that with `additionalProperties: false`; everything else in the
// file is authoring evidence — the reading-rate budget, the window re-cut, the
// deliberate exclusions — and no runtime reads it.
//
// The checks below are not redundant with that schema. The schema binds the
// author; this binds the runtime, and the two are validated at different
// moments by different tools. A hand-edited file, a half-finished merge, or a
// future fetch instead of a bundled import all reach the player through here and
// not through a JSON Schema validator.
//
// It fails closed and it fails loud. A defective deck is reported and omitted
// from the registry, which the gate then treats as MODULE_MISSING — the mission
// becomes undeployable and says so. That is the correct degradation: the module
// is the mandatory teaching gate, so serving a broken one is worse than serving
// none, and taking the whole app down over one bad file is worse than both.
// ---------------------------------------------------------------------------

export type LoadedModule =
  | {
      readonly ok: true;
      readonly definition: LearningModuleDefinition;
      readonly contentId: string;
      /** AUTHOR_DRAFT until historical review signs it off. Display only. */
      readonly reviewStatus: string;
    }
  | { readonly ok: false; readonly defects: readonly string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** A string array, or null if any entry is not a non-empty string. */
function stringsAt(
  source: Record<string, unknown>,
  key: string,
): readonly string[] | null {
  const value = source[key];
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    return null;
  }
  return value as readonly string[];
}

function readExcerpt(
  value: unknown,
  cardId: string,
  defects: string[],
): ModuleSourceExcerpt | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    defects.push(`${cardId}: excerpt is not an object`);
    return undefined;
  }
  const sourceId = stringAt(value, "sourceId");
  const title = stringAt(value, "title");
  const attribution = stringAt(value, "attribution");
  const lines = stringsAt(value, "lines");
  if (!sourceId || !title || !attribution || !lines || lines.length === 0) {
    defects.push(
      `${cardId}: excerpt needs a sourceId, title, attribution and at least ` +
        "one line",
    );
    return undefined;
  }
  return { sourceId, title, attribution, lines };
}

/**
 * A card's cinematic scene, or a defect. Returns undefined when the card has no
 * scene at all; returns null (and pushes defects) when a scene is present but
 * malformed, so the card is refused rather than half-rendered.
 */
function readScene(
  value: unknown,
  cardId: string,
  defects: string[],
): ModuleScene | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    defects.push(`${cardId}: scene is not an object`);
    return null;
  }
  const rawVisuals = value["visuals"];
  const rawBeats = value["beats"];
  if (!Array.isArray(rawBeats) || rawBeats.length === 0) {
    defects.push(`${cardId}: scene needs a non-empty beats array`);
    return null;
  }
  if (rawVisuals !== undefined && !Array.isArray(rawVisuals)) {
    defects.push(`${cardId}: scene visuals is not an array`);
    return null;
  }

  const visuals: ModuleVisual[] = [];
  for (const [index, raw] of (rawVisuals ?? []).entries()) {
    if (!isRecord(raw)) {
      defects.push(`${cardId}: visual ${index} is not an object`);
      return null;
    }
    const id = stringAt(raw, "id");
    const src = stringAt(raw, "src");
    const alt = stringAt(raw, "alt");
    const title = stringAt(raw, "title");
    const caption = stringAt(raw, "caption");
    const attribution = stringAt(raw, "attribution");
    const sourceUrl = stringAt(raw, "sourceUrl");
    const date = stringAt(raw, "date");
    const rights = stringAt(raw, "rights");
    const classification = raw["classification"];
    if (
      !id || !src || !alt || !title || !caption || !attribution || !sourceUrl ||
      !date || !rights
    ) {
      defects.push(
        `${cardId}: visual ${id ?? index} needs id, src, alt, title, caption, ` +
          "attribution, sourceUrl, date and rights",
      );
      return null;
    }
    if (
      typeof classification !== "string" ||
      !MODULE_VISUAL_CLASSIFICATIONS.includes(
        classification as ModuleVisualClassification,
      )
    ) {
      defects.push(`${cardId}: visual ${id} has an unknown classification`);
      return null;
    }
    visuals.push({
      id,
      src,
      alt,
      title,
      caption,
      attribution,
      sourceUrl,
      date,
      rights,
      classification: classification as ModuleVisualClassification,
    });
  }

  const beats: ModuleNarrationBeat[] = [];
  for (const [index, raw] of rawBeats.entries()) {
    if (!isRecord(raw)) {
      defects.push(`${cardId}: beat ${index} is not an object`);
      return null;
    }
    const id = stringAt(raw, "id");
    const text = stringAt(raw, "text");
    if (!id || !text) {
      defects.push(`${cardId}: beat ${id ?? index} needs an id and text`);
      return null;
    }
    const visualId = stringAt(raw, "visualId");
    const beat: ModuleNarrationBeat = visualId ? { id, text, visualId } : { id, text };
    beats.push(beat);
  }

  return { beats, visuals };
}

/** One check option, or null (with a defect pushed) when malformed. */
function readOption(
  raw: unknown,
  cardId: string,
  checkId: string,
  label: string,
  defects: string[],
): ModuleCheckOption | null {
  if (!isRecord(raw)) {
    defects.push(`${cardId}: check ${checkId} ${label} is not an object`);
    return null;
  }
  const optionId = stringAt(raw, "id");
  const text = stringAt(raw, "text");
  const feedback = stringAt(raw, "feedback");
  const correct = raw["correct"];
  if (!optionId || !text || !feedback || typeof correct !== "boolean") {
    defects.push(
      `${cardId}: check ${checkId} ${label} (${optionId ?? "?"}) needs an id, text, ` +
        "boolean correct and feedback",
    );
    return null;
  }
  return { id: optionId, text, correct, feedback };
}

/** A card's mastery check, or a defect (null) when present but malformed. */
function readCheck(
  value: unknown,
  cardId: string,
  defects: string[],
): ModuleCheck | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    defects.push(`${cardId}: check is not an object`);
    return null;
  }
  const id = stringAt(value, "id");
  const prompt = stringAt(value, "prompt");
  const reinforcement = stringAt(value, "reinforcement");
  if (!id || !prompt || !reinforcement) {
    defects.push(`${cardId}: check needs an id, prompt and reinforcement`);
    return null;
  }

  const rawOptions = value["options"];
  const rawCorrect = value["correctOption"];
  const rawPool = value["distractorPool"];
  const rawDrawCount = value["drawCount"];
  // Pooled shape: a separate answer plus a bank of distractors, drawn per sitting.
  // Detected by the presence of either pooled key; the fixed-list shape otherwise.
  const pooled = rawCorrect !== undefined || rawPool !== undefined;

  let options: ModuleCheckOption[] | undefined;
  let correctOption: ModuleCheckOption | undefined;
  let distractorPool: ModuleCheckOption[] | undefined;
  let drawCount: number | undefined;

  if (pooled) {
    const answer = readOption(rawCorrect, cardId, id, "correctOption", defects);
    if (!answer) return null;
    correctOption = answer;
    if (!Array.isArray(rawPool) || rawPool.length === 0) {
      defects.push(`${cardId}: check ${id} needs a non-empty distractorPool`);
      return null;
    }
    distractorPool = [];
    for (const [index, raw] of rawPool.entries()) {
      const opt = readOption(raw, cardId, id, `distractor ${index}`, defects);
      if (!opt) return null;
      distractorPool.push(opt);
    }
    if (rawDrawCount !== undefined) {
      if (typeof rawDrawCount !== "number" || !Number.isInteger(rawDrawCount)) {
        defects.push(`${cardId}: check ${id} drawCount must be an integer`);
        return null;
      }
      drawCount = rawDrawCount;
    }
  } else {
    if (!Array.isArray(rawOptions) || rawOptions.length === 0) {
      defects.push(`${cardId}: check ${id} needs a non-empty options array`);
      return null;
    }
    options = [];
    for (const [index, raw] of rawOptions.entries()) {
      const opt = readOption(raw, cardId, id, `option ${index}`, defects);
      if (!opt) return null;
      options.push(opt);
    }
  }

  // `selection` is optional and defaults to single. A present value that is not
  // one of the known modes is a defect, not a silent fall-through to single —
  // "multiselect" or a typo should refuse the deck, not quietly grade as one.
  const rawSelection = value["selection"];
  let selection: ModuleCheckSelection | undefined;
  if (rawSelection !== undefined) {
    if (
      typeof rawSelection !== "string" ||
      !MODULE_CHECK_SELECTIONS.includes(rawSelection as ModuleCheckSelection)
    ) {
      defects.push(`${cardId}: check ${id} has an unknown selection`);
      return null;
    }
    selection = rawSelection as ModuleCheckSelection;
  }

  const conceptId = stringAt(value, "conceptId");
  let check: ModuleCheck = { id, prompt, reinforcement };
  // Assigned conditionally so a check that omits a key stays deep-equal to one
  // authored without it — the same rule the card fields follow.
  if (options) check = { ...check, options };
  if (correctOption) check = { ...check, correctOption };
  if (distractorPool) check = { ...check, distractorPool };
  if (drawCount !== undefined) check = { ...check, drawCount };
  if (selection) check = { ...check, selection };
  if (conceptId) check = { ...check, conceptId };
  return check;
}

/** The deck's presenter, or a defect (null) when present but malformed. */
function readPresenter(
  value: unknown,
  defects: string[],
): ModulePresenter | null | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    defects.push("presenter is not an object");
    return null;
  }
  const glbKey = stringAt(value, "glbKey");
  const displayName = stringAt(value, "displayName");
  const talkClip = stringAt(value, "talkClip");
  const idleClip = stringAt(value, "idleClip");
  if (!glbKey || !displayName || !talkClip || !idleClip) {
    defects.push("presenter needs a glbKey, displayName, talkClip and idleClip");
    return null;
  }
  return { glbKey, displayName, talkClip, idleClip };
}

function readCard(
  value: unknown,
  at: number,
  defects: string[],
): ModuleCard | null {
  if (!isRecord(value)) {
    defects.push(`card ${at} is not an object`);
    return null;
  }
  const id = stringAt(value, "id") ?? `card ${at}`;
  const cueId = stringAt(value, "cueId");
  const kicker = stringAt(value, "kicker");
  const advanceLabel = stringAt(value, "advanceLabel");
  const body = stringsAt(value, "body");
  const conceptIds = stringsAt(value, "conceptIds");
  const codexCardIds = stringsAt(value, "codexCardIds");
  const throughSeconds = value["throughSeconds"];

  if (!stringAt(value, "id")) defects.push(`card ${at} has no id`);
  if (!cueId) defects.push(`${id} has no cueId`);
  if (!kicker) defects.push(`${id} has no kicker`);
  if (!advanceLabel) defects.push(`${id} has no advanceLabel`);
  if (!body || body.length === 0) defects.push(`${id} has no body`);
  // Absent and empty are different things. A frame card teaches nothing and has
  // to say so with `[]`, so a missing key is a defect rather than a default.
  if (!conceptIds) defects.push(`${id} has no conceptIds array`);
  if (!codexCardIds) defects.push(`${id} has no codexCardIds array`);
  if (typeof throughSeconds !== "number" || !Number.isInteger(throughSeconds)) {
    defects.push(`${id} has no integer throughSeconds`);
  }

  const excerpt = readExcerpt(value["excerpt"], id, defects);
  const scene = readScene(value["scene"], id, defects);
  const check = readCheck(value["check"], id, defects);

  if (
    !cueId ||
    !kicker ||
    !advanceLabel ||
    !body ||
    body.length === 0 ||
    !conceptIds ||
    !codexCardIds ||
    typeof throughSeconds !== "number" ||
    scene === null ||
    check === null
  ) {
    return null;
  }

  let card: ModuleCard = {
    id,
    cueId,
    throughSeconds,
    kicker,
    body,
    conceptIds,
    codexCardIds,
    advanceLabel,
  };
  // Assigned conditionally: the format marks these optional, and writing an
  // explicit `undefined` would make a card that has none unequal to one authored
  // without the key at all.
  if (excerpt) card = { ...card, excerpt };
  if (scene) card = { ...card, scene };
  if (check) card = { ...card, check };
  return card;
}

/**
 * Reads one authored envelope into a definition, or reports every defect found.
 *
 * Structural defects are collected rather than thrown on the first one, because
 * the caller reporting this is a content author fixing a file, and one error per
 * run is a slow way to fix six.
 */
export function loadAuthoredModule(envelope: unknown): LoadedModule {
  const defects: string[] = [];

  if (!isRecord(envelope)) return { ok: false, defects: ["the envelope is not an object"] };
  const body = envelope["module"];
  if (!isRecord(body)) {
    return { ok: false, defects: ["the envelope has no `module` object"] };
  }

  const moduleId = stringAt(body, "moduleId");
  const chapterId = stringAt(body, "chapterId");
  const missionId = stringAt(body, "missionId");
  const title = stringAt(body, "title");
  const subtitle = stringAt(body, "subtitle");
  if (!moduleId) defects.push("the module has no moduleId");
  if (!chapterId) defects.push("the module has no chapterId");
  if (!missionId) defects.push("the module has no missionId");
  if (!title) defects.push("the module has no title");
  if (!subtitle) defects.push("the module has no subtitle");

  const rawCards = body["cards"];
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    defects.push("the module has no cards");
    return { ok: false, defects };
  }

  const cards: ModuleCard[] = [];
  rawCards.forEach((raw, at) => {
    const card = readCard(raw, at, defects);
    if (card) cards.push(card);
  });

  const presenter = readPresenter(body["presenter"], defects);

  if (!moduleId || !chapterId || !missionId || !title || !subtitle) {
    return { ok: false, defects };
  }
  if (cards.length !== rawCards.length) return { ok: false, defects };
  if (presenter === null) return { ok: false, defects };

  const definition: LearningModuleDefinition = {
    moduleId,
    chapterId,
    missionId,
    title,
    subtitle,
    cards,
    ...(presenter ? { presenter } : {}),
  };

  // The same authoring rules the in-code definitions are held to: contiguous
  // strictly-increasing windows, unique ids and cues, and a deck that lands on
  // exactly three minutes.
  defects.push(...moduleDefinitionDefects(definition));
  if (defects.length > 0) return { ok: false, defects };

  return {
    ok: true,
    definition,
    contentId: stringAt(envelope, "contentId") ?? moduleId,
    reviewStatus: stringAt(envelope, "reviewStatus") ?? "UNKNOWN",
  };
}
