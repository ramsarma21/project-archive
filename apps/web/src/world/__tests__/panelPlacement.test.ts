import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EXCHANGE_PANEL_MARGINS,
  clampPanelPoint,
} from "../panelPlacement.js";

// Feel-audit-1 P0-2 regression: a world-anchored interrupt panel projected
// above the viewport (button rect y = -58 at 1440x900) with input locked.
// Every projected point must clamp into the safe viewport area.

const W = 1440;
const H = 900;

test("the audited off-screen sign projection clamps into view", () => {
  // Standing under the hanging sign projected the panel far above the top.
  const [x, y] = clampPanelPoint(720, -58, W, H);
  assert.equal(x, 720);
  assert.equal(y, EXCHANGE_PANEL_MARGINS.top);
  assert.ok(y >= 0 && y <= H);
});

test("clamps every edge with button-safe bottom margin", () => {
  assert.deepEqual(clampPanelPoint(-500, 450, W, H), [EXCHANGE_PANEL_MARGINS.left, 450]);
  assert.deepEqual(clampPanelPoint(5000, 450, W, H), [W - EXCHANGE_PANEL_MARGINS.right, 450]);
  assert.deepEqual(clampPanelPoint(720, 5000, W, H), [720, H - EXCHANGE_PANEL_MARGINS.bottom]);
  const [, top] = clampPanelPoint(720, -9999, W, H);
  assert.equal(top, EXCHANGE_PANEL_MARGINS.top);
});

test("in-view points pass through unchanged", () => {
  assert.deepEqual(clampPanelPoint(700, 500, W, H), [700, 500]);
});

test("degenerate viewports fall back to centre", () => {
  assert.deepEqual(clampPanelPoint(10, 10, 300, 200), [150, 100]);
});
