import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.js";
import { createWayfinder } from "../packages/mission-m1/src/wayfind.js";

const level = M1_EFFIGY_RUN;
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const at = (id: string) => {
  const n = nodeById.get(id)!;
  return { x: n.pos[0], y: n.pos[1], z: n.pos[2] };
};

function sweep(fromId: string, toId: string, goal: string, steps: number) {
  const finder = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const a = at(fromId), b = at(toId);
  let prev: number | null = null;
  let maxUp = 0, maxAbs = 0;
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const from = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t };
    finder.advanceWaypoint(from, goal);
    const r = finder.rangeTo(from, goal);
    const wp = finder.peekWaypoint(goal);
    if (prev !== null) {
      const d = r.metres - prev;
      if (d > maxUp) maxUp = d;
      if (Math.abs(d) > maxAbs) maxAbs = d;
    }
    prev = r.metres;
  }
  console.log(`  ${fromId} -> ${toId} (${goal}): maxUp=${maxUp.toFixed(1)} maxAbsStep=${maxAbs.toFixed(1)}`);
}

for (const goal of [level.postNode, level.arenaNode]) {
  sweep("B_EXIT", "C_SCAFF_FOOT", goal, 80);
  sweep("C_SQUARE_NW", "C_SCAFF_FOOT", goal, 200);
  sweep("B_EXIT", "C_SQUARE_NW", goal, 200);
}
