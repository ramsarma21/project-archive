import {
  moduleDefinitionDefects,
  type LearningModuleDefinition,
  type ModuleCard,
  type ModuleSourceExcerpt,
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

  if (
    !cueId ||
    !kicker ||
    !advanceLabel ||
    !body ||
    body.length === 0 ||
    !conceptIds ||
    !codexCardIds ||
    typeof throughSeconds !== "number"
  ) {
    return null;
  }

  const card: ModuleCard = {
    id,
    cueId,
    throughSeconds,
    kicker,
    body,
    conceptIds,
    codexCardIds,
    advanceLabel,
  };
  // Assigned conditionally: the format marks `excerpt` optional, and writing an
  // explicit `undefined` would make a card that has none unequal to one authored
  // without the key at all.
  return excerpt ? { ...card, excerpt } : card;
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

  if (!moduleId || !chapterId || !missionId || !title || !subtitle) {
    return { ok: false, defects };
  }
  if (cards.length !== rawCards.length) return { ok: false, defects };

  const definition: LearningModuleDefinition = {
    moduleId,
    chapterId,
    missionId,
    title,
    subtitle,
    cards,
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
