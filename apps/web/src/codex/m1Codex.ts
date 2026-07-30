import codexEnvelope from "../../../../content/m1/codex-cards.json";

// The M1 Codex, loaded and validated from its authored source.
//
// `content/m1/codex-cards.json` is the ONE authored definition of what each M1 card
// says — nine cards across three concepts, transcribed from Mission-Slate §4.9. It is
// imported directly rather than fetched, exactly as `m1Module.ts` imports the module
// deck, so the Codex screen never waits on the network for content that ships in the
// bundle and TypeScript can see the shape at build time.
//
// This layer VALIDATES rather than trusts. The authored file also carries authoring
// apparatus — a namespace essay, a lifecycle note — that the UI has no business
// reading, so the loader takes exactly the six fields a card is and refuses the file
// if any card is missing one. It FAILS CLOSED AND LOUD: a malformed definition makes
// the whole load `ok: false` and logs why, rather than silently dropping one card and
// rendering eight, because a Codex that quietly hides a card is worse than one that
// says it is broken.

/** One validated Codex card: the six authored fields, and nothing else. */
export interface M1CodexCard {
  readonly cardId: string;
  readonly conceptId: string;
  readonly title: string;
  /**
   * What the student must be able to state. Shown in the Codex, where the player
   * is studying — but NEVER shown beside a live PvP question, because a proposition
   * usually contains the answer.
   */
  readonly proposition: string;
  readonly sourceCueId: string;
  readonly askedBy: readonly string[];
}

/** The cards of one concept, in authored order. */
export interface M1CodexConceptGroup {
  readonly conceptId: string;
  readonly label: string;
  readonly cards: readonly M1CodexCard[];
}

export type LoadedCodex =
  | {
      readonly ok: true;
      readonly contentId: string;
      readonly reviewStatus: string;
      readonly cards: readonly M1CodexCard[];
      /** The nine cards grouped by their three concepts, concepts in authored order. */
      readonly groups: readonly M1CodexConceptGroup[];
    }
  | { readonly ok: false; readonly defects: readonly string[] };

/**
 * Human labels for the three M1 concepts. Presentation only — the card's binding
 * concept is its authored `conceptId`; these are the words a heading uses, and they
 * track the curriculum registry's own labels. A concept with no label here still
 * renders under its id rather than vanishing.
 */
const CONCEPT_LABELS: Readonly<Record<string, string>> = {
  "BOS.CONCEPT.INTOLERABLE_ACTS.v1": "The Coercive Acts",
  "BOS.CONCEPT.REPRESENTATION.v1": "Representation and consent",
  "BOS.CONCEPT.MERCANTILISM.v1": "Non-importation and resistance",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function stringsAt(source: Record<string, unknown>, key: string): readonly string[] | null {
  const value = source[key];
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== "string" || entry.trim() === "")) return null;
  return value as readonly string[];
}

/** Group the cards by concept, preserving the order each concept first appears in. */
function groupByConcept(cards: readonly M1CodexCard[]): readonly M1CodexConceptGroup[] {
  const order: string[] = [];
  const byConcept = new Map<string, M1CodexCard[]>();
  for (const card of cards) {
    if (!byConcept.has(card.conceptId)) {
      byConcept.set(card.conceptId, []);
      order.push(card.conceptId);
    }
    byConcept.get(card.conceptId)!.push(card);
  }
  return order.map((conceptId) => ({
    conceptId,
    label: CONCEPT_LABELS[conceptId] ?? conceptId,
    cards: byConcept.get(conceptId)!,
  }));
}

/**
 * Validate the authored envelope into a Codex, or report every defect found.
 *
 * Defects are collected rather than thrown on the first, because the reader fixing
 * this is a content author and one error per run is a slow way to fix several. A
 * SINGLE malformed card fails the WHOLE load — no partial Codex is returned.
 */
export function loadM1Codex(envelope: unknown): LoadedCodex {
  const defects: string[] = [];
  if (!isRecord(envelope)) return { ok: false, defects: ["the codex envelope is not an object"] };

  const rawCards = envelope["cards"];
  if (!Array.isArray(rawCards) || rawCards.length === 0) {
    return { ok: false, defects: ["the codex has no cards"] };
  }

  const cards: M1CodexCard[] = [];
  const seen = new Set<string>();
  rawCards.forEach((raw, at) => {
    if (!isRecord(raw)) {
      defects.push(`card ${at} is not an object`);
      return;
    }
    const cardId = stringAt(raw, "cardId") ?? `card ${at}`;
    const conceptId = stringAt(raw, "conceptId");
    const title = stringAt(raw, "title");
    const proposition = stringAt(raw, "proposition");
    const sourceCueId = stringAt(raw, "sourceCueId");
    const askedBy = stringsAt(raw, "askedBy");

    if (!stringAt(raw, "cardId")) defects.push(`card ${at} has no cardId`);
    if (!conceptId) defects.push(`${cardId} has no conceptId`);
    if (!title) defects.push(`${cardId} has no title`);
    if (!proposition) defects.push(`${cardId} has no proposition`);
    if (!sourceCueId) defects.push(`${cardId} has no sourceCueId`);
    if (!askedBy || askedBy.length === 0) defects.push(`${cardId} has no askedBy items`);
    if (seen.has(cardId)) defects.push(`${cardId} is defined more than once`);
    seen.add(cardId);

    if (conceptId && title && proposition && sourceCueId && askedBy && askedBy.length > 0) {
      cards.push({ cardId, conceptId, title, proposition, sourceCueId, askedBy });
    }
  });

  // Fail closed: any defect at all, or a card that did not survive validation, is a
  // broken Codex, not a shorter one.
  if (defects.length > 0 || cards.length !== rawCards.length) {
    return { ok: false, defects };
  }

  return {
    ok: true,
    contentId: stringAt(envelope, "contentId") ?? "UNKNOWN_CODEX",
    reviewStatus: stringAt(envelope, "reviewStatus") ?? "UNKNOWN",
    cards,
    groups: groupByConcept(cards),
  };
}

/** The load result, kept so the screen and a test can read the defects. */
export const M1_CODEX: LoadedCodex = loadM1Codex(codexEnvelope);

if (!M1_CODEX.ok) {
  console.error(
    "[codex] content/m1/codex-cards.json is not a usable Codex:\n" +
      M1_CODEX.defects.map((defect) => `  · ${defect}`).join("\n"),
  );
}

/** The validated cards, or an empty list when the file is unusable. */
export const M1_CODEX_CARDS: readonly M1CodexCard[] = M1_CODEX.ok ? M1_CODEX.cards : [];

/** The validated concept groups, or an empty list when the file is unusable. */
export const M1_CODEX_GROUPS: readonly M1CodexConceptGroup[] = M1_CODEX.ok ? M1_CODEX.groups : [];

/** A cardId → title lookup, for surfaces that may show a card's title but not its text. */
export const M1_CODEX_TITLE_BY_ID: ReadonlyMap<string, string> = new Map(
  M1_CODEX_CARDS.map((card) => [card.cardId, card.title]),
);

/** A cardId → full card lookup, for surfaces that render the whole `ArchiveCard`. */
export const M1_CODEX_CARD_BY_ID: ReadonlyMap<string, M1CodexCard> = new Map(
  M1_CODEX_CARDS.map((card) => [card.cardId, card]),
);
