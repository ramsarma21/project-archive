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
 * untouched. It has one problem today, and dropping it is the deliberate
 * answer: the log's `VERDICT_COMMITTED` entries carry a `verdict` key, and
 * `verdict` is one of the names the progression guard refuses anywhere in a
 * request body. The guard is right about requests in general and wrong about
 * this field in particular — the server stores the log verbatim and derives
 * nothing from it — but until the contract exempts it, a commit carrying the
 * log is rejected outright and the mission pays nothing.
 *
 * So: try with the log, and if the guard refuses it, commit the outcome without
 * it and say so. Progression is the thing that must not be lost; the log is
 * evidence that can be re-attached the day the contract is fixed. Silently
 * losing a student's clear to preserve a telemetry payload would be the wrong
 * trade in the wrong direction.
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
  const withEvents = CommitMissionOutcomeRequestSchema.safeParse({
    ...base,
    committedEvents: [...input.committedEvents],
  });
  if (withEvents.success) return { ok: true, body: withEvents.data, note: null };

  const withoutEvents = CommitMissionOutcomeRequestSchema.safeParse({
    ...base,
    committedEvents: [],
  });
  if (!withoutEvents.success) {
    return {
      ok: false,
      reason: withoutEvents.error.issues[0]?.message ?? "INVALID_OUTCOME_BODY",
    };
  }
  return {
    ok: true,
    body: withoutEvents.data,
    note:
      "the duel commit log was refused by the progression request guard " +
      "(it names a verdict) and the outcome was committed without it",
  };
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
