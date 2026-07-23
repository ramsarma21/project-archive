// Build assets/build/world-v3/street-civic-manifest.json for the street &
// civic batch: key -> { glbPath, publicPath, conceptPath, bboxSize, notes }.
// bboxSize is measured from the deployed (optimized) GLB in public props.
globalThis.self = globalThis;
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const threeRoot = resolve("node_modules/.pnpm/three@0.185.1/node_modules/three");
const { Box3, Vector3 } = await import(`${threeRoot}/build/three.module.js`);
const { GLTFLoader } = await import(`${threeRoot}/examples/jsm/loaders/GLTFLoader.js`);

const NOTES = {
  "church-meetinghouse": "Old South stand-in: brick meetinghouse, white steeple w/ clock+belfry; tallest landmark; scale so steeple clears the row rooflines",
  "bldg-townhouse-civic": "Old State House style Georgian brick civic building; balcony over central door + cupola; Massacre stage (Day 2) faces the square",
  "bldg-tavern": "Weathered clapboard tavern; pictorial grapes sign on iron bracket over the door (Bunch of Grapes style), no lettering",
  "bldg-row-clapboard-a": "Narrow 2.5-story weathered clapboard row house, street-facing gable, single chimney",
  "bldg-row-clapboard-b": "3-story dark clapboard row house with gambrel roof + dormers, twin chimneys",
  "bldg-row-clapboard-c": "2.5-story clapboard row house with jettied overhanging second floor, post-and-beam brackets",
  "bldg-row-brick-a": "3-story Georgian red brick row house, pedimented door, stone lintels",
  "bldg-row-brick-b": "2.5-story weathered brown brick row house, green shutters, arched brick doorway",
  "bldg-row-shop": "Clapboard shop row building; large bow display window; blank wheat-sheaf trade sign on bracket",
  "bldg-warehouse-street": "Chandlery/rope-walk warehouse facade for the west street; loading doors, loft hoist beam, anchor trade sign",
  "bldg-scaffold": "Facade under repair with lashed-pole wooden scaffold, 2 plank levels + ladder; doubles as climb spot (TraversalDirector)",
  "town-gate": "Timber town gate w/ crossbeam + plank double gate, flanking pointed-log palisade sections (east gate, road to the Neck)",
  "skyline-cluster-a": "Background rooftop cluster, central white steeple; silhouette-quality only, place z<-50/z>+50 ring",
  "skyline-cluster-b": "Background long row cluster; spire at one end + cupola at other; silhouette-quality only",
  "skyline-cluster-c": "Background modest rooftop huddle, no steeple; silhouette-quality only",
  "street-lantern-bracket": "Whale-oil lantern on scrolled wrought iron wall bracket; mount on building faces; emissive glass at night",
  "hitching-post": "Weathered oak hitching post w/ iron ring; Meshy added a small ground disc base - sink base slightly into terrain when placing",
  "firewood-stack": "Split-log firewood stack on sleeper poles, hip height",
  "hay-cart": "Two-wheel wooden hay cart, shafts down, hay mounded; usable as street blocker per route-gating law",
  "market-awning": "Timber market stall with sagging canvas awning, counter board + baskets (variant of existing market-stall)",
  "churchyard-fence": "Wrought iron spear-top fence section between granite posts; tile along churchyard edge",
  "stone-steps": "Three worn granite entry steps w/ landing; for meetinghouse/town-house doorways",
};

const loader = new GLTFLoader();
const manifest = {};
for (const key of Object.keys(NOTES)) {
  const publicPath = `apps/web/public/world/props/${key}.glb`;
  const bytes = readFileSync(resolve(publicPath));
  const gltf = await new Promise((resolvePromise, rejectPromise) => {
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "", resolvePromise, rejectPromise);
  });
  const size = new Box3().setFromObject(gltf.scene).getSize(new Vector3());
  manifest[key] = {
    glbPath: `assets/build/world-v3/${key}.glb`,
    publicPath,
    conceptPath: `assets/source/concepts/${key}.png`,
    bboxSize: [Number(size.x.toFixed(3)), Number(size.y.toFixed(3)), Number(size.z.toFixed(3))],
    notes: NOTES[key],
  };
}
const output = {
  _meta: {
    batch: "street-civic",
    generatedAt: new Date().toISOString(),
    note: "bboxSize measured from deployed GLB. Meshy normalizes models to a ~1.9-unit box; these are NOT meters. Layout must scale each building to its real footprint (Bible section 3) using bbox proportions.",
    budgets: "buildings <=40k tris, props/skyline <=15k tris, textures <=1024 JPEG85 (applied via assets/pipeline/optimize_street_civic.py, Blender 5.1.2)",
  },
  ...manifest,
};
const out = resolve("assets/build/world-v3/street-civic-manifest.json");
writeFileSync(out, JSON.stringify(output, null, 2) + "\n");
console.log("WROTE", out, Object.keys(manifest).length, "assets");
