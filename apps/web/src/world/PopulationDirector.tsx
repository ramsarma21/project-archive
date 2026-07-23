import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { RiggedCharacter, ambientVisibleCount } from "./Character.js";
import { getDocumentTexture } from "./documentTextures.js";
import { ALL_INTERIOR_LOCATIONS, EXPLORE_KIT_ASSIGNMENT, WORLD_BOUNDS, type InteriorKitId } from "./manifest.js";

// ---------------------------------------------------------------------------
// PopulationDirector — ambient 1765 Boston street life (World-Design-Bible §9).
// Replaces the old AMBIENT/AmbientFolk system with zone rosters, behavior
// loops (walkers, conversation pairs, dock work, bill-readers, church-goers),
// phase scaling toward dusk, and the §9/§12 perf caps. Presentation-only:
// nothing here touches runtime state. All variety is seeded — no Math.random
// at frame time, so reduced-motion and replays stay deterministic.
// ---------------------------------------------------------------------------

// Ambient-population budget. The authored roster is a ~3x-denser 1765 street
// (World-Design-Bible §9) than the original 26-rig cast, but the per-frame
// cost stays near the old budget because every ambient rig is distance-culled:
// only those within AMBIENT_CULL_M of the camera are drawn/skinned, and mid
// rigs (>35m) run their mixer at ~2 Hz (see Character.tsx). MAX_AMBIENT_RIGS
// is the authored spawn ceiling (whole strip); the *drawn* count per view is
// bounded by the cull radius, so tripling density never triples draw calls.
// Morning holds ~53 rigs (~3x the old 17); the ceiling leaves dusk headroom so
// the day still ramps toward the fixed event.
const MAX_AMBIENT_RIGS = 66;

// Hide + freeze ambient rigs outside the useful street-view budget. The
// authored 82-rig pool remains intact; each local zone still fills on approach,
// while 30k-55k triangle rigs no longer render through several city blocks.
const AMBIENT_CULL_M = 48;

// The v3 big street spans roughly x -118..+80 (wharf out to -160). When the
// live manifest still holds the compact street, every entry falls back to its
// authored compact coordinates so nobody walks into the void mid-migration.
// ADJUST: once layout v3 is the only world, the compact fallbacks can go.
const BIG_STREET = WORLD_BOUNDS.maxX >= 70;

// ---- deterministic seeding helpers (EventDirector's hash pattern) ----------
function frac(n: number): number {
  return n - Math.floor(n);
}
function hash(i: number, salt: number): number {
  return frac(Math.sin(i * 127.1 + salt * 311.7) * 43758.5453);
}
function lerpAngle(from: number, to: number, alpha: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return from + delta * alpha;
}
function faceYaw(from: [number, number], to: [number, number]): number {
  return Math.atan2(to[0] - from[0], to[1] - from[1]);
}

// ---- new archetype probing --------------------------------------------------
// The character factory may land these overnight. Probe once, remember, and
// fall back to the base townsfolk so density never depends on the factory.
const NEW_ARCHETYPE_KEYS = [
  "dockhand-rigged",
  "agitator-rigged",
  "taxclerk-rigged",
  "towncrier-rigged",
  "goodwife-rigged",
] as const;

const archetypeReady = new Map<string, boolean>();
const archetypeListeners = new Set<() => void>();
let archetypeProbeStarted = false;

function probeArchetypes(): void {
  if (archetypeProbeStarted || typeof fetch !== "function") return;
  archetypeProbeStarted = true;
  for (const key of NEW_ARCHETYPE_KEYS) {
    fetch(`/world/characters/${key}.glb`, { method: "HEAD" })
      .then((res) => {
        // Vite's SPA fallback answers missing files with 200 text/html.
        const type = res.headers.get("content-type") ?? "";
        archetypeReady.set(key, res.ok && !type.includes("text/html"));
      })
      .catch(() => archetypeReady.set(key, false))
      .finally(() => {
        for (const listener of archetypeListeners) listener();
      });
  }
}

function subscribeArchetypes(listener: () => void): () => void {
  archetypeListeners.add(listener);
  return () => archetypeListeners.delete(listener);
}

type Archetype =
  | "townsman"
  | "townswoman"
  | "dockhand"
  | "agitator"
  | "taxclerk"
  | "towncrier"
  | "goodwife";

const ARCHETYPE_FALLBACK: Record<Archetype, string> = {
  townsman: "townsman-rigged",
  townswoman: "townswoman-rigged",
  dockhand: "townsman-rigged",
  agitator: "townsman-rigged",
  taxclerk: "townsman-rigged",
  towncrier: "townsman-rigged",
  goodwife: "townswoman-rigged",
};

// Ambient-only low-cost substitutions. These imported rigs retain the same
// period silhouettes and animation contract at ~31k triangles instead of the
// 49k-55k legacy townsfolk meshes. Story actors never pass through this map.
const ARCHETYPE_PREFERRED: Record<Archetype, string> = {
  townsman: "dockhand-rigged",
  townswoman: "goodwife-rigged",
  dockhand: "dockhand-rigged",
  agitator: "agitator-rigged",
  taxclerk: "taxclerk-rigged",
  towncrier: "towncrier-rigged",
  goodwife: "goodwife-rigged",
};

function useArchetypeGlb(archetype: Archetype): string {
  const fallback = ARCHETYPE_FALLBACK[archetype];
  const preferred = ARCHETYPE_PREFERRED[archetype];
  return useSyncExternalStore(subscribeArchetypes, () =>
    archetypeReady.get(preferred) === true ? preferred : fallback,
  );
}

// Gentle multiplicative hues so 2-4 shared GLBs read as different townsfolk.
const TINTS = [
  "#cbb9a4", "#b9c2ad", "#aab6c6", "#c9a396",
  "#bfae8e", "#b3a8bf", "#d0c2a0", "#9fb0a2",
] as const;

function seededLook(seed: number, archetype: Archetype): { tint: string; height: number } {
  const tint = TINTS[Math.floor(hash(seed, 5.7) * TINTS.length) % TINTS.length]!;
  const feminine = archetype === "townswoman" || archetype === "goodwife";
  const height = feminine ? 1.55 + hash(seed, 9.1) * 0.12 : 1.6 + hash(seed, 9.1) * 0.17;
  return { tint, height };
}

// ---- route sampling ---------------------------------------------------------
// A route is a polyline walked ping-pong with authored dwell seconds at each
// waypoint. Sampling is pure arithmetic on (elapsedTime + seedOffset), so
// every walker's position is deterministic and there is no per-frame state.

type Pt = [number, number];

interface RouteStep {
  kind: "walk" | "stand";
  from: Pt;
  to: Pt;
  start: number;
  duration: number;
  yaw: number;
}

interface RouteRuntime {
  cycleS: number;
  steps: RouteStep[];
}

function buildRoute(points: Pt[], speed: number, pauses: number[] | undefined, pingPong: boolean): RouteRuntime {
  const ordered: Pt[] = pingPong ? [...points, ...points.slice(0, -1).reverse()] : points;
  const dwell = (idx: number): number => pauses?.[idx] ?? 0;
  const steps: RouteStep[] = [];
  let clockS = 0;
  for (let i = 0; i < ordered.length; i++) {
    const here = ordered[i]!;
    const next = ordered[(i + 1) % ordered.length]!;
    // Map the ping-pong return leg back onto the source waypoint index.
    const pointIndex = i < points.length ? i : ordered.length - 1 - i;
    const pauseS = dwell(pointIndex);
    const dist = Math.hypot(next[0] - here[0], next[1] - here[1]);
    // Stand facing where the walk resumes; at a dead end (wrap point) keep
    // facing the way we arrived instead of snapping to yaw 0.
    const nextYaw = dist > 0.01
      ? faceYaw(here, next)
      : steps.length > 0
        ? steps[steps.length - 1]!.yaw
        : 0;
    if (pauseS > 0) {
      steps.push({ kind: "stand", from: here, to: here, start: clockS, duration: pauseS, yaw: nextYaw });
      clockS += pauseS;
    }
    if (i === ordered.length - 1 && !pingPong) break;
    if (dist > 0.01) {
      const duration = dist / speed;
      steps.push({ kind: "walk", from: here, to: next, start: clockS, duration, yaw: nextYaw });
      clockS += duration;
    }
  }
  return { cycleS: Math.max(clockS, 0.1), steps };
}

interface RouteSample {
  x: number;
  z: number;
  yaw: number;
  moving: boolean;
  stepIndex: number;
}

function sampleRoute(route: RouteRuntime, timeS: number, out: RouteSample): RouteSample {
  const local = ((timeS % route.cycleS) + route.cycleS) % route.cycleS;
  for (let i = route.steps.length - 1; i >= 0; i--) {
    const step = route.steps[i]!;
    if (local < step.start) continue;
    const k = Math.min(1, (local - step.start) / Math.max(step.duration, 0.001));
    out.x = step.from[0] + (step.to[0] - step.from[0]) * k;
    out.z = step.from[1] + (step.to[1] - step.from[1]) * k;
    out.yaw = step.yaw;
    out.moving = step.kind === "walk";
    out.stepIndex = i;
    return out;
  }
  const first = route.steps[0]!;
  out.x = first.from[0];
  out.z = first.from[1];
  out.yaw = first.yaw;
  out.moving = false;
  out.stepIndex = 0;
  return out;
}

// ---- roster data ------------------------------------------------------------

// `compact` fallbacks exist for the retired compact-street layout. The live
// world (WORLD_BOUNDS.maxX = 108) is always BIG_STREET, so newer roster entries
// omit compact and the readers fall back to the big-street coordinates.
interface WalkSpec {
  kind: "walk";
  points: Pt[];
  speed: number;
  pauses?: number[];
  compact?: { points: Pt[]; pauses?: number[] };
}

interface CarrySpec {
  kind: "carry";
  from: Pt; // pick-up (pier)
  to: Pt; // drop (warehouse)
  speed: number;
  dwellS: number;
  compact?: { from: Pt; to: Pt };
}

interface PairSpec {
  kind: "pair";
  a: Pt;
  b: Pt;
  compact?: { a: Pt; b: Pt };
  agitated?: boolean; // leans into argu clips earlier than the global ramp
}

interface IdlerSpec {
  kind: "idler";
  at: Pt;
  face?: Pt;
  compact?: { at: Pt; face?: Pt };
  loop: "idle" | "work" | "sweep" | "read" | "crier";
  // Route-gating law (Bible §3): this idler is a diegetic route blocker and
  // steps away once the dock route unlocks.
  hideWhenDockUnlocked?: boolean;
}

interface TrickleSpec {
  kind: "trickle"; // church-goers: yard idle, door walks around phase changes
  gate: Pt;
  door: Pt;
  compact?: { gate: Pt; door: Pt };
}

type BehaviorSpec = WalkSpec | CarrySpec | PairSpec | IdlerSpec | TrickleSpec;

interface PopEntry {
  id: string;
  zone: "street" | "wharf" | "market" | "civic" | "churchyard" | "alley" | "liberty";
  appearT: number; // renders once clock t reaches this (dusk forces 1)
  archetype: Archetype;
  archetypeB?: Archetype; // second rig of a pair
  behavior: BehaviorSpec;
  // Liberty Tree pocket ambient yields to the effigy cutscene: the event's
  // gathering crowd (EventDirector) owns that ground whenever dusk/late-day is
  // in force, so these entries hide when props.dusk is true.
  hideWhenDusk?: boolean;
}

// Zone coordinates bound to manifest v3 (World-Design-Bible §3): street
// x -118..+80 (band z -10..+10), wharf west of the gate at x=-118 (pier
// finger runs south at x -146..-138, warehouses on the north row z=-15),
// market stalls ~[-55..-45, -6.5], Town House square x 45..62, churchyard
// passage x 61.5..65 with the church at [71.5, north row], alleys z ±20..26.
// Waypoints thread the PROPS/BARRIERS colliders in manifest.ts — ADJUST both
// together. Compact fallbacks keep density if the old street ever returns.
const ROSTER: PopEntry[] = [
  // ---- STREET SPINE (10 rigs at dusk; walkers span the FULL street) --------
  {
    id: "street-w1", zone: "street", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "walk", speed: 0.92,
      points: [[-112, -3.2], [-70, -2.6], [-30, -3.2], [20, -2.4], [74, -3.0]],
      pauses: [0, 2.5, 0, 3, 0],
      compact: { points: [[-45, -1.6], [-20, -1.2], [10, -1.7], [44, -1.3]], pauses: [0, 2.5, 3, 0] },
    },
  },
  {
    id: "street-w2", zone: "street", appearT: 0, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.74,
      points: [[76, 2.4], [30, 3.0], [-12, 2.2], [-60, 3.0], [-112, 2.6]],
      pauses: [0, 3.5, 0, 2, 0],
      compact: { points: [[45, 2.5], [15, 2.9], [-18, 2.3], [-44, 2.7]], pauses: [0, 3.5, 2, 0] },
    },
  },
  {
    id: "street-w3", zone: "street", appearT: 0, archetype: "goodwife",
    behavior: {
      kind: "walk", speed: 0.8,
      points: [[-108, 1.4], [-78, 2.2], [-46, 1.2]],
      pauses: [1.5, 0, 4],
      compact: { points: [[-44, 1.2], [-28, 1.9], [-12, 1.1]], pauses: [1.5, 0, 4] },
    },
  },
  {
    id: "street-w4", zone: "street", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "walk", speed: 0.85,
      points: [[16, -1.6], [46, -2.2], [74, -1.4]],
      pauses: [2, 0, 5],
      compact: { points: [[8, -1.2], [28, -1.8], [44, -1.1]], pauses: [2, 0, 5] },
    },
  },
  {
    id: "street-w5", zone: "street", appearT: 0.45, archetype: "agitator",
    behavior: {
      kind: "walk", speed: 1.05,
      points: [[-36, 0.8], [22, 0.5]],
      pauses: [1, 1],
      compact: { points: [[-16, 0.6], [14, 0.4]], pauses: [1, 1] },
    },
  },
  {
    id: "street-pair-well", zone: "street", appearT: 0, archetype: "townsman", archetypeB: "townswoman",
    behavior: {
      kind: "pair",
      a: [-9.4, -0.3], b: [-8.5, 0.5], // north-west of the well at [-8,-1.5]
      compact: { a: [-7.2, -1.6], b: [-6.3, -0.9] },
    },
  },
  {
    id: "street-pair-press", zone: "street", appearT: 0.45, archetype: "agitator", archetypeB: "townsman",
    behavior: {
      kind: "pair", agitated: true,
      a: [4.0, 7.4], b: [4.8, 6.7], // huddled west of the town notice board
      compact: { a: [4.4, 3.3], b: [5.2, 2.5] },
    },
  },
  {
    id: "street-bench", zone: "street", appearT: 0, archetype: "townsman",
    behavior: {
      // Loiterer outside the Bunch of Grapes tavern (north row [-18]). No
      // seated clip in the ambient set yet — stands easy until one lands.
      kind: "idler", loop: "idle",
      at: [-16.5, -9.2], face: [-16.5, -4],
      compact: { at: [-14.4, 5.6], face: [-14.4, 2] },
    },
  },
  // ---- WHARF (6 rigs: §9 carry loops pier -> warehouse, rope/sweep work) ---
  {
    id: "wharf-carry-1", zone: "wharf", appearT: 0, archetype: "dockhand",
    behavior: {
      // Pier base (by the gangplank) -> warehouseN2 door across the apron.
      kind: "carry", speed: 0.95, dwellS: 2.6,
      from: [-143.5, 13], to: [-141.5, -8.5],
      compact: { from: [-55, -27], to: [-50, -20] },
    },
  },
  {
    id: "wharf-carry-2", zone: "wharf", appearT: 0, archetype: "dockhand",
    behavior: {
      // Crate mound on the apron -> warehouseN3 door. Pickup nudged east of the
      // mound collider so the straight carry line clears its NE corner.
      kind: "carry", speed: 0.88, dwellS: 3.1,
      from: [-131.5, 4.5], to: [-128, -8.5],
      compact: { from: [-53.5, -23.5], to: [-48.5, -18.5] },
    },
  },
  {
    id: "wharf-carry-3", zone: "wharf", appearT: 0.45, archetype: "dockhand",
    behavior: {
      // Pier base -> hero warehouse door (line threads north of the crane).
      kind: "carry", speed: 1.0, dwellS: 2.2,
      from: [-140.5, 15.5], to: [-155.5, -8],
      compact: { from: [-55.5, -30], to: [-51, -24] },
    },
  },
  {
    id: "wharf-crane", zone: "wharf", appearT: 0, archetype: "dockhand",
    behavior: {
      kind: "idler", loop: "work",
      at: [-144, 5.8], face: [-146, 9], // crane side, working toward the water
      compact: { at: [-54, -21.5], face: [-54, -26] },
    },
  },
  {
    id: "wharf-sweep", zone: "wharf", appearT: 0.45, archetype: "townsman",
    behavior: {
      kind: "idler", loop: "sweep",
      at: [-122, -5.4], face: [-122, -7.5], // tends the fish flakes rack
      compact: { at: [-49.5, -17.5], face: [-52, -18] },
    },
  },
  {
    id: "wharf-ropes", zone: "wharf", appearT: 0.75, archetype: "dockhand",
    behavior: {
      kind: "idler", loop: "work",
      at: [-148.7, 6.2], face: [-150, 7.6], // rope coils by the apron rail
      compact: { at: [-55.5, -25.5], face: [-53, -24] },
    },
  },
  // ---- MARKET (stalls at x -55..-45 north side, 4 rigs) --------------------
  {
    id: "market-goodwife", zone: "market", appearT: 0, archetype: "goodwife",
    behavior: {
      kind: "walk", speed: 0.66,
      points: [[-58, -3], [-52, -4], [-46, -3.4], [-49, 0.5], [-55, -0.5]],
      pauses: [2, 4, 3, 0, 2],
      compact: { points: [[-29, -2.5], [-24, 1.5], [-20, -1], [-26, -3]], pauses: [2, 4, 3, 2] },
    },
  },
  {
    id: "market-keeper", zone: "market", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "idler", loop: "work",
      at: [-52.5, -6.3], face: [-52.5, -2], // in the stall gap, facing the street
      compact: { at: [-25.8, -6.1], face: [-25.8, -2] },
    },
  },
  {
    id: "market-pair", zone: "market", appearT: 0.45, archetype: "townswoman", archetypeB: "townsman",
    behavior: {
      kind: "pair",
      a: [-47.6, -2.4], b: [-46.8, -3.1], // hagglers by the awning stall
      compact: { a: [-21.5, 1.6], b: [-20.7, 0.9] },
    },
  },
  // ---- TOWN HOUSE SQUARE (x 45..62, 3 rigs + the §8A bill post) ------------
  {
    id: "civic-reader", zone: "civic", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "idler", loop: "read",
      at: [49.4, -2.2], face: [50, -3.2], // reads the bill on the post
      compact: { at: [36.9, 2.4], face: [37.5, 1.5] },
    },
  },
  {
    // appearT 0.7: sorts ahead of the wharf rope-worker so the §9 rig cap
    // trims him (not this bill-reader) on the busiest dusk street.
    id: "civic-reader-2", zone: "civic", appearT: 0.7, archetype: "taxclerk",
    behavior: {
      kind: "idler", loop: "read",
      at: [50.8, -2.1], face: [50, -3.2],
      compact: { at: [38.3, 2.5], face: [37.5, 1.5] },
    },
  },
  {
    id: "civic-crier", zone: "civic", appearT: 0, archetype: "towncrier",
    behavior: {
      kind: "idler", loop: "crier",
      at: [56, 1.4], face: [49, 0], // announces west across the square
      compact: { at: [33, -1], face: [37, 0] },
    },
  },
  // ---- CHURCHYARD (passage x 61.5..65, yard pump, church door) -------------
  {
    id: "church-idler", zone: "churchyard", appearT: 0, archetype: "townswoman",
    behavior: {
      kind: "idler", loop: "idle",
      at: [63.8, -15.5], face: [63.4, -13], // waits by the churchyard pump
      compact: { at: [47, -1.8], face: [49, -3] },
    },
  },
  {
    id: "church-trickle", zone: "churchyard", appearT: 0.45, archetype: "townsman",
    behavior: {
      kind: "trickle",
      gate: [64.5, -6], door: [71, -9.4], // street mouth -> the church door
      compact: { gate: [43, -0.5], door: [49, -3] },
    },
  },
  // ---- ALLEYS (2 rigs; §9 back lane 1-2) -----------------------------------
  {
    id: "alley-north", zone: "alley", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "idler", loop: "idle",
      at: [-10.5, -22], face: [-10.5, -19], // north alley mid-cut mouth
      compact: { at: [10, -18], face: [10, -15] },
    },
  },
  {
    id: "alley-dock-guard", zone: "alley", appearT: 0, archetype: "dockhand",
    behavior: {
      // The dockhand shooing you off the chained dock gate (route-gating law,
      // Bible §3); steps away once THOMAS_DOCK_ROUTE unlocks.
      kind: "idler", loop: "idle", hideWhenDockUnlocked: true,
      at: [-42.2, 22.6], face: [-40, 22.8],
      compact: { at: [-41.8, -16.4], face: [-41, -18] },
    },
  },

  // =========================================================================
  // DENSIFICATION PASS (Bible §9): ~3x the ambient cast so every view of the
  // strip reads as a living 1765 town. New entries omit `compact` (the live
  // world is always BIG_STREET) and thread the same PROPS/BARRIERS colliders,
  // markers, door thresholds, hero-actor spots, and traversal landings the
  // core roster avoids. Distance culling (AMBIENT_CULL_M) keeps the drawn
  // count per view near the old budget. z-lanes, speeds, phases, and cluster
  // spacing are varied so no two neighbours read as identical clones.
  // =========================================================================

  // ---- STREET SPINE: more walkers across the full span, parallel z-lanes ----
  {
    id: "street-w6", zone: "street", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "walk", speed: 0.88,
      points: [[-110, -3.0], [-64, -2.5], [-20, -3.0], [30, -2.6], [72, -3.1]],
      pauses: [0, 2, 0, 3, 0],
    },
  },
  {
    id: "street-w7", zone: "street", appearT: 0, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.7,
      points: [[74, 3.4], [24, 3.8], [-24, 3.2], [-70, 3.6], [-110, 3.2]],
      pauses: [0, 3, 0, 2, 0],
    },
  },
  {
    id: "street-w8", zone: "street", appearT: 0, archetype: "goodwife",
    behavior: {
      kind: "walk", speed: 0.82,
      points: [[-58, -0.6], [-20, 0.4], [18, -0.4]],
      pauses: [2, 0, 3],
    },
  },
  {
    id: "street-w9", zone: "street", appearT: 0, archetype: "townsman",
    behavior: {
      kind: "walk", speed: 0.95,
      points: [[10, 2.0], [40, 2.6], [70, 2.0]],
      pauses: [1, 0, 4],
    },
  },
  {
    id: "street-w10", zone: "street", appearT: 0, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.78,
      points: [[-108, -1.2], [-84, -0.6], [-60, -1.4]],
      pauses: [3, 0, 2],
    },
  },
  {
    id: "street-w11", zone: "street", appearT: 0.45, archetype: "agitator",
    behavior: {
      kind: "walk", speed: 1.02,
      points: [[-30, 1.2], [30, 0.9]],
      pauses: [1, 1],
    },
  },
  {
    id: "street-w12", zone: "street", appearT: 0.45, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.72,
      points: [[40, -2.8], [64, -2.2], [76, -2.9]],
      pauses: [2, 0, 3],
    },
  },
  // Street conversation clusters (spaced well apart along the span)
  {
    id: "street-pair-market", zone: "street", appearT: 0, archetype: "townswoman", archetypeB: "townsman",
    behavior: { kind: "pair", a: [-62.5, 3.2], b: [-61.6, 2.5] }, // west, street-side of the market
  },
  {
    id: "street-pair-east", zone: "street", appearT: 0, archetype: "townsman", archetypeB: "agitator",
    behavior: { kind: "pair", a: [38, -3.4], b: [38.9, -2.7] }, // east of centre, open street
  },
  {
    id: "street-pair-tavern", zone: "street", appearT: 0, archetype: "townsman", archetypeB: "townswoman",
    behavior: { kind: "pair", a: [-26.5, -8.4], b: [-25.6, -7.8] }, // north walk, clear of the hitching post
  },
  // A street porter running a hand-cart's worth of goods along the south walk
  {
    id: "street-carry-1", zone: "street", appearT: 0, archetype: "townsman",
    behavior: { kind: "carry", speed: 0.9, dwellS: 2.8, from: [-56, 6.8], to: [-30, 7.0] },
  },
  {
    id: "street-carry-2", zone: "street", appearT: 0.45, archetype: "dockhand",
    behavior: { kind: "carry", speed: 0.94, dwellS: 2.4, from: [34, 6.6], to: [52, 6.8] },
  },
  // Street working idlers beside existing dressing (never on the collider)
  {
    id: "street-vendor-cart", zone: "street", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "work", at: [13.5, -2.6], face: [11, -3.6] }, // tends the mid-street cart
  },
  {
    id: "street-firewood", zone: "street", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "work", at: [-62, -8.2], face: [-64, -9] }, // stacking the firewood
  },
  {
    id: "street-hay", zone: "street", appearT: 0, archetype: "dockhand",
    behavior: { kind: "idler", loop: "work", at: [-80, 6.8], face: [-83, 5.8] }, // loading the hay cart
  },
  {
    id: "street-sweep-mid", zone: "street", appearT: 0.45, archetype: "goodwife",
    behavior: { kind: "idler", loop: "sweep", at: [-40, 7.6], face: [-40.75, 9] }, // sweeps a south shop step
  },
  {
    id: "street-crate-e", zone: "street", appearT: 0.45, archetype: "townsman",
    behavior: { kind: "idler", loop: "work", at: [28, 8.0], face: [30, 9] }, // handling the east crate stack
  },

  // ---- WEST GATE approach (wharf gate arch at x=-118, opening z ±4.5) -------
  {
    id: "westgate-pair", zone: "street", appearT: 0, archetype: "townsman", archetypeB: "townswoman",
    behavior: { kind: "pair", a: [-110, 3.0], b: [-109.2, 2.3] },
  },
  {
    id: "westgate-idler", zone: "street", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "idle", at: [-113, -3], face: [-118, -3] }, // traveller eyeing the wharf gate
  },

  // ---- WHARF apron: more carry loops, a mending pair, an apron walker -------
  {
    id: "wharf-carry-4", zone: "wharf", appearT: 0, archetype: "dockhand",
    behavior: { kind: "carry", speed: 0.92, dwellS: 2.7, from: [-129, 11], to: [-124.5, -8] },
  },
  {
    id: "wharf-carry-5", zone: "wharf", appearT: 0.7, archetype: "dockhand",
    // Apron pickup -> warehouseN3 door, kept east of the crane + crate mound.
    behavior: { kind: "carry", speed: 0.98, dwellS: 2.3, from: [-138, 12], to: [-126, -8] },
  },
  {
    id: "wharf-idle-crate", zone: "wharf", appearT: 0, archetype: "dockhand",
    behavior: { kind: "idler", loop: "work", at: [-136.5, 2.2], face: [-134, 0.8] }, // sorting the crate mound
  },
  {
    id: "wharf-pair", zone: "wharf", appearT: 0.45, archetype: "dockhand", archetypeB: "townsman",
    behavior: { kind: "pair", a: [-131, 11.5], b: [-130.1, 10.8] }, // two hands trading news on the apron
  },
  {
    id: "wharf-walk", zone: "wharf", appearT: 0.45, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.66,
      points: [[-152, -6], [-130, -5.5], [-125, -6.2]],
      pauses: [2, 0, 3],
    },
  },

  // ---- MARKET cluster (stalls x -55..-45 north side) -----------------------
  {
    id: "market-walk-2", zone: "market", appearT: 0, archetype: "goodwife",
    behavior: {
      kind: "walk", speed: 0.6,
      points: [[-57, -3.6], [-49, -4.6], [-46, -2.6], [-53, -1.2]],
      pauses: [2, 4, 3, 2],
    },
  },
  {
    id: "market-customer-pair", zone: "market", appearT: 0, archetype: "townswoman", archetypeB: "goodwife",
    behavior: { kind: "pair", a: [-53.5, -4.2], b: [-52.7, -3.5] },
  },
  {
    id: "market-keeper-2", zone: "market", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "work", at: [-46.5, -5.2], face: [-46.5, -2.5] }, // awning-stall keeper
  },
  {
    id: "market-idle-barrel", zone: "market", appearT: 0.45, archetype: "townswoman",
    behavior: { kind: "idler", loop: "idle", at: [-53, -3.2], face: [-51, -3] },
  },

  // ---- TOWN HOUSE SQUARE (x 45..62) ----------------------------------------
  {
    id: "civic-pair", zone: "civic", appearT: 0, archetype: "townsman", archetypeB: "taxclerk",
    behavior: { kind: "pair", a: [52, 1.6], b: [52.8, 2.3] },
  },
  {
    id: "civic-idle-gent", zone: "civic", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "idle", at: [59, 1.5], face: [56, 1.4] }, // stands near the crier
  },
  {
    id: "civic-walk", zone: "civic", appearT: 0.45, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.74,
      points: [[47, 2.6], [58, 2.0], [60, -1.5]],
      pauses: [2, 0, 3],
    },
  },
  {
    id: "civic-crier-listener", zone: "civic", appearT: 0.45, archetype: "goodwife",
    behavior: { kind: "idler", loop: "idle", at: [54, -0.2], face: [56, 1.2] },
  },

  // ---- CHURCHYARD (passage x 61.5..65, yard z -13..-15.5) -------------------
  {
    id: "church-idle-2", zone: "churchyard", appearT: 0, archetype: "goodwife",
    behavior: { kind: "idler", loop: "idle", at: [62.2, -13.2], face: [63.4, -13] }, // by the yard pump
  },
  {
    id: "church-pair", zone: "churchyard", appearT: 0.45, archetype: "townswoman", archetypeB: "townswoman",
    behavior: { kind: "pair", a: [62.5, -17], b: [63.3, -16.4] }, // gossip deeper in the open yard
  },
  {
    id: "church-trickle-2", zone: "churchyard", appearT: 0.45, archetype: "townsman",
    behavior: { kind: "trickle", gate: [64.5, -6.8], door: [70.5, -9.4] },
  },

  // ---- EAST GATE approach (arch x=80, opening z ±3.5) ----------------------
  {
    id: "eastgate-idler", zone: "civic", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "idle", at: [77, 2.6], face: [80, 2.6] },
  },
  {
    id: "eastgate-walk", zone: "civic", appearT: 0.45, archetype: "townswoman",
    behavior: {
      kind: "walk", speed: 0.8,
      points: [[76, -2.6], [70, -1.8], [74, -3.0]],
      pauses: [2, 0, 3],
    },
  },

  // ---- ALLEYS (north corridor z -22.5, south corridor z +23.5) -------------
  {
    id: "alley-north-2", zone: "alley", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "idle", at: [-25, -22], face: [-25, -19.5] },
  },
  {
    id: "alley-north-3", zone: "alley", appearT: 0.45, archetype: "townswoman",
    behavior: { kind: "idler", loop: "work", at: [45, -22.4], face: [45, -24.5] },
  },
  {
    id: "alley-south-2", zone: "alley", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "idle", at: [-5, 23.6], face: [-5, 26] },
  },
  {
    id: "alley-south-3", zone: "alley", appearT: 0.45, archetype: "goodwife",
    behavior: { kind: "idler", loop: "sweep", at: [50, 24], face: [50, 26.2] },
  },

  // ---- WORKSHOPS (street-facing working trades) ----------------------------
  {
    id: "workshop-ropewalk", zone: "street", appearT: 0, archetype: "townsman",
    behavior: { kind: "idler", loop: "work", at: [-106, 8.4], face: [-106, 10.5] }, // rope-walk hand
  },
  {
    id: "workshop-chandlery", zone: "street", appearT: 0.45, archetype: "townsman",
    behavior: { kind: "idler", loop: "sweep", at: [-87, 8.8], face: [-85, 10.5] }, // chandlery step
  },

  // ---- LIBERTY TREE approach/pocket: daytime loiterers only. These yield to
  //      the EventDirector effigy crowd, which owns this ground whenever
  //      dusk/late-day is in force (hideWhenDusk), so the two never overlap.
  {
    id: "liberty-pair", zone: "liberty", appearT: 0, archetype: "townsman", archetypeB: "agitator",
    hideWhenDusk: true,
    behavior: { kind: "pair", agitated: true, a: [86, -9], b: [86.8, -8.3] },
  },
  {
    id: "liberty-idler", zone: "liberty", appearT: 0, archetype: "townsman",
    hideWhenDusk: true,
    behavior: { kind: "idler", loop: "idle", at: [88, -11], face: [92, -16] },
  },
  {
    id: "liberty-walk", zone: "liberty", appearT: 0, archetype: "townswoman",
    hideWhenDusk: true,
    behavior: {
      kind: "walk", speed: 0.72,
      points: [[84, -6], [90, -9], [86, -11.5]],
      pauses: [2, 0, 3],
    },
  },
];

// Stable ordering: base population first, then the midday and dusk additions,
// so the rig cap always trims the latest arrivals rather than the core.
const ORDERED_ROSTER = [...ROSTER].sort((a, b) => a.appearT - b.appearT);

function rigCount(entry: PopEntry): number {
  return entry.behavior.kind === "pair" ? 2 : 1;
}

// Authored spawn pool (all rig instances, ignoring caps/time) — surfaced to the
// dev population probe so QA can compare pool vs. active vs. drawn counts.
const TOTAL_POOL_RIGS = ORDERED_ROSTER.reduce((sum, entry) => sum + rigCount(entry), 0);

function stringSeed(id: string): number {
  let acc = 0;
  for (let i = 0; i < id.length; i++) acc = (acc * 31 + id.charCodeAt(i)) % 100000;
  return acc;
}
function entrySeed(entry: PopEntry): number {
  return stringSeed(entry.id);
}

// ---- shared rig wrapper ------------------------------------------------------
// All ambient rigs: no shadow casting, distance-throttled mixers (§9 perf).
function AmbientRig(props: {
  archetype: Archetype;
  seed: number;
  clip: string;
  probeId: string;
  timeOffset?: number;
  timeScale?: number;
  lean?: number; // slight forward pitch for read/pew poses
}) {
  const glb = useArchetypeGlb(props.archetype);
  const look = useMemo(() => seededLook(props.seed, props.archetype), [props.seed, props.archetype]);
  return (
    <group rotation={[props.lean ?? 0, 0, 0]}>
      <RiggedCharacter
        glbKey={glb}
        height={look.height}
        clip={props.clip}
        timeOffset={props.timeOffset ?? props.seed % 7}
        timeScale={props.timeScale}
        tint={look.tint}
        castShadow={false}
        distanceAnimThrottle
        cullBeyondM={AMBIENT_CULL_M}
        probeId={props.probeId}
        contactShadow={false}
      />
    </group>
  );
}

// ---- behavior components ------------------------------------------------------

function Walker(props: { entry: PopEntry; reducedMotion: boolean }) {
  const spec = props.entry.behavior as WalkSpec;
  const seed = entrySeed(props.entry);
  const ref = useRef<THREE.Group>(null);
  const yawRef = useRef(0);
  const movingRef = useRef(true);
  const [moving, setMoving] = useState(true);
  const route = useMemo(() => {
    const source = !BIG_STREET && spec.compact ? spec.compact : { points: spec.points, pauses: spec.pauses };
    return buildRoute(source.points, spec.speed, source.pauses, true);
  }, [spec]);
  const offset = useMemo(() => hash(seed, 3.3) * route.cycleS, [seed, route]);
  const sampleOut = useRef<RouteSample>({ x: 0, z: 0, yaw: 0, moving: false, stepIndex: 0 });

  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (props.reducedMotion) {
      const s = sampleRoute(route, offset, sampleOut.current);
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      return;
    }
    const s = sampleRoute(route, clock.elapsedTime + offset, sampleOut.current);
    g.position.set(s.x, 0, s.z);
    yawRef.current = lerpAngle(yawRef.current, s.yaw, 1 - Math.exp(-8 * Math.min(dt, 0.05)));
    g.rotation.y = yawRef.current;
    if (s.moving !== movingRef.current) {
      movingRef.current = s.moving;
      setMoving(s.moving);
    }
  });

  const clip = props.reducedMotion ? "idle" : moving ? "walk" : "idle";
  return (
    <group ref={ref}>
      <AmbientRig archetype={props.entry.archetype} seed={seed} clip={clip} probeId={props.entry.id} />
    </group>
  );
}

// Dockhand carry loop: pier -> warehouse loaded (carryWalk + visible crate),
// dwell working, walk back empty, dwell loading again (Bible §9 work loops).
function CarryWorker(props: { entry: PopEntry; reducedMotion: boolean }) {
  const spec = props.entry.behavior as CarrySpec;
  const seed = entrySeed(props.entry);
  const ref = useRef<THREE.Group>(null);
  const crateRef = useRef<THREE.Group>(null);
  const yawRef = useRef(0);
  const [mode, setMode] = useState<"loaded" | "empty" | "working">("loaded");
  const modeRef = useRef(mode);
  const route = useMemo(() => {
    const pts = !BIG_STREET && spec.compact ? spec.compact : { from: spec.from, to: spec.to };
    // cycle: [stand load][walk loaded][stand unload][walk back]
    return buildRoute([pts.from, pts.to], spec.speed, [spec.dwellS, spec.dwellS], true);
  }, [spec]);
  const offset = useMemo(() => hash(seed, 4.4) * route.cycleS, [seed, route]);
  const sampleOut = useRef<RouteSample>({ x: 0, z: 0, yaw: 0, moving: false, stepIndex: 0 });

  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (props.reducedMotion) {
      const s = sampleRoute(route, offset, sampleOut.current);
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      if (crateRef.current) crateRef.current.visible = false;
      return;
    }
    const s = sampleRoute(route, clock.elapsedTime + offset, sampleOut.current);
    g.position.set(s.x, 0, s.z);
    yawRef.current = lerpAngle(yawRef.current, s.yaw, 1 - Math.exp(-8 * Math.min(dt, 0.05)));
    g.rotation.y = yawRef.current;
    // Timeline steps: 0 stand@from(load) 1 walk out(loaded) 2 stand@to(unload) 3 walk back(empty)
    const next: "loaded" | "empty" | "working" =
      s.moving ? (s.stepIndex === 1 ? "loaded" : "empty") : "working";
    if (next !== modeRef.current) {
      modeRef.current = next;
      setMode(next);
    }
    if (crateRef.current) crateRef.current.visible = next === "loaded";
  });

  const clip = props.reducedMotion
    ? "idle"
    : mode === "loaded"
      ? "carryWalk"
      : mode === "empty"
        ? "walk"
        : "work1";
  return (
    <group ref={ref}>
      <AmbientRig archetype={props.entry.archetype} seed={seed} clip={clip} probeId={props.entry.id} />
      {/* carried cargo crate, visible on the loaded leg only */}
      <group ref={crateRef} position={[0, 1.04, 0.36]} rotation={[-0.06, 0.1, 0]} visible={false}>
        <mesh>
          <boxGeometry args={[0.46, 0.3, 0.32]} />
          <meshStandardMaterial color="#7b5f40" roughness={0.95} />
        </mesh>
      </group>
    </group>
  );
}

// Two rigs facing each other, trading talk clips; the argu proportion ramps
// toward dusk (§9: agitation grows as the day runs down).
function ConversationPair(props: { entry: PopEntry; t: number; reducedMotion: boolean }) {
  const spec = props.entry.behavior as PairSpec;
  const seed = entrySeed(props.entry);
  const a = !BIG_STREET && spec.compact ? spec.compact.a : spec.a;
  const b = !BIG_STREET && spec.compact ? spec.compact.b : spec.b;
  const [bucket, setBucket] = useState(0);
  const bucketRef = useRef(0);
  const periodS = 5.5 + hash(seed, 7.7) * 3;

  useFrame(({ clock }) => {
    if (props.reducedMotion) return;
    const next = Math.floor((clock.elapsedTime + seed) / periodS);
    if (next !== bucketRef.current) {
      bucketRef.current = next;
      setBucket(next);
    }
  });

  const arguRamp = Math.min(1, Math.max(0, (props.t - 0.4) / 0.5));
  const arguChance = (spec.agitated ? 0.45 : 0) + arguRamp * 0.75;
  const speakerIsA = bucket % 2 === 0;
  const argu = hash(bucket, seed) < arguChance;
  const speakClip = argu ? (hash(bucket, seed + 1) < 0.5 ? "argu1" : "argue2") : hash(bucket, seed + 2) < 0.5 ? "talk" : "talk2";
  const clipA = props.reducedMotion ? "idle" : speakerIsA ? speakClip : "idle";
  const clipB = props.reducedMotion ? "idle" : speakerIsA ? "idle" : speakClip;
  // Seeded per-speaker playback rates so a huddle never gestures in lockstep.
  const scaleA = 0.9 + hash(seed, 12.4) * 0.2;
  const scaleB = 0.9 + hash(seed + 17, 12.4) * 0.2;
  return (
    <group>
      <group position={[a[0], 0, a[1]]} rotation={[0, faceYaw(a, b), 0]}>
        <AmbientRig archetype={props.entry.archetype} seed={seed} clip={clipA} timeScale={scaleA} probeId={`${props.entry.id}:a`} />
      </group>
      <group position={[b[0], 0, b[1]]} rotation={[0, faceYaw(b, a), 0]}>
        <AmbientRig archetype={props.entry.archetypeB ?? "townsman"} seed={seed + 17} clip={clipB} timeScale={scaleB} probeId={`${props.entry.id}:b`} />
      </group>
    </group>
  );
}

// Stationary loops: bench idle, stall work, sweeping, bill reading, crying.
function Idler(props: { entry: PopEntry; reducedMotion: boolean }) {
  const spec = props.entry.behavior as IdlerSpec;
  const seed = entrySeed(props.entry);
  const at = !BIG_STREET && spec.compact ? spec.compact.at : spec.at;
  const face = !BIG_STREET && spec.compact ? spec.compact.face : spec.face;
  const yaw = face ? faceYaw(at, face) : hash(seed, 2.2) * Math.PI * 2;
  const [bucket, setBucket] = useState(0);
  const bucketRef = useRef(0);
  const periodS = 7 + hash(seed, 6.1) * 4;

  useFrame(({ clock }) => {
    if (props.reducedMotion) return;
    const next = Math.floor((clock.elapsedTime + seed) / periodS);
    if (next !== bucketRef.current) {
      bucketRef.current = next;
      setBucket(next);
    }
  });

  let clip = "idle";
  let lean = 0;
  if (!props.reducedMotion) {
    switch (spec.loop) {
      case "work":
        clip = hash(bucket, seed) < 0.75 ? "work1" : "idle";
        break;
      case "sweep":
        clip = hash(bucket, seed) < 0.7 ? "work2" : "idle";
        break;
      case "read":
        clip = "work2";
        lean = 0.05;
        break;
      case "crier":
        clip = hash(bucket, seed) < 0.4 ? "talk2" : "idle";
        break;
      case "idle":
        clip = hash(bucket, seed) < 0.18 ? "talk2" : "idle";
        break;
    }
  } else if (spec.loop === "read") {
    lean = 0.05;
  }
  // Seeded playback rate so a cluster of idlers/workers never breathes in sync.
  const animScale = 0.88 + hash(seed, 12.4) * 0.24;
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, yaw, 0]}>
      <AmbientRig archetype={props.entry.archetype} seed={seed} clip={clip} lean={lean} timeScale={animScale} probeId={props.entry.id} />
    </group>
  );
}

// Church-goers: idle in the yard, but around clock phase changes (and at
// dusk) they walk gate -> door in a slow trickle (Bible §9).
function ChurchTrickle(props: { entry: PopEntry; t: number; dusk: boolean; reducedMotion: boolean }) {
  const spec = props.entry.behavior as TrickleSpec;
  const seed = entrySeed(props.entry);
  const gate = !BIG_STREET && spec.compact ? spec.compact.gate : spec.gate;
  const door = !BIG_STREET && spec.compact ? spec.compact.door : spec.door;
  const windowActive =
    props.dusk || Math.abs(props.t - 0.45) <= 0.06 || Math.abs(props.t - 0.75) <= 0.06;
  const ref = useRef<THREE.Group>(null);
  const yawRef = useRef(faceYaw(gate, door));
  const movingRef = useRef(false);
  const [moving, setMoving] = useState(false);
  const route = useMemo(
    () => buildRoute([gate, door], 0.7, [2.5, 6], true),
    [gate, door],
  );
  const sampleOut = useRef<RouteSample>({ x: 0, z: 0, yaw: 0, moving: false, stepIndex: 0 });

  useFrame(({ clock }, dt) => {
    const g = ref.current;
    if (!g) return;
    if (props.reducedMotion || !windowActive) {
      // Waits at the gate between services.
      g.position.set(gate[0], 0, gate[1]);
      g.rotation.y = faceYaw(gate, door);
      if (movingRef.current) {
        movingRef.current = false;
        setMoving(false);
      }
      return;
    }
    const s = sampleRoute(route, clock.elapsedTime + seed, sampleOut.current);
    g.position.set(s.x, 0, s.z);
    yawRef.current = lerpAngle(yawRef.current, s.yaw, 1 - Math.exp(-8 * Math.min(dt, 0.05)));
    g.rotation.y = yawRef.current;
    if (s.moving !== movingRef.current) {
      movingRef.current = s.moving;
      setMoving(s.moving);
    }
  });

  const clip = props.reducedMotion ? "idle" : moving ? "walk" : "idle";
  return (
    <group ref={ref}>
      <AmbientRig archetype={props.entry.archetype} seed={seed} clip={clip} probeId={props.entry.id} />
    </group>
  );
}

// The Stamp Act bill on a post in the Town House square — the object the §9
// bill-reader faces, mirroring the approved reference image. Faces the
// readers' stand spots (bill on the -z side of the post). ADJUST: swap for
// the layout worker's notice-post prop if one lands in the square.
function CivicBillPost() {
  // The paper plane faces local +z; readers stand street-side (+z) of the
  // post, so only a slight skew is applied.
  const at: Pt = BIG_STREET ? [50, -3.2] : [37.5, 1.5];
  const rotY = BIG_STREET ? 0.25 : -0.5;
  const texture = useMemo(() => getDocumentTexture("TOWN_STAMP_NOTICE"), []);
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, rotY, 0]}>
      <mesh position={[0, 1.25, 0]} castShadow>
        <boxGeometry args={[0.11, 2.5, 0.11]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 2.32, 0]} castShadow>
        <boxGeometry args={[0.6, 0.07, 0.1]} />
        <meshStandardMaterial color="#4a3826" roughness={0.95} />
      </mesh>
      <mesh position={[0, 1.72, 0.07]}>
        <planeGeometry args={[0.44, 0.58]} />
        <meshBasicMaterial map={texture} color="#ffffff" toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---- interior occupants -------------------------------------------------------
// Quiet bodies in the common rooms while the player is inside (task §5): same
// interiorId gate as District's Npcs. Spots are room fractions using
// kitPropsFor's flip convention, so they stay clear of the layout worker's kit
// dressing (tables / pews / counters) whatever the room size. Runtime hero
// interiors (Mercer/Thomas/Pike/Customs) carry their story cast and are not in
// EXPLORE_KIT_ASSIGNMENT, so they never receive ambient occupants here.
interface OccupantSpec {
  fx: number;
  fz: number;
  ffx: number; // facing target fraction
  ffz: number;
  loop: "idle" | "work" | "talk" | "read";
  feminine?: boolean;
  lean?: number;
}

const KIT_OCCUPANTS: Record<InteriorKitId, OccupantSpec[]> = {
  tavern: [
    { fx: -0.5, fz: 0.14, ffx: -0.72, ffz: 0.3, loop: "work" }, // barkeep at the bar
    { fx: 0.12, fz: -0.05, ffx: 0.35, ffz: 0.25, loop: "talk" }, // patron at a table
    { fx: -0.15, fz: -0.62, ffx: 0.1, ffz: -0.4, loop: "talk", feminine: true }, // patron near the door
  ],
  church: [
    { fx: 0.0, fz: 0.02, ffx: 0, ffz: 0.84, loop: "idle", feminine: true, lean: 0.06 },
    { fx: 0.0, fz: -0.4, ffx: 0, ffz: 0.84, loop: "idle", lean: 0.06 },
  ],
  shop: [
    { fx: -0.15, fz: 0.28, ffx: 0, ffz: -0.05, loop: "work" }, // keeper behind the counter
    { fx: 0.1, fz: -0.45, ffx: 0, ffz: -0.05, loop: "idle", feminine: true }, // customer
  ],
  workroom: [
    { fx: 0.32, fz: 0.5, ffx: 0.45, ffz: 0.72, loop: "read" }, // clerk at the desk
  ],
  warehouse: [
    { fx: -0.5, fz: -0.45, ffx: -0.78, ffz: -0.6, loop: "work" },
  ],
  home: [
    { fx: 0.1, fz: -0.35, ffx: 0.35, ffz: -0.05, loop: "idle", feminine: true },
  ],
};

function InteriorOccupant(props: { interiorId: string; reducedMotion: boolean }) {
  const room = ALL_INTERIOR_LOCATIONS[props.interiorId]?.room;
  const kit = EXPLORE_KIT_ASSIGNMENT[props.interiorId];
  const [bucket, setBucket] = useState(0);
  const bucketRef = useRef(0);
  useFrame(({ clock }) => {
    if (props.reducedMotion) return;
    const next = Math.floor(clock.elapsedTime / 9);
    if (next !== bucketRef.current) {
      bucketRef.current = next;
      setBucket(next);
    }
  });
  const occupants = kit ? KIT_OCCUPANTS[kit] : undefined;
  if (!room || !occupants) return null;
  const [cx, cz] = room.center;
  const flip = room.doorSide === "N" ? -1 : 1;
  const hx = room.size[0] / 2 - 0.75;
  const hz = room.size[1] / 2 - 0.75;
  const spot = (fx: number, fz: number): Pt => [cx + fx * hx * flip, cz + fz * hz * flip];
  return (
    <group>
      {occupants.map((o, i) => {
        const seed = stringSeed(`${props.interiorId}#${i}`);
        const at = spot(o.fx, o.fz);
        const facing = spot(o.ffx, o.ffz);
        const look = seededLook(seed, o.feminine ? "townswoman" : "townsman");
        let clip = "idle";
        if (!props.reducedMotion) {
          switch (o.loop) {
            case "work": clip = hash(bucket, seed) < 0.7 ? "work1" : "idle"; break;
            case "read": clip = "work2"; break;
            case "talk": clip = hash(bucket, seed) < 0.4 ? "talk2" : "idle"; break;
            case "idle": clip = hash(bucket, seed) < 0.18 ? "talk2" : "idle"; break;
          }
        }
        return (
          <group key={i} position={[at[0], 0, at[1]]} rotation={[0, faceYaw(at, facing), 0]}>
            <group rotation={[o.lean ?? 0, 0, 0]}>
              <RiggedCharacter
                glbKey={o.feminine ? "townswoman-rigged" : "townsman-rigged"}
                height={look.height}
                clip={clip}
                timeOffset={2.4 + (seed % 5)}
                timeScale={0.9 + hash(seed, 12.4) * 0.2}
                tint={look.tint}
                castShadow={false}
              />
            </group>
          </group>
        );
      })}
    </group>
  );
}

// ---- director ------------------------------------------------------------------

export function PopulationDirector(props: {
  interiorId: string | null;
  t: number;
  dusk: boolean;
  dockRouteUnlocked: boolean;
  reducedMotion: boolean;
}) {
  useEffect(() => probeArchetypes(), []);
  const authoredActiveRef = useRef(0);
  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") return;
    // Dev-only probe (no production UI): window.__paPopulation() returns the
    // authored spawn pool, the current cap, the rigs active at this hour, and
    // the count actually being drawn after distance culling. Used by browser
    // QA to confirm the ~3x density and the perf cull at each view.
    (window as unknown as { __paPopulation?: () => unknown }).__paPopulation = () => ({
      pool: TOTAL_POOL_RIGS,
      cap: MAX_AMBIENT_RIGS,
      cullRadiusM: AMBIENT_CULL_M,
      activeAuthored: authoredActiveRef.current,
      rendered: ambientVisibleCount(),
    });
    return () => {
      delete (window as unknown as { __paPopulation?: () => unknown }).__paPopulation;
    };
  }, []);
  if (props.interiorId) {
    return <InteriorOccupant interiorId={props.interiorId} reducedMotion={props.reducedMotion} />;
  }
  const effT = props.dusk ? 1 : props.t;
  const active: PopEntry[] = [];
  let rigs = 0;
  for (const entry of ORDERED_ROSTER) {
    if (entry.appearT > effT) continue;
    const b = entry.behavior;
    if (b.kind === "idler" && b.hideWhenDockUnlocked && props.dockRouteUnlocked) continue;
    // Liberty Tree pocket yields to the effigy cutscene crowd at dusk/late-day.
    if (entry.hideWhenDusk && props.dusk) continue;
    const n = rigCount(entry);
    if (rigs + n > MAX_AMBIENT_RIGS) continue;
    rigs += n;
    active.push(entry);
  }
  authoredActiveRef.current = rigs;
  return (
    <group>
      <CivicBillPost />
      {active.map((entry) => {
        switch (entry.behavior.kind) {
          case "walk":
            return <Walker key={entry.id} entry={entry} reducedMotion={props.reducedMotion} />;
          case "carry":
            return <CarryWorker key={entry.id} entry={entry} reducedMotion={props.reducedMotion} />;
          case "pair":
            return (
              <ConversationPair key={entry.id} entry={entry} t={effT} reducedMotion={props.reducedMotion} />
            );
          case "idler":
            return <Idler key={entry.id} entry={entry} reducedMotion={props.reducedMotion} />;
          case "trickle":
            return (
              <ChurchTrickle
                key={entry.id}
                entry={entry}
                t={props.t}
                dusk={props.dusk}
                reducedMotion={props.reducedMotion}
              />
            );
        }
      })}
    </group>
  );
}
