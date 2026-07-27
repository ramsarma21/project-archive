import {
  CommitMissionOutcomeRequestSchema,
  CompleteLearningModuleRequestSchema,
  type CommitMissionOutcomeRequest,
  type CompleteLearningModuleRequest,
} from "@pa/contracts";
import type { ModuleRunCompletion } from "../module/moduleGate.js";
import type { MissionResult } from "../mission/result.js";

// ---------------------------------------------------------------------------
// What the client is allowed to say.
//
// Two payloads, and the interesting thing about both is what they cannot
// contain. `CommitMissionOutcomeRequestSchema` and
// `CompleteLearningModuleRequestSchema` are `.strict()` AND run a recursive
// guard that rejects any key named for a server-derived value — xp, awardedXp,
// level, rank, attemptOrdinal, verdict, score, and a dozen more — anywhere in
// the body, at any depth.
//
// This module builds against those schemas and PARSES ITS OWN OUTPUT before
// returning it. That is not defensive habit: it means the property "the client
// never claims XP" is enforced by the same code the server enforces it with,
// so a future author who adds `awardedXp: result.awardedXp` to a payload here
// gets a failing unit test on this machine rather than a rejected request in a
// classroom.
//
// The mission container derives XP client-side, correctly, for the result
// screen. That number is display. It is deliberately absent from everything
// below: the server recomputes the award from the ordinal IT assigned when the
// attempt opened and the base award IT has authored, and the only thing the
// client contributes is one bit — cleared, or failed.
// ---------------------------------------------------------------------------

export type PayloadResult<T> =
  | { readonly ok: true; readonly body: T; readonly note: string | null }
  | { readonly ok: false; readonly reason: string };

/**
 * The module completion, as the server's request shape.
 *
 * The acknowledged cue ids are the whole gate: the server checks them against
 * the authored deck. `observedSeconds` is evidence and gates nothing, and the
 * attempt ordinal is conspicuously absent — the server reads attempts already
 * resolved and decides which attempt this run arms, so one module run can never
 * open two.
 */
export function moduleCompletionRequest(input: {
  chapterId: string;
  completion: ModuleRunCompletion;
}): PayloadResult<CompleteLearningModuleRequest> {
  const candidate = {
    chapterId: input.chapterId,
    moduleId: input.completion.moduleId,
    gatesKind: "MISSION_ATTEMPT" as const,
    gatesId: input.completion.missionId,
    acknowledgedCueIds: [...input.completion.acknowledgedCueIds],
    acknowledgedCheckIds: [...input.completion.acknowledgedCheckIds],
    observedSeconds: Math.max(0, Math.floor(input.completion.observedSeconds)),
  };
  const parsed = CompleteLearningModuleRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues[0]?.message ?? "INVALID_MODULE_BODY" };
  }
  return { ok: true, body: parsed.data, note: null };
}

/**
 * The terminal commit for one attempt.
 *
 * `attemptId` is the DURABLE id the server minted when it opened the attempt,
 * never the container's session-local one: the row it addresses is the row that
 * already holds the ordinal and the XP fraction, which is what makes the award
 * unforgeable rather than merely unforged.
 *
 * `committedEvents` is @pa/duel's serialised commit log, carried through
 * untouched, AND IT IS SENT WHOLE.
 *
 * This used to try twice. The log's `VERDICT_COMMITTED` entries carry a
 * `verdict` key, `verdict` is one of the names the progression guard refuses,
 * and the guard walked the whole body — so a commit carrying the log was
 * rejected outright and the mission paid nothing. Rather than lose a student's
 * clear, this function retried with `committedEvents: []` and reported what it
 * had sacrificed.
 *
 * `@pa/contracts` fixed the guard: `OPAQUE_TELEMETRY_FIELDS` exempts this one
 * field's CONTENTS at depth zero, because the server stores the log verbatim and
 * derives nothing from it — not the outcome, not the award, not a bullet count —
 * and a `verdict` sitting BESIDE `committedEvents` is still refused, which is the
 * case the guard exists for. A real commit carrying an intact duel log was
 * watched through against a running API.
 *
 * The retry is gone rather than left as insurance, and that is the point of this
 * note. Its remaining reachable path was a body invalid for some OTHER reason —
 * a malformed attempt id, a log past the 4096-entry cap — where dropping every
 * verdict receipt and succeeding is the worst available outcome: the commit path
 * verifies those receipts, so a silent truncation is how a graded duel becomes
 * an unsigned one with nothing logged. A body this function cannot build is now
 * a refusal with a reason.
 */
export function missionOutcomeRequest(input: {
  attemptId: string;
  outcome: "CLEARED" | "FAILED";
  committedEvents: readonly Record<string, unknown>[];
  baseRevision: number;
}): PayloadResult<CommitMissionOutcomeRequest> {
  const base = {
    attemptId: input.attemptId,
    outcome: input.outcome,
    baseRevision: input.baseRevision,
  };
  const parsed = CommitMissionOutcomeRequestSchema.safeParse({
    ...base,
    committedEvents: [...input.committedEvents],
  });
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues[0]?.message ?? "INVALID_OUTCOME_BODY",
    };
  }
  return { ok: true, body: parsed.data, note: null };
}

/**
 * The commit for a resolved attempt, addressed to the server's attempt row.
 *
 * Takes the durable attempt id separately from the result on purpose. The
 * result carries the container's own attempt id, which is identity for one
 * browser session; the row that pays out is the one the server opened, and
 * conflating them is how a commit ends up addressed at nothing.
 */
export function commitForResult(input: {
  durableAttemptId: string;
  result: MissionResult;
  baseRevision?: number;
}): PayloadResult<CommitMissionOutcomeRequest> {
  return missionOutcomeRequest({
    attemptId: input.durableAttemptId,
    outcome: input.result.outcome,
    committedEvents: input.result.committedEvents,
    // A freshly opened attempt is at revision 0 and the commit moves it to 1,
    // so a retry of a delivered commit answers ATTEMPT_CLOSED rather than
    // paying twice.
    baseRevision: input.baseRevision ?? 0,
  });
}
