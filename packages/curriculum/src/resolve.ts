import { lookupAlias } from "./aliases.js";
import { ALL_CONCEPTS, CONCEPTS } from "./conceptRegistry.js";
import { parseSeReference, type SeCode } from "./seCode.js";
import { STUDENT_EXPECTATIONS } from "./seRegistry.js";
import {
  isCurriculumConceptId,
  type ConceptAlias,
  type CurriculumConceptId,
  type InstructionalConcept,
  type StudentExpectation,
  type UnresolvedDisposition,
} from "./types.js";

// ============================================================================
// Resolution: turn any identifier a caller has into a canonical concept or SE,
// or refuse it with a reason.
//
// Refusing is the feature. `conceptId: string` accepted anything, which is how a
// bank ended up tagged with a strand, a placeholder, and a chapter's worth of
// out-of-era concepts without a single failure. Every function here either
// returns a registry object or says exactly why it cannot.
// ============================================================================

export type ConceptResolutionPath =
  /** The input was already a canonical concept id. */
  | "CANONICAL"
  /** An alias pointed straight at a concept. */
  | "ALIAS_CONCEPT"
  /** An alias named an SE clause, and one macro concept owns that clause. */
  | "ALIAS_SE_CLAUSE"
  /** The input parsed as an SE clause reference without needing the alias table. */
  | "PARSED_SE_CLAUSE";

export type ConceptResolutionFailure =
  /** Not in the registry, not in the alias table, and not parseable. */
  | "UNKNOWN_IDENTIFIER"
  /** Resolves to a student expectation, which is too coarse to be a concept. */
  | "RESOLVES_TO_SE_NOT_CONCEPT"
  /** Resolves to more than one student expectation. */
  | "RESOLVES_TO_SE_SET"
  /** Resolves to a strand rather than a student expectation. */
  | "RESOLVES_TO_STRAND"
  /** A known alias that deliberately maps to nothing. */
  | "ALIAS_UNRESOLVED"
  /** An SE clause with no macro concept, or with more than one. */
  | "CLAUSE_HAS_NO_UNIQUE_CONCEPT";

export type ConceptResolution =
  | {
      ok: true;
      concept: InstructionalConcept;
      path: ConceptResolutionPath;
      alias?: ConceptAlias;
    }
  | {
      ok: false;
      failure: ConceptResolutionFailure;
      detail: string;
      input: string;
      alias?: ConceptAlias;
      disposition?: UnresolvedDisposition;
      /** Concepts the caller could choose from, when the input was an SE. */
      candidates?: InstructionalConcept[];
    };

/** Thrown by the `require*` helpers. */
export class CurriculumReferenceError extends Error {
  readonly input: string;
  readonly failure: string;

  constructor(input: string, failure: string, detail: string) {
    super(`unresolvable curriculum reference ${JSON.stringify(input)}: ${detail}`);
    this.name = "CurriculumReferenceError";
    this.input = input;
    this.failure = failure;
  }
}

/**
 * The single macro concept that owns one clause of one SE. Micros are excluded
 * because several may enrich the same clause; exactly one macro may carry it.
 */
export function macroConceptForClause(
  code: SeCode,
  clauseId: string,
): InstructionalConcept[] {
  return ALL_CONCEPTS.filter(
    (c) =>
      c.tier === "MACRO" && c.parentSe === code && c.parentClauseId === clauseId,
  );
}

function fromClause(
  code: SeCode,
  clauseId: string,
  input: string,
  path: ConceptResolutionPath,
  alias?: ConceptAlias,
): ConceptResolution {
  const matches = macroConceptForClause(code, clauseId);
  if (matches.length === 1) {
    return alias
      ? { ok: true, concept: matches[0]!, path, alias }
      : { ok: true, concept: matches[0]!, path };
  }
  return {
    ok: false,
    failure: "CLAUSE_HAS_NO_UNIQUE_CONCEPT",
    detail:
      matches.length === 0
        ? `${code} clause ${clauseId} has no macro concept`
        : `${code} clause ${clauseId} has ${matches.length} macro concepts`,
    input,
    ...(alias ? { alias } : {}),
    candidates: matches,
  };
}

/** Resolve any identifier to a canonical instructional concept. */
export function resolveConcept(raw: string): ConceptResolution {
  const input = raw.trim();

  if (isCurriculumConceptId(input)) {
    const direct = CONCEPTS.get(input);
    if (direct) return { ok: true, concept: direct, path: "CANONICAL" };
    return {
      ok: false,
      failure: "UNKNOWN_IDENTIFIER",
      detail:
        "well-formed concept id that is not in the registry; either a typo or a " +
        "concept that was never registered",
      input,
    };
  }

  const alias = lookupAlias(input);
  if (alias) {
    switch (alias.target.kind) {
      case "CONCEPT": {
        const concept = CONCEPTS.get(alias.target.conceptId);
        if (!concept) {
          return {
            ok: false,
            failure: "UNKNOWN_IDENTIFIER",
            detail: `alias points at unregistered concept ${alias.target.conceptId}`,
            input,
            alias,
          };
        }
        return { ok: true, concept, path: "ALIAS_CONCEPT", alias };
      }
      case "SE": {
        if (alias.target.clauseId) {
          return fromClause(
            alias.target.code,
            alias.target.clauseId,
            input,
            "ALIAS_SE_CLAUSE",
            alias,
          );
        }
        return {
          ok: false,
          failure: "RESOLVES_TO_SE_NOT_CONCEPT",
          detail:
            `resolves to student expectation ${alias.target.code}, which is too ` +
            "coarse to assess; choose one of its concepts",
          input,
          alias,
          candidates: ALL_CONCEPTS.filter(
            (c) =>
              alias.target.kind === "SE" && c.parentSe === alias.target.code,
          ),
        };
      }
      case "SE_SET":
        return {
          ok: false,
          failure: "RESOLVES_TO_SE_SET",
          detail: `names several standards at once: ${alias.target.codes.join(", ")}`,
          input,
          alias,
        };
      case "UNRESOLVED":
        return {
          ok: false,
          failure: "ALIAS_UNRESOLVED",
          detail: alias.target.detail,
          input,
          alias,
          disposition: alias.target.disposition,
        };
    }
  }

  const ref = parseSeReference(input);
  switch (ref.kind) {
    case "SE": {
      if (!STUDENT_EXPECTATIONS.has(ref.code)) {
        return {
          ok: false,
          failure: "UNKNOWN_IDENTIFIER",
          detail:
            `parses as student expectation ${ref.code}, which is not one of ` +
            "Boston's target standards",
          input,
        };
      }
      if (ref.clauseId) {
        return fromClause(ref.code, ref.clauseId, input, "PARSED_SE_CLAUSE");
      }
      return {
        ok: false,
        failure: "RESOLVES_TO_SE_NOT_CONCEPT",
        detail:
          `resolves to student expectation ${ref.code}, which is too coarse to ` +
          "assess; choose one of its concepts",
        input,
        candidates: ALL_CONCEPTS.filter((c) => c.parentSe === ref.code),
      };
    }
    case "SE_SET":
      return {
        ok: false,
        failure: "RESOLVES_TO_SE_SET",
        detail: `names several standards at once: ${ref.codes.join(", ")}`,
        input,
      };
    case "STRAND_ONLY":
      return {
        ok: false,
        failure: "RESOLVES_TO_STRAND",
        detail:
          `names strand ${ref.grade}.${ref.strand} rather than one of its ` +
          "student expectations",
        input,
      };
    case "INVALID":
      return {
        ok: false,
        failure: "UNKNOWN_IDENTIFIER",
        detail: ref.reason,
        input,
      };
  }
}

/** Resolve or throw. Use at content-build boundaries. */
export function requireConcept(raw: string): InstructionalConcept {
  const result = resolveConcept(raw);
  if (!result.ok) {
    throw new CurriculumReferenceError(raw, result.failure, result.detail);
  }
  return result.concept;
}

export type SeResolution =
  | { ok: true; se: StudentExpectation; clauseId: string | null }
  | { ok: false; failure: string; detail: string; input: string };

/** Resolve any identifier to a student expectation. */
export function resolveSe(raw: string): SeResolution {
  const input = raw.trim();

  if (isCurriculumConceptId(input)) {
    const concept = CONCEPTS.get(input);
    if (!concept) {
      return {
        ok: false,
        failure: "UNKNOWN_IDENTIFIER",
        detail: "well-formed concept id that is not in the registry",
        input,
      };
    }
    const se = STUDENT_EXPECTATIONS.get(concept.parentSe)!;
    return { ok: true, se, clauseId: concept.parentClauseId };
  }

  const alias = lookupAlias(input);
  if (alias) {
    if (alias.target.kind === "SE") {
      const se = STUDENT_EXPECTATIONS.get(alias.target.code);
      if (!se) {
        return {
          ok: false,
          failure: "UNKNOWN_IDENTIFIER",
          detail: `alias points at unregistered standard ${alias.target.code}`,
          input,
        };
      }
      return { ok: true, se, clauseId: alias.target.clauseId };
    }
    if (alias.target.kind === "CONCEPT") {
      const concept = CONCEPTS.get(alias.target.conceptId);
      if (concept) {
        const se = STUDENT_EXPECTATIONS.get(concept.parentSe)!;
        return { ok: true, se, clauseId: concept.parentClauseId };
      }
    }
    if (alias.target.kind === "SE_SET") {
      return {
        ok: false,
        failure: "RESOLVES_TO_SE_SET",
        detail: `names several standards at once: ${alias.target.codes.join(", ")}`,
        input,
      };
    }
    if (alias.target.kind === "UNRESOLVED") {
      return {
        ok: false,
        failure: "ALIAS_UNRESOLVED",
        detail: alias.target.detail,
        input,
      };
    }
  }

  const ref = parseSeReference(input);
  if (ref.kind === "SE") {
    const se = STUDENT_EXPECTATIONS.get(ref.code);
    if (se) return { ok: true, se, clauseId: ref.clauseId };
    return {
      ok: false,
      failure: "UNKNOWN_IDENTIFIER",
      detail: `${ref.code} is not one of Boston's target standards`,
      input,
    };
  }
  if (ref.kind === "STRAND_ONLY") {
    return {
      ok: false,
      failure: "RESOLVES_TO_STRAND",
      detail: `names strand ${ref.grade}.${ref.strand}, not a student expectation`,
      input,
    };
  }
  return {
    ok: false,
    failure: "UNKNOWN_IDENTIFIER",
    detail: ref.kind === "INVALID" ? ref.reason : "unresolvable",
    input,
  };
}

/** Resolve or throw. */
export function requireSe(raw: string): StudentExpectation {
  const result = resolveSe(raw);
  if (!result.ok) {
    throw new CurriculumReferenceError(raw, result.failure, result.detail);
  }
  return result.se;
}

/** Batch retag helper: resolve a list of legacy tags, reporting each outcome. */
export function retag(
  rawTags: readonly string[],
): { input: string; conceptId: CurriculumConceptId | null; detail: string }[] {
  return rawTags.map((input) => {
    const result = resolveConcept(input);
    return result.ok
      ? {
          input,
          conceptId: result.concept.conceptId,
          detail: `resolved via ${result.path}`,
        }
      : { input, conceptId: null, detail: `${result.failure}: ${result.detail}` };
  });
}
