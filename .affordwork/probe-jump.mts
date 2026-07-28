import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.js";
import { createWayfinder } from "../packages/mission-m1/src/wayfind.js";

const level = M1_EFFIGY_RUN;
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const at = (id: string) => { const n = nodeById.get(id)!; return { x: n.pos[0], y: n.pos[1], z: n.pos[2] }; };

function sweep(fromId: string, toId: string, goal: string, steps: number) {
  const finder = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const a = at(fromId), b = at(toId);
  let previous: number | null = null, maxJump = 0;
  console.log(`\n### ${fromId} -> ${toId} (${goal})`);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const from = { x: a.x+(b.x-a.x)*t, y: a.y+(b.y-a.y)*t, z: a.z+(b.z-a.z)*t };
    finder.advanceWaypoint(from, goal);
    const range = finder.rangeTo(from, goal);
    if (previous !== null) {
      const d = Math.abs(range.metres - previous);
      maxJump = Math.max(maxJump, d);
      if (d > 3) console.log(`  JUMP @t=${t.toFixed(3)} pos=[${from.x.toFixed(1)},${from.z.toFixed(1)}] ${previous.toFixed(1)} -> ${range.metres.toFixed(1)}  mark=${finder.peekWaypoint(goal)?.nodeId}`);
    }
    previous = range.metres;
  }
  console.log(`  maxJump=${maxJump.toFixed(1)}`);
}
sweep("B_EXIT", "C_SCAFF_FOOT", level.postNode, 80);
