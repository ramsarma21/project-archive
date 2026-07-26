// ============================================================================
// Mission identity, and the one rule every mission-keyed lookup must obey.
//
// WHY THIS IS ITS OWN FILE. It is chapters.ts one layer down, for a divergence
// that has already shipped once in this exact family: content spelled a mission
// `m1` while the registry spelled it `PA.SEA01.CH02.BOSTON.MD01`. That was
// patched. What was left behind is the wider version of the same thing — the
// slate here keyed its fourteen missions `M1`..`M14`, while `mission_progress`,
// `mission_attempts` and every mission id the client deploys against say
// `PA.SEA01.CH02.BOSTON.MD01`. `conceptsForMission` took the runtime id, matched
// no concept's owner, and returned an empty list.
//
// The runtime id is canonical because it is the one already written into
// `mission_progress.mission_id` and `mission_attempts.mission_id`. `M1` is an
// authoring label; a stored mission id is a student's attempt history, and
// renaming it to settle a spelling would be a migration over an academic record.
// The slate ordinal survives as `MissionSlot.ordinal`, which is what `M1` was
// really carrying.
//
// A LOOKUP FOR AN UNKNOWN MISSION IS AN ERROR, NEVER AN EMPTY LIST. That silent
// empty is the defect; the mismatched string only exposes it. `conceptsForMission`
// and `getMission` throw `UnknownMissionError` rather than answering "nothing",
// and a caller holding a mission id it did not author checks
// `isCurriculumMissionId` first instead of catching.
// ============================================================================

/**
 * A mission id the registry actually holds, in its canonical spelling.
 *
 * Branded so an authoring site cannot spell one for itself: the only ways in are
 * the exported constants and `asCurriculumMissionId`, both of which are checked
 * against `CURRICULUM_MISSION_IDS`.
 */
export type CurriculumMissionId = string & {
  readonly __brand: "PA.CurriculumMissionId";
};

/**
 * How a Boston mission day is spelled at runtime: season 1, chapter 2, mission
 * day NN, zero-padded.
 *
 * Derived rather than written out fourteen times so `MD07` cannot be the one
 * with a typo in it. The format itself is pinned in `missionIds.test.ts` against
 * the client's written-out slate, which is the half that cannot be imported.
 */
const BOSTON_MISSION_DAY_PREFIX = "PA.SEA01.CH02.BOSTON.MD";

function bostonMissionDayId(ordinal: number): CurriculumMissionId {
  return `${BOSTON_MISSION_DAY_PREFIX}${String(ordinal).padStart(2, "0")}` as CurriculumMissionId;
}

/**
 * The fourteen Boston missions, spelled the way the database spells them.
 *
 * Must stay equal to `BOSTON_SLATE` in apps/web/src/chapter/bostonChapter.ts and
 * to `bostonMissionId()` in apps/api/src/progression/content.ts.
 * `missionIds.test.ts` pins the literals, so a rename here fails a test rather
 * than emptying a mission's concept list.
 */
export const MISSION_M1 = bostonMissionDayId(1);
export const MISSION_M2 = bostonMissionDayId(2);
export const MISSION_M3 = bostonMissionDayId(3);
export const MISSION_M4 = bostonMissionDayId(4);
export const MISSION_M5 = bostonMissionDayId(5);
export const MISSION_M6 = bostonMissionDayId(6);
export const MISSION_M7 = bostonMissionDayId(7);
export const MISSION_M8 = bostonMissionDayId(8);
export const MISSION_M9 = bostonMissionDayId(9);
export const MISSION_M10 = bostonMissionDayId(10);
export const MISSION_M11 = bostonMissionDayId(11);
export const MISSION_M12 = bostonMissionDayId(12);
export const MISSION_M13 = bostonMissionDayId(13);
export const MISSION_M14 = bostonMissionDayId(14);

/** Every mission this registry can answer for, in slate order. */
export const CURRICULUM_MISSION_IDS: readonly CurriculumMissionId[] = [
  MISSION_M1,
  MISSION_M2,
  MISSION_M3,
  MISSION_M4,
  MISSION_M5,
  MISSION_M6,
  MISSION_M7,
  MISSION_M8,
  MISSION_M9,
  MISSION_M10,
  MISSION_M11,
  MISSION_M12,
  MISSION_M13,
  MISSION_M14,
];

const CANONICAL = new Set<string>(CURRICULUM_MISSION_IDS);

/**
 * Superseded mission spellings, and what each one is now.
 *
 * The same device `aliases.ts` uses for concept and SE identifiers, and
 * chapters.ts for the chapter key: a legacy spelling is retagged onto the
 * canonical id and recorded here, rather than being accepted as a second name
 * for the mission. Two families of them:
 *
 *   `M1`..`M14` — the slate labels. This registry's own authoring key until it
 *   was reconciled with the runtime id, and still how the mission slate doc,
 *   `content/m1/module.json`'s `authoredFor.missionId` and `BOSTON_MISSIONS` in
 *   @pa/abilities name a mission. Concept seeds are still authored as `M1`
 *   because that is what the design doc says, and `build()` canonicalises them
 *   on the way in — which is the point of the device, as against a translation
 *   at each lookup, since a shim at the call site is what hid the chapter
 *   spelling for months.
 *
 *   `<runtime id>.v1` — the content-versioned form. Mission-Slate.md calls
 *   `PA.SEA01.CH02.BOSTON.MD01.v1` the "stable mission ID" and three authored
 *   files carry it (`content/m1/module.json`, `content/m1/duel-items.json`,
 *   `content/boston/act1/package.manifest.json`). It is a content revision of a
 *   mission day, not a second mission, so it resolves onto the day it versions.
 *   Accepted for all fourteen rather than only M1 because it is a documented
 *   convention: M2's content lands next and would otherwise re-import the bug.
 */
const SUPERSEDED: ReadonlyMap<string, CurriculumMissionId> = new Map(
  CURRICULUM_MISSION_IDS.flatMap((missionId, index) => [
    [`M${index + 1}`, missionId] as const,
    [`${missionId}.v1`, missionId] as const,
  ]),
);

/**
 * Whether this is a canonical mission id the registry holds.
 *
 * The non-throwing door, for a caller whose mission id came from a request. A
 * route should answer 404 on false rather than let a lookup throw into a 500.
 * Deliberately false for a superseded spelling: no `mission_attempts` row uses
 * one, so a request that names one is asking after a mission nobody has played.
 */
export function isCurriculumMissionId(value: string): value is CurriculumMissionId {
  return CANONICAL.has(value);
}

/**
 * Canonicalise a mission id, or report that it names no mission.
 *
 * What every mission-keyed lookup calls. Accepts a canonical id or a superseded
 * spelling and returns the canonical one; returns null for anything else, so the
 * caller raises `UnknownMissionError` instead of filtering the registry to
 * nothing.
 */
export function resolveMissionId(value: string): CurriculumMissionId | null {
  if (isCurriculumMissionId(value)) return value;
  return SUPERSEDED.get(value) ?? null;
}

/**
 * Thrown by every mission-keyed lookup that cannot answer.
 *
 * Carries the ids it does hold, because the whole class of bug this replaces was
 * two plausible spellings of one mission and a caller with no way to see which
 * one it was holding.
 */
export class UnknownMissionError extends Error {
  readonly input: string;
  readonly known: readonly string[];

  constructor(input: string, known: readonly string[] = CURRICULUM_MISSION_IDS) {
    super(
      `unknown mission id ${JSON.stringify(input)}; known missions are ` +
        `${known.map((id) => JSON.stringify(id)).join(", ") || "(none)"}`,
    );
    this.name = "UnknownMissionError";
    this.input = input;
    this.known = [...known];
  }
}

/** Narrow a plain string onto the branded canonical id, or refuse it. */
export function asCurriculumMissionId(value: string): CurriculumMissionId {
  const resolved = resolveMissionId(value);
  if (resolved === null) throw new UnknownMissionError(value);
  return resolved;
}
