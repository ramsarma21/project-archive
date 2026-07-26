import { registerMission, registeredMissionIds } from "../mission/missionFormat.js";
import { M1_MISSION_ID, m1MissionDefinition } from "./m1Mission.js";

// ---------------------------------------------------------------------------
// Boston 1765-1775: fourteen missions, one of them built.
//
// The slate is declared in full and the registry holds only what exists. That
// split is the point of this file: the hub can draw fourteen entries, the
// ordering and the unlock chain are real, and shipping M2 is one entry changing
// `built: false` to a `definition` — a data edit, not a code change, which is
// exactly what the next fortnight is.
//
// The container already fails closed on an unregistered mission, so an unbuilt
// entry cannot be deployed to by accident. This file's job is to make sure the
// hub knows *why* it cannot, rather than showing a Deploy button that reports a
// missing level after the player has pressed it.
// ---------------------------------------------------------------------------

export const BOSTON_CHAPTER_ID = "boston-1765";

/** What the hub needs to draw one node on the mission map. */
export interface ChapterMissionEntry {
  readonly missionId: string;
  /** Position in the chapter, 1-based. Also the unlock order. */
  readonly ordinal: number;
  readonly title: string;
  /** The historical moment, for the hub's node label. */
  readonly date: string;
  /** Which of the four scenario shapes this mission is. */
  readonly shape:
    | "Handbill Run"
    | "Smuggle the Crate"
    | "Steal the Stamp Shipment"
    | "Clandestine Press";
  /** The duel opponent, named. */
  readonly opponent: string;
  /**
   * False for the thirteen that are declared and not yet built. The hub draws
   * these as forthcoming; the container refuses to deploy to them.
   */
  readonly built: boolean;
}

/**
 * The slate, in order. Dates, shapes and opponents are from the mission slate
 * rather than invented here, so a node the player can see is a node somebody
 * has actually designed.
 */
export const BOSTON_SLATE: readonly ChapterMissionEntry[] = [
  { missionId: M1_MISSION_ID, ordinal: 1, title: "Nailed to the Post", date: "14 August 1765", shape: "Handbill Run", opponent: "The constable at the post", built: true },
  { missionId: "PA.SEA01.CH02.BOSTON.MD02", ordinal: 2, title: "Landed Weight", date: "1765", shape: "Smuggle the Crate", opponent: "The customs collector", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD03", ordinal: 3, title: "The Comptroller's Books", date: "26 August 1765", shape: "Steal the Stamp Shipment", opponent: "The agitator at the fire", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD04", ordinal: 4, title: "Set It Before Morning", date: "October–November 1765", shape: "Clandestine Press", opponent: "The raiding officer", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD05", ordinal: 5, title: "A Journal of the Times", date: "Winter 1768–69", shape: "Clandestine Press", opponent: "The ropewalk soldier", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD06", ordinal: 6, title: "A Short Narrative", date: "5–15 March 1770", shape: "Smuggle the Crate", opponent: "The customs officer at the gangway", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD07", ordinal: 7, title: "Counsel for the Defense", date: "October–December 1770", shape: "Steal the Stamp Shipment", opponent: "The crowd leader on the steps", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD08", ordinal: 8, title: "The Circular", date: "Winter 1772–73", shape: "Handbill Run", opponent: "The gate officer", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD09", ordinal: 9, title: "Twenty Days", date: "28 November–16 December 1773", shape: "Smuggle the Crate", opponent: "The customs officer at the landing", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD10", ordinal: 10, title: "Griffin's Wharf", date: "16 December 1773", shape: "Steal the Stamp Shipment", opponent: "The Company's agent", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD11", ordinal: 11, title: "The Port Is Shut", date: "June–September 1774", shape: "Smuggle the Crate", opponent: "The Neck checkpoint soldier", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD12", ordinal: 12, title: "The Group", date: "1774–75", shape: "Clandestine Press", opponent: "The billeting search officer", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD13", ordinal: 13, title: "The Alarm", date: "18–19 April 1775", shape: "Handbill Run", opponent: "The regulars' officer on the Green", built: false },
  { missionId: "PA.SEA01.CH02.BOSTON.MD14", ordinal: 14, title: "The Lines", date: "1775", shape: "Steal the Stamp Shipment", opponent: "The siege-line officer", built: false },
];

/** Everything wrong with the slate, as sentences. Checked at boot. */
export function bostonSlateDefects(): string[] {
  const defects: string[] = [];
  const ids = new Set<string>();
  BOSTON_SLATE.forEach((entry, index) => {
    if (entry.ordinal !== index + 1) {
      defects.push(`${entry.missionId} is ordinal ${entry.ordinal} at position ${index + 1}`);
    }
    if (ids.has(entry.missionId)) defects.push(`duplicate mission id ${entry.missionId}`);
    ids.add(entry.missionId);
  });
  if (BOSTON_SLATE.length !== 14) {
    defects.push(`the chapter declares ${BOSTON_SLATE.length} missions and should declare 14`);
  }
  return defects;
}

/**
 * Is this mission open to the player?
 *
 * The chain is the slate order and nothing else: mission N unlocks when N-1 has
 * been cleared or permanently failed, because §1.5 advances a player past a
 * mission they have exhausted their three attempts on. An unbuilt mission is
 * never open regardless of progress, which is what keeps the hub honest about
 * the thirteen.
 */
export function missionUnlocked(input: {
  readonly missionId: string;
  readonly resolvedMissionIds: ReadonlySet<string>;
}): boolean {
  const entry = BOSTON_SLATE.find((item) => item.missionId === input.missionId);
  if (!entry || !entry.built) return false;
  if (entry.ordinal === 1) return true;
  const previous = BOSTON_SLATE[entry.ordinal - 2];
  return previous ? input.resolvedMissionIds.has(previous.missionId) : false;
}

/** How the hub should draw a node. */
export type ChapterNodeState = "OPEN" | "LOCKED" | "FORTHCOMING" | "RESOLVED";

export function chapterNodeState(input: {
  readonly missionId: string;
  readonly resolvedMissionIds: ReadonlySet<string>;
}): ChapterNodeState {
  const entry = BOSTON_SLATE.find((item) => item.missionId === input.missionId);
  if (!entry) return "LOCKED";
  if (input.resolvedMissionIds.has(entry.missionId)) return "RESOLVED";
  // Declared and not yet built. Drawn as part of the chapter, never as a
  // Deploy button that fails after the press.
  if (!entry.built) return "FORTHCOMING";
  return missionUnlocked(input) ? "OPEN" : "LOCKED";
}

let installed = false;

/**
 * Registers every built mission in the chapter. Idempotent, so a hot reload
 * cannot end up with two definitions fighting over an id.
 */
export function installBostonChapter(): void {
  if (installed) return;
  const defects = bostonSlateDefects();
  if (defects.length > 0) {
    throw new Error(`boston chapter slate is malformed: ${defects.join("; ")}`);
  }
  registerMission(m1MissionDefinition());
  installed = true;
}

/** For the hub and for tests: which of the fourteen are actually loadable. */
export function builtMissionIds(): string[] {
  const registered = new Set(registeredMissionIds());
  return BOSTON_SLATE.filter((entry) => registered.has(entry.missionId)).map(
    (entry) => entry.missionId,
  );
}
