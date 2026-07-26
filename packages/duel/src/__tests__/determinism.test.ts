// The duel inherits its determinism from engine-world's clock rather than
// re-deriving it. These tests exist to catch the day someone "optimises" the
// reducer into reading a wall clock or a bare Math.random.

import { test } from "node:test";
import assert from "node:assert/strict";
import { referenceArena } from "../arena.js";
import { bossProfileForTier } from "../boss.js";
import { IDLE_INTENT } from "../combat.js";
import {
  FIELD_DT,
  MAX_CATCHUP_STEPS,
  MAX_FRAME_DT_S,
  projectFieldSeed,
} from "../engine.js";
import type { DuelEvent } from "../events.js";
import { createDuel, reduceDuel, type DuelState } from "../machine.js";
import { questionSet, verdictFor } from "./harness.js";

const arena = referenceArena();

function runAtFps(fps: number, rounds = 2): { outcome: unknown; log: DuelEvent[] } {
  const created = createDuel({
    duelId: "FPS",
    seed: projectFieldSeed(["DUEL", "M1", "attempt-1"]),
    world: arena.world,
    opponent: { kind: "BOSS", profile: bossProfileForTier(3) },
    questions: questionSet(rounds),
    rounds,
    placement: arena.placement,
  });
  let state: DuelState = created.state;
  const log: DuelEvent[] = [];
  const dt = 1 / fps;
  for (let index = 0; index < 200_000 && state.phase !== "DUEL_RESOLVED"; index++) {
    if (state.phase === "QUESTION_PENDING") {
      const side = state.awaiting[0]!;
      const result = reduceDuel(state, {
        kind: "COMMIT_VERDICT",
        side,
        verdict: verdictFor("CORRECT", state.item, side, state.round),
      });
      if (!result.ok) throw new Error(result.rejection.code);
      state = result.state;
      log.push(...result.events);
      continue;
    }
    // A constant intent, so the only thing varying between runs is how many fixed
    // steps each frame delivers.
    const result = reduceDuel(state, {
      kind: "ADVANCE",
      frameDtS: dt,
      intents: { A: IDLE_INTENT },
    });
    if (!result.ok) throw new Error(result.rejection.code);
    state = result.state;
    log.push(...result.events);
  }
  if (state.phase !== "DUEL_RESOLVED") throw new Error("did not resolve");
  return { outcome: state.outcome, log };
}

test("30, 60 and 120 fps simulate the identical duel", () => {
  const at30 = runAtFps(30);
  const at60 = runAtFps(60);
  const at120 = runAtFps(120);
  assert.deepEqual(at30.outcome, at60.outcome);
  assert.deepEqual(at120.outcome, at60.outcome);
  assert.deepEqual(at30.log, at60.log);
  assert.deepEqual(at120.log, at60.log);
});

test("a stalled frame cannot flood the simulation", () => {
  // Inherited straight from engine-world's bounded catch-up: a backgrounded tab
  // resuming must not fast-forward a duel.
  const { state } = createDuel({
    duelId: "STALL",
    seed: 5,
    world: arena.world,
    opponent: { kind: "BOSS", profile: bossProfileForTier(1) },
    questions: questionSet(),
    placement: arena.placement,
  });
  const result = reduceDuel(state, { kind: "ADVANCE", frameDtS: 30 });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.state.clock.tick, MAX_CATCHUP_STEPS);
  assert.ok(MAX_FRAME_DT_S > FIELD_DT);
});

test("the duel seeds from engine-world's projection, so attempts differ reproducibly", () => {
  const first = projectFieldSeed(["DUEL", "BOS.M1", "attempt-1"]);
  const second = projectFieldSeed(["DUEL", "BOS.M1", "attempt-2"]);
  assert.notEqual(first, second);
  assert.equal(first, projectFieldSeed(["DUEL", "BOS.M1", "attempt-1"]));
});
