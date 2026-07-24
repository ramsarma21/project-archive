import test from "node:test";
import assert from "node:assert/strict";
import type { ChapterMapData } from "../chapterWorld.js";
import {
  approximateMapPosition,
  compassBearing,
  projectMapPoint,
} from "../RunnerMap.js";

const map: ChapterMapData = {
  title: "Test map",
  subtitle: "Not a survey",
  bounds: { minX: -100, maxX: 100, minZ: -50, maxZ: 50 },
  landmarks: [],
  routes: [],
  objectiveAnchors: {},
};

test("map projection clamps chapter coordinates into paper space", () => {
  assert.deepEqual(projectMapPoint(map, [-100, -50]), [0, 1]);
  assert.deepEqual(projectMapPoint(map, [100, 50]), [1, 0]);
  assert.deepEqual(projectMapPoint(map, [0, 0]), [0.5, 0.5]);
  assert.deepEqual(projectMapPoint(map, [999, -999]), [1, 1]);
});

test("runner position is deliberately approximate", () => {
  assert.deepEqual(approximateMapPosition([11.2, -13.1]), [8, -16]);
});

test("compass resolves objective direction without GPS distance", () => {
  assert.equal(compassBearing([0, 0], [0, -10]).cardinal, "N");
  assert.equal(compassBearing([0, 0], [10, 0]).cardinal, "E");
});
