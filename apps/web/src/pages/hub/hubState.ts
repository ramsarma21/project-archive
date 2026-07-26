import { LEVELS_PER_RANK, STARTING_RANK, monotonicRank } from "@pa/contracts";
import type { ProgressionView } from "../../progression/index.js";

// ---------------------------------------------------------------------------
// Hub state.
//
// Everything the hub draws about the player comes from one place: the
// progression snapshot the API returns for the signed-in profile. This file
// projects that snapshot into the shape the panels read, and it computes
// nothing of its own.
//
// Progression model. XP has exactly one payer: completing a mission. Level is
// chapter-scoped and resets when a chapter does. Rank is an integer that never
// resets — it is derived from the Levels earned across every chapter, one step
// per ten, so it is the only figure that records the whole run.
//
// The Rank arithmetic itself is NOT defined here. @pa/contracts owns it
// (rankFromCumulativeLevels, monotonicRank), because the server derives the same
// number when it writes progress; a second copy in the hub is a divergence
// waiting to happen.
//
// There is one difficulty. No bands, no per-mission level, no player-against-
// mission reading, no easing. An operation is as hard as it is.
// ---------------------------------------------------------------------------

export interface HubState {
  runnerName: string;
  /** Chapter-scoped: back to 0 when the next chapter opens. */
  level: number;
  xp: number;
  /** Chapter XP total at which the next Level lands. */
  xpToNext: number;
  /**
   * Cumulative Levels, floored to whatever the held Rank requires.
   *
   * Normally identical to the campaign row's count. It is floored because Rank
   * is monotonic and stored while this number is what a caption derives Rank
   * from, and the two disagreeing would let a reload draw a lower Rank than the
   * player holds. On a Rank-bracketed ladder that is not a cosmetic wobble; it
   * is a different set of opponents.
   */
  cumulativeLevels: number;
  /** The held Rank. Server-stored, monotonic, and never recomputed downward. */
  rank: number;
}

// Only reached with no server projection at all — a signed-out practice runner.
// A signed-in one is told the real threshold by the server, which reads the
// authored curve in @pa/abilities. The two disagree: the authored first Level
// costs far less than this, so the placeholder overstates the climb to anyone
// who sees it. It is a bar-drawing default, not a claim about the curve, and it
// should be replaced by the authored value rather than retuned by eye.
const UNCURVED_XP_TO_NEXT = 1000;

export const NEW_RUNNER_STATE: HubState = {
  runnerName: "Runner",
  level: 0,
  xp: 0,
  xpToNext: UNCURVED_XP_TO_NEXT,
  cumulativeLevels: 0,
  rank: STARTING_RANK,
};

/**
 * The readout, from the server's projection.
 *
 * The one judgement it makes is the Rank floor described on `cumulativeLevels`.
 * Everything else is a copy: Level, XP and the cumulative count are the
 * server's, and this function is deliberately incapable of increasing any of
 * them.
 */
export function hubStateFrom(input: {
  view: ProgressionView;
  runnerName: string;
}): HubState {
  const { view } = input;
  const rank = monotonicRank(view.rank, view.cumulativeLevels);
  return {
    runnerName: input.runnerName,
    level: view.level,
    xp: view.xp,
    xpToNext: view.xp + (view.xpToNextLevel ?? UNCURVED_XP_TO_NEXT),
    cumulativeLevels: Math.max(
      view.cumulativeLevels,
      (rank - STARTING_RANK) * LEVELS_PER_RANK,
    ),
    rank,
  };
}

/** What the topbar says about persistence. Never silently wrong about it. */
export function hubSaveNote(input: {
  unranked: boolean;
  stale: boolean;
  unsyncedOutcomes: number;
}): string {
  if (input.unranked) return "Practice · nothing is saved";
  if (input.unsyncedOutcomes > 0) {
    const plural = input.unsyncedOutcomes === 1 ? "result" : "results";
    return `Offline · ${input.unsyncedOutcomes} ${plural} waiting to sync`;
  }
  if (input.stale) return "Offline · showing your last synced progress";
  return "Progress saved";
}

// ---------------------------------------------------------------------------
// Mission map — structure and visual language only.
//
// Node coordinates live in the MAP_VIEWBOX space below. The SVG connector layer
// and the DOM node buttons consume the same numbers, so the map body must keep
// the viewbox aspect ratio for the two layers to stay registered.
// ---------------------------------------------------------------------------

export const MAP_VIEWBOX = { width: 470, height: 300 } as const;

/**
 * Row band centres in viewbox units. Rows are a layout device — the chapter is
 * one ordered route, not acts — and the route snakes so consecutive operations
 * always sit next to each other.
 */
export const MISSION_ROWS: readonly number[] = [24, 84, 144, 204, 264];

const COLUMNS = [78, 235, 392] as const;

/**
 * How a node reads.
 *
 * SPENT is separate from COMPLETE and the difference is the whole three-attempt
 * rule: a mission whose attempts are gone pays zero forever and cannot be
 * replayed, and the player advances past it anyway. Drawing that as "Complete"
 * would tell a student they succeeded at something they did not.
 */
export type MissionStatus = "COMPLETE" | "SPENT" | "ACTIVE" | "UNLOCKED" | "LOCKED";

/** Node shape carries the operation's kind before any label is read. */
export type MissionKind = "MISSION" | "CAPSTONE";

export interface MissionNode {
  id: string;
  /** Boston's authored name for the operation. */
  title: string;
  /** Position in the slate; the capstone has none. */
  ordinal: number | null;
  /** Index into MISSION_ROWS. Layout only. */
  row: number;
  kind: MissionKind;
  status: MissionStatus;
  x: number;
  y: number;
}

export interface MissionEdge {
  from: string;
  to: string;
}

/**
 * What the map needs from a chapter to draw one node.
 *
 * A structural subset of `ChapterMissionEntry` in ../../chapter/bostonChapter.ts
 * rather than an import of it: that module reaches the level packages, and the
 * hub's state must stay loadable without pulling a mission's geometry in behind
 * it. The caller passes the chapter's own slate.
 */
export interface HubSlateEntry {
  readonly missionId: string;
  readonly ordinal: number;
  readonly title: string;
  /** False for an operation that is declared and not yet built. */
  readonly built: boolean;
}

/** The id of the node that closes the chapter. Not a mission; pays no XP. */
export const CAPSTONE_NODE_ID = "capstone";

/**
 * Boston's fourteen operations, as the hub's default slate.
 *
 * The ids are the chapter's real mission ids, matching `BOSTON_SLATE`, because
 * they are what the mission registry is keyed on: a node carrying a display
 * slug produces a Deploy button that refuses with MISSION_NOT_REGISTERED. One
 * repeated string literal is a cheaper coupling than a package edge from the
 * hub into a level, and `missionNodesFor` takes the real slate anyway.
 */
const BOSTON_TITLES = [
  "Nailed to the Post",
  "Landed Weight",
  "The Comptroller's Books",
  "Set It Before Morning",
  "A Journal of the Times",
  "A Short Narrative",
  "Counsel for the Defense",
  "The Circular",
  "Twenty Days",
  "Griffin's Wharf",
  "The Port Is Shut",
  "The Group",
  "The Alarm",
  "The Lines",
] as const;

export const DEFAULT_HUB_SLATE: readonly HubSlateEntry[] = BOSTON_TITLES.map(
  (title, index): HubSlateEntry => ({
    missionId: `PA.SEA01.CH02.BOSTON.MD${String(index + 1).padStart(2, "0")}`,
    ordinal: index + 1,
    title,
    // Only M1 has a level. The rest are drawn and refuse to launch.
    built: index === 0,
  }),
);

// Serpentine placement: odd rows run right to left, so the route reads as one
// unbroken line and every hand-off between rows is a short vertical hop.
function place(index: number): { row: number; x: number; y: number } {
  const row = Math.floor(index / COLUMNS.length);
  const withinRow = index % COLUMNS.length;
  const column = row % 2 === 0 ? withinRow : COLUMNS.length - 1 - withinRow;
  return { row, x: COLUMNS[column]!, y: MISSION_ROWS[row]! };
}

export interface MissionNodesInput {
  readonly slate: readonly HubSlateEntry[];
  /** The server's projection. Omit for the fresh-runner map. */
  readonly view?: ProgressionView;
  /** The chapter's unlock chain, evaluated against the SERVER's resolved set. */
  readonly isRouteOpen?: (input: {
    missionId: string;
    resolvedMissionIds: ReadonlySet<string>;
  }) => boolean;
}

/**
 * The chapter as nodes, with every status read from durable progression.
 *
 * The route is walked from the missions the SERVER says are resolved, not from
 * anything this browser recorded, which is the point: clearing site data
 * changes what is on screen for one fetch and changes nothing about which
 * operations are open or spent.
 */
export function missionNodesFor(input: MissionNodesInput): MissionNode[] {
  const view = input.view;
  const resolved = view?.resolvedMissionIds ?? new Set<string>();
  const routeOpen =
    input.isRouteOpen ??
    // No chapter route supplied: the first built operation is open and nothing
    // else is. The same shape a fresh runner sees.
    ((probe: { missionId: string }) => probe.missionId === input.slate[0]?.missionId);

  const nodes: MissionNode[] = input.slate.map((entry, index) => {
    const standing = view?.missions.get(entry.missionId);
    const open =
      entry.built &&
      routeOpen({ missionId: entry.missionId, resolvedMissionIds: resolved });
    const status: MissionStatus =
      standing?.outcome === "CLEARED"
        ? "COMPLETE"
        : standing?.spent
          ? "SPENT"
          : view?.openAttempt?.missionId === entry.missionId
            ? "ACTIVE"
            : open
              ? "UNLOCKED"
              : "LOCKED";
    return {
      id: entry.missionId,
      title: entry.title,
      ordinal: entry.ordinal,
      kind: "MISSION",
      status,
      ...place(index),
    };
  });

  // The capstone opens when every operation is resolved — cleared or spent,
  // because §1.5 advances a player past a mission they have exhausted — and
  // closes when it has been passed.
  const everyMissionResolved =
    input.slate.length > 0 &&
    input.slate.every((entry) => resolved.has(entry.missionId));
  nodes.push({
    id: CAPSTONE_NODE_ID,
    title: "Rank Assessment",
    ordinal: null,
    kind: "CAPSTONE",
    status: view?.assessmentPassed
      ? "COMPLETE"
      : everyMissionResolved
        ? "UNLOCKED"
        : "LOCKED",
    ...place(input.slate.length),
  });
  return nodes;
}

/**
 * The fresh-runner map: the fourteen operations and the one capstone that
 * closes the chapter, with only the first operation open.
 */
export const MISSION_NODES: readonly MissionNode[] = missionNodesFor({
  slate: DEFAULT_HUB_SLATE,
});

/** The chapter is a single ordered route, so the chain is derived. */
export function missionEdgesFor(nodes: readonly MissionNode[]): MissionEdge[] {
  return nodes.slice(1).map((node, index) => ({
    from: nodes[index]!.id,
    to: node.id,
  }));
}

export const MISSION_EDGES: readonly MissionEdge[] = missionEdgesFor(MISSION_NODES);

export function missionById(id: string): MissionNode | undefined {
  return MISSION_NODES.find((node) => node.id === id);
}

/** The same lookup against a projected map. */
export function nodeById(
  nodes: readonly MissionNode[],
  id: string | null,
): MissionNode | undefined {
  return id === null ? undefined : nodes.find((node) => node.id === id);
}

const STATUS_LABEL: Record<MissionStatus, string> = {
  COMPLETE: "Complete",
  SPENT: "Spent",
  ACTIVE: "In progress",
  UNLOCKED: "Available",
  LOCKED: "Locked",
};

export function missionStatusLabel(status: MissionStatus): string {
  return STATUS_LABEL[status];
}

const KIND_LABEL: Record<MissionKind, string> = {
  MISSION: "Operation",
  // Named for what it gates, not for what it pays: it opens the next chapter
  // and has no effect on Rank or XP.
  CAPSTONE: "Rank assessment",
};

export function missionKindLabel(kind: MissionKind): string {
  return KIND_LABEL[kind];
}

// The System's word on an operation. Keyed on status alone, so scrubbing across
// the locked half of the map does not retype the same sentence fifteen times.
const STATUS_LINE: Record<MissionStatus, string> = {
  COMPLETE: "Recorded. Nothing here is owed to you twice.",
  SPENT:
    "Three attempts, all spent. It pays nothing now and it never will. You go on regardless.",
  ACTIVE: "You are already inside this one.",
  // Not "Cleared" — that reads as COMPLETE, and this line sits directly under
  // the operation's title on a runner who has never played it.
  UNLOCKED: "Open. The ground is waiting.",
  LOCKED: "Sealed. Finish what stands in front of it.",
};

export function missionLine(status: MissionStatus): string {
  return STATUS_LINE[status];
}
