// ============================================================================
// Chapter identity for the curve and the unlock schedule.
//
// WHY THIS IS ITS OWN FILE, AND WHY THE KEY CHANGED. This package used to spell
// Boston `BOSTON` while @pa/curriculum's `CHAPTER_BOSTON`, the API's
// `BOSTON_RUNTIME_CHAPTER_ID`, apps/web/src/chapter/bostonChapter.ts and every
// row in `chapter_ability_unlocks`, `concept_mastery` and
// `chapter_assessment_attempts` said `boston-1765`. Nothing broke, because the
// API re-keys each milestone onto the runtime id on the way through and
// `resolveChapterLoadout` was called only from this package's own tests.
//
// It was still one production caller away from being the same bug @pa/curriculum
// was reconciled to remove. `resolveChapterLoadout` answered an EMPTY ability
// pool for any key but this one, so the first caller to pass the id every other
// layer uses would have got a Level 34 player with no abilities, no error and
// nothing in a log to explain it.
//
// `boston-1765` is canonical because it is the key already written into student
// rows. This constant is one edit; stored data is a migration.
//
// A LOADOUT FOR AN UNKNOWN CHAPTER IS AN ERROR, NEVER AN EMPTY POOL. The silent
// empty was the defect and the misspelling only exposed it — an empty pool for a
// chapter that does not exist is indistinguishable from an empty pool for a
// chapter whose abilities live in another package, which is exactly the
// ambiguity that let the mismatch sit here.
//
// WHY THE LITERAL IS RESTATED RATHER THAN IMPORTED. @pa/abilities does not depend
// on @pa/curriculum and must not start to: @pa/pvp depends on this package, and
// the curve has no business knowing about student expectations. So the literal is
// duplicated on purpose and `chapters.test.ts` writes down the other side's
// constants and asserts equality, which is the only way a divergence across a
// boundary neither side may cross is catchable at all.
// ============================================================================

/**
 * A chapter id this package can resolve a loadout for, in its canonical
 * spelling.
 *
 * Branded so an authoring site cannot spell one for itself: the only ways in are
 * `BOSTON_CHAPTER_ID` and `asAbilityChapterId`, both checked against
 * `ABILITY_CHAPTER_IDS`.
 */
export type AbilityChapterId = string & {
  readonly __brand: "PA.AbilityChapterId";
};

/**
 * Boston, spelled the way the database spells it.
 *
 * Must stay equal to `CHAPTER_BOSTON` in packages/curriculum/src/chapters.ts,
 * `BOSTON_RUNTIME_CHAPTER_ID` in apps/api/src/progression/content.ts and
 * `BOSTON_CHAPTER_ID` in apps/web/src/chapter/bostonChapter.ts.
 * `chapters.test.ts` pins the literal, so a rename here fails a test rather than
 * emptying a player's loadout.
 */
export const BOSTON_CHAPTER_ID = "boston-1765" as AbilityChapterId;

/** Every chapter this package authors an ability set for. One, today. */
export const ABILITY_CHAPTER_IDS: readonly AbilityChapterId[] = [
  BOSTON_CHAPTER_ID,
];

const CANONICAL = new Set<string>(ABILITY_CHAPTER_IDS);

/**
 * Superseded chapter spellings, and what each one is now.
 *
 * The device @pa/curriculum's `chapters.ts` and `aliases.ts` use, for the same
 * reason: a legacy key is retagged onto the canonical one and recorded here,
 * rather than being accepted as a second name for the chapter, and rather than
 * being translated at each call site — a shim at the call site is what hid the
 * chapter mismatch in the reporting path for months.
 *
 * `BOSTON` was this package's own authoring key until it was reconciled with the
 * runtime id. No database row carries it, because the API re-keyed every
 * milestone before persisting one, but it is still the spelling named in
 * `apps/api/src/progression/content.ts`'s comment and passed by @pa/pvp's
 * fixtures, so it resolves rather than throwing at them.
 */
const SUPERSEDED: ReadonlyMap<string, AbilityChapterId> = new Map([
  ["BOSTON", BOSTON_CHAPTER_ID],
]);

/**
 * Whether this is a canonical chapter id this package authors abilities for.
 *
 * The non-throwing door, for a caller whose chapter id came from a request or a
 * stored profile. Deliberately false for a superseded spelling: no row uses one.
 */
export function isAbilityChapterId(value: string): value is AbilityChapterId {
  return CANONICAL.has(value);
}

/**
 * Canonicalise a chapter id, or report that it names no chapter this package
 * knows.
 *
 * What every chapter-keyed lookup here calls. Returns null for anything else, so
 * the caller raises `UnknownAbilityChapterError` instead of answering with an
 * empty pool.
 */
export function resolveAbilityChapterId(value: string): AbilityChapterId | null {
  if (isAbilityChapterId(value)) return value;
  return SUPERSEDED.get(value) ?? null;
}

/**
 * Thrown by every chapter-keyed lookup here that cannot answer.
 *
 * Carries the keys it does hold, because the class of bug this replaces was two
 * plausible spellings of one chapter and a caller with no way to see which one it
 * was holding.
 *
 * WHEN THE SECOND CHAPTER SHIPS, register it here rather than widening the empty
 * answer back out. "Philadelphia's abilities resolve in Philadelphia's package"
 * is a true statement that wants a known chapter with an empty set, not an
 * unknown key that quietly resolves to nothing.
 */
export class UnknownAbilityChapterError extends Error {
  readonly input: string;
  readonly known: readonly string[];

  constructor(input: string, known: readonly string[] = ABILITY_CHAPTER_IDS) {
    super(
      `unknown chapter id ${JSON.stringify(input)}; this package authors ` +
        `abilities for ${known.map((id) => JSON.stringify(id)).join(", ") || "(none)"}`,
    );
    this.name = "UnknownAbilityChapterError";
    this.input = input;
    this.known = [...known];
  }
}

/** Narrow a plain string onto the branded canonical key, or refuse it. */
export function asAbilityChapterId(value: string): AbilityChapterId {
  const resolved = resolveAbilityChapterId(value);
  if (resolved === null) throw new UnknownAbilityChapterError(value);
  return resolved;
}

// ---------------------------------------------------------------------------
// the chapter's capstone assessment
// ---------------------------------------------------------------------------

/**
 * Boston's chapter capstone, spelled the way the authored content spells it.
 *
 * Was `BOSTON.CAPSTONE` in `BOSTON_CAPSTONE` below while
 * content/capstone/boston-1765/blueprint.json, its answer key, its item files,
 * its released-item map and its labelled eval set all said `BOS.CAPSTONE.v1`.
 * Authored content wins over a constant, and it is also the root of the whole
 * `BOS.CAPSTONE.*` content namespace.
 *
 * Must stay equal to `ASSESSMENT_BOSTON_CAPSTONE` in
 * packages/curriculum/src/assessments.ts and to `scope.assessmentId` in the
 * blueprint. Pinned in `chapters.test.ts`.
 */
export const BOSTON_CAPSTONE_ASSESSMENT_ID = "BOS.CAPSTONE.v1";
