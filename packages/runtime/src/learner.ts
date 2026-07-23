import {
  type ConceptId,
  type LearnerState,
  type ConceptLearningState,
  type ExposureType,
  type ExposureProvenance,
} from "@pa/contracts";

// Chapter-parameterized: the concept list (and its durable insertion order)
// is supplied by ChapterDefinition.content.learnerConceptIds.
export function initialLearnerState(
  conceptIds: readonly ConceptId[],
): LearnerState {
  const mk = (): ConceptLearningState => ({
    exposures: [],
    distinctOccasionCount: 0,
    exposureTypes: [],
    learningGate: "NOT_READY",
    understanding: "NOT_ASSESSED",
    firstUnderstandingAttemptCount: 0,
    pendingReexposure: null,
    notesAddedTransactionId: null,
    demonstration: "LOCKED",
    priorDayReassessment: "NOT_DUE",
    misconceptionIds: [],
  });
  const learner = {} as LearnerState;
  for (const conceptId of conceptIds) {
    learner[conceptId] = mk();
  }
  return learner;
}

// Commit a tracked exposure. Idempotent per exposureId. Only tracked registry
// IDs should reach this function; ambient content must never call it.
export function commitExposure(
  learner: LearnerState,
  concept: ConceptId,
  exposureId: string,
  type: ExposureType,
  interactionOrdinal: number,
  provenance?: ExposureProvenance,
): boolean {
  const c = learner[concept];
  if (c.exposures.some((e) => e.exposureId === exposureId)) return false;
  c.exposures.push({ exposureId, type, interactionOrdinal, provenance });
  c.distinctOccasionCount = c.exposures.length;
  if (!c.exposureTypes.includes(type)) c.exposureTypes.push(type);
  if (c.distinctOccasionCount >= 3 && c.exposureTypes.length >= 2) {
    c.learningGate = "READY";
  }
  // If this exposure fulfils a post-Sync re-exposure obligation, mark it.
  if (c.pendingReexposure && c.pendingReexposure.retryExposureId === exposureId) {
    c.pendingReexposure.reexposureCommitted = true;
    c.pendingReexposure.spacingInteractionsSince = 0;
  }
  return true;
}

// Whether a concept's initial Sync may be presented now. The spacing minimum
// is chapter tuning (ChapterDefinition.content.minimumInteractionsBetweenSyncs).
export function canPresentInitialSync(
  learner: LearnerState,
  concept: ConceptId,
  interactionsSinceLastSync: number,
  anyLockActive: boolean,
  minimumInteractionsBetweenSyncs: number,
): boolean {
  const c = learner[concept];
  if (anyLockActive) return false;
  if (c.understanding === "UNDERSTOOD") return false;
  if (c.understanding !== "NOT_ASSESSED") return false;
  if (c.learningGate !== "READY") return false;
  return interactionsSinceLastSync >= minimumInteractionsBetweenSyncs;
}

export function canPresentRetrySync(
  learner: LearnerState,
  concept: ConceptId,
  minimumInteractionsBetweenSyncs: number,
): boolean {
  const c = learner[concept];
  if (c.understanding !== "REEXPOSURE_REQUIRED") return false;
  const re = c.pendingReexposure;
  if (!re || !re.reexposureCommitted) return false;
  return re.spacingInteractionsSince >= minimumInteractionsBetweenSyncs;
}

// Apply an initial Sync answer. Returns whether Notes should flicker (added once).
export function applyInitialSync(
  learner: LearnerState,
  concept: ConceptId,
  correct: boolean,
  txId: string,
  retryExposureId: string,
): { understood: boolean; notesAdded: boolean } {
  const c = learner[concept];
  c.firstUnderstandingAttemptCount += 1;
  if (correct) {
    c.understanding = "UNDERSTOOD";
    const notesAdded = c.notesAddedTransactionId === null;
    if (notesAdded) c.notesAddedTransactionId = txId;
    return { understood: true, notesAdded };
  }
  c.understanding = "REEXPOSURE_REQUIRED";
  c.pendingReexposure = {
    retryExposureId,
    reexposureCommitted: false,
    spacingInteractionsSince: 0,
  };
  return { understood: false, notesAdded: false };
}

// Apply the retry Sync. On a second miss the runtime eliminates distractors and
// forces resolution; either way the concept ends UNDERSTOOD and Notes is added
// exactly once. It can never loop again.
export function applyRetrySync(
  learner: LearnerState,
  concept: ConceptId,
  txId: string,
): { notesAdded: boolean } {
  const c = learner[concept];
  c.understanding = "UNDERSTOOD";
  c.pendingReexposure = null;
  const notesAdded = c.notesAddedTransactionId === null;
  if (notesAdded) c.notesAddedTransactionId = txId;
  return { notesAdded };
}

export function unlockDemonstration(learner: LearnerState, concept: ConceptId): void {
  const c = learner[concept];
  if (c.understanding === "UNDERSTOOD" && c.demonstration === "LOCKED") {
    c.demonstration = "PENDING";
  }
}

export function markDemonstrated(learner: LearnerState, concept: ConceptId): void {
  learner[concept].demonstration = "DEMONSTRATED";
}

// Day-end gate: all concepts understood + demonstrated, none with an open
// correction obligation.
export function dayCompletionSatisfied(learner: LearnerState): boolean {
  return Object.values(learner).every(
    (c) =>
      c.understanding === "UNDERSTOOD" &&
      c.demonstration === "DEMONSTRATED" &&
      c.pendingReexposure === null,
  );
}

// Concepts still needing exposure work (for B11.5 deficit closure).
export function conceptsNeedingExposure(learner: LearnerState): ConceptId[] {
  return (Object.keys(learner) as ConceptId[]).filter((id) => {
    const c = learner[id];
    return !(c.distinctOccasionCount >= 3 && c.exposureTypes.length >= 2);
  });
}
