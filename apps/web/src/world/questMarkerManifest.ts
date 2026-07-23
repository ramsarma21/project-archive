// Explicit per-target objective quest-marker metadata (Interaction-Spec marker
// replacement). Every runtime FREE_ROAM target that can carry a marker has an
// entry here: its semantic KIND, where the imported kit is DRAWN (visualAnchor)
// and where physical ARRIVAL is measured (arrivalAnchor). There is deliberately
// no silent fallback to the authored scene location: an unmapped target renders
// nothing (and warns in dev) rather than dropping a marker on a scene anchor.
//
// arrivalAnchor keeps MARKER_ANCHORS authoritative where that anchor is the
// real place the runtime wants the player to stand; visualAnchor is authored
// independently so the drawn marker sits beside a jamb / by a person's feet /
// at a document's upper corner without moving the arrival trigger.
//
// The STREET (interior-exit) marker is the one dynamic case: its anchors depend
// on which interior the player is standing in, so World3D resolves those at
// runtime from the active room's threshold; this manifest only declares its
// KIND and visual treatment.

import { MARKER_ANCHORS } from "./manifest.js";
import { doorwayForTarget } from "./doorwayContract.js";

export type QuestMarkerKind =
  | "DOOR"
  | "PERSON"
  | "DOCUMENT"
  | "GROUND"
  | "TRAVERSAL"
  | "INTERIOR_EXIT";

export interface QuestMarkerThresholds {
  near: number;
  arrival: number;
}

// Planar-XZ radii, metres. Near = kind-specific "approach prompt" range;
// arrival = physical arrival radius (dwell then FREE_ROAM_GOTO).
export const KIND_THRESHOLDS: Record<QuestMarkerKind, QuestMarkerThresholds> = {
  DOOR: { near: 6, arrival: 1.35 },
  PERSON: { near: 5, arrival: 1.65 },
  DOCUMENT: { near: 4, arrival: 1.25 },
  GROUND: { near: 7, arrival: 1.45 },
  TRAVERSAL: { near: 5, arrival: 1.4 },
  INTERIOR_EXIT: { near: 3.5, arrival: 1.05 },
};

// Base hero scale relative to the asset's authored dimensions.
export const KIND_HERO_SCALE: Record<QuestMarkerKind, number> = {
  DOOR: 0.9,
  PERSON: 0.7,
  DOCUMENT: 0.55,
  GROUND: 1.0,
  TRAVERSAL: 0.65,
  INTERIOR_EXIT: 0.75,
};

// How high the hero body's BASE sits above the visual anchor's ground (metres),
// before distance scaling. GROUND floats just above a flush seal; DOOR sits by
// the jamb around latch height; DOCUMENT rides an upper corner; PERSON/EXIT sit
// low beside feet / the threshold.
export const KIND_HERO_LIFT: Record<QuestMarkerKind, number> = {
  DOOR: 1.42,
  PERSON: 0.12,
  DOCUMENT: 1.66,
  GROUND: 0.12,
  TRAVERSAL: 0.14,
  INTERIOR_EXIT: 0.1,
};

// Only the GROUND kind lays the flat ground seal; every other kind is hero-only.
export const KIND_HAS_SEAL: Record<QuestMarkerKind, boolean> = {
  DOOR: false,
  PERSON: false,
  DOCUMENT: false,
  GROUND: true,
  TRAVERSAL: false,
  INTERIOR_EXIT: true,
};

// Contextual approach text shown once the active marker is inside its near
// radius (distance is hidden at this point). No control glyphs: quest arrival
// is proximity-based, so nothing implies an E/F/Space press here.
export const KIND_NEAR_PROMPT: Record<QuestMarkerKind, string> = {
  DOOR: "Approach the door",
  PERSON: "Approach",
  DOCUMENT: "Move closer to inspect",
  GROUND: "Stand in the marked place",
  TRAVERSAL: "Move closer to the way through",
  INTERIOR_EXIT: "Step outside",
};

export interface QuestMarkerMeta {
  kind: QuestMarkerKind;
  // Human note for QA/handoff: where the marker is anchored in the fiction.
  attachment: string;
  visualAnchor: [number, number, number]; // where the kit is drawn (feet on ground)
  arrivalAnchor: [number, number, number]; // where planar arrival is measured
}

const A = MARKER_ANCHORS;
const doorVisual = (
  targetId: string,
  fallback: [number, number, number],
): [number, number, number] =>
  doorwayForTarget(targetId)?.visualMarkerAnchor ?? fallback;
const doorArrival = (
  targetId: string,
  fallback: [number, number, number],
): [number, number, number] =>
  doorwayForTarget(targetId)?.sensors.exterior ?? fallback;

// Door leaf centres (read once from DoorDirector's audited placements; kept as
// explicit constants here rather than importing a helper so this file stays
// conflict-safe with the pending door-placement work). Visual anchors sit
// beside the jamb, a touch toward the approaching player, never on the leaf.
export const QUEST_MARKERS: Record<string, QuestMarkerMeta> = {
  // ---- Hero doors (hero-only marker beside the jamb) ----
  MERCER_PRESS: {
    kind: "DOOR",
    attachment: "beside Mercer's Press porch door jamb",
    visualAnchor: doorVisual("MERCER_PRESS", [0.55, 0, 10.95]),
    arrivalAnchor: doorArrival("MERCER_PRESS", A.MERCER_PRESS ?? [-0.31, 0, 8.4]),
  },
  MERCER_REPRINT: {
    kind: "DOOR",
    attachment: "beside Mercer's Press porch door jamb",
    visualAnchor: doorVisual("MERCER_REPRINT", [0.55, 0, 10.95]),
    arrivalAnchor: doorArrival("MERCER_REPRINT", A.MERCER_REPRINT ?? [-0.31, 0, 8.4]),
  },
  MERCER_RETURN: {
    kind: "DOOR",
    attachment: "beside Mercer's Press porch door jamb",
    visualAnchor: doorVisual("MERCER_RETURN", [0.55, 0, 10.95]),
    arrivalAnchor: doorArrival("MERCER_RETURN", A.MERCER_RETURN ?? [-0.31, 0, 8.4]),
  },
  THOMAS_CIRCULAR: {
    kind: "DOOR",
    attachment: "beside Thomas Bell's counting-house door jamb",
    visualAnchor: doorVisual("THOMAS_CIRCULAR", [-70.85, 0, -10.66]),
    arrivalAnchor: doorArrival("THOMAS_CIRCULAR", A.THOMAS_CIRCULAR ?? [-70, 0, -9.3]),
  },
  PIKE_PROOF: {
    kind: "DOOR",
    attachment: "beside Pike's office recessed doorway jamb",
    visualAnchor: doorVisual("PIKE_PROOF", [30.9, 0, 13.62]),
    arrivalAnchor: doorArrival("PIKE_PROOF", A.PIKE_PROOF ?? [30, 0, 9.6]),
  },
  PIKE_RETURN: {
    kind: "DOOR",
    attachment: "beside Pike's office recessed doorway jamb",
    visualAnchor: doorVisual("PIKE_RETURN", [30.9, 0, 13.62]),
    arrivalAnchor: doorArrival("PIKE_RETURN", A.PIKE_RETURN ?? [30, 0, 9.6]),
  },
  CUSTOMHOUSE_NOTICE: {
    kind: "DOOR",
    attachment: "beside the Custom House arched doorway jamb",
    visualAnchor: doorVisual("CUSTOMHOUSE_NOTICE", [55.9, 0, 12.6]),
    arrivalAnchor: doorArrival("CUSTOMHOUSE_NOTICE", A.CUSTOMHOUSE_NOTICE ?? [55, 0, 8.5]),
  },

  // ---- People / approaches (hero low beside the figure) ----
  CLARKE_ROUTE: {
    kind: "PERSON",
    attachment: "beside Edward Clarke in his doorway",
    visualAnchor: [-32.7, 0, 9.5],
    arrivalAnchor: A.CLARKE_ROUTE ?? [-32, 0, 8.6],
  },
  CUSTOMS_ROUTE: {
    kind: "PERSON",
    attachment: "beside the customs officer at the checkpoint",
    visualAnchor: [-56.7, 0, -3.3],
    arrivalAnchor: A.CUSTOMS_ROUTE ?? [-56, 0, -2],
  },
  RIDER_POST_ROUTE: {
    kind: "PERSON",
    attachment: "beside the post rider at the town edge",
    visualAnchor: [-96.0, 0, -17.5],
    arrivalAnchor: A.RIDER_POST_ROUTE ?? [-95, 0, -17],
  },

  // ---- Document (hero high off a poster's upper corner) ----
  TOWN_NOTICE_BOARD: {
    kind: "DOCUMENT",
    attachment: "off the notice board's upper corner",
    visualAnchor: [6.72, 0, 8.42],
    arrivalAnchor: A.TOWN_NOTICE_BOARD ?? [6, 0, 7.6],
  },

  // ---- Ground / route / traversal ----
  RIDER_HANDBILLS: {
    kind: "GROUND",
    attachment: "the handbill hand-off spot mid-street",
    visualAnchor: A.RIDER_HANDBILLS ?? [-12, 0, -2],
    arrivalAnchor: A.RIDER_HANDBILLS ?? [-12, 0, -2],
  },
  RIDER_BACK_LANES: {
    kind: "TRAVERSAL",
    attachment: "entry to the north back lanes",
    visualAnchor: A.RIDER_BACK_LANES ?? [-60, 0, -23],
    arrivalAnchor: A.RIDER_BACK_LANES ?? [-60, 0, -23],
  },
  RIDER_DOCK_GATE: {
    kind: "TRAVERSAL",
    attachment: "at the chained dock gate",
    visualAnchor: A.RIDER_DOCK_GATE ?? [-40, 0, 21.2],
    arrivalAnchor: A.RIDER_DOCK_GATE ?? [-40, 0, 21.2],
  },
  THOMAS_STREET: {
    kind: "GROUND",
    attachment: "the street spot outside Thomas Bell's",
    visualAnchor: A.THOMAS_STREET ?? [-70, 0, -7.2],
    arrivalAnchor: A.THOMAS_STREET ?? [-70, 0, -7.2],
  },
  PIKE_STREET: {
    kind: "GROUND",
    attachment: "the street spot outside Pike's office",
    visualAnchor: A.PIKE_STREET ?? [30, 0, 8.0],
    arrivalAnchor: A.PIKE_STREET ?? [30, 0, 8.0],
  },
  CUSTOMHOUSE_STREET: {
    kind: "GROUND",
    attachment: "the street spot outside the Custom House",
    visualAnchor: A.CUSTOMHOUSE_STREET ?? [55, 0, 7.1],
    arrivalAnchor: A.CUSTOMHOUSE_STREET ?? [55, 0, 7.1],
  },
  CROWD: {
    kind: "GROUND",
    attachment: "the gathering spot by the great elm",
    visualAnchor: A.CROWD ?? [89, 0, -19],
    arrivalAnchor: A.CROWD ?? [89, 0, -19],
  },
};

// The interior-exit ("STREET") marker's KIND/treatment; its anchors are
// resolved per active interior at runtime (World3D), never from a scene anchor.
export const INTERIOR_EXIT_KIND: QuestMarkerKind = "INTERIOR_EXIT";

export function questMarkerMeta(targetId: string): QuestMarkerMeta | null {
  return QUEST_MARKERS[targetId] ?? null;
}
