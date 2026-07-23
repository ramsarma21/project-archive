// Copy built runtime assets into the web app's public dir so Vite serves them.
// Usage: node assets/pipeline/sync_web.mjs
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const pairs = [
  ["assets/build/anims", "apps/web/public/world/anims"],
  ["assets/build/world-opt", "apps/web/public/world/props"],
  // world-v3 factories write optimized output here (Bible §12 budgets)
  ["assets/build/world-v3-opt", "apps/web/public/world/props"],
  // Independent interior rebuild factories. Both directories are scoped to
  // verified production GLBs; component subdirectories are intentionally not
  // traversed, so only the 29 kit assets + assembled press v2 are deployed.
  ["assets/build/interior-kit-opt", "apps/web/public/world/props"],
  ["assets/build/interior-runtime-opt", "apps/web/public/world/props"],
  // Scoped Act 1 M4 production batch. Never broad-copy source concepts or
  // unverified raw Meshy output.
  ["assets/build/world-m4-opt", "apps/web/public/world/props"],
  ["assets/build/world-v3-structures-opt", "apps/web/public/world/structures"],
];

let copied = 0;
for (const [src, dst] of pairs) {
  const s = resolve(src);
  const d = resolve(dst);
  if (!existsSync(s)) continue;
  mkdirSync(d, { recursive: true });
  for (const f of readdirSync(s)) {
    if (!f.endsWith(".glb")) continue;
    const from = join(s, f);
    if (!statSync(from).isFile()) continue;
    cpSync(from, join(d, f));
    copied++;
  }
}

// Never copy characters-opt here: those files are optimized meshes with zero
// animation clips and would silently replace the working self-contained cast.
const cast = {
  "playerboy-v6-native.glb": "playerboy-rigged.glb",
  "abigail-production.glb": "abigail-rigged.glb",
  "thomas-native.glb": "thomas-rigged.glb",
  // Pike's auto-rig rest pose is an A-pose, so his clips are rebaked with
  // retarget_native_mixamo_rest_delta.py (absolute mode) instead of the
  // direct action attach used for the T-pose-rest cast members.
  "pike-production.glb": "pike-rigged.glb",
  "clarke-native.glb": "clarke-rigged.glb",
  "rider-native.glb": "rider-rigged.glb",
  "officer-native.glb": "officer-rigged.glb",
  "townsman-native.glb": "townsman-rigged.glb",
  "townswoman-native.glb": "townswoman-rigged.glb",
  // World-v3 street archetypes (Bible §9), built via Meshy image-to-3D ->
  // Meshy rig -> bake_character_anims.py rest-delta retarget (the
  // abigail-production path; no Mixamo web automation involved).
  "npc-dockhand-production.glb": "dockhand-rigged.glb",
  "npc-agitator-production.glb": "agitator-rigged.glb",
  "npc-taxclerk-production.glb": "taxclerk-rigged.glb",
  "npc-towncrier-production.glb": "towncrier-rigged.glb",
  "npc-goodwife-production.glb": "goodwife-rigged.glb",
  "constable-rigged.glb": "constable-rigged.glb",
};
const castSource = resolve("assets/build/characters-final");
const castDest = resolve("apps/web/public/world/characters");
mkdirSync(castDest, { recursive: true });
for (const [sourceName, destinationName] of Object.entries(cast)) {
  const source = join(castSource, sourceName);
  if (!existsSync(source)) {
    console.warn(`[sync] keeping deployed ${destinationName}; missing native source ${sourceName}`);
    continue;
  }
  cpSync(source, join(castDest, destinationName));
  copied++;
}
console.log(`synced ${copied} glb files into apps/web/public/world`);
