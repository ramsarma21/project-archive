// The invariants the M1 placement instruments have to satisfy before anyone
// reads a number out of them.
//
// Why this is a fixture suite and not a comment
// --------------------------------------------
// Four defects have now been found in these tools, and all four had the same
// shape: the tool reported a confident number that was wrong instead of failing.
//
//   1. `verify_roofline_kit.mjs` reused one positioned scene across an asset's
//      draws, so `roof-chimney-stack` reported its first draw at 100% and the
//      other three at 0.0% — from an identical mesh, in an identical box, at
//      scale 1.0000.
//   2. `verify_m1_placements.mjs` built a module's world footprint from
//      `size[0]` and `size[2]` without applying `yaw`, so every module laid
//      along Z was measured against its own cross-section.
//   3. The support probe let a chimney count as the thing holding the chimney
//      up, which passed both of the ones floating 3.1m over the roof.
//   4. The support probe asked about a mass's BASE where the route stands on its
//      TOP, which is the wrong question about every raised landing in the level.
//
// None of the four would have survived the five checks below. That is the test:
// not that the tools pass, but that a broken tool cannot.
//
// Both verifiers run this before they measure anything and refuse to print if it
// fails, and `placement_lib.test.mjs` runs it under `node --test`. The synthetic
// geometry here is a Three primitive on purpose — it is a dev diagnostic, never
// a visible production object, which is the one place the imported-assets rule
// leaves open.

import {
  clipConvex,
  containFitScale,
  coveredFraction,
  orientedCorners,
  partFootprint,
  placementFootprint,
  polygonArea,
  reachBeyond,
  rotateXZ,
  shellFit,
  supportPlane,
  supportsFrom,
} from "./placement_lib.mjs";
import {
  DECK_MIN_PCT,
  EDGE_NUDGE_M,
  FOOTPRINT_TOL,
  MASS_TOP_MIN_PCT,
  asPart,
  footprintSamples,
  placeInto,
  shortfallOf,
  surveyFirstHit,
  surveyNearPlane,
} from "./placement_probe.mjs";

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

/** A pristine 1 x 1 x 1 mesh, centred on its own origin, per call. */
function unitCubeSource(THREE, size = [1, 1, 1]) {
  return {
    natural: size,
    next: () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size[0], size[1], size[2]),
        new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      );
      const scene = new THREE.Group();
      scene.add(mesh);
      scene.updateMatrixWorld(true);
      return scene;
    },
  };
}

// ---------------------------------------------------------------------------
// 1. identical inputs, identical output
// ---------------------------------------------------------------------------

/**
 * The same mesh in the same box at the same scale must report the same coverage
 * however many draws that asset has and in whatever order they are evaluated.
 *
 * This is defect 1 stated as an invariant. Four draws of one 1m cube, each in its
 * own 1m box, each measured over its own top: four equal numbers, forwards and
 * backwards. Under the reused-scene fit the first is 100% and the rest are 0.0%.
 */
function identicalDrawsAgree(THREE) {
  const source = unitCubeSource(THREE);
  const draws = [
    { id: "A", pos: [10, 12.4, 10], size: [1, 1, 1], yaw: 0, fit: "PROP" },
    { id: "B", pos: [40, 12.4, 10], size: [1, 1, 1], yaw: 0, fit: "PROP" },
    { id: "C", pos: [40, 8.6, 60], size: [1, 1, 1], yaw: 0, fit: "PROP" },
    { id: "D", pos: [-25, 0, -30], size: [1, 1, 1], yaw: 0, fit: "PROP" },
  ];
  const measure = (order) =>
    order.map((draw) => {
      const placed = placeInto(THREE, source.next(), draw, source.natural);
      const rect = {
        minX: draw.pos[0] - 0.5,
        maxX: draw.pos[0] + 0.5,
        minZ: draw.pos[2] - 0.5,
        maxZ: draw.pos[2] + 0.5,
      };
      const survey = surveyFirstHit(THREE, placed.targets, asPart(rect), draw.pos[1] + 1);
      return { id: draw.id, pct: Number(survey.pct.toFixed(6)), scale: placed.uniformScale };
    });

  const forwards = measure(draws);
  const backwards = measure([...draws].reverse()).reverse();
  const pcts = forwards.map((r) => r.pct);
  const ok =
    pcts.every((p) => near(p, 100, 1e-6)) &&
    forwards.every((r, i) => near(r.pct, backwards[i].pct, 1e-9)) &&
    forwards.every((r) => near(r.scale, 1, 1e-9));
  return {
    ok,
    detail: `coverage ${pcts.map((p) => p.toFixed(1)).join(" / ")}% forwards, ` +
      `${backwards.map((r) => r.pct.toFixed(1)).join(" / ")}% reversed`,
  };
}

/** ...and the instrument must refuse a scene it has already moved. */
function refusesAReusedScene(THREE) {
  const source = unitCubeSource(THREE);
  const scene = source.next();
  const draw = { id: "A", pos: [0, 0, 0], size: [1, 1, 1], yaw: 0, fit: "PROP" };
  placeInto(THREE, scene, draw, source.natural);
  try {
    placeInto(THREE, scene, { ...draw, pos: [5, 0, 5] }, source.natural);
  } catch (error) {
    return { ok: true, detail: `second placement rejected: ${String(error.message).slice(0, 48)}...` };
  }
  return { ok: false, detail: "a scene was placed twice without complaint" };
}

// ---------------------------------------------------------------------------
// 2. a known-good case passes and a known-bad case fails
// ---------------------------------------------------------------------------

/**
 * A tool that passes everything is indistinguishable from a broken tool.
 *
 * Good: a 1m cube in a 1m box. Scale 1, no shortfall, its whole top at the
 * height the player lands on.
 * Bad: the same cube in a 3 x 1 x 1 box. A contain-fit takes the smallest ratio,
 * so it draws 1m of a 3m collision and two thirds of the landing is air. Both
 * gates this file shares with the verifier have to catch it.
 */
function knownGoodAndKnownBad(THREE) {
  const source = unitCubeSource(THREE);
  const at = (size) => {
    const draw = { id: "T", pos: [0, 4, 0], size, yaw: 0, fit: "PROP" };
    const placed = placeInto(THREE, source.next(), draw, source.natural);
    const want = [size[0], size[1], size[2]];
    const drawn = [placed.drawn.x, placed.drawn.y, placed.drawn.z];
    const rect = { minX: -size[0] / 2, maxX: size[0] / 2, minZ: -size[2] / 2, maxZ: size[2] / 2 };
    const survey = surveyFirstHit(THREE, placed.targets, asPart(rect), 4 + size[1]);
    const findings = [];
    shortfallOf(want, drawn).forEach((value, axis) => {
      if (value > FOOTPRINT_TOL) findings.push(`short ${value.toFixed(2)}m on axis ${axis}`);
    });
    if (survey.pct < MASS_TOP_MIN_PCT) findings.push(`top ${survey.pct.toFixed(1)}%`);
    return { findings, pct: survey.pct };
  };

  const good = at([1, 1, 1]);
  const bad = at([3, 1, 1]);
  return {
    ok: good.findings.length === 0 && bad.findings.length >= 2 && bad.pct < 40,
    detail:
      `good: ${good.findings.length} findings at ${good.pct.toFixed(1)}% top; ` +
      `bad: ${bad.findings.length} findings at ${bad.pct.toFixed(1)}% top ` +
      `(${bad.findings.join(", ") || "none"})`,
  };
}

/** A deck gate that never fires is the same failure at the other threshold. */
function deckGateFires() {
  return {
    ok: DECK_MIN_PCT > MASS_TOP_MIN_PCT && DECK_MIN_PCT <= 100,
    detail: `deck gate ${DECK_MIN_PCT}% is stricter than the mass-top gate ${MASS_TOP_MIN_PCT}%`,
  };
}

// ---------------------------------------------------------------------------
// 3. a transform round-trips
// ---------------------------------------------------------------------------

/**
 * A yawed placement and its manually pre-rotated equivalent must measure the
 * same, and a yawed placement must NOT measure the same as an unyawed one.
 *
 * This is defect 2 from both sides. The round trip proves the footprint follows
 * the yaw; the transposition case proves it is actually applied — a 4 x 1 module
 * box turned a quarter onto a 1 x 4 blocker covers all of it, and reading
 * `size[0]` as a world X extent covers a quarter.
 */
function yawRoundTrips() {
  const part = { rect: { minX: -0.5, maxX: 0.5, minZ: -2, maxZ: 2 }, kind: "MASS" };
  const turned = { pos: [0, 0, 0], size: [4, 1, 1], yaw: Math.PI / 2, fit: "MODULE" };
  const flat = { ...turned, yaw: 0 };

  const withYaw = coveredFraction(partFootprint(part), [placementFootprint(turned)]);
  const withoutYaw = coveredFraction(partFootprint(part), [placementFootprint(flat)]);

  // The same question asked in a frame where the yaw is already gone: rotate the
  // part by -yaw about the shared centre and drop the yaw from the box.
  const spun = (points, yaw) => points.map(([x, z]) => rotateXZ(x, z, -yaw));
  let roundTripOk = true;
  let worstDelta = 0;
  for (const yaw of [Math.PI / 2, 0.7, -1.9, Math.PI]) {
    const placement = { pos: [7, 0, -4], size: [4, 1, 1.4], yaw, fit: "MODULE" };
    const shifted = {
      rect: { minX: 7 - 0.7, maxX: 7 + 0.7, minZ: -4 - 2, maxZ: -4 + 2 },
      kind: "MASS",
    };
    const direct = coveredFraction(partFootprint(shifted), [placementFootprint(placement)]);
    const preRotated = coveredFraction(
      spun(partFootprint(shifted).map(([x, z]) => [x - 7, z + 4]), yaw),
      [
        orientedCorners({
          cx: 0,
          cz: 0,
          halfX: placement.size[0] / 2,
          halfZ: placement.size[2] / 2,
          yaw: 0,
        }),
      ],
    );
    worstDelta = Math.max(worstDelta, Math.abs(direct - preRotated));
    if (!near(direct, preRotated, 1e-9)) roundTripOk = false;
  }

  return {
    ok:
      roundTripOk &&
      near(withYaw, 1, 1e-12) &&
      near(withoutYaw, 0.25, 1e-12) &&
      // and the FIT is in local space, so it does not move with the yaw at all
      near(containFitScale([2, 1, 1], [4, 1, 1]), containFitScale([2, 1, 1], [4, 1, 1])),
    detail:
      `turned box covers ${(withYaw * 100).toFixed(1)}% of its blocker, ` +
      `unturned ${(withoutYaw * 100).toFixed(1)}%; round-trip delta ${worstDelta.toExponential(1)}`,
  };
}

/** A shell fills its box whichever way it turned to face the room. */
function shellTurnKeepsItsBox(THREE) {
  const natural = [1.9, 1.9, 0.23];
  const size = [0.5, 1.6, 4.4];
  const fit = shellFit(natural, size);
  const source = unitCubeSource(THREE, natural);
  const placed = placeInto(
    THREE,
    source.next(),
    { id: "S", pos: [0, 0, 0], size, yaw: 0, fit: "SHELL" },
    natural,
  );
  const drawn = [placed.drawn.x, placed.drawn.y, placed.drawn.z];
  return {
    ok:
      fit.turn === true &&
      drawn.every((value, axis) => near(value, size[axis], 1e-6)),
    detail:
      `turned=${fit.turn}, draws ${drawn.map((v) => v.toFixed(2)).join(" x ")} ` +
      `into ${size.join(" x ")}`,
  };
}

/** Exact clipping, so an exact fit reads exactly complete. */
function exactFitReadsComplete() {
  const part = { rect: { minX: 41.6, maxX: 42.2, minZ: 20.8, maxZ: 21.8 }, kind: "MASS" };
  const placement = { pos: [41.9, 0, 21.3], size: [0.6, 3.4, 1], yaw: 0, fit: "MODULE" };
  const fraction = coveredFraction(partFootprint(part), [placementFootprint(placement)]);
  const reach = reachBeyond(partFootprint(part), [placementFootprint(placement)]);
  // Two tiles of one run must sum to the run, not to half of it.
  const blocker = { rect: { minX: 0, maxX: 10, minZ: 0, maxZ: 1 }, kind: "MASS" };
  const tiles = [
    { pos: [2.5, 0, 0.5], size: [5, 1, 1], yaw: 0, fit: "MODULE" },
    { pos: [7.5, 0, 0.5], size: [5, 1, 1], yaw: 0, fit: "MODULE" },
  ].map(placementFootprint);
  const tiled = coveredFraction(partFootprint(blocker), tiles);
  const tiledReach = reachBeyond(partFootprint(blocker), tiles);
  return {
    ok:
      near(fraction, 1, 1e-12) &&
      near(reach, 0, 1e-12) &&
      near(tiled, 1, 1e-12) &&
      near(tiledReach, 0, 1e-12),
    detail:
      `exact box ${(fraction * 100).toFixed(4)}% reach ${reach.toFixed(4)}m; ` +
      `two-tile run ${(tiled * 100).toFixed(4)}% reach ${tiledReach.toFixed(4)}m`,
  };
}

// ---------------------------------------------------------------------------
// 4. a thing cannot be its own support
// ---------------------------------------------------------------------------

/**
 * Defect 3. A chimney standing at 12.40m is not evidence that anything holds a
 * chimney up at 12.40m; the roof under it is. A SIBLING in the same cluster still
 * counts, because the steeple's gallery really does carry its own lantern, and
 * the same draw at a different height counts too — a tower rising out of a roof
 * is drawn once and carries the roof deck it pierces.
 */
function nothingSupportsItself() {
  const own = { id: "CHIMNEY_1", parts: ["CHIMNEY_1"], pos: [68.15, 12.4, 6.15] };
  const sibling = { id: "STEEPLE", parts: ["STEEPLE_GALLERY"], pos: [80, 15.8, 9] };
  const elsewhere = { id: "TOWNHOUSE", parts: ["CHIMNEY_1"], pos: [60, 0, 4.2] };
  return {
    ok:
      supportsFrom(own, "CHIMNEY_1", 12.4) === false &&
      supportsFrom(sibling, "STEEPLE_LANTERN", 15.8) === true &&
      supportsFrom(elsewhere, "CHIMNEY_1", 12.4) === true,
    detail: "own draw at the plane rejected; sibling and same-draw-elsewhere accepted",
  };
}

// ---------------------------------------------------------------------------
// 5. the probe asks about the surface the route is on
// ---------------------------------------------------------------------------

/**
 * Defect 4. Where the route stands ON a mass the question is its TOP; where a
 * mass is merely raised the question is its base; a deck has one height.
 */
function probesTheRightPlane() {
  const mass = { kind: "MASS", baseY: 12.4, topY: 13.45 };
  const deck = { kind: "DECK", baseY: 5.2, topY: 5.2 };
  return {
    ok:
      supportPlane(mass, true) === 13.45 &&
      supportPlane(mass, false) === 12.4 &&
      supportPlane(deck, true) === 5.2 &&
      supportPlane(deck, false) === 5.2,
    detail: "route-bearing mass probed at its top, a raised one at its base",
  };
}

// ---------------------------------------------------------------------------
// 6. a seam is not a hole
// ---------------------------------------------------------------------------

/**
 * Defect 5. A surface drawn continuously across a seam must read 100%, and a
 * surface that is genuinely not there must still read as missing.
 *
 * Both halves matter, and the second one more. The cure for the seam is a 1mm
 * sideways retry, and a nudge is exactly the kind of fudge that quietly grows
 * into "make everything pass" — so this states the limit as well as the fix.
 *
 * The fixture is the real geometry's arithmetic, not a drawing of it. Two
 * MODULE tiles of one source, abutting at x = 12.5, over a part whose middle
 * sample column falls exactly there: this is `rowPlacements` dividing a block
 * into an even number of houses while the grid divides the same block inflated
 * by its jetty. Two axis-aligned boxes butted together in world space do NOT
 * reproduce it — the ray hits both — because the crack is not in the world
 * bounds, which meet at 12.5 to the last bit. It is in each tile's own local
 * frame, where the inverse transform puts the ray a fraction of a ULP outside
 * the boundary triangle on both sides at once. Building the tiles through
 * `placeInto` from a natural size that is not a round number is what puts that
 * crack back, and it is why this fixture is worth its length.
 *
 *   continuous  both tiles, roof unbroken across the seam       -> 100%
 *   straight    the same, cast once with no retry               -> 80%, and if
 *               this ever reads 100% the fixture has stopped
 *               reproducing the defect and proves nothing
 *   gap         the right tile removed, so half of it is air    -> well under
 *               the support gate, because a nudge cannot invent a surface
 *   low         both tiles present but 2m below the plane       -> 0%, because
 *               the retried ray must also land AT the plane
 */
function aSeamIsNotAHole(THREE) {
  // Not round on purpose: a Meshy export normalises to roughly two units on its
  // longest axis, and it is the resulting non-exact fill scale that cracks.
  const natural = [1.10028791427612305, 1.89931738376617432, 1.2762901782989502];
  const source = unitCubeSource(THREE, natural);
  const plane = 5.6;
  const tile = (x, y = 0) => ({ id: `T${x}`, pos: [x, y, 5.2], size: [3.5, 5.6, 4], yaw: 0, fit: "MODULE" });
  const draw = (tiles) =>
    tiles.flatMap((t) => placeInto(THREE, source.next(), t, natural).targets);

  // The middle of five columns over 10..15 is x = 12.5, the tiles' shared edge.
  const part = asPart({ minX: 10, maxX: 15, minZ: 4, maxZ: 6.4 }, { kind: "DECK" });
  const survey = (targets, at = plane) =>
    surveyNearPlane(THREE, targets, part, at, { grid: 5, tol: 0.35 });

  const both = draw([tile(10.75), tile(14.25)]);
  const continuous = survey(both);

  // The same question with no retry at all, so the fixture has to demonstrate
  // that it still reproduces what the retry is for.
  const raycaster = new THREE.Raycaster();
  raycaster.far = 120;
  const down = new THREE.Vector3(0, -1, 0);
  let straight = 0;
  for (const [x, z] of footprintSamples(part, 5)) {
    raycaster.set(new THREE.Vector3(x, plane + 3, z), down);
    if (raycaster.intersectObjects(both, false).some((h) => Math.abs(h.point.y - plane) < 0.35)) {
      straight++;
    }
  }

  const gap = survey(draw([tile(10.75)]));
  const low = survey(draw([tile(10.75, -2), tile(14.25, -2)]));

  return {
    ok:
      continuous.fraction === 1 &&
      continuous.nudged > 0 &&
      straight < continuous.hit &&
      gap.fraction < 0.9 &&
      low.fraction === 0,
    detail:
      `continuous ${(continuous.fraction * 100).toFixed(0)}% (${continuous.nudged} of ` +
      `${continuous.total} rescued by ${(EDGE_NUDGE_M * 1000).toFixed(0)}mm), ` +
      `no retry ${((straight / continuous.total) * 100).toFixed(0)}%; ` +
      `half-absent ${(gap.fraction * 100).toFixed(0)}%, 2m low ${(low.fraction * 100).toFixed(0)}%`,
  };
}

/** Degenerate inputs must not read as complete coverage. */
function degenerateOverlapReadsZero() {
  const apart = coveredFraction(
    partFootprint({ rect: { minX: 0, maxX: 1, minZ: 0, maxZ: 1 }, kind: "MASS" }),
    [placementFootprint({ pos: [50, 0, 50], size: [1, 1, 1], yaw: 0 })],
  );
  const empty = polygonArea(
    clipConvex(
      orientedCorners({ cx: 0, cz: 0, halfX: 1, halfZ: 1 }),
      orientedCorners({ cx: 9, cz: 9, halfX: 1, halfZ: 1 }),
    ),
  );
  return {
    ok: apart === 0 && empty === 0,
    detail: `disjoint boxes read ${(apart * 100).toFixed(1)}% covered`,
  };
}

// ---------------------------------------------------------------------------

/**
 * Every invariant, with the historical defect each one answers.
 *
 * Returns rows rather than throwing so a verifier can print all of what is
 * broken instead of only the first thing.
 */
export function runSelfTests({ THREE }) {
  const cases = [
    ["identical draws of one asset agree", "1 reused scene", () => identicalDrawsAgree(THREE)],
    ["a placed scene cannot be placed again", "1 reused scene", () => refusesAReusedScene(THREE)],
    ["a known-good case passes, a known-bad case fails", "the tool that passes everything", () => knownGoodAndKnownBad(THREE)],
    ["the deck gate is stricter than the mass gate", "the tool that passes everything", () => deckGateFires()],
    ["a yawed placement round-trips", "2 transposed yaw", () => yawRoundTrips()],
    ["a turned shell still fills its box", "2 transposed yaw", () => shellTurnKeepsItsBox(THREE)],
    ["an exact fit and an exact run read complete", "2 transposed yaw", () => exactFitReadsComplete()],
    ["nothing counts as its own support", "3 self-support", () => nothingSupportsItself()],
    ["the probe plane follows the route", "4 wrong probe height", () => probesTheRightPlane()],
    ["a seam reads solid and a hole does not", "5 lost edge retry", () => aSeamIsNotAHole(THREE)],
    ["disjoint footprints read zero", "the tool that passes everything", () => degenerateOverlapReadsZero()],
  ];
  return cases.map(([name, catches, run]) => {
    try {
      const { ok, detail } = run();
      return { name, catches, ok, detail };
    } catch (error) {
      return { name, catches, ok: false, detail: `threw: ${String(error.message ?? error)}` };
    }
  });
}

/**
 * Run the invariants and print them; return false if any failed.
 *
 * A verifier that calls this and then measures anyway is back where it started,
 * so both of them exit here instead.
 */
export function selfTestGate({ THREE, label, verbose = false }) {
  const rows = runSelfTests({ THREE });
  const bad = rows.filter((row) => !row.ok);
  if (verbose || bad.length) {
    console.log(`--- ${label}: instrument self-test ---`);
    for (const row of rows) {
      if (!verbose && row.ok) continue;
      console.log(`  ${row.ok ? "ok  " : "FAIL"} ${row.name.padEnd(48)} ${row.detail}`);
    }
  }
  if (bad.length) {
    console.error(
      `\nSELF-TEST FAILED: ${bad.length} of ${rows.length} invariants broken. Nothing below ` +
        `this line can be trusted, so nothing below this line was measured.`,
    );
    return false;
  }
  console.log(`self-test ok: ${rows.length} invariants hold`);
  return true;
}
