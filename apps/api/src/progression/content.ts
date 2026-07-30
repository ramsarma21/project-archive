import {
  BOSTON_ABILITY_MILESTONES,
  BOSTON_MISSION_COUNT,
  BOSTON_XP_CURVE,
  missionBaseXp,
} from "@pa/abilities";
import {
  AbilityMilestoneSchema,
  MissionRewardSchema,
  type AbilityMilestone,
  type AssessmentItemFormat,
  type MissionReward,
  type XpCurve,
} from "@pa/contracts";

/**
 * Authored progression content. Every number the server needs to derive
 * progression comes from here, never from a request body.
 *
 * This interface is a JOIN, not a source. The numbers belong to @pa/abilities
 * (the curve, the base awards, the unlock Levels) and the ids belong to the
 * content layers (a module's deck, a chapter's concepts, an item bank). What
 * this seam does is pair them, and refuse a mutation it cannot price rather
 * than invent a value for it.
 */
export interface ProgressionContent {
  /** The chapter a brand-new profile starts in. */
  initialChapterId(): string;
  xpCurve(chapterId: string): XpCurve | null;
  missionReward(chapterId: string, missionId: string): MissionReward | null;
  abilityMilestones(chapterId: string): readonly AbilityMilestone[];
  /** Every concept the chapter's capstone must cover. */
  chapterConceptIds(chapterId: string): readonly string[];
  assessmentId(chapterId: string): string | null;
  /** The module that gates an assessment retry. */
  assessmentModuleId(chapterId: string): string | null;
  /** The authored item reserve for one concept, in selection order. */
  itemReserve(assessmentId: string, conceptId: string): readonly string[];
  itemConcept(itemId: string): string | null;
  /** An item's answer format. The capstone mixes both. */
  itemFormat(itemId: string): AssessmentItemFormat | null;
  /** Deterministic multiple-choice key. Server-side only, never shipped. */
  isCorrectOption(itemId: string, optionId: string): boolean;
  /**
   * The authored cue ids in a module's deck, or null when the deck is unknown
   * to the server. The module gate is deck coverage, so this is what a reported
   * completion is checked against.
   */
  moduleDeckCueIds(moduleId: string): readonly string[] | null;
  /**
   * The mastery-check ids a module requires, or an empty list when it has none.
   * A completed run must have acknowledged all of these — the check analogue of
   * deck coverage — so a client cannot open a mission by skipping a check the
   * concept card gates behind.
   */
  moduleRequiredCheckIds(moduleId: string): readonly string[];
  /** Cards a learning module teaches (learned in single-player). */
  codexCardsForModule(moduleId: string): readonly string[];
  /** Cards a concept mints as PvP-legal once it reaches 100% mastery. */
  codexCardsForConcept(conceptId: string): readonly string[];
  conceptForCard(cardId: string): string | null;
}

/**
 * One graded open response, as progression reads it.
 *
 * `needsReview` travels with `correct` rather than being looked up later because
 * it is a fact about the grading of THIS answer that only the grader knows: a
 * generous fallback grant, or a classification made at low confidence. It is
 * recorded on the response row so an educator report can say which verdicts want
 * a human, and it changes nothing about the score — a granted CORRECT counts,
 * exactly as the design intends, and is merely also disclosed.
 */
export interface OpenResponseGrade {
  readonly correct: boolean;
  readonly needsReview: boolean;
}

/**
 * The graded verdict for an open response, read by handle.
 *
 * The client submits its prose to the grading service, which stores it
 * encrypted and returns an opaque handle; the capstone then grades by handle.
 * So the verdict enters progression from here and never from a request body,
 * and no part of this path holds student prose.
 */
export interface OpenResponseVerdicts {
  /** The grade, or null when the handle is unknown or not yet graded. */
  verdict(input: {
    profileId: string;
    itemId: string;
    responseRef: string;
  }): Promise<OpenResponseGrade | null>;
}

/** No grading service wired yet: every handle reports as ungraded. */
export function noOpenResponseVerdicts(): OpenResponseVerdicts {
  return { verdict: async () => null };
}

/**
 * An empty content set. Reads still work — a new profile gets Level 0, 0 XP,
 * Rank 1 — while every mutation reports PACKAGE_MISSING.
 *
 * Kept for tests and for a chapter with nothing authored yet. The server no
 * longer boots on it; see `bostonProgressionContent` below.
 */
export function emptyProgressionContent(initialChapterId: string): ProgressionContent {
  return {
    initialChapterId: () => initialChapterId,
    xpCurve: () => null,
    missionReward: () => null,
    abilityMilestones: () => [],
    chapterConceptIds: () => [],
    assessmentId: () => null,
    assessmentModuleId: () => null,
    itemReserve: () => [],
    itemConcept: () => null,
    itemFormat: () => null,
    isCorrectOption: () => false,
    moduleDeckCueIds: () => null,
    moduleRequiredCheckIds: () => [],
    codexCardsForModule: () => [],
    codexCardsForConcept: () => [],
    conceptForCard: () => null,
  };
}

// ============================================================================
// BOSTON 1765 — the authored pack.
//
// Two halves, and keeping them apart is the whole design of this file.
//
//   THE NUMBERS are imported from @pa/abilities and never restated. The curve,
//   the base award ramp and the ability unlock Levels are authored there with
//   their derivations written out, and `scripts/check-boundaries.mjs` exists
//   because a second copy of a balance value does not break on the day it is
//   written — it drifts, weeks later, and the server and the hub start
//   disagreeing about what a mission paid.
//
//   THE IDS are authored here, because this is the only layer that knows all
//   of them at once. @pa/abilities deliberately refuses to name a moduleId or
//   a conceptId (see `toMissionReward`), the module deck lives in the web
//   app's content directory, and the runtime mission ids belong to the chapter
//   registry. Pairing them is exactly what a join table is for.
// ============================================================================

/**
 * The runtime chapter id, and the one the client sends.
 *
 * Deliberately NOT `@pa/abilities`' `BOSTON_CHAPTER_ID` ("BOSTON"), which is
 * that package's own authoring key for the curve. The chapter a profile is
 * actually in is the one `apps/web/src/chapter/bostonChapter.ts` deploys
 * against, and a mismatch here answers CHAPTER_NOT_ACTIVE to every commit.
 */
export const BOSTON_RUNTIME_CHAPTER_ID = "boston-1765";

/** Runtime mission id for a 1-based slate ordinal, matching `BOSTON_SLATE`. */
function bostonMissionId(ordinal: number): string {
  return `PA.SEA01.CH02.BOSTON.MD${String(ordinal).padStart(2, "0")}`;
}

/**
 * M1's runtime mission id — the Boston slate's first mission, "The Effigy Run".
 *
 * Exported so the dev-reset surfaces (the CLI script and the dev-gated route)
 * share ONE authoritative id with the content pack rather than re-spelling the
 * slug, exactly as `BOSTON_RUNTIME_CHAPTER_ID` is the one chapter id.
 */
export const M1_MISSION_ID = bostonMissionId(1);

const MISSION_ORDINALS: ReadonlyMap<string, number> = new Map(
  Array.from({ length: BOSTON_MISSION_COUNT }, (_, index) => [
    bostonMissionId(index + 1),
    index + 1,
  ]),
);

/**
 * What a mission needs beyond its award before the server can price it: the
 * module that gates every attempt on it, and the concepts that attempt teaches.
 *
 * Thirteen of the fourteen are absent, and that is the honest state — their
 * decks are unwritten. A mission missing from this table has no reward, so the
 * server refuses to open an attempt on it rather than paying out against a
 * module nobody has authored.
 */
interface MissionContentRow {
  readonly moduleId: string;
  readonly conceptIds: readonly string[];
}

export const M1_MODULE_ID = "BOS.MD01.MODULE.BRIEF.v1";

const MISSION_CONTENT: ReadonlyMap<string, MissionContentRow> = new Map([
  [
    bostonMissionId(1),
    {
      moduleId: M1_MODULE_ID,
      conceptIds: [
        "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
        "BOS.CONCEPT.REPRESENTATION.v1",
        "BOS.CONCEPT.MERCANTILISM.v1",
      ],
    },
  ],
]);

/**
 * M1's authored deck, as cue ids in card order.
 *
 * This is the module gate itself: `completeLearningModule` checks a reported
 * run against these and refuses one that did not cover them, so a client
 * cannot open an attempt by claiming it read a deck it skipped. Transcribed
 * from `content/m1/module.json`, which the API cannot import — the container
 * image ships `apps/api` and `packages` and no content directory.
 */
const MODULE_DECKS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    M1_MODULE_ID,
    [
      "BOS.MD01.CUE.BRIEF_IDENTITY.v1",
      "BOS.MD01.CUE.BRIEF_CLOSURE.v1",
      "BOS.MD01.CUE.BRIEF_ACTS.v1",
      "BOS.MD01.CUE.BRIEF_REPRESENTATION.v1",
      "BOS.MD01.CUE.BRIEF_ANSWER.v1",
      "BOS.MD01.CUE.BRIEF_INSERT.v1",
    ],
  ],
]);

/**
 * The mastery checks a module requires, in card order.
 *
 * This is the check analogue of MODULE_DECKS and it is the SERVER's copy of the
 * gate: `completeLearningModule` derives the required set from here and refuses
 * a completion missing any, so a client that forges a body without a check
 * cannot open the mission behind it. Transcribed from content/m1/module.json's
 * authored `check.id`s, which the API cannot import — the container image ships
 * apps/api and packages and no content directory.
 */
const MODULE_CHECKS: ReadonlyMap<string, readonly string[]> = new Map([
  [
    M1_MODULE_ID,
    [
      "BOS.MD01.CHECK.CLOSURE.v1",
      "BOS.MD01.CHECK.ACTS.v1",
      "BOS.MD01.CHECK.REPRESENTATION.v1",
      "BOS.MD01.CHECK.ANSWER.v1",
    ],
  ],
]);

/**
 * Codex cards a module teaches, and the concept each one belongs to.
 *
 * A card carries exactly one concept, because `codex_cards.concept_id` is one
 * column and PvP legality is minted per concept. M1's synthesis card asserts a
 * chain across all three concepts, so it is anchored to the first concept of
 * the cue that teaches it — the debt the chain starts from — rather than being
 * split, which the schema cannot represent, or duplicated, which would mint it
 * three times.
 */
const CODEX_CARDS: ReadonlyMap<string, readonly { card: string; concept: string }[]> =
  new Map([
    [
      M1_MODULE_ID,
      [
        {
          card: "BOS.MD01.CARD.PORT_CLOSED_TO_PUNISH.v1",
          concept: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
        },
        { card: "BOS.MD01.CARD.FOUR_ACTS.v1", concept: "BOS.CONCEPT.INTOLERABLE_ACTS.v1" },
        {
          card: "BOS.MD01.CARD.PAPER_IS_LAWFUL.v1",
          concept: "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
        },
        {
          card: "BOS.MD01.CARD.NO_MEMBER_IN_PARLIAMENT.v1",
          concept: "BOS.CONCEPT.REPRESENTATION.v1",
        },
        {
          card: "BOS.MD01.CARD.CONSENT_GROUND.v1",
          concept: "BOS.CONCEPT.REPRESENTATION.v1",
        },
        {
          card: "BOS.MD01.CARD.LAWFUL_NOT_CONSENTED.v1",
          concept: "BOS.CONCEPT.REPRESENTATION.v1",
        },
        {
          card: "BOS.MD01.CARD.NON_IMPORTATION.v1",
          concept: "BOS.CONCEPT.MERCANTILISM.v1",
        },
        {
          card: "BOS.MD01.CARD.PETITION_AND_CONGRESS.v1",
          concept: "BOS.CONCEPT.MERCANTILISM.v1",
        },
        {
          card: "BOS.MD01.CARD.NOT_WAR_NOT_COUNTERTAX.v1",
          concept: "BOS.CONCEPT.MERCANTILISM.v1",
        },
      ],
    ],
  ]);

const CONCEPT_BY_CARD = new Map<string, string>();
const CARDS_BY_CONCEPT = new Map<string, string[]>();
for (const entries of CODEX_CARDS.values()) {
  for (const entry of entries) {
    CONCEPT_BY_CARD.set(entry.card, entry.concept);
    const cards = CARDS_BY_CONCEPT.get(entry.concept) ?? [];
    cards.push(entry.card);
    CARDS_BY_CONCEPT.set(entry.concept, cards);
  }
}

/**
 * The unlock schedule, re-keyed onto the runtime chapter.
 *
 * @pa/abilities authors each milestone against its own chapter key, so only the
 * chapter id is rewritten here. The ability and the Level it lands at are the
 * authored values, parsed again on the way through so a bad projection fails
 * at boot rather than at the first Level gain.
 */
const BOSTON_MILESTONES: readonly AbilityMilestone[] = BOSTON_ABILITY_MILESTONES.map(
  (milestone) =>
    AbilityMilestoneSchema.parse({
      abilityId: milestone.abilityId,
      chapterId: BOSTON_RUNTIME_CHAPTER_ID,
      level: milestone.level,
    }),
);

const MISSION_REWARDS: ReadonlyMap<string, MissionReward> = new Map(
  [...MISSION_CONTENT].map(([missionId, row]) => [
    missionId,
    MissionRewardSchema.parse({
      missionId,
      chapterId: BOSTON_RUNTIME_CHAPTER_ID,
      // The authored ramp, read by ordinal. Never a literal in this file.
      baseXp: missionBaseXp(MISSION_ORDINALS.get(missionId) ?? 0),
      moduleId: row.moduleId,
      conceptIds: [...row.conceptIds],
    }),
  ]),
);

// --- The Boston chapter capstone (BOS.CAPSTONE.v1) --------------------------
//
// Now wired. The concept set and the item bank are both authored (the 1774
// reslate under content/capstone/boston-1765/), which was the one condition the
// server refused to serve an empty capstone until. Enabling it is safe under the
// M1-only freeze: no chapter two exists in the registry, so passing the capstone
// advances to no next chapter and revokes no PvP-legal Codex card.
//
// The assessment id is BOS.CAPSTONE.v1 — the single spelling the authored content,
// @pa/curriculum's assessments.ts and @pa/abilities' chapters.ts already agree on.
// (A superseded "BOSTON.CAPSTONE" resolves to it through resolveAssessmentId and is
// produced by no live code and no stored row.)
//
// These maps are the SERVER's copy of the authored bank, transcribed the way
// MODULE_DECKS is and pinned the same way: capstone-content-parity.test.ts asserts
// this file against content/capstone + the released TEA keys, so a drift fails a
// gate rather than silently under-assessing.
const BOSTON_CAPSTONE_ASSESSMENT_ID = "BOS.CAPSTONE.v1";

const BOSTON_CAPSTONE_CONCEPT_IDS: readonly string[] = [
  "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
  "BOS.CONCEPT.REPRESENTATION.v1",
  "BOS.CONCEPT.MERCANTILISM.v1",
];

// Six items a concept, in reserve order. Interleaved selected/open response so the
// in-order selectFreshItems hands every form one recognition item and one reasoning
// item — the parallel-forms shape the blueprint specifies.
const CAPSTONE_ITEM_RESERVE: ReadonlyMap<string, readonly string[]> = new Map([
  [
    "BOS.CONCEPT.INTOLERABLE_ACTS.v1",
    [
      "STAAR.2021MAY.G8SS.38",
      "BOS.CAP.ACTS.ORDERING.v1",
      "STAAR.2022MAY.G8SS.04",
      "BOS.CAP.ACTS.CORRECTION.v1",
      "BOS.CAP.ACTS.BOUNDARY.v1",
      "BOS.CAP.ACTS.APPLICATION.v1",
    ],
  ],
  [
    "BOS.CONCEPT.REPRESENTATION.v1",
    [
      "STAAR.2019MAY.G8SS.24",
      "BOS.CAP.REP.CORRECTION.v1",
      "BOS.CAP.REP.RECALL.v1",
      "BOS.CAP.REP.ORDERING.v1",
      "BOS.CAP.REP.BOUNDARY.v1",
      "BOS.CAP.REP.APPLICATION.v1",
    ],
  ],
  [
    "BOS.CONCEPT.MERCANTILISM.v1",
    [
      "BOS.CAP.RESIST.RECALL.v1",
      "BOS.CAP.RESIST.CORRECTION.v1",
      "BOS.CAP.RESIST.BOUNDARY.v1",
      "BOS.CAP.RESIST.DISCRIMINATION.v1",
      "BOS.CAP.RESIST.ORDERING.v1",
      "BOS.CAP.RESIST.APPLICATION.v1",
    ],
  ],
]);

// The nine open-response items; every other reserve item is selected-response.
const CAPSTONE_OPEN_RESPONSE_ITEMS: ReadonlySet<string> = new Set([
  "BOS.CAP.ACTS.ORDERING.v1",
  "BOS.CAP.ACTS.CORRECTION.v1",
  "BOS.CAP.ACTS.APPLICATION.v1",
  "BOS.CAP.REP.CORRECTION.v1",
  "BOS.CAP.REP.ORDERING.v1",
  "BOS.CAP.REP.APPLICATION.v1",
  "BOS.CAP.RESIST.CORRECTION.v1",
  "BOS.CAP.RESIST.DISCRIMINATION.v1",
  "BOS.CAP.RESIST.APPLICATION.v1",
]);

// The selected-response key, server-side only and never shipped. Six authored keys
// are content/capstone/boston-1765/answer-key.json; the three released items carry
// TEA's own official key from content/staar (2021 #38 = H, 2022 #4 = J, 2019 #24 = H).
const CAPSTONE_ANSWER_KEY: ReadonlyMap<string, string> = new Map([
  ["BOS.CAP.ACTS.BOUNDARY.v1", "C"],
  ["BOS.CAP.REP.RECALL.v1", "B"],
  ["BOS.CAP.REP.BOUNDARY.v1", "D"],
  ["BOS.CAP.RESIST.RECALL.v1", "A"],
  ["BOS.CAP.RESIST.BOUNDARY.v1", "D"],
  ["BOS.CAP.RESIST.ORDERING.v1", "A"],
  ["STAAR.2021MAY.G8SS.38", "H"],
  ["STAAR.2022MAY.G8SS.04", "J"],
  ["STAAR.2019MAY.G8SS.24", "H"],
]);

const CAPSTONE_ITEM_CONCEPT: ReadonlyMap<string, string> = new Map(
  [...CAPSTONE_ITEM_RESERVE].flatMap(([conceptId, itemIds]) =>
    itemIds.map((itemId) => [itemId, conceptId] as const),
  ),
);

/**
 * Boston, as the server's content pack.
 *
 * The mission half prices a clear, prices each mission, gates each attempt, and
 * mints the ability the schedule says. The capstone half is now wired from the
 * maps above rather than refusing with PACKAGE_MISSING.
 */
export function bostonProgressionContent(): ProgressionContent {
  return {
    initialChapterId: () => BOSTON_RUNTIME_CHAPTER_ID,
    xpCurve: (chapterId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID ? BOSTON_XP_CURVE : null,
    missionReward: (chapterId, missionId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID
        ? (MISSION_REWARDS.get(missionId) ?? null)
        : null,
    abilityMilestones: (chapterId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID ? BOSTON_MILESTONES : [],
    chapterConceptIds: (chapterId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID ? BOSTON_CAPSTONE_CONCEPT_IDS : [],
    assessmentId: (chapterId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID ? BOSTON_CAPSTONE_ASSESSMENT_ID : null,
    assessmentModuleId: (chapterId) =>
      chapterId === BOSTON_RUNTIME_CHAPTER_ID ? M1_MODULE_ID : null,
    itemReserve: (assessmentId, conceptId) =>
      assessmentId === BOSTON_CAPSTONE_ASSESSMENT_ID
        ? (CAPSTONE_ITEM_RESERVE.get(conceptId) ?? [])
        : [],
    itemConcept: (itemId) => CAPSTONE_ITEM_CONCEPT.get(itemId) ?? null,
    itemFormat: (itemId) =>
      CAPSTONE_ITEM_CONCEPT.has(itemId)
        ? CAPSTONE_OPEN_RESPONSE_ITEMS.has(itemId)
          ? "OPEN_RESPONSE"
          : "SELECTED_RESPONSE"
        : null,
    isCorrectOption: (itemId, optionId) =>
      CAPSTONE_ANSWER_KEY.get(itemId) === optionId,
    moduleDeckCueIds: (moduleId) => MODULE_DECKS.get(moduleId) ?? null,
    moduleRequiredCheckIds: (moduleId) => MODULE_CHECKS.get(moduleId) ?? [],
    codexCardsForModule: (moduleId) =>
      (CODEX_CARDS.get(moduleId) ?? []).map((entry) => entry.card),
    codexCardsForConcept: (conceptId) => CARDS_BY_CONCEPT.get(conceptId) ?? [],
    conceptForCard: (cardId) => CONCEPT_BY_CARD.get(cardId) ?? null,
  };
}
