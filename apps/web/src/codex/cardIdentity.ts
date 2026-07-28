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
export type CardCategoryId = "POSTWAR_REVENUE" | "STAMP_SCOPE" | "REPRESENTATION";

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
  "BOS.CONCEPT.POSTWAR_REVENUE.v1": {
    id: "POSTWAR_REVENUE",
    label: "Postwar Revenue",
    accent: "#d7a24a",
    accentDeep: "#7a5410",
    glyph: "£",
  },
  "BOS.CONCEPT.STAMP_SCOPE.v1": {
    id: "STAMP_SCOPE",
    label: "The Stamp's Reach",
    accent: "#d1544a",
    accentDeep: "#7c221c",
    glyph: "✶",
  },
  "BOS.CONCEPT.REPRESENTATION.v1": {
    id: "REPRESENTATION",
    label: "Representation & Consent",
    accent: "#6f7be6",
    accentDeep: "#2c3382",
    glyph: "⚖",
  },
};

const UNKNOWN_CATEGORY: CardCategory = {
  id: "POSTWAR_REVENUE",
  label: "Archive",
  accent: "#78cdff",
  accentDeep: "#1f5f8a",
  glyph: "◇",
};

/** The provenanced artwork for a concept. Four period images, mapped by theme. */
const ART_BY_CARD: Readonly<Record<string, CardArt>> = {
  // Postwar: the end of the war with France, which is the debt's origin.
  "BOS.MD01.CARD.WAR_DEBT.v1": {
    src: "/historical/m1/wolfe-death-of-general-wolfe-1770.jpg",
    credit: "Benjamin West, The Death of General Wolfe, 1770",
    focus: "50% 35%",
  },
  "BOS.MD01.CARD.COLONIAL_REVENUE.v1": {
    src: "/historical/m1/wolfe-death-of-general-wolfe-1770.jpg",
    credit: "Benjamin West, The Death of General Wolfe, 1770",
    focus: "30% 40%",
  },
  "BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1": {
    src: "/historical/m1/wolfe-death-of-general-wolfe-1770.jpg",
    credit: "Benjamin West, The Death of General Wolfe, 1770",
    focus: "70% 45%",
  },
  // Stamp scope: the stamp itself.
  "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1": {
    src: "/historical/m1/stamp-act-1765.jpg",
    credit: "Proof sheet of one-penny stamps, 1765",
    focus: "50% 40%",
  },
  "BOS.MD01.CARD.STAMP_DATE.v1": {
    src: "/historical/m1/stamp-act-1765.jpg",
    credit: "Proof sheet of one-penny stamps, 1765",
    focus: "20% 30%",
  },
  "BOS.MD01.CARD.PRINTER_IMPACT.v1": {
    src: "/historical/m1/stamp-act-1765.jpg",
    credit: "Proof sheet of one-penny stamps, 1765",
    focus: "80% 60%",
  },
  // Representation: protest and consent.
  "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1": {
    src: "/historical/m1/boston-1768-landing-of-troops-revere.jpg",
    credit: "Paul Revere, A View of Part of Boston, 1768",
    focus: "50% 45%",
  },
  "BOS.MD01.CARD.CONSENT_GROUND.v1": {
    src: "/historical/m1/repeal-funeral-miss-ame-stamp-1766.jpg",
    credit: "The Repeal, or the Funeral of Miss Ame-Stamp, 1766",
    focus: "50% 45%",
  },
  "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1": {
    src: "/historical/m1/repeal-funeral-miss-ame-stamp-1766.jpg",
    credit: "The Repeal, or the Funeral of Miss Ame-Stamp, 1766",
    focus: "30% 55%",
  },
};

/** Per-card period and perspective badges. Presentation only. */
const CARD_META: Readonly<Record<string, { date: string; perspective: string }>> = {
  "BOS.MD01.CARD.WAR_DEBT.v1": { date: "1763", perspective: "The problem" },
  "BOS.MD01.CARD.COLONIAL_REVENUE.v1": { date: "1764", perspective: "The payer" },
  "BOS.MD01.CARD.DEBT_TO_STAMP_CHAIN.v1": { date: "1763 to 1765", perspective: "The order" },
  "BOS.MD01.CARD.STAMP_PAPER_SCOPE.v1": { date: "1765", perspective: "What is taxed" },
  "BOS.MD01.CARD.STAMP_DATE.v1": { date: "1 Nov 1765", perspective: "When it begins" },
  "BOS.MD01.CARD.PRINTER_IMPACT.v1": { date: "1765", perspective: "Who it burdens" },
  "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1": { date: "1765", perspective: "The fact" },
  "BOS.MD01.CARD.CONSENT_GROUND.v1": { date: "1765", perspective: "The principle" },
  "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1": { date: "1765", perspective: "The reply" },
};

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  "BOS.MD01.CUE.BRIEF_POSTWAR.v1": "Postwar brief",
  "BOS.MD01.CUE.BRIEF_SYNTHESIS.v1": "Synthesis brief",
  "BOS.MD01.CUE.BRIEF_STAMP.v1": "Stamp brief",
  "BOS.MD01.CUE.BRIEF_REPRESENTATION.v1": "Representation brief",
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
    date: meta?.date ?? "1765",
    perspective: meta?.perspective ?? "Boston, 1765",
    sourceLabel:
      (card.sourceCueId ? SOURCE_LABELS[card.sourceCueId] : undefined) ?? "Mission brief",
    art: ART_BY_CARD[card.cardId] ?? null,
  };
}
