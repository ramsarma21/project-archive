import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";

import {
  BULLETS_FOR_CORRECT,
  BULLETS_FOR_WRONG,
  FACE_OFF_TICKS,
  FIELD_DT,
  bossProfileForTier,
  mintVerdict,
} from "@pa/duel";

import {
  CRITICAL_FRACTION,
  ammoReadout,
  classifyHit,
  healthDelta,
  healthTone,
  initialHitTracker,
  observeHealth,
  observeRoundAmmo,
} from "../src/duel/combatHudModel.js";
import {
  ENGAGEMENT_MAX_LEAN_RAD,
  dampAngle,
  engagementCameraYaw,
} from "../src/duel/duelCamera.js";
import { LEGEND_HIDDEN, legendReducer } from "../src/duel/controlsLegend.js";
import {
  EnemyHealth,
  HealthBar,
  HitMarker,
  ControlsLegend,
  enemyStandingLine,
} from "../src/duel/combatHudParts.js";
import {
  PORTRAIT_SAMPLE_MAX_SECONDS,
  portraitClipName,
  portraitSampleSeconds,
} from "../src/duel/portraitPose.js";
import { createDuelRuntime } from "../src/duel/duelRuntime.js";
import { yardArena } from "../src/duel/arenaSpec.js";
import { m1QuestionBank } from "../src/duel/duelItems.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The combat HUD's contract, in the two places it can silently break: it must be a pure
// function of authoritative state (health, ammo, the 14/7 award), and a hit cue must
// fire exactly once per authoritative hit and never on a duplicate. Plus the camera
// damping helper (frame-rate independent, slew-clamped, loop-free) and the hold-Tab
// controls legend's edge cases (blur, the open overlay, a stuck state).

// ---- health tone -----------------------------------------------------------

test("health tone crosses at the documented thresholds, and down is distinct", () => {
  assert.equal(healthTone(200, 200), "healthy");
  assert.equal(healthTone(101, 200), "healthy");
  assert.equal(healthTone(100, 200), "damaged"); // <= 0.5
  assert.equal(healthTone(50, 200), "critical"); // <= 0.25
  assert.equal(healthTone(1, 200), "critical");
  assert.equal(healthTone(0, 200), "down");
  // A dead denominator never throws or returns NaN in a HUD string.
  assert.equal(healthTone(0, 0), "down");
  assert.ok(["down", "critical"].includes(healthTone(50, 0)));
});

// ---- the hit cue: once per authoritative fall, never on a duplicate ---------

test("classifyHit fires only on a strict fall, so a replay is silent", () => {
  assert.equal(classifyHit(200, 180, 200), "NORMAL");
  assert.equal(classifyHit(200, 200, 200), null, "equal health is not a hit");
  assert.equal(classifyHit(180, 200, 200), null, "a rise is not a hit");
});

test("classifyHit differentiates a threshold cross and a knockout", () => {
  // Crossing INTO the critical band from above is the CRITICAL cue.
  assert.equal(classifyHit(60, 40, 200), "CRITICAL"); // 0.3 -> 0.2 crosses 0.25
  // A drop that stays above critical is NORMAL.
  assert.equal(classifyHit(200, 160, 200), "NORMAL");
  // A drop entirely within the critical band is NORMAL, not a second CRITICAL cue.
  assert.equal(classifyHit(40, 20, 200), "NORMAL");
  // Reaching zero is FATAL, whatever band it came from.
  assert.equal(classifyHit(30, 0, 200), "FATAL");
  assert.equal(classifyHit(200, 0, 200), "FATAL");
});

test("observeHealth dedups by tick, so a duplicated snapshot never re-fires", () => {
  let tracker = initialHitTracker(200, 10);
  // A new tick with a fall fires once.
  let step = observeHealth(tracker, 180, 200, 11);
  assert.equal(step.hit, "NORMAL");
  tracker = step.tracker;
  // The SAME authoritative tick arriving again (a duplicate poll) does not re-fire.
  step = observeHealth(tracker, 180, 200, 11);
  assert.equal(step.hit, null);
  tracker = step.tracker;
  // An out-of-order arrival at an already-presented tick cannot walk it back either.
  step = observeHealth(tracker, 150, 200, 11);
  assert.equal(step.hit, null);
  // The next genuine tick WITH a real fall fires again.
  step = observeHealth(step.tracker, 120, 200, 12);
  assert.equal(step.hit, "NORMAL");
});

// ---- ammunition, including the 14/7 award ----------------------------------

test("ammoReadout is a Cassidy current-over-reserve, with real 0/0 and 14/7 states", () => {
  // Pre-first-answer: no magazine has been granted yet. 0 / 0 is a REAL state.
  const fresh = ammoReadout(0, 0);
  assert.deepEqual([fresh.current, fresh.total], [0, 0]);
  assert.equal(fresh.empty, true);

  // A wrong answer's grant and a correct answer's grant both read as current / total.
  const wrong = ammoReadout(BULLETS_FOR_WRONG, BULLETS_FOR_WRONG);
  assert.deepEqual([wrong.current, wrong.total], [BULLETS_FOR_WRONG, BULLETS_FOR_WRONG]);
  const correct = ammoReadout(BULLETS_FOR_CORRECT, BULLETS_FOR_CORRECT);
  assert.deepEqual([correct.current, correct.total], [BULLETS_FOR_CORRECT, BULLETS_FOR_CORRECT]);

  // Spent partway: the total holds at the magazine so the reserve still reads.
  const spent = ammoReadout(3, BULLETS_FOR_CORRECT);
  assert.deepEqual([spent.current, spent.total], [3, BULLETS_FOR_CORRECT]);
  assert.equal(spent.low, true, "a quarter-magazine or less is the low state");
  assert.equal(spent.empty, false);

  const dry = ammoReadout(0, BULLETS_FOR_CORRECT);
  assert.equal(dry.empty, true);
});

test("observeRoundAmmo tracks the round's peak and resets on a new round", () => {
  let tracker: { round: number; magazine: number } = { round: 1, magazine: 0 };
  tracker = observeRoundAmmo(tracker, 1, 14);
  assert.equal(tracker.magazine, 14);
  tracker = observeRoundAmmo(tracker, 1, 9); // spent some; the peak holds
  assert.equal(tracker.magazine, 14);
  tracker = observeRoundAmmo(tracker, 2, 7); // a new round re-bases the magazine
  assert.deepEqual(tracker, { round: 2, magazine: 7 });
});

test("the HUD binds ammo to the core's 14/7 award, not a local counter", () => {
  // Drive the real reducer to a committed verdict and read what the ammo cluster would
  // be handed: the core's own magazine, projected through `ammoReadout` untouched.
  for (const [kind, expected] of [
    ["CORRECT", BULLETS_FOR_CORRECT],
    ["WRONG", BULLETS_FOR_WRONG],
  ] as const) {
    const arena = yardArena();
    const runtime = createDuelRuntime({
      duelId: "TEST.HUD.AMMO",
      seed: 7,
      world: arena.world,
      placement: arena.placement,
      opponent: { kind: "BOSS", profile: bossProfileForTier(1, "TEST.BOSS") },
      questions: m1QuestionBank(),
    });
    for (let i = 0; i < FACE_OFF_TICKS + 2; i++) runtime.advance(FIELD_DT);
    const item = runtime.getHud().item!;
    runtime.commitVerdict(
      "A",
      mintVerdict({ kind, itemId: item.itemId, itemVersion: item.itemVersion, source: "CLASSIFIER" }),
    );
    runtime.advance(FIELD_DT);
    const hud = runtime.getHud();
    const readout = ammoReadout(hud.ammo.A, hud.magazine.A);
    assert.equal(readout.current, expected, `${kind} loads ${expected} into the current`);
    assert.equal(readout.total, expected, `${kind} magazine is the reserve total`);
  }
});

// ---- camera damping: frame-rate independent, slew-clamped, loop-free -------

test("dampAngle is frame-rate independent: one big step equals many small ones", () => {
  const rate = 3;
  const maxRate = 1e9; // isolate the exponential term from the slew clamp
  const goal = 1.0;
  const big = dampAngle(0, goal, rate, maxRate, 0.5);
  let small = 0;
  for (let i = 0; i < 50; i++) small = dampAngle(small, goal, rate, maxRate, 0.01);
  assert.ok(Math.abs(big - small) < 1e-3, `big ${big} vs small ${small}`);
  // And it is the analytic exponential approach.
  assert.ok(Math.abs(big - goal * (1 - Math.exp(-rate * 0.5))) < 1e-6);
});

test("dampAngle clamps the slew rate, so no jump can whip the camera", () => {
  // A huge rate wants the whole jump at once; the slew cap bounds it to maxRate*dt.
  const moved = dampAngle(0, 3.0, 1e9, 2.0, 0.1);
  assert.ok(Math.abs(moved - 0.2) < 1e-9, `expected a 0.2 rad cap, got ${moved}`);
});

test("dampAngle takes the shortest way round the circle", () => {
  // 3.0 -> -3.0 the long way is -6 rad; the short way is +0.283 (through pi).
  const moved = dampAngle(3.0, -3.0, 1e9, 1e9, 1);
  const step = moved - 3.0;
  assert.ok(step > 0 && step < 0.4, `must turn the short way (+0.283), got ${step}`);
});

test("engagementCameraYaw leans toward the aim but can never run away", () => {
  const axis = 0.4;
  // A within-lean aim passes through.
  assert.ok(Math.abs(engagementCameraYaw(axis, axis + 0.1) - (axis + 0.1)) < 1e-9);
  // An aim far off the axis is clamped to the lean limit — the anti-spin guarantee.
  assert.ok(Math.abs(engagementCameraYaw(axis, axis + Math.PI) - (axis + ENGAGEMENT_MAX_LEAN_RAD)) < 1e-6);
  assert.ok(Math.abs(engagementCameraYaw(axis, axis - Math.PI) - (axis - ENGAGEMENT_MAX_LEAN_RAD)) < 1e-6);
  // For EVERY aim around the circle the result stays within the lean band of the axis.
  for (let a = -Math.PI; a <= Math.PI; a += 0.2) {
    const yaw = engagementCameraYaw(axis, axis + a);
    assert.ok(Math.abs(yaw - axis) <= ENGAGEMENT_MAX_LEAN_RAD + 1e-9);
  }
});

// ---- the hold-Tab controls legend ------------------------------------------

test("the legend shows while Tab is held and suppresses focus cycling", () => {
  const down = legendReducer(LEGEND_HIDDEN, { type: "KEYDOWN", key: "Tab", onControl: false });
  assert.equal(down.state.held, true);
  assert.equal(down.preventDefault, true, "Tab's focus cycle is suppressed while the duel is focused");
  const up = legendReducer(down.state, { type: "KEYUP", key: "Tab" });
  assert.equal(up.state.held, false);
});

test("Tab belongs to the question overlay when a control is focused", () => {
  // The open evidence overlay: Tab must keep navigating, so the legend never shows and
  // the default is NOT suppressed.
  const result = legendReducer(LEGEND_HIDDEN, { type: "KEYDOWN", key: "Tab", onControl: true });
  assert.equal(result.state.held, false);
  assert.equal(result.preventDefault, false);
});

test("the legend can never get stuck: blur and disable both hide it", () => {
  const held = { held: true };
  assert.equal(legendReducer(held, { type: "BLUR" }).state.held, false);
  assert.equal(legendReducer(held, { type: "DISABLE" }).state.held, false);
  // A non-Tab key is inert and leaves the state alone.
  const other = legendReducer(held, { type: "KEYDOWN", key: "w", onControl: false });
  assert.equal(other.state.held, true);
  assert.equal(other.preventDefault, false);
});

// ---- component behaviour (canvas-free parts) -------------------------------

function textOf(root: ReactTestInstance): string {
  const out: string[] = [];
  const walk = (node: ReactTestInstance | string): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    for (const child of node.children) walk(child as ReactTestInstance | string);
  };
  walk(root);
  return out.join(" ");
}

function withClass(root: ReactTestInstance, needle: string): ReactTestInstance[] {
  return root.findAll(
    (node) =>
      typeof (node.props as { className?: unknown }).className === "string" &&
      (node.props as { className: string }).className.split(" ").includes(needle),
  );
}

test("the enemy display shows the name once and binds the authoritative health", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 40,
        maxHealth: 200,
        round: 1,
        reducedMotion: true,
      }),
    );
  });
  const root = renderer.root;
  // The name label appears exactly once, and with no role the duplicate line is gone.
  assert.equal(withClass(root, "cbt-enemy-name").length, 1, "one visible name label");
  assert.equal(withClass(root, "cbt-enemy-role").length, 0, "no role line when none is given");
  // 40 / 200 is a quarter, so the pool reads critical (not colour-only: it is labelled).
  assert.ok(withClass(root, "cbt-enemy-critical").length > 0, "critical state is marked");
  assert.match(textOf(root), /40/);
  act(() => renderer.unmount());
});

// ---- the persistent clean-hits read (moved off the retired break card) -----

test("enemyStandingLine keeps the card's character, pronoun-free, and reads down", () => {
  // The line that used to live only on the blocking break card. Pronoun-free so it is
  // correct for the boss AND a PvP opponent — the name sits right above it.
  assert.equal(enemyStandingLine(7, false), "7 clean hits from the ground");
  assert.equal(enemyStandingLine(1, false), "1 clean hit from the ground", "singular reads");
  assert.equal(enemyStandingLine(0, false), "0 clean hits from the ground");
  // Down outranks the count, and a missing count draws nothing (PvP today).
  assert.equal(enemyStandingLine(3, true), "down");
  assert.equal(enemyStandingLine(undefined, false), null, "no count, no line");
});

test("the enemy HUD shows the clean-hits read and escalates as it closes", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 140,
        maxHealth: 200,
        hitsToFall: 7,
        round: 1,
        reducedMotion: true,
      }),
    );
  });
  const standing = withClass(renderer.root, "cbt-enemy-standing");
  assert.equal(standing.length, 1, "the clean-hits read is drawn");
  assert.match(textOf(renderer.root), /7 clean hits from the ground/);
  assert.equal(
    withClass(renderer.root, "is-closing").length,
    0,
    "seven hits out is not yet the closing state",
  );

  // Three or fewer clean hits: the read escalates (not colour-only — the words stay).
  act(() => {
    renderer.update(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 40,
        maxHealth: 200,
        hitsToFall: 2,
        round: 3,
        reducedMotion: true,
      }),
    );
  });
  assert.equal(withClass(renderer.root, "is-closing").length, 1, "the endgame is escalated");
  assert.match(textOf(renderer.root), /2 clean hits from the ground/);
  act(() => renderer.unmount());
});

test("a downed opponent's read is 'down', and an absent count draws no line", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 0,
        maxHealth: 200,
        hitsToFall: 0,
        downed: true,
        reducedMotion: true,
      }),
    );
  });
  assert.match(textOf(renderer.root), /down/);
  act(() => renderer.unmount());

  // PvP passes no count today: the line is simply absent, not "0 hits".
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "duellist_7",
        health: 200,
        maxHealth: 200,
        reducedMotion: true,
      }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-enemy-standing").length, 0, "no count, no line");
  act(() => renderer.unmount());
});

test("a genuine role subtitle is kept and is distinct from the name (PvP)", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "duellist_7",
        role: "Rank 4",
        health: 200,
        maxHealth: 200,
        reducedMotion: true,
      }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-enemy-name").length, 1, "one name label");
  assert.equal(withClass(renderer.root, "cbt-enemy-role").length, 1, "a distinct role line");
  assert.match(textOf(renderer.root), /Rank 4/);
  act(() => renderer.unmount());
});

test("the hit marker fires on a fall and stays silent on a duplicate", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(HitMarker, { enemyHealth: 200, enemyMaxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-hitmark").length, 0, "no marker at rest");

  // A duplicate (equal health) re-render does not fire.
  act(() => {
    renderer.update(
      React.createElement(HitMarker, { enemyHealth: 200, enemyMaxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-hitmark").length, 0, "duplicate does not fire");

  // A real fall fires exactly one marker.
  act(() => {
    renderer.update(
      React.createElement(HitMarker, { enemyHealth: 160, enemyMaxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-hitmark").length, 1, "a hit shows the marker");
  // The kind still reaches the DOM; it no longer selects a colour. See the stylesheet
  // test below, which is where "always yellow" can actually be asserted.
  assert.equal(withClass(renderer.root, "cbt-hitmark-normal").length, 1);
  act(() => renderer.unmount());
});

test("a knockout marker is differentiated, and reduced motion is a calmer variant", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(HitMarker, { enemyHealth: 30, enemyMaxHealth: 200, reducedMotion: true }),
    );
  });
  act(() => {
    renderer.update(
      React.createElement(HitMarker, { enemyHealth: 0, enemyMaxHealth: 200, reducedMotion: true }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-hitmark-fatal").length, 1, "a knockout is a distinct cue");
  assert.equal(withClass(renderer.root, "is-reduced").length, 1, "reduced motion is respected");
  act(() => renderer.unmount());
});

// ---- the marker's colour, pinned where it ships ----------------------------
//
// A component test cannot see a colour: the class reaches the DOM either way, and the
// marker was already firing on every hit while rendering white. So the assertion has to
// be on the stylesheet the duel actually loads, the same way `missionBeat.test.ts` pins
// the beat panel's plate.

const HITMARK_CSS = readFileSync(
  new URL("../src/duel/combatHud.css", import.meta.url),
  "utf8",
);

test("every confirmed hit marks in one colour, and it is the confirm yellow", () => {
  assert.match(
    HITMARK_CSS,
    /\.cbt-hitmark\s*\{[^}]*color:\s*var\(--cbt-hit\)/,
    "the marker takes the shared confirm colour",
  );
  // No kind may reintroduce a severity grade. White read as nothing against the daylit
  // yard — the owner's complaint — and red now means "you took damage" (8399adb), so a
  // red knockout would say the opposite of what just happened.
  assert.doesNotMatch(
    HITMARK_CSS,
    /\.cbt-hitmark-(?:normal|critical|fatal)[^{]*\{[^}]*\bcolor:/,
    "no hit kind sets a colour of its own",
  );
  // The value is pinned to the literal because the other half of this signal — the 3D
  // burst's HIT_CONFIRM_PUFF in Gunplay.tsx — is still on the unmerged boss-clip branch
  // and cannot be read from here yet. Replace this with an equality against that
  // constant once both land; until then a drift in either is silent.
  assert.match(HITMARK_CSS, /--cbt-hit:\s*#ffd23a/, "and it is the burst's own yellow");
});

test("the marker stays legible over a bright sky, not merely yellow", () => {
  // Yellow alone does not fix this. Against a daylit sky it is close in LUMINANCE
  // however far apart the two are in hue, so what carries the shape is the dark rim on
  // each arm and the dark drop-shadow around the whole X. Losing either regresses the
  // marker to invisible while leaving it technically yellow, which is the failure this
  // change exists to end.
  assert.match(
    HITMARK_CSS,
    /\.cbt-hitmark\s*\{[^}]*filter:\s*drop-shadow\([^)]*rgba\(0,\s*0,\s*0/,
    "the whole marker keeps a dark drop-shadow",
  );
  assert.match(
    HITMARK_CSS,
    /\.cbt-hitmark-arm\s*\{[^}]*box-shadow:[^;]*rgba\(0,\s*0,\s*0/,
    "and each arm keeps a dark rim",
  );
  assert.doesNotMatch(
    HITMARK_CSS,
    /\.cbt-hitmark-arm\s*\{[^}]*box-shadow:[^;]*rgba\(255,\s*255,\s*255/,
    "with no white bloom, which is what washed the colour out",
  );
});

test("the enemy damage chip trails a fall and eases to the new health", () => {
  // Drive the chip with a controllable clock and rAF, so the trailing animation is
  // asserted rather than eyeballed.
  const realRaf = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  const realPerf = globalThis.performance;
  const callbacks: FrameRequestCallback[] = [];
  let now = 0;
  (globalThis as { performance: { now(): number } }).performance = { now: () => now };
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    callbacks.push(cb);
    return callbacks.length as unknown as number;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = (() => undefined) as typeof cancelAnimationFrame;

  const chipWidth = (renderer: ReactTestRenderer): string =>
    String(
      (withClass(renderer.root, "cbt-enemy-chip")[0]!.props as { style: { width: string } }).style
        .width,
    );

  try {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = TestRenderer.create(
        React.createElement(EnemyHealth, {
          name: "The King's officer",
          health: 200,
          maxHealth: 200,
          reducedMotion: false,
        }),
      );
    });
    assert.equal(chipWidth(renderer), "0%", "full health, no chip");

    // A fall: the chip HOLDS at the old fill until the animation runs, so the bite is
    // visible immediately.
    act(() => {
      renderer.update(
        React.createElement(EnemyHealth, {
          name: "The King's officer",
          health: 100,
          maxHealth: 200,
          reducedMotion: false,
        }),
      );
    });
    assert.equal(chipWidth(renderer), "50%", "the whole bite shows as a chip at first");

    // Run the animation to its end: the chip eases down to the current health.
    act(() => {
      now = 1000;
      const pending = callbacks.splice(0);
      for (const cb of pending) cb(now);
    });
    assert.equal(chipWidth(renderer), "0%", "the chip has drained to the new health");
    act(() => renderer.unmount());
  } finally {
    globalThis.requestAnimationFrame = realRaf;
    globalThis.cancelAnimationFrame = realCancel;
    (globalThis as { performance: Performance }).performance = realPerf;
  }
});

test("reduced motion collapses the chip instantly while keeping the reading", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 200,
        maxHealth: 200,
        reducedMotion: true,
      }),
    );
  });
  act(() => {
    renderer.update(
      React.createElement(EnemyHealth, {
        name: "The King's officer",
        health: 100,
        maxHealth: 200,
        reducedMotion: true,
      }),
    );
  });
  const chip = withClass(renderer.root, "cbt-enemy-chip")[0]!;
  assert.equal((chip.props as { style: { width: string } }).style.width, "0%", "no trail under reduced motion");
  assert.match(textOf(renderer.root), /100/, "the health reading still updates");
  act(() => renderer.unmount());
});

test("the controls legend is a hint by default and the full list while held", () => {
  const items = [
    { keys: "W A S D", action: "move" },
    { keys: "Click", action: "fire" },
  ];
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(ControlsLegend, { items, held: false }));
  });
  assert.equal(withClass(renderer.root, "cbt-legend-list").length, 0, "hidden by default");
  assert.match(textOf(renderer.root), /controls/i, "but the hint is always present");

  act(() => {
    renderer.update(React.createElement(ControlsLegend, { items, held: true }));
  });
  assert.equal(withClass(renderer.root, "cbt-legend-list").length, 1, "the list appears while held");
  assert.match(textOf(renderer.root), /move/);
  act(() => renderer.unmount());
});

// A silence-the-unused guard: CRITICAL_FRACTION is the threshold the tests lean on.
test("the critical threshold is the documented quarter", () => {
  assert.equal(CRITICAL_FRACTION, 0.25);
});

// ---- health-bar animation: delta classification and pulse suppression ------

test("healthDelta is the animation's guard: damage, heal, or none on a repeat", () => {
  assert.equal(healthDelta(200, 180), "damage");
  assert.equal(healthDelta(120, 160), "heal");
  assert.equal(healthDelta(140, 140), "none", "a duplicate/stale snapshot is neither");
});

test("the health bar flashes impact on damage and never on a duplicate snapshot", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(HealthBar, { health: 200, maxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-health-impact").length, 0, "no flash at rest");

  // A duplicate (equal health) must not fire the impact.
  act(() => {
    renderer.update(
      React.createElement(HealthBar, { health: 200, maxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-health-impact").length, 0, "duplicate does not flash");

  // A real fall flashes impact and no heal.
  act(() => {
    renderer.update(
      React.createElement(HealthBar, { health: 120, maxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-health-impact").length, 1, "damage flashes impact");
  assert.equal(withClass(renderer.root, "cbt-health-heal").length, 0);
  assert.match(textOf(renderer.root), /120/);
  act(() => renderer.unmount());
});

test("the health bar uses a distinct heal treatment when health rises", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(HealthBar, { health: 100, maxHealth: 200, reducedMotion: false }),
    );
  });
  act(() => {
    renderer.update(
      React.createElement(HealthBar, { health: 150, maxHealth: 200, reducedMotion: false }),
    );
  });
  assert.equal(withClass(renderer.root, "cbt-health-heal").length, 1, "a rise reads as a heal");
  assert.equal(withClass(renderer.root, "cbt-health-impact").length, 0, "a heal is not damage");
  act(() => renderer.unmount());
});

test("a critical player bar is labelled, not colour-only, and calmer under reduced motion", () => {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(
      React.createElement(HealthBar, { health: 40, maxHealth: 200, reducedMotion: true }),
    );
  });
  assert.ok(withClass(renderer.root, "cbt-health-critical").length > 0, "critical tone marked");
  // Not colour-only: the state is spelled out.
  assert.match(textOf(renderer.root), /critical/i);
  act(() => renderer.unmount());
});

// ---- portrait pose selection -----------------------------------------------

test("the portrait poses to the shared two-handed standoff, with a fallback", () => {
  // The resting-aim role points at "standoff"; the portrait selects the same.
  assert.equal(
    portraitClipName("playerboy-rigged", ["standoff", "fire", "draw", "reload"]),
    "standoff",
  );
  // A rig carrying nothing usable falls back to its first clip rather than crashing.
  assert.equal(portraitClipName("boss", ["someIdle", "walk"]), "someIdle");
  // No clips at all is null, not a throw.
  assert.equal(portraitClipName("empty", []), null);
});

test("the portrait samples a settled, bounded point in the loop", () => {
  assert.equal(portraitSampleSeconds(1.0), 0.5);
  assert.equal(portraitSampleSeconds(2.0), PORTRAIT_SAMPLE_MAX_SECONDS, "a long loop is capped");
  assert.equal(portraitSampleSeconds(0), 0, "a degenerate clip does not divide by zero");
});
