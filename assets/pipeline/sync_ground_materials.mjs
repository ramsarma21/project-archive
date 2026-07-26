#!/usr/bin/env node
// Ground materials for the served tree.
//
// These four are the road kit's own albedo tiles (see
// assets/source/concepts/roads/road-kit-manifest.json). Each was generated as a
// seamless overhead orthographic square — "opposite edges must tile invisibly"
// is in the prompt sidecar — which is what lets a level pave an eighty-eight
// metre run by repeating one 1024px image instead of streaming a plate mesh per
// twenty metres. The road kit's GLB plates carry the same images embedded; a
// level that only needs a flat surface takes the image and skips the 1.3MB mesh.
//
// The re-encode is the road kit's own published convention, from the manifest's
// `_meta.textures`: JPEG, max 1024px, quality 80. The sources are already 1024,
// so this is a format change only, and it takes ~3.6MB of PNG down to well under
// a megabyte for the whole set.
//
// `sips` ships with macOS, which is where the asset pipeline runs. It is required
// rather than optional: falling back to copying the PNG would put four times the
// bytes in the served tree without anyone noticing.

import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const source = resolve(root, "assets/source/concepts/roads/materials");
const destination = resolve(root, "apps/web/public/world/textures");

/** Source stem -> served name. The served names say what a surface IS. */
const MATERIALS = {
  "colonial-street-a-material": "ground-street-cobble",
  "colonial-civic-square-material": "ground-square-granite",
  "colonial-liberty-courtyard-material": "ground-open-earth",
  "colonial-yard-ground-material": "ground-yard-rubble",
};

const QUALITY = 80;
const MAX_PX = 1024;

mkdirSync(destination, { recursive: true });

const synced = [];
for (const [stem, name] of Object.entries(MATERIALS)) {
  const from = resolve(source, `${stem}.png`);
  const to = resolve(destination, `${name}.jpg`);
  execFileSync("sips", [
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(QUALITY),
    "-Z", String(MAX_PX),
    from,
    "--out", to,
  ], { stdio: "pipe" });
  synced.push({ name: `${name}.jpg`, bytes: statSync(to).size });
}

console.log(JSON.stringify({ synced, destination }, null, 2));
