// ============================================================================
// Chapter assessment identity.
//
// WHY THIS IS ITS OWN FILE. The third instance of the chapter/mission pattern.
// The authored capstone and everything around it — the answer key, the item
// files, the released-item map, the labelled eval set — are all spelled
// `BOS.CAPSTONE.v1`, while `BOSTON_CAPSTONE` in @pa/abilities named the same
// assessment `BOSTON.CAPSTONE`. Both are well-formed, so nothing rejected
// either, and the two halves have never been joined: `assessmentId()` in
// apps/api/src/progression/content.ts still answers null because the capstone is
// unwired. The day it is wired, whichever of the two spellings reaches
// `chapter_assessment_attempts.assessment_id` first becomes the one the other
// half cannot find.
//
// `BOS.CAPSTONE.v1` is canonical because it is the spelling in authored content
// under content/capstone/boston-1765/, and because it is the root of a whole
// content id namespace — `BOS.CAPSTONE.CONTENT.KEY.v1`,
// `BOS.CAPSTONE.GRADING_POLICY.v1`, `BOS.CAPSTONE.EVAL.OPEN_RESPONSE.v1` and the
// authored item ids all hang off it. No stored row spells it either way yet, so
// authored content decides, and renaming one constant in @pa/abilities is the
// cheap half of the trade.
// ============================================================================

/**
 * A chapter assessment id the registry holds, in its canonical spelling.
 *
 * Branded so an authoring site cannot spell one for itself. Note that
 * @pa/assessment deliberately treats its own `assessmentId` inputs as opaque
 * strings: `buildBlueprint` is handed one by its caller and a fixture chapter is
 * entitled to any id it likes. This brand is for the ids the registry claims are
 * real, which is a narrower thing.
 */
export type CurriculumAssessmentId = string & {
  readonly __brand: "PA.CurriculumAssessmentId";
};

/**
 * Boston's chapter capstone, spelled the way the authored content spells it.
 *
 * Must stay equal to `scope.assessmentId` in
 * content/capstone/boston-1765/blueprint.json and to
 * `BOSTON_CAPSTONE.assessmentId` in packages/abilities/src/missions.ts.
 * `assessments.test.ts` pins both literals.
 */
export const ASSESSMENT_BOSTON_CAPSTONE = "BOS.CAPSTONE.v1" as CurriculumAssessmentId;

/** Every chapter assessment this registry can answer for. One, today. */
export const CURRICULUM_ASSESSMENT_IDS: readonly CurriculumAssessmentId[] = [
  ASSESSMENT_BOSTON_CAPSTONE,
];

const CANONICAL = new Set<string>(CURRICULUM_ASSESSMENT_IDS);

/**
 * Superseded assessment spellings, and what each one is now.
 *
 * `BOSTON.CAPSTONE` was @pa/abilities' own name for the capstone, in the record
 * that exists so the chapter's XP arithmetic visibly closes. Recorded rather
 * than merely deleted: the point of this table is that a spelling which was once
 * in the tree resolves instead of failing, so that reconciling the two halves is
 * not also a flag day.
 */
const SUPERSEDED: ReadonlyMap<string, CurriculumAssessmentId> = new Map([
  ["BOSTON.CAPSTONE", ASSESSMENT_BOSTON_CAPSTONE],
]);

/**
 * Whether this is a canonical assessment id the registry holds.
 *
 * The non-throwing door, for a caller whose assessment id came from a request.
 * Deliberately false for a superseded spelling: no attempt row carries one.
 */
export function isCurriculumAssessmentId(
  value: string,
): value is CurriculumAssessmentId {
  return CANONICAL.has(value);
}

/**
 * Canonicalise an assessment id, or report that it names no assessment.
 *
 * Accepts a canonical id or a superseded spelling and returns the canonical one;
 * returns null for anything else, so the caller raises
 * `UnknownAssessmentError` instead of scoping an attempt to nothing.
 */
export function resolveAssessmentId(value: string): CurriculumAssessmentId | null {
  if (isCurriculumAssessmentId(value)) return value;
  return SUPERSEDED.get(value) ?? null;
}

/**
 * Thrown by every assessment-keyed lookup that cannot answer.
 *
 * Carries the ids it does hold, for the same reason `UnknownChapterError` does:
 * the failure being replaced is two plausible spellings of one thing and no way
 * to see which one is in hand.
 */
export class UnknownAssessmentError extends Error {
  readonly input: string;
  readonly known: readonly string[];

  constructor(input: string, known: readonly string[] = CURRICULUM_ASSESSMENT_IDS) {
    super(
      `unknown assessment id ${JSON.stringify(input)}; known assessments are ` +
        `${known.map((id) => JSON.stringify(id)).join(", ") || "(none)"}`,
    );
    this.name = "UnknownAssessmentError";
    this.input = input;
    this.known = [...known];
  }
}

/** Narrow a plain string onto the branded canonical id, or refuse it. */
export function asCurriculumAssessmentId(value: string): CurriculumAssessmentId {
  const resolved = resolveAssessmentId(value);
  if (resolved === null) throw new UnknownAssessmentError(value);
  return resolved;
}
