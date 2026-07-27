import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIELD_DT, FIELD_TICK_HZ } from "@pa/engine-world";
import { precisionBeatSpec } from "@pa/mission-m1";
import { M1_MISSION_ID, m1Instance } from "../src/chapter/m1Mission.js";
import { initialMissionSession, reduceMission } from "../src/mission/session.js";
import {
  createMissionRuntime,
  missionPresentation,
  stepMissionRuntime,
} from "../src/mission/traversal.js";
import { buildVisorPlan, planarRange } from "../src/visor/visorPlan.js";
import { LINE_REACH_M, NEAR_FIELD_M } from "../src/visor/visorPalette.js";
import { m1VisorSource } from "../src/visor/m1VisorSource.js";
import { visorHoldsBriefing } from "../src/visor/visorRegistry.js";
import {
  TEST_MISSION,
  testCompletion,
  testEnv,
  testInstance,
} from "./missionHarness.js";

// ---------------------------------------------------------------------------
// The held moment, where it meets the container.
//
// Two things here are load-bearing enough to be worth a test each, and both are
// claims the visor makes in words on the screen.
//
// "THE CLOCK STARTS WHEN YOU DO" is printed on the release button. It is true
// because of an ORDERING — nothing exists to tick until the release transitions
// the session into TRAVERSAL — and an ordering is exactly the kind of property
// that survives a refactor by luck rather than by design. A hold that quietly
// began the mission clock would cost a first-time player a minute of their three
// for reading the briefing they were told to read, and nothing on screen would
// look wrong.
//
// The other is the CULL. The visor is one pass at legibility over a street that
// is silhouettes and fog at full dark, and its first version drew every authored
// link with both ends inside 26m — 32 segments of M1, crossing. The bound is a
// design decision, so it is asserted rather than left to whoever next looks at a
// screenshot.
// ---------------------------------------------------------------------------

function m1() {
  return m1Instance({
    missionId: M1_MISSION_ID,
    attemptOrdinal: 1,
    seed: 0xb057,
    Scenery: null,
  });
}

function m1Plan() {
  const instance = m1();
  return buildVisorPlan({
    source: m1VisorSource(),
    spawn: [instance.spawn.pos.x, instance.spawn.pos.y, instance.spawn.pos.z],
    facingYaw: instance.spawn.yaw,
    watchers: instance.watcherPosesAtTick(0, 0xb057),
    objectives: instance.objectives
      .filter((objective) => objective.required)
      .map((objective) => objective.label),
    lineNotes: [
      { line: "SAFE", promise: "Always goes." },
      { line: "FAST", promise: "Shorter." },
      { line: "EXPERT", promise: "The ceiling." },
    ],
  });
}

// ---- the policy -----------------------------------------------------------

test("only the first attempt is held, and the policy lives in one place", () => {
  assert.equal(visorHoldsBriefing(1), true);
  assert.equal(visorHoldsBriefing(2), false, "a retry is not shown a map of it");
  assert.equal(visorHoldsBriefing(3), false);
});

test("the container's import of the visor is what registers M1's briefing", () => {
  // Asserted against the source rather than by importing it, because importing
  // the visor's surface pulls in a component and a stylesheet and this suite has
  // no DOM. The property is a property of the IMPORT GRAPH: the container mounts
  // `VisorHold` from the visor's index, and that index registers M1 for effect at
  // module scope. Break either half and there is no error anywhere — the registry
  // fails open by design, so an unregistered mission simply runs with no
  // briefing, which is exactly how a built tutorial comes to be mounted nowhere.
  const run = readFileSync(
    new URL("../src/mission/MissionRun.tsx", import.meta.url),
    "utf8",
  );
  const surface = readFileSync(
    new URL("../src/visor/index.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    run,
    /from "\.\.\/visor\/index\.js"/,
    "the container must reach the visor through its index, which is what registers a source",
  );
  assert.match(run, /visorHoldsBriefing\(/, "and must ask whether this attempt is held");
  assert.match(
    surface,
    /registerVisorSource\(\s*M1_MISSION_ID/,
    "and the index must register M1 at import time",
  );
});

// ---- the clock contract ---------------------------------------------------

test("the mission clock starts at the release, not at the load", () => {
  const loadedAt = "2026-07-26T04:00:00.000Z";
  // Forty seconds spent standing in the hold, looking around.
  const releasedAt = "2026-07-26T04:00:40.000Z";

  const instance = testInstance({
    briefing: {
      cueId: "CUE.BRIEF",
      headline: "Queen Street, before dawn.",
      lines: ["The sheets on the rack behind you are unstamped."],
      targetSeconds: 10,
    },
  });

  let session = initialMissionSession();
  for (const command of [
    { kind: "REQUEST_DEPLOY", missionId: TEST_MISSION },
    { kind: "MODULE_COMPLETED", completion: testCompletion(1) },
    { kind: "INSTANCE_READY", instance },
  ] as const) {
    const step = reduceMission(session, command, testEnv({ now: loadedAt }));
    assert.ok(step.ok, `${command.kind} was refused`);
    if (step.ok) session = step.session;
  }

  assert.equal(session.phase.phase, "BRIEFING");
  // Structural, not merely absent: the phase type carries no start instant, so
  // there is nothing for the hold to have started.
  assert.ok(
    !("startedAt" in session.phase),
    "BRIEFING must carry no clock for the hold to be able to start",
  );

  const released = reduceMission(
    session,
    { kind: "BRIEFING_ACKNOWLEDGED" },
    testEnv({ now: releasedAt }),
  );
  assert.ok(released.ok);
  if (!released.ok) return;
  const phase = released.session.phase;
  assert.equal(phase.phase, "TRAVERSAL");
  assert.equal(
    phase.phase === "TRAVERSAL" ? phase.startedAt : null,
    releasedAt,
    "the run's wall clock begins where the player let go of the visor",
  );
});

test("a fresh run reads a full night, and its elapsed seconds are its ticks", () => {
  const runtime = createMissionRuntime({ instance: m1(), seed: 0xb057 });
  const opening = missionPresentation(runtime);

  assert.equal(opening.elapsedS, 0);
  assert.equal(
    opening.dawn.remainingS,
    opening.budgetS,
    "the clock reads full at the release, whatever the hold cost in wall time",
  );
  assert.equal(opening.dawn.lift01, 0, "and none of the dark has been spent");
  assert.equal(opening.dawn.stage, "LAST_DARK");

  // The clock is the tick count and nothing else. Six frames at 60Hz is six
  // ticks, whatever the wall clock did while the hold was up.
  for (let frame = 0; frame < 6; frame += 1) {
    stepMissionRuntime(runtime, {
      dtS: FIELD_DT,
      moveX: 0,
      moveZ: 0,
      sprintHeld: false,
      crouchHeld: false,
      jumpBuffered: false,
      reducedMotion: false,
      flowEnabled: true,
    });
  }
  const after = missionPresentation(runtime);
  assert.equal(after.tick, 6);
  assert.equal(after.elapsedS, 6 * FIELD_DT);
});

// ---- the cull -------------------------------------------------------------

test("the lines drawn are the fork, not the network", () => {
  const plan = m1Plan();
  const segments = plan.paths.reduce(
    (total, path) => total + path.points.length - 1,
    0,
  );

  assert.ok(plan.paths.length > 0, "a mission with a route must draw some of it");
  assert.ok(
    segments <= 12,
    `the hold has one pass to be legible: ${segments} route segments is a diagram, not a briefing`,
  );
  assert.ok(
    plan.paths.length <= 4,
    `${plan.paths.length} separate polylines out of one viewpoint cannot be read as a choice`,
  );
});

test("no drawn line reaches past the near field, however the route is authored", () => {
  const plan = m1Plan();
  const instance = m1();
  const spawn = [
    instance.spawn.pos.x,
    instance.spawn.pos.y,
    instance.spawn.pos.z,
  ] as const;

  for (const path of plan.paths) {
    const head = path.points[0]!;
    assert.ok(
      planarRange(spawn, head) <= LINE_REACH_M + 0.001,
      `${path.id} starts ${planarRange(spawn, head).toFixed(1)}m out, past the reach`,
    );
    for (const point of path.points) {
      assert.ok(
        planarRange(spawn, point) <= NEAR_FIELD_M,
        `${path.id} runs to ${planarRange(spawn, point).toFixed(1)}m — one bad link must not draw a line across the level`,
      );
    }
  }
});

test("the chrome names only the ground the street actually shows", () => {
  const plan = m1Plan();
  assert.deepEqual(
    plan.answers.cover.map((area) => area.label),
    plan.zones.map((zone) => zone.label),
    "a cover sentence with no shape behind it is the visor promising cover it did not draw",
  );
  for (const area of plan.answers.cover) {
    assert.ok(area.detail.length > 0, `${area.label} is named and not explained`);
  }
});

test("the destination is named inside the frame the hold is anchored to", () => {
  const plan = m1Plan();
  const instance = m1();
  // The shaft has to clear the rooflines; the NAME has to be readable from the
  // spawn. A plate at the top of a 34m column eighty metres out is above the
  // frame of a player standing on the leads.
  assert.ok(
    plan.beacon.labelY < plan.beacon.topY,
    "the destination's name must not sit at the top of its own shaft",
  );
  const rise = plan.beacon.labelY - instance.spawn.pos.y;
  const elevationDeg =
    (Math.atan2(rise, plan.beacon.distanceM) * 180) / Math.PI;
  assert.ok(
    elevationDeg > 0 && elevationDeg < 20,
    `the name sits ${elevationDeg.toFixed(1)}° above the player's own footing, which is outside the frame`,
  );
});

// ---------------------------------------------------------------------------
// The harness must not be a different product from the game.
//
// This is written against a real and expensive failure. `floor.html` mounted the
// canvas directly, with no BRIEFING phase and no visor, and because the API has
// been down it is the surface the mission has actually been played on. So the
// one build everybody was judging onboarding by was the one build that had none,
// and "the game never tells you anything" was a true report about a false thing.
//
// A dev harness is allowed to skip the module gate, the attempt ledger and the
// account service. It is not allowed to skip the first thing a player sees.
// ---------------------------------------------------------------------------

test("the floor harness opens on the visor, the way the container does", () => {
  const harness = readFileSync(
    new URL("../src/mission/devEntry.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    harness,
    /<VisorHold\b/,
    "the harness must hold the visor before the run, or it is testing a game nobody ships",
  );
  // And the run must not exist behind it: a runtime built during the hold is a
  // mission clock already counting while the player reads their briefing.
  assert.match(
    harness,
    /held \? null : createMissionRuntime/,
    "the runtime is built on release, so the three minutes cannot start early",
  );
});

// ---------------------------------------------------------------------------
// The stroke count the player is told is the count the runtime judges.
//
// The beat was retuned from a five/six-stroke chart to thirteen judged strokes
// over three rising bars, and two player-facing surfaces kept the old figure:
// the visor briefing said "Six strokes, in rhythm" and the HUD read-line said
// "Six strokes. Off the beat is loud." Both are a lie about the one mechanical
// skill the mission has. The chart is authoritative, so the briefing reads its
// count off `precisionBeatSpec().chart` and the generic HUD carries no count at
// all — the live figure is the kicker's, and the kicker is the runtime's.
// ---------------------------------------------------------------------------

test("the elm briefing derives every figure from the chart, distinguishing total from judged", () => {
  const chart = precisionBeatSpec().chart;
  const bars = chart.phases.reduce((total, phase) => total + phase.bars, 0);
  const durationS = chart.spanTicks / FIELD_TICK_HZ;
  // The retune's own numbers, so a chart edit that did not update the briefing is
  // caught rather than shipped as a confident wrong figure.
  assert.equal(chart.strikes, 14, "fourteen strikes total");
  assert.equal(chart.judgedBeats, 13, "thirteen of them judged; the opening starts the chart");
  assert.notEqual(chart.strikes, chart.judgedBeats, "total and judged are different numbers");

  const detail = m1VisorSource().destination.detail;
  // Behavioural, not a source scan: the copy the function RETURNS must carry the
  // values the chart computes, so a hard-coded string would fail the moment the
  // chart's numbers and the briefing's disagreed.
  assert.match(
    detail,
    new RegExp(`\\b${chart.strikes}\\b`),
    `the briefing must state the ${chart.strikes} strikes total; got "${detail}"`,
  );
  assert.match(
    detail,
    new RegExp(`\\b${chart.judgedBeats}\\b`),
    `and the ${chart.judgedBeats} that are judged; got "${detail}"`,
  );
  assert.match(
    detail,
    new RegExp(`\\b${bars}\\b`),
    `and the ${bars} bars of the phrase; got "${detail}"`,
  );
  assert.match(
    detail,
    new RegExp(durationS.toFixed(1).replace(".", "\\.")),
    `and the ~${durationS.toFixed(1)}s the chart runs; got "${detail}"`,
  );
  // The two words that make the distinction explicit rather than leaving the
  // player to guess which of 14 and 13 is which.
  assert.match(detail, /total/i, `the briefing must name the total explicitly; got "${detail}"`);
  assert.match(detail, /judged/i, `and the judged count explicitly; got "${detail}"`);
  assert.doesNotMatch(
    detail,
    /\bsix\b/i,
    `the briefing still carries the retired six-stroke figure: "${detail}"`,
  );
});

test("the generic beat HUD states no mission-specific stroke count of its own", () => {
  // MissionHud hosts whatever beat a level authors, so a hard-coded count in it
  // is wrong for every mission but the one it was typed for. The live count is
  // the kicker's `struck of struck+remaining`, which is the runtime's; the
  // read-line must not restate a constant that can go stale — as "Six strokes"
  // did after the chart grew to thirteen.
  const hud = readFileSync(
    new URL("../src/mission/MissionHud.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    hud,
    /Six strokes/,
    "the HUD still carries the retired six-stroke read-line",
  );
  assert.match(
    hud,
    /beat\.struck \+ beat\.remaining/,
    "the only stroke count the HUD prints must come from the runtime presentation",
  );
});

test("the container and the harness ask the same question about who gets taught", () => {
  // One policy for "does this attempt teach", asked rather than duplicated.
  const container = readFileSync(
    new URL("../src/mission/MissionRun.tsx", import.meta.url),
    "utf8",
  );
  assert.match(container, /visorHoldsBriefing\(/);
  assert.equal(visorHoldsBriefing(1), true, "a first attempt is held");
  assert.equal(visorHoldsBriefing(2), false, "a retry is not shown the map again");
});
