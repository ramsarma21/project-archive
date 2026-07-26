// The Boston slate, as progression data — and the affordance schedule the
// ability set is derived from.
//
// This is not mission content. Level geometry, routes, patrols, question banks
// and modules belong to the mission packages. What lives here is the part of the
// slate the CURVE has to know: each mission's ordinal, its authored base award,
// which functional affordance it shows off, and — the load-bearing column — the
// route that completes it with no ability at all.
//
// Transcribed from docs/chapters/boston-1765/Mission-Slate.md sections 3 and 18.
// Mission ids match packages/curriculum/src/missions.ts ("M1".."M14").
//
// ============================================================================
// THE CONTRADICTION IN SECTION 18, AND WHICH SIDE WINS
// ============================================================================
//
// Section 18 describes each affordance as "first required" at some mission — M7,
// M8, M9, M10, M13. Sections 1.6 and 3 say the opposite and say it twice: "No
// mission may require an ability. Every mission is completable with base movement
// and the precision verb alone", and "The affordance column names what a mission
// is built to show off, never what it demands".
//
// Sections 1.6 and 3 win, and not merely because they are the later draft. The
// requirement reading is UNSATISFIABLE. A player who exhausts three attempts on a
// mission advances anyway and earns nothing, so the XP a player is GUARANTEED to
// hold on arriving at any mission is zero, and their guaranteed Level is 0. No
// positive unlock threshold can ever be at or below zero. Under the requirement
// reading every affordance is a progression deadlock for the player who most
// needs help, at every threshold, for any curve. The rule "no mission may require
// an ability" is therefore not a stylistic preference; it is the only consistent
// rule available, and this table encodes it as data: `requiredAbilityIds` is
// empty on every row, and `abilityFreeRoute` names the fallback the slate itself
// already authored.
//
// `firstFeaturedMissionId` keeps section 18's ordering intent as what it actually
// is — the mission the affordance is BUILT AROUND — and the unlock schedule is
// still validated against it (see verify.ts), because a rehearsal the player
// cannot reach is wasted authoring even when it is not a deadlock.

import {
  BOSTON_CAPSTONE_ASSESSMENT_ID,
  BOSTON_CHAPTER_ID,
} from "./chapters.js";
import { MissionRewardSchema, type MissionReward } from "./contractsSurface.js";
import { missionBaseXp } from "./curve.js";

// ---------------------------------------------------------------------------
// functional affordances (Mission-Slate.md section 18)
// ---------------------------------------------------------------------------

export const AFFORDANCE_IDS = [
  "ATTENTION_RELOCATION",
  "ISOLATED_HEIGHT_ACCESS",
  "CARRIED_EVIDENCE_CONCEALMENT",
  "CONTACT_RECOVERY",
  "UNSUPPORTED_GAP",
] as const;
export type AffordanceId = (typeof AFFORDANCE_IDS)[number];

export interface AffordanceSpec {
  readonly affordanceId: AffordanceId;
  /** Section 18's functional need, in one sentence. */
  readonly functionalNeed: string;
  /** Mission the affordance is first offered in, optional and low stakes. */
  readonly introducedMissionId: string;
  /** Mission the affordance is built around and most rewarded in. */
  readonly firstFeaturedMissionId: string;
  /** Later missions that reuse it. */
  readonly recurrenceMissionIds: readonly string[];
  /**
   * How the featured mission is completed with no ability. Section 18 authored
   * every one of these; they are quoted here because they are the proof that
   * the affordance is a shortcut and not a key.
   */
  readonly abilityFreeRoute: string;
}

export const BOSTON_AFFORDANCES: Readonly<Record<AffordanceId, AffordanceSpec>> = {
  ATTENTION_RELOCATION: {
    affordanceId: "ATTENTION_RELOCATION",
    functionalNeed:
      "Make one watcher or crowd leader look at a harmless authored spot long enough for something to cross elsewhere.",
    introducedMissionId: "M5",
    firstFeaturedMissionId: "M7",
    recurrenceMissionIds: ["M6", "M14"],
    abilityFreeRoute:
      "The base thrown diversion pulls the same cone; ignoring both leaves a slower base route past the guarded crossing.",
  },
  ISOLATED_HEIGHT_ACCESS: {
    affordanceId: "ISOLATED_HEIGHT_ACCESS",
    functionalNeed:
      "Reach a second-storey opening where no adjacent stack, ladder or base climb line exists.",
    introducedMissionId: "M6",
    firstFeaturedMissionId: "M8",
    recurrenceMissionIds: ["M7", "M13", "M14"],
    abilityFreeRoute:
      "The stairs. M6 authors the service window as a shortcut with the stair route intact; M8's gate-walk opening keeps a ground line past the gate.",
  },
  CARRIED_EVIDENCE_CONCEALMENT: {
    affordanceId: "CARRIED_EVIDENCE_CONCEALMENT",
    functionalNeed:
      "Move a document or marked object without letting observers read its incriminating face.",
    introducedMissionId: "M8",
    firstFeaturedMissionId: "M9",
    recurrenceMissionIds: ["M11", "M12", "M14"],
    abilityFreeRoute:
      "A longer unconcealed crossing that stays outside the reading distance, plus base crowd blending through the apron throng.",
  },
  CONTACT_RECOVERY: {
    affordanceId: "CONTACT_RECOVERY",
    functionalNeed:
      "Recover from a non-lethal grab, shoulder check or crowd collision without ending the run.",
    introducedMissionId: "M9",
    firstFeaturedMissionId: "M10",
    recurrenceMissionIds: ["M13"],
    abilityFreeRoute:
      "The safe-deck line, which routes around the dense public crowd entirely; contact costs seconds and noise, never the run.",
  },
  UNSUPPORTED_GAP: {
    affordanceId: "UNSUPPORTED_GAP",
    functionalNeed:
      "Cross a horizontal break with no adjacent support and no legal run/vault/climb/drop solution.",
    introducedMissionId: "M11",
    firstFeaturedMissionId: "M13",
    recurrenceMissionIds: ["M14"],
    abilityFreeRoute:
      "The marsh detour at M11 and the ditch bank at M13: both are longer, both are noisier, both are legal at Level 0.",
  },
};

// ---------------------------------------------------------------------------
// the slate
// ---------------------------------------------------------------------------

export interface BostonMissionRow {
  readonly missionId: string;
  readonly ordinal: number;
  readonly title: string;
  /** Mission set 1-4; a rank-up assessment gates each boundary. */
  readonly set: 1 | 2 | 3 | 4;
  /** Authored base award, paid in full only on attempt 1. */
  readonly baseXp: number;
  /** Affordances this mission is built to show off. Never demands. */
  readonly featuredAffordanceIds: readonly AffordanceId[];
  /** Affordances offered here for the first time, optional and low stakes. */
  readonly introducesAffordanceIds: readonly AffordanceId[];
  /**
   * Abilities the mission cannot be completed without. Empty on every row,
   * forever. verify.ts asserts it, and the assertion is the design rule.
   */
  readonly requiredAbilityIds: readonly string[];
  /** How the mission is completed at Level 0 with an empty loadout. */
  readonly abilityFreeRoute: string;
}

function row(
  missionId: string,
  ordinal: number,
  title: string,
  set: 1 | 2 | 3 | 4,
  featured: readonly AffordanceId[],
  introduces: readonly AffordanceId[],
  abilityFreeRoute: string,
): BostonMissionRow {
  return {
    missionId,
    ordinal,
    title,
    set,
    baseXp: missionBaseXp(ordinal),
    featuredAffordanceIds: featured,
    introducesAffordanceIds: introduces,
    requiredAbilityIds: [],
    abilityFreeRoute,
  };
}

export const BOSTON_MISSIONS: readonly BostonMissionRow[] = [
  row("M1", 1, "Nailed to the Post", 1, [], [], "Base run, vault, climb, drop and the precision beat. No affordance is present."),
  row("M2", 2, "Landed Weight", 1, [], [], "Carried-object traversal and the hoist beat, both base verbs."),
  row("M3", 3, "The Comptroller's Books", 1, [], [], "Base traversal past the fire crowd; the crew cues are choreography, not a gate."),
  row("M4", 4, "Set It Before Morning", 1, [], [], "Base traversal through the press floor and out; no affordance is present."),
  row(
    "M5",
    5,
    "A Journal of the Times",
    2,
    ["ATTENTION_RELOCATION"],
    ["ATTENTION_RELOCATION"],
    "Ignoring the diversion leaves a slower base route past the ropewalk; the base thrown object also works.",
  ),
  row(
    "M6",
    6,
    "A Short Narrative",
    2,
    ["ISOLATED_HEIGHT_ACCESS", "ATTENTION_RELOCATION"],
    ["ISOLATED_HEIGHT_ACCESS"],
    "The stairs to the upper wharf floor, with the service window as an optional shortcut.",
  ),
  row(
    "M7",
    7,
    "Counsel for the Defense",
    2,
    ["ATTENTION_RELOCATION", "ISOLATED_HEIGHT_ACCESS"],
    [],
    "The base thrown diversion moves the crowd leader off the steps; the shutter route is optional either way.",
  ),
  row(
    "M8",
    8,
    "The Circular",
    3,
    ["ISOLATED_HEIGHT_ACCESS", "CARRIED_EVIDENCE_CONCEALMENT"],
    ["CARRIED_EVIDENCE_CONCEALMENT"],
    "The ground line past the gate walk, and a longer unconcealed packet crossing outside reading distance.",
  ),
  row(
    "M9",
    9,
    "Twenty Days",
    3,
    ["CARRIED_EVIDENCE_CONCEALMENT", "CONTACT_RECOVERY"],
    ["CONTACT_RECOVERY"],
    "The safe-deck line off the gangway, plus base crowd blending across the watched apron.",
  ),
  row(
    "M10",
    10,
    "Griffin's Wharf",
    3,
    ["CONTACT_RECOVERY"],
    [],
    "Incidental crowd contact costs seconds and noise; the wharf route stays legal through it at Level 0.",
  ),
  row(
    "M11",
    11,
    "The Port Is Shut",
    4,
    ["CARRIED_EVIDENCE_CONCEALMENT", "UNSUPPORTED_GAP"],
    ["UNSUPPORTED_GAP"],
    "The marsh detour source lane, longer and louder but fully traversable with base verbs.",
  ),
  row(
    "M12",
    12,
    "The Group",
    4,
    ["CARRIED_EVIDENCE_CONCEALMENT"],
    [],
    "The manuscript crosses on the long unwatched line; base crowd blending covers the billeting search.",
  ),
  row(
    "M13",
    13,
    "The Alarm",
    4,
    ["UNSUPPORTED_GAP", "CONTACT_RECOVERY"],
    [],
    "The ditch bank around the washed-out road, and the militia line passes at walking pace.",
  ),
  row(
    "M14",
    14,
    "The Lines",
    4,
    ["ISOLATED_HEIGHT_ACCESS", "CARRIED_EVIDENCE_CONCEALMENT", "UNSUPPORTED_GAP"],
    [],
    "Warehouse stairs, the long carry line, and the wharf ground route; the bell is choreography, not a player requirement.",
  ),
];

/**
 * The chapter capstone. Present so the XP arithmetic is complete and visibly
 * closed: it is the fifteenth thing a player does in Boston and it pays nothing,
 * which is the whole reason the chapter's XP ceiling is what it is.
 */
export const BOSTON_CAPSTONE = {
  assessmentId: BOSTON_CAPSTONE_ASSESSMENT_ID,
  chapterId: BOSTON_CHAPTER_ID,
  baseXp: 0,
  requiredAbilityIds: [] as readonly string[],
  note:
    "All Boston concepts, two items per concept, 100% per concept. Gates the next chapter and mints PvP-legal Codex cards. Pays zero XP and does not affect Rank.",
} as const;

export function missionByOrdinal(ordinal: number): BostonMissionRow | undefined {
  return BOSTON_MISSIONS[ordinal - 1];
}

export function missionById(missionId: string): BostonMissionRow | undefined {
  return BOSTON_MISSIONS.find((mission) => mission.missionId === missionId);
}

/**
 * The base awards, in the join shape the mission registry needs. Deliberately
 * NOT a full `MissionReward`: `moduleId` and `conceptIds` are owned by the
 * module and curriculum layers, and inventing placeholders for them here would
 * put fake content ids into the progression path. Use `toMissionReward` to
 * complete a row where those ids are actually known.
 */
export const BOSTON_MISSION_XP: readonly {
  readonly missionId: string;
  readonly chapterId: string;
  readonly baseXp: number;
}[] = BOSTON_MISSIONS.map((mission) => ({
  missionId: mission.missionId,
  chapterId: BOSTON_CHAPTER_ID,
  baseXp: mission.baseXp,
}));

/**
 * Complete a mission's award into the `MissionReward` @pa/contracts stores, once
 * the module and concept ids for it exist. Validated on the way out, so a
 * malformed join fails here rather than at the first XP commit.
 */
export function toMissionReward(
  missionId: string,
  content: { moduleId: string; conceptIds: readonly string[] },
): MissionReward {
  const mission = missionById(missionId);
  if (!mission) throw new Error(`unknown Boston mission: ${missionId}`);
  return MissionRewardSchema.parse({
    missionId: mission.missionId,
    chapterId: BOSTON_CHAPTER_ID,
    baseXp: mission.baseXp,
    moduleId: content.moduleId,
    conceptIds: [...content.conceptIds],
  });
}
