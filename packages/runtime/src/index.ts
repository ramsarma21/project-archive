// ============================================================================
// @pa/runtime: deterministic seed machinery.
//
// This package used to be the old game's chapter-agnostic learning engine — a
// flow driver, a field-state reducer, a learner model and an open-response
// rubric resolver. All of it retired with the Boston text slice. What survived
// is the one piece the new game still depends on: HMAC-derived attempt seeds.
//
// `apps/api/src/progression/service.ts` derives an attempt seed when it opens a
// mission attempt, so the same attempt replays to the same numbers on any
// machine. Everything else the new game needs lives in @pa/engine-world
// (simulation), @pa/duel and @pa/grading (verdicts), and @pa/assessment.
// ============================================================================

export { deriveAttemptSeed, deriveFieldSeedHex, draw, bytesToHex } from "./seed.js";
