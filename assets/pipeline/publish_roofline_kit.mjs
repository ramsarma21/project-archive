#!/usr/bin/env node
// Publish the roofline kit into the served tree, and nothing else.
//
// Deliberately NOT sync_web.mjs. That script also promotes whatever is sitting
// in the character pipeline into public/world/characters, which last night
// deployed a rig nobody had asked for. It copies by directory, so adding a pair
// for this build would inherit that side effect for no benefit: this kit is four
// GLBs and two PNGs with names known in advance, so it can be published by name
// and the output can say exactly what moved.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");

/** Built file -> served path, relative to apps/web/public. */
const FILES = {
  "assets/build/world-m1-roofline-opt/roof-plank-gantry.glb": "world/props/roof-plank-gantry.glb",
  "assets/build/world-m1-roofline-opt/roof-ridge-walk.glb": "world/props/roof-ridge-walk.glb",
  "assets/build/world-m1-roofline-opt/roof-chimney-stack.glb": "world/props/roof-chimney-stack.glb",
  "assets/build/world-m1-roofline-opt/service-wall-end.glb": "world/props/service-wall-end.glb",
  "assets/build/world-m1-roofline-opt/int-shell-ropewalk-a.glb":
    "world/structures/int-shell-ropewalk-a.glb",
  "assets/build/world-m1-paper/handbill-unstamped.png": "world/posters/handbill-unstamped.png",
  "assets/build/world-m1-paper/notice-stamp-act.png": "world/posters/notice-stamp-act.png",
};

const published = [];
const skipped = [];
for (const [from, to] of Object.entries(FILES)) {
  const source = resolve(root, from);
  if (!existsSync(source)) {
    skipped.push(to);
    continue;
  }
  const destination = resolve(root, "apps/web/public", to);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  copyFileSync(source, destination);
  published.push({ to, kib: Math.round(statSync(destination).size / 1024) });
}

for (const entry of published) console.log(`published ${entry.to.padEnd(46)} ${entry.kib} KiB`);
for (const path of skipped) console.log(`skipped   ${path} (not built yet)`);
console.log(`\n${published.length} published, ${skipped.length} not built`);

