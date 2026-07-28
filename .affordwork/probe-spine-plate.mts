import { M1_EFFIGY_RUN } from "../packages/mission-m1/src/level/index.js";
import { createWayfinder } from "../packages/mission-m1/src/wayfind.js";
import { routeDistanceGraph, cheapestPath } from "../packages/mission-m1/src/routeGraph.js";

const level = M1_EFFIGY_RUN;
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const g = routeDistanceGraph(level);

const KIND_TO_VERB: Record<string, any> = {
  CLIMB: "CLIMB_UP", MANTLE: "MANTLE", VAULT: "VAULT", JUMP: "JUMP",
  DASH_JUMP: "DASH", LEAP_OF_FAITH: "LEAP_OF_FAITH", DROP: "RUN_OFF", DUCK_UNDER: "SLIDE",
};

function walkSpine(goal: string, label: string) {
  const path = cheapestPath(g, level.startNode, goal, ["SAFE"], { requireVerified: false })!;
  const finder = createWayfinder(level, { guidanceLines: ["SAFE"] });
  console.log(`\n### ${label}  (${path.nodes.length} nodes)`);
  let prev: number | null = null;
  let maxUp = 0, maxStep = 0;
  for (let i = 0; i < path.nodes.length; i++) {
    const id = path.nodes[i]!;
    const node = nodeById.get(id)!;
    const link = i > 0 ? level.links.find((l) => l.from === path.nodes[i-1] && l.to === id) : null;
    const verb = link ? KIND_TO_VERB[link.kind] : undefined;
    const sample = {
      pos: { x: node.pos[0], y: node.pos[1], z: node.pos[2] },
      grounded: true,
      supportId: node.surface,
      completed: verb ? { verb, landingId: node.surface } : null,
    } as any;
    finder.advanceWaypoint(sample, goal);
    const r = finder.rangeTo(sample.pos, goal).metres;
    if (prev !== null) {
      const d = r - prev;
      if (d > maxUp) maxUp = d;
      if (Math.abs(d) > maxStep) maxStep = Math.abs(d);
      if (d > 0.5 || Math.abs(d) > 6) console.log(`  ${id.padEnd(18)} range ${r.toFixed(1)}  (delta ${d>=0?'+':''}${d.toFixed(1)})`);
    }
    prev = r;
  }
  console.log(`  --> max upward step ${maxUp.toFixed(1)}m, max abs step ${maxStep.toFixed(1)}m`);
}

walkSpine(level.postNode, "SPAWN -> ELM");
walkSpine(level.arenaNode, "SPAWN -> YARD");
