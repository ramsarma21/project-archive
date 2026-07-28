// @pa/grading/pipeline — the offline question pipeline.
//
// The verification gauntlet a candidate item must clear before it ships, the runtime
// prose-comparison half, and the model seam the discriminator runs on. Built to the
// owner's architecture (offline generation of question + card binding + reference
// answer; deterministic card check and a short prose comparison at runtime) and
// documented in content/QUESTION-PIPELINE.md.

export * from "./types.js";
export * from "./text.js";
export * from "./aiTells.js";
export * from "./staticChecks.js";
export * from "./discriminator.js";
export * from "./prose.js";
export * from "./gauntlet.js";
export { type PipelineModel, type PipelineJudgeRequest, TrueFoundryPipelineModel } from "./model.js";
