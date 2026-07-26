// @pa/grading — the server-authoritative duel grader.
//
// The shape of the thing: an authored item bank (./rubric.ts, ./items), a
// classification call under a hard 1.5-second deadline (./provider.ts), a
// deterministic projection of the author's line onto a binary (./service.ts), a
// verdict cache keyed on the rubric's content hash (./cache.ts), a review log for
// every generous grant (./reviewLog.ts), and an HMAC receipt that makes the
// verdict unforgeable on its way through the client (./verdict.ts).
//
// What is deliberately not here: any way for a caller to supply a verdict, any
// way for a bullet count to be expressed, and any third outcome.

export * from "./tuning.js";
export * from "./normalize.js";
export * from "./rubric.js";
export * from "./verdict.js";
export * from "./prompt.js";
export * from "./cache.js";
export * from "./reviewLog.js";
export * from "./provider.js";
export * from "./service.js";
export * from "./request.js";
export * from "./receiptSecret.js";
export * from "./lowConfidence.js";
export {
  m1ItemBank,
  m1AuthoredPools,
  m1ContentBank,
  m1GradingPolicy,
  M1_DUEL_BANK_PATH,
} from "./items/m1.js";
export { toAuthoredPools, type ContentBank } from "./items/port.js";
export {
  buildEvalSet,
  authoredCases,
  runEval,
  formatEvalReport,
  type EvalCase,
  type EvalCategory,
  type EvalReport,
} from "./eval/harness.js";
