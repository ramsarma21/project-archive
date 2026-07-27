// M1 "The Effigy Run" — authored level, and the tools that prove it works.
//
// The mission runtime wants `M1_EFFIGY_RUN` and `compileLevel`. Everything else
// is exported for the parkour and stealth systems to consume directly
// (receiving targets, patrol poses) or for level tooling and tests.

export * from "./types.js";
export * from "./beat.js";
export * from "./envelope.js";
export * from "./authoring.js";
export * from "./assets.js";
export * from "./compile.js";
export * from "./cover.js";
export * from "./traversal.js";
export * from "./routeGraph.js";
export * from "./wayfind.js";
export * from "./stealth.js";
export * from "./pacing.js";
export * from "./runtime.js";
export * from "./duelBrief.js";
export * from "./duelCodex.js";
export * from "./duelEvidence.js";
export * from "./encounters/index.js";
export { M1_EFFIGY_RUN, SECTIONS } from "./level/index.js";
export {
  GEOMETRY,
  LEVEL_BOUNDS,
  LIBERTY_CORNER,
  SQUARE,
  STREET,
  YARD,
} from "./level/geometry.js";
export {
  GROUND,
  groundPlateY,
  type GroundPlateSpec,
  type GroundSurfaceKind,
} from "./level/ground.js";
export { LINKS, NODES, REFLEX_BEAT } from "./level/route.js";
export { LINKS_2, NODES_2 } from "./level/route2.js";
export { ARENA } from "./level/duelArena.js";
export {
  BLEND,
  CATCHES,
  DIVERSIONS,
  PATROLS,
  PRECISION,
} from "./level/opposition.js";
