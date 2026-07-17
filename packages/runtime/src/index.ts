import type { PresenterEvent } from "@pa/contracts";
import { Ctx } from "./engine/ctx.js";
import { Session } from "./engine/driver.js";
import { day1Flow } from "./content/day1/flow.js";
import { deriveAttemptSeed } from "./seed.js";
import { CHAPTER_ID } from "@pa/contracts";

export { Ctx } from "./engine/ctx.js";
export { Session } from "./engine/driver.js";
export { day1Flow } from "./content/day1/flow.js";
export { deriveAttemptSeed, draw, bytesToHex } from "./seed.js";
export { resolveOutcome } from "./outcome.js";
export { buildMasteryReport } from "./report.js";
export type { ReportMeta } from "./report.js";
export * from "./content/day1/tables.js";
export { TEXT } from "./content/day1/text.js";

// Create a Boston Day 1 session for a profile. attemptStartSequence defaults to
// 0 for the first attempt. Determinism comes from the variation root seed.
export function createDay1Session(opts: {
  variationRootSeedHex: string;
  attemptStartSequence?: number;
  priorEvents?: PresenterEvent[];
}): Session {
  const seed = deriveAttemptSeed(opts.variationRootSeedHex, CHAPTER_ID, opts.attemptStartSequence ?? 0);
  const ctx = new Ctx(seed);
  return new Session(ctx, day1Flow, opts.priorEvents ?? []);
}
