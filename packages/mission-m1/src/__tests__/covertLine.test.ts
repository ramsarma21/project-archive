import { test } from "node:test";
import assert from "node:assert/strict";

import { PARKOUR_TUNING } from "@pa/engine-world/parkour";

import { compileLevel } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { verifyLevel } from "../traversal.js";
import { cheapestPath, routeGraph } from "../routeGraph.js";
import { GOLDEN_LINE, STEEPLE_DEADZONE_CLIMBS } from "../level/eastCovert.js";

// ---------------------------------------------------------------------------
// THE COVERT-CONNECTIVITY GATE (plan Section E.2).
//
// The traversal-first rebuild's promise is a BROADLY CONNECTED elevated network
// with one marked, wayfound GOLDEN PATH that stays up — on rooftops, ledges,
// planks and inside SAFE interiors — touching the ground only at the authored
// beats (the dead-wharf crossing, each drop-to-contact, and the elm->yard chase).
// "Covert" here is the owner's two-zone convention (SAFE = rooftops + interiors,
// EXPOSED = the open street), NOT a tracked line-of-sight cone.
//
// This gate pins that promise so the roof islands cannot silently reopen and the
// golden line cannot silently sprout a long ladder-climb or an accidental hole in
// the roofline. It checks the golden path is a real ≤1.9 m mantle line, that its
// only ground touches are authored, that the Town House offers more than one roof
// route, and that every stop is open-access (there is no door-operate verb).
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { linkVerdicts } = verifyLevel(level, compiled);
const graph = routeGraph(level, linkVerdicts);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));
const linkBetween = new Map(level.links.map((l) => [`${l.from}->${l.to}`, l]));

/** A node stands on the open street when its foot is on the ground plane. */
const GROUND_EPS = 0.5;
/** Ground touches the golden line is allowed to make, each an authored beat. */
const AUTHORED_GROUND_TAGS = new Set(["authoredGroundBeat", "exposed"]);

test("the golden line is a link-connected SAFE path from the spawn to the post", () => {
  assert.equal(GOLDEN_LINE[0], level.startNode, "the golden line opens on the spawn");
  assert.equal(
    GOLDEN_LINE[GOLDEN_LINE.length - 1],
    level.postNode,
    "the golden line ends on the objective",
  );
  const breaks: string[] = [];
  for (let i = 0; i < GOLDEN_LINE.length - 1; i++) {
    const id = `${GOLDEN_LINE[i]}->${GOLDEN_LINE[i + 1]}`;
    const link = linkBetween.get(id);
    if (!link) {
      breaks.push(`${id}: no such link`);
      continue;
    }
    if (link.line !== "SAFE") breaks.push(`${id}: ${link.line}, not SAFE`);
  }
  assert.deepEqual(breaks, [], `the golden line is not a continuous SAFE path:\n  ${breaks.join("\n  ")}`);
  // Every node it names exists and stands somewhere.
  for (const id of GOLDEN_LINE) {
    assert.ok(nodeById.has(id), `the golden line names ${id}, which is not a node`);
  }
});

test("every ascent on the golden line is a ≤1.9 m mantle, save the flagged steeple dead-zone", () => {
  const mantleMax = PARKOUR_TUNING.mantleMaxHeightM;
  const deadzone = new Set(STEEPLE_DEADZONE_CLIMBS);
  const overMantle: string[] = [];
  const seenDeadzone = new Set<string>();
  for (let i = 0; i < GOLDEN_LINE.length - 1; i++) {
    const id = `${GOLDEN_LINE[i]}->${GOLDEN_LINE[i + 1]}`;
    const link = linkBetween.get(id)!;
    if (link.kind !== "CLIMB") continue;
    const from = nodeById.get(link.from)!;
    const to = nodeById.get(link.to)!;
    const rise = to.pos[1] - from.pos[1];
    if (rise > mantleMax + 1e-9) {
      if (deadzone.has(id)) seenDeadzone.add(id);
      else overMantle.push(`${id} climbs ${rise.toFixed(2)} m (mantle ceiling ${mantleMax} m)`);
    }
  }
  assert.deepEqual(
    overMantle,
    [],
    `the golden line has long straight climbs that are not the flagged steeple ` +
      `dead-zone — the owner's rule is ≤1.9 m mantles:\n  ${overMantle.join("\n  ")}`,
  );
  // The exemption may not outlive its cause: when the steeple regen re-masses
  // these to rings, this fails and the exemption must be removed.
  assert.deepEqual(
    [...seenDeadzone].sort(),
    [...deadzone].sort(),
    "the flagged steeple dead-zone climbs are no longer >1.9 m on the golden line — " +
      "remove them from STEEPLE_DEADZONE_CLIMBS now that the ring re-mass has landed",
  );
});

test("the golden line touches the ground only at authored beats", () => {
  const strayGround: string[] = [];
  for (const id of GOLDEN_LINE) {
    const node = nodeById.get(id)!;
    if (node.pos[1] > GROUND_EPS) continue; // elevated: a roof, ledge, plank or interior
    const tags = new Set(node.tags);
    if (![...AUTHORED_GROUND_TAGS].some((t) => tags.has(t))) {
      strayGround.push(`${id} at y=${node.pos[1].toFixed(2)} (tags: ${node.tags.join(",") || "none"})`);
    }
  }
  assert.deepEqual(
    strayGround,
    [],
    `the golden line drops to the open street somewhere that is not an authored beat ` +
      `(the wharf crossing / a drop-to-contact / the chase):\n  ${strayGround.join("\n  ")}`,
  );
});

test("the SAFE network is broadly connected: the post is reachable and the Town House offers two roof routes", () => {
  // Broad connectivity: the guaranteed SAFE network reaches the objective and the
  // arena from the spawn.
  for (const target of [level.postNode, level.arenaNode]) {
    const path = cheapestPath(graph, level.startNode, target, ["SAFE"]);
    assert.ok(path, `no SAFE route from the spawn to ${target}`);
  }
  // More than one roof route over the Town House island: the covert G-B landing
  // (C_SCAFF_2) reaches the leads BOTH up the new repair-scaffold mantle chain and
  // round the proven gallery / clock / cornice spiral, so the island is not a tube.
  const scaffold = cheapestPath(graph, "C_SCAFF_2S", "C_LEADS_NW", ["SAFE"]);
  assert.ok(scaffold, "the repair-scaffold mantle chain does not reach the leads");
  const spiral = cheapestPath(graph, "C_GALLERY_W", "C_LEADS_S", ["SAFE"]);
  assert.ok(spiral, "the proven gallery/clock/cornice spiral does not reach the leads");
  // They are genuinely distinct: the scaffold route does not thread the gallery.
  assert.ok(
    !scaffold!.nodes.includes("C_GALLERY_W"),
    "the scaffold route and the gallery route are the same line, not two",
  );
});

test("every stop on the golden line is open-access — no node's only entry is a door", () => {
  // There is no door-operate verb in this world (open shopfronts, missing walls,
  // window/balcony drop-ins, open gate-gaps), so no golden node may be gated by a
  // door. Enforced by absence: no node carries a `door` tag, and no link is a
  // door-operate kind.
  const doored = GOLDEN_LINE.filter((id) => nodeById.get(id)!.tags.includes("door"));
  assert.deepEqual(doored, [], `golden-line nodes gated by a door: ${doored.join(", ")}`);
});

test("the reserved learning-object pads are SAFE standable vantages, and UNPOPULATED", () => {
  const pads = level.nodes.filter((n) => n.tags.includes("reserved-pad"));
  assert.equal(pads.length, 7, `expected the seven reserved pads S1–S7; found ${pads.length}`);
  for (const pad of pads) {
    // SAFE: an elevated roof/ledge/interior surface, never the open ground.
    assert.ok(
      pad.pos[1] > GROUND_EPS,
      `${pad.id} is on the open street (y=${pad.pos[1].toFixed(2)}); a reserved pad is a SAFE vantage`,
    );
    // Standability itself is proven by traversability.test's node checks; here we
    // only pin that the pad is reserved and carries no learning object yet.
    assert.ok(
      !pad.tags.some((t) => t.startsWith("object:") || t === "populated"),
      `${pad.id} already carries a learning object — these spaces are reserved UNPOPULATED`,
    );
  }
});
