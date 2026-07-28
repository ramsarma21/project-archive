// "No overlap", mechanised: the discriminator, at scale and in the generative
// direction.
//
// The hand version of this — done by a worker earlier, for every PAIR of askable
// cards — asked "does a question exist that only one card answers?" and found the
// one pair that separated only by luck. The generative version is the inverse and
// is what makes a NEW item safe: given the item's question and reference, every card
// that is NOT its stated binding must be provably not-a-defensible-answer, and every
// card that IS its binding must be one. That is a judgement of meaning, so it is the
// one check here that needs a model.
//
// COST. One structured call per item: the whole card set goes in one prompt and the
// model returns a boolean per card. At M1's ~9 cards that is a few hundred tokens in
// and a handful out — well under a cent and about a second, paid ONCE, offline,
// before the item ships. It does not scale with plays, only with authored items, so
// it is affordable at any volume a human would ever review. (Contrast the runtime,
// where a per-play model judgement is exactly what the owner's architecture removes.)
//
// If the model call fails, this returns a single WARN saying the check did not run —
// never a pass. An item that has not cleared the discriminator is not ship-ready.

import type { CandidateItem, CardRef, Finding } from "./types.js";
import type { PipelineModel } from "./model.js";

interface CardSlot {
  readonly key: string;
  readonly card: CardRef;
}

function buildRequest(item: CandidateItem, slots: readonly CardSlot[]): {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  schemaName: string;
} {
  const system = [
    "You are auditing a history quiz item for EVIDENCE OVERLAP. You are given one question, its reference answer, and a numbered list of evidence cards, each stating one proposition.",
    "For EACH card, decide one thing only: could that card's proposition, ON ITS OWN, be defensibly used as the correct answer to this question? Answer true if a reasonable teacher would accept an answer that rests on that card alone; false otherwise.",
    "Judge by what the question actually asks, not by whether the card is on the same general topic. A card about the same era that does not answer THIS question is false. Be strict: 'defensible' means it genuinely answers the question, not that it is merely related.",
    "Return only the JSON object, one boolean per card key.",
  ].join("\n");

  const cardLines = slots
    .map((s) => `  ${s.key}: ${s.card.proposition}`)
    .join("\n");
  const user = [
    `QUESTION: ${JSON.stringify(item.question)}`,
    `REFERENCE ANSWER: ${JSON.stringify(item.referenceAnswer)}`,
    "",
    "CARDS:",
    cardLines,
  ].join("\n");

  const properties: Record<string, unknown> = {};
  for (const s of slots) properties[s.key] = { type: "boolean" };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: slots.map((s) => s.key),
    properties: { defensible: { type: "object", additionalProperties: false, required: slots.map((s) => s.key), properties } },
  };
  // Wrap under a single "defensible" object so the top-level schema has one stable key.
  return {
    system,
    user,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["defensible"],
      properties: schema.properties,
    },
    schemaName: "evidence_overlap_audit",
  };
}

function parseDefensible(
  raw: unknown,
  slots: readonly CardSlot[],
): Map<string, boolean> | null {
  if (typeof raw !== "object" || raw === null) return null;
  const outer = raw as Record<string, unknown>;
  const inner = outer["defensible"];
  if (typeof inner !== "object" || inner === null) return null;
  const rec = inner as Record<string, unknown>;
  const result = new Map<string, boolean>();
  for (const s of slots) {
    const v = rec[s.key];
    if (typeof v !== "boolean") return null;
    result.set(s.card.cardId, v);
  }
  return result;
}

/**
 * Run the discriminator. `cards` is the set of askable cards to separate against —
 * pass the whole bank's cards for the strongest guarantee, since PvP draws across
 * the pool. Returns findings; an empty ERROR set means the item's binding is exactly
 * the set of defensibly-answering cards.
 */
export async function discriminate(
  item: CandidateItem,
  cards: readonly CardRef[],
  model: PipelineModel,
): Promise<readonly Finding[]> {
  const findings: Finding[] = [];
  const slots: CardSlot[] = cards.map((card, i) => ({ key: `c${i + 1}`, card }));
  const request = buildRequest(item, slots);
  const raw = await model.judge(request);
  const defensible = parseDefensible(raw, slots);
  if (defensible === null) {
    findings.push({
      check: "discriminator",
      code: "MODEL_UNAVAILABLE",
      severity: "WARN",
      detail: "the overlap discriminator could not run (no/invalid model response); item is NOT cleared for ship until it does",
    });
    return findings;
  }

  const boundSet = new Set(item.boundCardIds);
  for (const card of cards) {
    const isDefensible = defensible.get(card.cardId) ?? false;
    const isBound = boundSet.has(card.cardId);
    if (isBound && !isDefensible) {
      findings.push({
        check: "discriminator",
        code: "BINDING_NOT_DEFENSIBLE",
        severity: "ERROR",
        detail: `bound card ${card.cardId} does not defensibly answer the question; the stated binding is wrong`,
      });
    }
    if (!isBound && isDefensible) {
      findings.push({
        check: "discriminator",
        code: "OVERLAP",
        severity: "ERROR",
        detail: `card ${card.cardId} also defensibly answers this question, so the binding is not unambiguous`,
      });
    }
  }
  return findings;
}
