// Protocol-level identifier types. Concrete id vocabularies (chapter ids,
// concept ids, package ids) are chapter content and live in chapter packages
// (e.g. @pa/chapter-boston); the engine validates them at session creation
// against the injected ChapterDefinition.

/**
 * Branded macro-concept id (a chapter-minted stable id string).
 * Chapter packages mint these; the runtime treats them as opaque keys into
 * the learner state.
 */
export type ConceptId = string & { readonly __brand: "PA.ConceptId" };

// Canonical seed message (Backend-AI-System PA.RUN.SEED.v1).
export const RUN_SEED_MESSAGE_PREFIX = "PA.RUN.SEED.v1";
