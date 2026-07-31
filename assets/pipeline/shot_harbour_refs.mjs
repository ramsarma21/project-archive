// Render REFERENCE FRAMES for the harbour cutscene (File 1) out of our OWN
// production GLBs, so the video model (Runway/Kling/Seedance) anchors on the
// game's real art style and palette instead of inventing a generic dockside.
//
// This adapts the architecture of assets/pipeline/shot_rig_clipsheet.mjs — a
// self-served Playwright harness (inline HTML + import map + GLTFLoader,
// screenshotting a Three scene) — but with two differences that matter here:
//   1. It needs NO dev server and NO port. three.module.js, the jsm GLTFLoader
//      and every GLB are served from disk by intercepting requests, so nothing
//      contends with the owner's :5173 / :3001 stack.
//   2. Props are placed at REAL-WORLD scale in a composed dockside, not fitted
//      to a 1.55 m ruler. The wharf layout follows World-Design-Bible §"THE
//      WHARF" + §7 "Water & ships": moored brig + anchored snow + sloop +
//      rowboats, warehouses on the north side, water plane to the south/west.
//
// Physical surfaces are imported GLBs (wharf apron/pier, warehouses, ships,
// cargo, rigs). Only the water plane, sky, fog, lighting and contact shadows are
// procedural — which the imported-visible-world asset rule explicitly permits.
//
// Run (from anywhere; reads three + playwright from the hub node_modules):
//   node assets/pipeline/shot_harbour_refs.mjs                # every shot
//   SHOT=test node assets/pipeline/shot_harbour_refs.mjs      # corrected deliverables -> test/
//   SHOT=establishing node assets/pipeline/shot_harbour_refs.mjs
//   SHOT=ref-brig,ref-player node assets/pipeline/shot_harbour_refs.mjs   # comma list
//
// The corrected, photo-matched shots (establishing + ref-brig/wharf/dockhand/player)
// carry `subdir: "test"` and render into assets/reference/harbour-cutscene/test/. The
// legacy shot1/2/3 stay at the OUT root (the older Runway send-package still cites them).
//
// Env: SHOT (a shot key | comma list | "test" | "all"), OUT (base dir; a scene's
//      subdir is appended), THREE_DIR, PUBLIC, PW (playwright index.mjs)

import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const HUB = "/Users/ramsarma/Projects/project-archive";
const THREE_DIR =
  process.env.THREE_DIR ??
  `${HUB}/node_modules/.pnpm/three@0.185.1/node_modules/three`;
const PW =
  process.env.PW ??
  `${HUB}/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.mjs`;
const WORKTREE = resolve(import.meta.dirname, "../..");
const PUBLIC = process.env.PUBLIC ?? join(WORKTREE, "apps/web/public");
const OUT = resolve(
  process.env.OUT ?? join(WORKTREE, "assets/reference/harbour-cutscene"),
);
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(PW);

// ---------------------------------------------------------------------------
// Scene specifications. Numbers tuned by eye against the render; kept here so a
// re-tune is a one-file edit. Local frame: wharf deck top at y=0, the pier runs
// along +X, the harbour water is to -Z (and far), warehouses on the +Z (land)
// side. All lengths in metres.
// ---------------------------------------------------------------------------

const WATER_Y = -0.7;

// A dense line of moored / anchored hulls, reusing the three ship GLBs to read
// as "a forest of idle masts" (Bible encourages aggressive GLB reuse). Each:
// [key, x, z, rotY(rad), lengthM, draftM]. draft = how far the keel sits below
// the waterline.
const HARBOUR_SHIPS = [
  ["ship-brig-hero", 6, -9, 1.62, 26, 3.4], // hero brig broadside, near the apron
  ["ship-sloop", -14, -12, 1.4, 14, 1.9],
  ["ship-snow-background", -30, -26, 1.2, 22, 3.0],
  ["ship-snow-background", 26, -30, 2.1, 22, 3.0],
  ["ship-brig-hero", 2, -46, 1.5, 26, 3.4],
  ["ship-sloop", 34, -16, 1.9, 14, 1.9],
  ["ship-snow-background", -46, -44, 1.7, 22, 3.0],
];

const shipInstances = (list) =>
  list.map(([key, x, z, rotY, lengthM, draft]) => ({
    key,
    pos: [x, WATER_Y, z],
    rotY,
    targetLen: lengthM,
    axis: "maxH",
    keel: WATER_Y - draft,
  }));

// The warm-haze env + calm water shared by the establishing wide and the
// character-anchored opener variants (start-v2-*), so all of them read as the
// same dead port, low warm sun over grey-green water.
const HARBOUR_ENV = {
  skyGradient: ["#b7c1c8", "#f1e8d6"], // cool crown -> warm hazy horizon
  fog: ["#e9e0d1", 34, 250],
  hemi: ["#ebe4d6", "#4a483f", 1.2],
  sun: { pos: [-34, 24, 30], intensity: 0.92, color: "#ffeccb" },
  sunGlow: { pos: [12, 2.2, -175], size: 140, intensity: 0.9 },
  exposure: 1.1,
  shadowSpan: 95,
};
const HARBOUR_WATER = { y: WATER_Y, color: "#9c9b8f", size: 1400, rough: 0.55 };

// The dead-harbour dressing (the `establishing` set MINUS the figure), so each
// character-anchored variant can place its own player against the same layout:
// two tall ships close on the LEFT (x≈-13/-28), gear on the RIGHT, rope-rail edge
// at z≈-6, more ships hazy to the horizon, low sun far -Z.
const harbourSet = () => [
  { key: "colonial-wharf-apron", pos: [2, 0, 27], rotY: 0, targetLen: 82, axis: "x", base: 0 },
  { key: "wharf-pier-module", pos: [-6, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
  { key: "wharf-pier-module", pos: [0, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
  { key: "wharf-pier-module", pos: [6, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
  { key: "wharf-pier-module", pos: [12, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
  { key: "wharf-pier-module", pos: [18, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
  { key: "wharf-rope-rail-straight", pos: [-6, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
  { key: "wharf-rope-rail-straight", pos: [2, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
  { key: "wharf-rope-rail-straight", pos: [10, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
  { key: "wharf-rope-rail-straight", pos: [18, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
  { key: "bollard", pos: [-10, 0, -5.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
  { key: "bollard", pos: [24, 0, -5.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
  { key: "ship-brig-hero", pos: [-13, WATER_Y, -11], rotY: 0.28, targetLen: 27, axis: "maxH", keel: WATER_Y - 1.7 },
  { key: "ship-snow-background", pos: [-28, WATER_Y, -15], rotY: 0.5, targetLen: 23, axis: "maxH", keel: WATER_Y - 1.6 },
  { key: "ship-snow-background", pos: [17, WATER_Y, -54], rotY: 1.95, targetLen: 22, axis: "maxH", keel: WATER_Y - 2.4 },
  { key: "ship-sloop", pos: [31, WATER_Y, -46], rotY: 2.2, targetLen: 14, axis: "maxH", keel: WATER_Y - 1.4 },
  { key: "ship-brig-hero", pos: [6, WATER_Y, -70], rotY: 1.6, targetLen: 26, axis: "maxH", keel: WATER_Y - 2.4 },
  { key: "timber-crane", pos: [13, 0, -4], rotY: -0.5, targetLen: 6.2, axis: "y", base: 0 },
  { key: "work-ladder-9", pos: [17, 0, -3], rotY: 0.15, rotZ: -0.34, targetLen: 4.4, axis: "y", base: 0 },
  { key: "crate-stack", pos: [20, 0, 4.5], rotY: -0.3, targetLen: 2.4, axis: "maxH", base: 0 },
  { key: "crate-mound", pos: [25, 0, 6], rotY: 0.35, targetLen: 2.8, axis: "maxH", base: 0 },
  { key: "bldg-warehouse-wharf-a", pos: [30, 0, 7], rotY: Math.PI, targetLen: 15, axis: "maxH", base: 0 },
  { key: "barrel-group", pos: [-6.5, 0, 4], rotY: 0.4, targetLen: 1.3, axis: "y", base: 0 },
  { key: "barrel-group", pos: [-9, 0, 5.4], rotY: -0.2, targetLen: 1.2, axis: "y", base: 0 },
  { key: "rope-coil-large", pos: [-1.5, 0, 6], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
  { key: "cargo-net-bundle", pos: [25, 0, 3], rotY: 0.2, targetLen: 1.5, axis: "y", base: 0 },
  { key: "fish-flakes-rack", pos: [-12, 0, 0.5], rotY: 0, targetLen: 5, axis: "x", base: 0 },
  { key: "fish-flakes-rack", pos: [9, 0, 1], rotY: 0.1, targetLen: 5, axis: "x", base: 0 },
  { key: "rowboat", pos: [-8, WATER_Y, -8.5], rotY: 0.6, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
  { key: "buoy", pos: [4, WATER_Y, -13], rotY: 0, targetLen: 1.0, axis: "maxH", keel: WATER_Y - 0.3 },
];

const SCENES = {
  // SHOT 1 — WIDE: the port shut. High, wide, looking down the wharf into a
  // forest of masts and moored hulls, warehouses to the side, dead cargo on the
  // apron. Overcast, muted maritime palette.
  shot1: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [-33, 10.5, 17], look: [9, 0.2, -20], fov: 52 },
    env: {
      sky: "#b7c1cb",
      fog: ["#aeb8c2", 44, 230],
      hemi: ["#cbd5e0", "#41433f", 1.15],
      sun: { pos: [-30, 40, 24], intensity: 0.85, color: "#f2efe6" },
      exposure: 1.02,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      // The apron / deck the port works from.
      { key: "colonial-wharf-apron", pos: [4, 0, 6], rotY: 0, targetLen: 66, axis: "x", base: 0 },
      // Low pier edge modules with fender piles along the waterline (z≈0).
      { key: "wharf-pier-module", pos: [-22, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [-10, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [2, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [14, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [26, 0, 0.4], rotY: 0, targetLen: 1.7, axis: "y", base: 0 },
      // A finger pier running out into the water.
      { key: "colonial-wharf-pier-finger", pos: [18, 0, -9], rotY: Math.PI / 2, targetLen: 22, axis: "maxH", base: 0 },
      // Warehouses / counting houses along the north (land) side, framing.
      { key: "bldg-warehouse-wharf-a", pos: [-20, 0, 18], rotY: Math.PI, targetLen: 16, axis: "maxH", base: 0 },
      { key: "bldg-warehouse-wharf-b", pos: [2, 0, 19], rotY: Math.PI, targetLen: 11, axis: "maxH", base: 0 },
      { key: "bldg-warehouse-wharf-a", pos: [32, 0, 17.5], rotY: Math.PI, targetLen: 16, axis: "maxH", base: 0 },
      // Idle dockside machinery + cargo left unmoved.
      { key: "timber-crane", pos: [6, 0, 4], rotY: -0.3, targetLen: 5.2, axis: "y", base: 0 },
      { key: "crate-mound", pos: [-18, 0, 6], rotY: 0.4, targetLen: 2.4, axis: "maxH", base: 0 },
      { key: "crate-stack", pos: [-4, 0, 7], rotY: -0.2, targetLen: 2.2, axis: "maxH", base: 0 },
      { key: "barrel-group", pos: [22, 0, 7], rotY: 0, targetLen: 1.1, axis: "y", base: 0 },
      { key: "barrel-group", pos: [-11, 0, 8.5], rotY: 0.5, targetLen: 1.1, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [10, 0, 2.5], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "cargo-net-bundle", pos: [0, 0, 5.5], rotY: 0.2, targetLen: 2.6, axis: "y", base: 0 },
      { key: "fish-flakes-rack", pos: [-27, 0, 10], rotY: 0, targetLen: 5, axis: "x", base: 0 },
      { key: "bollard", pos: [-16, 0, 1.2], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "bollard", pos: [10, 0, 1.2], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      // Small craft at the pier.
      { key: "rowboat", pos: [-2, WATER_Y, -3.5], rotY: 0.5, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
      { key: "rowboat", pos: [30, WATER_Y, -4], rotY: 1.1, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
      { key: "buoy", pos: [-24, WATER_Y, -13], rotY: 0, targetLen: 1.0, axis: "maxH", keel: WATER_Y - 0.3 },
      ...shipInstances(HARBOUR_SHIPS),
    ],
  },

  // SHOT 2 — MID: the people it idled. Eye-level on the planks, a short line of
  // idle working figures (our rigs), the dead harbour behind them.
  shot2: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [-5.8, 1.62, 8.8], look: [2.6, 1.15, -7], fov: 46 },
    env: {
      sky: "#b7c1cb",
      fog: ["#aeb8c2", 30, 170],
      hemi: ["#cbd5e0", "#41433f", 1.15],
      sun: { pos: [-24, 34, 20], intensity: 0.8, color: "#f2efe6" },
      exposure: 1.03,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      { key: "colonial-wharf-apron", pos: [4, 0, 6], rotY: 0, targetLen: 66, axis: "x", base: 0 },
      // Low fender-pile edge at the waterline, behind the line of workers.
      { key: "wharf-pier-module", pos: [-6, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [6, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "wharf-pier-module", pos: [18, 0, -2.6], rotY: 0, targetLen: 1.6, axis: "y", base: 0 },
      { key: "bollard", pos: [-10, 0, -1.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "bollard", pos: [12, 0, -1.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      // The idle line of tradespeople (rest facing +Z, toward camera).
      { key: "dockhand-rigged", pos: [-1.8, 0, 2.2], rotY: 0.25, fitHeight: 1.78, clip: "idle", t: 0.55 }, // fisherman
      { key: "townsman-rigged", pos: [1.8, 0, 1.5], rotY: -0.1, fitHeight: 1.76, clip: "idle", t: 0.6 }, // cooper
      { key: "dockhand-rigged", pos: [4.2, 0, 2.2], rotY: -0.3, fitHeight: 1.78, clip: "idle", t: 0.35 }, // porter
      { key: "goodwife-rigged", pos: [6.6, 0, 2.5], rotY: -0.5, fitHeight: 1.66, clip: "idle", t: 0.5 }, // woman
      // The cooper's own barrels; a coil no ship will carry.
      { key: "barrel-group", pos: [0.4, 0, 3.4], rotY: 0.6, targetLen: 1.1, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [-3.8, 0, 2.9], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "crate-stack", pos: [12.5, 0, 2.6], rotY: -0.3, targetLen: 2.2, axis: "maxH", base: 0 },
      // The shut harbour behind them: moored hulls + a forest of masts.
      { key: "ship-brig-hero", pos: [9, WATER_Y, -13], rotY: 1.62, targetLen: 26, axis: "maxH", keel: WATER_Y - 3.4 },
      { key: "ship-sloop", pos: [-12, WATER_Y, -15], rotY: 1.3, targetLen: 14, axis: "maxH", keel: WATER_Y - 1.9 },
      { key: "ship-snow-background", pos: [28, WATER_Y, -30], rotY: 2.0, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
      { key: "ship-snow-background", pos: [-30, WATER_Y, -34], rotY: 1.5, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
    ],
  },

  // SHOT 3 — CLOSE: one ruined man. Head-and-shoulders of the dockworker rig,
  // a moored hull soft in the fog behind him.
  shot3: {
    viewport: [1280, 720],
    dsr: 2,
    camera: { pos: [0.33, 1.5, 1.15], look: [0.02, 1.45, 0], fov: 28 },
    env: {
      sky: "#b3bdc7",
      fog: ["#aab4be", 6, 60],
      hemi: ["#cbd5e0", "#41433f", 1.2],
      sun: { pos: [-8, 20, 14], intensity: 0.72, color: "#f2efe6" },
      exposure: 1.05,
    },
    water: { y: WATER_Y, color: "#4a544e", size: 900, rough: 0.5 },
    instances: [
      { key: "dockhand-rigged", pos: [0, 0, 0], rotY: 0.32, fitHeight: 1.78, clip: "idle", t: 1.2 },
      { key: "ship-snow-background", pos: [-6, WATER_Y, -22], rotY: 1.5, targetLen: 22, axis: "maxH", keel: WATER_Y - 3.0 },
      { key: "ship-brig-hero", pos: [9, WATER_Y, -30], rotY: 1.7, targetLen: 26, axis: "maxH", keel: WATER_Y - 3.4 },
    ],
  },

  // =========================================================================
  // CORRECTED DELIVERABLES (write to test/). Matched by eye to the owner's real
  // in-game photo assets/reference/harbour-cutscene/real-harbour-ingame.png:
  // near eye-level third-person, player centred on a plank deck, two tall ships
  // LARGE on the LEFT, working gear (crane, leaning ladder, crates, warehouse)
  // on the RIGHT, a rope rail at the water's edge, low hazy sun over open water.
  // =========================================================================

  // ESTABLISHING WIDE — the shut harbour, 16:9, the frame that seeds the Kling test.
  establishing: {
    subdir: "test",
    viewport: [1920, 1080], // 1920×1080 output, 2× supersampled, 16:9 production aspect
    dsr: 2,
    camera: { pos: [3.0, 2.8, 16.5], look: [-1.0, 1.25, -26], fov: 58 },
    env: {
      skyGradient: ["#b7c1c8", "#f1e8d6"], // cool crown -> warm hazy horizon
      fog: ["#e9e0d1", 34, 250],           // warm haze swallows the far hulls
      hemi: ["#ebe4d6", "#4a483f", 1.2],
      sun: { pos: [-34, 24, 30], intensity: 0.92, color: "#ffeccb" },
      sunGlow: { pos: [12, 2.2, -175], size: 140, intensity: 0.9 },
      exposure: 1.1,
      shadowSpan: 95,
    },
    water: { y: WATER_Y, color: "#9c9b8f", size: 1400, rough: 0.55 },
    instances: [
      // Plank deck: pushed back so its FRONT edge is the waterline (~z=-6); the
      // ships beyond it float in water, not on the deck plane.
      { key: "colonial-wharf-apron", pos: [2, 0, 27], rotY: 0, targetLen: 82, axis: "x", base: 0 },
      // Low pilings just breaking the water + a rope rail on the deck edge, so the
      // water and the ship hulls read behind it (the photo's open edge, not a wall).
      { key: "wharf-pier-module", pos: [-6, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
      { key: "wharf-pier-module", pos: [0, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
      { key: "wharf-pier-module", pos: [6, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
      { key: "wharf-pier-module", pos: [12, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
      { key: "wharf-pier-module", pos: [18, 0, -6.6], rotY: 0, targetLen: 1.5, axis: "y", base: -0.85 },
      { key: "wharf-rope-rail-straight", pos: [-6, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "wharf-rope-rail-straight", pos: [2, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "wharf-rope-rail-straight", pos: [10, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "wharf-rope-rail-straight", pos: [18, 0, -6.2], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "bollard", pos: [-10, 0, -5.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "bollard", pos: [24, 0, -5.8], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      // The lone figure on the open deck, looking out to sea (seen from behind).
      { key: "playerboy-rigged", pos: [-1, 0, 3.5], rotY: 3.25, fitHeight: 1.74, clip: "idle", t: 1.0 },
      // Two tall ships large + close on the LEFT, broadside, bows angled to the sun.
      { key: "ship-brig-hero", pos: [-13, WATER_Y, -11], rotY: 0.28, targetLen: 27, axis: "maxH", keel: WATER_Y - 1.7 },
      { key: "ship-snow-background", pos: [-28, WATER_Y, -15], rotY: 0.5, targetLen: 23, axis: "maxH", keel: WATER_Y - 1.6 },
      // More ships in the background, hazy, center-right toward the horizon.
      { key: "ship-snow-background", pos: [17, WATER_Y, -54], rotY: 1.95, targetLen: 22, axis: "maxH", keel: WATER_Y - 2.4 },
      { key: "ship-sloop", pos: [31, WATER_Y, -46], rotY: 2.2, targetLen: 14, axis: "maxH", keel: WATER_Y - 1.4 },
      { key: "ship-brig-hero", pos: [6, WATER_Y, -70], rotY: 1.6, targetLen: 26, axis: "maxH", keel: WATER_Y - 2.4 },
      // Working gear on the RIGHT: idle crane, leaning ladder, crates, warehouse.
      { key: "timber-crane", pos: [13, 0, -4], rotY: -0.5, targetLen: 6.2, axis: "y", base: 0 },
      { key: "work-ladder-9", pos: [17, 0, -3], rotY: 0.15, rotZ: -0.34, targetLen: 4.4, axis: "y", base: 0 },
      { key: "crate-stack", pos: [20, 0, 4.5], rotY: -0.3, targetLen: 2.4, axis: "maxH", base: 0 },
      { key: "crate-mound", pos: [25, 0, 6], rotY: 0.35, targetLen: 2.8, axis: "maxH", base: 0 },
      { key: "bldg-warehouse-wharf-a", pos: [30, 0, 7], rotY: Math.PI, targetLen: 15, axis: "maxH", base: 0 },
      // Foreground clutter left unmoved: barrels, coiled rope, drying racks.
      { key: "barrel-group", pos: [-6.5, 0, 4], rotY: 0.4, targetLen: 1.3, axis: "y", base: 0 },
      { key: "barrel-group", pos: [-9, 0, 5.4], rotY: -0.2, targetLen: 1.2, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [-1.5, 0, 6], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "cargo-net-bundle", pos: [25, 0, 3], rotY: 0.2, targetLen: 1.5, axis: "y", base: 0 },
      { key: "fish-flakes-rack", pos: [-12, 0, 0.5], rotY: 0, targetLen: 5, axis: "x", base: 0 },
      { key: "fish-flakes-rack", pos: [9, 0, 1], rotY: 0.1, targetLen: 5, axis: "x", base: 0 },
      // Small craft at the pier.
      { key: "rowboat", pos: [-8, WATER_Y, -8.5], rotY: 0.6, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
      { key: "buoy", pos: [4, WATER_Y, -13], rotY: 0, targetLen: 1.0, axis: "maxH", keel: WATER_Y - 0.3 },
    ],
  },

  // REF — the hero brig, three-quarter, furled sails, hull on the water, clean field.
  "ref-brig": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [12, 5.5, 26], look: [-1, 5, -1], fov: 44 },
    env: {
      skyGradient: ["#c3c9cd", "#e3e2d8"],
      fog: ["#e3e2d8", 70, 420],
      hemi: ["#eef1f2", "#3b3e41", 1.2],
      sun: { pos: [-26, 30, 32], intensity: 1.0, color: "#fff3e0" },
      fill: { pos: [32, 14, 22], intensity: 0.5, color: "#e9eeff" },
      exposure: 1.07,
      shadowSpan: 42,
    },
    water: { y: WATER_Y, color: "#9a9a8f", size: 700, rough: 0.55 },
    instances: [
      { key: "ship-brig-hero", pos: [0, WATER_Y, 0], rotY: 1.32, targetLen: 26, axis: "maxH", keel: WATER_Y - 1.6 },
    ],
  },

  // REF — the wharf/dock itself (no figures) so the dock look can be locked.
  "ref-wharf": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [-11, 3.3, 13], look: [7, 0.9, -8], fov: 52 },
    env: {
      skyGradient: ["#bcc5cb", "#ece4d5"],
      fog: ["#e6ded0", 34, 220],
      hemi: ["#e9e2d4", "#45443d", 1.15],
      sun: { pos: [-30, 24, 28], intensity: 0.9, color: "#ffeccb" },
      sunGlow: { pos: [10, 4, -150], size: 130, intensity: 0.85 },
      exposure: 1.1,
      shadowSpan: 70,
    },
    water: { y: WATER_Y, color: "#8f9088", size: 1200, rough: 0.62 },
    instances: [
      { key: "colonial-wharf-apron", pos: [4, 0, 2], rotY: 0, targetLen: 70, axis: "x", base: 0 },
      { key: "colonial-wharf-boardwalk", pos: [2, 0.02, 12], rotY: 0, targetLen: 40, axis: "x", base: 0 },
      { key: "colonial-wharf-pier-finger", pos: [16, 0, -10], rotY: Math.PI / 2, targetLen: 22, axis: "maxH", base: 0 },
      { key: "wharf-rope-rail-straight", pos: [-2, 0, -6.4], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "wharf-rope-rail-straight", pos: [6, 0, -6.4], rotY: 0, targetLen: 7, axis: "x", base: 0 },
      { key: "bollard", pos: [-6, 0, -6], rotY: 0, targetLen: 1.0, axis: "y", base: 0 },
      { key: "timber-crane", pos: [10, 0, -3.5], rotY: -0.4, targetLen: 6.2, axis: "y", base: 0 },
      { key: "work-ladder-9", pos: [14, 0, -1], rotY: 0.2, rotZ: -0.3, targetLen: 3.6, axis: "y", base: 0 },
      { key: "crate-stack", pos: [12, 0, 4], rotY: -0.3, targetLen: 2.4, axis: "maxH", base: 0 },
      { key: "crate-mound", pos: [16, 0, 5.5], rotY: 0.35, targetLen: 2.8, axis: "maxH", base: 0 },
      { key: "barrel-group", pos: [-1, 0, 4], rotY: 0.4, targetLen: 1.3, axis: "y", base: 0 },
      { key: "rope-coil-large", pos: [3, 0, 5.5], rotY: 0, targetLen: 2.0, axis: "x", base: 0 },
      { key: "cargo-net-bundle", pos: [19, 0, 6], rotY: 0.2, targetLen: 1.5, axis: "y", base: 0 },
      { key: "fish-flakes-rack", pos: [-6, 0, 0], rotY: 0, targetLen: 5, axis: "x", base: 0 },
      { key: "bldg-warehouse-wharf-a", pos: [22, 0, 6], rotY: Math.PI, targetLen: 15, axis: "maxH", base: 0 },
      { key: "ship-brig-hero", pos: [-14, WATER_Y, -14], rotY: 0.6, targetLen: 26, axis: "maxH", keel: WATER_Y - 3.6 },
      { key: "rowboat", pos: [-4, WATER_Y, -9], rotY: 0.6, targetLen: 4.5, axis: "maxH", keel: WATER_Y - 0.35 },
    ],
  },

  // REF — a dockhand, full body, on a neutral seamless field (identity lock).
  "ref-dockhand": {
    subdir: "test",
    viewport: [1200, 1600], // 1200×1600 output, 2× supersampled, 3:4 portrait
    dsr: 2,
    camera: { pos: [0, 1.02, 4.6], look: [0, 0.98, 0], fov: 30 },
    env: {
      sky: "#ccd0d2", // flat neutral seamless
      hemi: ["#f1f3f4", "#40434a", 1.25],
      sun: { pos: [-6, 9, 9], intensity: 0.95, color: "#fff3e0" },
      fill: { pos: [7, 4, 7], intensity: 0.5, color: "#e8eeff" },
      ground: { y: 0, color: "#c0c3c5", size: 60, rough: 0.98 },
      exposure: 1.05,
      shadowSpan: 6,
    },
    instances: [
      { key: "dockhand-rigged", pos: [0, 0, 0], rotY: 0.2, fitHeight: 1.8, clip: "idle", t: 1.0 },
    ],
  },

  // REF — the player character, full body, neutral seamless field (identity lock).
  "ref-player": {
    subdir: "test",
    viewport: [1200, 1600], // 1200×1600 output, 2× supersampled, 3:4 portrait
    dsr: 2,
    camera: { pos: [0, 1.0, 4.5], look: [0, 0.95, 0], fov: 30 },
    env: {
      sky: "#ccd0d2",
      hemi: ["#f1f3f4", "#40434a", 1.25],
      sun: { pos: [-6, 9, 9], intensity: 0.95, color: "#fff3e0" },
      fill: { pos: [7, 4, 7], intensity: 0.5, color: "#e8eeff" },
      ground: { y: 0, color: "#c0c3c5", size: 60, rough: 0.98 },
      exposure: 1.05,
      shadowSpan: 6,
    },
    instances: [
      { key: "playerboy-rigged", pos: [0, 0, 0], rotY: 0.2, fitHeight: 1.72, clip: "idle", t: 1.0 },
    ],
  },

  // REF — the tradesman/agitator, same studio framing/lighting as ref-player.
  "ref-agitator": {
    subdir: "test",
    viewport: [1200, 1600],
    dsr: 2,
    camera: { pos: [0, 1.02, 4.6], look: [0, 0.98, 0], fov: 30 },
    env: {
      sky: "#ccd0d2",
      hemi: ["#f1f3f4", "#40434a", 1.25],
      sun: { pos: [-6, 9, 9], intensity: 0.95, color: "#fff3e0" },
      fill: { pos: [7, 4, 7], intensity: 0.5, color: "#e8eeff" },
      ground: { y: 0, color: "#c0c3c5", size: 60, rough: 0.98 },
      exposure: 1.05,
      shadowSpan: 6,
    },
    instances: [
      { key: "agitator-rigged", pos: [0, 0, 0], rotY: 0.2, fitHeight: 1.8, clip: "idle", t: 1.0 },
    ],
  },

  // REF — the Crown tax-clerk, same studio framing/lighting as ref-player.
  "ref-taxclerk": {
    subdir: "test",
    viewport: [1200, 1600],
    dsr: 2,
    camera: { pos: [0, 1.02, 4.6], look: [0, 0.98, 0], fov: 30 },
    env: {
      sky: "#ccd0d2",
      hemi: ["#f1f3f4", "#40434a", 1.25],
      sun: { pos: [-6, 9, 9], intensity: 0.95, color: "#fff3e0" },
      fill: { pos: [7, 4, 7], intensity: 0.5, color: "#e8eeff" },
      ground: { y: 0, color: "#c0c3c5", size: 60, rough: 0.98 },
      exposure: 1.05,
      shadowSpan: 6,
    },
    instances: [
      { key: "taxclerk-rigged", pos: [0, 0, 0], rotY: 0.2, fitHeight: 1.82, clip: "idle", t: 1.0 },
    ],
  },

  // =========================================================================
  // CHARACTER-ANCHORED OPENERS (start-v2-*). The owner rejected the distant wide
  // as too empty: open ON THE PROTAGONIST arriving at the shut port, closer, a
  // frame to push in from. Same dead-harbour set (harbourSet), player placed off
  // -center (rule of thirds) in the fore/mid ground looking out; the two tall
  // ships, gear, rope-rail and low sun compose behind/around him.
  // =========================================================================

  // (a) OVER-THE-SHOULDER — the player near-left, back to camera, the two hero
  // ships looming just beyond him; rope rail + planks lead out to the sea/sun.
  "start-v2-a": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [-5.8, 2.4, 3.4], look: [-13.5, 1.1, -16], fov: 50 },
    env: { ...HARBOUR_ENV },
    water: HARBOUR_WATER,
    instances: [
      ...harbourSet(),
      { key: "playerboy-rigged", pos: [-8.2, 0, -0.4], rotY: 3.35, fitHeight: 1.92, clip: "idle", t: 1.4 },
    ],
  },

  // (b) 3/4 MEDIUM — the player right-third in the foreground, gazing out over the
  // whole dead harbour; ships center-left, low sun center, gear near him right.
  "start-v2-b": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [7.4, 2.4, 5.0], look: [-6, 1.15, -18], fov: 55 },
    env: { ...HARBOUR_ENV, fill: { pos: [10, 6, 12], intensity: 0.35, color: "#f3ead6" } },
    water: HARBOUR_WATER,
    instances: [
      ...harbourSet(),
      { key: "playerboy-rigged", pos: [5.2, 0, -0.8], rotY: 3.6, fitHeight: 1.82, clip: "idle", t: 1.4 },
    ],
  },

  // (c) LOW HERO ANGLE — camera near the planks looking up at the player standing
  // off-center against the hazy sky, the shut harbour and ships behind him.
  "start-v2-c": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [-1.8, 0.9, 6.8], look: [-6, 1.65, -12], fov: 54 },
    env: { ...HARBOUR_ENV },
    water: HARBOUR_WATER,
    instances: [
      ...harbourSet(),
      { key: "playerboy-rigged", pos: [-6, 0, -0.6], rotY: 3.15, fitHeight: 1.92, clip: "idle", t: 1.4 },
    ],
  },

  // =========================================================================
  // GAME-3D CUTSCENE BASES (owner locked the style to the GLB-render look, i.e.
  // ref-player.png). These render our ACTUAL GLBs; Gemini is used only to POLISH
  // fidelity on top of these, style-locked to the 3D-game render (never painterly).
  // =========================================================================

  // BACKDROP — the dead-harbour wharf, no figures (the setting for the keyframe).
  backdrop: {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [3.0, 2.8, 16.5], look: [-1.0, 1.25, -26], fov: 58 },
    env: { ...HARBOUR_ENV },
    water: HARBOUR_WATER,
    instances: [...harbourSet()],
  },

  // TWO-CHAR — the primary keyframe: dockworker + tradesman on the wharf, in-engine.
  // Poses come from each rig's own clips (tuned by eye); the dead harbour is behind.
  "two-char": {
    subdir: "test",
    viewport: [1920, 1080],
    dsr: 2,
    camera: { pos: [2.2, 1.75, 6.8], look: [-2.8, 0.95, -11], fov: 50 },
    env: { ...HARBOUR_ENV },
    water: HARBOUR_WATER,
    instances: [
      ...harbourSet(),
      // dockworker weary by his gear (left), 3/4 to camera; an empty net beside him.
      { key: "dockhand-rigged", pos: [-2.6, 0, 1.9], rotY: 1.7, fitHeight: 1.8, clip: "work2", t: 0.4 },
      { key: "cargo-net-bundle", pos: [-3.6, 0, 2.8], rotY: 0.3, targetLen: 1.2, axis: "y", base: 0 },
      // the tradesman in profile, gesturing out at the shut ships to the left.
      { key: "agitator-rigged", pos: [0.6, 0, 0.5], rotY: 4.3, fitHeight: 1.82, clip: "argu1", t: 0.6 },
    ],
  },
};

// ---------------------------------------------------------------------------
// The browser-side scene builder, injected into the served page.
// ---------------------------------------------------------------------------
const PAGE_HTML = (sceneJson) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>harbour refs</title>
<style>html,body{margin:0;height:100%;background:#b7c1cb;overflow:hidden}</style>
<script type="importmap">{"imports":{"three":"/three.module.js"}}</script>
</head><body>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/jsm/loaders/GLTFLoader.js";

const SCENE = ${sceneJson};
const diag = [];
window.__diag = diag;

const [VW, VH] = SCENE.viewport;
const DSR = SCENE.dsr ?? 2;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(DSR);
renderer.setSize(VW, VH, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = SCENE.env.exposure ?? 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const canvas = renderer.domElement;
canvas.style.width = VW + "px";
canvas.style.height = VH + "px";
document.body.appendChild(canvas);

const scene = new THREE.Scene();
// Background: a procedural vertical gradient (sky/haze is explicitly allowed
// procedural) when env.skyGradient=[topHex,bottomHex] is set, else a flat colour.
// A cool-top / warm-horizon gradient plus warm fog is what reads as a low hazy
// sun over open water — the mood in the owner's real in-game photo.
if (SCENE.env.skyGradient) {
  const [top, bot] = SCENE.env.skyGradient;
  const cv = document.createElement("canvas"); cv.width = 8; cv.height = 512;
  const g = cv.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, top); grad.addColorStop(1, bot);
  g.fillStyle = grad; g.fillRect(0, 0, 8, 512);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  scene.background = tex;
} else {
  scene.background = new THREE.Color(SCENE.env.sky);
}
if (SCENE.env.fog) scene.fog = new THREE.Fog(SCENE.env.fog[0], SCENE.env.fog[1], SCENE.env.fog[2]);

const [hs, hg, hi] = SCENE.env.hemi;
scene.add(new THREE.HemisphereLight(new THREE.Color(hs), new THREE.Color(hg), hi));
const sun = new THREE.DirectionalLight(new THREE.Color(SCENE.env.sun.color), SCENE.env.sun.intensity);
sun.position.set(...SCENE.env.sun.pos);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 260;
const S = SCENE.env.shadowSpan ?? 70;
sun.shadow.camera.left = -S; sun.shadow.camera.right = S;
sun.shadow.camera.top = S; sun.shadow.camera.bottom = -S;
sun.shadow.bias = -0.0006;
scene.add(sun);
scene.add(sun.target);

// Optional soft fill (studio ref shots): a shadowless directional to open up the
// side the sun leaves dark, so a single asset reads cleanly on a neutral field.
if (SCENE.env.fill) {
  const f = new THREE.DirectionalLight(new THREE.Color(SCENE.env.fill.color ?? "#ffffff"), SCENE.env.fill.intensity ?? 0.4);
  f.position.set(...SCENE.env.fill.pos);
  scene.add(f);
}

// Optional low-sun glow: an additive sprite far out over the water so the distant
// hulls read as backlit through haze. Procedural light effect (allowed).
if (SCENE.env.sunGlow) {
  const sg = SCENE.env.sunGlow;
  const cv = document.createElement("canvas"); cv.width = cv.height = 256;
  const g = cv.getContext("2d");
  const rad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  rad.addColorStop(0.0, "rgba(255,251,239,1)");
  rad.addColorStop(0.22, "rgba(255,243,219,0.82)");
  rad.addColorStop(0.55, "rgba(250,233,204,0.26)");
  rad.addColorStop(1.0, "rgba(250,233,204,0)");
  g.fillStyle = rad; g.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: sg.intensity ?? 1 }));
  spr.position.set(...sg.pos);
  spr.scale.setScalar(sg.size ?? 120);
  scene.add(spr);
}

if (SCENE.water) {
  const w = SCENE.water;
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(w.size, w.size),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(w.color), roughness: w.rough ?? 0.5, metalness: 0.0 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.position.y = w.y;
  water.receiveShadow = true;
  scene.add(water);
}

// Optional matte ground (studio ref shots): a neutral floor that catches a soft
// contact shadow so a character/prop is seated, not floating, on a clean field.
if (SCENE.env.ground) {
  const gr = SCENE.env.ground;
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(gr.size ?? 200, gr.size ?? 200),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(gr.color ?? "#c4c7c9"), roughness: gr.rough ?? 0.95, metalness: 0.0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = gr.y ?? 0;
  ground.receiveShadow = true;
  scene.add(ground);
}

const camera = new THREE.PerspectiveCamera(SCENE.camera.fov, VW / VH, 0.05, 2000);
camera.position.set(...SCENE.camera.pos);
camera.lookAt(...SCENE.camera.look);

const loader = new GLTFLoader();

function bbox(root) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  let any = false;
  root.traverse((o) => {
    if (o.isSkinnedMesh) {
      o.computeBoundingBox();
      if (o.boundingBox) { tmp.copy(o.boundingBox).applyMatrix4(o.matrixWorld); any ? box.union(tmp) : box.copy(tmp); any = true; }
    } else if (o.isMesh) {
      tmp.setFromObject(o); any ? box.union(tmp) : box.copy(tmp); any = true;
    }
  });
  return box;
}

async function place(inst) {
  const gltf = await loader.loadAsync("/world/" + resolveKey(inst.key));
  const root = gltf.scene;
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { if (m) { m.side = THREE.DoubleSide; m.needsUpdate = true; } }
  });

  // Play a clip pose for rigs.
  if (inst.clip && gltf.animations && gltf.animations.length) {
    const names = gltf.animations.map((c) => c.name);
    const name = names.includes(inst.clip) ? inst.clip : names[0];
    const clip = gltf.animations.find((c) => c.name === name);
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      mixer.clipAction(clip).play();
      mixer.setTime(Math.min(inst.t ?? 0.6, clip.duration));
      root.updateMatrixWorld(true);
    }
  }

  // Scale.
  let box = bbox(root);
  const size = box.getSize(new THREE.Vector3());
  let scale = 1;
  if (inst.fitHeight) {
    scale = size.y > 0.01 ? inst.fitHeight / size.y : 1;
  } else if (inst.targetLen) {
    const axisLen =
      inst.axis === "x" ? size.x :
      inst.axis === "z" ? size.z :
      inst.axis === "y" ? size.y :
      Math.max(size.x, size.z); // "maxH": largest horizontal dimension
    scale = axisLen > 0.01 ? inst.targetLen / axisLen : 1;
  }
  root.scale.setScalar(scale);

  // Rotate before we re-measure for the vertical seat. rotX/rotZ let a ladder
  // lean about its foot — the seat below drops the lowest point onto the deck.
  root.rotation.set(inst.rotX ?? 0, inst.rotY ?? 0, inst.rotZ ?? 0);
  box = bbox(root);

  // Vertical seat: props/rigs sit their base on inst.base; ships sink so the
  // keel (box.min.y) lands at inst.keel.
  const targetBase = inst.keel != null ? inst.keel : (inst.base ?? 0);
  root.position.y += targetBase - box.min.y;
  root.position.x = inst.pos[0];
  root.position.z = inst.pos[2];

  scene.add(root);
  const fin = bbox(root);
  diag.push({
    key: inst.key,
    natural: [round(size.x), round(size.y), round(size.z)],
    scale: round(scale),
    drawn: [round(fin.max.x - fin.min.x), round(fin.max.y - fin.min.y), round(fin.max.z - fin.min.z)],
    clips: gltf.animations ? gltf.animations.map((c) => c.name) : [],
  });
}

const KEY_DIR = {
  "dockhand-rigged": "characters", "townsman-rigged": "characters",
  "townswoman-rigged": "characters", "goodwife-rigged": "characters",
  "agitator-rigged": "characters", "towncrier-rigged": "characters",
  "playerboy-rigged": "characters", "thomas-rigged": "characters",
  "abigail-rigged": "characters", "taxclerk-rigged": "characters",
};
function resolveKey(key) {
  const dir = KEY_DIR[key] ?? "props";
  return dir + "/" + key + ".glb";
}
const round = (n) => Math.round(n * 1000) / 1000;

try {
  for (const inst of SCENE.instances) {
    try { await place(inst); }
    catch (e) { diag.push({ key: inst.key, error: String(e).slice(0, 200) }); }
  }
  renderer.render(scene, camera);
  // Re-render a few frames so late-decoded JPEG textures appear.
  let n = 0;
  const loop = () => { renderer.render(scene, camera); if (++n < 120) requestAnimationFrame(loop); };
  loop();
  window.__ready = true;
} catch (e) {
  window.__error = String(e);
  window.__ready = true;
}
</script>
</body></html>`;

// ---------------------------------------------------------------------------
// Node: launch, serve everything from disk, screenshot each shot.
// ---------------------------------------------------------------------------
const MIME = {
  ".js": "text/javascript", ".mjs": "text/javascript",
  ".glb": "model/gltf-binary", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".bin": "application/octet-stream",
};

const browser = await chromium.launch({
  args: [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--ignore-gpu-blocklist",
    "--enable-webgl",
  ],
});

// The corrected, photo-matched deliverables render into the test/ subdir; the
// legacy shot1/2/3 (kept for the older send-package) stay at the OUT root.
const TEST_SHOTS = ["establishing", "ref-brig", "ref-wharf", "ref-dockhand", "ref-player"];
const START_SHOTS = ["start-v2-a", "start-v2-b", "start-v2-c"]; // character-anchored openers
const sel = process.env.SHOT ?? "all";
const shots =
  sel === "all" ? Object.keys(SCENES) :
  sel === "test" ? TEST_SHOTS :
  sel === "starts" ? START_SHOTS :
  sel.split(",").map((s) => s.trim()).filter(Boolean);

let currentSceneJson = "{}";
const page = await browser.newPage();
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /error|fail/i.test(t)) console.log("  page>", t.slice(0, 300));
});
page.on("pageerror", (e) => console.log("  pageerror>", String(e).slice(0, 300)));

await page.route("**/*", (route) => {
  let path = new URL(route.request().url()).pathname;
  if (process.env.DBG) console.log("  route:", path);
  try {
    if (path.startsWith("/three.") && path.endsWith(".js")) {
      // three 0.185 splits into three.module.js + three.core.js.
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(join(THREE_DIR, "build", path.slice(1))) });
    }
    if (path.startsWith("/jsm/")) {
      const file = join(THREE_DIR, "examples/jsm", path.slice("/jsm/".length));
      return route.fulfill({ contentType: "text/javascript", body: readFileSync(file) });
    }
    if (path.startsWith("/world/")) {
      const file = join(PUBLIC, path.slice(1));
      if (!existsSync(file)) return route.fulfill({ status: 404, body: "missing " + path });
      return route.fulfill({ contentType: MIME[extname(file)] ?? "application/octet-stream", body: readFileSync(file) });
    }
    return route.fulfill({ contentType: "text/html; charset=utf-8", body: PAGE_HTML(currentSceneJson) });
  } catch (e) {
    return route.fulfill({ status: 500, body: String(e) });
  }
});

for (const shot of shots) {
  const scene = SCENES[shot];
  if (!scene) { console.log("no such shot:", shot); continue; }
  currentSceneJson = JSON.stringify(scene);
  const [VW, VH] = scene.viewport;
  await page.setViewportSize({ width: VW, height: VH });
  await page.goto("http://harbour.local/index.html?shot=" + shot, { waitUntil: "load" });
  const ok = await page
    .waitForFunction("window.__ready === true", { timeout: 90000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) { console.log(`SKIP ${shot} (scene did not finish building)`); continue; }
  const err = await page.evaluate("window.__error ?? null");
  if (err) console.log(`  ${shot} __error:`, err);
  await page.waitForTimeout(3500); // let JPEG textures decode + the render loop settle
  const outDir = scene.subdir ? join(OUT, scene.subdir) : OUT;
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `${shot}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: VW, height: VH } });
  const diag = await page.evaluate("window.__diag");
  console.log(`WROTE ${file}`);
  for (const d of diag) {
    if (d.error) console.log(`   !! ${d.key}: ${d.error}`);
    else console.log(`   ${String(d.key).padEnd(26)} nat=${d.natural.join("x")} scale=${d.scale} drawn=${d.drawn.join("x")}${d.clips.length ? "  clips=[" + d.clips.join(",") + "]" : ""}`);
  }
}

await browser.close();
console.log("DONE ->", OUT);
