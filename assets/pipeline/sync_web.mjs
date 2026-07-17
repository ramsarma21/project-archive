// Copy built runtime assets into the web app's public dir so Vite serves them.
// Usage: node assets/pipeline/sync_web.mjs
import { cpSync, mkdirSync, existsSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const pairs = [
  ["assets/build/anims", "apps/web/public/world/anims"],
  ["assets/build/characters-opt", "apps/web/public/world/characters"],
  ["assets/build/world-opt", "apps/web/public/world/props"],
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
console.log(`synced ${copied} glb files into apps/web/public/world`);
