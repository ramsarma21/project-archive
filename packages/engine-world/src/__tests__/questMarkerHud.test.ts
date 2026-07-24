import test from "node:test";
import assert from "node:assert/strict";
import { relativeBearingLabel } from "../QuestMarkerHud.js";

test("persistent target bearing uses stable camera-relative sectors", () => {
  assert.equal(relativeBearingLabel(0), "AHEAD");
  assert.equal(relativeBearingLabel(Math.PI / 4), "FRONT RIGHT");
  assert.equal(relativeBearingLabel(Math.PI / 2), "RIGHT");
  assert.equal(relativeBearingLabel((Math.PI * 3) / 4), "BACK RIGHT");
  assert.equal(relativeBearingLabel(Math.PI), "BEHIND");
  assert.equal(relativeBearingLabel(-Math.PI / 4), "FRONT LEFT");
  assert.equal(relativeBearingLabel(-Math.PI / 2), "LEFT");
  assert.equal(relativeBearingLabel((-Math.PI * 3) / 4), "BACK LEFT");
  assert.equal(relativeBearingLabel(Math.PI * 2), "AHEAD");
});
