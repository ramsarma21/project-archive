// Copy built runtime assets into the web app's public dir so Vite serves them.
// Usage: node assets/pipeline/sync_web.mjs
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { inspectWorldGlb } from "../../scripts/check-world-textures.mjs";
import { inspectWorldScale } from "../../scripts/check-world-scale.mjs";

let refused = 0;
/**
 * Publish one GLB, unless its textures or its SCALE carry a known defect.
 *
 * This is the only place a NEW asset can be stopped before it ships: seven of
 * fifteen character rigs reached public/ with a multi-megabyte opaque-alpha PNG
 * and an alphaMode of BLEND, and nothing failed at any point. The check decodes
 * alpha rather than looking at the format, so an asset that genuinely needs
 * transparency still publishes. See scripts/check-world-textures.mjs.
 *
 * The scale half was added after officer-rigged.glb shipped with its whole rig 100x
 * too small and survived nine days: both runtime loaders normalise a character to a
 * target height, so it rendered correctly and only the file was wrong. See
 * scripts/check-world-scale.mjs.
 *
 * `rigged` is read from the DESTINATION, not the source, because a rig is renamed as
 * it is published - officer-v2-native.glb becomes officer-rigged.glb - so keying the
 * character check on the build filename would silently never fire.
 *
 * Set WORLD_TEXTURE_GUARD=off or WORLD_SCALE_GUARD=off to publish anyway; either
 * prints what it let through.
 */
function publish(from, to) {
  const blocking = [
    ...(process.env.WORLD_TEXTURE_GUARD === "off" ? [] : inspectWorldGlb(from).findings),
    ...(process.env.WORLD_SCALE_GUARD === "off"
      ? []
      : inspectWorldScale(from, { rigged: /-rigged\.glb$/.test(to) }).findings),
  ].filter((finding) => finding.block);
  if (blocking.length === 0) {
    cpSync(from, to);
    return true;
  }
  console.error(`[sync] REFUSED ${from}`);
  for (const finding of blocking) {
    console.error(`        ${finding.code}: ${finding.detail}`);
    console.error(`        fix: ${finding.fix}`);
  }
  refused++;
  return false;
}

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
  // M1 duel weapon batch (Gemini concept -> Meshy image-to-3D ->
  // finish_flintlock.py real-scale/grip-origin pass).
  ["assets/build/world-m1-duel-opt", "apps/web/public/world/props"],
  // M1 Liberty Tree (Gemini concept -> Meshy image-to-3D ->
  // build_liberty_elm.py, which fits the mesh to the collision M1 already
  // authored). Gated on verify_liberty_elm.mjs, not on eyeballing it.
  ["assets/build/world-m1-elm-opt", "apps/web/public/world/props"],
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
    if (publish(from, join(d, f))) copied++;
  }
}

// Never copy characters-opt here: those files are optimized meshes with zero
// animation clips and would silently replace the working self-contained cast.
const cast = {
  // v10 (2026-07-26): dropRoll given its own "Falling To Roll" instead of
  // aliasing dodge, and leapOfFaith un-pinned from 2.39m downrange. 35 of 37
  // clips are bit-identical to v9.
  "playerboy-v10-native.glb": "playerboy-rigged.glb",
  "abigail-production.glb": "abigail-rigged.glb",
  // v2 (2026-07-26): PNG albedo -> JPEG q95. See the texture note below.
  "thomas-v2-native.glb": "thomas-rigged.glb",
  // Pike's auto-rig rest pose is an A-pose, so his clips are rebaked with
  // retarget_native_mixamo_rest_delta.py (absolute mode) instead of the
  // direct action attach used for the T-pose-rest cast members. His v2 keeps the
  // "-production" lineage marker for that reason; it is NOT a native-action bake.
  "pike-v2-production.glb": "pike-rigged.glb",
  "clarke-v2-native.glb": "clarke-rigged.glb",
  "rider-v2-native.glb": "rider-rigged.glb",
  // v2 (2026-07-25): M1 duel antagonist. Full combat set, dialogue clips dropped.
  "officer-v2-native.glb": "officer-rigged.glb",
  // v2 (2026-07-26): six rigs whose Meshy bake returned a 2048 RGBA PNG albedo
  // with an alpha channel holding 5-74 stray pixels out of 4.19M. PNG cost
  // 2.35-4.45MB apiece, and alphaMode BLEND additionally bought a sorted
  // transparent draw for every body wearing one - 36 of them in the market.
  // transcode_rig_textures.py re-encoded the albedo and relaxed the material to
  // OPAQUE. Mesh, skin, bone hierarchy and every animation channel are
  // bit-identical to v1, gated by verify_rig_transcode.py.
  //
  // Quality is set per role, measured with measure_texture_error.py rather than
  // eyeballed. The four story NPCs are met face-to-face and went at q95, which
  // lands at 46.3-48.7dB PSNR. townswoman is ambient only (culled beyond 26-38m)
  // and stays at q90.
  //
  // v3 (2026-07-26): townsman went to q98, because World-Content.md also casts him
  // as the tavern keeper behind the bar - a dialogue close-up, not a crowd body.
  // His albedo is the hardest in the cast: q90 measures 44.5dB and the quality
  // curve is nearly flat above it (q95 44.9, q98 45.3, q99 45.3), so q98 is the
  // top of the plateau. Only q100 goes materially higher and it costs 2.37MB for
  // the albedo alone, giving back most of the saving. If his face ever proves
  // inadequate at 45.3dB the fix is a cleaner bake, not a higher quality number.
  //
  //   townsman   8.22 -> 5.28MB q98   pike    7.68 -> 4.82MB q95
  //   townswoman 8.30 -> 4.55MB q90   rider   6.65 -> 4.40MB q95
  //                                   thomas  6.06 -> 4.13MB q95
  //                                   clarke  6.03 -> 4.13MB q95
  "townsman-v3-native.glb": "townsman-rigged.glb",
  "townswoman-v2-native.glb": "townswoman-rigged.glb",
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
  if (publish(source, join(castDest, destinationName))) copied++;
}
console.log(`synced ${copied} glb files into apps/web/public/world`);
if (refused > 0) {
  console.error(`refused ${refused} glb file(s) carrying a texture defect; nothing else was changed`);
  process.exit(1);
}
