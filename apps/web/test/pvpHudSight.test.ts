import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";
import { PvpHud } from "../src/pvp/PvpHud.js";

// react-test-renderer's `act` expects this flag; without it React logs an act-environment
// error that a strict runner can treat as a failure. Set before any render.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { EMPTY_PROGRESS } from "../src/pvp/progress.js";
import type { PresentedSighting } from "../src/pvp/arenaPort.js";
import type { MatchSnapshot } from "../src/pvp/protocol.js";

// Actor / banner / HUD temporal parity (bug 4).
//
// The drawn body and the in-arena banner both read `ArenaSample.opponent` — the delayed
// presentation sample (proven at the feed level in pvpArena.test.ts). The side-panel
// PvpHud "lost sight" warning must read the SAME presented sighting, threaded up through
// the arena callbacks, rather than the raw newest snapshot. These render the real PvpHud
// (pure DOM, no canvas) and assert its warning follows the presented sighting, with the
// raw flag used only as the telemetry fallback when no sighting is reported.

function snapshot(rawVisible: boolean): MatchSnapshot {
  return {
    matchId: "pvp_HUD_1",
    tick: 120,
    phase: "ENGAGEMENT_LIVE",
    round: 1,
    self: {
      side: "A",
      position: { x: 0, y: 0, z: -6 },
      velocity: { x: 0, y: 0, z: 0 },
      yaw: 0,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 3,
      dashing: false,
      invulnerableUntilTick: 0,
      dodgeReadyAtTick: 0,
      abilityUsesRemaining: {},
    },
    opponent: {
      side: "B",
      handle: "QuietLantern-1234",
      rank: 1,
      position: { x: 0, y: 0, z: 6 },
      velocity: { x: 0, z: 0 },
      aimYaw: 0,
      dashing: false,
      capsuleHeight: 1.55,
      health: 200,
      ammo: 3,
      visible: rawVisible,
      positionAtTick: 120,
      answering: false,
    },
    projectiles: [],
  };
}

function renderHud(rawVisible: boolean, sighting?: PresentedSighting): string {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(PvpHud, {
        snapshot: snapshot(rawVisible),
        progress: EMPTY_PROGRESS,
        ...(sighting ? { sighting } : {}),
      }),
    );
  });
  const json = JSON.stringify(renderer.toJSON());
  act(() => renderer.unmount());
  return json;
}

const WARNING = "lost sight of";

test("the HUD warning follows the PRESENTED sighting, not the raw snapshot", () => {
  // Raw newest already says invisible, but the delayed sample still has them in sight —
  // the body is still drawn in the open, so the warning must NOT show yet.
  assert.ok(
    !renderHud(false, "IN_SIGHT").includes(WARNING),
    "the HUD warned while the presented body was still in sight",
  );
  // Presented last-seen shows the warning, in parity with the body and the banner, even
  // if the raw newest snapshot momentarily still says visible.
  assert.ok(
    renderHud(true, "LAST_SEEN").includes(WARNING),
    "the HUD did not warn on a presented last-seen sighting",
  );
  // An unplaced opponent is also out of sight for the warning's purposes.
  assert.ok(renderHud(true, "UNPLACED").includes(WARNING));
});

test("with no presented sighting the HUD falls back to the raw snapshot flag", () => {
  // Telemetry / unregistered-arena fallback: no reporter, so read the raw flag.
  assert.ok(renderHud(false, undefined).includes(WARNING));
  assert.ok(!renderHud(true, undefined).includes(WARNING));
});
