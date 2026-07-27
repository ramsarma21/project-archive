import { STEALTH_TUNING, clamp01, projectFieldSeed } from "@pa/engine-world";
import type { MissionCivilian } from "./levelPort.js";

// ---------------------------------------------------------------------------
// The mission clock, expressed as dawn.
//
// M1 is "post the handbill before dawn while the patrols sweep", so the three
// minutes are the last of the night rather than an abstract allowance. That is
// the whole design of this module: the clock is a light level, and the light
// level is what the stealth field already reads. Nothing here is a second timer.
//
// Every function is pure and every input is derived from the fixed step —
// `elapsedS` is always `ticks * FIELD_DT`, never a wall-clock delta. That is not
// a stylistic preference: the replay story depends on a mission being a function
// of its ticks, and a sky that brightened on `performance.now()` would make the
// stealth field's light term drift with frame rate and tab focus. Rule (g) in
// scripts/check-boundaries.mjs holds the line.
//
// Running out of clock does NOT end the attempt. §4.11 lists the ways an attempt
// is lost and the clock is not one of them; the only authored fail point on this
// floor is being held in the final court under the elm. What dawn does instead is
// take the player's TOOLS away, on two separate schedules:
//
//   The dark goes, continuously, from the first second. `dawnLightLevel` lifts
//   the level's authored light toward daylight, so shadow concealment degrades
//   smoothly all the way through the budget and keeps degrading past it. This is
//   the escalation the player feels, and it is a ramp rather than a cliff.
//
//   The crowd goes home, at dawn. `dawnDispersal01` holds every body in place
//   until the budget is spent and then walks them off over
//   `DAWN.crowdDepartureS`, which is what makes blending stop working. Bodies
//   genuinely leave the one list of civilians — they are not silently discounted
//   — so the field, the throw physics and the renderer keep agreeing.
//
// The constable still arrives at the elm on his own patrol either way. So
// overrunning means facing him with no dark and no crowd left, which a player can
// see coming and reason about, rather than being told at 2:58 that they lost.
// ---------------------------------------------------------------------------

/**
 * How the light behaves against the budget.
 *
 * `liftAtDawn` is the share of the way to full daylight the sky has travelled by
 * the time the authored budget is spent. It is deliberately not 1: dawn arriving
 * exactly as the clock runs out would make the budget a hard edge, and the point
 * is that the last of the dark is already thin before then and merely gets
 * thinner after.
 */
export const DAWN = {
  liftAtDawn: 0.55,
  /** Seconds past the budget in which first light becomes full sun-up. */
  overrunSpanS: 60,
  /**
   * Seconds past the budget in which the crowds walk home.
   *
   * Shorter than the light's span on purpose. A crowd has to thin fast enough
   * that a player standing in one notices the bodies leaving, and the number
   * that matters is not this one but `crowdBlendMinDensity` — see `crowdKept`,
   * which drives every cluster below the engine's blend floor by the end of it.
   */
  crowdDepartureS: 25,
  /**
   * How the night's share of the lift is shaped. Above 1 so the first minute
   * barely moves and the last thirty seconds move a lot, which is both what
   * dawn does and what makes the end of the budget feel like a deadline.
   */
  nightCurveExponent: 1.8,
} as const;

export type DawnStage =
  | "LAST_DARK"
  | "FIRST_LIGHT"
  | "GREY"
  | "DAWN"
  | "SUN_UP";

export interface DawnRead {
  /**
   * False when the level declared no usable budget. The clock then does nothing
   * at all — no lift, no dispersal — rather than dividing by zero and printing
   * NaN over the player's head.
   */
  readonly hasClock: boolean;
  /** Simulated seconds of traversal. `ticks * FIELD_DT`, never wall time. */
  readonly elapsedS: number;
  /** The level's own declared budget, read from the instance. Never 180 here. */
  readonly budgetS: number;
  /** Seconds of night left. Clamped at zero; see `pastS` for the overrun. */
  readonly remainingS: number;
  /** Seconds past the budget. Zero until the budget is spent. */
  readonly pastS: number;
  /** [0,1] progress from full dark to full sun-up. The one clock everything reads. */
  readonly lift01: number;
  readonly stage: DawnStage;
  /**
   * The share of the best-case darkness bonus still available, [0,1].
   *
   * Exactly `1 - lift01`, and that is an identity rather than a coincidence:
   * the engine's light term is `darkFactor + (1 - darkFactor) * lightLevel`, so
   * lifting an authored 0 by `lift01` spends precisely `lift01` of the way from
   * the darkness floor to full visibility. The HUD can therefore draw this as
   * "how much the dark is still worth" without inventing a second model.
   */
  readonly shadowHold01: number;
  /** [0,1] how far the crowds have gone home. Zero until the budget is spent. */
  readonly dispersal01: number;
}

function stageFor(lift01: number): DawnStage {
  if (lift01 < 0.1) return "LAST_DARK";
  if (lift01 < 0.3) return "FIRST_LIGHT";
  if (lift01 < DAWN.liftAtDawn) return "GREY";
  if (lift01 < 0.9) return "DAWN";
  return "SUN_UP";
}

/**
 * How far the sky has come, [0,1].
 *
 * Two branches meeting at `liftAtDawn`, which they both produce at the budget,
 * so the curve is continuous there and monotonic everywhere. The night eases in
 * (nothing much happens, then it happens quickly) and the overrun eases out, so
 * the first seconds of running long are the expensive ones.
 */
export function dawnLift01(elapsedS: number, budgetS: number): number {
  if (!(budgetS > 0)) return 0;
  if (elapsedS <= budgetS) {
    const night = clamp01(elapsedS / budgetS);
    return DAWN.liftAtDawn * Math.pow(night, DAWN.nightCurveExponent);
  }
  const over = clamp01((elapsedS - budgetS) / DAWN.overrunSpanS);
  const eased = 1 - (1 - over) * (1 - over);
  return DAWN.liftAtDawn + (1 - DAWN.liftAtDawn) * eased;
}

/** How far the crowds have gone home, [0,1]. Nobody leaves before dawn. */
export function dawnDispersal01(elapsedS: number, budgetS: number): number {
  if (!(budgetS > 0)) return 0;
  if (elapsedS <= budgetS) return 0;
  return clamp01((elapsedS - budgetS) / DAWN.crowdDepartureS);
}

/** The whole clock, from the simulation's own count of seconds. */
export function dawnRead(elapsedS: number, budgetS: number): DawnRead {
  const hasClock = budgetS > 0 && Number.isFinite(budgetS);
  const lift01 = hasClock ? dawnLift01(elapsedS, budgetS) : 0;
  return {
    hasClock,
    elapsedS,
    budgetS,
    remainingS: hasClock ? Math.max(0, budgetS - elapsedS) : 0,
    pastS: hasClock ? Math.max(0, elapsedS - budgetS) : 0,
    lift01,
    stage: stageFor(lift01),
    shadowHold01: 1 - lift01,
    dispersal01: hasClock ? dawnDispersal01(elapsedS, budgetS) : 0,
  };
}

/**
 * The authored light at a point, as dawn leaves it.
 *
 * The level still owns where the lamps and the unlit corners are; this only
 * raises the whole authored field toward daylight, so an alley stays darker than
 * a lamplit doorway right up until neither of them hides anybody. Which is the
 * behaviour that makes the mechanic legible: the player keeps using the same
 * dark places and can feel them stop working.
 */
export function dawnLightLevel(authored: number, lift01: number): number {
  const base = clamp01(authored);
  return clamp01(base + (1 - base) * clamp01(lift01));
}

/**
 * How many of a cluster's bodies are still there, given how far dawn has come.
 *
 * The floor is the engine's own blend threshold minus one, so a fully dispersed
 * crowd cannot hide anybody whatever the level authored — that is the mechanical
 * promise being made, and deriving it from `crowdBlendMinDensity` is how it stays
 * true if the engine retunes. Monotonic in `dispersal01`, so a body that has gone
 * home never comes back.
 */
export function crowdKept(count: number, dispersal01: number): number {
  if (count <= 0) return 0;
  const floor = Math.min(count, STEALTH_TUNING.crowdBlendMinDensity - 1);
  const kept = Math.round(count + (floor - count) * clamp01(dispersal01));
  return Math.max(0, Math.min(count, kept));
}

/**
 * A departure order for one crowd, stable for the whole attempt.
 *
 * Seeded off the attempt so two attempts empty the square differently, and
 * projected rather than drawn per tick so the order cannot drift: the same
 * civilian is always the third to leave. `Math.random` would make an attempt
 * unreplayable and is banned in gameplay code for exactly this reason.
 */
function departureRank(seed: number, id: string): number {
  return projectFieldSeed([seed, "dawn-departure", id]);
}

/**
 * The civilians still in the street, once dawn has sent the rest home.
 *
 * Returns the input array UNCHANGED, by reference, while nobody has left. That
 * identity is load-bearing twice over: the container skips recounting crowd
 * density on an unchanged list, and the stage only rebuilds its cast when the
 * array of ids changes. A fresh copy every tick would quietly turn a stationary
 * crowd into sixty re-renders a second.
 *
 * Thinned per cluster rather than globally so every crowd empties together —
 * a global order would strip one square bare while another stayed full.
 */
export function disperseAtDawn(
  civilians: readonly MissionCivilian[],
  dispersal01: number,
  seed: number,
): readonly MissionCivilian[] {
  if (dispersal01 <= 0 || civilians.length === 0) return civilians;

  const byCluster = new Map<string, MissionCivilian[]>();
  for (const civilian of civilians) {
    const key = civilian.clusterId ?? "";
    const group = byCluster.get(key);
    if (group) group.push(civilian);
    else byCluster.set(key, [civilian]);
  }

  const staying = new Set<string>();
  for (const group of byCluster.values()) {
    const kept = crowdKept(group.length, dispersal01);
    if (kept === group.length) {
      for (const civilian of group) staying.add(civilian.id);
      continue;
    }
    const order = [...group].sort(
      (a, b) => departureRank(seed, a.id) - departureRank(seed, b.id),
    );
    for (let index = 0; index < kept; index += 1) {
      staying.add(order[index]!.id);
    }
  }

  if (staying.size === civilians.length) return civilians;
  return civilians.filter((civilian) => staying.has(civilian.id));
}

// ---------------------------------------------------------------------------
// the palette
//
// One set of stops, shared by the sky and by the HUD's dawn band, so the strip
// over the clock is literally the colour of the sky it is reporting. The last
// stop is the daylight the stage used to draw unconditionally: sun-up is the old
// look, and everything before it is the night the mission is actually set in.
// ---------------------------------------------------------------------------

/**
 * Renderer exposure, fixed for the whole mission.
 *
 * Fixed on purpose: an exposure that tracked the frame would be an automatic
 * gain control, and a stealth mission whose picture brightens whenever the
 * player steps into the dark has thrown away the thing the player is choosing
 * between. The dark gets darker on screen because the light rig says so, not
 * because a curve gave up.
 */
export const MISSION_EXPOSURE = 1;

export interface DawnSkyStop {
  readonly at: number;
  /** Background and fog colour, as a hex string both CSS and three.js accept. */
  readonly sky: string;
  /** The eastern band, which warms long before the sky above does. */
  readonly horizon: string;
  readonly fogDensity: number;
  /** Hemisphere light intensity. */
  readonly ambient: number;
  /** Hemisphere upper and lower colours. */
  readonly hemiSky: string;
  readonly hemiGround: string;
  readonly sunColour: string;
  readonly sunIntensity: number;
  /** Sun elevation in degrees. Low is a long raking shadow, which dawn is. */
  readonly sunElevationDeg: number;
  /**
   * What the town's own lamps are still worth, [0,1].
   *
   * Lanterns are the whole of the mission's local contrast, so they cannot be a
   * constant: a lamp that still reads as a pool of light at sun-up would be the
   * one thing on screen refusing to admit the night is over. It falls faster
   * than the sky rises, because a lamp stops being *visible* long before it
   * stops being *lit* — by first light the flame is still burning and is no
   * longer doing anything for you.
   *
   * Display only. The stealth field's light term is the authored volume in
   * `MissionLevel.light`, lifted by `dawnLightLevel`, and neither reads this.
   */
  readonly lanternGain: number;
}

// The intensities below are roughly an order of magnitude above the ones this
// table shipped with, and that is a correction rather than a brightening.
//
// three has not scaled light intensity by PI since r155, and a Lambert surface
// returns `irradiance * albedo / PI`. At the old `ambient: 0.46` a mid colonial
// wall therefore left the shader at 0.0024 linear — and three's ACES filmic
// curve, which R3F installs by default, evaluates its numerator as
// `x(x + 0.0245786) - 0.000090537`, which is NEGATIVE below 0.00325 and clamps
// to zero. So the city was not dim, it was arithmetically clipped to #000000,
// and the only things anybody could see were the character rigs whose albedo
// was wired as an emissive texture and so bypassed lighting entirely. The stage
// now tone-maps with the Khronos neutral curve — see `MISSION_EXPOSURE` and the
// note on the canvas — which is linear through the bottom of the range, and
// these numbers are solved against it for a measured target rather than chosen
// by eye.
//
// What is targeted at each stop is the sRGB an UNLIT mid wall lands on: 0.115
// at full dark, rising to 0.62 at sun-up. Unlit is the operative word. The
// contrast the player reads the city by is `M1Lanterns`, whose pools put the
// same wall between 0.28 and 0.50 within a few metres of a flame, so standing
// in the light stays worth three or four times the picture that standing out of
// it is. A uniform lift of the floor would have bought the same visibility and
// thrown that away.
const SKY_STOPS: readonly DawnSkyStop[] = [
  {
    at: 0,
    sky: "#0a1220",
    horizon: "#101c2e",
    // Thinner than it was. Exponential-squared fog at 0.026 took two thirds of a
    // building at forty metres, and this mission's wayfinding is landmarks — the
    // Town House, the steeple, the elm — none of which can be aimed at through
    // fog that has already eaten them.
    fogDensity: 0.016,
    ambient: 3.35,
    hemiSky: "#3f5c86",
    hemiGround: "#141a22",
    sunColour: "#8ea6cc",
    // The moon rather than the sun, and worth about a fifth of the picture at
    // this stop. Not for brightness: a purely hemispherical night has no
    // direction in it, so a roof plane and a wall plane resolve to the same
    // value, and that is the one read a rooftop route cannot afford to lose.
    sunIntensity: 0.25,
    sunElevationDeg: 5,
    lanternGain: 1,
  },
  {
    // Front-loaded deliberately: dark values are where the eye reads a relative
    // change most easily, so the first stretch of the night has to move the
    // colour even though the lift is small, or a player concludes nothing is
    // happening and stops treating the sky as a clock.
    at: 0.12,
    sky: "#132132",
    horizon: "#22304a",
    fogDensity: 0.0155,
    ambient: 3.98,
    hemiSky: "#4a668c",
    hemiGround: "#171d26",
    sunColour: "#93aad0",
    sunIntensity: 0.37,
    sunElevationDeg: 5,
    lanternGain: 0.94,
  },
  {
    at: 0.3,
    sky: "#22334a",
    horizon: "#42405a",
    fogDensity: 0.0145,
    ambient: 5.12,
    hemiSky: "#5c789c",
    hemiGround: "#1d2229",
    sunColour: "#b8aecb",
    sunIntensity: 0.7,
    sunElevationDeg: 6,
    lanternGain: 0.72,
  },
  {
    at: DAWN.liftAtDawn,
    sky: "#425468",
    horizon: "#8f6f62",
    fogDensity: 0.0125,
    ambient: 6.36,
    hemiSky: "#7c92ad",
    hemiGround: "#28271f",
    sunColour: "#dda484",
    sunIntensity: 1.98,
    sunElevationDeg: 7,
    lanternGain: 0.4,
  },
  {
    at: 0.8,
    sky: "#6c8098",
    horizon: "#c58d69",
    fogDensity: 0.0105,
    ambient: 6.94,
    hemiSky: "#a8c0dc",
    hemiGround: "#332f27",
    sunColour: "#f5b385",
    sunIntensity: 4.92,
    sunElevationDeg: 10,
    lanternGain: 0.12,
  },
  {
    // The daylight the stage used to draw unconditionally, in a mission written
    // as happening before dawn. Sun-up is therefore the old look exactly, and
    // everything above it is the night that was missing.
    at: 1,
    sky: "#8c9db1",
    horizon: "#c9c0ae",
    fogDensity: 0.008,
    ambient: 9,
    hemiSky: "#cddcf0",
    hemiGround: "#3c3a34",
    sunColour: "#fff3df",
    sunIntensity: 7.12,
    sunElevationDeg: 24,
    // Out. Not dimmed to a token: the lamps were lit against a night that has
    // ended, and a player who overran the clock should be able to watch the town
    // stop helping them hide.
    lanternGain: 0,
  },
];

function mixChannel(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * t);
}

/** Linear hex mix. Both consumers take `#rrggbb`, so no colour object is needed. */
function mixHex(from: string, to: string, t: number): string {
  const a = Number.parseInt(from.slice(1), 16);
  const b = Number.parseInt(to.slice(1), 16);
  const r = mixChannel((a >> 16) & 0xff, (b >> 16) & 0xff, t);
  const g = mixChannel((a >> 8) & 0xff, (b >> 8) & 0xff, t);
  const blue = mixChannel(a & 0xff, b & 0xff, t);
  return `#${((r << 16) | (g << 8) | blue).toString(16).padStart(6, "0")}`;
}

/** The sky at a point on the clock. Interpolated, so nothing steps. */
export function dawnSky(lift01: number): DawnSkyStop {
  const lift = clamp01(lift01);
  let lower = SKY_STOPS[0]!;
  let upper = SKY_STOPS[SKY_STOPS.length - 1]!;
  for (let index = 0; index < SKY_STOPS.length - 1; index += 1) {
    const a = SKY_STOPS[index]!;
    const b = SKY_STOPS[index + 1]!;
    if (lift >= a.at && lift <= b.at) {
      lower = a;
      upper = b;
      break;
    }
  }
  const span = upper.at - lower.at;
  const t = span > 0 ? clamp01((lift - lower.at) / span) : 0;
  return {
    at: lift,
    sky: mixHex(lower.sky, upper.sky, t),
    horizon: mixHex(lower.horizon, upper.horizon, t),
    fogDensity: lower.fogDensity + (upper.fogDensity - lower.fogDensity) * t,
    ambient: lower.ambient + (upper.ambient - lower.ambient) * t,
    hemiSky: mixHex(lower.hemiSky, upper.hemiSky, t),
    hemiGround: mixHex(lower.hemiGround, upper.hemiGround, t),
    sunColour: mixHex(lower.sunColour, upper.sunColour, t),
    sunIntensity:
      lower.sunIntensity + (upper.sunIntensity - lower.sunIntensity) * t,
    sunElevationDeg:
      lower.sunElevationDeg +
      (upper.sunElevationDeg - lower.sunElevationDeg) * t,
    lanternGain:
      lower.lanternGain + (upper.lanternGain - lower.lanternGain) * t,
  };
}

// ---------------------------------------------------------------------------
// copy
//
// Kept beside the model rather than in the HUD so a test can assert that the
// words a player reads match the mechanic that is running. "Shadows thinning"
// while the light term has not moved would be the worst kind of bug on this
// surface: the player would learn to distrust the readout.
// ---------------------------------------------------------------------------

const STAGE_COPY: Readonly<Record<DawnStage, string>> = {
  LAST_DARK: "Full dark",
  FIRST_LIGHT: "First light",
  GREY: "Greying",
  DAWN: "Dawn",
  SUN_UP: "Sun up",
};

export function dawnStageLabel(stage: DawnStage): string {
  return STAGE_COPY[stage];
}

/** What the dark is still doing for you, in the player's words. */
export function shadowLabel(read: DawnRead): string {
  if (read.shadowHold01 > 0.88) return "The dark holds";
  if (read.shadowHold01 > 0.6) return "Shadows thinning";
  if (read.shadowHold01 > 0.3) return "Little cover left";
  if (read.shadowHold01 > 0.08) return "The dark is nearly gone";
  return "No dark left";
}

/**
 * What the crowd is still doing for you, from the density the field counted.
 *
 * Takes the counted number rather than the dispersal model, so this cannot claim
 * cover the field is not granting: `crowdBlendMinDensity` is the same threshold
 * `clusterContaining` tests, and the count is the bodies actually drawn.
 */
export function crowdLabel(thickestDensity: number): string {
  if (thickestDensity < STEALTH_TUNING.crowdBlendMinDensity) {
    return "Crowds gone — nothing to hide in";
  }
  if (thickestDensity < STEALTH_TUNING.crowdBlendMinDensity + 3) {
    return "Crowds thinning fast";
  }
  return "Crowds still thick";
}
