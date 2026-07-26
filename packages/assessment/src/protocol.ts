// The single import surface onto @pa/contracts. No other file in this package
// names that dependency, so if the progression protocol moves, exactly one file
// here breaks and the reconciliation is a diff against this list.
//
// WHY DEPEND ON IT AT ALL, when this package is otherwise pure. Because the
// mastery rule already exists there. `summarizeAssessmentForm` implements
// 100%-per-concept-with-no-partial-credit, and `selectFreshItems` implements
// fresh-item subtraction. Re-deriving either here would fork the rule that the
// API route and this engine must agree on, and a forked pass/fail rule on the
// accountability surface is the worst possible place to have two answers.
//
// WHAT IS DELIBERATELY NOT IMPORTED. `AssessmentItem` from
// contracts/src/assessment.ts, which is the retired game's item type. Two
// reasons, both structural:
//
//   1. It carries `correctOptionId`. This package must never hold an answer key
//      (see items.ts) — the key lives with the grading authority, and an item
//      descriptor with no key field cannot leak one into a client bundle.
//   2. It is keyed by `AssessmentConceptId`, which is one of the eight
//      incompatible curriculum vocabularies @pa/curriculum exists to replace.
//      See curriculum.ts.

export {
  // ---- constants ---------------------------------------------------------
  /** Two items per concept per form. The owner rejected a larger item count. */
  ASSESSMENT_ITEMS_PER_CONCEPT,
  /** The capstone pays this. XP comes only from mission clears. */
  ZERO_XP,

  // ---- the mastery and selection rules, consumed rather than re-derived --
  isCodexCardLearned,
  isCodexCardPvpLegal,
  isConceptMastered,
  isModuleGateSatisfied,
  moduleDeckCovered,
  selectFreshItems,
  summarizeAssessmentForm,
  unmasteredConceptIds,

  // ---- row shapes this engine projects onto -----------------------------
  type AssessmentConceptLedger,
  type AssessmentConceptResult,
  type AssessmentFormConcept,
  type AssessmentFormSummary,
  type ChapterAssessmentAttempt,
  type ChapterAssessmentResponse,
  type CodexCardState,
  type ConceptMastery,
  type GradedAssessmentResponse,
  type LearningModuleCompletion,
  type ProgressionError,
  type ProgressionLedgerEntry,
  type ProgressionLedgerKind,
} from "@pa/contracts";
