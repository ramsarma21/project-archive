// ============================================================================
// Chapter identity, and the one rule every chapter-keyed lookup must obey.
//
// WHY THIS IS ITS OWN FILE. The registry used to key Boston under the authoring
// spelling `BOSTON` while the API, the client and every row in
// `chapter_assessment_attempts`, `concept_mastery` and `chapter_ability_unlocks`
// used `boston-1765`. Both spellings are well-formed, so nothing rejected
// either — a lookup with the runtime key simply filtered the registry down to
// nothing and returned an empty list. That reached the educator reporting path,
// where an empty concept list is not an error but a roster asserting that every
// student owes nothing, and it was patched at the call site rather than here.
//
// `boston-1765` is canonical because it is the key already written into student
// rows. An authoring constant is one edit; stored data is a migration, and a
// migration over a minor's academic record to settle a spelling is not a trade
// worth making.
//
// A LOOKUP FOR AN UNKNOWN CHAPTER IS AN ERROR, NEVER AN EMPTY LIST. That silent
// empty was the defect; the mismatched string only exposed it. Every
// chapter-keyed lookup in the workspace throws `UnknownChapterError` rather than
// answering "nothing", and a caller holding a chapter id it did not author — a
// route reading one out of a URL — checks `isCurriculumChapterId` first instead
// of catching.
// ============================================================================

/**
 * A chapter id the registry actually holds, in its canonical spelling.
 *
 * Branded so an authoring site cannot spell one for itself: the only ways in are
 * the exported constants and `asCurriculumChapterId`, both of which are checked
 * against `CURRICULUM_CHAPTER_IDS`.
 */
export type CurriculumChapterId = string & {
  readonly __brand: "PA.CurriculumChapterId";
};

/**
 * Boston, spelled the way the database spells it.
 *
 * Must stay equal to `BOSTON_RUNTIME_CHAPTER_ID` in
 * apps/api/src/progression/content.ts and `BOSTON_CHAPTER_ID` in
 * apps/web/src/chapter/bostonChapter.ts. `chapters.test.ts` pins the literal, so
 * a rename here fails a test rather than emptying a report.
 */
export const CHAPTER_BOSTON = "boston-1765" as CurriculumChapterId;

/** Every chapter this registry can answer for. One, today. */
export const CURRICULUM_CHAPTER_IDS: readonly CurriculumChapterId[] = [
  CHAPTER_BOSTON,
];

const CANONICAL = new Set<string>(CURRICULUM_CHAPTER_IDS);

/**
 * Superseded chapter spellings, and what each one is now.
 *
 * The same device `aliases.ts` uses for concept and SE identifiers, for the same
 * reason: a legacy key is retagged onto the canonical one and recorded here,
 * rather than being accepted as a second name for the chapter. `BOSTON` was this
 * registry's own authoring key until it was reconciled with the runtime id, and
 * it is still passed by `apps/api/src/app.ts`, which translates the runtime key
 * into it before calling `registryChapterConceptIds`. That translation is now a
 * no-op and should be deleted; until it is, this entry is what keeps the
 * educator roster working rather than throwing at it.
 */
const SUPERSEDED: ReadonlyMap<string, CurriculumChapterId> = new Map([
  ["BOSTON", CHAPTER_BOSTON],
]);

/**
 * Whether this is a canonical chapter id the registry holds.
 *
 * The non-throwing door, for a caller whose chapter id came from a request. A
 * route should answer 404 on false rather than let a lookup throw into a 500.
 * Deliberately false for a superseded spelling: no database row uses one, so a
 * request that names one is asking for a chapter nobody is in.
 */
export function isCurriculumChapterId(value: string): value is CurriculumChapterId {
  return CANONICAL.has(value);
}

/**
 * Canonicalise a chapter id, or report that it names no chapter.
 *
 * What every chapter-keyed lookup calls. Accepts a canonical id or a superseded
 * spelling and returns the canonical one; returns null for anything else, so the
 * caller raises `UnknownChapterError` instead of filtering the registry to
 * nothing.
 */
export function resolveChapterId(value: string): CurriculumChapterId | null {
  if (isCurriculumChapterId(value)) return value;
  return SUPERSEDED.get(value) ?? null;
}

/**
 * Thrown by every chapter-keyed lookup that cannot answer.
 *
 * Carries the keys it does hold, because the whole class of bug this replaces
 * was two plausible spellings of one chapter and a caller with no way to see
 * which one it was holding.
 */
export class UnknownChapterError extends Error {
  readonly input: string;
  readonly known: readonly string[];

  constructor(input: string, known: readonly string[] = CURRICULUM_CHAPTER_IDS) {
    super(
      `unknown chapter id ${JSON.stringify(input)}; known chapters are ` +
        `${known.map((id) => JSON.stringify(id)).join(", ") || "(none)"}`,
    );
    this.name = "UnknownChapterError";
    this.input = input;
    this.known = [...known];
  }
}

/** Narrow a plain string onto the branded canonical key, or refuse it. */
export function asCurriculumChapterId(value: string): CurriculumChapterId {
  const resolved = resolveChapterId(value);
  if (resolved === null) throw new UnknownChapterError(value);
  return resolved;
}
