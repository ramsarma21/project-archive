// Static placement validator for the ambient PopulationDirector roster.
//
// Live browser QA needs the full runtime (API + plan + a currently-green web
// tree). This backend-free check instead parses the authored ROSTER out of
// PopulationDirector.tsx and verifies every ambient occupancy point against the
// manifest's colliders (buildings/props/barriers/gates), the free-roam target
// markers, the exterior hero-actor spots, and the traversal landing points --
// exactly the exclusion set the task requires ambient NPCs to stay clear of.
//
// Run: npx tsx assets/pipeline/validate_population.mts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  BUILDINGS,
  PROPS,
  BARRIERS,
  GATES,
  NPCS,
  MARKER_ANCHORS,
  LOCATIONS,
} from "../../apps/web/src/world/manifest.ts";
import { TRAVERSAL_SET } from "../../apps/web/src/world/traversalMarkers.ts";

type Pt = [number, number];
type AABB = { cx: number; cz: number; hx: number; hz: number; tag: string };

const PERSON_R = 0.4; // ambient body half-width
const TIGHT_M = 0.25; // warn if a stand point is this close to a solid
const MARKER_CLEAR = 0.9; // stand points must be at least this far from markers
const HERO_CLEAR = 1.0; // and this far from an exterior hero actor
const SAMPLE_STEP = 0.6; // metres between path samples

// ---- Solid colliders (must never be entered) --------------------------------
const solids: AABB[] = [];
for (const b of BUILDINGS) solids.push({ cx: b.pos[0], cz: b.pos[2], hx: b.size[0] / 2, hz: b.size[2] / 2, tag: `bldg:${b.id}` });
for (const p of PROPS) {
  if (!p.collide) continue;
  // Route-gated blockers vanish once unlocked; still exclude by default (they
  // exist in normal morning/midday gameplay).
  solids.push({ cx: p.pos[0], cz: p.pos[2], hx: p.collide[0] / 2, hz: p.collide[1] / 2, tag: `prop:${p.glb}@${p.pos[0]},${p.pos[2]}` });
}
for (const bar of BARRIERS) solids.push({ cx: bar.pos[0], cz: bar.pos[1], hx: bar.size[0] / 2, hz: bar.size[1] / 2, tag: `barrier:${bar.kind}` });
for (const g of GATES) {
  const wing = (g.halfSpan - g.halfOpening) / 2;
  const center = g.halfOpening + wing;
  solids.push({ cx: g.x, cz: -center, hx: 1, hz: wing, tag: `gate:${g.key}:N` });
  solids.push({ cx: g.x, cz: center, hx: 1, hz: wing, tag: `gate:${g.key}:S` });
}
for (const bl of TRAVERSAL_SET.blockers) solids.push({ cx: bl[0], cz: bl[1], hx: bl[2], hz: bl[3], tag: "traversal-blocker" });

// ---- Point exclusions (markers / heroes / traversal landings) ---------------
const markerPts: { p: Pt; tag: string }[] = [];
for (const [k, v] of Object.entries(MARKER_ANCHORS)) markerPts.push({ p: [v[0], v[2]], tag: `marker:${k}` });
for (const loc of Object.values(LOCATIONS)) if (!loc.interior) markerPts.push({ p: [loc.anchor[0], loc.anchor[2]], tag: `loc:${loc.id}` });

const heroPts: { p: Pt; tag: string }[] = [];
for (const n of NPCS) if (!n.interiorOf) heroPts.push({ p: [n.pos[0], n.pos[2]], tag: `hero:${n.id}` });

const landingPts: { p: Pt; tag: string }[] = [];
for (const m of TRAVERSAL_SET.markers) {
  landingPts.push({ p: [m.position[0], m.position[2]], tag: `land:${m.id}` });
  for (const pose of m.path) landingPts.push({ p: [pose.pos[0], pose.pos[2]], tag: `land:${m.id}:pose` });
}

// ---- Geometry helpers -------------------------------------------------------
function distToAABB(p: Pt, b: AABB): number {
  const dx = Math.max(Math.abs(p[0] - b.cx) - b.hx, 0);
  const dz = Math.max(Math.abs(p[1] - b.cz) - b.hz, 0);
  return Math.hypot(dx, dz); // 0 => inside
}
function insideAABB(p: Pt, b: AABB): boolean {
  return Math.abs(p[0] - b.cx) <= b.hx && Math.abs(p[1] - b.cz) <= b.hz;
}
function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

// ---- Parse the roster out of PopulationDirector.tsx -------------------------
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(resolve(here, "../../apps/web/src/world/PopulationDirector.tsx"), "utf8");
const rosterStart = src.indexOf("const ROSTER: PopEntry[] = [");
const rosterEnd = src.indexOf("\n];", rosterStart);
const rosterSrc = src.slice(rosterStart, rosterEnd);

const pairRe = /\[\s*(-?\d[\d.]*)\s*,\s*(-?\d[\d.]*)\s*\]/g;
function pairsIn(s: string): Pt[] {
  const out: Pt[] = [];
  let m: RegExpExecArray | null;
  pairRe.lastIndex = 0;
  while ((m = pairRe.exec(s))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}
function firstPair(block: string, key: string): Pt | null {
  const idx = block.indexOf(`${key}:`);
  if (idx < 0) return null;
  const tail = block.slice(idx + key.length + 1);
  const m = /^\s*\[\s*(-?\d[\d.]*)\s*,\s*(-?\d[\d.]*)\s*\]/.exec(tail);
  return m ? [Number(m[1]), Number(m[2])] : null;
}
function pointsList(block: string): Pt[] {
  const idx = block.indexOf("points:");
  if (idx < 0) return [];
  let tail = block.slice(idx + "points:".length);
  for (const stop of ["pauses:", "compact:", "speed:"]) {
    const s = tail.indexOf(stop);
    if (s >= 0) tail = tail.slice(0, s);
  }
  return pairsIn(tail);
}

// Split into entry blocks by `id: "..."`.
const idRe = /id:\s*"([^"]+)"/g;
const idxs: { id: string; at: number }[] = [];
let mm: RegExpExecArray | null;
while ((mm = idRe.exec(rosterSrc))) idxs.push({ id: mm[1], at: mm.index });

interface OccPoint { p: Pt; stand: boolean }
interface Entry { id: string; kind: string; hideWhenDusk: boolean; appearT: number; rigs: number; pts: OccPoint[] }
const entries: Entry[] = [];

for (let i = 0; i < idxs.length; i++) {
  const block = rosterSrc.slice(idxs[i].at, i + 1 < idxs.length ? idxs[i + 1].at : rosterSrc.length);
  const kindM = /kind:\s*"(\w+)"/.exec(block);
  const kind = kindM ? kindM[1] : "?";
  const hideWhenDusk = /hideWhenDusk:\s*true/.test(block);
  const appearM = /appearT:\s*(-?\d[\d.]*)/.exec(block);
  const appearT = appearM ? Number(appearM[1]) : 0;
  const rigs = kind === "pair" ? 2 : 1;
  const pts: OccPoint[] = [];
  const addStand = (p: Pt | null) => { if (p) pts.push({ p, stand: true }); };
  if (kind === "idler") addStand(firstPair(block, "at"));
  else if (kind === "pair") { addStand(firstPair(block, "a")); addStand(firstPair(block, "b")); }
  else if (kind === "trickle") { addStand(firstPair(block, "gate")); addStand(firstPair(block, "door")); }
  else if (kind === "carry") {
    const from = firstPair(block, "from"), to = firstPair(block, "to");
    addStand(from); addStand(to);
    if (from && to) sampleSeg(from, to, pts);
  } else if (kind === "walk") {
    const wps = pointsList(block);
    wps.forEach((w) => pts.push({ p: w, stand: true }));
    for (let k = 0; k + 1 < wps.length; k++) sampleSeg(wps[k], wps[k + 1], pts);
  }
  entries.push({ id: idxs[i].id, kind, hideWhenDusk, appearT, rigs, pts });
}

// ---- Active-count model (mirrors the director's cap loop) --------------------
const CAP = 66;
function activeRigs(effT: number, dusk: boolean): number {
  let rigs = 0;
  for (const e of [...entries].sort((a, b) => a.appearT - b.appearT)) {
    if (e.appearT > effT) continue;
    if (e.hideWhenDusk && dusk) continue;
    if (rigs + e.rigs > CAP) continue;
    rigs += e.rigs;
  }
  return rigs;
}
function activeSet(effT: number, dusk: boolean): Entry[] {
  let rigs = 0;
  const out: Entry[] = [];
  for (const e of [...entries].sort((a, b) => a.appearT - b.appearT)) {
    if (e.appearT > effT) continue;
    if (e.hideWhenDusk && dusk) continue;
    if (rigs + e.rigs > CAP) continue;
    rigs += e.rigs;
    out.push(e);
  }
  return out;
}
const pool = entries.reduce((s, e) => s + e.rigs, 0);
console.log("\n== Active-count model (cap " + CAP + ") ==");
console.log(`  authored pool (all rigs): ${pool}`);
console.log(`  morning (t=0.00):        ${activeRigs(0, false)}`);
console.log(`  midday  (t=0.50):        ${activeRigs(0.5, false)}`);
console.log(`  dusk    (effT=1, dusk):  ${activeRigs(1, true)}`);

// ---- Per-view drawn-count estimate (AMBIENT_CULL_M = 74) ---------------------
// The engine culls to the camera; this uses the player anchor as a proxy so QA
// can sanity-check that each view reads dense while the drawn count stays near
// the old ~26 budget. Uses the midday active set.
const CULL = 74;
const midday = activeSet(0.5, false);
const views: { name: string; p: Pt }[] = [
  { name: "west (wharf gate)", p: [-112, 0] },
  { name: "wharf apron", p: [-143, 2] },
  { name: "central street", p: [-6, 1.5] },
  { name: "east (civic/gate)", p: [58, 0] },
  { name: "north alley", p: [-25, -22] },
];
console.log("\n== Per-view drawn estimate (cull " + CULL + "m, midday set) ==");
for (const v of views) {
  let drawn = 0;
  for (const e of midday) {
    if (!e.pts.length) continue;
    if (dist(v.p, e.pts[0].p) <= CULL) drawn += e.rigs;
  }
  console.log(`  ${v.name.padEnd(20)} ~${drawn} rigs drawn`);
}

function sampleSeg(a: Pt, b: Pt, out: OccPoint[]): void {
  const d = dist(a, b);
  const n = Math.max(1, Math.floor(d / SAMPLE_STEP));
  for (let s = 1; s < n; s++) {
    const t = s / n;
    out.push({ p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], stand: false });
  }
}

// ---- Run the checks ---------------------------------------------------------
const failures: string[] = [];
const warnings: string[] = [];
let standPts = 0;
let transitPts = 0;

for (const e of entries) {
  for (const op of e.pts) {
    if (op.stand) standPts++; else transitPts++;
    // Solids: never enter (walkers included -- they must not path through props)
    for (const b of solids) {
      if (insideAABB(op.p, b)) {
        failures.push(`${e.id} ${op.stand ? "STAND" : "path"} [${op.p}] is INSIDE ${b.tag}`);
      } else if (op.stand && distToAABB(op.p, b) < PERSON_R) {
        failures.push(`${e.id} STAND [${op.p}] overlaps ${b.tag} (gap ${distToAABB(op.p, b).toFixed(2)}m)`);
      } else if (op.stand && distToAABB(op.p, b) < PERSON_R + TIGHT_M) {
        warnings.push(`${e.id} STAND [${op.p}] is tight to ${b.tag} (gap ${distToAABB(op.p, b).toFixed(2)}m)`);
      }
    }
    // Markers / heroes / landings: only stand/dwell points must stay clear.
    if (op.stand) {
      for (const mk of markerPts) if (dist(op.p, mk.p) < MARKER_CLEAR) failures.push(`${e.id} STAND [${op.p}] on ${mk.tag} (${dist(op.p, mk.p).toFixed(2)}m)`);
      for (const h of heroPts) if (dist(op.p, h.p) < HERO_CLEAR) failures.push(`${e.id} STAND [${op.p}] on ${h.tag} (${dist(op.p, h.p).toFixed(2)}m)`);
      for (const l of landingPts) if (dist(op.p, l.p) < MARKER_CLEAR) failures.push(`${e.id} STAND [${op.p}] on ${l.tag} (${dist(op.p, l.p).toFixed(2)}m)`);
    }
  }
}

console.log(`Parsed ${entries.length} roster entries (${standPts} stand pts, ${transitPts} path samples).`);
console.log(`Solids: ${solids.length}, markers: ${markerPts.length}, heroes: ${heroPts.length}, landings: ${landingPts.length}`);
if (warnings.length) {
  console.log(`\n${warnings.length} WARNING(S):`);
  for (const w of warnings) console.log("  ~ " + w);
}
if (failures.length) {
  console.log(`\n${failures.length} FAILURE(S):`);
  for (const f of failures) console.log("  x " + f);
  process.exit(1);
}
console.log("\nOK: no ambient NPC overlaps a solid, marker, hero, or traversal landing.");
