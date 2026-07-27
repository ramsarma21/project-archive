import { test } from "node:test";
import assert from "node:assert/strict";

import { M1_EFFIGY_RUN } from "../level/index.js";
import {
  createWayfinder,
  type WayfindSample,
  type WayPoint,
} from "../wayfind.js";
import { cheapestPath, routeDistanceGraph } from "../routeGraph.js";

// ---------------------------------------------------------------------------
// The number under the objective marker.
//
// A mark on the Liberty Elm prints how far away it is, and the whole reason
// this module exists is that the obvious answer is wrong on this level. The elm
// is 78m from the spawn in a straight line and the route to it goes down off
// the printshop leads, through a market, over or around the Town House and
// along a roofline — so the straight line understates the run by a third, in
// the most confident possible voice, with nothing on screen looking wrong.
//
// These check the three ways that could quietly stop being true: the graph
// costing edges by something other than their length, the nearest-node match
// putting a player on a roof onto the street node under their feet, and the
// fallback silently claiming a walked figure it did not walk.
// ---------------------------------------------------------------------------

const level = M1_EFFIGY_RUN;
const way = createWayfinder(level);
const nodeById = new Map(level.nodes.map((node) => [node.id, node]));

function at(id: string) {
  const node = nodeById.get(id);
  assert.ok(node, `no route node ${id}`);
  return { x: node!.pos[0], y: node!.pos[1], z: node!.pos[2] };
}

function straight(from: { x: number; z: number }, id: string): number {
  const node = nodeById.get(id)!;
  return Math.hypot(node.pos[0] - from.x, node.pos[2] - from.z);
}

// ---- the graph ------------------------------------------------------------

test("the distance graph prices every edge by its own length, in three dimensions", () => {
  const graph = routeDistanceGraph(level);
  for (const link of level.links) {
    const edge = graph.byId.get(link.id);
    assert.ok(edge, `${link.id} is missing from the wayfinding graph`);
    const from = nodeById.get(link.from)!.pos;
    const to = nodeById.get(link.to)!.pos;
    const expected = Math.hypot(
      to[0] - from[0],
      to[1] - from[1],
      to[2] - from[2],
    );
    assert.ok(
      Math.abs(edge!.metres - expected) < 1e-9,
      `${link.id} is costed at ${edge!.metres.toFixed(2)}m and spans ${expected.toFixed(2)}m`,
    );
  }
});

test("every edge is marked unverified, because nothing here simulated one", () => {
  const graph = routeDistanceGraph(level);
  for (const edge of graph.byId.values()) {
    assert.equal(
      edge.ok,
      false,
      `${edge.link.id} claims verification this graph never performed`,
    );
  }
  // Which is exactly why the default search finds nothing on it. A caller who
  // forgets the flag must get no answer rather than a confident wrong one.
  assert.equal(
    cheapestPath(graph, level.startNode, level.postNode, [
      "SAFE",
      "FAST",
      "EXPERT",
    ]),
    null,
  );
});

// ---- the walk -------------------------------------------------------------

test("the route to the elm is materially longer than the line to it", () => {
  const spawn = at(level.startNode);
  const walked = way.rangeTo(spawn, level.postNode);
  const line = straight(spawn, level.postNode);

  assert.equal(walked.viaRoute, true, "the graph must be able to walk the mission");
  assert.ok(
    walked.metres > line * 1.15,
    `the walked route is ${walked.metres.toFixed(0)}m against ${line.toFixed(0)}m in a ` +
      "straight line; if those are the same figure the marker is quoting the crow",
  );
});

test("both required destinations are reachable from the spawn", () => {
  const spawn = at(level.startNode);
  for (const target of [level.postNode, level.arenaNode]) {
    assert.equal(
      way.rangeTo(spawn, target).viaRoute,
      true,
      `nothing walks from the spawn to ${target}, so its marker would quote a straight line all run`,
    );
  }
});

test("the range falls to nothing as the player arrives", () => {
  const post = at(level.postNode);
  const range = way.rangeTo(post, level.postNode);
  assert.ok(
    range.metres < 1,
    `standing on the objective reads ${range.metres.toFixed(1)}m`,
  );
});

test("the range shortens as the run progresses", () => {
  // Four nodes in route order. Each is genuinely nearer the tree than the last,
  // and a wayfinder that matched the wrong node or walked the wrong way would
  // show a player their remaining distance going up.
  const stations = ["A_START", "B_STREET_MID", "C_SCAFF_FOOT", "D_SROOF_N"];
  let previous = Infinity;
  for (const id of stations) {
    const range = way.rangeTo(at(id), level.postNode);
    assert.equal(range.viaRoute, true, `${id} cannot walk to the post`);
    assert.ok(
      range.metres < previous,
      `${id} reads ${range.metres.toFixed(0)}m, further than the station before it`,
    );
    previous = range.metres;
  }
});

// ---- which node the player is standing at ---------------------------------

test("height decides the match where the level is stacked", () => {
  // The market shed roof is 5.6m over the street it shelters and within a
  // couple of metres of it on the ground plane. Matched flat, a player on the
  // roof is priced as though they had already come down.
  const roof = at("B_SHED_E");
  assert.equal(way.nearestNodeId(roof), "B_SHED_E");

  const street = at("B_PENTICE_FOOT");
  const matched = way.nearestNodeId(street);
  assert.ok(
    matched !== null && nodeById.get(matched)!.pos[1] < 1,
    `standing in the street matched ${matched}, which is up in the air`,
  );
});

test("a player nowhere near the route gets the honest straight line", () => {
  // Out over the harbour, which is not somewhere the mission goes.
  const offMap = { x: -60, y: 0, z: -60 };
  assert.equal(way.nearestNodeId(offMap), null);
  const range = way.rangeTo(offMap, level.postNode);
  assert.equal(
    range.viaRoute,
    false,
    "a figure nothing walked must not be reported as walked",
  );
  assert.ok(Math.abs(range.metres - straight(offMap, level.postNode)) < 1e-6);
});

test("a walked figure is never shorter than the line it walks around", () => {
  for (const node of level.nodes) {
    const from = { x: node.pos[0], y: node.pos[1], z: node.pos[2] };
    const range = way.rangeTo(from, level.postNode);
    assert.ok(
      range.metres >= straight(from, level.postNode) - 1e-6,
      `${node.id} reports ${range.metres.toFixed(1)}m to a post ${straight(from, level.postNode).toFixed(1)}m away`,
    );
  }
});

// ---- one mutation owner, pure reads ---------------------------------------
//
// The waypoint is committed and drawn by two surfaces at two frame rates — the
// HUD's periodic sample and the in-canvas mark's render loop. If a READ could
// advance it, the two would drive it against each other from slightly different
// positions and the mark would walk in a loop, which is the exact failure the
// owner reported. So exactly one call advances the waypoint (`advanceWaypoint`,
// made once per fixed step by the runtime) and everything drawing it peeks.

const GOAL = level.postNode;

test("peeking never advances the waypoint; only advanceWaypoint does", () => {
  const way = createWayfinder(level);
  assert.equal(
    way.peekWaypoint(GOAL),
    null,
    "nothing is committed before the runtime takes its first step",
  );
  // Two consumers, peeking many times, must commit nothing.
  for (let read = 0; read < 200; read += 1) way.peekWaypoint(GOAL);
  assert.equal(way.peekWaypoint(GOAL), null, "a read is not a mutation");

  const committed = way.advanceWaypoint(at("A_START"), GOAL);
  assert.ok(committed, "the fixed step commits a waypoint");
  assert.deepEqual(way.peekWaypoint(GOAL), committed, "peek returns exactly it");
  for (let read = 0; read < 200; read += 1) {
    assert.deepEqual(
      way.peekWaypoint(GOAL),
      committed,
      "two consumers reading do not move the committed waypoint",
    );
  }
});

test("the mark only advances: a run never gets sent back to a place it passed", () => {
  const way = createWayfinder(level);
  const offered: string[] = [];
  for (const id of ["A_START", "B_STREET_MID", "C_SCAFF_FOOT", "D_SROOF_N"]) {
    const wp = way.advanceWaypoint(at(id), GOAL);
    if (wp) offered.push(wp.nodeId);
  }
  // Holding the same waypoint across consecutive ticks is stability, not a
  // loop; a loop is RETURNING to a waypoint after a different one intervened. So
  // collapse runs of the same mark, then require the sequence to be repeat-free.
  const legs = offered.filter((id, index) => id !== offered[index - 1]);
  assert.equal(
    new Set(legs).size,
    legs.length,
    `a waypoint was returned to after moving on, which is a loop: ${offered.join(" -> ")}`,
  );
  assert.ok(legs.length > 1, "the run advanced through more than one waypoint");
});

test("guidance recovers when the run deviates far off its committed waypoint", () => {
  const way = createWayfinder(level);
  // Commit a waypoint from up on the north roof.
  const far = way.advanceWaypoint(at("D_SROOF_N"), GOAL);
  assert.ok(far, "a waypoint is committed up the route");
  // Now the player is back at the spawn — tens of metres from that waypoint,
  // well past the abandon radius. The stale mark must be dropped and a fresh
  // forward one committed, rather than pointing back up the roof.
  const recovered = way.advanceWaypoint(at("A_START"), GOAL);
  assert.ok(recovered, "guidance re-commits from the deviated position");
  assert.notEqual(
    recovered!.nodeId,
    far!.nodeId,
    "a run that deviated is not still pointed at the abandoned waypoint",
  );
  const fromSpawn = straight({ x: at("A_START").x, z: at("A_START").z }, recovered!.nodeId);
  const toFar = straight({ x: at("A_START").x, z: at("A_START").z }, far!.nodeId);
  assert.ok(
    fromSpawn < toFar,
    "the recovered waypoint is nearer the deviated position than the abandoned one",
  );
});

test("the guidance a run gets is identical at 30, 60 and 120 render samples", () => {
  // The sim advances the waypoint once per fixed tick; the renderer peeks it as
  // often as it draws. Since a peek is pure, the committed sequence a run walks
  // through can depend only on the ticks it played and never on the frame rate.
  // 60Hz sim against 30/60/120fps render is 0.5/1/2 peeks a tick; model that as
  // whole peek counts and assert the committed sequences match exactly.
  const path = [
    "A_START",
    "A_START",
    "B_STREET_MID",
    "B_STREET_MID",
    "C_SCAFF_FOOT",
    "D_SROOF_N",
  ];
  const walk = (peeksPerTick: number): (string | null)[] => {
    const way = createWayfinder(level);
    const committed: (string | null)[] = [];
    for (const id of path) {
      way.advanceWaypoint(at(id), GOAL); // the fixed step, once per tick
      for (let peek = 0; peek < peeksPerTick; peek += 1) way.peekWaypoint(GOAL);
      committed.push(way.peekWaypoint(GOAL)?.nodeId ?? null);
    }
    return committed;
  };
  const at30 = walk(0);
  const at60 = walk(1);
  const at120 = walk(2);
  assert.deepEqual(at60, at30, "a 30fps renderer must get the same guidance");
  assert.deepEqual(at60, at120, "a 120fps renderer must get the same guidance");
});

// ---- SAFE first-run guidance ----------------------------------------------

/** Elm and Yard: the two objectives a first run is guided toward. */
const GOALS: readonly [string, string][] = [
  ["the elm", level.postNode],
  ["the yard", level.arenaNode],
];

test("first-attempt distance walks the SAFE route it is guiding along, from the spawn", () => {
  const spawn = at(level.startNode);
  const graph = routeDistanceGraph(level);
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const all = createWayfinder(level);

  for (const [name, goal] of GOALS) {
    const safePath = cheapestPath(graph, level.startNode, goal, ["SAFE"], {
      requireVerified: false,
    });
    assert.ok(safePath, `SAFE does not connect the spawn to ${name}`);

    const range = safe.rangeTo(spawn, goal);
    assert.equal(range.viaRoute, true, `${name}: the spawn's SAFE distance is a walked figure`);
    // The nearest reaching node from the spawn is the start node itself, so the
    // walked figure is exactly the SAFE route length — the distance the guidance
    // is sending the player, not a shorter all-lines one.
    assert.ok(
      Math.abs(range.metres - safePath!.metres) < 1e-6,
      `${name}: plate reads ${range.metres.toFixed(2)}m, the SAFE route is ${safePath!.metres.toFixed(2)}m`,
    );
    // Narrowing to SAFE never shortens the figure below the all-lines one.
    assert.ok(
      range.metres >= all.rangeTo(spawn, goal).metres - 1e-6,
      `${name}: SAFE distance ${range.metres.toFixed(2)}m is under the all-lines figure`,
    );
  }
});

test("a first run deviated onto Dock Square still gets SAFE guidance and a walked distance", () => {
  // C_SQUARE_W is the west crossing of Dock Square, a FAST/EXPERT point whose
  // geometrically nearest node has no SAFE edge toward either objective. Before
  // deviation recovery this returned null and both the mark and the plate fell
  // back to the crow-flies line through the Town House — the measured failure.
  // Recovery matches to the nearest node that CAN reach the goal on SAFE.
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const graph = routeDistanceGraph(level);
  for (const nodeId of ["C_SQUARE_W", "C_SQUARE_NW"]) {
    const from = at(nodeId);
    for (const [name, goal] of GOALS) {
      const range = safe.rangeTo(from, goal);
      assert.equal(
        range.viaRoute,
        true,
        `${nodeId} → ${name}: distance fell back to the crow-flies line`,
      );
      const wp = safe.advanceWaypoint(from, goal);
      assert.ok(wp, `${nodeId} → ${name}: no SAFE waypoint was offered`);
      // The recovered waypoint lies on a SAFE route to the goal.
      const safePath = cheapestPath(graph, wp!.nodeId, goal, ["SAFE"], {
        requireVerified: false,
      });
      assert.ok(
        safePath,
        `${nodeId} → ${name}: the offered waypoint ${wp!.nodeId} cannot reach ${name} on SAFE`,
      );
    }
  }
});

test("SAFE guidance advances and never loops, even starting from a deviation", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const offered: string[] = [];
  for (const id of ["C_SQUARE_W", "C_SQUARE_NW", "C_SCAFF_FOOT", "D_SROOF_N"]) {
    const wp = safe.advanceWaypoint(at(id), level.postNode);
    if (wp) offered.push(wp.nodeId);
  }
  const legs = offered.filter((id, index) => id !== offered[index - 1]);
  assert.equal(
    new Set(legs).size,
    legs.length,
    `SAFE guidance returned to a waypoint it had left: ${offered.join(" -> ")}`,
  );
  assert.ok(legs.length > 1, "the run advanced through more than one SAFE waypoint");
});

// ---- distance continuity --------------------------------------------------
//
// The displayed range once jumped ~97m on a centimetre of movement, because the
// anchor it measured from was re-picked by nearest-Euclidean every sample and
// flipped between a short branch and a hundred-metre detour. The anchor is now
// committed and advanced forward-only, so the plate is a continuous function of
// position: it decreases as the player closes on the goal, steps down by at most
// an adjacent node's worth as the anchor advances, and never switches branches.

/** Sweep between two positions, advancing the anchor each step as the runtime
 * does, and return the largest jump in the displayed range between adjacent
 * samples. */
function sweepMaxJump(
  finder: ReturnType<typeof createWayfinder>,
  fromId: string,
  toId: string,
  goal: string,
  steps: number,
): { maxJump: number; allWalked: boolean } {
  const a = at(fromId);
  const b = at(toId);
  let previous: number | null = null;
  let maxJump = 0;
  let allWalked = true;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const from = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
    finder.advanceWaypoint(from, goal); // the sole mutator, once per tick
    const range = finder.rangeTo(from, goal);
    if (!range.viaRoute) allWalked = false;
    if (previous !== null) maxJump = Math.max(maxJump, Math.abs(range.metres - previous));
    previous = range.metres;
  }
  return { maxJump, allWalked };
}

test("the SAFE distance moves continuously across Dock Square, never jumping branches", () => {
  // ~10cm steps across the west crossing — the exact region the anchor flipped
  // on. A jump of a few metres is an anchor advancing one node along the route;
  // ~97m is the branch swap this defends against.
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const { maxJump, allWalked } = sweepMaxJump(safe, "C_SQUARE_W", "C_SQUARE_NW", level.postNode, 80);
  assert.ok(allWalked, "the distance stayed a walked figure across the square");
  assert.ok(maxJump < 5, `the range jumped ${maxJump.toFixed(1)}m between adjacent 10cm samples`);
});

// ---- the Shambles: guidance a body can actually execute --------------------
//
// A real headless run on the first (SAFE-only) attempt reached (30.65, 0, 1.4)
// in the Shambles — on the ground, just south of the street line, under the
// stall canopies — and sat there with zero XZ velocity for thirty seconds. The
// committed mark was B_STALL_GAP at (34.4, 0, 1.4): a three-metre hop due east
// that runs straight THROUGH STALL_3. The advertised SAFE route from here does
// not cross the stall, it goes up — B_CRATES_FOOT, the climb onto stall 2's
// south-edge awning, the canopy leaps, down to B_STREET_E and B_EXIT — and only
// THEN back west to B_GAP_N and south through the slot to B_STALL_GAP.
//
// The defect was the anchor: `bestNearAnchor` preferred B_GAP_N/B_STALL_GAP
// because their remaining distance is lowest, and `commitAnchor` banked them
// though reaching them from the crate foot is a climb and three leaps away — not
// the metres of straight ground the body had actually covered. The mark skipped
// the physical route and pointed at a wall.

/** The nodes the SAFE line genuinely threads through the Shambles. */
const SHAMBLES_CLIMB_ROUTE = new Set([
  "B_STREET_MID",
  "B_CRATES_FOOT",
  "B_CANOPY_2_S",
  "B_CANOPY_2",
  "B_CANOPY_3",
  "B_CANOPY_4",
  "B_CRATES_B",
  "B_STREET_E",
  "B_EXIT",
]);

/** The gap/square nodes the SAFE route only reaches after the climb and drop. */
const SHAMBLES_PAST_GAP = new Set([
  "B_GAP_N",
  "B_STALL_GAP",
  "B2_ENTER",
  "B2_KERB",
]);

/**
 * Advance the mark once per ~10cm along a polyline, the way the fixed step
 * advances it once per tick as the body walks. Returns the waypoint committed at
 * the last position.
 */
function walkMark(
  finder: ReturnType<typeof createWayfinder>,
  polyline: readonly (readonly [number, number, number])[],
  goal: string,
): WayPoint | null {
  let committed: WayPoint | null = null;
  for (let leg = 0; leg < polyline.length - 1; leg += 1) {
    const a = polyline[leg]!;
    const b = polyline[leg + 1]!;
    const dist = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.round(dist / 0.1));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      committed = finder.advanceWaypoint(
        {
          x: a[0] + (b[0] - a[0]) * t,
          y: a[1] + (b[1] - a[1]) * t,
          z: a[2] + (b[2] - a[2]) * t,
        },
        goal,
      );
    }
  }
  return committed;
}

/** How an authored action kind completes, for a live node-to-node walk. */
const KIND_TO_VERB: Record<string, WayfindSample["verb"]> = {
  CLIMB: "CLIMB_UP",
  MANTLE: "MANTLE",
  VAULT: "VAULT",
  JUMP: "JUMP",
  DASH_JUMP: "DASH",
  LEAP_OF_FAITH: "LEAP_OF_FAITH",
};

/**
 * Walk the mark node-to-node the way the RUNTIME feeds it: at each authored
 * action link the body performs the traversal, so the arriving sample carries
 * the matching completion (verb + landing surface) that releases the gateway.
 * A bare position-only walk cannot perform a vault or a leap, so it would hold
 * an action gateway open — see `advanceWaypoint`/WayGateway.
 */
function walkMarkLive(
  finder: ReturnType<typeof createWayfinder>,
  route: readonly string[],
  goal: string,
): WayPoint | null {
  let committed: WayPoint | null = null;
  for (let leg = 0; leg < route.length - 1; leg += 1) {
    const fromId = route[leg]!;
    const toId = route[leg + 1]!;
    const a = at(fromId);
    const b = at(toId);
    const toNode = nodeById.get(toId)!;
    const link = level.links.find((l) => l.from === fromId && l.to === toId);
    const verb = link ? KIND_TO_VERB[link.kind] : undefined;
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(1, Math.round(dist / 0.1));
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      const arriving = step === steps;
      const sample: WayfindSample = {
        pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t },
        grounded: true,
        supportId: arriving ? toNode.surface : null,
        completed:
          arriving && verb
            ? { verb, landingId: toNode.surface }
            : null,
      };
      committed = finder.advanceWaypoint(sample, goal);
    }
  }
  return committed;
}

// The descent and the ground line into the Shambles, then the body chasing the
// eastward mark until STALL_3 pushes it south to the stuck position. Coordinates
// are the authored route nodes for the descent; the last two legs are the run's
// own trace — east along the street toward the mark, then wedged south.
const SHAMBLES_APPROACH: readonly (readonly [number, number, number])[] = [
  [15.4, 0, 1.2], // A_STREET
  [17.8, 0, -0.4], // B_STREET_W
  [20.95, 0, -0.35], // B_VAULT_IN
  [23.4, 0, -0.35], // B_VAULT_OUT (the gaol vault)
  [25.9, 0, -0.4], // B_DUCK
  [28.4, 0, -0.4], // B_STREET_MID (out of the slide)
  [32.0, 0, -0.4], // chasing the eastward mark along the street
  [30.64999, 0, 1.4], // wedged south by STALL_3: the stuck position
];

test("the Shambles mark never sends a first run east through a solid stall", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const stuck = walkMark(safe, SHAMBLES_APPROACH, level.postNode);
  assert.ok(stuck, "the run has a committed mark at the stuck position");
  assert.ok(
    !SHAMBLES_PAST_GAP.has(stuck!.nodeId),
    `the mark points at ${stuck!.nodeId}, past the stall gap, which is only ` +
      "reachable across STALL_3 from here — the run walked into it for 30s",
  );
  assert.ok(
    SHAMBLES_CLIMB_ROUTE.has(stuck!.nodeId),
    `the mark points at ${stuck!.nodeId}, which is not on the SAFE climb/canopy ` +
      "route the body can actually take from the stall front",
  );
});

test("the Shambles mark reaches the gap once the body has walked the SAFE route", () => {
  // The fix is route-contiguity, not a blacklist. Walk the body along the actual
  // SAFE line — up the awning, across the canopies, down to the street and east
  // to the exit — and the mark it refused from the stall front is offered once
  // the body has genuinely arrived at the east exit and gap approach.
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const route = [
    "B_STREET_MID",
    "B_CRATES_FOOT",
    "B_CANOPY_2_S",
    "B_CANOPY_2",
    "B_CANOPY_3",
    "B_CANOPY_4",
    "B_CRATES_B",
    "B_STREET_E",
    "B_EXIT",
    "B_GAP_N",
  ] as const;
  const arrived = walkMarkLive(safe, route, level.postNode);
  assert.ok(arrived, "a mark is committed at the gap approach");
  assert.ok(
    SHAMBLES_PAST_GAP.has(arrived!.nodeId),
    `at the east gap the mark should advance to the square, not stay behind: ${arrived!.nodeId}`,
  );
});

test("the SAFE distance is continuous across representative branch crossings", () => {
  // Ground-level crossings where the SAFE, FAST and EXPERT lines diverge and put
  // differently-costed reachable nodes close together — the shape that produced
  // the jump. Each pair is joined by an authored edge, so the straight sweep
  // between them is a path a runner could actually take (unlike a chord through
  // the air up a scaffold, which is not a crossing and not a walk). Both
  // objectives, at ~centimetre resolution.
  for (const goal of [level.postNode, level.arenaNode]) {
    for (const [fromId, toId] of [
      ["C_SQUARE_NW", "C_SCAFF_FOOT"],
      ["B_STREET_MID", "C_SQUARE_W"],
      ["B2_EXIT", "C_SQUARE_W"],
    ] as const) {
      const finder = createWayfinder(level, { guidanceLines: ["SAFE"] });
      const { maxJump } = sweepMaxJump(finder, fromId, toId, goal, 200);
      assert.ok(
        maxJump < 5,
        `${fromId}→${toId} toward ${goal}: range jumped ${maxJump.toFixed(1)}m between adjacent samples`,
      );
    }
  }
});

// ---- the Town House spiral: the mark climbs with the body -------------------
//
// A headless run stalled at (58.3, 10.2, 0) on CORNICE_E, velocity zero, with
// the committed SAFE mark still pinned to C_GALLERY_EMID 4.6m below. The gallery
// node sat at the deep interior (z=0), but a normal ascent climbs the clock
// ledge's NORTH LIP — where the ledge overhangs the east gallery at z=-4.5 — and
// never stands at z=0, so the height-aware mark preserved a hold the body had
// climbed straight past and could not walk back down to. Moving C_GALLERY_EMID to
// the real takeoff is the fix; this walks the measured gallery -> lip -> clock
// -> cornice poses and holds the mark to climbing with the body.

/** The takeoff node sits at the real north lip, not the deep mid-gallery. */
test("the gallery takeoff is authored at the clock-ledge lip, not the interior", () => {
  const emid = nodeById.get("C_GALLERY_EMID")!;
  assert.ok(
    emid.pos[2] <= -3,
    `C_GALLERY_EMID is at z=${emid.pos[2]}; the clock ledge is climbed from its ` +
      "north lip near z=-4.5, and a takeoff in the interior is one no ascent stands on",
  );
});

// gallery walk east, up the north lip, onto the clock ledge, up to the cornice.
// The climb intermediates are the poses a real ascent passed through (headless
// trace); the endpoints are the authored nodes.
const TOWNHOUSE_ASCENT: readonly (readonly [number, number, number])[] = [
  [56.6, 5.6, -6.45], // C_GALLERY_E
  [58.3, 5.6, -6.7], // C_GALLERY_CORNER
  [58.3, 5.6, -4.5], // C_GALLERY_EMID, the north-lip takeoff
  [58.4, 5.6, -5.4], // stepping into the lip
  [58.9, 7.9, -4.0], // topped out on CLOCK_LEDGE
  [59.0, 9.1, -2.3], // climbing the cornice face
  [58.3, 10.2, 0.0], // C_CORNICE_E
];

/** The clock-and-above nodes: where a mark belongs once the body has left the
 * gallery and started up the spiral. */
const TOWNHOUSE_ABOVE = new Set([
  "C_CLOCK",
  "C_CORNICE_E",
  "C_CORNICE_SE",
  "C_CORNICE_S",
  "C_LEADS_S",
]);

test("the Town House mark leaves the gallery takeoff behind as the body climbs", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const finalMark = walkMark(safe, TOWNHOUSE_ASCENT, level.postNode);
  assert.ok(finalMark, "a mark is committed after the Town House climb");
  // The diagnosed stall: the mark pinned to C_GALLERY_EMID 4.6m below the body,
  // because the old node sat at a mid-gallery interior a normal ascent never
  // stood on. Moving it to the real lip lets the body bank it and the mark move.
  assert.notEqual(
    finalMark!.nodeId,
    "C_GALLERY_EMID",
    "the mark is pinned to the gallery takeoff after the body has climbed above it",
  );
  const galleryY = at("C_GALLERY_EMID").y;
  assert.ok(
    finalMark!.pos[1] > galleryY + 1,
    `the mark points at ${finalMark!.nodeId} at y=${finalMark!.pos[1]}, still down on ` +
      "the gallery — it has not climbed onto the clock/cornice line with the body",
  );
  assert.ok(
    TOWNHOUSE_ABOVE.has(finalMark!.nodeId),
    `the mark is at ${finalMark!.nodeId}, not on the clock/cornice ascent`,
  );
});

// ---- directed traversal recovery (the rich fixed-tick sample) --------------
//
// Position alone cannot tell a finished climb from a body that drifted over a
// node: topping out onto the leads leaves the feet a metre above the cornice
// node climbed off, and a position-only mark holds it, pointing back down at a
// step already taken. So the runtime hands the mark a sample — grounded, the
// surface underfoot, the verb, the traversal that completed this tick — and the
// mark credits the completion to a directed link and moves on.

const POST = level.postNode;

/** A grounded fixed-tick sample at a node, optionally with a completed traversal. */
function sampleAt(
  id: string,
  completed?: WayfindSample["completed"],
): WayfindSample {
  const node = nodeById.get(id)!;
  return {
    pos: { x: node.pos[0], y: node.pos[1], z: node.pos[2] },
    grounded: true,
    supportId: node.surface,
    verb: "RUN",
    completed: completed ?? null,
  };
}

test("a finished climb onto the leads retires the cornice mark below the body", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  // Commit the mark at the cornice-south node as the body walks the cornice.
  safe.advanceWaypoint(sampleAt("C_CORNICE_E"), POST);
  safe.advanceWaypoint(sampleAt("C_CORNICE_SE"), POST);
  const onCornice = safe.advanceWaypoint(sampleAt("C_CORNICE_S"), POST);
  assert.ok(onCornice, "a mark is committed on the cornice");
  // Now the body climbs C_CORNICE_S -> C_LEADS_S onto the Town House roof. The
  // completion proves it is on the leads; the cornice mark below must be retired.
  const afterClimb = safe.advanceWaypoint(
    sampleAt("C_LEADS_S", { verb: "CLIMB_UP", landingId: "TOWNHOUSE__ROOF" }),
    POST,
  );
  assert.ok(afterClimb, "a mark is committed after the climb onto the leads");
  assert.notEqual(
    afterClimb!.nodeId,
    "C_CORNICE_S",
    "the mark stayed pinned to the cornice below the body after the climb",
  );
  assert.ok(
    afterClimb!.pos[1] >= at("C_LEADS_S").y - 0.1,
    `the mark points at ${afterClimb!.nodeId} at y=${afterClimb!.pos[1]}, still below the leads`,
  );
});

test("the meetinghouse climb advances D_MEETING_ROOF to the ridge/louvre", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  // Approaching along the south face, the mark commits to the meeting-house roof.
  safe.advanceWaypoint(sampleAt("E_MEETING_S"), POST);
  const onRoof = safe.advanceWaypoint(sampleAt("D_MEETING_ROOF"), POST);
  assert.ok(onRoof, "a mark is committed at the meeting-house roof");
  // The body climbs D_MEETING_ROOF -> E_RIDGE. The completion advances the mark.
  const afterClimb = safe.advanceWaypoint(
    sampleAt("E_RIDGE", { verb: "CLIMB_UP", landingId: "MEETING_RIDGE" }),
    POST,
  );
  assert.ok(afterClimb, "a mark is committed after the ridge climb");
  assert.notEqual(
    afterClimb!.nodeId,
    "D_MEETING_ROOF",
    "the mark remained held at the meeting-house roof after the ridge climb",
  );
  assert.ok(
    ["E_RIDGE", "E_LOUVRE"].includes(afterClimb!.nodeId),
    `the mark advanced to ${afterClimb!.nodeId}, not the ridge or louvre sill`,
  );
});

test("the tower drop rejoins C_LEADS_E and the range does not rise on landing", () => {
  const graph = routeDistanceGraph(level);
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  // Standing the vista, before the drop off the tower onto the leads.
  safe.advanceWaypoint(sampleAt("C_TOWER_GALLERY"), POST);
  const before = safe.rangeTo(at("C_TOWER_GALLERY"), POST).metres;
  // The chain drop lands on the Town House roof at C_LEADS_E — next to D_GANTRY,
  // which is a stride away on the LEADS_GANTRY board, a DIFFERENT surface.
  safe.advanceWaypoint(
    sampleAt("C_LEADS_E", { verb: "ROLL", landingId: "TOWNHOUSE__ROOF" }),
    POST,
  );
  const after = safe.rangeTo(at("C_LEADS_E"), POST);
  assert.equal(after.viaRoute, true, "the landing distance is a walked figure");
  assert.ok(
    after.metres <= before + 1e-6,
    `the range rose from ${before.toFixed(1)}m to ${after.metres.toFixed(1)}m on a clean landing`,
  );
  // Rejoined on the leads, not the gantry board a stride off it: the walked
  // figure is the SAFE route length from C_LEADS_E itself (anchor leg ~0).
  const fromLeads = cheapestPath(graph, "C_LEADS_E", POST, ["SAFE"], {
    requireVerified: false,
  })!.metres;
  assert.ok(
    Math.abs(after.metres - fromLeads) < 1.0,
    `landed range ${after.metres.toFixed(1)}m is not the C_LEADS_E route ${fromLeads.toFixed(1)}m — the anchor chose a wrong-support node`,
  );
});

test("a wrong-support near node is not banked into a mark regression", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const remainingOf = (id: string) =>
    cheapestPath(routeDistanceGraph(level), id, POST, ["SAFE"], {
      requireVerified: false,
    })?.metres ?? Infinity;
  // Land on C_LEADS_E (Town House roof); D_GANTRY is a stride off it on the
  // LEADS_GANTRY board. If the mark banked that wrong-support node as underfoot,
  // the committed mark could later reverse to a node behind. Walk the leads onto
  // the gantry and out to the south roof and require the committed mark to only
  // ever advance — never regress to a node further from the elm.
  safe.advanceWaypoint(
    sampleAt("C_LEADS_E", { verb: "ROLL", landingId: "TOWNHOUSE__ROOF" }),
    POST,
  );
  const offered: string[] = [];
  for (const id of ["C_LEADS_E", "D_GANTRY", "D_SROOF_W", "D_SROOF_N", "D_VAULT_IN_0"]) {
    const wp = safe.advanceWaypoint(sampleAt(id), POST);
    if (wp) offered.push(wp.nodeId);
  }
  const legs = offered.filter((id, index) => id !== offered[index - 1]);
  assert.equal(
    new Set(legs).size,
    legs.length,
    `the mark returned to a place it had left (a wrong-support mis-bank): ${offered.join(" -> ")}`,
  );
  // And every mark is genuinely ahead of the leads the body landed on.
  const leadsRemaining = remainingOf("C_LEADS_E");
  for (const id of offered) {
    assert.ok(
      remainingOf(id) <= leadsRemaining + 1e-6,
      `the mark ${id} is further from the elm than the leads the body is past`,
    );
  }
});

// Parameterized directed action gateways: an under-4m VAULT, CLIMB and JUMP, each
// held stateful until its OWN completion. The three release rules, on the same
// machine: ordinary arrival at the receiver does not bank it, an unrelated
// completion does not release it, and only the matching directed completion does.
const GATEWAY_CASES = [
  {
    kind: "VAULT",
    approach: "B2_PIER_GAP",
    from: "B2_GOODS_IN",
    to: "B2_GOODS_OUT",
    match: "VAULT" as WayfindSample["verb"],
    unrelated: "CLIMB_UP" as WayfindSample["verb"],
  },
  {
    kind: "CLIMB",
    approach: "B_STREET_MID",
    from: "B_CRATES_FOOT",
    to: "B_CANOPY_2_S",
    match: "CLIMB_UP" as WayfindSample["verb"],
    unrelated: "VAULT" as WayfindSample["verb"],
  },
  {
    kind: "JUMP",
    approach: "B_CANOPY_2_S",
    from: "B_CANOPY_2",
    to: "B_CANOPY_3",
    match: "JUMP" as WayfindSample["verb"],
    unrelated: "VAULT" as WayfindSample["verb"],
  },
] as const;

for (const c of GATEWAY_CASES) {
  test(`a ${c.kind} gateway (${c.from}->${c.to}) holds through arrival, ignores an unrelated completion, releases on its own`, () => {
    const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
    const start = at(c.approach);
    const takeoff = at(c.from);
    const receiver = at(c.to);
    const fromSurface = nodeById.get(c.from)!.surface;
    const toSurface = nodeById.get(c.to)!.surface;

    // Approach the take-off along the route (position only, no completion) so the
    // anchor commits behind it and the gateway arms on the action link ahead —
    // the way the runtime reaches it, not teleported onto the flat receiver.
    const steps = 40;
    let armed = safe.peekWaypoint(POST);
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      safe.advanceWaypoint(
        {
          pos: {
            x: start.x + (takeoff.x - start.x) * t,
            y: start.y + (takeoff.y - start.y) * t,
            z: start.z + (takeoff.z - start.z) * t,
          },
          grounded: true,
          supportId: fromSurface,
          completed: null,
        },
        POST,
      );
      const g = safe.peekWaypoint(POST);
      if (g?.gateway?.toNodeId === c.to) armed = g;
    }
    assert.equal(
      armed?.gateway?.toNodeId,
      c.to,
      `the ${c.kind} did not arm a gateway on ${c.from}->${c.to}`,
    );
    assert.ok(
      armed?.gateway?.allowedVerbs.includes(c.match),
      `the ${c.kind} gateway does not allow its own completing verb`,
    );

    // ORDINARY ARRIVAL at the receiver, no completion: the gateway is NOT banked
    // by mere arrival — it is still held on the same link.
    const atReceiver: WayfindSample = {
      pos: receiver,
      grounded: true,
      supportId: toSurface,
      verb: "RUN",
      completed: null,
    };
    safe.advanceWaypoint(atReceiver, POST);
    assert.equal(
      safe.peekWaypoint(POST)?.gateway?.toNodeId,
      c.to,
      `ordinary arrival retired the ${c.kind} gateway before the action`,
    );

    // An UNRELATED completion (a different verb family) does not release it.
    safe.advanceWaypoint(
      { ...atReceiver, completed: { verb: c.unrelated, landingId: toSurface } },
      POST,
    );
    assert.equal(
      safe.peekWaypoint(POST)?.gateway?.toNodeId,
      c.to,
      `an unrelated ${c.unrelated} released the ${c.kind} gateway`,
    );

    // The MATCHING completion at the destination releases it: the mark is no
    // longer this gateway's held receiver.
    const released = safe.advanceWaypoint(
      { ...atReceiver, completed: { verb: c.match, landingId: toSurface } },
      POST,
    );
    assert.notEqual(
      released?.gateway?.toNodeId,
      c.to,
      `the matching ${c.match} did not release the ${c.kind} gateway`,
    );
  });
}

test("a leap gateway: the receiver arms <=0.35m from the lip but holds until the dive completes", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const eg = at("E_GALLERY");
  const galSurface = nodeById.get("E_GALLERY")!.surface;
  const crownSurface = nodeById.get("F_CROWN")!.surface;
  // The body climbs the louvre onto the gallery: the CLIMB completes at
  // E_GALLERY, which arms the leap-of-faith gateway whose take-off is the lip.
  safe.advanceWaypoint(sampleAt("E_LOUVRE"), POST);
  safe.advanceWaypoint(
    {
      pos: { x: eg.x, y: eg.y, z: eg.z - 1.0 },
      grounded: true,
      supportId: galSurface,
      completed: { verb: "CLIMB_UP", landingId: galSurface },
    },
    POST,
  );
  // A metre short of the take-off: APPROACH holds the mark on the gallery lip,
  // not the crown across the void. The ordinary 3m arrival would hand it on here.
  const oneOut: WayfindSample = {
    pos: { x: eg.x, y: eg.y, z: eg.z - 1.0 },
    grounded: true,
    supportId: galSurface,
    verb: "RUN",
    completed: null,
  };
  safe.advanceWaypoint(oneOut, POST);
  const outMark = safe.peekWaypoint(POST);
  assert.equal(
    outMark?.nodeId,
    "E_GALLERY",
    `the leap mark advanced a metre early: ${outMark?.nodeId}`,
  );
  assert.equal(
    outMark?.gateway?.toNodeId,
    "F_CROWN",
    "the leap-of-faith gateway is armed on E_GALLERY->F_CROWN",
  );
  // Inside a third of a metre: the receiver (the crown) arms — but the gateway
  // REMAINS held; it is not banked by mere arrival at the lip.
  const atLip: WayfindSample = {
    pos: { x: eg.x, y: eg.y, z: eg.z - 0.3 },
    grounded: true,
    supportId: galSurface,
    verb: "RUN",
    completed: null,
  };
  safe.advanceWaypoint(atLip, POST);
  const armed = safe.peekWaypoint(POST);
  assert.equal(armed?.nodeId, "F_CROWN", "the receiver arms at the tight lip");
  assert.equal(
    armed?.gateway?.phase,
    "RECEIVER",
    "the leap is still a held gateway at the lip, not a banked waypoint",
  );
  // An UNRELATED completion (a vault) does not release the leap.
  safe.advanceWaypoint(
    { ...atLip, completed: { verb: "VAULT", landingId: galSurface } },
    POST,
  );
  assert.equal(
    safe.peekWaypoint(POST)?.gateway?.toNodeId,
    "F_CROWN",
    "an unrelated completion did not release the leap gateway",
  );
  // The matching dive completing at the crown releases it and the mark moves on.
  const fc = at("F_CROWN");
  const landed = safe.advanceWaypoint(
    {
      pos: { x: fc.x, y: fc.y, z: fc.z },
      grounded: true,
      supportId: crownSurface,
      completed: { verb: "LEAP_OF_FAITH", landingId: crownSurface },
    },
    POST,
  );
  assert.notEqual(
    landed?.nodeId,
    "E_GALLERY",
    "the leap mark released only after the matching dive completed",
  );
});

// ---- the clock-ledge climb: a straight-up gateway, and the release that un-stuck it
//
// C_GALLERY_EMID -> C_CLOCK climbs straight up onto the clock ledge. The ledge's
// node sits mid-deck at z=0, but an ascent tops out at its NORTH LIP near z=-4 —
// ~3.9m from the node, past COMPLETION_ARRIVE_M. A node-distance-only release
// therefore never fired: the gateway held forever, the mark stayed pinned to the
// gallery take-off, the cornice climb above never armed, and a headless run sat on
// the ledge indefinitely. Two properties fix and prove it: while approaching, the
// waypoint is the take-off (its own rise reads flat) yet the gateway exposes the
// authored +2.3m ascent so a reader can post the upward affordance; and a matching
// CLIMB that LANDS ON THE LEDGE'S DECK releases the gateway wherever on that deck
// the body topped out.
test("the clock-ledge climb gateway exposes its authored rise at the take-off while approaching", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const corner = at("C_GALLERY_CORNER");
  const emid = at("C_GALLERY_EMID");
  const emidSurface = nodeById.get("C_GALLERY_EMID")!.surface;

  // Approach the take-off along the route, stopping ~1.2m short so the gateway is
  // armed but still APPROACHING (the mark is the take-off, not yet the receiver).
  const steps = 30;
  let armed = safe.peekWaypoint(POST);
  for (let s = 0; s <= steps; s += 1) {
    const t = (s / steps) * 0.55; // stop short of the take-off
    safe.advanceWaypoint(
      {
        pos: {
          x: corner.x + (emid.x - corner.x) * t,
          y: corner.y + (emid.y - corner.y) * t,
          z: corner.z + (emid.z - corner.z) * t,
        },
        grounded: true,
        supportId: emidSurface,
        completed: null,
      },
      POST,
    );
    const g = safe.peekWaypoint(POST);
    if (g?.gateway?.toNodeId === "C_CLOCK") armed = g;
  }
  assert.equal(
    armed?.gateway?.toNodeId,
    "C_CLOCK",
    "the clock-ledge climb did not arm a directed gateway",
  );
  assert.equal(
    armed?.gateway?.phase,
    "APPROACH",
    "the gateway should still be approaching the take-off in this window",
  );
  // The directed ascent is read off the authored FROM->TO link (C_CLOCK is 2.3m
  // above the gallery take-off), NOT off the pinned mark.
  assert.ok(
    (armed?.gateway?.riseM ?? 0) > 0.9,
    `the gateway rise ${armed?.gateway?.riseM?.toFixed(2)}m does not read the +2.3m ascent`,
  );
  // ...while the held waypoint itself is still the take-off, down at gallery height.
  assert.ok(
    Math.abs(armed!.pos[1] - emid.y) < 1e-6,
    `the held waypoint is at y=${armed!.pos[1]}, not the gallery take-off ${emid.y}`,
  );
});

test("the clock-ledge climb gateway releases on a matching climb onto its deck, off the node", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const corner = at("C_GALLERY_CORNER");
  const emid = at("C_GALLERY_EMID");
  const clock = at("C_CLOCK");
  const emidSurface = nodeById.get("C_GALLERY_EMID")!.surface;
  const clockSurface = nodeById.get("C_CLOCK")!.surface;

  // Arm the gateway by approaching, then arriving at, the take-off.
  const steps = 40;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    safe.advanceWaypoint(
      {
        pos: {
          x: corner.x + (emid.x - corner.x) * t,
          y: corner.y + (emid.y - corner.y) * t,
          z: corner.z + (emid.z - corner.z) * t,
        },
        grounded: true,
        supportId: emidSurface,
        completed: null,
      },
      POST,
    );
  }
  assert.equal(
    safe.peekWaypoint(POST)?.gateway?.toNodeId,
    "C_CLOCK",
    "the clock-ledge climb gateway is armed before the release",
  );

  // The climb tops out on the ledge's north lip, at the take-off's z — which is
  // ~3.9m from the C_CLOCK node. This MUST be beyond the node arrival radius, or
  // the test would pass on node proximity and not exercise the deck release.
  const lip = { x: emid.x, y: clock.y, z: emid.z };
  assert.ok(
    Math.hypot(lip.x - clock.x, lip.z - clock.z) > 2.5,
    "the lip top-out must be beyond the node-arrival radius for this test to bite",
  );
  // A CLIMB_UP that lands on the LEDGE'S OWN DECK releases the gateway, though the
  // body is nowhere near the node. This is the release that un-stuck the clock.
  const released = safe.advanceWaypoint(
    {
      pos: lip,
      grounded: true,
      supportId: clockSurface,
      verb: "CLIMB_UP",
      completed: { verb: "CLIMB_UP", landingId: clockSurface },
    },
    POST,
  );
  assert.notEqual(
    released?.gateway?.toNodeId,
    "C_CLOCK",
    "the climb onto the ledge deck did not release the clock-ledge gateway",
  );
});

// ---- the ropewalk descent: a one-way drop must not point the mark back up ----
//
// D_SROOF_E -> D2_ROOF_W is a SAFE CHAIN_DROP: off the south-row roof (y=12.4)
// onto the ropewalk roof deck (y=8.6), 3.8m down and ~10m along. A DROP is not an
// action gateway — there is no take-off to hold — so the mark leads the receiver
// D2_ROOF_W straight off the bat and holds it through the fall. The body runs off
// the south lip, arcs, and lands a couple of metres PAST the receiver node, on
// the receiver's own deck (ROPEWALK_ROOF_W).
//
// The defect this locks out: at the landing the single lowest-remaining near node
// is D2_BEAM_W — the tie beam 3.4m straight DOWN through the roof, lowest-remaining
// because it is far along the interior route. `contiguousProgress` correctly
// refuses it (the body did not drop through the roof), but `commitAnchor` used to
// give up on that one refusal and keep the stale anchor up on the south row behind
// the take-off — so the lead loop then offered D_SROOF_E, commanding an impossible
// climb back UP the drop the body had just taken. The anchor now scans the whole
// near band and advances to the furthest CONTIGUOUS node the body actually reached,
// which is on the receiver deck, so the mark goes forward into the ropewalk.
const DROP_TAKEOFF = "D_SROOF_E";
const DROP_RECEIVER = "D2_ROOF_W";
const DROP_RECEIVER_DECK = nodeById.get(DROP_RECEIVER)!.surface; // ROPEWALK_ROOF_W

/** SAFE route metres from a node to the elm, for asserting forward progress. */
function safeRemaining(id: string): number {
  return (
    cheapestPath(routeDistanceGraph(level), id, POST, ["SAFE"], {
      requireVerified: false,
    })?.metres ?? Infinity
  );
}

/**
 * Drive the wayfinder through the real shape of the drop: grounded south-row
 * approach to the south lip, an airborne arc, then the grounded landing. The
 * landing sample is supplied by the caller so a deck-specific negative can land
 * the body on a DIFFERENT surface at the same place.
 */
function driveTheDrop(landing: WayfindSample): {
  offered: string[];
  finalMark: WayPoint | null;
} {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const offered: string[] = [];
  const push = (wp: WayPoint | null) => {
    if (wp) offered.push(wp.nodeId);
  };
  const takeoff = at(DROP_TAKEOFF);
  // Grounded approach along the south-row roof toward the south lip (~z=15.2),
  // heading at the receiver — the anchor commits behind on SOUTH_ROW_A__ROOF and
  // the mark leads the receiver across the drop.
  const southLip: [number, number, number] = [66.5, 12.4, 15.2];
  const approach: [number, number, number][] = [
    [at("D_VAULT_OUT_1").x, at("D_VAULT_OUT_1").y, at("D_VAULT_OUT_1").z],
    [takeoff.x, takeoff.y, takeoff.z],
    southLip,
  ];
  for (let leg = 0; leg < approach.length - 1; leg += 1) {
    const a = approach[leg]!;
    const b = approach[leg + 1]!;
    const steps = 24;
    for (let s = 0; s <= steps; s += 1) {
      const t = s / steps;
      push(
        safe.advanceWaypoint(
          {
            pos: {
              x: a[0] + (b[0] - a[0]) * t,
              y: a[1] + (b[1] - a[1]) * t,
              z: a[2] + (b[2] - a[2]) * t,
            },
            grounded: true,
            supportId: "SOUTH_ROW_A__ROOF",
            verb: "RUN",
            completed: null,
          },
          POST,
        ),
      );
    }
  }
  // The airborne arc from the lip down toward the landing: grounded false, no
  // support underfoot — the exact window the mark used to flip backward in.
  const land = landing.pos;
  const arcFrom: [number, number, number] = southLip;
  const arcSteps = 24;
  for (let s = 1; s <= arcSteps; s += 1) {
    const t = s / arcSteps;
    push(
      safe.advanceWaypoint(
        {
          pos: {
            x: arcFrom[0] + (land.x - arcFrom[0]) * t,
            y: arcFrom[1] + (land.y - arcFrom[1]) * t,
            z: arcFrom[2] + (land.z - arcFrom[2]) * t,
          },
          grounded: false,
          supportId: null,
          verb: "RUN_OFF",
          completed: null,
        },
        POST,
      ),
    );
  }
  // The grounded landing.
  const final = safe.advanceWaypoint(landing, POST);
  push(final);
  return { offered, finalMark: final };
}

test("a SAFE drop onto the receiver deck advances the mark into the ropewalk, never back up to the take-off", () => {
  // Land a couple of metres PAST the receiver node, on the receiver's own deck —
  // the real arc overshoots D2_ROOF_W by ~2.7m, beyond the node-arrival radius.
  const landing: WayfindSample = {
    pos: { x: 65.2, y: 8.6, z: 20.0 },
    grounded: true,
    supportId: DROP_RECEIVER_DECK,
    verb: "RUN_OFF",
    completed: { verb: "RUN_OFF", landingId: DROP_RECEIVER_DECK },
  };
  const { offered, finalMark } = driveTheDrop(landing);
  assert.ok(finalMark, "a mark is committed after the drop");

  // The mark leads the receiver during the approach/fall (the drop's destination),
  // proving the run was actually pointed across the drop before it landed.
  assert.ok(
    offered.includes(DROP_RECEIVER),
    `the mark never led the receiver ${DROP_RECEIVER} across the drop: ${[...new Set(offered)].join(" -> ")}`,
  );

  // THE REGRESSION: once the body has legitimately dropped onto the receiver deck,
  // the mark must never be commanded back UP to the one-way take-off it left.
  assert.notEqual(
    finalMark!.nodeId,
    DROP_TAKEOFF,
    "the mark pointed back up at the drop take-off after the body landed on the receiver deck",
  );
  // The mark never sits back up at the leads take-off height once the body is down.
  assert.ok(
    finalMark!.pos[1] < 11,
    `the mark is at y=${finalMark!.pos[1]}, back up on the south-row leads after the drop`,
  );
  // Forward progress: the mark is meaningfully closer to the elm than the take-off.
  assert.ok(
    safeRemaining(finalMark!.nodeId) < safeRemaining(DROP_TAKEOFF),
    `the mark ${finalMark!.nodeId} is not closer to the elm than the drop take-off`,
  );
  // And it is on the receiver deck, not the tie beam a further 3.4m DOWN through
  // the roof — the spatially-near, vertically-distant node that used to strand it.
  assert.notEqual(
    finalMark!.nodeId,
    "D2_BEAM_W",
    "the mark skipped straight down to the interior tie beam the body has not dropped to",
  );
  assert.ok(
    finalMark!.pos[1] > 7.5,
    `the mark is at y=${finalMark!.pos[1]}, down in the ropewalk interior rather than on the roof deck`,
  );
});

test("falling to a deck below the receiver is not credited the drop's route progress", () => {
  // The deck/surface-specific half: land the body on the tie beam (ROPEWALK_TIE_BEAM,
  // y=5.2) — a different, lower deck than the authored receiver — at the beam's own
  // west node. A one-way drop's progress is credited to the receiver DECK; landing a
  // whole storey below it must not skip the mark onto the deep-interior beam route as
  // though the roof-level run had happened. It must still lead a node the body can
  // actually walk to from where it is, and never point back up at the take-off.
  const beam = at("D2_BEAM_W");
  const landing: WayfindSample = {
    pos: { x: beam.x, y: beam.y, z: beam.z },
    grounded: true,
    supportId: "ROPEWALK_TIE_BEAM",
    verb: "RUN_OFF",
    completed: { verb: "RUN_OFF", landingId: "ROPEWALK_TIE_BEAM" },
  };
  const { finalMark } = driveTheDrop(landing);
  assert.ok(finalMark, "a mark is committed after the alternate landing");
  // Whatever the mark is, it is not an impossible climb back to the take-off.
  assert.notEqual(
    finalMark!.nodeId,
    DROP_TAKEOFF,
    "landing on the beam still pointed the mark back up at the drop take-off",
  );
  // Landing ON the beam deck legitimately IS on the interior route, so the mark may
  // lead the beam onward — but it must be at the body's own level, never back up on
  // the south-row leads it dropped from.
  assert.ok(
    finalMark!.pos[1] < 11,
    `the mark is at y=${finalMark!.pos[1]}, back up on the leads after landing in the interior`,
  );
});

// ---- the ropewalk tie beam: a directed drop onto a narrow board owns its lip ----
//
// D2_ROOF_N -> D2_BEAM_MID is a SAFE CHAIN_DROP through the roof hatch onto the
// 1.6m tie beam, 3.4m down and authored at 2.3 m/s. Unlike the wide-deck descent
// onto the ropewalk roof above (D_SROOF_E -> D2_ROOF_W, which stays a plain
// lead-the-receiver drop with no gateway), this one lands on a NARROW BOARD where
// a sprint entry overshoots into the dark — so it arms a directed gateway that
// OWNS the lip: only the controlled-descent family (a run-off / hang drop) may
// complete it, an automatic JUMP_GAP or dive is NOT in its allowed set, and the
// authored 2.3 m/s caps the WHOLE approach so a Shift-held body has already
// slowed to the safe pace before the hatch rather than only once it is on the lip.
const BEAM_TAKEOFF = "D2_ROOF_N";
const BEAM_RECEIVER = "D2_BEAM_MID";

/** Run east along the ropewalk roof to the hatch lip, arming the tie-beam drop. */
function armTheBeamDrop(): {
  safe: ReturnType<typeof createWayfinder>;
  armed: WayPoint | null;
  cappedApproach: boolean;
} {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const start = at("D2_VENT_OUT_1");
  const takeoff = at(BEAM_TAKEOFF);
  const roofSurface = nodeById.get("D2_VENT_OUT_1")!.surface;
  const steps = 40;
  let armed: WayPoint | null = null;
  let cappedApproach = false;
  for (let s = 0; s <= steps; s += 1) {
    const t = s / steps;
    const pos = {
      x: start.x + (takeoff.x - start.x) * t,
      y: start.y + (takeoff.y - start.y) * t,
      z: start.z + (takeoff.z - start.z) * t,
    };
    safe.advanceWaypoint(
      { pos, grounded: true, supportId: roofSurface, verb: "RUN", completed: null },
      POST,
    );
    const g = safe.peekWaypoint(POST);
    if (g?.gateway?.toNodeId === BEAM_RECEIVER) {
      armed = g;
      // The authored drop pace caps the run-in while the gateway is HELD, not
      // only once the frozen anchor reaches the lip.
      if (safe.legSpeedCap(pos, POST) === 2.3) cappedApproach = true;
    }
  }
  return { safe, armed, cappedApproach };
}

test("the ropewalk tie-beam drop arms a directed gateway that owns the lip", () => {
  const { armed, cappedApproach } = armTheBeamDrop();
  assert.equal(
    armed?.gateway?.toNodeId,
    BEAM_RECEIVER,
    "the tie-beam drop did not arm a directed gateway",
  );
  // The controlled chain drop is available...
  assert.ok(
    armed?.gateway?.allowedVerbs.includes("RUN_OFF"),
    "the drop gateway does not allow its own controlled run-off",
  );
  // ...and the overshooting automatic verbs are NOT — the runtime commit filter
  // reads this set and drops a JUMP_GAP / dive at the lip.
  assert.ok(
    !armed?.gateway?.allowedVerbs.includes("JUMP_GAP"),
    "the drop gateway allows an overshooting JUMP_GAP",
  );
  assert.ok(
    !armed?.gateway?.allowedVerbs.includes("LEAP_OF_FAITH"),
    "the drop gateway allows a dive off the lip",
  );
  assert.ok(
    (armed?.gateway?.riseM ?? 0) < 0,
    `the drop gateway rise ${armed?.gateway?.riseM?.toFixed(2)}m does not read a descent`,
  );
  assert.ok(
    cappedApproach,
    "the authored 2.3 m/s pace did not cap the approach while the drop gateway was held",
  );
});

test("the tie-beam drop releases on a run-off onto the beam, never on a fall to the floor", () => {
  const { safe, armed } = armTheBeamDrop();
  assert.ok(armed, "the tie-beam drop armed a gateway to test the release of");
  const beam = at(BEAM_RECEIVER);
  const beamSurface = nodeById.get(BEAM_RECEIVER)!.surface; // ROPEWALK_TIE_BEAM

  // A JUMP_GAP that overshot the plank puts the body on the unlit floor a whole
  // storey below the receiver. That is not the authored action: the gateway is
  // NOT released, so the mark cannot advance past a drop the body botched.
  safe.advanceWaypoint(
    {
      pos: { x: beam.x, y: 0, z: beam.z },
      grounded: true,
      supportId: "GROUND",
      verb: "RUN_OFF",
      completed: { verb: "RUN_OFF", landingId: "GROUND" },
    },
    POST,
  );
  assert.equal(
    safe.peekWaypoint(POST)?.gateway?.toNodeId,
    BEAM_RECEIVER,
    "a fall to the floor wrongly released the tie-beam drop gateway",
  );

  // A controlled run-off that lands ON the tie beam IS the authored drop: it
  // releases the gateway and the mark advances along the beam route, not back up.
  const released = safe.advanceWaypoint(
    {
      pos: { x: beam.x, y: beam.y, z: beam.z },
      grounded: true,
      supportId: beamSurface,
      verb: "RUN_OFF",
      completed: { verb: "RUN_OFF", landingId: beamSurface },
    },
    POST,
  );
  assert.notEqual(
    safe.peekWaypoint(POST)?.gateway?.toNodeId,
    BEAM_RECEIVER,
    "the run-off onto the beam did not release the tie-beam drop gateway",
  );
  assert.ok(released, "no mark was committed after the body landed the beam");
  assert.notEqual(
    released!.nodeId,
    BEAM_TAKEOFF,
    "after landing the beam the mark pointed back up at the hatch take-off",
  );
  assert.ok(
    released!.pos[1] <= beam.y + 0.1,
    `the mark is at y=${released!.pos[1]}, back up on the roof after landing the beam`,
  );
});

// ---- the rope-capstan VAULT at the foot of the hemp -----------------------
//
// The tarring floor opens with a VAULT over the rope capstan
// (D2_VAULT_IN -> D2_VAULT_OUT), a stride past where the hemp descent lands on
// D2_FLOOR_W. The capstan is BYPASSABLE — open floor a stride north — so the
// distance anchor's near-band reached the vault's FAR side (D2_VAULT_OUT) across
// a short straight span and advanced onto it, retiring the take-off and arming
// the slide beyond. The vault was walked around. The anchor now refuses to
// advance past an unperformed action's receiver while the body is on its
// approach, so the vault take-off is preserved and armed.

test("the SAFE hemp descent arms the capstan VAULT at the floor, not the slide beyond it", () => {
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const mark = walkMarkLive(
    safe,
    ["D2_BEAM_W", "D2_BALES_HIGH", "D2_BALES_LOW", "D2_FLOOR_W"],
    POST,
  );
  assert.ok(mark, "a mark is committed at the foot of the hemp");
  assert.equal(
    mark!.gateway?.toNodeId,
    "D2_VAULT_OUT",
    `at the floor the mark armed ${mark!.gateway?.toNodeId ?? mark!.nodeId}, not the capstan vault — the anchor skipped its take-off`,
  );
  assert.ok(
    mark!.gateway?.allowedVerbs.includes("VAULT"),
    "the armed gateway at the floor is not a vault",
  );
});

test("once the capstan VAULT is performed the mark advances to the slide, not held on the vault", () => {
  // The negative: after the body actually vaults (its receiver banked by a VAULT
  // completion), the guard releases and the anchor advances normally — the vault
  // is not held forever, and the mark moves on to the stretcher-frame slide.
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  const mark = walkMarkLive(
    safe,
    [
      "D2_BEAM_W",
      "D2_BALES_HIGH",
      "D2_BALES_LOW",
      "D2_FLOOR_W",
      "D2_VAULT_IN",
      "D2_VAULT_OUT",
      "D2_SLIDE_IN",
    ],
    POST,
  );
  assert.ok(mark, "a mark is committed past the capstan vault");
  assert.notEqual(
    mark!.gateway?.toNodeId,
    "D2_VAULT_OUT",
    "the capstan vault gateway is still held after the body performed it",
  );
});

test("a body falling onto the floor receiver does not retire it or bank the vault mid-air", () => {
  // The airborne-descent hold: while the body is still falling more than a step
  // above the floor receiver, the mark must stay on the receiver — it must not
  // bank the receiver (nor the capstan vault a stride past it) as reached, which
  // is what the height-weighted reach test did to a 1.1m overshoot and is why the
  // vault was skipped. Seed the mark at the low bale, then fall toward the floor.
  const safe = createWayfinder(level, { guidanceLines: ["SAFE"] });
  walkMarkLive(safe, ["D2_BEAM_W", "D2_BALES_HIGH", "D2_BALES_LOW"], POST);
  const floor = at("D2_FLOOR_W");
  // Three airborne samples descending from the bale top toward the floor, each
  // more than a step (DESCENT_LAND_BAND_M) above it.
  for (const y of [1.0, 0.8, 0.6]) {
    const mark = safe.advanceWaypoint(
      { pos: { x: floor.x + 0.4, y, z: floor.z + 1.4 }, grounded: false, supportId: null },
      POST,
    );
    assert.ok(mark, "a mark is committed during the fall");
    assert.notEqual(
      mark!.gateway?.toNodeId,
      "D2_VAULT_OUT",
      `the capstan vault armed mid-fall at y=${y} — a falling body banked the floor and the vault take-off`,
    );
  }
  // Landed on the floor, the vault arms normally.
  const landed = safe.advanceWaypoint(
    {
      pos: { x: floor.x, y: floor.y, z: floor.z },
      grounded: true,
      supportId: "GROUND",
      verb: "RUN_OFF",
      completed: { verb: "RUN_OFF", landingId: "GROUND" },
    },
    POST,
  );
  assert.equal(
    landed!.gateway?.toNodeId,
    "D2_VAULT_OUT",
    "the capstan vault did not arm once the body landed on the floor receiver",
  );
});
