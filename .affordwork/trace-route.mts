import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.js";
import { routeDistanceGraph, cheapestPath } from "../packages/mission-m1/src/routeGraph.js";

const level = M1_EFFIGY_RUN;
const g = routeDistanceGraph(level);
const posOf = new Map(level.nodes.map((n) => [n.id, n.pos] as const));
const secOf = new Map(level.nodes.map((n) => [n.id, n.section] as const));
const linkOf = new Map(level.links.map((l) => [`${l.from}>${l.to}`, l] as const));

function seg(from: string, to: string, label: string) {
  const p = cheapestPath(g, from, to, ["SAFE"], { requireVerified: false });
  if (!p) {
    console.log(`\n### ${label}: NO SAFE PATH ${from} -> ${to}`);
    return;
  }
  const a = posOf.get(from)!;
  const b = posOf.get(to)!;
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  console.log(`\n### ${label}: ${from} -> ${to}`);
  console.log(`  hops=${p.links.length}  routeLen=${p.metres.toFixed(1)}m  straight=${straight.toFixed(1)}m  ratio=${(p.metres / straight).toFixed(2)}`);
  let prev: string | null = null;
  for (const n of p.nodes) {
    const pos = posOf.get(n)!;
    const sec = secOf.get(n)!;
    let verb = "";
    if (prev) {
      const lk = linkOf.get(`${prev}>${n}`);
      verb = lk ? lk.verb : "?";
    }
    console.log(
      `  ${sec.padEnd(11)} ${n.padEnd(20)} [${pos[0].toFixed(1)}, ${pos[1].toFixed(1)}, ${pos[2].toFixed(1)}]  ${verb}`,
    );
    prev = n;
  }
}

seg(level.startNode, level.postNode, "SPAWN -> ELM (post)");
seg(level.postNode, level.arenaNode, "ELM -> YARD (arena)");

// section x-extents
const byS = new Map<string, number[]>();
for (const n of level.nodes) {
  const arr = byS.get(n.section) ?? [];
  arr.push(n.pos[0]);
  byS.set(n.section, arr);
}
console.log("\n### section x-extents");
for (const [s, xs] of byS) {
  console.log(`  ${s.padEnd(11)} x ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)}`);
}
