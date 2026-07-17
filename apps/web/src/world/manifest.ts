// Day 1 compressed Boston district manifest. Positions are world meters.
// The district is a gameplay construct (Production.md §6): one street spine,
// the four errand interiors, the rider edge, and the Liberty Tree pocket.
// Geometry is topological, not a literal map; no false geographic fact is taught.

export interface BuildingDef {
  id: string;
  glb?: string; // key under /world/props/; falls back to a primitive shell
  pos: [number, number, number];
  rotY: number;
  size: [number, number, number]; // footprint + shell fallback (x, y, z)
  color: string;
}

export interface RoomDef {
  center: [number, number]; // x, z
  size: [number, number]; // width (x), depth (z)
  doorSide: "N" | "S"; // which wall has the door gap (toward street)
}

export interface LocationDef {
  id: string;
  label: string;
  anchor: [number, number, number]; // player position when scene() moves here
  faceY: number;
  interior: boolean;
  exitAnchor?: [number, number, number]; // where the player stands after stepping out
  room?: RoomDef;
}

export interface NpcDef {
  id: string;
  name: string;
  glb: string; // key under /world/characters/
  height: number;
  pos: [number, number, number];
  rotY: number;
  clip: string;
  interiorOf?: string; // only visible when inside this location
}

export const WORLD_BOUNDS = { minX: -56, maxX: 54, minZ: -40, maxZ: 18 } as const;

// ---- Street-spine buildings. South row fronts at z≈7, north row at z≈-7.5 ----
export const BUILDINGS: BuildingDef[] = [
  { id: "mercer", glb: "bldg-printshop", pos: [0, 0, 11], rotY: Math.PI, size: [10, 8, 8], color: "#7a3b2e" },
  { id: "rowA", glb: "bldg-brick", pos: [-13, 0, 11.6], rotY: Math.PI, size: [11, 10, 9], color: "#8a4a3a" },
  { id: "rowB", glb: "bldg-clapboard", pos: [-25, 0, 11], rotY: Math.PI, size: [10, 8, 8], color: "#9c8b72" },
  { id: "clarke", glb: "bldg-clapboard", pos: [-38, 0, 11], rotY: Math.PI, size: [10, 8, 8], color: "#6e6a5a" },
  { id: "pike", glb: "bldg-brick", pos: [14, 0, 11.4], rotY: Math.PI, size: [10, 9, 8], color: "#7d4638" },
  { id: "rowC", glb: "bldg-clapboard", pos: [26, 0, 11], rotY: Math.PI, size: [10, 8, 8], color: "#a09076" },
  { id: "customs", glb: "bldg-customhouse", pos: [40, 0, 12], rotY: Math.PI, size: [14, 11, 10], color: "#8f4b39" },
  { id: "thomas", glb: "bldg-counting", pos: [-30, 0, -12], rotY: 0, size: [12, 9, 9], color: "#a3813f" },
  { id: "rowD", glb: "bldg-brick", pos: [-16, 0, -12.4], rotY: 0, size: [11, 10, 9], color: "#87473a" },
  { id: "rowE", glb: "bldg-clapboard", pos: [-4, 0, -12], rotY: 0, size: [10, 8, 8], color: "#93836b" },
  { id: "rowF", glb: "bldg-brick", pos: [8, 0, -12.4], rotY: 0, size: [11, 9, 9], color: "#8a4a3a" },
  { id: "rowG", glb: "bldg-clapboard", pos: [20, 0, -12], rotY: 0, size: [10, 8, 8], color: "#9c8b72" },
  { id: "rowH", glb: "bldg-brick", pos: [32, 0, -12.4], rotY: 0, size: [11, 9, 9], color: "#7d4638" },
];

export const PROPS: { glb: string; pos: [number, number, number]; rotY: number; scale?: number; collide?: [number, number] }[] = [
  { glb: "notice-board", pos: [6, 0, 4.6], rotY: -0.35, collide: [1.6, 0.6] },
  { glb: "well-pump", pos: [-6, 0, -3], rotY: 0.4, collide: [1.4, 1.4] },
  { glb: "hand-cart", pos: [11, 0, -4], rotY: 0.9, collide: [2.4, 1.6] },
  { glb: "barrel-group", pos: [-19, 0, 5], rotY: 0.2, collide: [2.2, 1.6] },
  { glb: "crate-stack", pos: [24, 0, -5], rotY: -0.5, collide: [2.2, 1.8] },
  { glb: "market-stall", pos: [-22, 0, -5], rotY: 0.15, collide: [3.0, 2.2] },
  { glb: "market-stall", pos: [-29, 0, -4.6], rotY: -0.2, collide: [3.0, 2.2] },
  { glb: "barrel-group", pos: [35, 0, 4.6], rotY: 1.4, collide: [2.2, 1.6] },
  { glb: "crate-stack", pos: [-46, 0, -24], rotY: 0.3, collide: [2.4, 1.8] },
  { glb: "fence-gate", pos: [-41, 0, -18], rotY: 0.5, collide: [3.2, 0.8] },
  { glb: "liberty-elm", pos: [44, 0, -27], rotY: 0, scale: 1.6, collide: [2.4, 2.4] },
  { glb: "hand-cart", pos: [-44, 0, -29], rotY: -1.1, collide: [2.4, 1.6] },
  { glb: "barrel-group", pos: [36, 0, -20], rotY: 0.7, collide: [2.2, 1.6] },
  // Dressing along the facades so the street reads worked-in, not empty.
  { glb: "barrel-group", pos: [-9.5, 0, 5.2], rotY: 2.1, collide: [2.0, 1.5] },
  { glb: "crate-stack", pos: [-33.5, 0, 5.4], rotY: 0.9, collide: [2.0, 1.6] },
  { glb: "barrel-group", pos: [17.5, 0, -5.4], rotY: -0.6, collide: [2.0, 1.5] },
  { glb: "crate-stack", pos: [30, 0, 5.2], rotY: 1.7, collide: [2.0, 1.6] },
  { glb: "hand-cart", pos: [-2, 0, -5.2], rotY: 2.4, collide: [2.4, 1.6] },
  { glb: "barrel-group", pos: [45, 0, 4.8], rotY: 0.4, collide: [2.0, 1.5] },
];

// ---- Locations ----
export const LOCATIONS: Record<string, LocationDef> = {
  BOSTON_STREET: {
    id: "BOSTON_STREET", label: "Boston street", anchor: [-6, 0, 1.5], faceY: Math.PI / 2, interior: false,
  },
  MERCER_PRESS: {
    id: "MERCER_PRESS", label: "Mercer's Press", anchor: [0, 0, 7.2], faceY: 0, interior: true,
    exitAnchor: [0, 0, 2.6], room: { center: [0, 9.6], size: [9, 7], doorSide: "S" },
  },
  THOMAS_COUNTINGHOUSE: {
    id: "THOMAS_COUNTINGHOUSE", label: "Thomas Bell's counting-house", anchor: [-30, 0, -8.2], faceY: Math.PI, interior: true,
    exitAnchor: [-30, 0, -5.4], room: { center: [-30, -10.6], size: [10, 7], doorSide: "N" },
  },
  PIKE_OFFICE: {
    id: "PIKE_OFFICE", label: "Pike's office", anchor: [14, 0, 7.8], faceY: 0, interior: true,
    exitAnchor: [14, 0, 5.2], room: { center: [14, 9.9], size: [8, 6.5], doorSide: "S" },
  },
  CUSTOM_HOUSE: {
    id: "CUSTOM_HOUSE", label: "The Custom House", anchor: [40, 0, 7.6], faceY: 0, interior: true,
    exitAnchor: [40, 0, 4.6], room: { center: [40, 10.2], size: [12, 8], doorSide: "S" },
  },
  CUSTOMS_POST: {
    id: "CUSTOMS_POST", label: "Customs checkpoint", anchor: [-14, 0, -2], faceY: -Math.PI / 2, interior: false,
  },
  RIDER_POST: {
    id: "RIDER_POST", label: "Town edge, rider post", anchor: [-45, 0, -29], faceY: -Math.PI / 2, interior: false,
  },
  CLARKE_DOORWAY: {
    id: "CLARKE_DOORWAY", label: "Clarke's doorway", anchor: [-38, 0, 4.6], faceY: 0, interior: false,
  },
  LIBERTY_TREE_APPROACH: {
    id: "LIBERTY_TREE_APPROACH", label: "The great elm", anchor: [38, 0, -21], faceY: -0.6, interior: false,
  },
};

// ---- Free-roam target anchors: runtime targetId -> world position ----
export const MARKER_ANCHORS: Record<string, [number, number, number]> = {
  MERCER_PRESS: [0, 0, 4.4],
  STREET: [0, 0, 1.5],
  THOMAS_CIRCULAR: [-30, 0, -5.8],
  PIKE_PROOF: [14, 0, 5.6],
  CUSTOMHOUSE_NOTICE: [40, 0, 5.0],
  RIDER_HANDBILLS: [-45, 0, -29],
  CROWD: [38, 0, -21],
};

// ---- NPC staging ----
export const NPCS: NpcDef[] = [
  { id: "abigail", name: "Abigail Mercer", glb: "abigail-rigged", height: 1.65, pos: [1.4, 0, 10.6], rotY: Math.PI, clip: "work1", interiorOf: "MERCER_PRESS" },
  { id: "thomas", name: "Thomas Bell", glb: "thomas-rigged", height: 1.74, pos: [-31.2, 0, -11.4], rotY: 0, clip: "work2", interiorOf: "THOMAS_COUNTINGHOUSE" },
  { id: "pike", name: "Mr. Pike", glb: "pike-rigged", height: 1.7, pos: [15, 0, 11.2], rotY: Math.PI, clip: "work1", interiorOf: "PIKE_OFFICE" },
  { id: "clerk", name: "Custom House clerk", glb: "clarke-rigged", height: 1.72, pos: [41.2, 0, 12.4], rotY: Math.PI, clip: "work1", interiorOf: "CUSTOM_HOUSE" },
  { id: "clarke", name: "Edward Clarke", glb: "clarke-rigged", height: 1.77, pos: [-38, 0, 6.4], rotY: Math.PI, clip: "idle" },
  { id: "rider", name: "Post rider", glb: "rider-rigged", height: 1.76, pos: [-46.8, 0, -30.2], rotY: 0.9, clip: "work2" },
  { id: "officer", name: "Customs officer", glb: "officer-rigged", height: 1.78, pos: [-14, 0, -4.4], rotY: 1.9, clip: "idle" },
];

// Ambient street population.
export const AMBIENT: { glb: string; pos: [number, number, number]; rotY: number; clip: string; path?: { to: [number, number, number]; speed: number } }[] = [
  { glb: "townsman-rigged", pos: [-10, 0, 1], rotY: 0.3, clip: "walk", path: { to: [28, 0, -2], speed: 0.85 } },
  { glb: "townswoman-rigged", pos: [16, 0, 2.6], rotY: -1.2, clip: "walk", path: { to: [-26, 0, 3.4], speed: 0.75 } },
  { glb: "townsman-rigged", pos: [-24.6, 0, -3.4], rotY: 0.7, clip: "talk2" },
  { glb: "townswoman-rigged", pos: [-23.4, 0, -3.8], rotY: -2.3, clip: "talk3" },
  { glb: "townsman-rigged", pos: [7.4, 0, 3.2], rotY: -0.8, clip: "talk" },
  { glb: "townswoman-rigged", pos: [33, 0, 1.6], rotY: 2.4, clip: "idle" },
  { glb: "townsman-rigged", pos: [42, 0, -19], rotY: -0.4, clip: "argu1" },
  { glb: "townsman-rigged", pos: [44.4, 0, -20], rotY: 2.6, clip: "argue2" },
];

// Free-roam target ids that mean "you are heading out to the street".
export const EXTERIOR_TARGETS = new Set([
  "STREET",
  "THOMAS_CIRCULAR",
  "PIKE_PROOF",
  "CUSTOMHOUSE_NOTICE",
  "RIDER_HANDBILLS",
  "CROWD",
]);

// Static colliders: [cx, cz, halfX, halfZ]
export function exteriorColliders(): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const b of BUILDINGS) out.push([b.pos[0], b.pos[2], b.size[0] / 2, b.size[2] / 2]);
  for (const p of PROPS) if (p.collide) out.push([p.pos[0], p.pos[2], p.collide[0] / 2, p.collide[1] / 2]);
  return out;
}
