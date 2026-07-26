// Prints the level's own audit: node placement, per-link traversability against
// the shipped physics, and the pacing budget. Run with `pnpm level:report`.

import { compileLevel } from "./compile.js";
import { M1_EFFIGY_RUN } from "./level/index.js";
import { verifyLevel } from "./traversal.js";
import { routeGraph, cheapestPath, lineBudget } from "./routeGraph.js";
import { pacingReport } from "./pacing.js";

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { nodeProblems, linkVerdicts } = verifyLevel(level, compiled);

console.log(`# ${level.title} (${level.id})`);
console.log(
  `masses ${level.masses.length}  decks ${compiled.decks.length}  nodes ${level.nodes.length}  links ${level.links.length}`,
);

console.log("\n## node placement");
if (nodeProblems.size === 0) {
  console.log("  all nodes stand on the surface they declare");
} else {
  for (const [id, problems] of nodeProblems) {
    console.log(`  FAIL ${id}: ${problems.join("; ")}`);
  }
}

console.log("\n## links");
const failures = linkVerdicts.filter((v) => !v.ok);
for (const verdict of linkVerdicts) {
  const gap = verdict.gapM === null ? "" : ` gap=${verdict.gapM.toFixed(2)}`;
  const cap =
    verdict.budgetM === null ? "" : `/budget=${verdict.budgetM.toFixed(2)}`;
  const drop = ` drop=${verdict.dropM.toFixed(2)}`;
  const noise = verdict.noise && verdict.noise.intensity > 0
    ? ` noise=${verdict.noise.intensity.toFixed(2)}@${verdict.noise.radiusM.toFixed(1)}m`
    : "";
  console.log(
    `  ${verdict.ok ? "ok  " : "FAIL"} ${verdict.line.padEnd(6)} ${verdict.verb.padEnd(14)} ${verdict.id}${gap}${cap}${drop} t=${verdict.durationS.toFixed(2)}s${noise}`,
  );
  for (const problem of verdict.problems) console.log(`         - ${problem}`);
}
console.log(`\n  ${linkVerdicts.length - failures.length}/${linkVerdicts.length} links verified`);

console.log("\n## route");
const graph = routeGraph(level, linkVerdicts);
for (const budget of lineBudget(level, graph)) {
  console.log(
    `  ${budget.line.padEnd(6)} ${budget.reachable ? "reachable" : "UNREACHABLE"}  ${budget.seconds.toFixed(1)}s over ${budget.metres.toFixed(0)}m (${budget.hops} hops)`,
  );
}
const safest = cheapestPath(graph, level.startNode, level.arenaNode, ["SAFE"]);
console.log(`  safe spine: ${safest ? safest.nodes.join(" -> ") : "NO PATH"}`);

console.log("\n## pacing");
for (const row of pacingReport(level, linkVerdicts).rows) {
  console.log(
    `  ${row.section.padEnd(12)} budget ${String(row.budgetS).padStart(3)}s   safe ${row.safeS.toFixed(1)}s   fast ${row.fastS.toFixed(1)}s   ${row.metresSafe.toFixed(0)}m`,
  );
}
const totals = pacingReport(level, linkVerdicts).totals;
console.log(
  `  TOTAL        budget ${totals.budgetS}s   safe ${totals.safeS.toFixed(1)}s   fast ${totals.fastS.toFixed(1)}s   ${totals.metresSafe.toFixed(0)}m safe / ${totals.metresFast.toFixed(0)}m fast`,
);
console.log(
  `\n  optimal line   ${totals.fastS.toFixed(1)}s\n  competent      ${totals.competentS.toFixed(1)}s (incl. ${totals.rerouteS}s of authored reroute allowance)\n  mission clock  ${totals.missionClockS}s  -> still ${totals.competentShortfallS.toFixed(1)}s short for a competent player`,
);

process.exit(failures.length === 0 && nodeProblems.size === 0 ? 0 : 1);
