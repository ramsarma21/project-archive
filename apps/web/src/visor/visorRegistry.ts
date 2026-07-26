import type { VisorSource } from "./visorPlan.js";

// ---------------------------------------------------------------------------
// Whether there is a held moment at all: for this mission, and for this attempt.
//
// Both halves of that question live here because they are one question with two
// clauses, and because neither of them is about drawing — the answer decides
// whether the container mounts a visor, not what the visor puts on the screen.
// Keeping them out of the component also means they can be asserted by a test
// that has no DOM, which for a rule about the FIRST attempt matters: it is a rule
// nobody can check by playing, since checking it means playing a mission twice.
//
// The mission half has the same shape as `registerDuelView` in the mission
// container: the surface is registered, never imported by whoever mounts it, so
// the container's BRIEFING branch does not have to know that M1's crowd lives in
// `@pa/mission-m1` and Mission 2's will live somewhere else.
//
// FAILING OPEN IS DELIBERATE. A mission with no registered source gets no held
// moment and goes straight to its run. The alternative — refusing to deploy, or
// drawing an empty visor — would make an unannotated mission unplayable or a lie,
// and a briefing is the one part of this game that is genuinely optional.
// ---------------------------------------------------------------------------

/**
 * Whether this attempt gets the held moment.
 *
 * The policy, and the only place it lives. First attempt teaches; after that the
 * player reads the world itself, and the container falls back to its own
 * skippable curtain — because a student replaying a mission they know should not
 * be shown a map of it again, and there is already a mandatory three-minute
 * module in front of every attempt.
 */
export function visorHoldsBriefing(attemptOrdinal: number): boolean {
  return attemptOrdinal <= 1;
}

const sources = new Map<string, () => VisorSource>();

export function registerVisorSource(
  missionId: string,
  factory: () => VisorSource,
): void {
  sources.set(missionId, factory);
}

export function visorSourceFor(missionId: string): VisorSource | null {
  const factory = sources.get(missionId);
  return factory ? factory() : null;
}

/** Tests only. */
export function clearVisorSources(): void {
  sources.clear();
}
