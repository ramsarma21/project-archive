import test from "node:test";
import assert from "node:assert/strict";
import module from "node:module";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { CinePose } from "../src/mission/encounterCinematic.js";
import {
  BOSS_CHALLENGE_BEATS,
  BOSS_CHALLENGE_HARD_CAP_S,
  BOSS_CHALLENGE_TOTAL_S,
  BOSS_STANDOFF_M,
  bossChallengeAt,
  bossBeatAt,
  bossOfficerStaging,
  shouldArmBossChallenge,
} from "../src/mission/bossCutscene.js";
import type { MissionTraversalOutcome } from "../src/mission/result.js";

// The boss-challenge cutscene is the beat the owner asked for at the yard: the
// officer stops the player and calls the reckoning as a duel, then the fight
// opens. These pin the three properties that make it safe — it ARMS exactly once
// on arrival, it ALWAYS TERMINATES, and the exit that OPENS THE DUEL fires — plus
// the anti-teleport staging (the officer is on the player's own surface).

const REACHED: MissionTraversalOutcome = {
  kind: "REACHED_DUEL",
  simulatedS: 42,
  droppedSteps: 0,
  objectiveIds: ["reach-the-yard"],
  detections: 0,
  throwsStruckBody: 0,
};
const FAILED: MissionTraversalOutcome = {
  kind: "FAILED",
  failure: { code: "X", cueId: null, headline: "h", detail: "d" },
  simulatedS: 42,
  droppedSteps: 0,
  objectiveIds: [],
  detections: 0,
  throwsStruckBody: 0,
};

// ---- ARMS ONCE ON YARD ARRIVAL --------------------------------------------

test("boss challenge arms only on REACHED_DUEL, and only once", () => {
  assert.equal(shouldArmBossChallenge(REACHED, false), true);
  // Already armed this attempt: never re-arms (no restaging a shown cutscene).
  assert.equal(shouldArmBossChallenge(REACHED, true), false);
  // A failed traversal has no challenge — it goes to its result.
  assert.equal(shouldArmBossChallenge(FAILED, false), false);
  assert.equal(shouldArmBossChallenge(FAILED, true), false);
});

// ---- ALWAYS TERMINATES ----------------------------------------------------

test("the timeline completes, and the hard cap is a strictly later backstop", () => {
  const player: CinePose = { x: 90, y: 0, z: 0, yaw: 0 };
  // Just before the end it is still running; at and after the end it is done.
  assert.equal(
    bossChallengeAt({ elapsedS: BOSS_CHALLENGE_TOTAL_S - 0.01, player, reducedMotion: false }).done,
    false,
  );
  assert.equal(
    bossChallengeAt({ elapsedS: BOSS_CHALLENGE_TOTAL_S, player, reducedMotion: false }).done,
    true,
  );
  // The independent hard backstop fires later than the scripted completion, so
  // it can only ever be a safety net, never the normal exit.
  assert.ok(BOSS_CHALLENGE_HARD_CAP_S > BOSS_CHALLENGE_TOTAL_S);
});

test("`done` is monotonic across a full sweep — once terminated it stays terminated", () => {
  const player: CinePose = { x: 90, y: 0, z: 0, yaw: 1.2 };
  let sawDone = false;
  for (let t = 0; t <= BOSS_CHALLENGE_HARD_CAP_S + 2; t += 0.05) {
    const done = bossChallengeAt({ elapsedS: t, player, reducedMotion: false }).done;
    if (sawDone) assert.equal(done, true, `regressed to not-done at ${t}s`);
    if (done) sawDone = true;
  }
  assert.equal(sawDone, true, "the cutscene never reported done across the whole sweep");
});

// ---- LINES, IN ORDER, IN THE OFFICER'S VOICE ------------------------------

test("the three beats play in authored order", () => {
  assert.equal(BOSS_CHALLENGE_BEATS.length, 3);
  assert.deepEqual(
    BOSS_CHALLENGE_BEATS.map((b) => b.phase),
    ["HAIL", "CHARGE", "CHALLENGE"],
  );
  // Sampled at the middle of each beat's window, the active line advances.
  let acc = 0;
  const midpoints = BOSS_CHALLENGE_BEATS.map((b) => {
    const mid = acc + b.holdS / 2;
    acc += b.holdS;
    return mid;
  });
  const linesInOrder = midpoints.map((t) => bossBeatAt(t).beat.line);
  assert.deepEqual(linesInOrder, BOSS_CHALLENGE_BEATS.map((b) => b.line));
  // The officer draws only on the final challenge beat.
  assert.equal(
    bossChallengeAt({ elapsedS: midpoints[2]!, player: { x: 0, y: 0, z: 0, yaw: 0 }, reducedMotion: false }).officer.clip,
    "draw",
  );
  assert.equal(
    bossChallengeAt({ elapsedS: midpoints[0]!, player: { x: 0, y: 0, z: 0, yaw: 0 }, reducedMotion: false }).officer.clip,
    "idle",
  );
});

// ---- ON THE PLAYER'S SURFACE (no teleport / no floating) -------------------

test("the officer is staged on the player's own surface, at a standoff", () => {
  for (const player of [
    { x: 90.5, y: 0, z: 0, yaw: 0 },
    { x: 92, y: 8.2, z: -1.6, yaw: 1.9 },
    { x: 88, y: 0, z: 5, yaw: -2.3 },
  ] as CinePose[]) {
    const officer = bossOfficerStaging(player);
    // SAME ground plane as the player — the whole point of the anti-teleport fix.
    assert.equal(officer.y, player.y, "officer left the player's surface");
    const dist = Math.hypot(officer.x - player.x, officer.z - player.z);
    assert.ok(
      Math.abs(dist - BOSS_STANDOFF_M) < 1e-6,
      `officer standoff ${dist} != ${BOSS_STANDOFF_M}`,
    );
    // He faces back toward the player (within a small tolerance).
    const toPlayer = Math.atan2(player.x - officer.x, player.z - officer.z);
    const dYaw = Math.abs(((officer.yaw - toPlayer + Math.PI) % (2 * Math.PI)) - Math.PI);
    assert.ok(dYaw < 1e-6, "officer is not facing the player");
  }
});

// ---- DETERMINISM (no unseeded RNG anywhere) --------------------------------

test("the read is a pure function of its inputs", () => {
  const args = { elapsedS: 5.2, player: { x: 3, y: 1, z: 2, yaw: 0.7 } as CinePose, reducedMotion: false };
  assert.deepEqual(bossChallengeAt(args), bossChallengeAt(args));
});

// ---------------------------------------------------------------------------
// The overlay: it OPENS THE DUEL (its `onEnter`) both when the timeline runs out
// and when the player skips, and never more than once. `onEnter` is exactly what
// the container binds to `resolveTraversal(REACHED_DUEL)`, so "the duel opens
// after it" is this callback firing.
// ---------------------------------------------------------------------------

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `node --test` has no CSS loader; stub any `.css` import the component pulls in.
const cssStub = {
  load(url: string, context: unknown, nextLoad: (u: string, c: unknown) => unknown) {
    if (url.endsWith(".css")) {
      return { format: "module", source: "export default {};", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
};
const hooks = module as unknown as {
  registerHooks?: (h: typeof cssStub) => void;
  register: (specifier: string) => void;
};
if (typeof hooks.registerHooks === "function") {
  hooks.registerHooks(cssStub);
} else {
  hooks.register(
    "data:text/javascript," +
      encodeURIComponent(
        "export async function load(url, context, nextLoad) {" +
          "  if (url.endsWith('.css')) {" +
          "    return { format: 'module', source: 'export default {};', shortCircuit: true };" +
          "  }" +
          "  return nextLoad(url, context);" +
          "}",
      ),
  );
}

const { BossChallenge } = await import("../src/mission/BossChallenge.js");

/** A controllable clock + rAF, so the timeline can be advanced without waiting. */
function withFakeClock(run: (clock: { advanceTo(ms: number): void }) => void): void {
  const realNow = globalThis.performance?.now?.bind(globalThis.performance);
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  let nowMs = 0;
  const rafs: Array<() => void> = [];
  (globalThis as { performance: Performance }).performance = {
    ...(globalThis.performance ?? {}),
    now: () => nowMs,
  } as Performance;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    rafs.push(() => cb(nowMs));
    return rafs.length;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame;
  const clock = {
    advanceTo(ms: number) {
      nowMs = ms;
      const pending = rafs.splice(0, rafs.length);
      for (const fn of pending) fn();
    },
  };
  try {
    run(clock);
  } finally {
    if (realNow) (globalThis.performance as { now: () => number }).now = realNow;
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
  }
}

test("the overlay opens the duel once when the timeline runs out", () => {
  withFakeClock((clock) => {
    let entered = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(BossChallenge, {
          player: { x: 0, y: 0, z: 0, yaw: 0 },
          startedAtMs: 0,
          reducedMotion: true,
          onEnter: () => {
            entered += 1;
          },
        }),
      );
    });
    // Part-way through: still running, no duel yet.
    act(() => clock.advanceTo(1000));
    assert.equal(entered, 0);
    // Past the scripted total: the duel opens, exactly once.
    act(() => clock.advanceTo(BOSS_CHALLENGE_TOTAL_S * 1000 + 100));
    assert.equal(entered, 1);
    act(() => clock.advanceTo(BOSS_CHALLENGE_TOTAL_S * 1000 + 5000));
    assert.equal(entered, 1, "the duel was opened more than once");
    act(() => tree.unmount());
  });
});

test("the overlay opens the duel once when the player skips", () => {
  withFakeClock(() => {
    let entered = 0;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(BossChallenge, {
          player: { x: 0, y: 0, z: 0, yaw: 0 },
          startedAtMs: 0,
          reducedMotion: true,
          onEnter: () => {
            entered += 1;
          },
        }),
      );
    });
    const skip = tree.root.findByProps({ className: "msn-boss-skip" });
    act(() => skip.props.onClick());
    assert.equal(entered, 1);
    // A second press cannot open a second duel.
    act(() => skip.props.onClick());
    assert.equal(entered, 1);
    act(() => tree.unmount());
  });
});

test("the overlay shows the officer's first line at the start", () => {
  withFakeClock(() => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        React.createElement(BossChallenge, {
          player: { x: 0, y: 0, z: 0, yaw: 0 },
          startedAtMs: 0,
          reducedMotion: true,
          onEnter: () => {},
        }),
      );
    });
    const line = tree.root.findByProps({ className: "msn-enc-line" });
    assert.equal(line.children.join(""), BOSS_CHALLENGE_BEATS[0]!.line);
    act(() => tree.unmount());
  });
});
