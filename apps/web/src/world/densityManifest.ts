// Imported exterior-density layout for the 1765 Boston district.
//
// Visible geometry referenced here is deployed under /world/props. Runtime
// code may instance/transform these GLBs, but must never synthesize a visible
// physical stand-in. All placement ids are stable collision/content hooks.

export type DensitySector =
  | "WHARF"
  | "WEST"
  | "MID"
  | "EAST"
  | "LIBERTY"
  | "NORTH_ENVELOPE_WEST"
  | "NORTH_ENVELOPE_MID"
  | "NORTH_ENVELOPE_EAST"
  | "SOUTH_ENVELOPE_WEST"
  | "SOUTH_ENVELOPE_MID"
  | "SOUTH_ENVELOPE_EAST";

export interface DensityPlacement {
  id: string;
  sector: DensitySector;
  glb: string;
  pos: [number, number, number];
  rotY: number;
  // Uniform-fit target. Values preserve each source asset's measured aspect
  // ratio; they are not permission to non-uniformly distort production props.
  size: [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
  originMode?: "CENTER_GROUND" | "SOURCE";
  tags: string[];
}

export interface FrontageSegment {
  id: string;
  row: "NORTH" | "SOUTH" | "WHARF_NORTH";
  minX: number;
  maxX: number;
  authoredOpenings: [number, number][];
}

export type ReservedVolume =
  | {
      id: string;
      kind: "CIRCLE";
      center: [number, number];
      radius: number;
      tags: string[];
    }
  | {
      id: string;
      kind: "RECT";
      center: [number, number];
      half: [number, number];
      tags: string[];
    };

export interface ActivityZone {
  id: string;
  role:
    | "DOCK_WORK"
    | "LIVERY"
    | "MARKET"
    | "WORKSHOP"
    | "STREET_SOCIAL"
    | "CIVIC"
    | "CHURCHYARD"
    | "ALLEY_SERVICE"
    | "LIBERTY";
  center: [number, number];
  half: [number, number];
  facing: number;
  capacity: number;
  clearLane?: { axis: "X" | "Z"; center: number; halfWidth: number };
}

export type TraversalAffordanceType =
  | "CLIMB_UP"
  | "CLIMB_DOWN"
  | "VAULT"
  | "DUCK_UNDER"
  | "JUMP_GAP"
  | "MANTLE"
  | "BALANCE"
  | "PUSH"
  | "SQUEEZE"
  | "FLAVOR";

export interface TraversalAffordance {
  id: string;
  placementId: string;
  type: TraversalAffordanceType;
  interactionRadius: number;
  approach: [number, number];
  minApproachDot: number;
  start: { pos: [number, number, number]; facing: number };
  end: { pos: [number, number, number]; facing: number };
  surfaceHeight: number;
  clearance: {
    radius: number;
    height: number;
    pathHalfWidth: number;
  };
  landing: {
    center: [number, number, number];
    radius: number;
    standingHeight: number;
  };
  animation: { forward: string; reverse?: string };
  bidirectional: boolean;
  routeGate?: "THOMAS_DOCK_ROUTE";
  storyGate?: string;
  cooldownMs: number;
  tags: string[];
}

const LEAN_TO: [number, number, number] = [5.77, 4.4, 3.5];
const SERVICE_SHED: [number, number, number] = [2, 3.8, 1.62];
const PASSAGE_GATE: [number, number, number] = [4.4, 4.2, 1.98];
const SERVICE_WALL: [number, number, number] = [7.5, 3.4, 1.67];
const YARD_FENCE: [number, number, number] = [4, 2.06, 0.33];
const GATE_WING: [number, number, number] = [4.5, 2.71, 0.55];
const WHARF_RAIL: [number, number, number] = [5, 1.43, 0.59];
const WORK_LADDER: [number, number, number] = [1.15, 2.8, 1.68];
const BALANCE_PLANK: [number, number, number] = [3.6, 0.7, 0.99];
const DUCK_FRAME: [number, number, number] = [2.52, 1.55, 0.88];

function placement(
  id: string,
  sector: DensitySector,
  glb: string,
  pos: [number, number, number],
  rotY: number,
  size: [number, number, number],
  tags: string[],
  options: Pick<
    DensityPlacement,
    "castShadow" | "receiveShadow" | "originMode"
  > = {},
): DensityPlacement {
  return {
    id,
    sector,
    glb,
    pos,
    rotY,
    size,
    tags,
    ...options,
  };
}

export const FRONTAGE_SEGMENTS: FrontageSegment[] = [
  {
    id: "frontage-wharf-north",
    row: "WHARF_NORTH",
    minX: -160,
    maxX: -118,
    authoredOpenings: [],
  },
  {
    id: "frontage-street-north",
    row: "NORTH",
    minX: -90,
    maxX: 80,
    authoredOpenings: [
      [-12, -9],
      [16, 19],
      [61.5, 65],
      [78, 80],
    ],
  },
  {
    id: "frontage-street-south",
    row: "SOUTH",
    minX: -114,
    maxX: 80,
    authoredOpenings: [
      [-92, -89.5],
      [-14, -11],
      [16, 19],
      [71, 73],
    ],
  },
];

// Door/marker/camera reservations are data, not visible blockers. Density
// placement is authored around them; later collision tooling can consume them.
export const RESERVED_GAMEPLAY_VOLUMES: ReservedVolume[] = [
  { id: "reserve-mercer-door", kind: "RECT", center: [0, 8.8], half: [1, 2.2], tags: ["door", "marker", "camera"] },
  { id: "reserve-thomas-door", kind: "RECT", center: [-70, -9.1], half: [1, 2.2], tags: ["door", "marker", "camera"] },
  { id: "reserve-pike-door", kind: "RECT", center: [30, 9.2], half: [1, 2.2], tags: ["door", "marker", "camera"] },
  { id: "reserve-custom-house-door", kind: "RECT", center: [55, 8.4], half: [1.2, 2.5], tags: ["door", "marker", "camera"] },
  { id: "reserve-clarke", kind: "CIRCLE", center: [-32, 8.6], radius: 2.4, tags: ["marker", "camera", "actor"] },
  { id: "reserve-rider", kind: "RECT", center: [-95.8, -17.6], half: [3.2, 3], tags: ["marker", "camera", "actor"] },
  { id: "reserve-customs-post", kind: "CIRCLE", center: [-56, -2], radius: 2.4, tags: ["marker", "camera", "actor"] },
  { id: "reserve-town-notice", kind: "CIRCLE", center: [6, 7.6], radius: 2.4, tags: ["marker", "read"] },
  { id: "reserve-town-house-event-floor", kind: "RECT", center: [53.5, 0], half: [8.5, 8], tags: ["event", "camera", "npc-path"] },
  { id: "reserve-brig-apron", kind: "RECT", center: [-137, 11.5], half: [8, 2.5], tags: ["wharf", "boarding", "npc-path"] },
  { id: "reserve-liberty-event", kind: "RECT", center: [91.5, -20.5], half: [7, 6], tags: ["event", "camera", "crowd"] },
  { id: "reserve-liberty-march-exit", kind: "RECT", center: [105, -25.5], half: [9, 3], tags: ["event", "march", "camera"] },
  { id: "reserve-central-carriageway", kind: "RECT", center: [-19, 0], half: [99, 3.75], tags: ["player-path", "npc-path", "carriageway"] },
  { id: "reserve-north-alley-lane", kind: "RECT", center: [-19, -23.25], half: [99, 1.1], tags: ["player-path", "npc-path", "alley"] },
  { id: "reserve-south-alley-lane", kind: "RECT", center: [20, 23.25], half: [60, 1.1], tags: ["player-path", "npc-path", "alley"] },
];

export const ACTIVITY_ZONES: ActivityZone[] = [
  { id: "activity-wharf-west", role: "DOCK_WORK", center: [-151, 3], half: [6, 5], facing: 0.2, capacity: 5, clearLane: { axis: "Z", center: -4, halfWidth: 1.2 } },
  { id: "activity-wharf-east", role: "DOCK_WORK", center: [-125, 1], half: [5, 5], facing: -0.4, capacity: 4, clearLane: { axis: "Z", center: -4, halfWidth: 1.2 } },
  { id: "activity-rider-livery", role: "LIVERY", center: [-104, -19], half: [7, 5], facing: 1.2, capacity: 5 },
  { id: "activity-market", role: "MARKET", center: [-51, -6], half: [9, 3], facing: 0, capacity: 9, clearLane: { axis: "X", center: -51, halfWidth: 2.2 } },
  { id: "activity-west-loading", role: "WORKSHOP", center: [-78, 7], half: [11, 2.5], facing: Math.PI, capacity: 6 },
  { id: "activity-town-heart", role: "STREET_SOCIAL", center: [-8, 7], half: [16, 2], facing: Math.PI, capacity: 8 },
  { id: "activity-civic", role: "CIVIC", center: [53.5, 5.5], half: [9, 2], facing: Math.PI, capacity: 7 },
  { id: "activity-churchyard", role: "CHURCHYARD", center: [67, -16], half: [7, 4], facing: -Math.PI / 2, capacity: 5 },
  { id: "activity-north-alley-west", role: "ALLEY_SERVICE", center: [-69, -24.8], half: [22, 1.2], facing: 0, capacity: 6, clearLane: { axis: "X", center: -69, halfWidth: 1.1 } },
  { id: "activity-north-alley-east", role: "ALLEY_SERVICE", center: [28, -24.8], half: [30, 1.2], facing: 0, capacity: 7, clearLane: { axis: "X", center: 28, halfWidth: 1.1 } },
  { id: "activity-south-alley", role: "ALLEY_SERVICE", center: [20, 24.8], half: [55, 1.2], facing: Math.PI, capacity: 8, clearLane: { axis: "X", center: 20, halfWidth: 1.1 } },
  { id: "activity-liberty-approach", role: "LIBERTY", center: [85, -8], half: [5, 5], facing: 2.2, capacity: 5 },
];

const FRONTAGE_PLACEMENTS: DensityPlacement[] = [
  // Wharf warehouse row: close the visual holes without changing the three
  // authored warehouses or their doors.
  placement("frontage-wharf-lean-a", "WHARF", "infill-lean-to", [-146.1, 0, -15], 0, LEAN_TO, ["frontage", "wharf", "infill"]),
  placement("frontage-wharf-lean-b", "WHARF", "infill-lean-to", [-133.1, 0, -15], 0, LEAN_TO, ["frontage", "wharf", "infill"]),

  // North street row. Authored cuts remain untouched.
  placement("frontage-north-shed-01", "WEST", "infill-service-shed", [-83.4, 0, -15], 0, SERVICE_SHED, ["frontage", "infill"]),
  placement("frontage-north-lean-01", "MID", "infill-lean-to", [1.1, 0, -15], 0, LEAN_TO, ["frontage", "infill"]),
  placement("frontage-north-shed-02", "MID", "infill-service-shed", [10.2, 0, -15], 0, SERVICE_SHED, ["frontage", "worksite"]),
  placement("frontage-north-shed-03", "MID", "infill-service-shed", [20.2, 0, -15], 0, SERVICE_SHED, ["frontage", "infill"]),
  placement("frontage-north-shed-04", "EAST", "infill-service-shed", [47.2, 0, -15.2], 0, SERVICE_SHED, ["frontage", "civic"]),
  placement("frontage-north-shed-05", "EAST", "infill-service-shed", [60.1, 0, -15.5], 0, SERVICE_SHED, ["frontage", "churchyard"]),
  placement("frontage-north-shed-06", "EAST", "infill-service-shed", [66.2, 0, -16], 0, SERVICE_SHED, ["frontage", "churchyard"]),

  // South west row: the existing ropewalk/warehouse GLBs are visually much
  // narrower than their collision slots, so reuse imported warehouse modules.
  placement("frontage-south-warehouse-01", "WEST", "bldg-warehouse-street", [-110, 0, 15], Math.PI, [5, 4.59, 9.59], ["frontage", "warehouse"]),
  placement("frontage-south-warehouse-02", "WEST", "bldg-warehouse-street", [-96.1, 0, 15], Math.PI, [5, 4.59, 9.59], ["frontage", "warehouse"]),
  placement("frontage-south-lean-01", "WEST", "infill-lean-to", [-79.7, 0, 15], Math.PI, LEAN_TO, ["frontage", "infill"]),
  placement("frontage-south-lean-02", "WEST", "infill-lean-to", [-68.4, 0, 15], Math.PI, LEAN_TO, ["frontage", "infill"]),
  placement("frontage-south-lean-03", "WEST", "infill-lean-to", [-56.5, 0, 15], Math.PI, LEAN_TO, ["frontage", "infill"]),
  placement("frontage-south-shed-01", "WEST", "infill-service-shed", [-45.3, 0, 15], Math.PI, SERVICE_SHED, ["frontage", "market"]),

];

const SHOULDER_AND_DISTRICT_DRESSING: DensityPlacement[] = [
  // Occupied shoulders keep the central |z|<=3.75 carriageway open.
  placement("shoulder-west-north-cart", "WEST", "hand-cart", [-106, 0, -7], 0.45, [2.4, 1.8, 1.6], ["shoulder", "loading"]),
  placement("shoulder-west-north-barrels", "WEST", "barrel-group", [-96, 0, -8], -0.2, [2, 1.5, 1.5], ["shoulder", "loading"]),
  placement("shoulder-west-north-hitch", "WEST", "hitching-post", [-82, 0, -8.6], 0, [1.2, 1.1, 1.2], ["shoulder", "hitching"]),
  placement("shoulder-west-north-crates", "WEST", "crate-stack", [-63, 0, -7.6], 0.35, [2, 1.7, 1.7], ["shoulder", "loading"]),
  placement("shoulder-mid-north-wood", "MID", "firewood-stack", [-36, 0, -8.7], 0.1, [2.2, 1.2, 1], ["shoulder", "workshop"]),
  placement("shoulder-mid-north-cart", "MID", "hand-cart", [-25, 0, -6.6], -0.6, [2.4, 1.8, 1.6], ["shoulder", "loading"]),
  placement("shoulder-mid-north-barrels", "MID", "barrel-group", [-2, 0, -8.7], 0.7, [2, 1.5, 1.5], ["shoulder", "tavern"]),
  placement("shoulder-mid-north-crates", "MID", "crate-stack", [20, 0, -8.2], -0.25, [2, 1.7, 1.7], ["shoulder", "worksite"]),
  placement("shoulder-east-north-barrels", "EAST", "barrel-group", [39, 0, -8.6], 0.2, [2, 1.5, 1.5], ["shoulder", "civic"]),

  placement("shoulder-west-south-crates", "WEST", "crate-stack", [-108, 0, 7.5], -0.2, [2, 1.7, 1.7], ["shoulder", "loading"]),
  placement("shoulder-west-south-barrels", "WEST", "barrel-group", [-90, 0, 8.6], 0.8, [2, 1.5, 1.5], ["shoulder", "loading"]),
  placement("shoulder-west-south-cart", "WEST", "hand-cart", [-78, 0, 6.8], 2.3, [2.4, 1.8, 1.6], ["shoulder", "loading"]),
  placement("shoulder-west-south-wood", "WEST", "firewood-stack", [-60, 0, 8.7], -0.1, [2.2, 1.2, 1], ["shoulder", "workshop"]),
  placement("shoulder-mid-south-cart", "MID", "hand-cart", [-14, 0, 6.5], 2.1, [2.4, 1.8, 1.6], ["shoulder", "town-heart"]),
  placement("shoulder-mid-south-hitch", "MID", "hitching-post", [15, 0, 8.4], Math.PI, [1.2, 1.1, 1.2], ["shoulder", "hitching"]),
  placement("shoulder-east-south-crates", "EAST", "crate-stack", [42, 0, 8.1], 0.35, [2, 1.7, 1.7], ["shoulder", "civic"]),
  placement("shoulder-east-south-barrels", "EAST", "barrel-group", [68, 0, 8.5], -0.5, [2, 1.5, 1.5], ["shoulder", "church"]),

  // Inner shoulder edge: parked/loading objects establish the perceived
  // 7.5m carriageway without covering the imported road or blocking it.
  placement("encroach-west-north-hay", "WEST", "hay-cart", [-89, 0, -5.4], 0.25, [3.4, 2.2, 2.2], ["shoulder", "encroachment", "loading"]),
  placement("encroach-west-north-cart", "WEST", "hand-cart", [-73, 0, -5.5], -0.45, [2.4, 1.8, 1.6], ["shoulder", "encroachment", "loading"]),
  placement("encroach-market-north-stall", "WEST", "market-awning", [-41, 0, -5.7], 0.15, [3.2, 2.6, 2.4], ["shoulder", "encroachment", "market"]),
  placement("encroach-mid-north-barrels", "MID", "barrel-group", [-18, 0, -5.4], 0.5, [2, 1.5, 1.5], ["shoulder", "encroachment", "tavern"]),
  placement("encroach-mid-north-cart", "MID", "hand-cart", [33, 0, -5.5], -0.3, [2.4, 1.8, 1.6], ["shoulder", "encroachment", "civic"]),
  placement("encroach-east-north-crates", "EAST", "crate-stack", [61, 0, -5.4], 0.25, [2, 1.7, 1.7], ["shoulder", "encroachment", "church"]),
  placement("encroach-west-south-barrels", "WEST", "barrel-group", [-101, 0, 5.4], -0.2, [2, 1.5, 1.5], ["shoulder", "encroachment", "loading"]),
  placement("encroach-west-south-crates", "WEST", "crate-stack", [-70, 0, 5.4], 0.45, [2, 1.7, 1.7], ["shoulder", "encroachment", "loading"]),
  placement("encroach-market-south-cart", "WEST", "hand-cart", [-50, 0, 5.5], 2.2, [2.4, 1.8, 1.6], ["shoulder", "encroachment", "market"]),
  placement("encroach-mid-south-cart", "MID", "hand-cart", [9, 0, 5.4], 2.4, [2.4, 1.8, 1.6], ["shoulder", "encroachment", "town-heart"]),
  placement("encroach-mid-south-barrels", "MID", "barrel-group", [24, 0, 5.4], 0.3, [2, 1.5, 1.5], ["shoulder", "encroachment", "worksite"]),
  placement("encroach-east-south-crates", "EAST", "crate-stack", [63, 0, 5.4], -0.4, [2, 1.7, 1.7], ["shoulder", "encroachment", "civic"]),

  // Rider/livery pocket dressing stays outside the reserved story rectangle.
  placement("rider-service-shed-west", "WEST", "infill-service-shed", [-113.5, 0, -15.5], Math.PI / 2, SERVICE_SHED, ["rider", "livery"]),
  placement("rider-service-shed-east", "WEST", "infill-service-shed", [-101.5, 0, -24.8], 0, SERVICE_SHED, ["rider", "livery"]),
  placement("rider-hitch-west", "WEST", "hitching-post", [-110.2, 0, -19.5], Math.PI / 2, [1.2, 1.1, 1.2], ["rider", "hitching"]),
  placement("rider-woodpile", "WEST", "firewood-stack", [-103, 0, -25], 0, [2.2, 1.2, 1], ["rider", "livery"]),

  // Extra wharf work bays avoid the clear brig apron.
  placement("wharf-cargo-west-crates", "WHARF", "crate-stack", [-154, 0, -4], 0.4, [2.4, 2, 2], ["wharf", "cargo"]),
  placement("wharf-cargo-west-barrels", "WHARF", "barrel-group", [-150, 0, -8], -0.2, [2.2, 1.6, 1.6], ["wharf", "cargo"]),
  placement("wharf-cargo-mid-net", "WHARF", "cargo-net-bundle", [-142, 0, -5], 0.6, [1.8, 1.4, 1.8], ["wharf", "cargo"]),
  placement("wharf-cargo-east-crates", "WHARF", "crate-stack", [-128, 0, -1.5], -0.3, [2.4, 2, 2], ["wharf", "cargo"]),
  placement("wharf-cargo-east-rope", "WHARF", "rope-coil-large", [-121.5, 0, 6.5], 0, [1.4, 0.6, 1.4], ["wharf", "rope-work"]),
];

const SERVICE_BOUNDARIES: DensityPlacement[] = [
  // Intermittent imported backlot walls backed immediately by grounded city
  // blocks. The visual rhythm replaces the two giant procedural slabs.
  ...Array.from({ length: 20 }, (_, index) =>
    placement(
      `north-service-wall-${index}`,
      index < 7 ? "NORTH_ENVELOPE_WEST" : index < 14 ? "NORTH_ENVELOPE_MID" : "NORTH_ENVELOPE_EAST",
      index % 3 === 1 ? "yard-fence-straight" : "service-wall-straight",
      [-114 + index * 10, 0, -26.65],
      0,
      index % 3 === 1 ? YARD_FENCE : SERVICE_WALL,
      ["boundary", "north-alley", index % 3 === 1 ? "yard-fence" : "service-wall"],
      { castShadow: false },
    ),
  ),
  ...Array.from({ length: 12 }, (_, index) =>
    placement(
      `south-service-wall-${index}`,
      index < 4 ? "SOUTH_ENVELOPE_WEST" : index < 8 ? "SOUTH_ENVELOPE_MID" : "SOUTH_ENVELOPE_EAST",
      index % 3 === 1 ? "yard-fence-straight" : "service-wall-straight",
      [-36 + index * 10, 0, 26.65],
      0,
      index % 3 === 1 ? YARD_FENCE : SERVICE_WALL,
      ["boundary", "south-alley", index % 3 === 1 ? "yard-fence" : "service-wall"],
      { castShadow: false },
    ),
  ),

  // Wharf warehouse backlot and rider seal.
  ...Array.from({ length: 10 }, (_, index) =>
    placement(
      `wharf-backlot-fence-${index}`,
      "WHARF",
      "yard-fence-straight",
      [-157.8 + index * 4.35, 0, -20.5],
      0,
      YARD_FENCE,
      ["boundary", "wharf-backlot", "fence"],
    ),
  ),
  placement("rider-pocket-fence-end", "WEST", "yard-fence-end", [-118, 0, -23.5], Math.PI / 2, [3.55, 4.06, 0.78], ["boundary", "rider", "fence"]),

  // Wharf rails: boardwalk waterside, apron west edge, and split south edge.
  ...Array.from({ length: 14 }, (_, index) =>
    placement(
      `boardwalk-rope-rail-${index}`,
      index < 7 ? "WHARF" : "WEST",
      "wharf-rope-rail-straight",
      [-111.5 + index * 5.25, 0, 26.4],
      0,
      WHARF_RAIL,
      ["boundary", "wharf", "rope-rail"],
    ),
  ),
  ...Array.from({ length: 7 }, (_, index) =>
    placement(
      `wharf-west-rope-rail-${index}`,
      "WHARF",
      "wharf-rope-rail-straight",
      [-160, 0, -17 + index * 5],
      Math.PI / 2,
      WHARF_RAIL,
      ["boundary", "wharf", "rope-rail"],
    ),
  ),
  ...[-157.5, -152.5, -147.5, -132.5, -127.5, -122.5].map((x, index) =>
    placement(
      `wharf-south-rope-rail-${index}`,
      "WHARF",
      "wharf-rope-rail-straight",
      [x, 0, 14.1],
      0,
      WHARF_RAIL,
      ["boundary", "wharf", "rope-rail", index < 3 ? "west-of-gangplank" : "east-of-gangplank"],
    ),
  ),

  // Imported gate wings; the gate arch remains the existing town-gate GLB.
  ...[-118, 80].flatMap((x, gateIndex) =>
    [-1, 1].flatMap((side) =>
      Array.from({ length: gateIndex === 0 ? 3 : 4 }, (_, index) =>
        placement(
          `${gateIndex === 0 ? "wharf" : "east"}-gate-wing-${side < 0 ? "n" : "s"}-${index}`,
          gateIndex === 0 ? "WEST" : "EAST",
          "town-gate-wing-straight",
          [x, 0, side * ((gateIndex === 0 ? 6.9 : 5.9) + index * 4.45)],
          Math.PI / 2,
          GATE_WING,
          ["gate-wing", gateIndex === 0 ? "wharf-gate" : "east-gate"],
        ),
      ),
    ),
  ),

  // Liberty pocket land-facing enclosure. Nothing is placed west/southwest in
  // open harbor space.
  ...Array.from({ length: 7 }, (_, index) =>
    placement(
      `liberty-north-fence-${index}`,
      "LIBERTY",
      "yard-fence-straight",
      [82.5 + index * 4, 0, -29.15],
      0,
      YARD_FENCE,
      ["boundary", "liberty", "fence"],
    ),
  ),
  ...Array.from({ length: 7 }, (_, index) =>
    placement(
      `liberty-south-fence-${index}`,
      "LIBERTY",
      "yard-fence-straight",
      [82.5 + index * 4, 0, 28.2],
      0,
      YARD_FENCE,
      ["boundary", "liberty", "fence"],
    ),
  ),
  // East boundary is deliberately split: openings remain at the Liberty
  // march lane (z≈-25) and road-to-the-Neck sightline (z≈0).
  ...[2, 3, 4, 7, 8, 9, 10, 11].map((index) =>
    placement(
      `liberty-east-fence-${index}`,
      "LIBERTY",
      "yard-fence-straight",
      [106.7, 0, -26 + index * 4.7],
      Math.PI / 2,
      YARD_FENCE,
      ["boundary", "liberty", "fence"],
    ),
  ),
];

const CITY_BLOCK_SIZES: Record<string, [number, number, number]> = {
  "city-block-rear-a": [14.93, 8.5, 6.23],
  "city-block-rear-b": [15.46, 9, 8.45],
  "city-block-rear-c": [12.97, 9, 13.04],
};
const CITY_VARIANTS = ["city-block-rear-a", "city-block-rear-b", "city-block-rear-c"] as const;

const CITY_ENVELOPE: DensityPlacement[] = [
  // Grounded wharf-land backing. The west side beyond x=-160 and all water
  // south of the wharf remain open.
  ...[-152, -137, -122].map((x, index) => {
    const glb = CITY_VARIANTS[index % CITY_VARIANTS.length]!;
    return placement(
      `city-wharf-north-${index}`,
      "WHARF",
      glb,
      [x, 0, -32.5],
      index % 2 ? Math.PI : 0,
      CITY_BLOCK_SIZES[glb]!,
      ["city-envelope", "land", "wharf-backlot"],
      { castShadow: false },
    );
  }),
  // Full north land border.
  ...Array.from({ length: 15 }, (_, index) => {
    const x = -110 + index * 15;
    const glb = CITY_VARIANTS[index % CITY_VARIANTS.length]!;
    const sector: DensitySector =
      index < 5 ? "NORTH_ENVELOPE_WEST" : index < 10 ? "NORTH_ENVELOPE_MID" : "NORTH_ENVELOPE_EAST";
    return placement(
      `city-north-${index}`,
      sector,
      glb,
      [x, 0, -37],
      index % 2 ? Math.PI : 0,
      CITY_BLOCK_SIZES[glb]!,
      ["city-envelope", "land", "north"],
      { castShadow: false },
    );
  }),
  // South is land only east of x=-40. No modules enter southwest water.
  ...Array.from({ length: 9 }, (_, index) => {
    const x = -32 + index * 16;
    const glb = CITY_VARIANTS[(index + 1) % CITY_VARIANTS.length]!;
    const sector: DensitySector =
      index < 3 ? "SOUTH_ENVELOPE_WEST" : index < 6 ? "SOUTH_ENVELOPE_MID" : "SOUTH_ENVELOPE_EAST";
    return placement(
      `city-south-${index}`,
      sector,
      glb,
      [x, 0, 37],
      index % 2 ? 0 : Math.PI,
      CITY_BLOCK_SIZES[glb]!,
      ["city-envelope", "land", "south"],
      { castShadow: false },
    );
  }),
  // East road-to-the-Neck cap: two flanking blocks, never across the road or
  // Liberty march corridor.
  placement("city-east-north", "NORTH_ENVELOPE_EAST", "city-block-rear-a", [116, 0, -10], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-a"]!, ["city-envelope", "land", "east"], { castShadow: false }),
  placement("city-east-south", "SOUTH_ENVELOPE_EAST", "city-block-rear-b", [116, 0, 14], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-b"]!, ["city-envelope", "land", "east"], { castShadow: false }),
  // Liberty march canyon: grounded blocks flank (never cross) the 7m-wide
  // corridor z=-28.5..-21.5, eliminating the naked land horizon while
  // preserving the authored march toward x=113 and beyond.
  placement("city-march-north-near", "NORTH_ENVELOPE_EAST", "city-block-rear-a", [116, 0, -36], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-a"]!, ["city-envelope", "land", "east", "march-flank"], { castShadow: false }),
  placement("city-march-north-far", "NORTH_ENVELOPE_EAST", "city-block-rear-b", [136, 0, -36], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-b"]!, ["city-envelope", "land", "east", "march-flank"], { castShadow: false }),
  placement("city-march-south-far", "NORTH_ENVELOPE_EAST", "city-block-rear-b", [136, 0, -14], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-b"]!, ["city-envelope", "land", "east", "march-flank"], { castShadow: false }),
  // Distant visual cap beyond every reachable/event endpoint. It closes the
  // land horizon but sits ~37m past CROWD_MARCH_FAR and outside WORLD_BOUNDS.
  placement("city-march-distant-cap", "NORTH_ENVELOPE_EAST", "city-block-rear-a", [150, 0, -25], Math.PI / 2, CITY_BLOCK_SIZES["city-block-rear-a"]!, ["city-envelope", "land", "east", "march-horizon"], { castShadow: false }),
];

const ALLEY_AND_TRAVERSAL_PROPS: DensityPlacement[] = [
  // North alley service rhythm. Frames leave side bypasses inside the 6.5m
  // alley, while the reserved 2.2m route lane remains readable.
  placement("traversal-north-duck-west", "WEST", "duck-beam-frame", [-82, 0, -23.25], Math.PI / 2, DUCK_FRAME, ["traversal", "duck", "north-alley"]),
  placement("traversal-north-balance-west", "WEST", "balance-plank", [-56, 0, -24.6], 0, BALANCE_PLANK, ["traversal", "balance", "north-alley"]),
  placement("traversal-north-ladder-west", "WEST", "work-ladder", [-40, 0, -25], 0.15, WORK_LADDER, ["traversal", "climb", "north-alley"]),
  placement("traversal-north-duck-mid", "MID", "duck-beam-frame", [-25, 0, -23.25], Math.PI / 2, DUCK_FRAME, ["traversal", "duck", "north-alley"]),
  placement("traversal-north-balance-mid", "MID", "balance-plank", [-2, 0, -24.6], 0, BALANCE_PLANK, ["traversal", "balance", "north-alley"]),
  placement("traversal-north-ladder-mid", "MID", "work-ladder", [24, 0, -25], -0.2, WORK_LADDER, ["traversal", "climb", "north-alley"]),
  placement("traversal-north-duck-east", "EAST", "duck-beam-frame", [44, 0, -23.25], Math.PI / 2, DUCK_FRAME, ["traversal", "duck", "north-alley"]),
  placement("traversal-north-balance-east", "EAST", "balance-plank", [62, 0, -24.6], 0, BALANCE_PLANK, ["traversal", "balance", "north-alley"]),

  // South alley/service boardwalk.
  placement("traversal-south-ladder-west", "WEST", "work-ladder", [-30, 0, 25], Math.PI, WORK_LADDER, ["traversal", "climb", "south-alley"]),
  placement("traversal-south-duck-west", "MID", "duck-beam-frame", [-12, 0, 23.25], Math.PI / 2, DUCK_FRAME, ["traversal", "duck", "south-alley"]),
  placement("traversal-south-balance-mid", "MID", "balance-plank", [7, 0, 24.6], 0, BALANCE_PLANK, ["traversal", "balance", "south-alley"]),
  placement("traversal-south-ladder-mid", "MID", "work-ladder", [24, 0, 25], Math.PI, WORK_LADDER, ["traversal", "climb", "south-alley"]),
  placement("traversal-south-duck-east", "EAST", "duck-beam-frame", [45, 0, 23.25], Math.PI / 2, DUCK_FRAME, ["traversal", "duck", "south-alley"]),
  placement("traversal-south-balance-east", "EAST", "balance-plank", [64, 0, 24.6], 0, BALANCE_PLANK, ["traversal", "balance", "south-alley"]),

  // Wharf and Liberty additions.
  placement("traversal-wharf-ladder", "WHARF", "work-ladder", [-144.1, 0, 6.8], 0.2, WORK_LADDER, ["traversal", "climb", "wharf"]),
  placement("traversal-wharf-balance", "WHARF", "balance-plank", [-130.8, 0, 9.2], 0, BALANCE_PLANK, ["traversal", "balance", "wharf"]),
  placement("traversal-liberty-ladder", "LIBERTY", "work-ladder", [84.5, 0, -14.5], 0.5, WORK_LADDER, ["traversal", "climb", "liberty"]),
  placement("traversal-liberty-balance", "LIBERTY", "balance-plank", [101.5, 0, -16.3], -0.35, BALANCE_PLANK, ["traversal", "balance", "liberty"]),
  // M4 minimal roof network: two imported, measured support boards only.
  // Free Shift+Space ballistic jumps bridge the short approaches; no F prompt
  // advertises BALANCE/MANTLE/JUMP_GAP while those behaviors remain disabled.
  placement("m4-roof-board-scaffold", "MID", "roof-walk-board", [17.2, 2.16, -11.15], 0, [5.2, 1.9, 1.8], ["m4", "roof-route", "support", "roof-kid"]),
  placement("m4-roof-board-liberty", "LIBERTY", "roof-walk-board-long", [87.8, 2.15, -14.7], 0, [5.4, 1.4, 1.0], ["m4", "roof-route", "support", "event-vantage"]),

  // Imported service sheds make the alleys/work yards read as occupied.
  placement("north-alley-shed-west", "WEST", "infill-service-shed", [-92, 0, -28.3], Math.PI, SERVICE_SHED, ["alley", "service-shed"]),
  placement("north-alley-shed-mid", "MID", "infill-service-shed", [2, 0, -28.3], Math.PI, SERVICE_SHED, ["alley", "service-shed"]),
  placement("north-alley-shed-east", "EAST", "infill-service-shed", [52, 0, -28.3], Math.PI, SERVICE_SHED, ["alley", "service-shed"]),
  placement("south-alley-shed-west", "MID", "infill-service-shed", [-18, 0, 28.3], 0, SERVICE_SHED, ["alley", "service-shed"]),
  placement("south-alley-shed-east", "EAST", "infill-service-shed", [52, 0, 28.3], 0, SERVICE_SHED, ["alley", "service-shed"]),
];

export const DENSITY_PLACEMENTS: DensityPlacement[] = [
  ...FRONTAGE_PLACEMENTS,
  ...SHOULDER_AND_DISTRICT_DRESSING,
  ...SERVICE_BOUNDARIES,
  ...CITY_ENVELOPE,
  ...ALLEY_AND_TRAVERSAL_PROPS,
];

function cardinalApproach(facing: number): [number, number] {
  return [Math.sin(facing), Math.cos(facing)];
}

function traversal(
  id: string,
  placementId: string,
  type: TraversalAffordanceType,
  start: [number, number, number],
  end: [number, number, number],
  startFacing: number,
  endFacing: number,
  surfaceHeight: number,
  animation: { forward: string; reverse?: string },
  tags: string[],
  options: Partial<
    Pick<
      TraversalAffordance,
      | "interactionRadius"
      | "minApproachDot"
      | "bidirectional"
      | "routeGate"
      | "storyGate"
      | "cooldownMs"
    >
  > = {},
): TraversalAffordance {
  return {
    id,
    placementId,
    type,
    interactionRadius: options.interactionRadius ?? 1.45,
    approach: cardinalApproach(startFacing),
    minApproachDot: options.minApproachDot ?? 0.35,
    start: { pos: start, facing: startFacing },
    end: { pos: end, facing: endFacing },
    surfaceHeight,
    clearance: {
      radius: 0.4,
      height: type === "DUCK_UNDER" || type === "SQUEEZE" ? 1.05 : 1.8,
      pathHalfWidth: type === "BALANCE" ? 0.45 : 0.65,
    },
    landing: {
      center: end,
      radius: 0.75,
      standingHeight: 1.8,
    },
    animation,
    bidirectional: options.bidirectional ?? true,
    ...(options.routeGate ? { routeGate: options.routeGate } : {}),
    ...(options.storyGate ? { storyGate: options.storyGate } : {}),
    cooldownMs: options.cooldownMs ?? 650,
    tags,
  };
}

// Placement/anchor data only. The active locomotion worker owns F-key
// consumption, path sampling, clip synchronization, overshoot correction and
// reverse-facing behavior.
export const TRAVERSAL_AFFORDANCES: TraversalAffordance[] = [
  traversal("DENSITY.NALLEY.DUCK.WEST", "traversal-north-duck-west", "DUCK_UNDER", [-83.2, 0, -23.25], [-80.8, 0, -23.25], Math.PI / 2, Math.PI / 2, 0, { forward: "crouchWalk", reverse: "crouchWalk" }, ["north-alley", "shortcut"]),
  traversal("DENSITY.NALLEY.BALANCE.WEST", "traversal-north-balance-west", "BALANCE", [-57.7, 0.7, -24.6], [-54.3, 0.7, -24.6], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["north-alley", "vantage"]),
  traversal("DENSITY.NALLEY.CLIMB.WEST", "traversal-north-ladder-west", "CLIMB_UP", [-40.3, 0, -23.7], [-40.1, 2.8, -25.1], Math.PI, Math.PI, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["north-alley", "climb"]),
  traversal("DENSITY.NALLEY.DUCK.MID", "traversal-north-duck-mid", "DUCK_UNDER", [-26.2, 0, -23.25], [-23.8, 0, -23.25], Math.PI / 2, Math.PI / 2, 0, { forward: "crouchWalk", reverse: "crouchWalk" }, ["north-alley", "shortcut"]),
  traversal("DENSITY.NALLEY.BALANCE.MID", "traversal-north-balance-mid", "BALANCE", [-3.7, 0.7, -24.6], [-0.3, 0.7, -24.6], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["north-alley", "vantage"]),
  traversal("DENSITY.NALLEY.CLIMB.MID", "traversal-north-ladder-mid", "CLIMB_UP", [24.3, 0, -23.7], [24.1, 2.8, -25.1], Math.PI, Math.PI, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["north-alley", "climb"]),
  traversal("DENSITY.NALLEY.DUCK.EAST", "traversal-north-duck-east", "DUCK_UNDER", [42.8, 0, -23.25], [45.2, 0, -23.25], Math.PI / 2, Math.PI / 2, 0, { forward: "crouchWalk", reverse: "crouchWalk" }, ["north-alley", "shortcut"]),
  traversal("DENSITY.NALLEY.BALANCE.EAST", "traversal-north-balance-east", "BALANCE", [60.3, 0.7, -24.6], [63.7, 0.7, -24.6], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["north-alley", "vantage"]),

  traversal("DENSITY.SALLEY.CLIMB.WEST", "traversal-south-ladder-west", "CLIMB_UP", [-30.3, 0, 23.7], [-30.1, 2.8, 25.1], 0, 0, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["south-alley", "climb"]),
  traversal("DENSITY.SALLEY.DUCK.WEST", "traversal-south-duck-west", "DUCK_UNDER", [-13.2, 0, 23.25], [-10.8, 0, 23.25], Math.PI / 2, Math.PI / 2, 0, { forward: "crouchWalk", reverse: "crouchWalk" }, ["south-alley", "shortcut"]),
  traversal("DENSITY.SALLEY.BALANCE.MID", "traversal-south-balance-mid", "BALANCE", [5.3, 0.7, 24.6], [8.7, 0.7, 24.6], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["south-alley", "vantage"]),
  traversal("DENSITY.SALLEY.CLIMB.MID", "traversal-south-ladder-mid", "CLIMB_UP", [24.3, 0, 23.7], [24.1, 2.8, 25.1], 0, 0, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["south-alley", "climb"]),
  traversal("DENSITY.SALLEY.DUCK.EAST", "traversal-south-duck-east", "DUCK_UNDER", [43.8, 0, 23.25], [46.2, 0, 23.25], Math.PI / 2, Math.PI / 2, 0, { forward: "crouchWalk", reverse: "crouchWalk" }, ["south-alley", "shortcut"]),
  traversal("DENSITY.SALLEY.BALANCE.EAST", "traversal-south-balance-east", "BALANCE", [62.3, 0.7, 24.6], [65.7, 0.7, 24.6], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["south-alley", "vantage"]),

  traversal("DENSITY.WHARF.CLIMB", "traversal-wharf-ladder", "CLIMB_UP", [-143.8, 0, 5.5], [-144, 2.8, 6.9], Math.PI, Math.PI, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["wharf", "crane", "vantage"]),
  traversal("DENSITY.WHARF.BALANCE", "traversal-wharf-balance", "BALANCE", [-132.5, 0.7, 9.2], [-129.1, 0.7, 9.2], Math.PI / 2, Math.PI / 2, 0.7, { forward: "walk", reverse: "walk" }, ["wharf", "vantage"]),
  traversal("DENSITY.WHARF.CRATE.MANTLE", "wharf-cargo-west-crates", "MANTLE", [-154, 0, -2.8], [-154, 2, -4], Math.PI, Math.PI, 2, { forward: "climbUp", reverse: "climbDown" }, ["wharf", "cargo"]),
  traversal("DENSITY.MARKET.CART.VAULT", "shoulder-west-north-cart", "VAULT", [-107.4, 0, -7], [-104.6, 0, -7], Math.PI / 2, Math.PI / 2, 0.9, { forward: "vault", reverse: "vault" }, ["west-street", "market"]),
  traversal("DENSITY.TOWN.CART.VAULT", "shoulder-mid-south-cart", "VAULT", [-15.4, 0, 6.5], [-12.6, 0, 6.5], Math.PI / 2, Math.PI / 2, 0.9, { forward: "vault", reverse: "vault" }, ["town-heart", "street"]),
  traversal("DENSITY.EAST.CRATE.MANTLE", "shoulder-east-south-crates", "MANTLE", [42, 0, 6.9], [42, 1.7, 8.1], 0, 0, 1.7, { forward: "climbUp", reverse: "climbDown" }, ["civic", "street"]),

  traversal("DENSITY.LIBERTY.CLIMB", "traversal-liberty-ladder", "CLIMB_UP", [84, 0, -13.4], [84.5, 2.8, -14.6], 2.64, 2.64, 2.8, { forward: "climbUp", reverse: "climbDown" }, ["liberty", "vantage"]),
  traversal("DENSITY.LIBERTY.BALANCE", "traversal-liberty-balance", "BALANCE", [100, 0.7, -15.75], [103, 0.7, -16.85], 1.92, 1.92, 0.7, { forward: "walk", reverse: "walk" }, ["liberty", "vantage"]),
];

export const HARBOR_EXCLUSIONS = [
  { id: "open-harbor-west", minX: -260, maxX: -160, minZ: -80, maxZ: 80 },
  { id: "open-harbor-wharf-south", minX: -160, maxX: -118, minZ: 14, maxZ: 80 },
  { id: "open-harbor-southwest", minX: -118, maxX: -40, minZ: 26.5, maxZ: 80 },
] as const;
