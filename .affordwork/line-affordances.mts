import { readFileSync } from "node:fs";
import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.js";
import { routeDistanceGraph, cheapestPath } from "../packages/mission-m1/src/routeGraph.js";

const level = M1_EFFIGY_RUN;
const g = routeDistanceGraph(level);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const linkOf = new Map(level.links.map((l) => [`${l.from}>${l.to}`, l]));

// Parse verifier output: map affordance id -> status word.
const txt = readFileSync(".affordwork/verify-after.txt", "utf8");
const status = new Map<string, string>();
for (const line of txt.split("\n")) {
  // RED list lines: "  CRITICAL  C_ASCENT    DECK      OLD_BRICK_WATCH"
  let m = line.match(/^\s+(CRITICAL|SEVERE|OFF|MARGINAL|PARTIAL)\s+\S+\s+\S+\s+(\S+)/);
  if (m) { status.set(m[2]!, m[1]!); continue; }
  // satisfied: "    OK   A_LEADS     DECK      PRINTSHOP__ROOF  (...)"
  m = line.match(/^\s+OK\s+\S+\s+\S+\s+(\S+)/);
  if (m) status.set(m[1]!, "OK");
}

function nodesOfPath(from: string, to: string) {
  const p = cheapestPath(g, from, to, ["SAFE"], { requireVerified: false })!;
  return p.nodes;
}

const spine = [
  ...nodesOfPath(level.startNode, level.postNode),
  ...nodesOfPath(level.postNode, level.arenaNode).slice(1),
];

console.log("affordance status for every surface/climb on the guided SAFE line:\n");
const seen = new Set<string>();
const flagged: string[] = [];
for (let i = 0; i < spine.length; i++) {
  const id = spine[i]!;
  const node = nodeById.get(id)!;
  // surface affordance
  const surf = node.surface;
  if (surf && surf !== "GROUND" && !seen.has(surf)) {
    seen.add(surf);
    const st = status.get(surf) ?? "(not scored / ground)";
    if (st !== "OK" && st !== "(not scored / ground)") flagged.push(`${surf} [${st}] (surface under ${id})`);
  }
  // climb affordance on the inbound link
  if (i > 0) {
    const lk = linkOf.get(`${spine[i-1]}>${id}`);
    if (lk && lk.kind === "CLIMB") {
      const cv = `CLIMBVOL_${lk.from}->${lk.to}`;
      const st = status.get(cv);
      if (st && st !== "OK") flagged.push(`${cv} [${st}]`);
    }
  }
}

// Catch affordances used by leaps on the line
for (const lk of level.links) {
  if (lk.line !== "SAFE") continue;
  if (lk.kind === "LEAP_OF_FAITH" && spine.includes(lk.from) && spine.includes(lk.to)) {
    const t = (lk as any).target as string | undefined;
    if (t) { const st = status.get(t); if (st && st !== "OK") flagged.push(`${t} [${st}] (leap target)`); }
  }
}

console.log("FLAGGED (not in the satisfied-71) affordances the guided line rides:");
for (const f of [...new Set(flagged)]) console.log("  - " + f);
console.log(`\n(${new Set(flagged).size} flagged; everything else on the line is OK/satisfied or plain ground.)`);
