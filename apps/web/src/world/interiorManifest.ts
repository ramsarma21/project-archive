import type { HistoricalClaimType } from "./interiorSources.js";

export type InteriorVec3 = [number, number, number];
export type InteriorSize3 = [number, number, number];

export type InteriorArchetype =
  | "PRINTSHOP"
  | "MERCHANT_SHOP"
  | "COURT_OFFICE"
  | "CUSTOM_HOUSE"
  | "TAVERN"
  | "MEETINGHOUSE"
  | "WAREHOUSE"
  | "MARITIME_STORE"
  | "ROPEWALK"
  | "CIVIC_HALL"
  | "TAILOR"
  | "SHOEMAKER"
  | "CHANDLERY"
  | "DRY_GOODS"
  | "PROVISIONS"
  | "BOOKSELLER"
  | "TEXTILE_SHOP"
  | "BAKERY"
  | "LABORER_HOME"
  | "ARTISAN_HOME"
  | "MIDDLING_HOME"
  | "PROSPEROUS_HOME"
  | "HOME_SHOP";

export type InteriorAudioProfile =
  | "PRESS"
  | "CHURCH"
  | "TAVERN"
  | "WAREHOUSE"
  | "WORKSHOP"
  | "HOME"
  | "CIVIC"
  | "ROPEWORK"
  | "SHOP";

export interface InteriorPropPlacement {
  id: string;
  glb: string;
  local: InteriorVec3;
  rotY: number;
  size: InteriorSize3;
  collide?: [number, number];
  tags?: string[];
}

export interface InteriorColliderDef {
  id: string;
  local: InteriorVec3;
  half: InteriorVec3;
  yaw?: number;
  tags: string[];
}

export interface InteriorOccupantDef {
  id: string;
  role: string;
  glb: string;
  local: InteriorVec3;
  faceLocal: InteriorVec3;
  clip: "idle" | "work1" | "work2" | "talk" | "talk2" | "walk" | "carryWalk";
  path?: InteriorVec3[];
}

export interface InteriorInspectHotspotDef {
  id: string;
  placementId: string;
  localAnchor: InteriorVec3;
  radius: number;
  facingDot: number;
  title: string;
  body: string;
  comparePrompt?: string;
  sourceRefs: string[];
  claimType: HistoricalClaimType;
}

export interface InteriorLightingDef {
  windowLocal: InteriorVec3;
  hearthLocal?: InteriorVec3;
  candleLocals: InteriorVec3[];
  /** Small rooms disable fog entirely; large halls keep depth-scaled fog. */
  fogEnabled: boolean;
  fogNear: number;
  fogFar: number;
}

export interface InteriorDef {
  id: string;
  buildingId: string;
  label: string;
  slot: number;
  layoutSeed: number;
  archetype: InteriorArchetype;
  palette: "PINE" | "SMOKE" | "PAINTED" | "CIVIC" | "WHARF";
  dimensions: InteriorSize3;
  origin: InteriorVec3;
  shellGlb: string;
  floorGlb: string;
  /**
   * Explicit yaw applied to the imported shell (radians). Legacy cutaway
   * assets authored their entrance on -X and must rotate -90° so it faces -Z;
   * canonical (regenerated) assets author the entrance on -Z with yaw 0.
   */
  shellYaw: number;
  /**
   * "legacy": pre-correction cutaway shell (per-axis fitting, embedded floor).
   * "canonical": regenerated 4-wall+ceiling shell (yaw 0, no floor, ≤1.15
   * horizontal anisotropy). Flip per shell as assets are regenerated.
   */
  shellContract: "legacy" | "canonical";
  partitions: InteriorPropPlacement[];
  entranceLocal: InteriorVec3;
  landingLocal: InteriorVec3;
  exitSensorLocal: InteriorVec3;
  faceY: number;
  camera: {
    maxBoom: number;
    minY: number;
    maxY: number;
    inset: number;
  };
  props: InteriorPropPlacement[];
  colliders: InteriorColliderDef[];
  occupants: InteriorOccupantDef[];
  lighting: InteriorLightingDef;
  audioProfile: InteriorAudioProfile;
  hotspots: InteriorInspectHotspotDef[];
}

export const INTERIOR_GRID_SPACING = 96;
export const INTERIOR_GRID_COLUMNS = 6;
export const INTERIOR_GRID_BASE = 640;

export function interiorOriginForSlot(slot: number): InteriorVec3 {
  return [
    INTERIOR_GRID_BASE + (slot % INTERIOR_GRID_COLUMNS) * INTERIOR_GRID_SPACING,
    0,
    INTERIOR_GRID_BASE + Math.floor(slot / INTERIOR_GRID_COLUMNS) * INTERIOR_GRID_SPACING,
  ];
}

export function addInteriorPoint(origin: InteriorVec3, local: InteriorVec3): InteriorVec3 {
  return [origin[0] + local[0], origin[1] + local[1], origin[2] + local[2]];
}

const INTERIOR_LEGACY_LOD_KEYS = new Set([
  "hearth-mantel",
  "bed-fourpost",
  "table-chairs-set",
  "storage-chest",
  "dresser-shelves",
  "washbasin-stand",
  "candle-sconce",
  "firewood-stack",
  "crate-stack",
  "spinning-wheel",
  "shop-counter-long",
  "clerk-desk",
  "barrel-group",
  "bookshelf-ledgers",
  "paper-satchel",
  "type-cases",
  "tankard-cluster",
  "tavern-bar-barrels",
  "notice-board",
  "cargo-net-bundle",
  "rope-coil-large",
]);

function p(
  id: string,
  glb: string,
  local: InteriorVec3,
  rotY: number,
  size: InteriorSize3,
  collide?: [number, number],
  tags?: string[],
): InteriorPropPlacement {
  return {
    id,
    glb: INTERIOR_LEGACY_LOD_KEYS.has(glb) ? `${glb}-interior-lod` : glb,
    local,
    rotY,
    size,
    collide,
    tags,
  };
}

function baseDomesticProps(
  width: number,
  depth: number,
  variant: number,
  wealth: "LABORER" | "ARTISAN" | "MIDDLING" | "PROSPEROUS",
): InteriorPropPlacement[] {
  const sx = variant % 2 ? -1 : 1;
  const bed = wealth === "LABORER" ? "storage-chest" : "bed-fourpost";
  const bedSize: InteriorSize3 = wealth === "LABORER" ? [1.5, 0.8, 0.8] : [2.2, 1.7, 1.7];
  return [
    p("hearth", "hearth-mantel", [0, 0, depth / 2 - 0.72], Math.PI, [2.2, 2.0, 0.8], [2.0, 0.8], ["hearth"]),
    p("sleeping", bed, [-sx * (width / 2 - 2.0), 0, depth / 2 - 2.3], sx > 0 ? Math.PI / 2 : -Math.PI / 2, bedSize, [2.1, 1.7], ["sleep"]),
    p("table", "table-chairs-set", [sx * 2.0, 0, 0.2], 0.18 * sx, [2.2, 1.2, 2.2], [2.1, 2.1], ["table"]),
    p("entry-chest", "storage-chest", [-sx * (width / 2 - 1.2), 0, -depth / 2 + 2.0], 0.1 * sx, [1.3, 0.8, 0.8], [1.2, 0.8], ["storage"]),
    p("dresser", "dresser-shelves", [sx * (width / 2 - 0.7), 0, depth / 2 - 2.1], -sx * Math.PI / 2, [1.8, 2.1, 0.7], [1.5, 0.65], ["storage"]),
    p("pantry", "int-pantry-cupboard-stocked", [sx * (width / 2 - 0.85), 0, -depth / 2 + 2.0], -sx * Math.PI / 2, [1.5, 2.0, 0.8], [1.35, 0.75], ["storage", "food"]),
    p("washstand", "washbasin-stand", [-sx * (width / 2 - 0.7), 0, -0.5], sx * Math.PI / 2, [1.1, 1.2, 0.8], [1.0, 0.75], ["domestic"]),
    p("foodware", "int-foodware-cluster", [sx * 2.0, 0.86, 0.1], 0.35, [0.9, 0.45, 0.8], undefined, ["clutter"]),
    p("textiles", "int-textile-personal-cluster", [-sx * (width / 2 - 1.2), 0.72, -depth / 2 + 2.0], -0.2, [1.0, 0.65, 0.9], undefined, ["clutter"]),
    p("mending", "int-repair-mending-cluster", [sx * 1.45, 0.88, 0.35], 0.28, [0.8, 0.45, 0.7], undefined, ["clutter"]),
    p("wall-pegs", "int-wall-peg-cluster", [-sx * (width / 2 - 0.18), 1.25, 1.0], sx * Math.PI / 2, [1.8, 1.25, 0.45], undefined, ["wall"]),
    p("candle-a", "candle-sconce", [sx * (width / 2 - 0.15), 1.45, -1.0], -sx * Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("candle-b", "candle-sconce", [-sx * (width / 2 - 0.15), 1.45, 1.5], sx * Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("firewood", "firewood-stack", [2.0, 0, depth / 2 - 1.0], 0.08, [1.5, 0.8, 0.8], [1.3, 0.7], ["fuel"]),
    p("basket-stock", "crate-stack", [-sx * (width / 2 - 1.0), 0, 0.8], 0.2, [1.0, 0.9, 0.9], [0.85, 0.85], ["storage"]),
    p("paper", "int-paper-surface-flat", [sx * 1.5, 0.9, -0.05], 0.2, [0.38, 0.08, 0.3], undefined, ["document"]),
    ...(wealth !== "LABORER"
      ? [p("spinning", "spinning-wheel", [-sx * 2.4, 0, -0.8], -0.35 * sx, [1.3, 1.5, 0.9], [1.2, 0.9], ["work"])]
      : [p("second-chest", "storage-chest", [sx * (width / 2 - 1.4), 0, 1.4], -0.18, [1.1, 0.65, 0.65], [1.0, 0.65], ["storage"])]),
  ];
}

function shopProps(
  width: number,
  depth: number,
  variant: number,
  tradeGlb: string,
): InteriorPropPlacement[] {
  const sx = variant % 2 ? -1 : 1;
  return [
    p("counter", "shop-counter-long", [0, 0, -1.0], 0, [5.2, 1.25, 1.25], [5.0, 1.15], ["counter"]),
    p("trade-stock", tradeGlb, [-sx * (width / 2 - 2.0), 0, depth / 2 - 2.1], 0.2 * sx, [2.8, 2.0, 2.2], [2.5, 2.0], ["stock"]),
    p("trade-stock-2", tradeGlb, [sx * (width / 2 - 2.0), 0, depth / 2 - 2.2], -0.22 * sx, [2.5, 1.8, 2.0], [2.2, 1.8], ["stock"]),
    p("shelves-a", "dresser-shelves", [-sx * (width / 2 - 0.65), 0, 0.8], sx * Math.PI / 2, [2.2, 2.2, 0.7], [1.8, 0.65], ["storage"]),
    p("shelves-b", "dresser-shelves", [sx * (width / 2 - 0.65), 0, 1.1], -sx * Math.PI / 2, [2.2, 2.2, 0.7], [1.8, 0.65], ["storage"]),
    p("desk", "clerk-desk", [sx * (width / 2 - 1.6), 0, depth / 2 - 1.0], Math.PI, [1.8, 1.7, 1.2], [1.6, 1.1], ["desk"]),
    p("scale", "merchant-scale-measure", [-sx * 1.8, 0.86, -0.95], 0, [1.0, 1.0, 0.7], undefined, ["trade"]),
    p("barrels", "barrel-group", [-sx * (width / 2 - 1.25), 0, -depth / 2 + 2.0], 0.4, [1.8, 1.3, 1.5], [1.6, 1.35], ["stock"]),
    p("crates", "crate-stack", [sx * (width / 2 - 1.2), 0, -depth / 2 + 2.0], -0.3, [1.7, 1.5, 1.5], [1.45, 1.35], ["stock"]),
    p("chest", "storage-chest", [sx * (width / 2 - 1.0), 0, -0.1], -0.1, [1.2, 0.7, 0.7], [1.1, 0.65], ["storage"]),
    p("peg", "int-wall-peg-cluster", [-sx * (width / 2 - 0.15), 1.3, -2.0], sx * Math.PI / 2, [1.8, 1.2, 0.4], undefined, ["wall"]),
    p("ledger-shelf", "bookshelf-ledgers", [0, 0, depth / 2 - 0.45], Math.PI, [2.2, 2.2, 0.65], [2.0, 0.6], ["records"]),
    p("paper-a", "int-paper-surface-flat", [-0.45, 1.03, -0.7], -0.1, [0.4, 0.08, 0.3], undefined, ["document"]),
    p("paper-b", "int-paper-surface-flat", [0.35, 1.03, -1.05], 0.12, [0.36, 0.08, 0.28], undefined, ["document"]),
    p("candle-a", "candle-sconce", [-width / 2 + 0.15, 1.45, 1.2], Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("candle-b", "candle-sconce", [width / 2 - 0.15, 1.45, 1.2], -Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("small-clutter", "int-repair-mending-cluster", [sx * 1.5, 1.02, -0.75], 0.2, [0.75, 0.4, 0.65], undefined, ["clutter"]),
    p("satchel", "paper-satchel", [-sx * 2.1, 0, depth / 2 - 1.0], -0.2, [0.9, 0.8, 0.9], [0.75, 0.75], ["storage"]),
  ];
}

function workroomProps(
  width: number,
  depth: number,
  variant: number,
  tradeGlb: string,
): InteriorPropPlacement[] {
  const sx = variant % 2 ? -1 : 1;
  return [
    p("trade-bench", tradeGlb, [sx * 2.5, 0, 1.0], -0.15 * sx, [3.0, 1.8, 2.2], [2.8, 2.0], ["work"]),
    p("trade-stock", tradeGlb, [-sx * (width / 2 - 2.0), 0, depth / 2 - 2.0], 0.25, [2.5, 1.7, 2.0], [2.2, 1.8], ["stock"]),
    p("work-table", "table-chairs-set", [-sx * 2.2, 0, -0.2], -0.25, [2.2, 1.1, 2.2], [2.0, 2.0], ["table"]),
    p("desk", "clerk-desk", [sx * (width / 2 - 1.6), 0, depth / 2 - 1.0], Math.PI, [1.8, 1.7, 1.2], [1.6, 1.1], ["desk"]),
    p("shelves", "dresser-shelves", [-sx * (width / 2 - 0.65), 0, 0.5], sx * Math.PI / 2, [2.2, 2.2, 0.7], [1.8, 0.65], ["storage"]),
    p("crate-a", "crate-stack", [-sx * (width / 2 - 1.2), 0, -depth / 2 + 2.0], 0.25, [1.8, 1.4, 1.5], [1.55, 1.35], ["stock"]),
    p("crate-b", "crate-stack", [sx * (width / 2 - 1.2), 0, -depth / 2 + 2.0], -0.18, [1.5, 1.2, 1.3], [1.3, 1.15], ["stock"]),
    p("barrels", "barrel-group", [sx * (width / 2 - 1.2), 0, -0.5], 0.75, [1.8, 1.3, 1.5], [1.55, 1.35], ["stock"]),
    p("hearth", "hearth-mantel", [0, 0, depth / 2 - 0.7], Math.PI, [2.2, 2.0, 0.8], [2.0, 0.8], ["hearth"]),
    p("peg", "int-wall-peg-cluster", [-sx * (width / 2 - 0.15), 1.25, -1.2], sx * Math.PI / 2, [1.8, 1.25, 0.45], undefined, ["wall"]),
    p("repair", "int-repair-mending-cluster", [-sx * 2.0, 0.86, -0.1], 0.2, [0.8, 0.45, 0.7], undefined, ["clutter"]),
    p("paper", "int-paper-surface-flat", [sx * (width / 2 - 1.6), 1.0, depth / 2 - 0.8], 0.15, [0.4, 0.08, 0.3], undefined, ["document"]),
    p("chest", "storage-chest", [sx * (width / 2 - 1.1), 0, 1.7], 0.15, [1.2, 0.7, 0.7], [1.1, 0.65], ["storage"]),
    p("candle-a", "candle-sconce", [-width / 2 + 0.15, 1.5, 1.8], Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("candle-b", "candle-sconce", [width / 2 - 0.15, 1.5, 1.8], -Math.PI / 2, [0.4, 0.8, 0.4], undefined, ["light"]),
    p("firewood", "firewood-stack", [2.0, 0, depth / 2 - 1.0], 0.1, [1.5, 0.8, 0.8], [1.3, 0.7], ["fuel"]),
  ];
}

function warehouseProps(width: number, depth: number, hero = false): InteriorPropPlacement[] {
  const out: InteriorPropPlacement[] = [
    p("scale", "warehouse-platform-scale", [-width / 2 + 3.0, 0, -depth / 2 + 3.0], 0.15, [2.8, 1.8, 2.0], [2.6, 1.9], ["trade"]),
    p("hoist", "warehouse-hoist-tackle", [width / 2 - 1.0, 2.5, depth / 2 - 2.0], -Math.PI / 2, [1.8, 2.4, 1.3], undefined, ["hoist"]),
    p("desk", "clerk-desk", [width / 2 - 2.0, 0, -depth / 2 + 2.2], 0, [2.0, 1.8, 1.4], [1.8, 1.25], ["desk"]),
    p("records", "bookshelf-ledgers", [width / 2 - 0.6, 0, -depth / 2 + 4.2], -Math.PI / 2, [2.0, 2.2, 0.7], [1.8, 0.65], ["records"]),
    p("tackle", "chandlery-stock-cluster", [-width / 2 + 2.0, 0, depth / 2 - 2.0], 0.35, [2.6, 1.7, 2.2], [2.4, 2.0], ["stock"]),
    p("cargo-net", "cargo-net-bundle", [0, 0, depth / 2 - 2.0], 0.2, [2.2, 1.5, 2.0], [2.0, 1.8], ["stock"]),
    p("rope", "rope-coil-large", [width / 2 - 2.0, 0, depth / 2 - 2.0], 0, [1.5, 0.6, 1.5], [1.4, 1.4], ["stock"]),
    p("paper", "int-paper-surface-flat", [width / 2 - 2.0, 1.15, -depth / 2 + 2.0], 0.1, [0.42, 0.08, 0.32], undefined, ["document"]),
    p("lantern-a", "candle-sconce", [-width / 2 + 0.15, 2.0, 0], Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
    p("lantern-b", "candle-sconce", [width / 2 - 0.15, 2.0, 0], -Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
  ];
  const bays = hero ? 14 : 9;
  for (let index = 0; index < bays; index++) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const x = side * (width / 2 - 2.0);
    const z = -depth / 2 + 5.2 + row * 2.1;
    out.push(
      p(
        `cargo-${index}`,
        index % 3 === 0 ? "barrel-group" : "crate-stack",
        [x, 0, Math.min(z, depth / 2 - 3.2)],
        side * (0.12 + (index % 3) * 0.08),
        index % 3 === 0 ? [2.0, 1.4, 1.7] : [2.2, 1.8 + (index % 2) * 0.3, 1.8],
        [1.9, 1.6],
        ["stock"],
      ),
    );
  }
  return out;
}

function heroProps(id: string, width: number, depth: number): InteriorPropPlacement[] {
  if (id === "MERCER_PRESS") {
    return [
      p("press-operable", "press-common-operable-v2", [-4.2, 0, 1.2], 0, [2.8, 3.2, 3.4], [2.5, 2.6], ["press", "story"]),
      p("press-second", "press-common-operable-v2", [-4.2, 0, 5.2], Math.PI, [2.6, 3.0, 3.2], [2.4, 2.5], ["press"]),
      p("composition", "printer-composition-workstation", [5.7, 0, 4.8], -Math.PI / 2, [3.0, 2.5, 2.1], [2.6, 1.9], ["trade"]),
      p("type-cases", "type-cases", [8.0, 0, 1.7], -Math.PI / 2, [2.4, 1.9, 1.3], [2.0, 1.1], ["trade"]),
      p("drying", "printer-drying-rack", [7.4, 0, 6.0], Math.PI, [2.8, 3.0, 1.6], [2.5, 1.3], ["trade"]),
      p("proof-table", "table-chairs-set", [1.8, 0, 4.2], 0.08, [2.4, 1.2, 2.2], [2.2, 2.0], ["story", "table"]),
      p("clerk-desk", "clerk-desk", [7.2, 0, -4.8], Math.PI, [2.0, 1.8, 1.4], [1.8, 1.2], ["desk"]),
      p("hearth", "hearth-mantel", [7.0, 0, depth / 2 - 0.7], Math.PI, [2.4, 2.1, 0.8], [2.2, 0.8], ["hearth"]),
      p("paper-store-a", "crate-stack", [-8.5, 0, 5.8], 0.2, [2.0, 1.7, 1.7], [1.8, 1.5], ["stock"]),
      p("paper-store-b", "crate-stack", [-8.0, 0, -5.5], -0.2, [1.8, 1.4, 1.5], [1.6, 1.3], ["stock"]),
      p("rag-bales", "int-textile-personal-cluster", [-7.0, 0, 7.0], 0.25, [2.2, 1.4, 1.6], [2.0, 1.4], ["stock"]),
      p("ink-barrel", "barrel-group", [-8.5, 0, -2.4], 0.55, [1.8, 1.3, 1.5], [1.6, 1.35], ["stock"]),
      p("satchel", "paper-satchel", [8.6, 0, -6.2], -0.2, [1.0, 0.8, 1.0], [0.8, 0.8], ["storage"]),
      p("records", "bookshelf-ledgers", [9.1, 0, -1.0], -Math.PI / 2, [2.0, 2.2, 0.7], [1.8, 0.65], ["records"]),
      p("peg", "int-wall-peg-cluster", [-10.8, 1.35, -2.0], Math.PI / 2, [1.8, 1.2, 0.45], undefined, ["wall"]),
      p("repair", "int-repair-mending-cluster", [2.3, 0.86, 4.1], 0.2, [0.8, 0.45, 0.7], undefined, ["clutter"]),
      p("foodware", "int-foodware-cluster", [7.0, 0.95, -4.5], 0.1, [0.8, 0.4, 0.7], undefined, ["clutter"]),
      p("proof-old", "int-paper-surface-flat", [1.5, 0.93, 4.1], -0.12, [0.45, 0.08, 0.34], undefined, ["document"]),
      p("proof-new", "int-paper-surface-flat", [2.1, 0.94, 4.2], 0.1, [0.45, 0.08, 0.34], undefined, ["document"]),
      p("paper-qu1", "int-paper-surface-flat", [7.2, 1.05, -4.8], 0.2, [0.42, 0.08, 0.32], undefined, ["document"]),
      p("chest", "storage-chest", [9.0, 0, 6.3], -0.15, [1.3, 0.8, 0.8], [1.2, 0.8], ["storage"]),
      p("firewood", "firewood-stack", [5.0, 0, 7.0], 0.12, [1.6, 0.9, 0.8], [1.4, 0.75], ["fuel"]),
      ...[-8, -4, 0, 4, 8].map((x, index) =>
        p(`candle-${index}`, "candle-sconce", [x, 1.6, depth / 2 - 0.15], Math.PI, [0.4, 0.8, 0.4], undefined, ["light"])),
      p("customer-stool-stock", "storage-chest", [-1.8, 0, -5.5], 0.08, [1.1, 0.65, 0.65], [1.0, 0.65], ["storage"]),
    ];
  }
  if (id === "THOMAS_COUNTINGHOUSE") {
    return [
      ...shopProps(width, depth, 1, "tailor-workbench-stock"),
      p("measuring-station", "merchant-scale-measure", [-6.5, 0, 3.8], 0.1, [1.7, 1.7, 1.1], [1.5, 1.0], ["trade", "story"]),
      p("cloth-a", "int-textile-personal-cluster", [-9.5, 0, 5.5], 0.25, [2.5, 1.6, 1.8], [2.2, 1.6], ["stock"]),
      p("cloth-b", "int-textile-personal-cluster", [9.3, 0, 5.4], -0.25, [2.5, 1.6, 1.8], [2.2, 1.6], ["stock"]),
      p("packing-a", "crate-stack", [-9.4, 0, -3.8], 0.3, [2.0, 1.7, 1.7], [1.8, 1.55], ["stock"]),
      p("packing-b", "barrel-group", [9.5, 0, -3.7], -0.25, [2.0, 1.4, 1.7], [1.8, 1.5], ["stock"]),
      p("hearth", "hearth-mantel", [0, 0, depth / 2 - 0.7], Math.PI, [2.3, 2.0, 0.8], [2.1, 0.8], ["hearth"]),
      p("ledger-case", "court-record-pigeonholes", [10.8, 0, 1.6], -Math.PI / 2, [2.2, 2.4, 0.7], [2.0, 0.65], ["records"]),
      p("counter-paper", "int-paper-surface-flat", [0.7, 1.03, -1.0], 0.12, [0.45, 0.08, 0.34], undefined, ["document"]),
      p("warehouse-scale", "warehouse-platform-scale", [-9.0, 0, 0.2], 0.1, [2.4, 1.5, 1.8], [2.2, 1.7], ["trade"]),
    ];
  }
  if (id === "PIKE_OFFICE") {
    return [
      ...shopProps(width, depth, 0, "bookseller-stock-cluster"),
      p("record-wall", "court-record-pigeonholes", [-8.8, 0, 3.0], Math.PI / 2, [2.3, 2.5, 0.75], [2.0, 0.7], ["records"]),
      p("record-wall-b", "court-record-pigeonholes", [-8.8, 0, 5.3], Math.PI / 2, [2.1, 2.3, 0.7], [1.9, 0.65], ["records"]),
      p("sealing-desk", "court-sealing-desk", [7.6, 0, 4.7], -Math.PI / 2, [2.0, 1.8, 1.3], [1.8, 1.2], ["story", "desk"]),
      p("sort-table", "table-chairs-set", [0, 0, 3.0], 0, [2.5, 1.2, 2.5], [2.4, 2.4], ["story", "table"]),
      p("sort-deed", "int-paper-surface-flat", [-0.7, 0.9, 2.7], -0.15, [0.4, 0.08, 0.3], undefined, ["document"]),
      p("sort-writ", "int-paper-surface-flat", [-0.2, 0.91, 3.0], 0.08, [0.4, 0.08, 0.3], undefined, ["document"]),
      p("sort-news", "int-paper-surface-flat", [0.35, 0.92, 2.8], -0.08, [0.42, 0.08, 0.32], undefined, ["document"]),
      p("sort-letter", "int-paper-surface-flat", [0.7, 0.93, 3.2], 0.2, [0.36, 0.08, 0.28], undefined, ["document"]),
      p("hearth", "hearth-mantel", [0, 0, depth / 2 - 0.7], Math.PI, [2.2, 2.0, 0.8], [2.0, 0.8], ["hearth"]),
    ];
  }
  if (id === "CUSTOM_HOUSE") {
    return [
      ...shopProps(width, depth, 1, "customs-seizure-shelf"),
      p("official-counter", "customhouse-counter-gate", [0, 0, 0], 0, [8.0, 1.4, 1.5], [7.7, 1.35], ["counter", "story"]),
      p("crown-arms", "crown-arms-1760", [0, 2.2, depth / 2 - 0.2], Math.PI, [2.5, 1.9, 0.5], undefined, ["authority"]),
      p("seizure-a", "customs-seizure-shelf", [-10.8, 0, 5.8], Math.PI / 2, [2.4, 2.3, 0.8], [2.1, 0.75], ["stock"]),
      p("seizure-b", "customs-seizure-shelf", [10.8, 0, 5.8], -Math.PI / 2, [2.4, 2.3, 0.8], [2.1, 0.75], ["stock"]),
      p("records-a", "court-record-pigeonholes", [-11.6, 0, 2.5], Math.PI / 2, [2.2, 2.4, 0.7], [2.0, 0.65], ["records"]),
      p("records-b", "bookshelf-ledgers", [11.6, 0, 2.5], -Math.PI / 2, [2.2, 2.4, 0.7], [2.0, 0.65], ["records"]),
      p("sealing", "court-sealing-desk", [8.6, 0, 5.0], -Math.PI / 2, [2.0, 1.8, 1.3], [1.8, 1.2], ["desk"]),
      p("posting-board", "notice-board", [-9.5, 0, 6.9], Math.PI, [2.6, 2.8, 0.9], [2.3, 0.8], ["story", "posting"]),
      p("proclamation", "int-paper-surface-flat", [-9.25, 1.55, 6.45], Math.PI, [0.45, 0.08, 0.34], undefined, ["document"]),
      p("scale-floor", "warehouse-platform-scale", [9.2, 0, -5.7], 0.2, [2.4, 1.6, 1.8], [2.2, 1.7], ["trade"]),
      p("queue-bench-a", "tavern-table-set", [-6.8, 0, -4.8], Math.PI / 2, [2.0, 1.0, 1.6], [1.8, 1.5], ["public"]),
      p("queue-bench-b", "tavern-table-set", [6.8, 0, -4.8], -Math.PI / 2, [2.0, 1.0, 1.6], [1.8, 1.5], ["public"]),
    ];
  }
  if (id === "EXPLORE_tavern") {
    return [
      ...shopProps(width, depth, 0, "tavern-serving-dresser"),
      p("bar", "tavern-bar-barrels", [-8.5, 0, 1.5], Math.PI / 2, [1.5, 1.3, 5.0], [1.4, 4.7], ["bar"]),
      p("serving-dresser", "tavern-serving-dresser", [-10.1, 0, 5.7], Math.PI / 2, [2.0, 2.4, 0.8], [1.8, 0.75], ["service"]),
      p("hearth", "hearth-mantel", [6.0, 0, depth / 2 - 0.7], Math.PI, [2.6, 2.2, 0.9], [2.4, 0.85], ["hearth"]),
      ...[[-4, -2.8], [1, -2.8], [6, -2.5], [-1.5, 2.7], [4.0, 3.0]].map(([x, z], index) =>
        p(`tap-table-${index}`, "tavern-table-set", [x!, 0, z!], (index % 2 ? -0.25 : 0.22), [2.2, 1.1, 2.0], [2.0, 1.8], ["table"])),
      ...[[-4, -2.8], [1, -2.8], [6, -2.5]].map(([x, z], index) =>
        p(`tankards-${index}`, "tankard-cluster", [x!, 0.83, z!], index * 0.3, [0.65, 0.35, 0.65], undefined, ["clutter"])),
      p("pantry", "int-pantry-cupboard-stocked", [10.0, 0, 5.4], -Math.PI / 2, [1.8, 2.3, 0.9], [1.6, 0.85], ["food"]),
      p("foodware", "int-foodware-cluster", [-8.0, 1.0, 1.4], 0.3, [0.9, 0.45, 0.8], undefined, ["clutter"]),
      p("barrels-a", "barrel-group", [-9.7, 0, -4.8], 0.55, [2.0, 1.4, 1.7], [1.8, 1.5], ["stock"]),
      p("barrels-b", "barrel-group", [9.2, 0, -5.2], -0.45, [2.0, 1.4, 1.7], [1.8, 1.5], ["stock"]),
      p("peg", "int-wall-peg-cluster", [10.8, 1.3, -1.0], -Math.PI / 2, [1.8, 1.2, 0.45], undefined, ["wall"]),
      p("notice", "int-paper-surface-flat", [-10.7, 1.7, -1.5], Math.PI / 2, [0.4, 0.08, 0.3], undefined, ["document"]),
    ];
  }
  if (id === "EXPLORE_church") {
    const out: InteriorPropPlacement[] = [
      p("pulpit", "meetinghouse-pulpit-soundingboard", [0, 0, depth / 2 - 3.0], Math.PI, [3.2, 5.8, 2.6], [2.8, 2.2], ["pulpit"]),
      p("deacons", "meetinghouse-deacons-set", [0, 0, depth / 2 - 7.0], Math.PI, [5.0, 1.6, 2.5], [4.6, 2.2], ["church"]),
      p("vestry", "int-partition-plaster-a", [width / 2 - 3.0, 0, depth / 2 - 7.0], Math.PI / 2, [6.0, 4.2, 0.5], [5.8, 0.45], ["partition"]),
      p("vestry-cupboard", "bookshelf-ledgers", [width / 2 - 0.6, 0, depth / 2 - 4.0], -Math.PI / 2, [2.3, 2.6, 0.8], [2.1, 0.75], ["records"]),
      p("bible-paper", "int-paper-surface-flat", [0, 1.55, depth / 2 - 3.4], Math.PI, [0.55, 0.1, 0.4], undefined, ["document"]),
    ];
    for (let row = 0; row < 6; row++) {
      const z = -10.5 + row * 3.2;
      out.push(
        p(`pew-l-${row}`, "meetinghouse-box-pew-block", [-7.5, 0, z], 0, [5.7, 1.5, 2.6], [5.4, 2.35], ["pew"]),
        p(`pew-r-${row}`, "meetinghouse-box-pew-block", [7.5, 0, z], Math.PI, [5.7, 1.5, 2.6], [5.4, 2.35], ["pew"]),
      );
    }
    for (let index = 0; index < 5; index++) {
      out.push(p(`gallery-l-${index}`, "meetinghouse-gallery-impression", [-13.1, 3.4, -12 + index * 6], Math.PI / 2, [5.8, 3.8, 0.9], undefined, ["gallery"]));
      out.push(p(`gallery-r-${index}`, "meetinghouse-gallery-impression", [13.1, 3.4, -12 + index * 6], -Math.PI / 2, [5.8, 3.8, 0.9], undefined, ["gallery"]));
    }
    out.push(
      p("gallery-rear-a", "meetinghouse-gallery-impression", [-6.0, 3.4, -18.2], 0, [6.0, 3.8, 0.9], undefined, ["gallery"]),
      p("gallery-rear-b", "meetinghouse-gallery-impression", [6.0, 3.4, -18.2], 0, [6.0, 3.8, 0.9], undefined, ["gallery"]),
      p("sconce-a", "candle-sconce", [-13.3, 2.1, 4.0], Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
      p("sconce-b", "candle-sconce", [13.3, 2.1, 4.0], -Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
      p("sconce-c", "candle-sconce", [-13.3, 2.1, -8.0], Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
      p("sconce-d", "candle-sconce", [13.3, 2.1, -8.0], -Math.PI / 2, [0.5, 0.9, 0.5], undefined, ["light"]),
    );
    return out;
  }
  return warehouseProps(width, depth, true);
}

function hotspotsFor(
  id: string,
  archetype: InteriorArchetype,
  width: number,
  depth: number,
): InteriorInspectHotspotDef[] {
  const hero: Record<string, InteriorInspectHotspotDef[]> = {
    MERCER_PRESS: [
      {
        id: "mercer-press",
        placementId: "press-operable",
        localAnchor: [-4.2, 1.1, 0.1],
        radius: 1.8,
        facingDot: 0.15,
        title: "The common press",
        body: "A wooden common press forced paper against hand-set type one sheet at a time. The pressman pulled the bar while a partner inked the type. A practiced pair might produce hundreds of impressions, but every page still passed through this physical cycle.",
        sourceRefs: ["CW_PRINTER"],
        claimType: "DOCUMENTED",
      },
      {
        id: "mercer-type",
        placementId: "composition",
        localAnchor: [5.7, 1.1, 4.0],
        radius: 1.7,
        facingDot: 0.1,
        title: "Type cases and composition",
        body: "Compositors selected individual metal letters from divided cases, arranged words backward in a composing stick, and locked finished pages into an iron chase. The many compartments explain why an experienced printer could work far faster than someone unfamiliar with the case.",
        sourceRefs: ["CW_PRINTER"],
        claimType: "DOCUMENTED",
      },
      {
        id: "mercer-drying",
        placementId: "drying",
        localAnchor: [7.2, 1.1, 5.2],
        radius: 1.7,
        facingDot: 0.1,
        title: "Sheets hung to dry",
        body: "Freshly printed paper could be hung on overhead racks or lines while its oil-based ink set. The crowded drying area is part of production, not decoration: unfinished sheets had to remain organized without smearing before folding, binding, sale, or delivery.",
        sourceRefs: ["CW_PRINTER"],
        claimType: "DOCUMENTED",
      },
      {
        id: "mercer-proofs",
        placementId: "proof-old",
        localAnchor: [1.8, 1.0, 3.4],
        radius: 1.5,
        facingDot: 0.1,
        title: "Proof, correction, and authority",
        body: "A proof let the printer catch errors before committing a full run. In 1765 the new stamp requirement changed the legal and economic status of many printed papers, even when the words and the printer’s skilled labor remained the same.",
        comparePrompt: "What changed between the plain proof and the stamped copy—and what did not?",
        sourceRefs: ["CW_PRINTER"],
        claimType: "DOCUMENTED",
      },
    ],
    THOMAS_COUNTINGHOUSE: [
      {
        id: "thomas-ledger",
        placementId: "ledger-case",
        localAnchor: [10.0, 1.1, 1.6],
        radius: 1.7,
        facingDot: 0.1,
        title: "The merchant’s daybooks",
        body: "A counting house was the merchant’s business office: clerks maintained daybooks, correspondence, cargo accounts, debts, and prices. The shelves turn goods on the floor into a network of promises and obligations that could reach ships, suppliers, customers, and creditors.",
        sourceRefs: ["NPS_COUNTINGHOUSE", "CSM_MERCHANT_DESK"],
        claimType: "DOCUMENTED",
      },
      {
        id: "thomas-measure",
        placementId: "measuring-station",
        localAnchor: [-6.5, 1.0, 3.0],
        radius: 1.7,
        facingDot: 0.1,
        title: "Measured goods",
        body: "Cloth and other merchandise were counted, weighed, or measured before their values entered the books. The scale and yard measure connect physical labor to accounting: an error at this bench could become an argument over price, credit, or a shipment’s contents.",
        sourceRefs: ["NPS_COUNTINGHOUSE", "CSM_MERCHANT_DESK"],
        claimType: "REPRESENTATIVE",
      },
    ],
    PIKE_OFFICE: [
      {
        id: "pike-records",
        placementId: "record-wall",
        localAnchor: [-8.0, 1.2, 3.0],
        radius: 1.7,
        facingDot: 0.1,
        title: "Records in pigeonholes",
        body: "Courts and clerks handled deeds, writs, bonds, letters, and printed forms whose legal uses differed. Pigeonholes and tied bundles made those differences visible in the room: the paper’s form and official handling mattered as much as the writing upon it.",
        sourceRefs: ["CSM_MERCHANT_DESK", "CUSTOMS_CONTEXT"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: "pike-sealing",
        placementId: "sealing-desk",
        localAnchor: [7.0, 1.0, 4.0],
        radius: 1.7,
        facingDot: 0.1,
        title: "Ink, wax, and authentication",
        body: "Quills and ink recorded an act; seals and official forms helped authenticate it. The tools here do not make every document identical. They show several overlapping systems—handwriting, print, signatures, seals, fees, and custody—used to establish authority.",
        sourceRefs: ["CUSTOMS_CONTEXT"],
        claimType: "REPRESENTATIVE",
      },
    ],
    CUSTOM_HOUSE: [
      {
        id: "custom-counter",
        placementId: "official-counter",
        localAnchor: [0, 1.0, -1.4],
        radius: 1.8,
        facingDot: 0.1,
        title: "The public counter",
        body: "The counter separates petitioners and merchants from the clerks who control records, payments, and official procedure. A Custom House was both a workplace and a checkpoint: paperwork translated Parliament’s revenue policy into encounters between local trade and imperial authority.",
        sourceRefs: ["CUSTOMS_CONTEXT"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: "custom-arms",
        placementId: "crown-arms",
        localAnchor: [0, 1.6, depth / 2 - 1.0],
        radius: 2.2,
        facingDot: 0.1,
        title: "Authority made visible",
        body: "The royal arms identify whose authority the office represents. In a room devoted to duties and enforcement, heraldry is not merely ornamental: it frames local clerks and posted notices as instruments of Crown and parliamentary government.",
        sourceRefs: ["CUSTOMS_CONTEXT"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: "custom-posting",
        placementId: "posting-board",
        localAnchor: [-9.0, 1.4, 6.0],
        radius: 1.7,
        facingDot: 0.1,
        title: "Official and private notices",
        body: "Public boards placed official proclamations beside commercial notices and local appeals. Their proximity did not give every sheet equal authority. Readers had to judge who issued a notice, what institution backed it, and whether it asked, advertised, ordered, or warned.",
        sourceRefs: ["CUSTOMS_CONTEXT"],
        claimType: "REPRESENTATIVE",
      },
    ],
    EXPLORE_church: [
      {
        id: "church-pews",
        placementId: "pew-l-2",
        localAnchor: [-7.5, 1.0, -4.0],
        radius: 1.8,
        facingDot: 0.05,
        title: "Enclosed box pews",
        body: "Old South’s original interior used paneled box pews rather than the later open slip pews. Families occupied enclosed seating, while placement within the meetinghouse reflected age, status, gender, race, and other divisions in the congregation.",
        sourceRefs: ["NPS_OLD_SOUTH", "BOSTON_OLD_SOUTH"],
        claimType: "DOCUMENTED",
      },
      {
        id: "church-gallery",
        placementId: "gallery-l-2",
        localAnchor: [-11.5, 1.4, 0],
        radius: 2.0,
        facingDot: 0,
        title: "The galleries",
        body: "Galleries wrapped three sides of the historic meetinghouse. They increased capacity but also organized people socially. Apprentices, servants, teenagers, and Black congregants could be assigned gallery seating, making the architecture itself part of the town’s hierarchy.",
        sourceRefs: ["NPS_OLD_SOUTH", "BOSTON_OLD_SOUTH"],
        claimType: "DOCUMENTED",
      },
      {
        id: "church-pulpit",
        placementId: "pulpit",
        localAnchor: [0, 1.5, depth / 2 - 5.0],
        radius: 2.1,
        facingDot: 0.05,
        title: "Pulpit and sounding board",
        body: "The high pulpit focused the room on spoken preaching. A wooden sounding board above it reflected the minister’s voice toward a large congregation. This was a meetinghouse rather than a later Victorian church interior: there is no altar, organ, or decorative cross.",
        sourceRefs: ["NPS_OLD_SOUTH"],
        claimType: "DOCUMENTED",
      },
    ],
    EXPLORE_tavern: [
      {
        id: "tavern-service",
        placementId: "bar",
        localAnchor: [-7.5, 1.0, 1.5],
        radius: 1.8,
        facingDot: 0.05,
        title: "A working public house",
        body: "Boston taverns sold drink and meals, lodged travelers, and provided rooms for business and conversation. Surviving descriptions of comparable inns mention halls with tables and benches, a bar or taproom, shelves, service spaces, and more private chambers.",
        sourceRefs: ["BUNCH_OF_GRAPES"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: "tavern-news",
        placementId: "notice",
        localAnchor: [-9.8, 1.4, -1.5],
        radius: 1.6,
        facingDot: 0.05,
        title: "News over a shared table",
        body: "A tavern joined hospitality to information. Travelers brought reports, newspapers circulated, merchants met associates, and political conversation mixed with ordinary business. The room was public enough for news to spread, but never neutral or equally safe for every speaker.",
        sourceRefs: ["BUNCH_OF_GRAPES"],
        claimType: "REPRESENTATIVE",
      },
    ],
    EXPLORE_warehouseHero: [
      {
        id: "warehouse-scale",
        placementId: "scale",
        localAnchor: [-width / 2 + 3.0, 1.0, -depth / 2 + 2.0],
        radius: 1.8,
        facingDot: 0.05,
        title: "Weighing and tallying",
        body: "Goods entering a warehouse had to be identified, counted, weighed, and matched to records. The scale and clerk’s desk show two halves of the same task: controlling the physical cargo and controlling the written account of who owned it.",
        sourceRefs: ["NPS_COUNTINGHOUSE"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: "warehouse-desk",
        placementId: "desk",
        localAnchor: [width / 2 - 2.0, 1.0, -depth / 2 + 1.3],
        radius: 1.7,
        facingDot: 0.05,
        title: "The counting enclosure",
        body: "A heated or plastered counting corner inside a warehouse signaled regular clerical work amid bulk storage. The desk, ledgers, and lockable enclosure gave merchants and clerks a place to reconcile cargo movements with correspondence and credit.",
        sourceRefs: ["NPS_COUNTINGHOUSE"],
        claimType: "DOCUMENTED",
      },
    ],
  };
  if (hero[id]) return hero[id];
  if (archetype.endsWith("_HOME") || archetype === "HOME_SHOP") {
    return [
      {
        id: `${id}-room`,
        placementId: "hearth",
        localAnchor: [0, 1.0, depth / 2 - 1.6],
        radius: 1.7,
        facingDot: 0.05,
        title: "One room, many uses",
        body: "Most Boston households did not divide every activity into a separate modern room. Cooking, eating, mending, reading, business, storage, and sometimes sleeping shared the same floor. Furniture moved as work changed through the day and night.",
        sourceRefs: ["PAUL_REVERE_HOUSE", "NPS_REVERE_HFR"],
        claimType: "REPRESENTATIVE",
      },
      {
        id: `${id}-repair`,
        placementId: "mending",
        localAnchor: [1.5, 0.9, 0],
        radius: 1.5,
        facingDot: 0,
        title: "Repair before replacement",
        body: "Clothing, tools, hinges, furniture, and containers were repeatedly mended. The patches and spare pieces make the room look imperfect because a functioning household preserved useful material instead of presenting a matched set of new possessions.",
        sourceRefs: ["NPS_REVERE_HFR"],
        claimType: "REPRESENTATIVE",
      },
    ];
  }
  if (archetype === "WAREHOUSE" || archetype === "MARITIME_STORE") {
    return [
      {
        id: `${id}-tally`,
        placementId: "scale",
        localAnchor: [-width / 2 + 3, 1, -depth / 2 + 2],
        radius: 1.7,
        facingDot: 0,
        title: "Cargo becomes an account",
        body: "Warehouse labor did not end when a crate crossed the threshold. Goods were weighed, sorted, marked, and entered into records so merchants could track ownership, credit, loss, and onward sale before transfer to another buyer.",
        sourceRefs: ["NPS_COUNTINGHOUSE"],
        claimType: "REPRESENTATIVE",
      },
    ];
  }
  return [
    {
      id: `${id}-trade`,
      placementId: archetype === "TAILOR" || archetype === "SHOEMAKER" ? "trade-bench" : "trade-stock",
      localAnchor: [0, 1, 2],
      radius: 1.7,
      facingDot: 0,
      title: "Skill stored in tools",
      body: "An eighteenth-century shop was organized around repeated hand work. Tools stayed close to the bench, materials occupied useful storage, and partly finished goods showed where an apprentice or master would resume the next task with practiced efficiency.",
      sourceRefs: ["CW_TRADES"],
      claimType: "REPRESENTATIVE",
    },
  ];
}

function occupantsFor(
  id: string,
  archetype: InteriorArchetype,
  width: number,
  depth: number,
): InteriorOccupantDef[] {
  if (id === "MERCER_PRESS") {
    return [
      { id: "compositor", role: "compositor", glb: "townsman-rigged", local: [5.0, 0, 4.0], faceLocal: [5.8, 0, 5.0], clip: "work1" },
      { id: "press-helper", role: "press helper", glb: "townswoman-rigged", local: [-6.2, 0, 1.0], faceLocal: [-4.2, 0, 1.2], clip: "work2" },
    ];
  }
  if (id === "THOMAS_COUNTINGHOUSE") {
    return [
      { id: "thomas-clerk", role: "clerk", glb: "taxclerk-rigged", local: [8.0, 0, 4.0], faceLocal: [7.2, 0, 5.0], clip: "work2" },
      { id: "porter", role: "porter", glb: "dockhand-rigged", local: [-8.0, 0, -3.0], faceLocal: [-6.5, 0, 3.8], clip: "work1" },
      { id: "customer", role: "customer", glb: "townswoman-rigged", local: [3.0, 0, -4.0], faceLocal: [0, 0, -1], clip: "idle" },
    ];
  }
  if (id === "PIKE_OFFICE") {
    return [
      { id: "junior-clerk", role: "junior clerk", glb: "taxclerk-rigged", local: [-6.5, 0, 3.5], faceLocal: [-8.0, 0, 3.0], clip: "work2" },
      { id: "visitor", role: "visitor", glb: "townswoman-rigged", local: [4.0, 0, -3.5], faceLocal: [0, 0, -1], clip: "idle" },
    ];
  }
  if (id === "CUSTOM_HOUSE") {
    return [
      { id: "custom-clerk-a", role: "clerk", glb: "taxclerk-rigged", local: [-4.5, 0, 4.0], faceLocal: [-4.5, 0, 0], clip: "work2" },
      { id: "custom-clerk-b", role: "clerk", glb: "townsman-rigged", local: [4.5, 0, 4.0], faceLocal: [4.5, 0, 0], clip: "work1" },
      { id: "merchant-visitor", role: "merchant visitor", glb: "townsman-rigged", local: [0, 0, -5.0], faceLocal: [0, 0, 0], clip: "idle" },
    ];
  }
  if (archetype === "MEETINGHOUSE") {
    return [
      { id: "sexton", role: "sexton", glb: "townsman-rigged", local: [0, 0, depth / 2 - 7], faceLocal: [0, 0, depth / 2 - 3], clip: "work1" },
      { id: "congregant-a", role: "congregant", glb: "townswoman-rigged", local: [-2.2, 0, -6], faceLocal: [0, 0, depth / 2 - 3], clip: "idle" },
      { id: "congregant-b", role: "congregant", glb: "townsman-rigged", local: [2.2, 0, -10], faceLocal: [0, 0, depth / 2 - 3], clip: "idle" },
    ];
  }
  if (archetype === "TAVERN") {
    return [
      { id: "keeper", role: "tavern keeper", glb: "townsman-rigged", local: [-7.0, 0, 1.0], faceLocal: [-4.0, 0, 0], clip: "work1" },
      { id: "patron-a", role: "patron", glb: "townsman-rigged", local: [1.0, 0, -2.0], faceLocal: [3.0, 0, -2.0], clip: "talk2" },
      { id: "patron-b", role: "patron", glb: "townswoman-rigged", local: [3.0, 0, -2.0], faceLocal: [1.0, 0, -2.0], clip: "talk" },
    ];
  }
  if (archetype === "WAREHOUSE" || archetype === "MARITIME_STORE") {
    return [
      { id: "store-worker", role: "warehouse worker", glb: "dockhand-rigged", local: [-width / 2 + 4, 0, 0], faceLocal: [-width / 2 + 2, 0, 3], clip: "work1" },
      { id: "tally-clerk", role: "tally clerk", glb: "townsman-rigged", local: [width / 2 - 3, 0, -depth / 2 + 3], faceLocal: [width / 2 - 2, 0, -depth / 2 + 2], clip: "work2" },
    ];
  }
  if (archetype.endsWith("_HOME") || archetype === "HOME_SHOP") {
    return [
      { id: "resident", role: "resident", glb: "townswoman-rigged", local: [2.0, 0, 0.2], faceLocal: [0, 0, depth / 2 - 0.7], clip: "work2" },
    ];
  }
  return [
    { id: "keeper", role: "keeper", glb: "townsman-rigged", local: [2.5, 0, 2.5], faceLocal: [0, 0, -1], clip: "work1" },
    { id: "customer", role: "customer", glb: "townswoman-rigged", local: [-2.0, 0, -3.0], faceLocal: [0, 0, -1], clip: "idle" },
  ];
}

interface InteriorSpec {
  id: string;
  buildingId: string;
  label: string;
  slot: number;
  archetype: InteriorArchetype;
  dimensions: InteriorSize3;
  shellGlb: string;
  floorGlb: string;
  palette: InteriorDef["palette"];
  tradeGlb?: string;
  variant?: number;
}

const SPECS: InteriorSpec[] = [
  { id: "MERCER_PRESS", buildingId: "mercer", label: "Mercer's Press", slot: 0, archetype: "PRINTSHOP", dimensions: [22, 4.2, 16], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-brick-work-a", palette: "SMOKE" },
  { id: "THOMAS_COUNTINGHOUSE", buildingId: "thomas", label: "Thomas Bell's counting-house", slot: 1, archetype: "MERCHANT_SHOP", dimensions: [24, 4.2, 16], shellGlb: "int-shell-workroom-a", floorGlb: "int-floor-wide-pine-b", palette: "PINE" },
  { id: "PIKE_OFFICE", buildingId: "pike", label: "Pike's office and workroom", slot: 2, archetype: "COURT_OFFICE", dimensions: [20, 3.8, 15], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-a", palette: "PAINTED" },
  { id: "CUSTOM_HOUSE", buildingId: "customs", label: "The Custom House", slot: 3, archetype: "CUSTOM_HOUSE", dimensions: [26, 4.8, 18], shellGlb: "int-shell-civic-a", floorGlb: "int-floor-wide-pine-b", palette: "CIVIC" },
  { id: "EXPLORE_warehouseHero", buildingId: "warehouseHero", label: "Town Wharf warehouse", slot: 4, archetype: "WAREHOUSE", dimensions: [30, 5.5, 22], shellGlb: "int-shell-warehouse-a", floorGlb: "int-floor-brick-work-a", palette: "WHARF" },
  { id: "EXPLORE_warehouseN2", buildingId: "warehouseN2", label: "A maritime counting store", slot: 5, archetype: "MARITIME_STORE", dimensions: [24, 4.8, 18], shellGlb: "int-shell-warehouse-a", floorGlb: "int-floor-brick-work-a", palette: "WHARF" },
  { id: "EXPLORE_warehouseN3", buildingId: "warehouseN3", label: "A working cargo warehouse", slot: 6, archetype: "WAREHOUSE", dimensions: [28, 5.2, 20], shellGlb: "int-shell-warehouse-a", floorGlb: "int-floor-brick-work-a", palette: "WHARF" },
  { id: "EXPLORE_rowN1", buildingId: "rowN1", label: "A dockworker's home", slot: 7, archetype: "LABORER_HOME", dimensions: [14, 3.2, 11], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-a", palette: "SMOKE", variant: 0 },
  { id: "EXPLORE_rowN2", buildingId: "rowN2", label: "A prosperous merchant home", slot: 8, archetype: "PROSPEROUS_HOME", dimensions: [20, 3.8, 15], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-b", palette: "PAINTED", variant: 1 },
  { id: "EXPLORE_rowN3", buildingId: "rowN3", label: "A middling family home", slot: 9, archetype: "MIDDLING_HOME", dimensions: [17, 3.5, 13], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-a", palette: "PINE", variant: 2 },
  { id: "EXPLORE_rowN4", buildingId: "rowN4", label: "An artisan's home", slot: 10, archetype: "ARTISAN_HOME", dimensions: [16, 3.4, 12], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-b", palette: "SMOKE", variant: 3 },
  { id: "EXPLORE_rowN5", buildingId: "rowN5", label: "A tailor's workroom", slot: 11, archetype: "TAILOR", dimensions: [18, 3.8, 14], shellGlb: "int-shell-workroom-a", floorGlb: "int-floor-wide-pine-a", palette: "PINE", tradeGlb: "tailor-workbench-stock", variant: 0 },
  { id: "EXPLORE_rowN6", buildingId: "rowN6", label: "A prosperous shopkeeper's home", slot: 12, archetype: "PROSPEROUS_HOME", dimensions: [18, 3.8, 14], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-b", palette: "PAINTED", variant: 4 },
  { id: "EXPLORE_tavern", buildingId: "tavern", label: "The Bunch of Grapes", slot: 13, archetype: "TAVERN", dimensions: [22, 4.0, 17], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-b", palette: "SMOKE" },
  { id: "EXPLORE_rowN7", buildingId: "rowN7", label: "An artisan's home", slot: 14, archetype: "ARTISAN_HOME", dimensions: [16, 3.4, 12], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-a", palette: "PINE", variant: 5 },
  { id: "EXPLORE_rowN8", buildingId: "rowN8", label: "A provisions shop", slot: 15, archetype: "PROVISIONS", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-b", palette: "PINE", tradeGlb: "provisions-stock-cluster", variant: 1 },
  { id: "EXPLORE_rowN9", buildingId: "rowN9", label: "A carpenter's home-work room", slot: 16, archetype: "ARTISAN_HOME", dimensions: [16, 3.4, 12], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-b", palette: "SMOKE", variant: 6 },
  { id: "EXPLORE_rowN10", buildingId: "rowN10", label: "A laborer's family room", slot: 17, archetype: "LABORER_HOME", dimensions: [14, 3.2, 11], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-a", palette: "SMOKE", variant: 7 },
  { id: "EXPLORE_rowN11", buildingId: "rowN11", label: "A middling family home", slot: 18, archetype: "MIDDLING_HOME", dimensions: [17, 3.5, 13], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-b", palette: "PINE", variant: 8 },
  { id: "EXPLORE_rowN12", buildingId: "rowN12", label: "A bookseller and stationer", slot: 19, archetype: "BOOKSELLER", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-a", palette: "PAINTED", tradeGlb: "bookseller-stock-cluster", variant: 2 },
  { id: "EXPLORE_townhouse", buildingId: "townhouse", label: "Boston Watch House", slot: 20, archetype: "CIVIC_HALL", dimensions: [24, 5.0, 18], shellGlb: "int-shell-civic-a", floorGlb: "int-floor-wide-pine-b", palette: "CIVIC", tradeGlb: "court-record-pigeonholes", variant: 0 },
  { id: "EXPLORE_church", buildingId: "church", label: "The meeting house", slot: 21, archetype: "MEETINGHOUSE", dimensions: [28, 8.5, 38], shellGlb: "int-shell-meetinghouse-hero", floorGlb: "int-floor-wide-pine-a", palette: "PAINTED" },
  { id: "EXPLORE_ropewalk", buildingId: "ropewalk", label: "The ropewalk", slot: 22, archetype: "ROPEWALK", dimensions: [34, 4.2, 12], shellGlb: "int-shell-ropewalk-a", floorGlb: "int-floor-brick-work-a", palette: "SMOKE", tradeGlb: "ropewalk-laying-rig", variant: 0 },
  { id: "EXPLORE_chandlery", buildingId: "chandlery", label: "The ship chandlery", slot: 23, archetype: "CHANDLERY", dimensions: [20, 3.8, 15], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-b", palette: "WHARF", tradeGlb: "chandlery-stock-cluster", variant: 3 },
  { id: "EXPLORE_warehouseS", buildingId: "warehouseS", label: "A sail and rope store", slot: 24, archetype: "MARITIME_STORE", dimensions: [26, 4.8, 18], shellGlb: "int-shell-warehouse-a", floorGlb: "int-floor-brick-work-a", palette: "WHARF" },
  { id: "EXPLORE_rowS1", buildingId: "rowS1", label: "An artisan's home", slot: 25, archetype: "ARTISAN_HOME", dimensions: [16, 3.4, 12], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-b", palette: "PINE", variant: 9 },
  { id: "EXPLORE_rowS2", buildingId: "rowS2", label: "A prosperous merchant home", slot: 26, archetype: "PROSPEROUS_HOME", dimensions: [20, 3.8, 15], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-a", palette: "PAINTED", variant: 10 },
  { id: "EXPLORE_rowS3", buildingId: "rowS3", label: "A provisions home-shop", slot: 27, archetype: "HOME_SHOP", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-b", palette: "PINE", tradeGlb: "provisions-stock-cluster", variant: 4 },
  { id: "EXPLORE_clarke", buildingId: "clarke", label: "Clarke's dry-goods shop", slot: 28, archetype: "DRY_GOODS", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-a", palette: "PAINTED", tradeGlb: "tailor-workbench-stock", variant: 5 },
  { id: "EXPLORE_rowS4", buildingId: "rowS4", label: "A middling family home", slot: 29, archetype: "MIDDLING_HOME", dimensions: [17, 3.5, 13], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-b", palette: "PINE", variant: 11 },
  { id: "EXPLORE_rowS5", buildingId: "rowS5", label: "A laborer's lodging", slot: 30, archetype: "LABORER_HOME", dimensions: [14, 3.2, 11], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-a", palette: "SMOKE", variant: 12 },
  { id: "EXPLORE_rowS6", buildingId: "rowS6", label: "A textile and mercery shop", slot: 31, archetype: "TEXTILE_SHOP", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-wide-pine-b", palette: "PAINTED", tradeGlb: "tailor-workbench-stock", variant: 6 },
  { id: "EXPLORE_rowS7", buildingId: "rowS7", label: "A baker's shop", slot: 32, archetype: "BAKERY", dimensions: [18, 3.6, 14], shellGlb: "int-shell-shopfront-a", floorGlb: "int-floor-brick-work-a", palette: "SMOKE", tradeGlb: "baker-stock-cluster", variant: 7 },
  { id: "EXPLORE_rowS8", buildingId: "rowS8", label: "A prosperous shopkeeper's home", slot: 33, archetype: "PROSPEROUS_HOME", dimensions: [20, 3.8, 15], shellGlb: "int-shell-domestic-wide-b", floorGlb: "int-floor-wide-pine-b", palette: "PAINTED", variant: 13 },
  { id: "EXPLORE_rowS9", buildingId: "rowS9", label: "A fisher-artisan's home", slot: 34, archetype: "ARTISAN_HOME", dimensions: [16, 3.4, 12], shellGlb: "int-shell-domestic-narrow-a", floorGlb: "int-floor-wide-pine-a", palette: "WHARF", variant: 14 },
  { id: "EXPLORE_rowS10", buildingId: "rowS10", label: "A shoemaker's workroom", slot: 35, archetype: "SHOEMAKER", dimensions: [18, 3.8, 14], shellGlb: "int-shell-workroom-a", floorGlb: "int-floor-wide-pine-b", palette: "SMOKE", tradeGlb: "shoemaker-workbench-stock", variant: 1 },
];

function isHome(archetype: InteriorArchetype): boolean {
  return archetype.endsWith("_HOME") || archetype === "HOME_SHOP";
}

function audioFor(archetype: InteriorArchetype): InteriorAudioProfile {
  if (archetype === "PRINTSHOP") return "PRESS";
  if (archetype === "MEETINGHOUSE") return "CHURCH";
  if (archetype === "TAVERN") return "TAVERN";
  if (archetype === "WAREHOUSE" || archetype === "MARITIME_STORE") return "WAREHOUSE";
  if (archetype === "ROPEWALK") return "ROPEWORK";
  if (archetype === "CUSTOM_HOUSE" || archetype === "CIVIC_HALL" || archetype === "COURT_OFFICE") return "CIVIC";
  if (isHome(archetype)) return "HOME";
  if (archetype === "TAILOR" || archetype === "SHOEMAKER") return "WORKSHOP";
  return "SHOP";
}

function propsForSpec(spec: InteriorSpec): InteriorPropPlacement[] {
  const [width, , depth] = spec.dimensions;
  if (["MERCER_PRESS", "THOMAS_COUNTINGHOUSE", "PIKE_OFFICE", "CUSTOM_HOUSE", "EXPLORE_tavern", "EXPLORE_church", "EXPLORE_warehouseHero"].includes(spec.id)) {
    return heroProps(spec.id, width, depth);
  }
  if (spec.archetype === "WAREHOUSE" || spec.archetype === "MARITIME_STORE") {
    return warehouseProps(width, depth, false);
  }
  if (isHome(spec.archetype)) {
    const wealth = spec.archetype === "LABORER_HOME"
      ? "LABORER"
      : spec.archetype === "ARTISAN_HOME" || spec.archetype === "HOME_SHOP"
        ? "ARTISAN"
        : spec.archetype === "MIDDLING_HOME"
          ? "MIDDLING"
          : "PROSPEROUS";
    const domestic = baseDomesticProps(width, depth, spec.variant ?? 0, wealth);
    return spec.archetype === "HOME_SHOP"
      ? [
          ...domestic,
          ...shopProps(
            width,
            depth,
            spec.variant ?? 0,
            spec.tradeGlb ?? "provisions-stock-cluster",
          ).slice(0, 3).map((placement) => ({
            ...placement,
            id: `shop-${placement.id}`,
          })),
        ]
      : domestic;
  }
  if (spec.archetype === "TAILOR" || spec.archetype === "SHOEMAKER" || spec.archetype === "ROPEWALK") {
    return workroomProps(width, depth, spec.variant ?? 0, spec.tradeGlb ?? "tailor-workbench-stock");
  }
  if (spec.archetype === "CIVIC_HALL") {
    return [
      ...shopProps(width, depth, spec.variant ?? 0, spec.tradeGlb ?? "court-record-pigeonholes"),
      p("partition", "int-partition-plaster-a", [0, 0, 4.8], 0, [8.0, 4.0, 0.5], [7.6, 0.45], ["partition"]),
      p("assembly-table", "table-chairs-set", [0, 0, 3.0], 0, [3.0, 1.2, 3.0], [2.8, 2.8], ["table"]),
      p("records-extra", "court-record-pigeonholes", [-10.5, 0, 5.5], Math.PI / 2, [2.3, 2.5, 0.75], [2.0, 0.7], ["records"]),
    ];
  }
  return shopProps(width, depth, spec.variant ?? 0, spec.tradeGlb ?? "provisions-stock-cluster");
}

function partitionsForSpec(spec: InteriorSpec): InteriorPropPlacement[] {
  const [width, height, depth] = spec.dimensions;
  if (spec.archetype === "CUSTOM_HOUSE" || spec.archetype === "CIVIC_HALL") {
    return [p("architectural-partition", "int-partition-board-a", [0, 0, 3.5], 0, [width * 0.6, height - 0.4, 0.5], [width * 0.58, 0.45], ["partition"])];
  }
  if (isHome(spec.archetype) && spec.archetype !== "LABORER_HOME") {
    return [p("sleep-partition", "int-partition-plaster-a", [-width / 2 + 4.0, 0, depth / 2 - 3.3], Math.PI / 2, [4.5, height - 0.25, 0.45], [4.2, 0.4], ["partition"])];
  }
  if (spec.archetype === "WAREHOUSE" || spec.archetype === "MARITIME_STORE") {
    return [p("counting-partition", "int-partition-board-a", [width / 2 - 4.0, 0, -depth / 2 + 4.5], Math.PI / 2, [6.0, Math.min(height - 0.5, 4.0), 0.5], [5.7, 0.45], ["partition"])];
  }
  return [];
}

// Shells whose corrected canonical GLB (4 walls + ceiling, entrance on -Z,
// no embedded floor) has been regenerated + synced. Legacy cutaway shells keep
// the -90° yaw + per-axis fitting until their key is added here by the asset
// regeneration pass. Keep in sync with the structural asset manifest.
const CANONICAL_SHELLS = new Set<string>([
  "int-shell-domestic-narrow-a",
  "int-shell-domestic-wide-b",
  "int-shell-shopfront-a",
  "int-shell-workroom-a",
  "int-shell-warehouse-a",
  "int-shell-civic-a",
  "int-shell-meetinghouse-hero",
  "int-shell-ropewalk-a",
]);

// Large halls keep depth-scaled interior fog; small rooms disable it entirely
// (a universal near=12m fogged small rooms into a gray haze per the audit).
const FOGGED_ARCHETYPES = new Set<InteriorArchetype>([
  "MEETINGHOUSE",
  "WAREHOUSE",
  "MARITIME_STORE",
  "ROPEWALK",
]);

function makeInterior(spec: InteriorSpec): InteriorDef {
  const [width, height, depth] = spec.dimensions;
  const origin = interiorOriginForSlot(spec.slot);
  const canonicalShell = CANONICAL_SHELLS.has(spec.shellGlb);
  // Canonical shells author the entrance on -Z (yaw 0). Legacy cutaway shells
  // authored it on -X, so rotate -90° into the runtime -Z convention.
  const shellYaw = canonicalShell ? 0 : -Math.PI / 2;
  // Fog: disabled in small rooms; large halls use near ≥1.25× depth, far ≥3×.
  const fogEnabled = FOGGED_ARCHETYPES.has(spec.archetype) && depth >= 20;
  const fogNear = Math.round(depth * 1.25);
  const fogFar = Math.round(depth * 3);
  // Camera boom: common rooms 3.0; warehouse/meetinghouse halls may boom wider.
  const wideHall = spec.archetype === "MEETINGHOUSE" || spec.archetype === "WAREHOUSE";
  const props = propsForSpec(spec);
  const partitions = partitionsForSpec(spec);
  const colliders: InteriorColliderDef[] = [...props, ...partitions]
    .filter((placement) => placement.collide)
    .map((placement) => ({
      id: placement.id,
      local: placement.local,
      half: [placement.collide![0] / 2, Math.max(0.5, placement.size[1] / 2), placement.collide![1] / 2],
      yaw: placement.rotY,
      tags: placement.tags ?? ["furniture"],
    }));
  const landingLocal: InteriorVec3 = [0, 0, -depth / 2 + 1.45];
  const exitSensorLocal: InteriorVec3 = [0, 0, -depth / 2 + 0.78];
  return {
    id: spec.id,
    buildingId: spec.buildingId,
    label: spec.label,
    slot: spec.slot,
    layoutSeed: 176500 + spec.slot * 101,
    archetype: spec.archetype,
    palette: spec.palette,
    dimensions: spec.dimensions,
    origin,
    shellGlb: spec.shellGlb,
    floorGlb: spec.floorGlb,
    shellYaw,
    shellContract: canonicalShell ? "canonical" : "legacy",
    partitions,
    entranceLocal: [0, 0, -depth / 2],
    landingLocal,
    exitSensorLocal,
    faceY: 0,
    camera: {
      maxBoom: wideHall ? 4.2 : 3.0,
      minY: 0.55,
      maxY: Math.max(2.5, height - 0.35),
      inset: wideHall ? 0.9 : 0.8,
    },
    props,
    colliders,
    occupants: occupantsFor(spec.id, spec.archetype, width, depth),
    lighting: {
      windowLocal: [width / 2 - 0.8, Math.min(height - 0.8, 2.6), -1.5],
      hearthLocal: props.some((placement) => placement.id === "hearth")
        ? props.find((placement) => placement.id === "hearth")!.local
        : undefined,
      candleLocals: [
        [-width / 3, Math.min(1.8, height - 0.5), 1.0],
        [width / 3, Math.min(1.8, height - 0.5), -1.0],
      ],
      fogEnabled,
      fogNear,
      fogFar,
    },
    audioProfile: audioFor(spec.archetype),
    hotspots: hotspotsFor(spec.id, spec.archetype, width, depth).slice(
      0,
      ["MERCER_PRESS", "THOMAS_COUNTINGHOUSE", "PIKE_OFFICE", "CUSTOM_HOUSE", "EXPLORE_tavern", "EXPLORE_church", "EXPLORE_warehouseHero"].includes(spec.id) ? 4 : 2,
    ),
  };
}

export const INTERIORS: Record<string, InteriorDef> = Object.fromEntries(
  SPECS.map((spec) => [spec.id, makeInterior(spec)]),
);

export const INTERIOR_IDS = SPECS.map((spec) => spec.id);

export function interiorDef(locationId: string | null | undefined): InteriorDef | null {
  return locationId ? INTERIORS[locationId] ?? null : null;
}

export function interiorPoint(locationId: string, local: InteriorVec3): InteriorVec3 {
  const def = INTERIORS[locationId];
  if (!def) throw new Error(`Unknown interior location ${locationId}`);
  return addInteriorPoint(def.origin, local);
}

export function interiorLanding(locationId: string): InteriorVec3 {
  const def = INTERIORS[locationId];
  if (!def) throw new Error(`Unknown interior location ${locationId}`);
  return addInteriorPoint(def.origin, def.landingLocal);
}

export function interiorExitSensor(locationId: string): InteriorVec3 {
  const def = INTERIORS[locationId];
  if (!def) throw new Error(`Unknown interior location ${locationId}`);
  return addInteriorPoint(def.origin, def.exitSensorLocal);
}

export function interiorDoorFacade(locationId: string): InteriorVec3 {
  const def = INTERIORS[locationId];
  if (!def) throw new Error(`Unknown interior location ${locationId}`);
  return addInteriorPoint(def.origin, def.entranceLocal);
}

export const INTERIOR_STORY_LOCAL = {
  MERCER_DOOR_INSIDE: [0, 0, -8] as InteriorVec3,
  MERCER_PLAYER_CENTER: [0, 0, -4.4] as InteriorVec3,
  MERCER_PLAYER_PRESS: [-4.2, 0, -0.5] as InteriorVec3,
  MERCER_ABIGAIL_DESK: [6.0, 0, -4.5] as InteriorVec3,
  MERCER_ABIGAIL_PRESS: [-2.2, 0, 1.5] as InteriorVec3,
  MERCER_PRESS_BED: [-4.2, 1.05, 1.35] as InteriorVec3,
  MERCER_PRESS_RIG: [-4.2, 0, 1.2] as InteriorVec3,
  MERCER_PROOF_TABLE: [1.8, 0.95, 4.2] as InteriorVec3,
  MERCER_SHEET_HANDOFF: [-1.8, 0.52, -1.2] as InteriorVec3,
  MERCER_ABIGAIL_HAND: [-2.2, 1.2, 0.9] as InteriorVec3,
  MERCER_PLAYER_CATCH: [-1.8, 0.52, -1.2] as InteriorVec3,
  THOMAS_PLAYER: [0, 0, -5.2] as InteriorVec3,
  THOMAS_ACTOR: [1.5, 0, -0.5] as InteriorVec3,
  THOMAS_WORK: [-6.5, 0.85, 3.8] as InteriorVec3,
  THOMAS_COUNTER: [0, 1.05, -1.0] as InteriorVec3,
  PIKE_PLAYER: [0, 0, -4.5] as InteriorVec3,
  PIKE_ACTOR: [2.0, 0, -0.5] as InteriorVec3,
  CUSTOMHOUSE_PLAYER: [0, 0, -6.3] as InteriorVec3,
  CUSTOMHOUSE_CLERK: [2.5, 0, 2.8] as InteriorVec3,
  CUSTOMHOUSE_BOARD: [-9.5, 1.25, 6.3] as InteriorVec3,
  CUSTOMHOUSE_TACKER: [-9.0, 0, 4.8] as InteriorVec3,
  CUSTOMHOUSE_READER: [-8.2, 0, 4.2] as InteriorVec3,
} as const;

export function validateInteriorManifest(): string[] {
  const errors: string[] = [];
  if (INTERIOR_IDS.length !== 36) errors.push(`expected 36 interiors, got ${INTERIOR_IDS.length}`);
  const idSet = new Set(INTERIOR_IDS);
  const slots = new Set<number>();
  for (const id of INTERIOR_IDS) {
    if (!idSet.has(id)) errors.push(`missing id ${id}`);
    const def = INTERIORS[id];
    if (!def) {
      errors.push(`missing definition ${id}`);
      continue;
    }
    if (slots.has(def.slot)) errors.push(`duplicate slot ${def.slot}`);
    slots.add(def.slot);
    if (def.dimensions[0] < 14 || def.dimensions[2] < 11) errors.push(`${id} undersized`);
    const minProps = [
      "MERCER_PRESS",
      "THOMAS_COUNTINGHOUSE",
      "PIKE_OFFICE",
      "CUSTOM_HOUSE",
      "EXPLORE_tavern",
      "EXPLORE_church",
      "EXPLORE_warehouseHero",
    ].includes(def.id) ? 24 : 16;
    if (def.props.length + def.partitions.length < minProps) {
      errors.push(`${id} has ${def.props.length + def.partitions.length} placements, expected >=${minProps}`);
    }
    // Interior lighting/camera contract sanity.
    if (!Number.isFinite(def.shellYaw)) errors.push(`${id} shellYaw invalid`);
    if (def.shellContract !== "legacy" && def.shellContract !== "canonical") {
      errors.push(`${id} invalid shellContract ${def.shellContract}`);
    }
    if (def.camera.inset < 0.75 || def.camera.inset > 0.95) {
      errors.push(`${id} camera inset ${def.camera.inset} outside 0.75–0.9`);
    }
    const isWideHall = def.archetype === "MEETINGHOUSE" || def.archetype === "WAREHOUSE";
    const boomCap = isWideHall ? 4.3 : 3.0;
    if (def.camera.maxBoom < 2.8 || def.camera.maxBoom > boomCap) {
      errors.push(`${id} camera maxBoom ${def.camera.maxBoom} outside contract`);
    }
    if (def.lighting.fogEnabled) {
      if (def.lighting.fogNear < def.dimensions[2] * 1.24) {
        errors.push(`${id} fogNear ${def.lighting.fogNear} < 1.25× depth`);
      }
      if (def.lighting.fogFar < def.dimensions[2] * 2.9) {
        errors.push(`${id} fogFar ${def.lighting.fogFar} < 3× depth`);
      }
    }

    // Duplicate / interpenetrating placement guard: no two colliding placements
    // may sit at the same local position (z-fighting / stacked collision).
    const collidable = [...def.props, ...def.partitions].filter((p) => p.collide);
    for (let a = 0; a < collidable.length; a++) {
      for (let b = a + 1; b < collidable.length; b++) {
        const pa = collidable[a]!;
        const pb = collidable[b]!;
        const dx = pa.local[0] - pb.local[0];
        const dz = pa.local[2] - pb.local[2];
        if (Math.hypot(dx, dz) < 0.05) {
          errors.push(`${id} placements ${pa.id}/${pb.id} coincide (z-fight)`);
        }
      }
    }

    const placementIds = new Set([...def.props, ...def.partitions].map((placement) => placement.id));
    for (const hotspot of def.hotspots) {
      if (!placementIds.has(hotspot.placementId)) {
        errors.push(`${id} hotspot ${hotspot.id} references missing ${hotspot.placementId}`);
      }
      const wordCount = hotspot.body.trim().split(/\s+/).length;
      if (wordCount < 35 || wordCount > 65) {
        errors.push(`${id} hotspot ${hotspot.id} has ${wordCount} words`);
      }
    }
  }
  return errors;
}

