import {
  CURRICULUM_MISSION_IDS,
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
  UnknownMissionError,
  resolveMissionId,
  type CurriculumMissionId,
} from "./missionIds.js";
import { asSeCode } from "./seCode.js";
import type { MissionSlot } from "./types.js";

// ============================================================================
// The fourteen Boston missions and the student expectations the slate assigns
// to each. Transcribed from the slate table in
// docs/chapters/boston-1765/Mission-Slate.md section 3 and the per-mission
// sections 4-17.
//
// This table exists so "which missions are blocked" is a computed answer rather
// than a paragraph in a design doc. `missionReadiness()` in registry.ts joins it
// against the concept registry.
//
// Rows are keyed by the runtime mission id rather than by the slate's `M1`..`M14`
// labels; missionIds.ts says why, and `resolveMissionId` is what keeps the labels
// working. The slate's own numbering is `ordinal`.
// ============================================================================

const MISSION_SLATE = "docs/chapters/boston-1765/Mission-Slate.md";

/**
 * Prefix for an SE this table assigns that the slate table does not.
 *
 * The rest of `assignedSeCodes` is transcription. 8.4(B) is not: STAAR names
 * fourteen individuals, the owner chose a dedicated gated concept per individual
 * over recording them on neighbouring concepts, and a concept must be owned by a
 * mission whose assigned standards include its parent — `validateCurriculum`
 * raises CONCEPT_SE_NOT_ASSIGNED_TO_OWNER_MISSION as an ERROR otherwise. So the
 * four placements carry four assignments, and each says so rather than passing
 * for something the slate decided.
 */
const STAAR_ADDITION =
  "8.4(B) is added here beyond the slate table, to carry STAAR's named " +
  "individual";

const ROWS: MissionSlot[] = [
  {
    missionId: MISSION_M1,
    ordinal: 1,
    title: "Nailed to the Post",
    date: "14 Aug 1765",
    set: 1,
    assignedSeCodes: [asSeCode("8.4(A)"), asSeCode("8.4(B)")],
    assignmentStatus: "ASSIGNED",
    notes: [
      "The slate table names the three implemented BOS.MD01 macros rather than " +
        "an SE. All three sit under 8.4(A) clauses, so the assignment is " +
        "recorded as 8.4(A).",
      STAAR_ADDITION + " King George III (GEORGE_III_CROWN_AUTHORITY).",
    ],
  },
  {
    missionId: MISSION_M2,
    ordinal: 2,
    title: "Landed Weight",
    date: "1765",
    set: 1,
    assignedSeCodes: [asSeCode("8.11(A)"), asSeCode("8.12(A)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M3,
    ordinal: 3,
    title: "The Comptroller's Books",
    date: "26 Aug 1765",
    set: 1,
    assignedSeCodes: [],
    assignmentStatus: "OPEN",
    notes: [
      "Unsettled by design. M1 took over the 8.4(A) content that originally made " +
        "M3 its carrier. " +
        MISSION_SLATE +
        " section 6 says M3 may retain 8.15(C) as one concept but that its " +
        "second concept, or a full replacement pair, has not been selected, and " +
        "explicitly declines to invent one. This registry declines as well.",
    ],
  },
  {
    missionId: MISSION_M4,
    ordinal: 4,
    title: "Set It Before Morning",
    date: "Oct-Nov 1765",
    set: 1,
    assignedSeCodes: [asSeCode("8.14(A)"), asSeCode("8.15(E)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M5,
    ordinal: 5,
    title: "A Journal of the Times",
    date: "Winter 1768-69",
    set: 2,
    assignedSeCodes: [asSeCode("8.23(B)"), asSeCode("8.21(B)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M6,
    ordinal: 6,
    title: "A Short Narrative",
    date: "5-15 Mar 1770",
    set: 2,
    assignedSeCodes: [asSeCode("8.23(B)"), asSeCode("8.4(B)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M7,
    ordinal: 7,
    title: "Counsel for the Defense",
    date: "Oct-Dec 1770",
    set: 2,
    assignedSeCodes: [
      asSeCode("8.20(A)"),
      asSeCode("8.19(C)"),
      asSeCode("8.4(B)"),
    ],
    assignmentStatus: "ASSIGNED",
    notes: [
      STAAR_ADDITION + " John Adams (JOHN_ADAMS_DEFENSE_COUNSEL).",
      "Now carries three concepts on one episode — the jury's duty, the " +
        "principle Adams held, and the office he held. See the discriminator " +
        "notes on JOHN_ADAMS_DEFENSE_COUNSEL before authoring any of the three.",
    ],
  },
  {
    missionId: MISSION_M8,
    ordinal: 8,
    title: "The Circular",
    date: "Winter 1772-73",
    set: 3,
    assignedSeCodes: [
      asSeCode("8.10(C)"),
      asSeCode("8.3(A)"),
      asSeCode("8.4(B)"),
    ],
    assignmentStatus: "ASSIGNED",
    notes: [
      STAAR_ADDITION + " Samuel Adams (SAMUEL_ADAMS_ORGANIZER).",
      "The committees mission, so all three of its concepts touch the Committee " +
        "of Correspondence from different sides: what the town meeting could " +
        "lawfully do, how word travelled, and what Adams personally drafted.",
    ],
  },
  {
    missionId: MISSION_M9,
    ordinal: 9,
    title: "Twenty Days",
    date: "28 Nov-16 Dec 1773",
    set: 3,
    assignedSeCodes: [asSeCode("8.20(B)"), asSeCode("8.19(A)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M10,
    ordinal: 10,
    title: "Griffin's Wharf",
    date: "16 Dec 1773",
    set: 3,
    assignedSeCodes: [asSeCode("8.20(B)"), asSeCode("8.12(C)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M11,
    ordinal: 11,
    title: "The Port Is Shut",
    date: "Jun-Sep 1774",
    set: 4,
    assignedSeCodes: [asSeCode("8.4(A)"), asSeCode("8.1(A)")],
    assignmentStatus: "ASSIGNED",
    notes: [
      "Second visit to 8.4(A), covering the Intolerable Acts and mercantilism " +
        "clauses that M1 does not teach.",
    ],
  },
  {
    missionId: MISSION_M12,
    ordinal: 12,
    title: "The Group",
    date: "1774-75",
    set: 4,
    assignedSeCodes: [asSeCode("8.23(E)"), asSeCode("8.4(B)")],
    assignmentStatus: "ASSIGNED",
    notes: [],
  },
  {
    missionId: MISSION_M13,
    ordinal: 13,
    title: "The Alarm",
    date: "18-19 Apr 1775",
    set: 4,
    assignedSeCodes: [asSeCode("8.4(C)"), asSeCode("8.10(A)")],
    assignmentStatus: "ASSIGNED",
    notes: [
      "8.10(A) has no other carrier in the chapter. If the Lexington/Concord " +
        "corridor is cut, the SE loses its only natural home.",
    ],
  },
  {
    missionId: MISSION_M14,
    ordinal: 14,
    title: "The Lines",
    date: "Apr-Jul 1775",
    set: 4,
    assignedSeCodes: [
      asSeCode("8.4(C)"),
      asSeCode("8.22(A)"),
      asSeCode("8.4(B)"),
    ],
    assignmentStatus: "ASSIGNED",
    notes: [
      STAAR_ADDITION + " George Washington (WASHINGTON_CONTINENTAL_APPOINTMENT).",
      "Takes set 4 from nine macro concepts to ten, making it the heaviest unit " +
        "in the chapter by a wider margin. Flagged for whoever cuts the set-4 " +
        "lesson; nothing here changes the mission count.",
    ],
  },
];

export const MISSIONS: ReadonlyMap<CurriculumMissionId, MissionSlot> = new Map(
  [...ROWS]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((row) => [row.missionId, row]),
);

export const ALL_MISSIONS: readonly MissionSlot[] = [...MISSIONS.values()];

/**
 * One mission's slate row, by any spelling of its id.
 *
 * THROWS `UnknownMissionError` RATHER THAN RETURNING UNDEFINED for an id that
 * names no mission. The distinction matters: undefined here would mean "the
 * registry holds no row for this mission", which a caller may reasonably shrug
 * at, and that is precisely how a misspelling reads as an empty chapter. A
 * caller whose id came from a request checks `isCurriculumMissionId` first.
 */
export function getMission(missionId: string): MissionSlot {
  const resolved = resolveMissionId(missionId);
  const row = resolved === null ? undefined : MISSIONS.get(resolved);
  if (!row) throw new UnknownMissionError(missionId, [...CURRICULUM_MISSION_IDS]);
  return row;
}

/**
 * M1's canonical runtime id.
 *
 * Was `PA.SEA01.CH02.BOSTON.MD01.v1`, which is the "stable mission ID" the
 * mission slate doc and `content/m1/module.json` use for the CONTENT REVISION of
 * the mission day. It is not the id the runtime deploys against and it is not
 * what `mission_progress.mission_id` holds — both drop the `.v1` — so a caller
 * that trusted this constant would have missed every row. The `.v1` form still
 * resolves, through `resolveMissionId`.
 *
 * @deprecated Prefer `MISSION_M1`. Kept because the name is exported.
 */
export const M1_STABLE_MISSION_ID = MISSION_M1;
