// The rubric format authors write against.
//
// THE CONSTRAINT THAT SHAPED THIS FILE. Eighteen duel items per mission across
// fourteen missions is 252 items, and content is the project's real bottleneck.
// A format that costs the author a rubric id, a version string, a hash, a
// criteria array, a per-label feedback map and an evidence allowlist per item —
// which is what `OpenResponseRubricSchema` in @pa/contracts asks for — will not
// get 252 items written. So everything mechanical is derived and everything
// derived is absent from the authoring surface:
//
//   * The item id is written short and local ("POSTWAR.WHY_NOW"); the pool
//     supplies the namespace.
//   * The rubric version is a content hash of the fields that change grading. An
//     author never bumps a version, and — more importantly — cannot forget to.
//     Editing a rubric changes its version, which changes every cache key
//     derived from it, so a stale verdict is structurally unreachable.
//   * There is no feedback map, because the duel shows no feedback. The verdict
//     buys bullets; that is the entire consequence.
//
// What is left is close to what the author already writes in prose in
// Mission-Slate §4.9: the question, the answer, the ideas that have to be there,
// and examples. The shape below is a near-transliteration of that document, on
// purpose — §4.9's eighteen items were authored before this format existed and
// they port field for field.
//
// THE LINE IS THE AUTHOR'S. A duel verdict is binary, so somebody has to decide
// whether "war debt" alone — without naming who pays — is correct. The system
// refuses to guess: `ideas` lists what matters and `needs` says how many of them
// a correct answer must carry. `needs: "all"` is the default and the common case;
// `needs: 2` over three ideas is how §4.9's three-link causal chain items keep
// their "two of the three" line without reintroducing partial credit. There is
// no third outcome anywhere in the file.
//
// EXAMPLES ARE HELD OUT, NOT PROMPTED. `accept` and `reject` are verbatim
// student-voice answers, and they become the evaluation set (see ./eval). They
// are never rendered into the prompt: an eval case the model was shown is not a
// measurement. `wrongIfSays` is the prompt-visible negative guidance — it
// describes classes of wrong answer rather than quoting one, which is exactly
// how §4.9's "Reject:" lines are already written.

import { createHash } from "node:crypto";

/** One item as an author writes it. */
export interface AuthoredItem {
  /** Short and local; the pool namespaces it. `POSTWAR.WHY_NOW`. */
  readonly id: string;
  /** The question the player is shown, verbatim. */
  readonly ask: string;
  /** The reference answer, in the author's own prose. Shown to the classifier. */
  readonly correct: string;
  /**
   * The load-bearing ideas. One entry per thing that has to be present for the
   * answer to count, phrased as the idea and not as words to match — the
   * classifier is comparing meaning, so "the colonies as the intended payer" is
   * a usable idea and "contains the word colonies" is not.
   */
  readonly ideas: readonly string[];
  /**
   * How many of `ideas` a correct answer must carry. Defaults to `"all"`. This
   * is where the binary line gets drawn and it is the only place it can be.
   */
  readonly needs?: number | "all";
  /**
   * Clusters of wordings that name the same thing, so a student is never marked
   * wrong for calling it the French and Indian War when the module said "the war
   * with France". Mission-Slate §4.9's module-coverage check produced exactly
   * this requirement for item A1.
   */
  readonly sameThing?: readonly (readonly string[])[];
  /**
   * Per-item differences to disregard, written as prose. Distinct from
   * `sameThing`, which is a set of interchangeable wordings: this is for a rule
   * that does not reduce to a synonym list — "which name the student gives the war
   * does not matter", "a wrong year is not penalised here". Bank-wide rules of this
   * kind belong in the JudgingPolicy instead; this is for the one item.
   */
  readonly alsoIgnore?: readonly string[];
  /** Classes of wrong answer, described. Prompt-visible negative guidance. */
  readonly wrongIfSays?: readonly string[];
  /** Verbatim student-voice answers that MUST grade CORRECT. Held out. */
  readonly accept?: readonly string[];
  /** Verbatim student-voice answers that MUST grade WRONG. Held out. */
  readonly reject?: readonly string[];
  /** Codex cards this item draws on. Provenance and reporting only. */
  readonly cards?: readonly string[];
  /**
   * Optional richer labels for teacher reporting. Kept here, never projected
   * into the duel: the wire boundary in @pa/duel rejects a non-binary verdict by
   * name, and this field is the reason a rubric may still carry one.
   */
  readonly reportingLabels?: Readonly<Record<string, string>>;
  /** A note to the next author. Never sent to the model. */
  readonly note?: string;
}

/** A pool of items for one concept. One round of the duel draws from one pool. */
export interface AuthoredPool {
  readonly poolId: string;
  readonly conceptId: string;
  /** Prepended to each item id, with a `.` separator. */
  readonly idPrefix: string;
  /** Appended to each item id. Keeps content ids versioned like the rest. */
  readonly idSuffix?: string;
  readonly items: readonly AuthoredItem[];
}

export interface CompiledIdea {
  /** `i1`, `i2`, … — the key the classifier answers under. */
  readonly key: string;
  readonly text: string;
}

/** An item after compilation: ids resolved, version derived, line resolved. */
export interface CompiledItem {
  readonly itemId: string;
  /** Content hash of everything that changes grading. Derived, never authored. */
  readonly rubricVersion: string;
  readonly poolId: string;
  readonly conceptId: string;
  readonly ask: string;
  readonly correct: string;
  readonly ideas: readonly CompiledIdea[];
  /** Resolved integer. `needs: "all"` becomes `ideas.length`. */
  readonly needs: number;
  readonly sameThing: readonly (readonly string[])[];
  readonly alsoIgnore: readonly string[];
  readonly wrongIfSays: readonly string[];
  readonly cards: readonly string[];
  readonly reportingLabels: Readonly<Record<string, string>>;
  /**
   * Held-out examples. Deliberately nested under a name that reads as "not for
   * the prompt", and asserted absent from the rendered prompt by a test.
   */
  readonly heldOutExamples: {
    readonly correct: readonly string[];
    readonly wrong: readonly string[];
  };
}

export interface CompiledPool {
  readonly poolId: string;
  readonly conceptId: string;
  readonly items: readonly CompiledItem[];
}

// ---- validation -------------------------------------------------------------

export type ItemDefectCode =
  | "MISSING_ID"
  | "MISSING_ASK"
  | "MISSING_CORRECT"
  | "NO_IDEAS"
  | "TOO_MANY_IDEAS"
  | "EMPTY_IDEA"
  | "NEEDS_OUT_OF_RANGE"
  | "NEEDS_NOT_INTEGER"
  | "DUPLICATE_ITEM_ID"
  | "EXAMPLE_IN_BOTH_LISTS"
  | "DUPLICATE_EXAMPLE"
  | "THIN_ACCEPT_COVERAGE"
  | "NO_REJECT_COVERAGE"
  | "IDEA_LOOKS_LIKE_KEYWORD_MATCH"
  | "SAME_THING_CLUSTER_TOO_SMALL";

export interface ItemDefect {
  readonly code: ItemDefectCode;
  readonly itemId: string;
  readonly detail: string;
  /**
   * A defect either blocks compilation or warns. Warnings are the authoring
   * quality bar — thin example coverage does not break grading, it just means
   * this item contributes nothing to the eval set, which is how a rubric rots
   * quietly.
   */
  readonly severity: "ERROR" | "WARN";
}

/** Four ideas is already a lot to ask a classifier to track inside 1.5 seconds. */
const MAX_IDEAS = 4;

/** Two accept examples per item is what keeps the eval set honest as it grows. */
const MIN_ACCEPT_EXAMPLES = 2;

// An idea phrased as a string-matching instruction defeats the point of using a
// classifier, and is a mistake an author under time pressure makes often.
const KEYWORD_MATCH_SHAPES =
  /\b(contains?|includes? the word|mentions? the word|exact(ly)? the (word|phrase)|spelled)\b/i;

export function validateAuthoredPool(pool: AuthoredPool): readonly ItemDefect[] {
  const defects: ItemDefect[] = [];
  const seen = new Set<string>();

  for (const item of pool.items) {
    const id = item.id?.trim() ?? "";
    const at = id.length > 0 ? `${pool.idPrefix}.${id}` : "<unnamed>";
    const push = (
      code: ItemDefectCode,
      detail: string,
      severity: ItemDefect["severity"] = "ERROR",
    ): void => void defects.push({ code, itemId: at, detail, severity });

    if (id.length === 0) push("MISSING_ID", "item has no id");
    else if (seen.has(id)) push("DUPLICATE_ITEM_ID", id);
    else seen.add(id);

    if ((item.ask?.trim() ?? "").length === 0) push("MISSING_ASK", "no question");
    if ((item.correct?.trim() ?? "").length === 0) {
      push("MISSING_CORRECT", "no reference answer");
    }

    const ideas = item.ideas ?? [];
    if (ideas.length === 0) push("NO_IDEAS", "an item must state at least one idea");
    if (ideas.length > MAX_IDEAS) {
      push("TOO_MANY_IDEAS", `${ideas.length} ideas; split the item instead`);
    }
    ideas.forEach((idea, index) => {
      if (idea.trim().length === 0) push("EMPTY_IDEA", `ideas[${index}]`);
      if (KEYWORD_MATCH_SHAPES.test(idea)) {
        push(
          "IDEA_LOOKS_LIKE_KEYWORD_MATCH",
          `ideas[${index}]: ${idea} — state the idea, not the words`,
          "WARN",
        );
      }
    });

    if (item.needs !== undefined && item.needs !== "all") {
      if (!Number.isInteger(item.needs)) {
        push("NEEDS_NOT_INTEGER", String(item.needs));
      } else if (item.needs < 1 || item.needs > Math.max(1, ideas.length)) {
        push(
          "NEEDS_OUT_OF_RANGE",
          `needs ${item.needs} of ${ideas.length} ideas`,
        );
      }
    }

    for (const cluster of item.sameThing ?? []) {
      if (cluster.length < 2) {
        push(
          "SAME_THING_CLUSTER_TOO_SMALL",
          `a sameThing cluster needs at least two wordings, got ${cluster.length}`,
        );
      }
    }

    const accept = item.accept ?? [];
    const reject = item.reject ?? [];
    const acceptKeys = new Set(accept.map((text) => text.trim().toLowerCase()));
    for (const text of reject) {
      if (acceptKeys.has(text.trim().toLowerCase())) {
        push("EXAMPLE_IN_BOTH_LISTS", text);
      }
    }
    for (const [label, list] of [
      ["accept", accept],
      ["reject", reject],
    ] as const) {
      const keys = new Set<string>();
      for (const text of list) {
        const key = text.trim().toLowerCase();
        if (keys.has(key)) push("DUPLICATE_EXAMPLE", `${label}: ${text}`);
        keys.add(key);
      }
    }
    if (accept.length < MIN_ACCEPT_EXAMPLES) {
      push(
        "THIN_ACCEPT_COVERAGE",
        `${accept.length} accept example(s); ${MIN_ACCEPT_EXAMPLES} is the floor because these are the eval set`,
        "WARN",
      );
    }
    if (reject.length === 0) {
      push("NO_REJECT_COVERAGE", "no reject example to catch a runaway grader", "WARN");
    }
  }
  return defects;
}

// ---- compilation ------------------------------------------------------------

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * The version is a hash of exactly the fields the grader reads. `note`, `cards`
 * and `reportingLabels` are excluded, so fixing a typo in an authoring note does
 * not invalidate a day of cached verdicts; everything the classifier is shown is
 * included, so changing the line or the guidance does.
 *
 * `accept`/`reject` are included even though they never reach the prompt,
 * because they define the item's expected behaviour: if the examples change, the
 * eval result attached to this version no longer describes it.
 */
export function deriveRubricVersion(item: AuthoredItem, needs: number): string {
  const digest = createHash("sha256")
    .update(
      canonical({
        ask: item.ask,
        correct: item.correct,
        ideas: item.ideas,
        needs,
        sameThing: item.sameThing ?? [],
        alsoIgnore: item.alsoIgnore ?? [],
        wrongIfSays: item.wrongIfSays ?? [],
        accept: item.accept ?? [],
        reject: item.reject ?? [],
      }),
    )
    .digest("hex");
  return `r1-${digest.slice(0, 16)}`;
}

export class RubricCompileError extends Error {
  constructor(readonly defects: readonly ItemDefect[]) {
    super(
      `rubric pool failed to compile: ${defects
        .filter((defect) => defect.severity === "ERROR")
        .map((defect) => `${defect.code} at ${defect.itemId} (${defect.detail})`)
        .join("; ")}`,
    );
    this.name = "RubricCompileError";
  }
}

export function compilePool(pool: AuthoredPool): CompiledPool {
  const defects = validateAuthoredPool(pool);
  if (defects.some((defect) => defect.severity === "ERROR")) {
    throw new RubricCompileError(defects);
  }
  const suffix = pool.idSuffix ?? "";
  const items = pool.items.map((item): CompiledItem => {
    const ideas = item.ideas.map((text, index) => ({
      key: `i${index + 1}`,
      text: text.trim(),
    }));
    const needs =
      item.needs === undefined || item.needs === "all"
        ? ideas.length
        : item.needs;
    return {
      itemId: `${pool.idPrefix}.${item.id.trim()}${suffix}`,
      rubricVersion: deriveRubricVersion(item, needs),
      poolId: pool.poolId,
      conceptId: pool.conceptId,
      ask: item.ask.trim(),
      correct: item.correct.trim(),
      ideas,
      needs,
      sameThing: (item.sameThing ?? []).map((cluster) => [...cluster]),
      alsoIgnore: [...(item.alsoIgnore ?? [])],
      wrongIfSays: [...(item.wrongIfSays ?? [])],
      cards: [...(item.cards ?? [])],
      reportingLabels: { ...(item.reportingLabels ?? {}) },
      heldOutExamples: {
        correct: [...(item.accept ?? [])],
        wrong: [...(item.reject ?? [])],
      },
    };
  });
  return { poolId: pool.poolId, conceptId: pool.conceptId, items };
}

/** An immutable lookup over compiled pools. The route resolves items through this. */
export class ItemBank {
  private readonly byId: Map<string, CompiledItem>;

  constructor(readonly pools: readonly CompiledPool[]) {
    this.byId = new Map();
    for (const pool of pools) {
      for (const item of pool.items) {
        if (this.byId.has(item.itemId)) {
          throw new Error(`duplicate itemId across pools: ${item.itemId}`);
        }
        this.byId.set(item.itemId, item);
      }
    }
  }

  get(itemId: string): CompiledItem | undefined {
    return this.byId.get(itemId);
  }

  get items(): readonly CompiledItem[] {
    return [...this.byId.values()];
  }

  get size(): number {
    return this.byId.size;
  }
}
