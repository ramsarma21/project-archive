// The single import surface onto @pa/curriculum, plus the narrow port this
// package actually needs from it.
//
// THIS PACKAGE INVENTS NO CONCEPT VOCABULARY. The repository already holds at
// least eight ways of writing the same curriculum — `8.4(A)`, `8.4A`,
// `8.4(A):STAMP_ACT`, `(4)(A)`, `8.12`, `BOS.MD01.CONCEPT.*`, `RCC.*`, `RCL.*`,
// `MICRO.*`, bare clause ids, and `TEKS.PENDING_SME_REVIEW` — and @pa/curriculum
// exists to collapse them onto one branded `CurriculumConceptId`. A ninth scheme
// invented here would be the worst of the set, because the capstone is the row a
// district reads: a mastery report keyed by a private identifier is a report
// nobody can reconcile against the state's standards.
//
// So `CurriculumConceptId` is the only concept key in this package, it is
// branded, and the two places a foreign identifier can enter — authored
// blueprints and authored item banks — go through `resolveConceptRef` below,
// which retags a legacy identifier through the registry's alias table rather
// than accepting it.
//
// WHY THERE IS A PORT AS WELL AS A DIRECT IMPORT. `ConceptSource` is the
// three-question interface the engine needs: which concepts does this chapter
// assess, what is this concept called, and which Codex cards does it mint. The
// registry answers all three today. The port exists so a test can build a
// four-concept fixture chapter without the 46-concept Boston registry, and so a
// later chapter can be registered without this package changing.

import {
  ALL_CONCEPTS,
  UnknownChapterError,
  getConcept,
  resolveChapterId,
  resolveConcept,
  type CurriculumConceptId,
  type InstructionalConcept,
} from "@pa/curriculum";

export {
  CHAPTER_BOSTON,
  UnknownChapterError,
  asCurriculumConceptId,
  eraOverlapsWindow,
  isCurriculumChapterId,
  isCurriculumConceptId,
  parseEraRange,
  resolveChapterId,
  type CurriculumChapterId,
  type CurriculumConceptId,
  type EraRange,
  type InstructionalConcept,
} from "@pa/curriculum";

/**
 * What the engine needs to know about a concept. A projection of
 * `InstructionalConcept`, not a competing definition: every field is copied
 * from the registry entry by `registryConceptSource`.
 */
export interface AssessableConcept {
  readonly conceptId: CurriculumConceptId;
  /** Human label for the teacher-facing report. Never an identifier. */
  readonly label: string;
  /**
   * Cards this concept mints. 100% on the concept promotes each of these to
   * PvP-legal; see cards.ts. Empty is legal and means the concept is assessed
   * but carries no card.
   */
  readonly codexCardIds: readonly string[];
  /**
   * MACRO concepts are required learning and gate the chapter. MICRO concepts
   * are enrichment, are reached only through the reactive world, and are never
   * a gate — so the capstone does not assess them at all.
   */
  readonly tier: "MACRO" | "MICRO";
}

/** The three questions the engine asks the curriculum. */
export interface ConceptSource {
  /**
   * Every concept this chapter's capstone covers, in a stable order. Order is
   * part of the contract: form selection is deterministic, so an unstable
   * concept order would make a replay produce a different form.
   *
   * THROWS `UnknownChapterError` for a chapter the source does not hold, and
   * never returns an empty list to mean the same thing. An empty concept list
   * is not a smaller capstone, it is no capstone, and the one time these two
   * answers were conflated a chapter keyed `boston-1765` read a registry keyed
   * `BOSTON` and every caller downstream believed the chapter assessed nothing.
   */
  assessableConcepts(chapterId: string): readonly AssessableConcept[];
  concept(conceptId: CurriculumConceptId): AssessableConcept | undefined;
}

function project(concept: InstructionalConcept): AssessableConcept {
  return {
    conceptId: concept.conceptId,
    label: concept.label,
    codexCardIds: concept.codexCardIds,
    tier: concept.tier,
  };
}

/**
 * The real registry as a `ConceptSource`.
 *
 * `assessable` is the registry's own flag and it is trusted rather than
 * recomputed: the registry sets it true for MACRO concepts and false for the
 * enrichment micros, and second-guessing that here would put the decision of
 * what is required learning in two places.
 *
 * The order is the registry's declaration order, which is grouped by parent
 * standard. That is both stable and the order a teacher expects to read.
 */
export function registryConceptSource(): ConceptSource {
  const byChapter = new Map<string, AssessableConcept[]>();
  for (const concept of ALL_CONCEPTS) {
    if (!concept.assessable) continue;
    const list = byChapter.get(concept.owner.chapterId) ?? [];
    list.push(project(concept));
    byChapter.set(concept.owner.chapterId, list);
  }
  return {
    assessableConcepts: (chapterId) => {
      // Canonicalised first, so a superseded spelling reaches the chapter it
      // names rather than missing every row in the index.
      const concepts = byChapter.get(resolveChapterId(chapterId) ?? chapterId);
      if (!concepts) throw new UnknownChapterError(chapterId, [...byChapter.keys()]);
      return concepts;
    },
    concept: (conceptId) => {
      const concept = getConcept(conceptId);
      return concept ? project(concept) : undefined;
    },
  };
}

/**
 * A `ConceptSource` over an explicit list. For tests and for a chapter whose
 * concepts are authored outside the registry — which no chapter should be, so
 * this deliberately still demands canonical ids.
 *
 * Refuses an unheld chapter key for the same reason the registry source does: a
 * fixture whose chapter id is a typo would otherwise compile a capstone over no
 * concepts and prove nothing, which is the failure this port is meant to catch
 * early rather than reproduce.
 */
export function staticConceptSource(
  chapters: Readonly<Record<string, readonly AssessableConcept[]>>,
): ConceptSource {
  const index = new Map<CurriculumConceptId, AssessableConcept>();
  for (const concepts of Object.values(chapters)) {
    for (const concept of concepts) index.set(concept.conceptId, concept);
  }
  return {
    assessableConcepts: (chapterId) => {
      const concepts = chapters[chapterId];
      if (!concepts) throw new UnknownChapterError(chapterId, Object.keys(chapters));
      return concepts;
    },
    concept: (conceptId) => index.get(conceptId),
  };
}

export type ConceptRefResolution =
  | { readonly ok: true; readonly conceptId: CurriculumConceptId }
  | {
      readonly ok: false;
      readonly failure: string;
      readonly detail: string;
      readonly input: string;
    };

/**
 * The one door a foreign identifier may enter through.
 *
 * Authored content predates the registry, so a blueprint or an item bank may
 * still carry `RCC.DEBT_POLICY_INTRO` or `8.4(A):STAMP_ACT`. Those retag
 * cleanly through the alias table. What does not pass is a string that resolves
 * to a student expectation rather than a concept — `8.4(A)` names six
 * independent causes of the Revolution and a student can hold four of them, so
 * it is too coarse to keep a mastery record against, and the registry's own
 * refusal is the right answer.
 *
 * Note that a well-formed but unregistered concept id fails here too. The
 * registry, not the id pattern, is the authority on what exists, so this does
 * not short-circuit on `isCurriculumConceptId`.
 */
export function resolveConceptRef(reference: string): ConceptRefResolution {
  const resolution = resolveConcept(reference);
  if (resolution.ok) return { ok: true, conceptId: resolution.concept.conceptId };
  return {
    ok: false,
    failure: resolution.failure,
    detail: resolution.detail,
    input: resolution.input,
  };
}
