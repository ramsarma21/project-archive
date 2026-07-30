// The presentation identity of a Codex card: its category colour language, its
// period, the perspective it argues from, its provenance line, and the historical
// artwork it is minted over.
//
// WHY THIS IS NOT IN THE CANONICAL FILE. content/m1/codex-cards.json is the one
// source of card IDENTITY — what each card says and which concept it binds. This
// layer adds only PRESENTATION: a colour, a badge, an image path. None of it changes
// what a card is or which duel item asks it, so it does not belong beside the
// authored proposition; it is the same relationship the duel has with its arena
// scenery, which is drawn from the level without being authored into the rubric. It
// is keyed by the canonical ids so it cannot invent a card the deck does not define.
//
// SHARED BY EVERY SURFACE. The Codex binder, the PvE duel hand and the PvP duel hand
// all render the same `ArchiveCard`, so they all read this. A card looks the same
// wherever a player meets it, which is the point of a collectible.

/** The three M1 concepts, as display categories with their own colour language. */
export type CardCategoryId = "INTOLERABLE_ACTS" | "REPRESENTATION" | "MERCANTILISM";

export interface CardCategory {
  readonly id: CardCategoryId;
  readonly label: string;
  /** The card's foil/frame accent. Original per-category language, not the HUD's. */
  readonly accent: string;
  /** A deeper shade of the accent, for gradients and the frame's inner edge. */
  readonly accentDeep: string;
  /** A decorative mark stamped on the frame. Purely ornamental. */
  readonly glyph: string;
}

export interface CardArt {
  /** Served from apps/web/public, so an absolute site path. */
  readonly src: string;
  readonly credit: string;
  /** CSS object-position for the crop, so the subject is not cut off. */
  readonly focus: string;
}

export interface CardIdentity {
  readonly category: CardCategory;
  readonly date: string;
  readonly perspective: string;
  readonly sourceLabel: string;
  readonly art: CardArt | null;
}

const CATEGORIES: Readonly<Record<string, CardCategory>> = {
  "BOS.CONCEPT.INTOLERABLE_ACTS.v1": {
    id: "INTOLERABLE_ACTS",
    label: "The Coercive Acts",
    accent: "#c05a3e",
    accentDeep: "#6e2c1c",
    glyph: "⚓",
  },
  "BOS.CONCEPT.REPRESENTATION.v1": {
    id: "REPRESENTATION",
    label: "Representation & Consent",
    accent: "#6f7be6",
    accentDeep: "#2c3382",
    glyph: "⚖",
  },
  "BOS.CONCEPT.MERCANTILISM.v1": {
    id: "MERCANTILISM",
    label: "Non-importation",
    accent: "#3e8a6e",
    accentDeep: "#1c5240",
    glyph: "✒",
  },
};

const UNKNOWN_CATEGORY: CardCategory = {
  id: "INTOLERABLE_ACTS",
  label: "Archive",
  accent: "#78cdff",
  accentDeep: "#1f5f8a",
  glyph: "◇",
};

/** The provenanced artwork for a concept. Four period images, mapped by theme. */
const ART_BY_CARD: Readonly<Record<string, CardArt>> = {
  // The Coercive Acts: the closed port, the occupation, and the printed circular.
  "BOS.MD01.CARD.PORT_CLOSED_TO_PUNISH.v1": {
    src: "/historical/m1/bostonians-in-distress-1774.jpg",
    credit: "The Bostonians in Distress, 1774",
    focus: "50% 40%",
  },
  "BOS.MD01.CARD.FOUR_ACTS.v1": {
    src: "/historical/m1/boston-1768-landing-of-troops-revere.jpg",
    credit: "Paul Revere, Landing of Troops at Boston, 1768",
    focus: "50% 45%",
  },
  "BOS.MD01.CARD.PAPER_IS_LAWFUL.v1": {
    src: "/historical/m1/boston-committee-port-bill-1774.jpg",
    credit: "Committee of Correspondence circular, 12 May 1774",
    focus: "50% 25%",
  },
  // Representation: the tax document and the occupation behind a law without consent.
  "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1": {
    src: "/historical/m1/stamp-act-1765.jpg",
    credit: "The Stamp Act, 1765",
    focus: "50% 40%",
  },
  "BOS.MD01.CARD.CONSENT_GROUND.v1": {
    src: "/historical/m1/stamp-act-1765.jpg",
    credit: "The Stamp Act, 1765",
    focus: "20% 30%",
  },
  "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1": {
    src: "/historical/m1/boston-1768-landing-of-troops-revere.jpg",
    credit: "Paul Revere, Landing of Troops at Boston, 1768",
    focus: "70% 45%",
  },
  // Non-importation: the Solemn League and Covenant, the pledge itself.
  "BOS.MD01.CARD.NON_IMPORTATION.v1": {
    src: "/historical/m1/solemn-league-covenant-1774.jpg",
    credit: "The Solemn League and Covenant, June 1774",
    focus: "50% 20%",
  },
  "BOS.MD01.CARD.PETITION_AND_CONGRESS.v1": {
    src: "/historical/m1/solemn-league-covenant-1774.jpg",
    credit: "The Solemn League and Covenant, June 1774",
    focus: "50% 55%",
  },
  "BOS.MD01.CARD.NOT_WAR_NOT_COUNTERTAX.v1": {
    src: "/historical/m1/solemn-league-covenant-1774.jpg",
    credit: "The Solemn League and Covenant, June 1774",
    focus: "50% 85%",
  },
};

/** Per-card period and perspective badges. Presentation only. */
const CARD_META: Readonly<Record<string, { date: string; perspective: string }>> = {
  "BOS.MD01.CARD.PORT_CLOSED_TO_PUNISH.v1": { date: "June 1774", perspective: "The punishment" },
  "BOS.MD01.CARD.FOUR_ACTS.v1": { date: "1774", perspective: "The four acts" },
  "BOS.MD01.CARD.PAPER_IS_LAWFUL.v1": { date: "1774", perspective: "What stays lawful" },
  "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1": { date: "1774", perspective: "The fact" },
  "BOS.MD01.CARD.CONSENT_GROUND.v1": { date: "1774", perspective: "The principle" },
  "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1": { date: "1774", perspective: "The reply" },
  "BOS.MD01.CARD.NON_IMPORTATION.v1": { date: "June 1774", perspective: "The answer" },
  "BOS.MD01.CARD.PETITION_AND_CONGRESS.v1": { date: "1774", perspective: "The lawful forms" },
  "BOS.MD01.CARD.NOT_WAR_NOT_COUNTERTAX.v1": { date: "1774", perspective: "The boundary" },
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "BOS.MD01.CUE.BRIEF_CLOSURE.v1": "The closure brief",
  "BOS.MD01.CUE.BRIEF_ACTS.v1": "What the law says",
  "BOS.MD01.CUE.BRIEF_REPRESENTATION.v1": "Consent brief",
  "BOS.MD01.CUE.BRIEF_ANSWER.v1": "The answer brief",
};

export function cardCategory(conceptId: string): CardCategory {
  return CATEGORIES[conceptId] ?? UNKNOWN_CATEGORY;
}

/** Everything the frame needs beyond the authored title and proposition. */
export function cardIdentityFor(card: {
  readonly cardId: string;
  readonly conceptId: string;
  readonly sourceCueId?: string;
}): CardIdentity {
  const meta = CARD_META[card.cardId];
  return {
    category: cardCategory(card.conceptId),
    date: meta?.date ?? "1774",
    perspective: meta?.perspective ?? "Boston, 1774",
    sourceLabel:
      (card.sourceCueId ? SOURCE_LABELS[card.sourceCueId] : undefined) ?? "Mission brief",
    art: ART_BY_CARD[card.cardId] ?? null,
  };
}
