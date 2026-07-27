import assert from "node:assert/strict";
import test from "node:test";
import { M1_EFFIGY_RUN, lightLevelAt } from "@pa/mission-m1";
import {
  AMBIENT_LIGHT,
  LANTERN_POOL,
  M1_LANTERNS,
  NIGHT_WALL_RADIANCE,
  authoredLightAt,
  flamePoint,
  lanternContribution,
  spilledLanternContribution,
} from "../src/chapter/m1LanternPlan.js";
import { dawnSky } from "../src/mission/dawn.js";

// ---------------------------------------------------------------------------
// The lantern rig's promises, as tests.
//
// The rig exists because M1's stealth field scored the city off eleven authored
// light rectangles that the renderer had never drawn. Two things can go wrong
// with fixing that and both of them look fine on screen: a lamp can end up
// somewhere the field calls dark, which lies to the player at the moment they
// are choosing whether to cross; or the lamps can multiply until the whole
// street is lit, which buys visibility by deleting the choice. Neither is
// visible in a screenshot. Both are visible here.
// ---------------------------------------------------------------------------

/** Every place on the route a player can stand, for reach and coverage tests. */
const ROUTE_POINTS = M1_EFFIGY_RUN.nodes.map(
  (node) => [node.pos[0], node.pos[1], node.pos[2]] as const,
);

test("every lamp that lights anything stands in light the field already grants", () => {
  // 0.34 is the level's pre-dawn ambient — what `lightLevelAt` returns for a
  // point inside no authored volume. A lamp illuminating below that would be
  // putting light on the player that the simulation has not been told about,
  // which is the same disagreement between screen and field that this whole rig
  // exists to close, running the other way.
  //
  // A `glowOnly` lamp is exempt because it illuminates nothing: it is a visible
  // flame and no point light, so it can answer "which way does this shed run"
  // without touching "can I be seen".
  for (const lantern of M1_LANTERNS) {
    if (lantern.glowOnly) {
      assert.equal(
        lanternContribution(lantern, lantern.pos),
        0,
        `${lantern.id} is glowOnly but is still lighting its own feet`,
      );
      continue;
    }
    const authored = authoredLightAt(lantern);
    assert.ok(
      authored >= AMBIENT_LIGHT,
      `${lantern.id} stands at authored light ${authored}, below the ${AMBIENT_LIGHT} ambient: ` +
        `the player would see a lamp where the field scores darkness`,
    );
  }
});

test("the dark volumes the route is built around have no lamp in them", () => {
  // These five are the mission's stealth tools. The Dassett alley is the careful
  // descent, the Dock arcade is the quiet crossing, the Town House lane is why
  // the scaffolding is the fast way up, and the ropewalk is the one place the
  // level says standing still is safer than moving. A lamp inside any of them
  // would not merely brighten a corner, it would remove a route.
  const dark = ["LIGHT_DASSETT_ALLEY", "LIGHT_DOCK_ARCADE", "LIGHT_TOWNHOUSE_LANE", "LIGHT_DOCK_NW"];
  for (const id of dark) {
    const volume = M1_EFFIGY_RUN.light.find((candidate) => candidate.id === id);
    assert.ok(volume, `${id} has gone from the level`);
    for (const lantern of M1_LANTERNS) {
      const [x, , z] = lantern.pos;
      const inside =
        x >= volume.rect.minX &&
        x <= volume.rect.maxX &&
        z >= volume.rect.minZ &&
        z <= volume.rect.maxZ;
      assert.ok(!inside, `${lantern.id} is inside ${id}, which the level authors at ${volume.level}`);
    }
  }
});

test("only the ropewalk's two authored lit patches actually light it", () => {
  // The interior is authored at 0.10 across twenty-two metres with two
  // exceptions: the door at 0.70 and the night man's lantern at 0.55. Anything
  // else inside the shed must be a flame that lights nothing, or the darkest
  // place in the mission stops being dark.
  const inside = M1_LANTERNS.filter(
    (lantern) =>
      lantern.pos[0] >= 58 && lantern.pos[0] <= 80 && lantern.pos[2] >= 16 && lantern.pos[2] <= 27,
  );
  assert.equal(inside.length, 4, "one door lamp, the night man's, and two marker flames");
  const lighting = inside.filter((lantern) => !lantern.glowOnly).map((lantern) => lantern.id);
  assert.deepEqual(lighting.sort(), ["LAMP_ROPE_DOOR", "LAMP_ROPE_NIGHTMAN"]);
});

test("the walked quiet line through the ropewalk is still unlit", () => {
  // The section's whole choice is a loud descent beside the night man against a
  // quiet one west along the tie beam and down the hemp. Adding
  // LIGHT_ROPEWALK_NIGHTMAN was allowed to cost the loud line and was not
  // allowed to touch the quiet one.
  const quiet = ["D2_BEAM_W", "D2_BALES_HIGH", "D2_BALES_LOW", "D2_FLOOR_W", "D2_VAULT_IN"];
  for (const id of quiet) {
    const node = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === id);
    assert.ok(node, `route node ${id} has gone`);
    const level = lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, node.pos[0], node.pos[2]);
    assert.ok(level <= 0.1, `${id} is now at authored light ${level}; the quiet line must stay dark`);
  }

  // And the loud one does cost, which is the point of having added it.
  const loud = M1_EFFIGY_RUN.nodes.find((candidate) => candidate.id === "D2_FLOOR_MID");
  assert.ok(loud);
  assert.ok(
    lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, loud.pos[0], loud.pos[2]) > 0.4,
    "the loud landing is meant to be in the night man's lamplight",
  );
});

test("the fixed pool spills nothing anywhere on the route", () => {
  // Thirty lamps against eleven slots, and the point of having measured rather
  // than guessed is that eleven turns out to be exactly enough: nowhere a player
  // can stand is there a twelfth lamp still contributing anything at all. If a
  // lamp is ever added into the crush where the Shambles meets Dock Square this
  // is the test that will say so, in the units that matter — a share of the
  // night's own ambient rather than a count.
  const { worst } = spilledLanternContribution(ROUTE_POINTS);
  const share = worst / NIGHT_WALL_RADIANCE;
  assert.equal(
    worst,
    0,
    `a lamp worth ${(share * 100).toFixed(1)}% of the night's ambient is being dropped somewhere on ` +
      `the route — give the pool another slot, or thin the lamps where they crowd`,
  );
});

test("a smaller pool would have been visibly wrong", () => {
  // Guarding the reasoning, not just the result: if the lamps are ever thinned
  // enough that nine slots would do, the eleven should come down with them.
  const { worst } = spilledLanternContribution(ROUTE_POINTS, LANTERN_POOL - 2);
  assert.ok(
    worst / NIGHT_WALL_RADIANCE > 0.05,
    "two fewer slots now costs nothing measurable; the pool is larger than the lamps need",
  );
});

test("a lamp is worth several times the dark up close and nothing at range", () => {
  // The shape of the whole design, as two numbers. A pool that did not clear the
  // ambient by a good margin would not read as light; one that still cleared it
  // at fifteen metres would have lit the street rather than a patch of it, and
  // the player would have nowhere to step out of.
  const bracket = M1_LANTERNS.find((lantern) => lantern.id === "LAMP_SHAM_2");
  assert.ok(bracket);
  const under = lanternContribution(bracket, [
    bracket.pos[0],
    1.2,
    bracket.pos[2] + 2,
  ]);
  const away = lanternContribution(bracket, [
    bracket.pos[0],
    1.2,
    bracket.pos[2] + 13,
  ]);
  assert.ok(
    under > NIGHT_WALL_RADIANCE * 3,
    `standing under a lamp should be worth several times the dark, not ${(under / NIGHT_WALL_RADIANCE).toFixed(1)}x`,
  );
  assert.ok(
    away < NIGHT_WALL_RADIANCE * 0.15,
    "thirteen metres from a street lamp must be back in the dark",
  );
});

test("the lit stretches of the route actually have a lamp near them", () => {
  // The other half of the promise. A rig that placed no lamp on a street the
  // field scores at 0.7 would leave the same problem the owner reported: the
  // simulation says you are standing in the light and the screen says you are
  // standing in nothing.
  const lit = M1_EFFIGY_RUN.nodes.filter(
    (node) => lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, node.pos[0], node.pos[2]) >= 0.5,
  );
  assert.ok(lit.length > 12, "expected the level to author a good deal of lit route");
  for (const node of lit) {
    const nearest = Math.min(
      ...M1_LANTERNS.map((lantern) => {
        const flame = flamePoint(lantern);
        return Math.hypot(flame[0] - node.pos[0], flame[2] - node.pos[2]);
      }),
    );
    assert.ok(
      nearest <= 14,
      `${node.id} is authored as lit but its nearest flame is ${nearest.toFixed(1)}m away`,
    );
  }
});

test("the lamps go out as the sky comes up", () => {
  // The dawn clock is expressed as light, so the lamps have to be part of the
  // same statement: at full dark they are the whole of the local contrast, and
  // by sun-up they are worth nothing and the player can see that the town has
  // stopped helping them hide.
  assert.equal(dawnSky(0).lanternGain, 1);
  assert.equal(dawnSky(1).lanternGain, 0);
  let previous = Infinity;
  for (let lift = 0; lift <= 1.00001; lift += 0.05) {
    const gain = dawnSky(Math.min(lift, 1)).lanternGain;
    assert.ok(gain <= previous + 1e-9, `lantern gain rose at lift ${lift}`);
    previous = gain;
  }
  // Faster than the sky, because a lamp stops being visible long before it
  // stops being lit.
  assert.ok(dawnSky(0.55).lanternGain < 0.5, "half the night gone should cost most of the lamplight");
});

test("the night is dark enough to be worth leaving", () => {
  // The rig raised the whole ladder by roughly an order of magnitude to clear
  // three's ACES black clip. This is the guard against having gone further and
  // simply turned the lights on: full dark must still be a small fraction of
  // sun-up, or the dawn clock has nothing left to express.
  const night = dawnSky(0);
  const day = dawnSky(1);
  assert.ok(night.ambient < day.ambient * 0.45, "full dark must stay well under half of daylight");
  assert.ok(night.sunIntensity < day.sunIntensity * 0.1, "the moon is not a sun");
  assert.ok(night.fogDensity > day.fogDensity, "fog burns off as the light comes");
});
