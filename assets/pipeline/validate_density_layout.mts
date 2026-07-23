// Deterministic structural checks for the imported exterior-density manifest.
// This does not wire runtime collision; it validates placement/content safety.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DENSITY_PLACEMENTS,
  FRONTAGE_SEGMENTS,
  HARBOR_EXCLUSIONS,
  TRAVERSAL_AFFORDANCES,
} from "../../apps/web/src/world/densityManifest.ts";

const errors: string[] = [];
const warnings: string[] = [];
const ids = new Set<string>();
const placementById = new Map(DENSITY_PLACEMENTS.map((entry) => [entry.id, entry]));

for (const entry of DENSITY_PLACEMENTS) {
  if (ids.has(entry.id)) errors.push(`duplicate placement id: ${entry.id}`);
  ids.add(entry.id);
  const publicPath = resolve(`apps/web/public/world/props/${entry.glb}.glb`);
  if (!existsSync(publicPath)) errors.push(`missing deployed GLB: ${entry.glb} (${entry.id})`);
  if (entry.size.some((value) => !Number.isFinite(value) || value <= 0)) {
    errors.push(`invalid uniform-fit target: ${entry.id}`);
  }

  // Only city/land modules are prohibited by the harbor map. Wharf rails,
  // ships and working waterfront hardware are intentionally allowed at the
  // deck edge.
  if (entry.tags.includes("city-envelope") || entry.tags.includes("land")) {
    for (const water of HARBOR_EXCLUSIONS) {
      if (
        entry.pos[0] > water.minX &&
        entry.pos[0] < water.maxX &&
        entry.pos[2] > water.minZ &&
        entry.pos[2] < water.maxZ
      ) {
        errors.push(`land/city placement enters ${water.id}: ${entry.id}`);
      }
    }
  }
}

const traversalIds = new Set<string>();
for (const affordance of TRAVERSAL_AFFORDANCES) {
  if (traversalIds.has(affordance.id)) errors.push(`duplicate traversal id: ${affordance.id}`);
  traversalIds.add(affordance.id);
  if (!placementById.has(affordance.placementId)) {
    errors.push(`traversal ${affordance.id} references missing placement ${affordance.placementId}`);
  }
  const approachLength = Math.hypot(...affordance.approach);
  if (Math.abs(approachLength - 1) > 0.001) {
    errors.push(`traversal ${affordance.id} has non-unit approach vector`);
  }
  if (affordance.interactionRadius < 0.8 || affordance.interactionRadius > 2) {
    errors.push(`traversal ${affordance.id} has unsafe interaction radius`);
  }
  if (affordance.landing.radius < 0.7) {
    errors.push(`traversal ${affordance.id} landing radius is too small`);
  }
}

for (const segment of FRONTAGE_SEGMENTS) {
  for (const [min, max] of segment.authoredOpenings) {
    if (min < segment.minX || max > segment.maxX || min >= max) {
      errors.push(`invalid authored opening in ${segment.id}: ${min}..${max}`);
    }
  }
}

for (const file of [
  "apps/web/src/world/densityManifest.ts",
  "apps/web/src/world/DensityDirector.tsx",
]) {
  const source = readFileSync(resolve(file), "utf8");
  if (/Math\.random\s*\(/.test(source)) errors.push(`render-time randomness found in ${file}`);
}

if (DENSITY_PLACEMENTS.length < 100) warnings.push("density placement count is unexpectedly low");
if (TRAVERSAL_AFFORDANCES.length < 20) warnings.push("traversal affordance coverage is unexpectedly low");

console.log(`density placements: ${DENSITY_PLACEMENTS.length}`);
console.log(`traversal affordances: ${TRAVERSAL_AFFORDANCES.length}`);
for (const warning of warnings) console.warn(`WARN ${warning}`);
for (const error of errors) console.error(`ERROR ${error}`);
if (errors.length) process.exit(1);
console.log("density layout validation OK");
