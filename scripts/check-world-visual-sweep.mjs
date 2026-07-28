// check-world-visual-sweep — a systematic VISUAL sweep of the M1 world.
//
// WHY THIS EXISTS. The repo already has a wall of instruments that read the
// world's NUMBERS: check-playthrough (draw calls, triangles, textures,
// white-boxes), check-world-collision (a building solid's mesh must fill >=50%
// of its volume), verify_m1_placements (a collision box's footprint must be
// covered by drawn stone), check-world-affordances (a standable plane must have
// a mesh under it), check-world-scale (a rig/real-scale mesh must match its
// declared size), check-world-textures (a texture must be present and sane).
//
// A whole tree still rendered as a smeared column under shattered glass-shard
// foliage and sailed past every one of them, because a BADLY-SHAPED mesh that
// draws in the right box, with textures bound, a sane triangle count and its
// footprint covered is invisible to all of them. "Does this look like a tree"
// is not a number any of those gates asserts. The owner found it by PLAYING.
// A ladder standing in open air under a deck it never reaches was found the same
// way. There is no systematic visual sweep of this world. This is that sweep.
//
// WHAT IT DOES. Two halves, and it is honest about which is which.
//
//   THE MECHANISABLE HALF (--census, no browser). Enumerated from the level
//   itself — `sceneryPlacements()` resolves every authored building, deck, mass
//   and prop with its asset, box, position and fit, so a new asset is swept the
//   day it is placed and never hand-listed. For each placement it reproduces the
//   EXACT on-screen fit (assets/pipeline/placement_probe.mjs, the same library
//   the collision gate trusts) and measures four things a gate CAN assert:
//     UNDERFILL      a contain-fit that fills only a sliver of its box on the
//                    axes it does not bind — the "quarter of the object" class
//                    (service-wall-end drawn as a buttress; a church in a block).
//     ASPECT         a mesh whose natural proportions are nothing like the box
//                    it is fitted into — the shape a contain-fit turns into a
//                    smear, and a fill turns into a shear.
//     TEXEL DENSITY  texture pixels per metre of the drawn object — a map far
//                    too low-resolution for a large surface is a smear (bark).
//     BOUNDS TOUCH / a mesh whose drawn bounds do not reach a declared standable
//     FLOAT+CLASH    plane (guard-on-air), and props whose drawn boxes intersect.
//
//   THE HUMAN-REVIEW HALF (default, needs the dev web server). It drives the
//   REAL client with a free-fly capture camera — cloned from the running R3F
//   camera, rendered with `gl.render` and read straight off the canvas — to every
//   placement, brightens the pre-dawn scene for LEGIBILITY (exposure raised, all
//   lights boosted, both restored after each shot, so the mission is untouched),
//   and writes a contact sheet. An illegible frame is a FAILED check, not a
//   caption: a frame too dark to read is re-shot brighter and, if still dark,
//   recorded as a coverage hole rather than a finding.
//
// It then ranks every finding by HOW LIKELY THE OWNER IS TO SEE IT — distance to
// the authored route and the weight of the section (the Liberty Elm finale and
// the duel yard outrank a back-alley prop) — and says which findings it is
// confident in and which need a human eye on the frame.
//
// USAGE
//   node --import tsx scripts/check-world-visual-sweep.mjs            # full sweep
//   node --import tsx scripts/check-world-visual-sweep.mjs --census   # numbers only, no browser
//   node --import tsx scripts/check-world-visual-sweep.mjs --shots-only
//   PLAYTHROUGH_BASE=http://localhost:5299 node --import tsx scripts/check-world-visual-sweep.mjs
//
// It needs a running dev web server (the mission harness) for the visual half.
// Start one on a port the owner is NOT using, e.g.:
//   (cd apps/web && node node_modules/vite/bin/vite.js --port 5299 --strictPort)
//
// It is deliberately NOT wired into CI as a blocking gate. The mechanisable half
// COULD be (see the report it prints), but the visual half is a contact sheet a
// human reads — a gate nobody can interpret gets disabled. Output lands under
// .affordwork/world-sweep/ (gitignored): frames, a contact-sheet.html, and
// findings.json / findings.md.

import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const OUT = join(REPO, ".affordwork", "world-sweep");
const SHOTS = join(OUT, "shots");
mkdirSync(SHOTS, { recursive: true });

const argv = process.argv.slice(2);
const CENSUS_ONLY = argv.includes("--census");
const SHOTS_ONLY = argv.includes("--shots-only");
const BASE = (process.env.PLAYTHROUGH_BASE ?? "http://localhost:5299").replace(/\/$/, "");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

// ---------------------------------------------------------------- thresholds
const THRESH = {
  // A contain-fit whose drawn volume is under this fraction of its declared box
  // is a small object rattling in a big box. Calibrated against the collision
  // gate's own SOLID_FILL_MIN=0.5 for buildings; 0.30 here is deliberately
  // looser so it flags the gross "quarter of the object" cases across ALL props
  // (buttress at 0.19, scaffold quarter) without complaining about a barrel in
  // its square box.
  underfillVolume: 0.34,
  // The second-largest axis of a contain-fit that reaches under this fraction of
  // its box is a draw that covers one axis and abandons the plan — the shape of a
  // sliver in a wall. (The smallest axis is often a legitimately thin prop.)
  underfillSecondAxis: 0.55,
  // Natural mesh aspect vs declared box aspect. Ratio of the largest to smallest
  // per-axis (boxAxis/naturalAxis, normalised) a PROP is asked to change. A
  // contain-fit cannot change aspect (uniform scale), so a large value means the
  // box is shaped nothing like the mesh and most of it will be empty; for a FILL
  // it means the mesh is stretched this hard on one axis vs another (a shear).
  aspectDivergence: 2.2,
  // Texture pixels per metre along the object's largest drawn dimension. Below
  // this a big surface is wearing a texture too small for it — a smear. Coarse
  // (max image dim / max object dim), so it only speaks for LOW density and is
  // marked needs-human.
  texelsPerM: 46,
  // Two DIFFERENT-asset props whose drawn boxes overlap by more than this
  // fraction of the smaller box's volume are interpenetrating.
  clashVolumeFrac: 0.22,
  // Frame legibility: mean 0..255 luminance a capture must clear to be readable.
  legibleLum: 30,
};

// Section weights for owner-visibility ranking. The climax and the opening the
// run starts on outrank a mid-street prop; the duel yard is where the boss fight
// is fought and lingered in.
const SECTION_WEIGHT = {
  F_TREE: 1.0, // the Liberty Elm finale
  G_YARD: 0.95, // the duel yard
  A_LEADS: 0.85, // the opening leads, first thing seen
  E_LEAP: 0.75,
  D_ROOFLINE: 0.7,
  C_ASCENT: 0.65,
  D2_ROPEWALK: 0.6,
  B2_THRONG: 0.55,
  B_SHAMBLES: 0.5,
};

// Two known-broken things are being fixed on other branches; note if seen, never
// rank. Matched by asset key / id prefix.
const EXCLUDE_FROM_RANK = (placement) =>
  placement.asset === "liberty-elm-hero" || /^LADDER_/.test(placement.id) ||
  /work-ladder/.test(placement.asset);

// ---------------------------------------------------------------- level + three
// three's GLTFLoader (examples build) references the web global `self`; the other
// Node-side placement gates polyfill it the same way before importing three.
globalThis.self = globalThis;

const load = (...parts) => import(pathToFileURL(join(REPO, ...parts)));

const threeRoot = join(REPO, "apps", "web", "node_modules", "three");
const THREE = await import(pathToFileURL(join(threeRoot, "build", "three.module.js")));
const { GLTFLoader } = await import(
  pathToFileURL(join(threeRoot, "examples", "jsm", "loaders", "GLTFLoader.js"))
);
const { sceneSource, placeInto } = await import(
  pathToFileURL(join(REPO, "assets", "pipeline", "placement_probe.mjs"))
);
const { placementFootprint, intersectionArea } = await import(
  pathToFileURL(join(REPO, "assets", "pipeline", "placement_lib.mjs"))
);
// GLB header reader, reused so texture dims come out of the same parse the scale
// gate uses rather than a second, divergent one.
const { glbDocument } = await import(pathToFileURL(join(REPO, "scripts", "check-world-scale.mjs")));

const { M1_EFFIGY_RUN } = await load("packages", "mission-m1", "src", "level", "index.ts");
const { sceneryPlacements } = await load("packages", "mission-m1", "src", "runtime.ts");

const NODES = M1_EFFIGY_RUN.nodes;

// ---------------------------------------------------------------- geometry helpers
const worldFile = (assetPath) =>
  join(REPO, "apps", "web", "public", "world", assetPath.replace(/^world\//, ""));

const sourceCache = new Map();
async function meshOf(assetPath) {
  if (sourceCache.has(assetPath)) return sourceCache.get(assetPath);
  const file = worldFile(assetPath);
  let value = null;
  if (existsSync(file)) {
    const bytes = readFileSync(file);
    // GLTFLoader logs a warning per embedded texture blob it cannot decode in
    // Node — harmless (geometry still parses; texel dims are read separately from
    // the GLB bytes), but it drowns the report. Muffle it for the parse.
    const warn = console.warn;
    console.warn = () => {};
    try {
      const src = await sceneSource(THREE, GLTFLoader, bytes);
      src.texelMax = maxImageDim(bytes);
      value = src;
    } catch (error) {
      value = { error: String(error).slice(0, 120) };
    } finally {
      console.warn = warn;
    }
  }
  sourceCache.set(assetPath, value);
  return value;
}

/** Largest pixel dimension across a GLB's embedded images (a coarse texel read). */
function maxImageDim(bytes) {
  const doc = glbDocument(bytes);
  if (!doc?.json?.images) return null;
  let max = 0;
  for (const image of doc.json.images) {
    if (image.bufferView === undefined || !doc.binary) continue;
    const view = doc.json.bufferViews[image.bufferView];
    const start = view.byteOffset ?? 0;
    const buf = doc.binary.subarray(start, start + view.byteLength);
    const dims = pngOrJpegDims(buf);
    if (dims) max = Math.max(max, dims.w, dims.h);
  }
  return max || null;
}

function pngOrJpegDims(buf) {
  // PNG: 8-byte signature, then IHDR at offset 16 (width), 20 (height), big-endian.
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  // JPEG: scan the SOFn markers for the frame dimensions.
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return null;
}

const nearestNode = (pos) => {
  let best = null;
  let bestD = Infinity;
  for (const n of NODES) {
    const d = Math.hypot(n.pos[0] - pos[0], n.pos[2] - pos[2]);
    if (d < bestD) { bestD = d; best = n; }
  }
  return { node: best, distM: bestD };
};

const visibilityScore = (placement) => {
  const { node, distM } = nearestNode(placement.pos);
  const section = node?.section ?? "B_SHAMBLES";
  const weight = SECTION_WEIGHT[section] ?? 0.5;
  // Close to a node the player walks past = seen; far = incidental backdrop.
  const proximity = distM <= 3 ? 1 : distM <= 8 ? 0.7 : distM <= 18 ? 0.4 : 0.15;
  // Size matters: a big landmark is seen from far, a small prop only up close.
  const bigness = Math.min(1, Math.max(...placement.size) / 12);
  return {
    score: +(weight * (0.55 + 0.45 * proximity) * (0.6 + 0.4 * bigness)).toFixed(3),
    section,
    nearNode: node?.id ?? "?",
    distM: +distM.toFixed(1),
  };
};

// ---------------------------------------------------------------- static census
const findings = [];
function addFinding(f) {
  findings.push(f);
}

async function staticCensus() {
  log("[census] enumerating placements from sceneryPlacements()…");
  const placements = sceneryPlacements(M1_EFFIGY_RUN);
  log(`[census] ${placements.length} drawn objects, ${new Set(placements.map((p) => p.asset)).size} unique assets`);

  // Place every one, keep world AABB + natural size + tris + texel read.
  const placed = [];
  const missing = [];
  for (const placement of placements) {
    const src = await meshOf(placement.assetPath);
    if (!src || src.error) {
      missing.push({ id: placement.id, asset: placement.asset, why: src?.error ?? "no file on disk" });
      continue;
    }
    const scene = await src.next();
    let put;
    try {
      put = placeInto(THREE, scene, placement, src.natural);
    } catch (error) {
      missing.push({ id: placement.id, asset: placement.asset, why: String(error).slice(0, 90) });
      continue;
    }
    placed.push({
      placement,
      box: put.box,
      drawn: [put.drawn.x, put.drawn.y, put.drawn.z],
      scale: put.scale,
      natural: src.natural,
      tris: src.tris,
      texelMax: src.texelMax,
      targets: put.targets,
    });
  }
  log(`[census] placed ${placed.length}; ${missing.length} unplaceable`);
  for (const m of missing) {
    addFinding({
      cls: "MISSING_ASSET",
      id: m.id, asset: m.asset,
      severity: 3, confident: true, mechanisable: true,
      detail: `not drawable: ${m.why}`,
      vis: visibilityScore(placements.find((p) => p.id === m.id) ?? { pos: [0, 0, 0], size: [1, 1, 1] }),
    });
  }

  for (const p of placed) {
    const { placement, box, drawn, natural, texelMax } = p;
    const excluded = EXCLUDE_FROM_RANK(placement);
    const vis = visibilityScore(placement);
    const size = placement.size;
    const fit = placement.fit ?? "PROP";
    const boxVol = size[0] * size[1] * size[2];
    const drawnVol = drawn[0] * drawn[1] * drawn[2];
    const volFill = boxVol > 0 ? drawnVol / boxVol : 1;

    // --- UNDERFILL (contain-fit rattling in a box shaped nothing like it) ---
    // This is the "quarter of the object" class: a PROP contain-fit scales
    // uniformly, so a box whose aspect is nothing like the mesh's is filled on
    // one axis and left empty on the others. It EXTENDS check-world-collision
    // (which gates only building-scale solids >=20m²) down to every prop, and
    // it is the mechanisable precursor of a smear. The mesh/box aspect ratio is
    // carried in the detail because it is the root cause of the underfill.
    if (fit === "PROP" && boxVol > 0 && natural[0] > 0 && natural[1] > 0 && natural[2] > 0) {
      const cover = [drawn[0] / size[0], drawn[1] / size[1], drawn[2] / size[2]].sort((a, b) => b - a);
      const secondAxis = cover[1];
      const r = [size[0] / natural[0], size[1] / natural[1], size[2] / natural[2]];
      const aspectDiv = Math.max(...r) / Math.min(...r);
      if (volFill < THRESH.underfillVolume || secondAxis < THRESH.underfillSecondAxis) {
        addFinding({
          cls: "UNDERFILL",
          id: placement.id, asset: placement.asset,
          severity: volFill < 0.2 ? 3 : 2,
          confident: true, mechanisable: true, excluded,
          detail: `contain-fit fills ${(volFill * 100).toFixed(0)}% of its ${size.map((n) => n.toFixed(1)).join("×")}m box (2nd axis ${(secondAxis * 100).toFixed(0)}%); mesh aspect diverges ${aspectDiv.toFixed(1)}× from the box (mesh ${natural.map((n) => n.toFixed(1)).join("×")}m). A uniform fit into a box this differently shaped draws a fraction of the authored volume — the "quarter of the object" class.`,
          vis, drawn, boxVol: +boxVol.toFixed(1),
        });
      }
    }

    // --- TEXEL density (low-res map on a big object => smear) ---
    if (texelMax && !excluded) {
      const maxDim = Math.max(...drawn);
      const texelsPerM = texelMax / maxDim;
      if (maxDim >= 4 && texelsPerM < THRESH.texelsPerM) {
        addFinding({
          cls: "TEXEL",
          id: placement.id, asset: placement.asset,
          severity: texelsPerM < 24 ? 3 : 2,
          confident: false, mechanisable: true, excluded,
          detail: `${texelMax}px map across a ${maxDim.toFixed(1)}m object = ${texelsPerM.toFixed(0)} texels/m (< ${THRESH.texelsPerM}). A map this small on a surface this big reads as a smear. Needs a human eye to separate a genuine smear from a deliberately plain surface.`,
          vis, texelsPerM: +texelsPerM.toFixed(0),
        });
      }
    }

    // NOTE ON WHAT IS DELIBERATELY NOT RE-CHECKED HERE. Two mechanisable classes
    // the task names — a mesh whose bounds don't reach a declared STANDABLE plane
    // (guard-on-air), and a floor prop FLOATING over its support — are ALREADY
    // gated correctly, with the contain-fit scaling handled, by
    // check-world-affordances (--gate) and check-world-collision. Re-implementing
    // them here quickly reproduces their false-negative-free logic badly (a
    // contain-fit scales its internal standable heights too), so this sweep does
    // not duplicate them: it surfaces them to the eye in the frames instead, and
    // the report cites those gates as the mechanised half.
  }

  // --- INTERPENETRATION (two SAME-LEVEL props sharing volume) ---
  // Partly mechanisable, and honest about the "partly": architectural NESTING is
  // legitimate and everywhere here — a steeple stands on a roof, a balustrade on
  // a balcony, a scaffold against a wall, a monitor on a ridge — and all of it is
  // one thing sitting ABOVE another, i.e. a large base-height difference. A
  // genuine clash is two props at the SAME level poking through each other, so
  // only near-coplanar bases are reported, and every one is left for the eye.
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.placement.asset === b.placement.asset) continue; // tiling/adjacent same-asset is expected
      if (Math.abs(a.box.min.y - b.box.min.y) > 1.2) continue; // one stacked on the other = legitimate nesting
      // Only PROP-scale objects. Two buildings/shells that share a footprint are
      // co-rooted architecture (a steeple rising from its meeting house, a
      // pentice nailed to a wall), which is legitimate and the dominant false
      // positive; a genuine clash is a movable prop poking through another.
      const bigA = Math.max(a.box.max.x - a.box.min.x, a.box.max.z - a.box.min.z) > 6 || a.box.max.y - a.box.min.y > 6;
      const bigB = Math.max(b.box.max.x - b.box.min.x, b.box.max.z - b.box.min.z) > 6 || b.box.max.y - b.box.min.y > 6;
      if (bigA || bigB) continue;
      if (a.placement.fit === "SHELL" || b.placement.fit === "SHELL") continue;
      const vTop = Math.min(a.box.max.y, b.box.max.y);
      const vBot = Math.max(a.box.min.y, b.box.min.y);
      const vOverlap = vTop - vBot;
      if (vOverlap <= 0.3) continue;
      const area = intersectionArea(placementFootprint(a.placement), placementFootprint(b.placement));
      if (area <= 0.3) continue;
      const interVol = area * vOverlap;
      const volA = (a.box.max.x - a.box.min.x) * (a.box.max.y - a.box.min.y) * (a.box.max.z - a.box.min.z);
      const volB = (b.box.max.x - b.box.min.x) * (b.box.max.y - b.box.min.y) * (b.box.max.z - b.box.min.z);
      const frac = interVol / Math.max(0.001, Math.min(volA, volB));
      if (frac >= THRESH.clashVolumeFrac) {
        const excluded = EXCLUDE_FROM_RANK(a.placement) || EXCLUDE_FROM_RANK(b.placement);
        const vis = visibilityScore(
          (a.box.max.y - a.box.min.y) >= (b.box.max.y - b.box.min.y) ? a.placement : b.placement,
        );
        addFinding({
          cls: "CLASH",
          id: `${a.placement.id} ∩ ${b.placement.id}`,
          asset: `${a.placement.asset} / ${b.placement.asset}`,
          severity: 2,
          confident: false, mechanisable: true, excluded,
          detail: `same-level drawn boxes overlap by ${(frac * 100).toFixed(0)}% of the smaller one (footprint ${area.toFixed(1)}m², vertical ${vOverlap.toFixed(1)}m, base Δ ${Math.abs(a.box.min.y - b.box.min.y).toFixed(1)}m). Two props at one level sharing this much volume is one poking through the other — unless it is a canopy over its own stall. Needs the eye.`,
          vis,
        });
      }
    }
  }

  return { placements, placed, missing };
}

// ---------------------------------------------------------------- visual capture
// The in-page free-fly capture. Clones the running R3F camera, frames the target
// from the side the route approaches it, brightens for legibility (and restores),
// renders once with the renderer's own gl.render, and reads the canvas back in
// the SAME synchronous call so the drawing buffer is still ours.
const CAPTURE_FN = ({ target, size, fromDir, exposure, boost }) => {
  const st = window.__stage;
  if (!st || !st.gl) return { err: "window.__stage.gl absent" };
  const cam = st.camera.clone();
  const maxDim = Math.max(size[0], size[1], size[2]);
  const vfov = (cam.fov * Math.PI) / 180;
  const cx = target[0];
  const cy = target[1] + size[1] * 0.5;
  const cz = target[2];
  // Distance is the TRUE camera-to-centre distance (not a per-axis offset), so
  // the object fills the frame whatever the three-quarter bearing is: the naive
  // per-axis version multiplied the effective distance by ~1.4 and drew every
  // tall landmark small and dim. Margin 1.2 leaves a little air around it.
  const dist = Math.max(3, (maxDim * 0.5 / Math.tan(vfov / 2)) * 1.2);
  // A unit direction on the route-approach bearing, elevated ~28° for a
  // three-quarter read; camera sits exactly `dist` along it.
  let dx = fromDir[0];
  let dz = fromDir[1];
  const len = Math.hypot(dx, dz) || 1;
  dx /= len; dz /= len;
  const el = (28 * Math.PI) / 180;
  const horiz = Math.cos(el);
  cam.position.set(cx + dx * horiz * dist, cy + Math.sin(el) * dist, cz + dz * horiz * dist);
  cam.lookAt(cx, cy, cz);
  cam.updateMatrixWorld(true);

  const gl = st.gl;
  const prevExp = gl.toneMappingExposure;
  gl.toneMappingExposure = exposure;
  const saved = [];
  st.scene.traverse((o) => { if (o.isLight) { saved.push([o, o.intensity]); o.intensity *= boost; } });
  gl.render(st.scene, cam);
  const url = gl.domElement.toDataURL("image/png");
  gl.toneMappingExposure = prevExp;
  for (const [o, v] of saved) o.intensity = v;

  // Mean luminance for the legibility gate, computed off a downscale.
  return new Promise((resolve) => {
    const c = document.createElement("canvas");
    c.width = 160; c.height = 120;
    const ctx = c.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, 160, 120);
      const d = ctx.getImageData(0, 0, 160, 120).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      resolve({ url, lum: s / (160 * 120), dist, camY: cam.position.y });
    };
    img.onerror = () => resolve({ url, lum: -1, dist });
    img.src = url;
  });
};

// A global material/white-box census, once, so an untextured prop is caught even
// where the free-fly camera never frames it head-on. Mirrors check-playthrough.
const WORLD_CENSUS_FN = () => {
  const st = window.__stage;
  if (!st || !st.gl) return { err: "no stage" };
  const r = st.gl.info.render;
  let meshes = 0, whiteBoxes = 0, nullMat = 0;
  const white = [];
  st.scene.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const arr = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of arr) {
      if (!m) { nullMat++; continue; }
      const lit = m.type === "MeshStandardMaterial" || m.type === "MeshPhysicalMaterial";
      if (lit && !m.map && !o.isSkinnedMesh && m.color && m.color.r >= 0.85 && m.color.g >= 0.85 && m.color.b >= 0.85) {
        whiteBoxes++;
        if (white.length < 12) white.push(o.name || o.parent?.name || "(unnamed)");
      }
    }
  });
  return {
    calls: r.calls, triangles: r.triangles,
    textures: st.gl.info.memory.textures, meshes, whiteBoxes, nullMat, white,
  };
};

/** Pick one representative placement per (asset, size-bucket): a shot each. */
function captureTargets(placements) {
  const groups = new Map();
  for (const p of placements) {
    const bucket = `${p.asset}|${p.size.map((n) => Math.round(n)).join("x")}`;
    const rep = groups.get(bucket);
    if (!rep) { groups.set(bucket, { rep: p, count: 1 }); continue; }
    rep.count++;
    // Prefer the copy nearest a route node (what the player actually sees).
    if (nearestNode(p.pos).distM < nearestNode(rep.rep.pos).distM) rep.rep = p;
  }
  return [...groups.values()].map((g) => ({ placement: g.rep, count: g.count }));
}

async function visualSweep(placements) {
  const { chromium } = await import("playwright");
  const opts = {
    headless: true,
    args: ["--headless=new", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
  };
  if (existsSync(CHROME)) opts.executablePath = CHROME;
  const browser = await chromium.launch(opts);
  const page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
  page.on("pageerror", (e) => log("  [page error]", String(e).slice(0, 140)));

  const url = `${BASE}/src/mission/floor.html?hold=0&encounterVerdict=correct`;
  await page.goto(url, { waitUntil: "commit", timeout: 120000 });
  let up = false;
  for (let i = 0; i < 300; i++) {
    if ((await page.evaluate(() => window.__floor?.ticks ?? null).catch(() => null)) !== null) { up = true; break; }
    await sleep(200);
  }
  if (!up) { await browser.close(); throw new Error(`mission runtime never came up at ${url}`); }
  await sleep(9000); // every GLB loads and the first frames settle

  const census = await page.evaluate(WORLD_CENSUS_FN).catch((e) => ({ err: String(e) }));
  writeFileSync(join(OUT, "scene-census.json"), JSON.stringify(census, null, 2));
  log(`[shots] scene: ${census.calls} calls, ${census.triangles?.toLocaleString?.()} tris, ${census.textures} textures, ${census.meshes} meshes, whiteBoxes=${census.whiteBoxes}`);
  if (census.whiteBoxes > 0) {
    addFinding({
      cls: "WHITE_BOX", id: "(scene)", asset: census.white.join(", "),
      severity: 3, confident: true, mechanisable: true,
      detail: `${census.whiteBoxes} lit mesh(es) with no base-colour map and a near-white colour — the untextured white-box signature: ${census.white.join(", ")}`,
      vis: { score: 0.9, section: "-", nearNode: "-", distM: 0 },
    });
  }

  const targets = captureTargets(placements);
  log(`[shots] ${targets.length} representative frames to capture (of ${placements.length} placements)`);
  const shots = [];
  let illegible = 0;
  for (const { placement, count } of targets) {
    const nn = nearestNode(placement.pos);
    // Camera sits on the node side; if the node is basically on top of the
    // object, fall back to a fixed three-quarter bearing.
    let fromDir = [nn.node.pos[0] - placement.pos[0], nn.node.pos[2] - placement.pos[2]];
    if (Math.hypot(fromDir[0], fromDir[1]) < 1) fromDir = [0.7, 0.7];

    let exposure = 3.4, boost = 7, res = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      res = await page.evaluate(CAPTURE_FN, {
        target: placement.pos, size: placement.size, fromDir, exposure, boost,
      }).catch((e) => ({ err: String(e).slice(0, 120) }));
      if (res.err || res.lum < 0) break;
      if (res.lum >= THRESH.legibleLum) break;
      exposure *= 1.7; boost *= 1.6; // too dark — brighten and retry
    }
    const safe = `${placement.asset}__${placement.id}`.replace(/[^a-z0-9_.-]/gi, "_");
    const file = `${safe}.png`;
    let legible = false;
    if (res && !res.err && res.lum >= 0) {
      writeFileSync(join(SHOTS, file), Buffer.from(res.url.split(",")[1], "base64"));
      legible = res.lum >= THRESH.legibleLum;
      if (!legible) illegible++;
    }
    shots.push({
      id: placement.id, asset: placement.asset, count,
      file: res && !res.err && res.lum >= 0 ? `shots/${file}` : null,
      lum: res?.lum != null ? +res.lum.toFixed(1) : null,
      legible,
      pos: placement.pos, size: placement.size,
      vis: visibilityScore(placement),
      err: res?.err ?? null,
    });
  }
  await browser.close();
  log(`[shots] captured ${shots.filter((s) => s.file).length}/${targets.length}; ${illegible} still illegible after brightening`);
  return { shots, census, illegible };
}

// ---------------------------------------------------------------- report
function frameForPlacementId(id, shots) {
  // A finding names one placement id; a shot names its representative. Match by
  // asset+bucket via the placement id first, then fall back to same-asset shot.
  const bare = String(id).split(" ")[0];
  const exact = shots.find((s) => s.id === bare);
  if (exact) return exact;
  const asset = bare; // clash ids differ; try asset-name match
  return shots.find((s) => s.asset && asset.includes(s.asset)) ?? null;
}

function rankFindings(shots) {
  for (const f of findings) {
    if (!f.frame && f.vis) {
      const s = frameForPlacementId(f.id, shots) ?? shots.find((sh) => sh.asset === f.asset);
      f.frame = s?.file ?? null;
      f.frameLum = s?.lum ?? null;
    }
    // Rank score: visibility × severity, with excluded findings sunk to the end.
    // CLASH is down-weighted: it is the noisiest class (co-rooted architecture is
    // an unavoidable false positive) and always needs the eye, so it should not
    // outrank a confident structural defect at the same visibility.
    const sevW = { 1: 0.5, 2: 0.8, 3: 1.0 }[f.severity] ?? 0.8;
    const clsW = f.cls === "CLASH" ? 0.45 : 1;
    f.rank = +(((f.vis?.score ?? 0.3) * sevW * clsW) * (f.excluded ? 0.01 : 1)).toFixed(3);
  }
  findings.sort((a, b) => b.rank - a.rank);
}

function writeReport(context) {
  writeFileSync(join(OUT, "findings.json"), JSON.stringify({ generatedAt: new Date().toISOString(), context, findings }, null, 2));

  const ranked = findings.filter((f) => !f.excluded);
  const excluded = findings.filter((f) => f.excluded);
  const confident = ranked.filter((f) => f.confident);
  const human = ranked.filter((f) => !f.confident);

  const md = [];
  md.push(`# M1 world visual sweep — findings`);
  md.push(``);
  md.push(`Generated ${new Date().toISOString()} from \`sceneryPlacements()\` (${context.placements} drawn objects, ${context.uniqueAssets} unique assets).`);
  md.push(`Frames: ${context.shotsCaptured}/${context.shotTargets} representative captures; ${context.illegible} illegible after brightening. Coverage: ${context.coveragePct}% of placements have a legible frame.`);
  md.push(``);
  md.push(`- Confident (mechanisable / structural): **${confident.length}**`);
  md.push(`- Needs a human eye on the frame: **${human.length}**`);
  md.push(`- Excluded from ranking (elm mesh / ladders, fixed elsewhere): **${excluded.length}**`);
  md.push(``);
  const sev3 = ranked.filter((f) => f.severity === 3);
  if (sev3.length) {
    md.push(`## ⚠ Highest severity (severity 3)`);
    for (const f of sev3) md.push(renderFindingMd(f));
    md.push(``);
  }
  md.push(`## Ranked findings (by owner visibility × severity)`);
  for (const f of ranked) md.push(renderFindingMd(f));
  if (excluded.length) {
    md.push(``);
    md.push(`## Excluded (known-broken, being fixed on other branches — not ranked)`);
    for (const f of excluded) md.push(renderFindingMd(f));
  }
  writeFileSync(join(OUT, "findings.md"), md.join("\n"));

  // Contact sheet.
  const rows = findings.map((f) => `
    <div class="card ${f.excluded ? "excl" : ""} sev${f.severity}">
      <div class="meta">
        <span class="cls">${f.cls}</span>
        <span class="sev">S${f.severity}</span>
        <span class="conf">${f.confident ? "confident" : "needs-human"}</span>
        <span class="rank">rank ${f.rank}</span>
      </div>
      <div class="id">${escapeHtml(String(f.id))} <small>${escapeHtml(f.asset ?? "")}</small></div>
      <div class="where">${f.vis ? `${f.vis.section} · near ${f.vis.nearNode} (${f.vis.distM}m) · vis ${f.vis.score}` : ""}</div>
      ${f.frame ? `<a href="${f.frame}" target="_blank"><img src="${f.frame}" loading="lazy"/></a>` : `<div class="noframe">no frame</div>`}
      <div class="detail">${escapeHtml(f.detail)}</div>
    </div>`).join("\n");
  const allShots = (context.shots ?? []).map((s) => `
    <div class="card shot ${s.legible ? "" : "illegible"}">
      <div class="id">${escapeHtml(s.id)} <small>${escapeHtml(s.asset)} ×${s.count}</small></div>
      <div class="where">${s.vis.section} · ${s.vis.nearNode} (${s.vis.distM}m) · lum ${s.lum}${s.legible ? "" : " ⚠ILLEGIBLE"}</div>
      ${s.file ? `<a href="${s.file}" target="_blank"><img src="${s.file}" loading="lazy"/></a>` : `<div class="noframe">${escapeHtml(s.err ?? "no frame")}</div>`}
    </div>`).join("\n");
  const html = `<!doctype html><meta charset="utf8"><title>M1 world sweep</title>
<style>
 body{background:#14171c;color:#dfe4ea;font:13px/1.4 system-ui,sans-serif;margin:0;padding:18px}
 h1,h2{color:#fff} h2{margin-top:28px;border-top:1px solid #2b313a;padding-top:16px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:14px}
 .card{background:#1d222a;border:1px solid #2b313a;border-radius:8px;padding:10px}
 .card.sev3{border-color:#c0392b} .card.excl{opacity:.5}
 .card img{width:100%;border-radius:5px;display:block;background:#000}
 .meta{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}
 .meta span{font-size:11px;padding:1px 6px;border-radius:4px;background:#2b313a}
 .cls{background:#34506b!important} .sev{background:#7b3b3b!important}
 .conf{background:#3b6b47!important} .id{font-weight:600} .id small{color:#8b95a3;font-weight:400}
 .where{color:#8b95a3;font-size:11px;margin:3px 0} .detail{margin-top:6px;color:#c6ccd4}
 .noframe{color:#c0392b;padding:24px;text-align:center} .illegible img{outline:2px solid #c0392b}
</style>
<h1>M1 world visual sweep</h1>
<p>${context.placements} drawn objects · ${context.uniqueAssets} assets · ${context.shotsCaptured}/${context.shotTargets} frames · ${context.coveragePct}% coverage · ${context.illegible} illegible</p>
<h2>Findings (${findings.length}), ranked</h2>
<div class="grid">${rows}</div>
<h2>Full contact sheet — every representative frame (${(context.shots ?? []).length})</h2>
<div class="grid">${allShots}</div>`;
  writeFileSync(join(OUT, "contact-sheet.html"), html);
}

function renderFindingMd(f) {
  const frame = f.frame ? `\n  - frame: \`.affordwork/world-sweep/${f.frame}\`${f.frameLum != null ? ` (lum ${f.frameLum})` : ""}` : `\n  - frame: none`;
  const where = f.vis ? `${f.vis.section}, near node ${f.vis.nearNode} (${f.vis.distM}m), visibility ${f.vis.score}` : "-";
  return `\n### [${f.cls}] ${f.id}  — S${f.severity}, ${f.confident ? "CONFIDENT" : "needs-human"}, rank ${f.rank}\n  - asset: \`${f.asset}\`\n  - where: ${where}\n  - ${f.detail}${frame}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- main
async function main() {
  log(`check-world-visual-sweep → ${CENSUS_ONLY ? "census only" : SHOTS_ONLY ? "shots only" : "full sweep"}`);
  // The census both enumerates placements and computes the mechanisable findings.
  // --shots-only skips the findings but still needs the enumeration to know what
  // to photograph.
  let placements, placed = [];
  if (SHOTS_ONLY) {
    placements = sceneryPlacements(M1_EFFIGY_RUN);
    log(`[shots-only] ${placements.length} placements enumerated (census findings skipped)`);
  } else {
    const c = await staticCensus();
    placements = c.placements;
    placed = c.placed;
  }
  const uniqueAssets = new Set(placements.map((p) => p.asset)).size;

  let shots = [];
  let census = null;
  let illegible = 0;
  if (!CENSUS_ONLY) {
    if (!(await reachable(`${BASE}/`))) {
      log(`\nFATAL: no dev web server at ${BASE}. Start one on a free port:`);
      log(`  (cd apps/web && node node_modules/vite/bin/vite.js --port 5299 --strictPort)`);
      log(`Or run the mechanisable half only:  node --import tsx scripts/check-world-visual-sweep.mjs --census`);
      process.exit(2);
    }
    const v = await visualSweep(placements);
    shots = v.shots; census = v.census; illegible = v.illegible;
  }

  rankFindings(shots);

  const shotsCaptured = shots.filter((s) => s.file && s.legible).length;
  const coveragePct = shots.length ? +((shotsCaptured / shots.length) * 100).toFixed(0) : 0;
  const context = {
    placements: placements.length, placed: placed.length, uniqueAssets,
    shotTargets: shots.length, shotsCaptured, illegible, coveragePct,
    census, shots,
  };
  writeReport(context);

  // Console summary.
  log(`\n==================== WORLD VISUAL SWEEP ====================`);
  log(`placements: ${placements.length} (${uniqueAssets} assets) · frames: ${shotsCaptured}/${shots.length} legible (${coveragePct}%)`);
  const ranked = findings.filter((f) => !f.excluded);
  const sev3 = ranked.filter((f) => f.severity === 3);
  if (sev3.length) {
    log(`\n⚠ SEVERITY 3 (${sev3.length}) — highest owner-visibility defects:`);
    for (const f of sev3.slice(0, 12)) log(`  [${f.cls}] ${f.id} (${f.vis?.section}) — ${f.detail.slice(0, 110)}`);
  }
  log(`\nTop ranked findings:`);
  for (const f of ranked.slice(0, 16)) {
    log(`  ${String(f.rank).padStart(5)} [${f.cls}] ${f.id} · ${f.confident ? "confident" : "needs-human"} · ${(f.detail || "").slice(0, 90)}`);
  }
  log(`\nExcluded (noted, not ranked): ${findings.filter((f) => f.excluded).length}`);
  log(`\nWrote:`);
  log(`  ${join(OUT, "findings.md")}`);
  log(`  ${join(OUT, "findings.json")}`);
  log(`  ${join(OUT, "contact-sheet.html")}`);
  log(`  ${SHOTS}/*.png`);
}

async function reachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
    return res.status < 500;
  } catch { return false; }
}

await main();
