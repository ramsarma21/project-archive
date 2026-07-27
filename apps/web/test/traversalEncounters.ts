import type { MissionRuntime } from "../src/mission/traversal.js";

// ---------------------------------------------------------------------------
// Isolating perspective encounters for a TRAVERSAL-only harness.
//
// The mission runtime steps a perspective-encounter machine per authored stop,
// and while one is APPROACH/QUESTION/SUBMITTING it LOCKS locomotion and gates
// REACHED_DUEL on every stop having reached a verdict. That is correct for the
// real game — a stop is a wall the player must answer at — but a headless
// traversal test has no overlay to submit an answer, so the run would lock at
// the first trigger and never move again.
//
// This is the injected already-resolved state the traversal harness runs
// against: every machine is put straight into RELEASED, its terminal phase, so
// it locks nothing, overrides no watcher, and reports itself participated. It
// mutates ONLY the test runtime's own machines — production encounter behaviour
// (the machine, its phases, its consequences) is untouched — and it is the one
// explicit seam a traversal test uses to say "assume the stops are done".
// ---------------------------------------------------------------------------

/** Put every encounter machine into its terminal RELEASED phase. */
export function resolveEncountersForTraversal(runtime: MissionRuntime): void {
  for (const encounter of runtime.encounters) {
    encounter.phase = "RELEASED";
  }
}
