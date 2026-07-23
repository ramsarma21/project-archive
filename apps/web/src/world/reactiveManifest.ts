import {
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  THREAD_IDS,
  type MicroConceptId,
} from "@pa/contracts";
import type { NamedActorId } from "./actorRoutes.js";

export interface ReactiveActorDefinition {
  id: NamedActorId;
  name: string;
  glb: string;
  height: number;
  micro: MicroConceptId;
  prompt: string;
  line: string;
}

export const REACTIVE_NAMED_CAST: readonly ReactiveActorDefinition[] = [
  {
    id: "abigail",
    name: "Abigail Mercer",
    glb: "abigail-rigged",
    height: 1.65,
    micro: MICRO_CONCEPT_IDS.PRINTERS_ROLE,
    prompt: "Talk to Abigail",
    line: "Mind the wet sheets—and mind your mouth on the street today.",
  },
  {
    id: "thomas",
    name: "Thomas Bell",
    glb: "thomas-rigged",
    height: 1.74,
    micro: MICRO_CONCEPT_IDS.NON_IMPORTATION,
    prompt: "Talk to Thomas",
    line: "It's not the shilling. It's the not being asked.",
  },
  {
    id: "pike",
    name: "Mr. Pike",
    glb: "pike-rigged",
    height: 1.7,
    micro: MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS,
    prompt: "Talk to Pike",
    line: "Come November, half of what I file is worthless without a stamp.",
  },
  {
    id: "clarke",
    name: "Edward Clarke",
    glb: "clarke-rigged",
    height: 1.77,
    micro: MICRO_CONCEPT_IDS.LOYALIST_VIEW,
    prompt: "Talk to Clarke",
    line: "You young ones cheer the mob. You won't cheer where it ends.",
  },
  {
    id: "rider",
    name: "The rider",
    glb: "rider-rigged",
    height: 1.76,
    micro: MICRO_CONCEPT_IDS.NEWS_NETWORKS,
    prompt: "Talk to the rider",
    line: "Bell rings, I ride. Late bundles stay in Boston.",
  },
] as const;

export const THREAD_FIGURES = {
  NED: {
    id: "ned",
    name: "Ned",
    glb: "townsman-rigged",
    height: 1.55,
    tint: "#a99076",
    threadId: THREAD_IDS.NED,
    interiorPosition: [-2.2, 0, 4.2] as const,
    // East edge of the notice-board pocket: still the authored shopfront /
    // notice state, but outside Abigail's higher-priority roam interaction.
    exteriorPosition: [9.2, 0, 7.0] as const,
  },
  SARAH: {
    id: "sarah",
    name: "Goodwife Sarah",
    glb: "goodwife-rigged",
    height: 1.62,
    tint: "#b7a58f",
    threadId: THREAD_IDS.SARAH,
    exteriorPosition: [-50, 0, -6.5] as const,
    interactionPosition: [-50, 0, -4.7] as const,
  },
} as const;

export const SIDE_JOB_ANCHORS = {
  [OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]: {
    thomas: [-70, 0, -9.4] as const,
    keeperLocal: [-7, 0, 1] as const,
    keeperInteractLocal: [-5.2, 0, 1] as const,
  },
  [OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]: {
    dockhand: [-134, 0, 0.5] as const,
    dockhandInteract: [-134, 0, 3.0] as const,
    barrel: [-135.2, 0, 1.1] as const,
    barrelInteract: [-135.2, 0, 3.0] as const,
    gangplank: [-140, 0, 14.2] as const,
    // At the pier end of the gangplank so the prompt is offered while
    // standing ON the plank, not only back on the deck (feel-audit-1 P1-3).
    deckInteract: [-140, 0, 14.6] as const,
    // On the brig's actual deck (hull re-moored at z≈19.6 and seated in the
    // water — feel-audit-1 P0-10: the delivery point used to hover on bare
    // planks nowhere near a ship).
    deck: [-139, 1.35, 18.6] as const,
  },
  // The ropewalk trades job (Act-1-Vertical-Slice §3 activity-family pillar).
  // Local coords inside EXPLORE_ropewalk (34 x 12 hall): the ropemaker works
  // at the laying rig near the west end; the strand walk runs the hall's
  // length to the east hook, then returns to close the lay.
  [OPTIONAL_ACTIVITY_IDS.ROPEWALK]: {
    ropemakerLocal: [-12, 0, 0.6] as const,
    ropemakerInteractLocal: [-10.4, 0, 0.6] as const,
    farHookLocal: [12.5, 0, -0.8] as const,
    farHookInteractLocal: [10.9, 0, -0.8] as const,
    rigCloseLocal: [-11.2, 0, -1.4] as const,
    rigCloseInteractLocal: [-9.6, 0, -1.4] as const,
  },
} as const;

export interface MicroDefinition {
  id: MicroConceptId;
  label: string;
  sourceLinks: readonly string[];
  /**
   * A quotable one-line memory with a place or a person (design1 kill list):
   * the Archive keeps what the street actually said, not database metadata.
   */
  memory: string;
}

// Human-readable chips for the feedback line under an exchange reply: every
// durable effect a choice commits gets named, so options visibly DO things.
export function effectChips(
  effects: {
    standing?: { delta: number };
    micros?: readonly MicroConceptId[];
    threads?: readonly { trustDelta?: number }[];
    routes?: readonly { label: string }[];
    rumors?: readonly string[];
    clockUnits?: number;
    relationships?: readonly { relationshipId: string; delta: number }[];
    activities?: readonly { stage: string }[];
  },
  microLabels: ReadonlyMap<string, string>,
): string[] {
  const chips: string[] = [];
  for (const micro of effects.micros ?? []) {
    // Discovery voice, not flashcard voice (design1 kill list).
    chips.push(`You've connected it: ${microLabels.get(micro) ?? "another piece of the day"}`);
  }
  if (effects.standing) {
    chips.push(
      effects.standing.delta > 0
        ? "Town standing improved"
        : "Town standing slipped",
    );
  }
  for (const thread of effects.threads ?? []) {
    if (thread.trustDelta && thread.trustDelta > 0) chips.push("Trust grows");
    else if (thread.trustDelta && thread.trustDelta < 0) chips.push("Trust slips");
  }
  for (const route of effects.routes ?? []) chips.push(`Route learned: ${route.label}`);
  if ((effects.rumors ?? []).length > 0) chips.push("Rumor logged in the Archive");
  for (const relationship of effects.relationships ?? []) {
    if (relationship.delta !== 0) {
      const name = relationship.relationshipId.split("_")[0]!.toLowerCase();
      chips.push(`${name.charAt(0).toUpperCase()}${name.slice(1)} ${relationship.delta > 0 ? "↑" : "↓"}`);
    }
  }
  const stage = effects.activities?.at(-1)?.stage;
  if (stage === "COMPLETED") chips.push("Job complete");
  else if (stage && stage !== "DORMANT") chips.push("Job updated");
  if (effects.clockUnits) chips.push(`−${effects.clockUnits} hr of daylight`);
  return chips;
}

export const DAY1_MICRO_DEFINITIONS: readonly MicroDefinition[] = [
  { id: MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END, label: "The end of salutary neglect", sourceLinks: ["KN-noticeboard", "NPC-pike", "NPC-thomas"], memory: "The whole street agrees: London used to look away. It has stopped looking away." },
  { id: MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON, label: "Boston as a port town", sourceLinks: ["SJ-dock-haul", "THR-sarah", "NPC-thomas"], memory: "Thomas, at his counting-house: know the wharf and you know half of Boston's troubles." },
  { id: MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY, label: "Hard-coin scarcity", sourceLinks: ["KN-coinpaper", "NPC-pike"], memory: "Pike, over his files: the duty wants specie, and Boston trades in paper promises." },
  { id: MICRO_CONCEPT_IDS.PRINTERS_ROLE, label: "Printers' role", sourceLinks: ["THR-ned", "KN-typecase", "NPC-abigail"], memory: "Abigail, at the press: a printer decides what the town can hear." },
  { id: MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS, label: "Vice-admiralty courts", sourceLinks: ["NPC-pike", "KN-customhouse"], memory: "Pike, at his office: a Crown judge and no local jury. That difference matters." },
  { id: MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS, label: "What the Stamp Act covered", sourceLinks: ["KN-noticeboard", "KN-pike-records"], memory: "The notice by the board: newspapers and legal papers, stamped from the first of November." },
  { id: MICRO_CONCEPT_IDS.ANDREW_OLIVER, label: "Andrew Oliver", sourceLinks: ["KN-effigy"], memory: "The crowd at the elm named him: Oliver, the Crown's man for the stamps." },
  { id: MICRO_CONCEPT_IDS.LIBERTY_TREE, label: "The Liberty Tree", sourceLinks: ["KN-liberty-bill"], memory: "The old elm past the east gate: the town's notices hang from it now, and tonight, more than notices." },
  { id: MICRO_CONCEPT_IDS.LOYAL_NINE, label: "The Loyal Nine", sourceLinks: ["SJ-tavern-note"], memory: "Ned, half-whispering by the press: the men at the elm use printers' boys as runners too." },
  { id: MICRO_CONCEPT_IDS.EFFIGY_PROTEST, label: "Effigy protest", sourceLinks: ["KN-liberty-bill"], memory: "At the elm: somebody planned every step of it, and nobody waited for permission." },
  { id: MICRO_CONCEPT_IDS.NON_IMPORTATION, label: "Non-importation", sourceLinks: ["THR-sarah", "SJ-tavern-note", "NPC-thomas"], memory: "Sarah, at her stall: half the trade gone since the duties." },
  { id: MICRO_CONCEPT_IDS.NEWS_NETWORKS, label: "News networks", sourceLinks: ["NPC-rider", "NPC-abigail"], memory: "The rider, reins in hand: press to tavern, tavern to saddle, then every road out of Boston." },
  { id: MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE, label: "Writs of assistance", sourceLinks: ["KN-customhouse", "B9-inspection"], memory: "On the customs road: a writ that names no one, expires never, and opens any bag." },
  { id: MICRO_CONCEPT_IDS.LOYALIST_VIEW, label: "The Loyalist view", sourceLinks: ["NPC-clarke"], memory: "Clarke, from his doorway: the Crown feeds this town, and a crowd with a rope is not liberty." },
] as const;

export const MICRO_LABELS: ReadonlyMap<string, string> = new Map(
  DAY1_MICRO_DEFINITIONS.map((definition) => [definition.id, definition.label]),
);

export const INTERIOR_HOTSPOT_MICROS: Readonly<
  Record<string, readonly MicroConceptId[]>
> = {
  "mercer-press": [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
  "mercer-type": [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
  "thomas-ledger": [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  "pike-records": [
    MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS,
    MICRO_CONCEPT_IDS.VICE_ADMIRALTY_COURTS,
  ],
  "custom-counter": [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
  "custom-posting": [MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END],
  "tavern-news": [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
};
