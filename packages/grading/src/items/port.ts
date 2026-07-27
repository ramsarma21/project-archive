// The port from authored content into this package's rubric format.
//
// `content/m1/duel-items.json` is the production bank. It supersedes the
// transliteration of Mission-Slate §4.9's draft that used to live in ./m1.ts, and
// it is a better bank for one reason that matters more than its prose: its rubric
// lines are calibrated against twelve real Texas eighth-grade responses that TEA
// actually scored, in `content/staar/eval`. That is evidence about where a human
// authority draws this line, and it does not agree with intuition.
//
// What the calibration data says, and why it changed this service:
//
//   * TEA scored ZERO a response that correctly named two causes and explained
//     neither. Naming is not explaining, and a keyword-matching grader scores that
//     response high.
//   * TEA scored ZERO its longest, most fluent, best-spelled exemplar, because the
//     content amounted to "wasn't being fair to them". Fluency is not evidence.
//   * TEA gave CREDIT to "stamp act put texes on paper and other stuff which made
//     the poeple mad" — eleven words, two misspellings, no capitals. The
//     substantive proposition was there, so it scored.
//   * TEA credited a response that wrote "Proclamation of 1863" for 1763, and a
//     full-mark response that blamed "The British Monarchy" for Parliament's act.
//     Incidental slips are not the disqualifier.
//
// So the real distribution is far more permissive on form and far stricter on
// substance than anyone would guess. A rubric tuned without it — mine — was strict
// in the places that cost a student a duel they had earned, and loose in the places
// a keyword salad walks through.
//
// This module is a mapping, not a re-authoring. The field correspondence is the one
// the content's own `portTo.fieldMapping` block specifies:
//
//   question                  -> ask
//   referenceAnswer           -> correct
//   rubric.requiredCore       -> ideas (one entry, needs "all")
//   rubric.line               -> note        (reasoning; never sent to the model)
//   rubric.acceptExamples[]   -> accept      (held out of the prompt)
//   rubric.rejectExamples[]   -> reject      (held out of the prompt)
//   rubric.rejectExamples[].why -> wrongIfSays (described, not quoted)
//   rubric.ignoreForThisItem  -> sameThing
//   codexCardIds              -> cards
//
// Twelve of the eighteen items carry a single required proposition, which is a
// cleaner fit for `ideas`/`needs` than a multi-idea list with a count. Six carry a
// genuine two-part core so a written answer that supplies only one half fails, the
// prose analogue of the two-card evidence minimum; they are handled explicitly
// below. Both shapes stay binary — needs "all" is all-or-nothing, not partial credit.

import type { AuthoredItem, AuthoredPool } from "../rubric.js";

// ---- the shape of the authored file ----------------------------------------

export interface ContentRubricExample {
  readonly text: string;
  readonly why: string;
}

export interface ContentRubric {
  readonly rubricId: string;
  readonly requiredCore: string;
  /** Present on the two items whose core is genuinely two propositions. */
  readonly requiredCoreParts?: readonly string[];
  readonly line: string;
  readonly acceptExamples: readonly ContentRubricExample[];
  readonly rejectExamples: readonly ContentRubricExample[];
  readonly ignoreForThisItem?: readonly string[];
  readonly authoringNote?: string;
}

export interface ContentItem {
  readonly itemId: string;
  readonly itemVersion: string;
  readonly poolId: string;
  readonly conceptId: string;
  readonly codexCardIds: readonly string[];
  readonly answerableFrom: readonly string[];
  readonly question: string;
  readonly referenceAnswer: string;
  readonly rubric: ContentRubric;
}

export interface ContentPool {
  readonly poolId: string;
  readonly conceptId: string;
  readonly legacyConceptId?: string;
  readonly sourceCueId?: string;
  readonly authoredDepth: number;
}

export interface ContentBank {
  readonly contentId: string;
  readonly reviewStatus: string;
  readonly gradingPolicy: {
    readonly policyId: string;
    readonly alwaysIgnore: readonly string[];
    readonly neverSufficient: readonly string[];
    readonly decisionProcedure: readonly string[];
  };
  readonly pools: readonly ContentPool[];
  readonly items: readonly ContentItem[];
}

// ---- items whose core is two propositions -----------------------------------
//
// The content's `portTo.itemsWithTwoPartCores` names them. Splitting is done here
// rather than in the content because `ideas` is this package's structure; the
// content states the requirement in prose and the split has to agree with it.

const TWO_PART_CORES: Readonly<Record<string, readonly [string, string]>> = {
  // "Boston elects a local body ... and does not elect the body that laid this
  // tax." The rubric's own line: "Either half alone leaves the constable's
  // objection standing." So needs is all, over two.
  "BOS.MD01.DUEL.REP.BOSTON_DOES_ELECT.v1": [
    "Boston does elect a local body of its own — its town meeting, its own assembly, its own representatives here",
    "Boston does not elect the body that laid this tax — in any wording, including 'not Parliament', 'not the ones in England', 'nobody over there'",
  ],

  // The items whose evidence hand demands two cards now demand two ideas in prose
  // too: a written answer that supplies only one half fails, exactly as a one-card
  // selection does. Each pair mirrors the same synthesis the cards require (a cause
  // and its consequence, a mechanism and who it burdened, a grievance and the
  // town's standing). The halves are stated as meanings, not wordings, so many
  // phrasings and either order still pass; the classifier reports each and the code
  // requires all.
  "BOS.MD01.DUEL.POSTWAR.WHAT_IT_LEFT.v1": [
    "The war left Britain owing money, short of money, or with a war cost it still has to pay: a financial problem",
    "Parliament's fix is to raise part of that money from the colonies, and the stamp is how it collects it here",
  ],
  "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1": [
    "The payer is the colonies, America, the colonists, or 'us': someone on this side of the Atlantic rather than inside Britain",
    "What that money clears is Britain's war debt, the money the war with France left owing",
  ],
  "BOS.MD01.DUEL.POSTWAR.DEBT_TO_TAX.v1": [
    "The money is raised from the colonies: our taxes, or the stamp we pay here",
    "and that money goes toward Britain's war debt, paying down what Britain owes",
  ],
  "BOS.MD01.DUEL.REP.NOT_THE_MONEY.v1": [
    "The objection is not the price but who laid the tax, a body Boston did not choose, so it was laid without the town's consent",
    "The town's standing to say so is that Boston elected none of them: it has no member in the Parliament that laid it",
  ],
  "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1": [
    "A lawful vote in Parliament is still not this town's consent: being legal does not make it binding on Boston",
    "The ground is that Boston had no part in that vote, electing none of the men who passed it",
  ],
  // PvP-only hardening item; two-part in the wider PvP grading bank.
  "BOS.MD01.DUEL.REP.HOW_FAR_IT_GOES.v1": [
    "It is a different argument: Boston objects to who lays the tax, not to taxation itself, and would pay a tax its own body voted",
    "Where the man goes past the town is refusing all taxes, any tax at all, which is further than Boston's claim",
  ],
};

/**
 * NAME_TWO's core is "two distinct things, each of which is printed matter or a
 * legal or official paper". The content's port block flags it as a count rather
 * than two propositions and suggests one idea, and that is right: split into two
 * the classifier would be asked which of two unordered nouns is "the first", which
 * is a question with no answer. It stays one idea whose text carries the count.
 */
const COUNT_CORE_ITEMS = new Set(["BOS.MD01.DUEL.STAMP.NAME_TWO.v1"]);

// ---- the mapping -------------------------------------------------------------

/** `BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1` under prefix `BOS.MD01.DUEL.POSTWAR` -> `WHY_NOW`. */
function localId(itemId: string, prefix: string, suffix: string): string {
  const withoutSuffix = itemId.endsWith(suffix)
    ? itemId.slice(0, itemId.length - suffix.length)
    : itemId;
  const head = `${prefix}.`;
  if (!withoutSuffix.startsWith(head)) {
    throw new Error(`item ${itemId} does not sit under pool prefix ${prefix}`);
  }
  return withoutSuffix.slice(head.length);
}

/**
 * The pool's id prefix, derived from the item ids it contains rather than
 * authored, so a new pool needs no entry in this file.
 */
function poolPrefix(items: readonly ContentItem[]): string {
  const first = items[0];
  if (first === undefined) throw new Error("pool has no items");
  // Every id is `<prefix>.<LOCAL>.v1`; the prefix is everything before the last
  // two dot-separated segments.
  const parts = first.itemId.split(".");
  return parts.slice(0, parts.length - 2).join(".");
}

function toAuthoredItem(
  item: ContentItem,
  prefix: string,
  suffix: string,
): AuthoredItem {
  const twoPart = TWO_PART_CORES[item.itemId];
  const ideas = twoPart ?? [item.rubric.requiredCore];
  return {
    id: localId(item.itemId, prefix, suffix),
    ask: item.question,
    correct: item.referenceAnswer,
    ideas,
    // Every item in this bank requires all of its stated core. The line is not a
    // count here; it is written into the core's own wording, which is why twelve
    // items have exactly one idea and six have two.
    needs: "all",
    // `ignoreForThisItem` is prose — "which name the student gives the war does not
    // matter" — rather than a list of interchangeable wordings, so it maps to
    // `alsoIgnore` and not to `sameThing`. Forcing it into a synonym cluster would
    // have made a one-element cluster, which credits nothing.
    ...(item.rubric.ignoreForThisItem && item.rubric.ignoreForThisItem.length > 0
      ? { alsoIgnore: [...item.rubric.ignoreForThisItem] }
      : {}),
    // The rejects' `why` fields are the described classes of wrong answer. The
    // `text` fields are held out; only the reasons reach the prompt.
    wrongIfSays: item.rubric.rejectExamples.map((example) => example.why),
    accept: item.rubric.acceptExamples.map((example) => example.text),
    reject: item.rubric.rejectExamples.map((example) => example.text),
    cards: item.codexCardIds,
    note: [item.rubric.line, item.rubric.authoringNote]
      .filter((text): text is string => typeof text === "string")
      .join(" "),
  };
}

export function toAuthoredPools(bank: ContentBank): readonly AuthoredPool[] {
  const byPool = new Map<string, ContentItem[]>();
  for (const item of bank.items) {
    const existing = byPool.get(item.poolId);
    if (existing === undefined) byPool.set(item.poolId, [item]);
    else existing.push(item);
  }
  return bank.pools.map((pool): AuthoredPool => {
    const items = byPool.get(pool.poolId) ?? [];
    if (items.length === 0) throw new Error(`pool ${pool.poolId} has no items`);
    const prefix = poolPrefix(items);
    const suffix = ".v1";
    return {
      poolId: pool.poolId,
      // The canonical `BOS.CONCEPT.*` id from packages/curriculum. The legacy
      // `BOS.MD01.CONCEPT.*` id travels on the content record and the alias table
      // resolves either, so carrying the canonical one here is the retag.
      conceptId: pool.conceptId,
      idPrefix: prefix,
      idSuffix: suffix,
      items: items.map((item) => toAuthoredItem(item, prefix, suffix)),
    };
  });
}

/** Items whose core is a count rather than a proposition. Exported for the tests. */
export function isCountCoreItem(itemId: string): boolean {
  return COUNT_CORE_ITEMS.has(itemId);
}

export function twoPartCoreItemIds(): readonly string[] {
  return Object.keys(TWO_PART_CORES);
}
