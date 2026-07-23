import { INTERIOR_STORY_LOCAL, interiorPoint } from "./interiorManifest.js";

// Boston district manifest v3 (World-Design-Bible §3): THE BIG STREET.
// One wide east-west street (z -10..+10) between two full building rows
// (z ±10..20), a semi-explorable alley behind each row (z ±20..26), the
// Town Wharf pocket west of x=-118 (water south+west of the apron), the
// Town House square at x 45..62, the east gate at x=+80, and the Liberty
// Tree pocket at [+95,-25]. Positions are world meters, y-up. The district
// stays a compressed gameplay construct (topological, not literal).
//
// CONCURRENCY CONTRACT: sibling directors (Sky/Weather/Water/Audio,
// Traversal, Population) read these exports. Keep every export name stable
// and additive; the atmosphere worker owns water/ships/sky VISUALS while
// this file owns ground, collision, blocking and building placement.

export interface BuildingDef {
  id: string;
  label?: string;
  role?: "WATCH_HOUSE";
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
  doorX?: number; // explicit threshold lane; defaults to center.x for migration
  height?: number; // ceiling; defaults to the standard 2.75m room shell
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

export interface PropDef {
  glb: string;
  pos: [number, number, number];
  rotY: number;
  scale?: number;
  size?: [number, number, number]; // box-fit target; default small dressing
  collide?: [number, number];
  // Route-gated blocker: prop + collider vanish once the route unlocks.
  gate?: "THOMAS_DOCK_ROUTE";
}

export interface BarrierDef {
  kind: "fence" | "wall" | "rail" | "palisade";
  pos: [number, number]; // center x, z
  size: [number, number]; // extent x, z
}

export const WORLD_BOUNDS = { minX: -165, maxX: 108, minZ: -30, maxZ: 30 } as const;

// ---- Building rows. South row fronts at z≈+11, north row at z≈-11. ---------
// Hero buildings keep their audited GLB footprints (door seating in
// DoorDirector depends on the box-fit scale); v3 only translates them.
// Row/civic/wharf keys are the world-v3 factory's landed names (see
// assets/build/world-v3/*-manifest.json); FittedGlb falls back to a
// proportioned shell for anything still regenerating.
export const BUILDINGS: BuildingDef[] = [
  // -- North row: wharf warehouses (front onto the apron; deck is
  //    x -160..-118, z -20..+14 per the shared wharf contract) --
  { id: "warehouseHero", glb: "bldg-warehouse-wharf-a", pos: [-153, 0, -15], rotY: 0, size: [14, 9, 10], color: "#6e5f4c" },
  { id: "warehouseN2", glb: "bldg-warehouse-wharf-b", pos: [-139.5, 0, -15], rotY: 0, size: [13, 8, 9], color: "#7a6a52" },
  { id: "warehouseN3", glb: "bldg-warehouse-wharf-a", pos: [-126.5, 0, -15], rotY: 0, size: [13, 9, 10], color: "#68604e" },
  // -- North row: street section (west mouth of the north alley at x≈-90) --
  { id: "rowN1", glb: "bldg-row-clapboard-a", pos: [-86.5, 0, -15], rotY: 0, size: [7, 8, 8], color: "#93836b" },
  { id: "rowN2", glb: "bldg-row-brick-a", pos: [-79.5, 0, -15], rotY: 0, size: [7, 9, 8], color: "#87473a" },
  { id: "thomas", glb: "bldg-counting", pos: [-70, 0, -15], rotY: 0, size: [12, 9, 9], color: "#a3813f" },
  { id: "rowN3", glb: "bldg-row-clapboard-b", pos: [-59, 0, -15], rotY: 0, size: [10, 8, 8], color: "#9c8b72" },
  { id: "rowN4", glb: "bldg-clapboard", pos: [-49, 0, -15], rotY: 0, size: [10, 8, 8], color: "#8f7f68" },
  { id: "rowN5", glb: "bldg-row-shop", pos: [-39, 0, -15], rotY: 0, size: [10, 9, 8], color: "#7d6a50" },
  { id: "rowN6", glb: "bldg-brick", pos: [-29, 0, -15], rotY: 0, size: [10, 9, 8], color: "#8a4a3a" },
  { id: "tavern", glb: "bldg-tavern", pos: [-18, 0, -15], rotY: 0, size: [12, 9, 9], color: "#6f5136" },
  // authored mid-cut x -12..-9 (street <-> north alley)
  { id: "rowN7", glb: "bldg-row-clapboard-c", pos: [-4, 0, -15], rotY: 0, size: [10, 8, 8], color: "#93836b" },
  { id: "rowN8", glb: "bldg-row-brick-b", pos: [6, 0, -15], rotY: 0, size: [10, 9, 8], color: "#7d4638" },
  { id: "rowN9", glb: "bldg-scaffold", pos: [13.5, 0, -15], rotY: 0, size: [5, 8, 8], color: "#9a9384" },
  // authored mid-cut x 16..19
  { id: "rowN10", glb: "bldg-row-clapboard-a", pos: [24, 0, -15], rotY: 0, size: [10, 8, 8], color: "#8d7d66" },
  { id: "rowN11", glb: "bldg-clapboard", pos: [34, 0, -15], rotY: 0, size: [10, 8, 8], color: "#9c8b72" },
  { id: "rowN12", glb: "bldg-row-clapboard-b", pos: [42.25, 0, -15], rotY: 0, size: [6.5, 8, 8], color: "#87684c" },
  { id: "townhouse", label: "Boston Watch House", role: "WATCH_HOUSE", glb: "bldg-townhouse-civic", pos: [53.5, 0, -15.5], rotY: 0, size: [16, 12, 11], color: "#8f4b39" },
  // churchyard passage x 61.5..65 (street <-> north alley)
  { id: "church", glb: "church-meetinghouse", pos: [71.5, 0, -16], rotY: 0, size: [13, 15, 12], color: "#c8c2b4" },
  // north-east alley mouth x 78..79.4 beside the palisade

  // -- South row --
  { id: "ropewalk", glb: "bldg-warehouse-street", pos: [-103, 0, 15], rotY: Math.PI, size: [22, 7, 8], color: "#77664e" },
  // authored west cut x -92..-89.5 (street <-> boardwalk; the dock route's exit)
  { id: "chandlery", glb: "bldg-row-clapboard-b", pos: [-85, 0, 15], rotY: Math.PI, size: [9, 9, 8], color: "#6e6a5a" },
  { id: "warehouseS", glb: "bldg-warehouse-street", pos: [-74.5, 0, 15], rotY: Math.PI, size: [12, 9, 9], color: "#71624b" },
  { id: "rowS1", glb: "bldg-row-clapboard-c", pos: [-62.5, 0, 15], rotY: Math.PI, size: [12, 8, 8], color: "#93836b" },
  { id: "rowS2", glb: "bldg-row-brick-b", pos: [-50.5, 0, 15], rotY: Math.PI, size: [12, 9, 8], color: "#8a4a3a" },
  { id: "rowS3", glb: "bldg-row-shop", pos: [-40.75, 0, 15], rotY: Math.PI, size: [7.5, 9, 8], color: "#7d6a50" },
  { id: "clarke", glb: "bldg-clapboard", pos: [-32, 0, 15], rotY: Math.PI, size: [10, 8, 8], color: "#6e6a5a" },
  { id: "rowS4", glb: "bldg-brick", pos: [-20.5, 0, 15], rotY: Math.PI, size: [13, 9, 8], color: "#8a4a3a" },
  // authored mid-cut x -14..-11 (street <-> south alley)
  { id: "rowS5", glb: "bldg-row-clapboard-a", pos: [-8, 0, 15], rotY: Math.PI, size: [6, 8, 8], color: "#9c8b72" },
  { id: "mercer", glb: "bldg-printshop", pos: [0, 0, 15], rotY: Math.PI, size: [10, 8, 8], color: "#7a3b2e" },
  { id: "rowS6", glb: "bldg-row-brick-a", pos: [10.5, 0, 15], rotY: Math.PI, size: [11, 9, 8], color: "#8a4a3a" },
  // authored mid-cut x 16..19
  { id: "rowS7", glb: "bldg-clapboard", pos: [22, 0, 15], rotY: Math.PI, size: [6, 8, 8], color: "#93836b" },
  { id: "pike", glb: "bldg-brick", pos: [30, 0, 15.4], rotY: Math.PI, size: [10, 9, 8], color: "#7d4638" },
  { id: "rowS8", glb: "bldg-row-clapboard-b", pos: [41.5, 0, 15], rotY: Math.PI, size: [13, 8, 8], color: "#9c8b72" },
  { id: "customs", glb: "bldg-customhouse", pos: [55, 0, 15.5], rotY: Math.PI, size: [14, 11, 10], color: "#8f4b39" },
  { id: "rowS9", glb: "bldg-row-clapboard-c", pos: [66.5, 0, 15], rotY: Math.PI, size: [9, 8, 8], color: "#8d7d66" },
  // authored south-east alley mouth x 71..73 (street <-> south alley)
  { id: "rowS10", glb: "bldg-row-shop", pos: [75.5, 0, 15], rotY: Math.PI, size: [5, 8, 8], color: "#7d6a50" },
];

// ---- Street furniture, wharf dressing, alley clutter, route blockers -------
export const PROPS: PropDef[] = [
  // Mid-street heart of town
  { glb: "notice-board", pos: [6, 0, 8.8], rotY: -0.35, collide: [1.6, 0.6] },
  { glb: "well-pump", pos: [-8, 0, -1.5], rotY: 0.4, collide: [1.4, 1.4] },
  { glb: "hand-cart", pos: [11, 0, -4], rotY: 0.9, collide: [2.4, 1.6] },
  { glb: "barrel-group", pos: [-19, 0, 8.6], rotY: 0.2, collide: [2.2, 1.6] },
  { glb: "crate-stack", pos: [24, 0, -8.6], rotY: -0.5, collide: [2.2, 1.8] },
  { glb: "hand-cart", pos: [-2, 0, -8.2], rotY: 2.4, collide: [2.4, 1.6] },
  { glb: "barrel-group", pos: [-9.5, 0, 9.2], rotY: 2.1, collide: [2.0, 1.5] },
  { glb: "crate-stack", pos: [30, 0, 9.2], rotY: 1.7, collide: [2.0, 1.6] },
  { glb: "hitching-post", pos: [-24, 0, -8.8], rotY: 0, size: [1.6, 1.1, 0.4], collide: [1.4, 0.5] },
  // Wall-mounted street lanterns: the imported bracket sits high on a facade
  // (base y≈2.4) with its box intersecting the building front (north row front
  // z≈-11, south row front z≈+11). Size long axis is the model's local Y so the
  // bracket keeps its height instead of collapsing. No ground collider (it is
  // mounted out of reach); light comes from SkyDirector via the LANTERNS anchors.
  { glb: "street-lantern-bracket", pos: [15, 2.4, -10.7], rotY: 0, size: [1.2, 1.4, 1.0] },
  { glb: "street-lantern-bracket", pos: [-30, 2.4, 10.7], rotY: Math.PI, size: [1.2, 1.4, 1.0] },
  // Market cluster x -55..-45 (north side)
  { glb: "market-stall", pos: [-50, 0, -6.5], rotY: 0.15, collide: [3.0, 2.2] },
  { glb: "market-stall", pos: [-55, 0, -6.2], rotY: -0.2, collide: [3.0, 2.2] },
  { glb: "market-awning", pos: [-45.2, 0, -6.8], rotY: 0.35, size: [3.2, 2.6, 2.4], collide: [3.0, 2.2] },
  { glb: "barrel-group", pos: [-52.5, 0, -8.9], rotY: 1.4, collide: [2.2, 1.6] },
  // West street working dressing
  { glb: "hay-cart", pos: [-83, 0, 5.5], rotY: -0.5, size: [3.4, 2.2, 2.2], collide: [3.2, 2.2] },
  { glb: "firewood-stack", pos: [-64, 0, -9.0], rotY: 0.2, size: [2.2, 1.2, 1.0], collide: [2.0, 1.0] },
  { glb: "barrel-group", pos: [-73, 0, 9.2], rotY: 0.8, collide: [2.0, 1.5] },
  { glb: "crate-stack", pos: [-95, 0, 8.8], rotY: 0.4, collide: [2.0, 1.6] },
  { glb: "street-lantern-bracket", pos: [-70, 2.4, -10.7], rotY: 0, size: [1.2, 1.4, 1.0] },
  // East street / civic end
  { glb: "barrel-group", pos: [46, 0, 9.3], rotY: 0.4, collide: [2.0, 1.5] },
  { glb: "street-lantern-bracket", pos: [55, 2.4, 10.7], rotY: Math.PI, size: [1.2, 1.4, 1.0] },
  { glb: "well-pump", pos: [63.4, 0, -13], rotY: 1.1, collide: [1.3, 1.3] },
  { glb: "churchyard-fence", pos: [63.2, 0, -10.6], rotY: 0, size: [3.2, 1.1, 0.3] },
  { glb: "stone-steps", pos: [53.5, 0, -9.75], rotY: 0, size: [3.8, 1.1, 2.2] },
  { glb: "street-dog", pos: [-30.2, 0, 9.8], rotY: -0.65, size: [1.25, 0.85, 0.55] },
  // Rider pocket at the north-alley west mouth (x -118..-90)
  { glb: "hitching-post", pos: [-95.5, 0, -18.5], rotY: 0.3, size: [1.6, 1.1, 0.4], collide: [1.2, 0.5] },
  { glb: "hand-cart", pos: [-93.5, 0, -21], rotY: -1.1, collide: [2.4, 1.6] },
  { glb: "crate-stack", pos: [-99.5, 0, -22.5], rotY: 0.3, collide: [2.4, 1.8] },
  { glb: "hay-cart", pos: [-108, 0, -18], rotY: 0.7, size: [3.4, 2.2, 2.2], collide: [3.2, 2.2] },
  { glb: "barrel-group", pos: [-113.5, 0, -22.5], rotY: 1.9, collide: [2.0, 1.5] },
  // Wharf apron (crane, cargo, fish flakes; ships + water visuals are the
  // atmosphere worker's - the footprint and blocking here are ours). The
  // whole apron IS the hero pier (Long Wharf homage): warehouses along its
  // north side, moored ships along the south face (deck edge z=+14), with a
  // 3m clear boarding apron kept open beside the brig at x -145..-129.
  { glb: "timber-crane", pos: [-146, 0, 4], rotY: 0.6, size: [3.0, 6.5, 3.0], collide: [2.6, 2.6] },
  { glb: "crate-mound", pos: [-134, 0, 0.5], rotY: 0.2, size: [3.4, 2.2, 2.6], collide: [3.2, 2.4] },
  { glb: "rope-coil-large", pos: [-150, 0, 9.6], rotY: 0, size: [1.3, 0.6, 1.3], collide: [1.2, 1.2] },
  { glb: "cargo-net-bundle", pos: [-149.5, 0, 5.8], rotY: 0.9, size: [1.8, 1.2, 1.8], collide: [1.6, 1.6] },
  { glb: "fish-flakes-rack", pos: [-122, 0, -7.5], rotY: 0.1, size: [3.0, 1.0, 1.4], collide: [2.8, 1.4] },
  { glb: "barrel-group", pos: [-126, 0, 8], rotY: 1.2, collide: [2.2, 1.6] },
  { glb: "crate-stack", pos: [-157.5, 0, 3], rotY: -0.4, collide: [2.2, 1.8] },
  // Gangplank spans deck->ship along world Z. Its long axis is the model's
  // local X, so the fit target puts the ~3.6m length on X (Y/Z left generous so
  // X is the constraining ratio) and rotY turns that length across the deck edge.
  { glb: "gangplank", pos: [-140, 0, 14.2], rotY: Math.PI / 2, size: [3.6, 1.2, 1.2] },
  { glb: "crate-stack", pos: [-119.6, 0, -11.2], rotY: 0.3, collide: [2.4, 2.2] },
  // North alley clutter (always open, slower going; laundry lines are
  // visual dressing the traversal worker upgrades to DUCK markers)
  { glb: "crate-stack", pos: [-70, 0, -23.5], rotY: 0.4, collide: [2.2, 1.8] },
  { glb: "barrel-group", pos: [-45, 0, -24.6], rotY: 0.9, collide: [2.0, 1.5] },
  // Drying rack: long axis is the model's local X, so the fit target keeps the
  // rack width on X (Y/Z generous) and it grounds at plausible ~2.6m proportions
  // instead of collapsing. Imported asset only (no procedural laundry rig).
  { glb: "drying-line-rack", pos: [-33, 0, -23.2], rotY: Math.PI / 2, size: [2.6, 2.4, 1.6] },
  { glb: "crate-stack", pos: [-15.5, 0, -22.3], rotY: -0.2, collide: [2.0, 1.6] },
  { glb: "barrel-group", pos: [-14.5, 0, -25.4], rotY: 1.3, collide: [1.8, 1.4] },
  { glb: "crate-stack", pos: [5, 0, -24.8], rotY: 0.7, collide: [2.0, 1.6] },
  { glb: "drying-line-rack", pos: [18, 0, -23.2], rotY: Math.PI / 2, size: [2.6, 2.4, 1.6] },
  { glb: "scaffold-low", pos: [30, 0, -23.5], rotY: 0, size: [2.8, 2.4, 1.2], collide: [2.6, 1.2] },
  { glb: "firewood-stack", pos: [55, 0, -24.5], rotY: -0.3, size: [2.2, 1.2, 1.0], collide: [2.0, 1.0] },
  // South alley clutter + THE DOCK-ROUTE BLOCKER at x=-40 (chained swing-gate
  // + stacked cargo; a dockhand idles beside it in the PopulationDirector
  // roster). Gate prop and collider both clear when
  // routes.THOMAS_DOCK_ROUTE === "UNLOCKED".
  // Size is LOCAL (pre-rotation): the leaf's own width spans the corridor
  // and rotY turns it across the boardwalk.
  { glb: "fence-gate", pos: [-40, 0, 22.6], rotY: Math.PI / 2, size: [6.0, 2.1, 1.4], collide: [1.6, 7.6], gate: "THOMAS_DOCK_ROUTE" },
  { glb: "crate-mound", pos: [-38.6, 0, 25.4], rotY: 0.5, size: [2.6, 1.9, 2.2], collide: [2.2, 2.0] },
  { glb: "barrel-group", pos: [-20, 0, 24.6], rotY: 0.6, collide: [2.0, 1.5] },
  { glb: "crate-stack", pos: [10, 0, 23.4], rotY: -0.4, collide: [2.0, 1.6] },
  { glb: "drying-line-rack", pos: [28, 0, 23.2], rotY: Math.PI / 2, size: [2.6, 2.4, 1.6] },
  { glb: "crate-stack", pos: [40, 0, 24.6], rotY: 0.9, collide: [2.0, 1.6] },
  { glb: "barrel-group", pos: [62, 0, 23.4], rotY: 1.6, collide: [1.8, 1.4] },
  // Liberty Tree pocket (x 82..108, z -30..+8; lane bends NE from the gate)
  { glb: "liberty-elm", pos: [95, 0, -25], rotY: 0, scale: 1.6, collide: [2.4, 2.4] },
  { glb: "barrel-group", pos: [87, 0, -18], rotY: 0.7, collide: [2.2, 1.6] },
  { glb: "crate-stack", pos: [100.5, 0, -20], rotY: -0.6, collide: [2.2, 1.8] },
  { glb: "roof-ramp-cart", pos: [103, 0, -27], rotY: -1.2, size: [3.2, 2.0, 2.2], collide: [3.0, 2.2] },
  { glb: "hand-cart", pos: [85, 0, -4], rotY: 2.1, collide: [2.4, 1.6] },
];

// ---- Anchored street-lantern light sources ---------------------------------
// One warm point light per imported street-lantern-bracket, at its mounted
// flame height. SkyDirector renders ONLY light from these anchors; the visible
// lamp is the imported bracket GLB itself. Empty => no lantern glow is drawn
// (never a floating fallback box against the sky).
export const LANTERNS: [number, number, number][] = PROPS
  .filter((p) => p.glb === "street-lantern-bracket")
  .map((p) => [p.pos[0], 3.0, p.pos[2]] as [number, number, number]);

// ---- Gates (arch structures with authored openings) -------------------------
export interface GateDef {
  key: string;
  glb: string;
  x: number;
  halfOpening: number; // clear opening half-width along z
  halfSpan: number; // structure half-span along z
}
export const GATES: GateDef[] = [
  // Wing palisades run from each arch to the alley bands so the arch is the
  // only street crossing; the corridors (z 20..26.5 south / -20..-26.5
  // north) pass outside the wings.
  { key: "wharf-gate", glb: "town-gate", x: -118, halfOpening: 4.5, halfSpan: 20 },
  { key: "east-gate", glb: "town-gate", x: 80, halfOpening: 3.5, halfSpan: 20 },
];

// ---- Blocking layout: alley walls, water rails, palisades, pocket fences ----
// Every walkable sightline ends in authored dressing, never void (Bible §3/§13).
// WHARF CONTRACT (shared with WaterDirector's DECK): the walkable apron is
// x [-160,-118], z [-20,+14]; water (y=-1.1) fills everything south + west of
// it, with the moored ships along the deck's south face. The dock route is
// the raised boardwalk x [-114,-40], z [20,26.5] along the water's east
// finger; its east mouth (x=-40) carries the chained route gate and its
// street exit is the authored west cut at x -92..-89.5. Street <-> apron
// passes only through the wharf gate arch at x=-118.
export const BARRIERS: BarrierDef[] = [
  // Alley back walls (house backs / yard fences)
  { kind: "wall", pos: [-19, -26.5], size: [198, 1] }, // north alley, x -118..+80
  { kind: "wall", pos: [20, 26.5], size: [120, 1] }, // south alley house backs, x -40..+80
  { kind: "rail", pos: [-77, 26.5], size: [74, 1] }, // boardwalk waterside rail, x -114..-40
  { kind: "rail", pos: [-114.3, 23.4], size: [0.6, 6.8] }, // boardwalk west end (water beyond)
  { kind: "rail", pos: [-116, 19.8], size: [4.6, 0.6] }, // gate-corner wedge water rail
  // Wharf backlot fence behind the warehouses + alley/pocket seal at x≈-118
  // (the gate wings cover z 4.5..20 / -4.5..-20 at the same x).
  { kind: "fence", pos: [-139, -20.5], size: [42.5, 1] }, // x -160..-118
  { kind: "fence", pos: [-117.9, -23.6], size: [1, 7.6] }, // rider pocket dead-ends at the backlot
  // Water edges (bollard + rope rails on the deck contract)
  { kind: "rail", pos: [-160.1, -3], size: [0.8, 34.6] }, // apron west edge, z -20..+14
  // Split around the imported gangplank/boarding opening x -143..-137; the
  // former single 42.5m collider contradicted the visible clear brig apron.
  { kind: "rail", pos: [-151.5, 14.2], size: [17, 0.8] }, // x -160..-143
  { kind: "rail", pos: [-127.5, 14.2], size: [19, 0.8] }, // x -137..-118
  // Row-band seal between church and palisade (alley mouth stays the only cut)
  { kind: "fence", pos: [79, -15], size: [2, 10] },
  // Corner seals where the alley back walls hand off to the pocket fences
  { kind: "fence", pos: [79.5, -28], size: [3, 3.2] },
  { kind: "fence", pos: [79.5, 27.6], size: [3, 3] },
  // Liberty pocket enclosure (elm pocket + lane; entered via arch + mouths)
  { kind: "fence", pos: [94, 28.5], size: [28, 1] },
  { kind: "fence", pos: [94.5, -29.4], size: [27, 1] },
  { kind: "fence", pos: [107, -0.5], size: [1, 58] },
];

// ---- Locations (runtime scene ids; keys unchanged from v2) ------------------
export const LOCATIONS: Record<string, LocationDef> = {
  BOSTON_STREET: {
    id: "BOSTON_STREET", label: "Boston street", anchor: [-6, 0, 1.5], faceY: Math.PI / 2, interior: false,
  },
  MERCER_PRESS: {
    id: "MERCER_PRESS", label: "Mercer's Press", anchor: [0, 0, 13.5], faceY: 0, interior: true,
    exitAnchor: [0, 0, 6.6], room: { center: [0, 14.1], size: [11, 8], doorSide: "S", doorX: -0.31 },
  },
  THOMAS_COUNTINGHOUSE: {
    id: "THOMAS_COUNTINGHOUSE", label: "Thomas Bell's counting-house", anchor: [-70, 0, -13.75], faceY: Math.PI, interior: true,
    exitAnchor: [-72, 0, -8.4], room: { center: [-70, -14.35], size: [12, 8.5], doorSide: "N", doorX: -72 },
  },
  PIKE_OFFICE: {
    id: "PIKE_OFFICE", label: "Pike's office", anchor: [30, 0, 13.9], faceY: 0, interior: true,
    exitAnchor: [30, 0, 9.2], room: { center: [30, 14.4], size: [9.5, 7.5], doorSide: "S", doorX: 30.08 },
  },
  CUSTOM_HOUSE: {
    id: "CUSTOM_HOUSE", label: "The Custom House", anchor: [55, 0, 13.6], faceY: 0, interior: true,
    exitAnchor: [55, 0, 8.1], room: { center: [55, 14.2], size: [13, 9], doorSide: "S", doorX: 55 },
  },
  CUSTOMS_POST: {
    id: "CUSTOMS_POST", label: "Customs checkpoint", anchor: [-56, 0, -2], faceY: -Math.PI / 2, interior: false,
  },
  RIDER_POST: {
    id: "RIDER_POST", label: "Town edge, rider post", anchor: [-95, 0, -17], faceY: -Math.PI / 2, interior: false,
  },
  CLARKE_DOORWAY: {
    id: "CLARKE_DOORWAY", label: "Clarke's doorway", anchor: [-32, 0, 8.6], faceY: 0, interior: false,
  },
  LIBERTY_TREE_APPROACH: {
    id: "LIBERTY_TREE_APPROACH", label: "The great elm", anchor: [89, 0, -19], faceY: 2.2, interior: false,
  },
};

// ---- Explorable interiors (Bible §4: ALL buildings enterable) ---------------
// Hero interiors above are runtime scenes; every other street-facing building
// gets a presentation-only room reached through the same door/threshold
// mechanics. Common rooms rotate 3 reusable dressing kits.
export type InteriorKitId = "home" | "shop" | "workroom" | "tavern" | "church" | "warehouse";

// Hand-authored explore rooms (bigger than the generated commons).
const EXPLORE_SPECIALS: Record<string, { label: string; kit: InteriorKitId; room: RoomDef }> = {
  tavern: { label: "The Bunch of Grapes", kit: "tavern", room: { center: [-18, -14.6], size: [10, 8], doorSide: "N", doorX: -18, height: 3.0 } },
  church: { label: "The meeting house", kit: "church", room: { center: [71.5, -15.5], size: [12, 10], doorSide: "N", doorX: 71.5, height: 4.3 } },
  warehouseHero: { label: "Town Wharf warehouse", kit: "warehouse", room: { center: [-155, -15], size: [13, 9], doorSide: "N", doorX: -153, height: 3.6 } },
  townhouse: { label: "Boston Watch House", kit: "workroom", room: { center: [53.5, -15], size: [14.5, 9.5], doorSide: "N", doorX: 53.5, height: 3.4 } },
};

const EXPLORE_KIT_BY_BUILDING: Record<string, InteriorKitId> = {
  warehouseN2: "workroom", warehouseN3: "workroom", ropewalk: "workroom",
  warehouseS: "workroom", townhouse: "workroom", rowN5: "workroom", rowS10: "workroom",
  chandlery: "shop", clarke: "shop", rowN8: "shop", rowN12: "shop", rowS6: "shop", rowS7: "shop",
  rowN1: "home", rowN2: "home", rowN3: "home", rowN4: "home", rowN6: "home", rowN7: "home",
  rowN9: "home", rowN10: "home", rowN11: "home",
  rowS1: "home", rowS2: "home", rowS3: "home", rowS4: "home", rowS5: "home", rowS8: "home", rowS9: "home",
};

const EXPLORE_LABELS: Partial<Record<InteriorKitId, string>> = {
  home: "A row home",
  shop: "A shopfront",
  workroom: "A workroom",
};

// Runtime hero buildings never get an explore portal (their doors belong to
// the errand flow); everything else does.
const RUNTIME_BUILDINGS = new Set(["mercer", "thomas", "pike", "customs"]);

export function exploreLocationId(buildingId: string): string {
  return `EXPLORE_${buildingId}`;
}

function buildExploreLocations(): Record<string, LocationDef> {
  const out: Record<string, LocationDef> = {};
  for (const b of BUILDINGS) {
    if (RUNTIME_BUILDINGS.has(b.id)) continue;
    const north = b.pos[2] < 0;
    const special = EXPLORE_SPECIALS[b.id];
    const kit = special?.kit ?? EXPLORE_KIT_BY_BUILDING[b.id] ?? "home";
    const room: RoomDef = special?.room ?? {
      center: [b.pos[0], b.pos[2] + (north ? 0.5 : -0.5)],
      size: [Math.max(4.5, b.size[0] - 1.2), Math.max(4.5, b.size[2] - 1.0)],
      doorSide: north ? "N" : "S",
      doorX: b.pos[0],
    };
    const doorZ = room.doorSide === "S"
      ? room.center[1] - room.size[1] / 2
      : room.center[1] + room.size[1] / 2;
    const inward = room.doorSide === "S" ? 1 : -1;
    const id = exploreLocationId(b.id);
    out[id] = {
      id,
      label: special?.label ?? EXPLORE_LABELS[kit] ?? "A room",
      anchor: [room.center[0], 0, doorZ + inward * 1.4],
      faceY: north ? Math.PI : 0,
      interior: true,
      exitAnchor: [room.center[0], 0, doorZ - inward * 1.4],
      room,
    };
  }
  return out;
}

export const EXPLORE_LOCATIONS: Record<string, LocationDef> = buildExploreLocations();

// Every interior the presenter can stand in (runtime heroes + explore rooms).
export const ALL_INTERIOR_LOCATIONS: Record<string, LocationDef> = {
  ...LOCATIONS,
  ...EXPLORE_LOCATIONS,
};

export const EXPLORE_KIT_ASSIGNMENT: Record<string, InteriorKitId> = Object.fromEntries(
  Object.keys(EXPLORE_LOCATIONS).map((locId) => {
    const buildingId = locId.replace(/^EXPLORE_/, "");
    return [locId, EXPLORE_SPECIALS[buildingId]?.kit ?? EXPLORE_KIT_BY_BUILDING[buildingId] ?? "home"];
  }),
);

// Which building shell to hide while an interior is active.
export const INTERIOR_BUILDING_ID: Record<string, string> = {
  MERCER_PRESS: "mercer",
  THOMAS_COUNTINGHOUSE: "thomas",
  PIKE_OFFICE: "pike",
  CUSTOM_HOUSE: "customs",
  ...Object.fromEntries(
    Object.keys(EXPLORE_LOCATIONS).map((locId) => [locId, locId.replace(/^EXPLORE_/, "")]),
  ),
};

// ---- Free-roam target anchors: runtime targetId -> world position ----------
export const MARKER_ANCHORS: Record<string, [number, number, number]> = {
  MERCER_PRESS: [-0.31, 0, 8.4],
  STREET: [0, 0, 1.5],
  THOMAS_CIRCULAR: [-70, 0, -9.3],
  PIKE_PROOF: [30, 0, 9.6],
  CUSTOMHOUSE_NOTICE: [55, 0, 8.5],
  TOWN_NOTICE_BOARD: [6, 0, 7.6],
  RIDER_HANDBILLS: [-12, 0, -2],
  MERCER_REPRINT: [-0.31, 0, 8.4],
  MERCER_RETURN: [-0.31, 0, 8.4],
  PIKE_RETURN: [30, 0, 9.6],
  // Rider run legs: three genuinely different corridors (Bible §3).
  CLARKE_ROUTE: [-32, 0, 8.6], // MAIN street, past Clarke's doorway
  CUSTOMS_ROUTE: [-56, 0, -2], // checkpoint by the market cluster
  RIDER_BACK_LANES: [-60, 0, -23], // mid north alley
  RIDER_DOCK_GATE: [-40, 0, 21.2], // chained gate, south alley west segment
  RIDER_POST_ROUTE: [-95, 0, -17],
  THOMAS_STREET: [-70, 0, -7.2],
  PIKE_STREET: [30, 0, 8.0],
  CUSTOMHOUSE_STREET: [55, 0, 7.1],
  CROWD: [89, 0, -19],
  INSPECTOR_OFFICE: [53.5, 0, -8.6],
  INSPECTOR_OFFICE_RELEASE: [49.8, 0, -8.2],
};

// ---- NPC staging (existing cast; a population worker densifies later) ------
export const NPCS: NpcDef[] = [
  { id: "abigail", name: "Abigail Mercer", glb: "abigail-rigged", height: 1.65, pos: interiorPoint("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_ABIGAIL_DESK), rotY: Math.PI, clip: "idle", interiorOf: "MERCER_PRESS" },
  { id: "thomas", name: "Thomas Bell", glb: "thomas-rigged", height: 1.74, pos: interiorPoint("THOMAS_COUNTINGHOUSE", INTERIOR_STORY_LOCAL.THOMAS_ACTOR), rotY: Math.PI, clip: "idle", interiorOf: "THOMAS_COUNTINGHOUSE" },
  { id: "pike", name: "Mr. Pike", glb: "pike-rigged", height: 1.7, pos: interiorPoint("PIKE_OFFICE", INTERIOR_STORY_LOCAL.PIKE_ACTOR), rotY: Math.PI, clip: "idle", interiorOf: "PIKE_OFFICE" },
  { id: "clerk", name: "Custom House clerk", glb: "clarke-rigged", height: 1.72, pos: interiorPoint("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_CLERK), rotY: Math.PI, clip: "idle", interiorOf: "CUSTOM_HOUSE" },
  { id: "clarke", name: "Edward Clarke", glb: "clarke-rigged", height: 1.77, pos: [-32, 0, 10.4], rotY: Math.PI, clip: "idle" },
  { id: "rider", name: "Post rider", glb: "rider-rigged", height: 1.76, pos: [-96.8, 0, -18.2], rotY: 0.9, clip: "idle" },
  { id: "officer", name: "Customs officer", glb: "officer-rigged", height: 1.78, pos: [-56, 0, -4.4], rotY: 1.9, clip: "idle" },
];

// ---- Zones (for the atmosphere/audio/population directors) -----------------
export type WorldZone = "WHARF" | "STREET" | "SQUARE" | "ALLEY" | "CHURCHYARD";

export function zoneForPosition(x: number, z: number): WorldZone {
  if (x <= -114) return "WHARF"; // apron + gate approach
  if (x >= 80) return "SQUARE"; // east gate apron + Liberty Tree pocket
  if (x >= 61 && x <= 79 && z <= -10) return "CHURCHYARD"; // passage + yard
  if (Math.abs(z) >= 19) return "ALLEY"; // both route corridors (+ boardwalk)
  if (x >= 45 && x <= 62 && Math.abs(z) < 11) return "SQUARE"; // Town House square
  return "STREET";
}

// ---- Static colliders: [cx, cz, halfX, halfZ] --------------------------------
export function exteriorColliders(
  routes: Record<string, string> = {},
  buildingOverride?: [number, number, number, number][],
  // Prop instances whose blocking is dynamically lifted (e.g. chase-verb
  // toppled stacks: the spilled staves are low scatter, passable for player
  // and pursuer alike — the pursuer pays with the authored stumble instead).
  excludedPropKeys?: ReadonlySet<string>,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = buildingOverride
    ? [...buildingOverride]
    : BUILDINGS.map((b) => [b.pos[0], b.pos[2], b.size[0] / 2, b.size[2] / 2]);
  for (const p of PROPS) {
    if (p.gate && routes[p.gate] === "UNLOCKED") continue;
    if (excludedPropKeys?.has(`${p.glb}@${p.pos[0]},${p.pos[2]}`)) continue;
    if (p.collide) out.push([p.pos[0], p.pos[2], p.collide[0] / 2, p.collide[1] / 2]);
  }
  for (const bar of BARRIERS) out.push([bar.pos[0], bar.pos[1], bar.size[0] / 2, bar.size[1] / 2]);
  for (const gate of GATES) {
    const wing = (gate.halfSpan - gate.halfOpening) / 2;
    const center = gate.halfOpening + wing;
    out.push([gate.x, -center, 1, wing]);
    out.push([gate.x, center, 1, wing]);
  }
  return out;
}
