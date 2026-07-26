// ============================================================================
// Retired formative open-response types.
//
// The old game graded free prose against an authored rubric: a classifier
// returned STRONG / PARTIAL / MISSING per criterion, a resolver folded that into
// an EVIDENCE_CONNECTED / PARTIAL_CONNECTION / NEEDS_SOURCE_REVISIT label, and
// the label was committed to the event log. That whole taxonomy is gone. The new
// game's verdicts are CORRECT / WRONG, minted server-side by @pa/grading and
// consumed by @pa/duel — see packages/grading/src/rubric.ts.
//
// What is left here are the four record shapes that `field.ts` and `protocol.ts`
// still name in the retired chapter's field state and runtime view. They are
// plain interfaces rather than zod schemas on purpose: nothing constructs or
// parses them any more, so a schema would assert a contract no code upholds.
// They exist only so those two files still describe the shape of a save that a
// device might be carrying, and they should be deleted alongside the
// `openResponseCompletions` block in field.ts and the `openResponse` block in
// protocol.ts whenever the retired field state itself is retired.
// ============================================================================

/** A submitted response, by reference. The prose itself never entered a save. */
export interface OpenResponseReference {
  responseId: string;
  attemptId: string;
  promptId: string;
  promptVersion: string;
  submittedAt: string;
  storage: "ENCRYPTED_SERVER" | "LOCAL_EPHEMERAL";
}

/** The claim-and-evidence pair a learner assembled, by id. */
export interface TypesetArtifactReference {
  claimId: string;
  evidenceIds: readonly string[];
}

/** The committed outcome of one graded response. */
export interface DeterministicResolution {
  criterionIds: readonly string[];
  evidenceIds: readonly string[];
  feedbackIds: readonly string[];
  rubricId: string;
  rubricVersion: string;
}

/** An authored prompt, as the retired presenter received it. */
export interface OpenResponsePrompt {
  promptId: string;
  version: string;
  title: string;
  prompt: string;
  rubricId: string;
  rubricVersion: string;
}

export interface FormativeEvidenceRecord {
  response: OpenResponseReference;
  artifact: TypesetArtifactReference;
  resolution: DeterministicResolution;
}

export interface AuthoredNpcFollowupView {
  nodeId: string;
  npcId: string;
  name: string;
  openingLines: readonly string[];
  options: readonly {
    optionId: string;
    text: string;
    reply: string;
    leadsToPromptId?: string;
  }[];
}

export interface ArchiveConnectionView {
  cardId: string;
  title: string;
  body: string;
  citations: readonly string[];
  artifactRefs: readonly string[];
  linkedPromptId: string;
}
