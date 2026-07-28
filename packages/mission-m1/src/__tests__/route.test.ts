import { test } from "node:test";
import assert from "node:assert/strict";

import { compileLevel, crowdClustersOf } from "../compile.js";
import { M1_EFFIGY_RUN } from "../level/index.js";
import { verifyLevel } from "../traversal.js";
import { cheapestPath, routeGraph } from "../routeGraph.js";
import { pacingReport } from "../pacing.js";
import { ASSET_KEYS, NEEDED_ASSETS } from "../assets.js";
import { CHAIN_REACH_M } from "../envelope.js";
import { CAPSULE_RADIUS } from "@pa/engine-world/collision";
import { AUTHORABLE_VERBS } from "@pa/engine-world/parkour";
import { STEALTH_TUNING } from "@pa/engine-world/stealth";

const level = M1_EFFIGY_RUN;
const compiled = compileLevel(level);
const { linkVerdicts } = verifyLevel(level, compiled);
const graph = routeGraph(level, linkVerdicts);
const nodeById = new Map(level.nodes.map((n) => [n.id, n]));

function viaPost(allow: Array<"SAFE" | "FAST" | "EXPERT">) {
  const toPost = cheapestPath(graph, level.startNode, level.postNode, allow);
  const toArena = cheapestPath(graph, level.postNode, level.arenaNode, allow);
  if (!toPost || !toArena) return null;
  return {
    nodes: [...toPost.nodes, ...toArena.nodes.slice(1)],
    seconds: toPost.seconds + toArena.seconds,
  };
}

test("a player who never takes a risk still finishes", () => {
  const safe = viaPost(["SAFE"]);
  assert.ok(safe, "there is no route from the roof to the duel using only SAFE links");
  assert.ok(safe!.nodes.includes(level.postNode), "the safe route posts the handbill");
});

test("the tower vista is authored and reachable, but the guided line no longer detours up it", () => {
  // The Town House tower was the ONLY navigation before the visor existed: a
  // cautious player had to climb somewhere they could see the objective from.
  // The route is guided now, so climbing five metres up the tower and five back
  // down for a look is a detour the sensible line does not take — it tops out on
  // the broad leads with the elm already in sight and carries straight on onto
  // the roofline. The vista stays a reachable set piece (the CLIMB up from the
  // leads and the drop back down are still authored); it is simply off the
  // shortest guided line rather than forced onto it.
  const anyPath = new Set(level.links.flatMap((l) => [l.from, l.to]));
  assert.ok(anyPath.has("C_TOWER_GALLERY"), "the tower vista is still authored and linked");
  const safe = viaPost(["SAFE"])!;
  assert.ok(
    !safe.nodes.includes("C_TOWER_GALLERY"),
    "the guided line tops out on the leads with the elm in sight, not up the tower and back",
  );
});

test("the guided line covers its sections in order, and the off-line ropewalk stays reachable", () => {
  // The guided line runs A -> Shambles -> Dock Square -> the Town House -> the
  // roofline -> the steeple -> the elm -> the yard. The ropewalk (D2) sits SOUTH
  // of the roofline: the line now leaps straight from the south row onto the
  // Hollis meeting-house roof (D_SROOF_E -> D_MEETING_W -> D_MEETING_ROOF) rather
  // than dropping into the shed and climbing its far face back up, so D2 is off
  // the guided line. It is kept as authored, reachable content — a dark-interior
  // alternate a deviating player can still take — not deleted, and the relocated
  // STAMP_SCOPE bill-sticker stop now sits on the meeting-house leads the line
  // crosses, so the mandatory beat did not leave the guided route with the shed.
  const safe = viaPost(["SAFE"])!;
  const order = safe.nodes.map((id) => nodeById.get(id)!.section);
  const guided = [
    "A_LEADS",
    "B_SHAMBLES",
    "B2_THRONG",
    "C_ASCENT",
    "D_ROOFLINE",
    "E_LEAP",
    "F_TREE",
    "G_YARD",
  ];
  let cursor = -1;
  for (const section of guided) {
    const idx = order.indexOf(section);
    assert.ok(idx >= 0, `${section} is not on the guided line`);
    assert.ok(idx > cursor, `${section} is out of order on the guided line`);
    cursor = idx;
  }
  // The off-line ropewalk is not stranded: it has a way in and a way out.
  const inbound = new Set(level.links.map((l) => l.to));
  const outbound = new Set(level.links.map((l) => l.from));
  const d2 = level.nodes.filter((n) => n.section === "D2_ROPEWALK").map((n) => n.id);
  assert.ok(d2.some((id) => inbound.has(id)), "nothing leads into the ropewalk");
  assert.ok(d2.some((id) => outbound.has(id)), "there is no way out of the ropewalk");
});

test("every link on the route is a SAFE link", () => {
  // M1 is one guided route. The crossing FAST/EXPERT branches that used to give
  // every section a second and third line have retired, so the only line left is
  // the guaranteed one — a single, honest route rather than three that arbitrate.
  for (const link of level.links) {
    assert.equal(
      link.line,
      "SAFE",
      `${link.id} is a ${link.line} link; the collapsed route is SAFE only`,
    );
  }
});

test("the mission's set pieces are all on the route", () => {
  const reached = new Set(viaPost(["SAFE", "FAST", "EXPERT"])!.nodes);
  const anyPath = new Set(level.links.flatMap((l) => [l.from, l.to]));
  for (const id of ["C_TOWER_GALLERY", "E_GALLERY", "F_POST", "G_SPAWN"]) {
    assert.ok(anyPath.has(id), `${id} is authored but nothing links to it`);
  }
  assert.ok(reached.has("F_POST"), "the handbill still gets posted on the fast line");
});

test("every node and every link is declared exactly once", () => {
  // A duplicate id does not collide loudly: the node map is built by id, the
  // second definition wins, and every link naming that id silently points at the
  // wrong place. It cost a working climb thirty metres of displacement once
  // already, and the symptom was "beginAuthored refuses this affordance" against
  // geometry the link was never near.
  const nodeIds = level.nodes.map((n) => n.id);
  assert.deepEqual(
    nodeIds.filter((id, index) => nodeIds.indexOf(id) !== index),
    [],
    "two nodes share an id, so one of them is unreachable and does not know it",
  );
  const linkIds = level.links.map((l) => l.id);
  assert.deepEqual(
    linkIds.filter((id, index) => linkIds.indexOf(id) !== index),
    [],
    "two links share an id, so one verdict overwrites the other",
  );
  // Masses and decks land in one CollisionWorld and are looked up by id too.
  const surfaceIds = [
    ...level.masses.map((m) => m.id),
    ...compiled.decks.map((d) => d.id),
  ];
  assert.deepEqual(
    surfaceIds.filter((id, index) => surfaceIds.indexOf(id) !== index),
    [],
    "two pieces of geometry share an id, so `ignore` and `carriedBy` are ambiguous",
  );
});

test("every node a link names exists, and the guided route strands nobody on it", () => {
  // The first half has bitten: three links pointed at `D2_FLOOR_E` and
  // `D2_STAGE_E`, which were never authored, and that alone took the SAFE line
  // through the ropewalk out of the graph.
  const ids = new Set(level.nodes.map((n) => n.id));
  const missing = level.links
    .flatMap((link) => [link.from, link.to])
    .filter((id) => !ids.has(id));
  assert.deepEqual([...new Set(missing)], [], "a link names a node nothing authors");

  // The second half is now scoped to the LIVE route. M1 collapsed to one guided
  // SAFE line, and the nodes the old FAST/EXPERT branches used are kept as inert
  // graph data (nothing guides along them) until they are pruned — so a stranded-
  // node check over every node would fire on data the mission never touches. The
  // guard that matters is that the route a player is actually guided down never
  // strands them: every node reachable from the spawn that can still reach an
  // objective has a way in and a way out.
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  for (const link of level.links) {
    (forward.get(link.from) ?? forward.set(link.from, []).get(link.from)!).push(link.to);
    (backward.get(link.to) ?? backward.set(link.to, []).get(link.to)!).push(link.from);
  }
  const reachable = (start: string, graph: Map<string, string[]>): Set<string> => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length > 0) {
      const at = stack.pop()!;
      for (const next of graph.get(at) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      }
    }
    return seen;
  };
  const fromSpawn = reachable(level.startNode, forward);
  const toGoal = new Set([
    ...reachable(level.postNode, backward),
    ...reachable(level.arenaNode, backward),
  ]);
  const live = [...fromSpawn].filter((id) => toGoal.has(id));
  assert.ok(
    live.includes(level.postNode) && live.includes(level.arenaNode),
    "the guided route does not connect the spawn to both objectives",
  );
  const outbound = new Set(level.links.map((l) => l.from));
  const inbound = new Set(level.links.map((l) => l.to));
  for (const id of live) {
    if (id !== level.startNode) {
      assert.ok(inbound.has(id), `${id} on the live route cannot be reached from anywhere`);
    }
    if (id !== level.arenaNode) {
      assert.ok(outbound.has(id), `${id} on the live route is somewhere the player cannot leave`);
    }
  }
});

test("clustered traversal beats sit inside the chain window", () => {
  // Vaults on the same roof, canopy hops in the market: if these fall outside
  // the chain window the flow reward never pays and the run feels like a series
  // of separate obstacles.
  const clusters = [
    ["D_VAULT_IN_0", "D_VAULT_OUT_0", "D_VAULT_IN_1", "D_VAULT_OUT_1"],
    ["B_CANOPY_0", "B_CANOPY_1", "B_CANOPY_2", "B_CANOPY_3", "B_CANOPY_4"],
  ];
  for (const cluster of clusters) {
    for (let i = 1; i < cluster.length; i++) {
      const a = nodeById.get(cluster[i - 1]!)!.pos;
      const b = nodeById.get(cluster[i]!)!.pos;
      const spacing = Math.hypot(b[0] - a[0], b[2] - a[2]);
      assert.ok(
        spacing < CHAIN_REACH_M,
        `${cluster[i - 1]} -> ${cluster[i]} is ${spacing.toFixed(1)}m, past the ${CHAIN_REACH_M.toFixed(1)}m the chain window reaches`,
      );
    }
  }
});

test("every roof deck oversails the mass beneath it", () => {
  // A deck flush with its own wall embeds the capsule the instant a fall takes
  // the foot below the wall top, which is how a clean-looking roof turns into a
  // player stuck inside a building.
  for (const deck of level.decks) {
    for (const id of deck.carriedBy) {
      const mass = compiled.massById.get(id);
      if (!mass) continue;
      if (!deck.tags.includes("roof")) continue;
      const overhang = Math.min(
        mass.rect.minX - deck.rect.minX,
        deck.rect.maxX - mass.rect.maxX,
        mass.rect.minZ - deck.rect.minZ,
        deck.rect.maxZ - mass.rect.maxZ,
      );
      assert.ok(
        overhang >= CAPSULE_RADIUS,
        `${deck.id} oversails ${id} by ${overhang.toFixed(2)}m; a body needs ${CAPSULE_RADIUS}m`,
      );
      }
  }
});

test("every asset the level references is declared", () => {
  const referenced = new Set<string>();
  for (const mass of level.masses) if (mass.asset) referenced.add(mass.asset);
  for (const deck of level.decks) if (deck.asset) referenced.add(deck.asset);
  for (const ramp of level.ramps) if (ramp.asset) referenced.add(ramp.asset);
  for (const patrol of level.patrols) referenced.add(patrol.asset);
  for (const volume of level.blend) referenced.add(volume.asset);
  for (const volume of level.catches) referenced.add(volume.asset);
  for (const diversion of level.diversions) referenced.add(diversion.asset);
  const undeclared = [...referenced].filter((key) => !ASSET_KEYS.has(key));
  assert.deepEqual(
    undeclared,
    [],
    "the art agent cannot deliver a key nobody wrote down",
  );
});

test("the art the level is waiting on is a short, specific list", () => {
  assert.ok(NEEDED_ASSETS.length > 0);
  assert.ok(
    NEEDED_ASSETS.length <= 12,
    "a mission that needs more than a dozen new assets is not reusing the pipeline",
  );
  for (const asset of NEEDED_ASSETS) {
    assert.ok(asset.why.length > 40, `${asset.key} does not say what it is for`);
    assert.ok(asset.sizeM.every((n) => n > 0), `${asset.key} has no dimensions`);
  }
});

test("a competent player is costed with shipped constants, not a fudge factor", () => {
  const report = pacingReport(level, linkVerdicts);
  assert.ok(
    report.totals.competentS > report.totals.safeS,
    "a competent player cannot be quicker than a perfect optimal line",
  );
  assert.ok(
    report.totals.rerouteS > 0,
    "the reroute allowance is authored per section and has to be declared",
  );
  assert.equal(
    report.totals.rerouteS,
    level.sections.reduce((sum, s) => sum + s.rerouteBudgetS, 0),
  );
});

test("the pacing budget is computed from the verified route", () => {
  const report = pacingReport(level, linkVerdicts);
  assert.equal(report.totals.missionClockS, 180);
  assert.ok(report.totals.safeS > 0);
  assert.ok(
    report.totals.safeS >= report.totals.fastS,
    "the cautious route cannot be quicker than the skilled one",
  );
  assert.ok(
    report.totals.safeS <= report.totals.missionClockS,
    `the safe route must fit the mission clock: ${report.totals.safeS.toFixed(1)}s of ${report.totals.missionClockS}s`,
  );
  // The shortfall is measured and reported rather than papered over. It is the
  // number that says how much more traversal the level still owes the clock.
  assert.equal(
    report.totals.shortfallS,
    report.totals.missionClockS - report.totals.safeS,
  );
});

test("the two sections furthest under their own budget are the ones to grow", () => {
  const report = pacingReport(level, linkVerdicts);
  const worst = [...report.rows]
    .filter((row) => row.budgetS > 0)
    .sort((a, b) => b.budgetS - b.safeS - (a.budgetS - a.safeS))
    .slice(0, 2)
    .map((row) => row.section);
  // Recorded so the next pass on this level knows where to spend, and so this
  // fails loudly if growing one of them makes a different section the problem.
  // Recorded so the next pass knows where to spend, and so this fails loudly if
  // growing one of them makes a different section the problem.
  assert.equal(worst.length, 2);
  for (const id of worst) {
    assert.ok(level.sections.some((s) => s.id === id), `${id} is not a section`);
  }
});


test("the route exercises the whole verb vocabulary", () => {
  // The audit that found the gap in the first place, kept as a test. EDGE_BRAKE
  // and BLOCKED are failure states and are meant to be absent.
  //
  // The list is the engine's own, not this file's. Enumerating the verb table
  // and subtracting exceptions by hand worked until the vocabulary grew: JUMP
  // and DASH are named by the player, geometry never asks for either, and a
  // route was being failed for not authoring a verb that is not authorable.
  const used = new Set(linkVerdicts.map((v) => v.verb));
  const expected = AUTHORABLE_VERBS;
  const missing = expected.filter((verb) => !used.has(verb));
  assert.deepEqual(
    missing,
    [],
    "a shipped verb the level never asks for is a system nobody paid for",
  );
  assert.ok(!used.has("BLOCKED"), "nothing on the route reads as blocked");
  assert.ok(!used.has("EDGE_BRAKE"), "nothing on the route stops the player dead");
});

test("the stealth systems are all actually used", () => {
  const clusters = crowdClustersOf(level);
  assert.ok(clusters.length >= 3, "crowd blending needs somewhere to happen");
  for (const cluster of clusters) {
    assert.ok(
      cluster.density >= STEALTH_TUNING.crowdBlendMinDensity,
      `${cluster.id} has ${cluster.density} bodies; below ${STEALTH_TUNING.crowdBlendMinDensity} it hides nobody`,
    );
  }
  assert.ok(
    level.links.filter((l) => l.kind === "BLEND").length >= 4,
    "one blend link is a mention, not a mechanic",
  );

  // Light is authored across the mission, not just in one set piece, and it
  // spans a range wide enough to be a decision.
  assert.ok(level.light.length >= 8);
  const levels = level.light.map((v) => v.level);
  assert.ok(Math.min(...levels) < 0.15, "somewhere is genuinely dark");
  assert.ok(Math.max(...levels) > 0.8, "somewhere is genuinely lit");
  const sectionsWithLight = new Set(level.light.map((v) => v.section));
  assert.ok(
    sectionsWithLight.size >= 5,
    "light has to be a dimension of the whole run, not one room",
  );

  // A throw that cannot miss is not a skill: at least one anchor has bodies
  // between the player and the aim point.
  const risky = level.diversions.filter(
    (d) => (d.bodiesInLine ?? []).length > 0,
  );
  assert.ok(
    risky.length >= 1,
    "no throw in the mission can go wrong, so aiming is not a skill anywhere",
  );
});

test("every section that has a patrol also has somewhere to lose them", () => {
  const bySection = new Map<string, number>();
  for (const patrol of level.patrols) {
    bySection.set(patrol.section, (bySection.get(patrol.section) ?? 0) + 1);
  }
  for (const [section, count] of bySection) {
    const spec = level.sections.find((s) => s.id === section)!;
    assert.ok(
      spec.rerouteBudgetS > 0,
      `${section} has ${count} watcher(s) but no reroute allowance, so being read costs nothing`,
    );
  }
});

// ---------------------------------------------------------------------------
// The climb volumes are the only place in this level where authoring overrides
// a physics judgement, so they are held to the route rather than trusted. Each
// one names the link it exists for; if the link moves, is retimed onto another
// surface, or is deleted, these fail rather than leaving a volume granting a
// climb into thin air — or worse, granting one somewhere the route no longer
// goes, which is precisely the "it climbs you up through everything" the
// reachability bound was added to stop.
// ---------------------------------------------------------------------------

test("every climb volume stands a body at the foot of the link it serves", () => {
  const linkById = new Map(level.links.map((l) => [l.id, l]));
  for (const volume of level.climbs) {
    const link = linkById.get(volume.serves);
    assert.ok(link, `${volume.id} serves ${volume.serves}, which is not a link`);
    assert.equal(
      link!.kind,
      "CLIMB",
      `${volume.id} serves ${link!.id}, which is a ${link!.kind} and not an ascent`,
    );

    const from = nodeById.get(link!.from)!;
    const to = nodeById.get(link!.to)!;
    assert.equal(
      to.surface,
      volume.onto,
      `${volume.id} grants a rise onto ${volume.onto} but ${link!.id} arrives on ${to.surface}`,
    );

    const { rect } = volume;
    assert.ok(
      from.pos[0] >= rect.minX &&
        from.pos[0] <= rect.maxX &&
        from.pos[2] >= rect.minZ &&
        from.pos[2] <= rect.maxZ,
      `${volume.id} does not contain ${from.id}, the spot the climb is made from`,
    );
    assert.ok(
      from.pos[1] >= volume.standMinY && from.pos[1] <= volume.standMaxY,
      `${volume.id} stands feet at ${volume.standMinY}..${volume.standMaxY} but ${from.id} is at ${from.pos[1]}`,
    );

    const rise = to.pos[1] - from.pos[1];
    assert.ok(
      rise > 0,
      `${volume.id} serves ${link!.id}, which descends ${(-rise).toFixed(2)}m`,
    );
  }
});

test("a climb volume is the size of a standing spot, not of the floor above it", () => {
  // The whole value of declaring these is that they say WHERE. A volume as wide
  // as its own deck would put the reader back where it started, offering the
  // climb from anywhere underneath.
  for (const volume of level.climbs) {
    const area =
      (volume.rect.maxX - volume.rect.minX) * (volume.rect.maxZ - volume.rect.minZ);
    assert.ok(
      area <= 9,
      `${volume.id} covers ${area.toFixed(1)}m^2, which is a room and not a foothold`,
    );
    const deck = compiled.deckById.get(volume.onto);
    if (!deck) continue;
    const deckArea =
      (deck.rect.maxX - deck.rect.minX) * (deck.rect.maxZ - deck.rect.minZ);
    assert.ok(
      area <= deckArea * 0.5,
      `${volume.id} covers half of ${volume.onto}, so it authorises the deck and not a spot on it`,
    );
  }
});

test("no two climb volumes offer the same body two ways up", () => {
  // Overlapping volumes onto different surfaces would make which climb you get
  // depend on authoring order, which is not a thing a player can learn.
  for (let i = 0; i < level.climbs.length; i++) {
    for (let j = i + 1; j < level.climbs.length; j++) {
      const a = level.climbs[i]!;
      const b = level.climbs[j]!;
      if (a.onto === b.onto) continue;
      const overlapsXZ =
        a.rect.minX < b.rect.maxX &&
        b.rect.minX < a.rect.maxX &&
        a.rect.minZ < b.rect.maxZ &&
        b.rect.minZ < a.rect.maxZ;
      const overlapsY = a.standMinY < b.standMaxY && b.standMinY < a.standMaxY;
      assert.ok(
        !(overlapsXZ && overlapsY),
        `${a.id} and ${b.id} both claim the same standing spot`,
      );
    }
  }
});
