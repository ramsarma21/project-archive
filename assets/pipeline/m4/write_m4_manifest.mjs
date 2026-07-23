// Emit the M4 batch manifest: for every produced asset, record its source
// concept, built GLB (bbox/tris/nodes/pivots), textures, character clips/bones,
// collision sidecar summary, reuse decisions, and integration targets. Scoped:
// reads only the M4 build dirs + the constable final GLB. Output:
//   assets/build/world-m4-opt/m4-manifest.json
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..", "..", "..");
process.chdir(ROOT);
const OPT = "assets/build/world-m4-opt";
const COL = "assets/source/collision";

function glbInfo(path) {
  const data = readFileSync(resolve(path));
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error("not glb");
  const len = data.readUInt32LE(12);
  const j = JSON.parse(data.slice(20, 20 + len).toString("utf8"));
  const nodes = (j.nodes ?? []).map((n) => n.name).filter(Boolean);
  const pivots = (j.nodes ?? []).filter((n) => n.mesh === undefined && n.name).map((n) => n.name);
  let tris = 0;
  for (const m of j.meshes ?? []) for (const p of m.primitives ?? []) {
    const acc = j.accessors?.[p.indices];
    if (acc) tris += acc.count / 3;
  }
  return {
    bytes: statSync(resolve(path)).size,
    meshNodes: (j.nodes ?? []).filter((n) => n.mesh !== undefined).length,
    nodeNames: nodes,
    pivots,
    images: (j.images ?? []).length,
    materials: (j.materials ?? []).length,
    tris: Math.round(tris),
  };
}

function collision(key) {
  const p = `${COL}/${key}.collision.json`;
  if (!existsSync(p)) return null;
  const c = JSON.parse(readFileSync(resolve(p), "utf8"));
  return { profile: c.profile, category: c.category, colliderIds: (c.colliders ?? []).map((x) => x.id) };
}

const props = [
  ["roof-walk-board", "Item 4 roof-route bridge board (short); walkable support + rope-rail posts."],
  ["roof-walk-board-long", "Item 4 roof-route bridge board (long); mid A-frame trestle."],
  ["effigy-oliver", "Item 5/2 B11 Andrew Oliver straw effigy body; hang/carry/placard pivots."],
  ["effigy-boot", "Item 5 B11 Lord-Bute devil jack-boot; swing pivot."],
  ["organizer-crate-perch", "Item 5 B11 organizer speaking platform (crates + barrel); walkable perch."],
  ["protest-torch", "Item 5 B11 night-march pitch torch; torch_flame light node."],
  ["protest-banner", "Item 5 B11 blank linen banner on cross-pole; banner_face decal node (slogans via banner-* textures)."],
  ["coin-paper-set", "Item 3 KN-coinpaper interior prop (coins + scrip); pairs with reused storage-chest."],
  ["street-dog", "Item 6 FLV-dog street dog; STATIC mesh (animation blocker: see report)."],
  ["printer-ink-balls", "Print-mechanic matched pair of common-press ink balls; two instanced named nodes InkBall_Left/Right (shared mesh) with handle-aligned _grip/_rock pivots + InkSurface_Left/Right ink-transfer nodes. Feeds the B2/reprint/B12 PRINT_JOB ink phase (first-person dab/rock); rest pose +Y up, handle up, pad grounded."],
];

// Raw Meshy source stems that differ from the final optimized asset key.
const RAW_SRC = {
  "protest-banner": "protest-banner-cloth",
  // The pair is assembled from a single source ink ball.
  "printer-ink-balls": "printer-ink-ball",
};

const textures = [
  ["sign-watchhouse", "Item 1 watch-house hanging sign face (WATCH HOUSE + lantern/staff/rattle). Applied as a plane/decal; reuses printshop-hanging-sign GLB geometry."],
  ["placard-andrew-oliver", "Item 2 Andrew Oliver effigy placard art (A. OLIVER / STAMP-MAN + devil/boot); decal on effigy placard_mount node."],
  ["coinpaper-card", "Item 3 KN-coinpaper learning artwork (Spanish silver + Mass. 1765 scrip study plate)."],
  ["banner-consent", "Item 5 B11 banner slogan decal: NO STAMP BUT BY OUR OWN CONSENT (on protest-banner banner_face)."],
  ["banner-never-asked", "Item 5 B11 banner slogan decal: WE WERE NEVER ASKED (on protest-banner banner_face)."],
];

const manifest = {
  batch: "M4 long-lead imported assets",
  generatedAt: new Date().toISOString(),
  pipeline: "Gemini(TrueFoundry nano-banana) concept -> visual/historical QA -> Meshy image-to-3D -> Blender optimize+name+pivots -> QA render/inspect -> collision sidecar -> scoped manifest",
  props: props.map(([key, note]) => ({
    key,
    note,
    concept: `assets/source/concepts/m4/${RAW_SRC[key] ?? key}.png`,
    rawGlb: `assets/build/world-m4/${RAW_SRC[key] ?? key}.glb`,
    optimizedGlb: `${OPT}/${key}.glb`,
    glb: existsSync(`${OPT}/${key}.glb`) ? glbInfo(`${OPT}/${key}.glb`) : null,
    collision: collision(key),
    integrationTarget: `apps/web/public/world/props/${key}.glb`,
  })),
  character: {
    key: "constable-rigged",
    note: "Item 7 dedicated 1765 Boston constable/watchman (civilian slate coat, tricorne; NOT redcoat). Replaces the tinted officer-rigged for watchers at M4.",
    concept: "assets/source/concepts/m4/constable.png",
    base: "assets/build/characters/constable-base.glb",
    rigged: "assets/build/characters/constable-rigged.glb",
    final: "assets/build/characters-final/constable-rigged.glb",
    glb: existsSync("assets/build/characters-final/constable-rigged.glb") ? glbInfo("assets/build/characters-final/constable-rigged.glb") : null,
    clips: ["idle", "walk", "run", "search", "talk", "talk2", "argu1", "reach"],
    requiredClips: ["idle", "walk", "run", "talk2", "argu1"],
    skeleton: "24-bone Meshy humanoid (same family/BONE_MAP as officer + NPC cast; Mixamo rest-delta retarget)",
    integrationTarget: "apps/web/public/world/characters/constable-rigged.glb",
  },
  textures: textures.map(([key, note]) => ({
    key,
    note,
    file: `assets/build/textures/m4/${key}.png`,
    concept: `assets/source/concepts/m4/${key}.png`,
    integrationTarget: `apps/web/public/world/posters/${key}.png`,
  })),
  reusedSkipped: [
    "bldg-townhouse-civic (+ stone-steps) reused as the watch-house building (locked decision); only the sign texture is new.",
    "printshop-hanging-sign.glb reused as the hanging-sign GLB carrier for sign-watchhouse (texture-only new).",
    "storage-chest.glb reused as the KN-coinpaper container (coin-paper-set + coinpaper-card added).",
    "11 posters/signs already deployed; not regenerated.",
    "officer-rigged/taxclerk-rigged tint remains the M1-M2 watcher; constable is the M4 production upgrade only.",
    "dog-bark.wav SFX already exists for FLV-dog audio (separate from the dog GLB).",
  ],
  blockers: [
    "street-dog animation: the character rig pipeline is humanoid-only (Meshy humanoid rigging + Mixamo humanoid clips + humanoid BONE_MAP). A quadruped cannot be safely auto-rigged/animated without bespoke mocap, which violates the no-mocap/quality laws. Delivered as a STATIC GLB. Options for a later pass documented in the report.",
    "crier shout audio (SJ-crier): ElevenLabs key lacks sound_generation permission (all existing audio is offline-synth, source=synth). Human voice shouts are out of scope for Meshy and for the no-voice offline DSP kit. Exact prompt/spec left in the report; needs an audio permission or a voiced-line pass.",
  ],
};

const outPath = `${OPT}/m4-manifest.json`;
writeFileSync(resolve(outPath), JSON.stringify(manifest, null, 2));
console.log("WROTE", outPath);
console.log(`props=${manifest.props.length} textures=${manifest.textures.length} character=1`);
