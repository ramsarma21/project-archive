// ============================================================================
// Canonical student-expectation (SE) codes.
//
// The repository accumulated at least eight ways of writing the same standard:
// 8.4(A), 8.4A, "8.4(A):POSTWAR_POLICY", (4)(A), "(4)(A)·Stamp Act", (15)(A/E),
// strand-only 8.12, and bare clause ids like POSTWAR_POLICY. Nothing rejected
// any of them because the identifier type was `string`.
//
// This module fixes ONE canonical spelling and makes every other spelling pass
// through a parser that either normalizes it or refuses it:
//
//     <grade>.<strand>(<LETTER>)      e.g. 8.4(A)
//
// `SeCode` is a branded string, so a raw string cannot be assigned to a field
// that wants an SE code without going through `asSeCode`/`normalizeSeCode`.
// ============================================================================

/** A student-expectation code in canonical form. Mint only via this module. */
export type SeCode = string & { readonly __brand: "PA.SeCode" };

/**
 * Grade assumed when a reference omits it, as `(4)(A)` does. Every source doc
 * in this repository is Grade 8 U.S. History; a cross-grade registry would have
 * to make this explicit at the call site instead.
 */
export const DEFAULT_GRADE = 8;

/** The one accepted spelling of an SE code. */
export const CANONICAL_SE_PATTERN = /^(\d{1,2})\.(\d{1,2})\(([A-Z])\)$/;

/** Clause tokens qualify an SE: `8.4(A):POSTWAR_POLICY`. */
export const CLAUSE_TOKEN_PATTERN = /^[A-Z][A-Z0-9_]*$/;

const FULL_PARENTHESIZED = /^(\d{1,2})\.(\d{1,2})\(([A-Z](?:\s*\/\s*[A-Z])*)\)$/;
const GRADE_OMITTED = /^\((\d{1,2})\)\(([A-Z](?:\s*\/\s*[A-Z])*)\)$/;
const BARE_LETTER = /^(\d{1,2})\.(\d{1,2})([A-Z](?:\s*\/\s*[A-Z])*)$/;
const STRAND_DOTTED = /^(\d{1,2})\.(\d{1,2})$/;
const STRAND_PARENTHESIZED = /^\((\d{1,2})\)$/;

/** Characters this repository has used to attach a clause to an SE reference. */
const CLAUSE_SEPARATORS = [":", "\u00b7"];

/** Build a canonical code from its parts. */
export function makeSeCode(
  grade: number,
  strand: number,
  letter: string,
): SeCode {
  const code = `${grade}.${strand}(${letter.toUpperCase()})`;
  if (!CANONICAL_SE_PATTERN.test(code)) {
    throw new Error(`cannot build SE code from ${grade}/${strand}/${letter}`);
  }
  return code as SeCode;
}

/** Type guard: is this string already canonical? */
export function isSeCode(value: string): value is SeCode {
  return CANONICAL_SE_PATTERN.test(value);
}

/** Assert canonical form. Throws on anything else — used at registry edges. */
export function asSeCode(value: string): SeCode {
  if (!isSeCode(value)) {
    throw new Error(
      `not a canonical SE code: ${JSON.stringify(value)} (expected e.g. 8.4(A))`,
    );
  }
  return value;
}

export interface SeCodeParts {
  grade: number;
  strand: number;
  letter: string;
}

/** Decompose a canonical code. */
export function seCodeParts(code: SeCode): SeCodeParts {
  const m = CANONICAL_SE_PATTERN.exec(code);
  if (!m) throw new Error(`not a canonical SE code: ${code}`);
  return { grade: Number(m[1]), strand: Number(m[2]), letter: m[3]! };
}

/**
 * The outcome of reading an arbitrary curriculum reference found in code, in a
 * doc, or on an authored item.
 *
 * `SE_SET` exists because the docs write `(15)(A/E)` and `(12)(A/C)`, which name
 * two standards in one token. `STRAND_ONLY` exists because `Micro-Concepts.md`
 * tags micros with `8.12` and `8.29`, which are strands rather than testable
 * student expectations — a distinction that silently disappeared when every
 * identifier was a string.
 */
export type SeReference =
  | {
      kind: "SE";
      code: SeCode;
      /** Normalized clause token, when the reference carried one. */
      clauseId: string | null;
      /** Clause text exactly as written, before normalization. */
      clauseRaw: string | null;
      /** True when the grade was assumed rather than written. */
      gradeInferred: boolean;
      input: string;
    }
  | {
      kind: "SE_SET";
      codes: SeCode[];
      gradeInferred: boolean;
      input: string;
    }
  | {
      kind: "STRAND_ONLY";
      grade: number;
      strand: number;
      gradeInferred: boolean;
      input: string;
    }
  | { kind: "INVALID"; reason: string; input: string };

/** Normalize free clause text (`Stamp Act`) into a clause token (`STAMP_ACT`). */
export function normalizeClauseToken(raw: string): string | null {
  const token = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token.length > 0 && CLAUSE_TOKEN_PATTERN.test(token) ? token : null;
}

function splitClause(input: string): { head: string; clauseRaw: string | null } {
  for (const sep of CLAUSE_SEPARATORS) {
    const at = input.indexOf(sep);
    if (at > 0) {
      return {
        head: input.slice(0, at).trim(),
        clauseRaw: input.slice(at + sep.length).trim() || null,
      };
    }
  }
  return { head: input, clauseRaw: null };
}

function letters(group: string): string[] {
  return group.split("/").map((part) => part.trim());
}

/**
 * Read any curriculum reference this repository has produced. Never throws;
 * returns `INVALID` so a caller can report the offending string rather than
 * crash a content build.
 */
export function parseSeReference(input: string): SeReference {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { kind: "INVALID", reason: "empty reference", input };
  }

  const { head, clauseRaw } = splitClause(trimmed);

  const shapes: {
    re: RegExp;
    grade: (m: RegExpExecArray) => number;
    strand: (m: RegExpExecArray) => number;
    group: (m: RegExpExecArray) => string;
    gradeInferred: boolean;
  }[] = [
    {
      re: FULL_PARENTHESIZED,
      grade: (m) => Number(m[1]),
      strand: (m) => Number(m[2]),
      group: (m) => m[3]!,
      gradeInferred: false,
    },
    {
      re: BARE_LETTER,
      grade: (m) => Number(m[1]),
      strand: (m) => Number(m[2]),
      group: (m) => m[3]!,
      gradeInferred: false,
    },
    {
      re: GRADE_OMITTED,
      grade: () => DEFAULT_GRADE,
      strand: (m) => Number(m[1]),
      group: (m) => m[2]!,
      gradeInferred: true,
    },
  ];

  for (const shape of shapes) {
    const m = shape.re.exec(head);
    if (!m) continue;
    const grade = shape.grade(m);
    const strand = shape.strand(m);
    const group = letters(shape.group(m));
    if (group.length > 1) {
      return {
        kind: "SE_SET",
        codes: group.map((letter) => makeSeCode(grade, strand, letter)),
        gradeInferred: shape.gradeInferred,
        input,
      };
    }
    return {
      kind: "SE",
      code: makeSeCode(grade, strand, group[0]!),
      clauseId: clauseRaw ? normalizeClauseToken(clauseRaw) : null,
      clauseRaw,
      gradeInferred: shape.gradeInferred,
      input,
    };
  }

  const dotted = STRAND_DOTTED.exec(head);
  if (dotted) {
    return {
      kind: "STRAND_ONLY",
      grade: Number(dotted[1]),
      strand: Number(dotted[2]),
      gradeInferred: false,
      input,
    };
  }
  const parenStrand = STRAND_PARENTHESIZED.exec(head);
  if (parenStrand) {
    return {
      kind: "STRAND_ONLY",
      grade: DEFAULT_GRADE,
      strand: Number(parenStrand[1]),
      gradeInferred: true,
      input,
    };
  }

  return {
    kind: "INVALID",
    reason: "does not match any known student-expectation spelling",
    input,
  };
}

/**
 * Normalize to a single canonical code, or null. Strand-only references, code
 * sets, and unrecognized strings all return null on purpose: they are not
 * student expectations and must not be silently coerced into one.
 */
export function normalizeSeCode(input: string): SeCode | null {
  const ref = parseSeReference(input);
  return ref.kind === "SE" ? ref.code : null;
}

// ---- Formatters. Mechanical alias families are generated from these, so the
// alias table cannot drift away from the SE registry. ----

/** `8.4(A)` -> `8.4A` (the form `ConceptMeta.seIds` uses). */
export function formatBareLetter(code: SeCode): string {
  const { grade, strand, letter } = seCodeParts(code);
  return `${grade}.${strand}${letter}`;
}

/** `8.4(A)` -> `(4)(A)` (the form every design doc uses). */
export function formatGradeOmitted(code: SeCode): string {
  const { strand, letter } = seCodeParts(code);
  return `(${strand})(${letter})`;
}

/** `8.4(A)` + `POSTWAR_POLICY` -> `8.4(A):POSTWAR_POLICY` (the item-tag form). */
export function formatClauseQualified(code: SeCode, clauseId: string): string {
  return `${code}:${clauseId}`;
}

/** Sort key that orders 8.4(A) before 8.10(A) rather than lexically. */
export function compareSeCodes(a: SeCode, b: SeCode): number {
  const pa = seCodeParts(a);
  const pb = seCodeParts(b);
  return (
    pa.grade - pb.grade ||
    pa.strand - pb.strand ||
    pa.letter.localeCompare(pb.letter)
  );
}
