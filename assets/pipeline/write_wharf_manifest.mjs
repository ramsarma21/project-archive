// Assemble wharf-manifest.json from the verify results + pipeline notes.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const verify = JSON.parse(readFileSync(resolve("assets/build/world-v3/wharf-verify.json"), "utf8"));

const NOTES = {
  "ship-brig-hero": "Hero two-masted brig, furled sails, dry-dock geometry (no sea). Meshy target_polycount 60000 via gen_prop_hero_from_image.mjs; optimized to 60k tris. Boardable for Day 3 Tea Party; scale to ~26m hull length at placement.",
  "ship-snow-background": "Simplified anchored square-rigger for harbor distance; 15k tris. Concept retried once to force furled sails (first render had set sails).",
  "ship-sloop": "Single-masted sloop, furled gaff mainsail; 15k tris. Concept retried once for cropped masthead.",
  "rowboat": "Clinker dinghy with oars shipped inboard; 15k tris.",
  "gangplank": "Boarding plank with cross-cleats and rope handrail on stanchions; 15k tris.",
  "buoy": "Tarred stave barrel mooring buoy with iron ring and rope tail; 15k tris.",
  "wharf-pier-module": "Repeatable granite + timber pier edge module with fender piles; square-cut ends for tiling; 15k tris.",
  "wharf-boardwalk-plank": "Repeatable boardwalk deck module on timber joists; square-cut ends for tiling; 15k tris.",
  "bldg-warehouse-wharf-a": "Large 3-story timber warehouse, gable hoist beam + stacked loading doors, granite foundation; 29.8k tris (under 40k building budget, no decimation).",
  "bldg-warehouse-wharf-b": "Narrow 3-story Georgian brick counting house; 28.1k tris (under 40k building budget, no decimation).",
  "timber-crane": "Dockside oak post crane with jib, winch drum, pulley + hook; 15k tris.",
  "bollard": "Mushroom-top oak mooring bollard, iron band, timber footing; 15k tris.",
  "rope-coil-large": "Flat spiral hemp hawser coil; 15k tris.",
  "cargo-net-bundle": "Crates/sacks/barrel in knotted lifting net with top loop (crane load); 15k tris.",
  "crate-mound": "Climbable stack of 7 weathered cargo crates with canvas drape; 15k tris.",
  "fish-flakes-rack": "New England fish flakes: lattice drying platform with salted cod; 15k tris.",
};

const manifest = {};
for (const [key, result] of Object.entries(verify)) {
  manifest[key] = {
    glbPath: `assets/build/world-v3/${key}.glb`,
    optimizedPath: `assets/build/world-v3-opt/${key}.glb`,
    publicPath: `apps/web/public/world/props/${key}.glb`,
    conceptPath: `assets/source/concepts/${key}.png`,
    bboxSize: result.bboxSize,
    tris: result.tris,
    bytes: result.bytes,
    notes: NOTES[key] ?? "",
  };
}

const out = {
  generatedAt: new Date().toISOString(),
  pipeline: "gen_concept_image.mjs (Nano Banana) -> QA -> gen_prop_from_image.mjs / gen_prop_hero_from_image.mjs (Meshy image-to-3D) -> optimize_world_v3_wharf.py (Blender 60k/40k/15k, tex<=1024 JPEG) -> apps/web/public/world/props",
  bboxNote: "Meshy normalizes output scale (~1.9 max dimension); real-world size is applied at placement in manifest.ts per Bible SS3 wharf layout.",
  assets: manifest,
};
writeFileSync(resolve("assets/build/world-v3/wharf-manifest.json"), JSON.stringify(out, null, 2));
console.log("WROTE assets/build/world-v3/wharf-manifest.json", Object.keys(manifest).length, "assets");
