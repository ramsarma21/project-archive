import { M1_EFFIGY_RUN, lightLevelAt } from "@pa/mission-m1";

// ---------------------------------------------------------------------------
// Where the town's lamps are, and what each kind of flame is worth.
//
// Data only, and deliberately importable without three or React so the tests
// that hold the design's promises can run in plain node. `M1Lanterns.tsx` turns
// it into geometry and lights; nothing here knows what a renderer is.
//
// The promise being held is this: M1's stealth field reads light out of
// `MissionLevel.light`, eleven authored rectangles running from the Dassett
// alley at 0.06 to Dock Square at 0.95, and until this rig existed the renderer
// drew all of them identically. Every anchor below therefore sits inside a
// rectangle the level already calls lit, so what a player sees is what the
// simulation is scoring them against. `lanternsStandInAuthoredLight` fails the
// build if a lamp ever drifts into the dark.
// ---------------------------------------------------------------------------

/** The level's own pre-dawn ambient, for points inside no authored volume. */
export const AMBIENT_LIGHT = 0.34;

export type LanternKind = "BRACKET" | "CRESSET" | "SCONCE";

export interface Lantern {
  readonly id: string;
  /** Feet of the prop, in world metres. The flame sits `flameY` above it. */
  readonly pos: readonly [number, number, number];
  readonly kind: LanternKind;
  /** Facing, for the bracket's arm. Radians about Y. */
  readonly yaw?: number;
  /** Multiplier on the kind's standing intensity, for a lamp meant to be weak. */
  readonly gain?: number;
  /**
   * A visible flame that lights nothing, for a lamp standing where the stealth
   * field scores darkness.
   *
   * The two candle ends on the ropewalk's south wall are the only ones. Twenty-
   * two metres of unlit shed with vertical traversal in it is unplayable if the
   * player cannot tell which way the building runs, and it stops being the
   * darkest place in the mission the moment anything actually lights it. A flame
   * with no point light behind it answers "where am I facing" and contributes
   * nothing to "can I be seen" — which is exactly the split the field draws, and
   * so is the only kind of lamp that may stand in the dark honestly.
   */
  readonly glowOnly?: boolean;
}

export interface LanternKindSpec {
  readonly asset: string;
  readonly path: string;
  /** Fitted footprint, metres. */
  readonly size: readonly [number, number, number];
  /** Height of the flame above the prop's feet. */
  readonly flameY: number;
  readonly colour: string;
  /** three point-light intensity at full `lanternGain`. */
  readonly intensity: number;
  /** Cut-off radius. Beyond it the lamp contributes exactly nothing. */
  readonly distance: number;
  /** Flame sprite size, metres at one metre. */
  readonly flameSize: number;
}

/**
 * The three kinds of flame in 1765 Boston, as this mission uses them.
 *
 * The intensities are solved rather than dialled. three has not scaled light
 * intensity by PI since r155 and a Lambert surface returns `irradiance *
 * albedo / PI`, so a point light of intensity I at distance d leaves a mid wall
 * at roughly `0.05 * I / d²` linear. A bracket at 22 therefore puts a wall at
 * about 0.28 sRGB two metres away and 0.13 at five, against an unlit night wall
 * at 0.115 — a pool three or four metres across with real dark beyond it, which
 * is the shape a stealth street wants. Raising these until the whole street was
 * lit would have produced the same visibility and destroyed the choice.
 */
export const LANTERN_KINDS: Readonly<Record<LanternKind, LanternKindSpec>> = {
  // Whale-oil lantern on a wrought-iron wall bracket. The street standard.
  BRACKET: {
    asset: "street-lantern-bracket",
    path: "world/props/street-lantern-bracket.glb",
    size: [0.72, 0.86, 0.46],
    flameY: 0.46,
    colour: "#ffb765",
    intensity: 22,
    distance: 14,
    flameSize: 0.5,
  },
  // A burning brand on a stand: the market's cressets and the crowd's torches
  // under the elm. Brighter and lower than a bracket, and it throws its light
  // across a floor rather than down a wall.
  CRESSET: {
    asset: "protest-torch",
    path: "world/props/protest-torch.glb",
    size: [0.26, 1.55, 0.26],
    flameY: 1.5,
    colour: "#ff9d4d",
    intensity: 40,
    distance: 20,
    flameSize: 0.78,
  },
  // Tallow indoors. Weak on purpose — a sconce shows you a wall, not a room.
  SCONCE: {
    asset: "candle-sconce",
    path: "world/props/candle-sconce.glb",
    size: [0.34, 0.44, 0.24],
    flameY: 0.3,
    colour: "#ffc98a",
    intensity: 11,
    distance: 9,
    flameSize: 0.34,
  },
};

/**
 * Where the town's lamps are.
 *
 * Read off `LIGHT`, `DOCK_LIGHT` and `ROPEWALK_LIGHT` in the level package
 * rather than invented: each group names the authored volume it belongs to and
 * quotes the note that volume already carried. The DARK volumes appear here
 * only by their absence, and that absence is the whole design — a lantern in
 * the Dock arcade would take the quiet crossing away from the player in the
 * renderer while the field went on insisting the crossing was still quiet, and
 * a player who learns the picture is lying stops using either.
 */
export const M1_LANTERNS: readonly Lantern[] = [
  // -- LIGHT_QUEEN_STREET, 0.55: "Shop lanterns still burning on Queen Street.
  // Bright enough that the street line costs you something from the first
  // second." Four shopfronts, so the opening thirty metres has somewhere to
  // aim at and the roofline above it stays the darker choice.
  { id: "LAMP_QUEEN_W_N", pos: [3.2, 3.4, -3.5], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_QUEEN_W_S", pos: [6.4, 3.2, 3.5], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_QUEEN_MID", pos: [10.2, 3.4, -3.5], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_QUEEN_E", pos: [14.6, 3.2, 3.4], kind: "BRACKET", yaw: Math.PI },

  // -- LIGHT_SHAMBLES, 0.70: "Butchers work before dawn and they work by
  // lamplight." The brightest street on the route and the one the fast line
  // runs down, which is exactly why taking it costs from the first second.
  { id: "LAMP_SHAM_0", pos: [19.6, 3.1, -2.9], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_SHAM_1", pos: [24.0, 3.1, 2.9], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_SHAM_2", pos: [28.6, 3.1, -2.9], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_SHAM_3", pos: [33.2, 3.1, 2.9], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_SHAM_4", pos: [37.8, 3.1, -2.9], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_SHAM_5", pos: [41.0, 3.1, 2.9], kind: "BRACKET", yaw: Math.PI },

  // -- LIGHT_DOCK_SQUARE, 0.95: "Cresset light over the market floor. The crowd
  // is here, and so is the light." The most exposed ground in the mission, and
  // the crossing where blending in is the only thing keeping you. It now looks
  // like what it costs.
  { id: "CRESSET_DOCK_W", pos: [30.2, 0, 10.4], kind: "CRESSET" },
  { id: "CRESSET_DOCK_N", pos: [31.4, 0, 17.8], kind: "CRESSET" },
  { id: "CRESSET_DOCK_E", pos: [38.8, 0, 12.2], kind: "CRESSET" },
  { id: "CRESSET_DOCK_S", pos: [36.6, 0, 18.4], kind: "CRESSET" },

  // -- LIGHT_TOWNHOUSE_SQUARE, 0.50. Kept off the north side entirely: the lane
  // at z -11.2..-5.5 is authored at 0.15 and is the reason the scaffolding is
  // the fast way up, so nothing here may throw light into it.
  { id: "LAMP_TH_W", pos: [44.4, 3.4, 4.6], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_TH_SW", pos: [48.6, 3.4, 9.2], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_TH_S", pos: [54.4, 3.4, 9.6], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_TH_SE", pos: [60.2, 3.4, 6.4], kind: "BRACKET", yaw: Math.PI },
  { id: "LAMP_TH_E", pos: [61.0, 3.4, -2.4], kind: "BRACKET", yaw: 0 },
  { id: "LAMP_TH_CIVIC", pos: [50.4, 4.6, -3.2], kind: "BRACKET", yaw: 0 },

  // -- LIGHT_ROPEWALK_DOOR, 0.70: "Lamplight through the open door. The exit is
  // the one lit patch inside, so leaving is the exposed part." One lamp, at the
  // door, doing precisely what the volume already said it did — and from inside
  // twenty-two metres of black shed it is the only thing telling you which end
  // of the building you are looking at.
  { id: "LAMP_ROPE_DOOR", pos: [75.0, 2.5, 17.5], kind: "BRACKET", yaw: Math.PI },

  // -- LIGHT_ROPEWALK_NIGHTMAN, 0.55, the one volume this work added to the
  // level. See the note on it in level/ropewalk.ts: the night man and his
  // lantern were in the authoring of both D2_BEAM_E and the loud descent, and
  // in neither the scene nor the field.
  { id: "LAMP_ROPE_NIGHTMAN", pos: [72.6, 1.15, 23.6], kind: "SCONCE", yaw: 0 },

  // -- inside LIGHT_ROPEWALK, 0.10. Two tallow ends on the south wall, and they
  // light nothing at all — see `glowOnly`. They are landmarks, not lamps: two
  // marks on a wall twenty-two metres apart tell a player standing on an unlit
  // floor which way the shed runs and how far down it they have got, and they
  // leave the field's 0.10 exactly where the level put it. The darkest place in
  // the mission stays the darkest place in the mission.
  { id: "SCONCE_ROPE_MID", pos: [66.4, 1.9, 26.4], kind: "SCONCE", yaw: Math.PI, glowOnly: true },
  { id: "SCONCE_ROPE_W", pos: [59.8, 1.9, 26.4], kind: "SCONCE", yaw: Math.PI, glowOnly: true },

  // -- LIGHT_LIBERTY_CORNER, 0.85: "Torches under the elm. The crowd brought
  // them, and they are why the precision beat happens somewhere you can be
  // seen." Ringed round the trunk, which makes the elm the brightest thing in
  // Boston from the Town House leads — the landmark the whole second half of
  // the route is aimed at, and the answer to not knowing where to go.
  { id: "TORCH_ELM_SW", pos: [76.8, 0, -4.0], kind: "CRESSET" },
  { id: "TORCH_ELM_NW", pos: [77.2, 0, 4.4], kind: "CRESSET" },
  { id: "TORCH_ELM_SE", pos: [84.2, 0, -3.6], kind: "CRESSET" },
  { id: "TORCH_ELM_NE", pos: [84.8, 0, 3.4], kind: "CRESSET" },
  { id: "TORCH_ELM_N", pos: [80.4, 0, 5.8], kind: "CRESSET" },
  { id: "TORCH_ELM_S", pos: [80.8, 0, -5.6], kind: "CRESSET" },
];

/**
 * Point lights mounted, always, whatever is on screen.
 *
 * Fixed forever rather than sized to what is visible, because three compiles a
 * material variant per light count: a rig that mounted and unmounted lights as
 * the player walked would recompile every material in the city at every
 * junction, which is a hitch in exactly the place a hitch is least affordable.
 *
 * Eleven is not a guess and is not round. `lanternContribution` says what each
 * lamp is actually worth at a point, the pool spends its slots on the ones worth
 * most, and `spilledLanternContribution` measures what the first lamp to miss
 * out would have added, over every node on the route. That number is 42% of the
 * night's ambient at six slots, 18% at eight, 5% at ten and exactly zero at
 * eleven — which is to say eleven is the count at which the fixed pool stops
 * being an approximation of the town's lighting and starts being all of it.
 * Twelve would cost the same per fragment and buy nothing.
 *
 * The crowding is all at one place, and it is the right place: the Shambles runs
 * into Dock Square around x 34-45, so six street brackets and four market
 * cressets are in range at once. That junction is also the most exposed ground
 * in the mission.
 */
export const LANTERN_POOL = 11;

/**
 * Radiance an unlit mid wall sits at through the night, linear.
 *
 * Solved from the first sky stop in dawn.ts and repeated here as a number rather
 * than imported, because this file must stay free of the renderer. It is the
 * yardstick every lamp is measured against: "worth a slot" means "adds a
 * noticeable fraction of the dark".
 */
export const NIGHT_WALL_RADIANCE = 0.0125;

/** Where a lantern's flame is, which is where its light and its sprite go. */
export function flamePoint(lantern: Lantern): [number, number, number] {
  const spec = LANTERN_KINDS[lantern.kind];
  return [lantern.pos[0], lantern.pos[1] + spec.flameY, lantern.pos[2]];
}

/** Relative luminance of an `#rrggbb` colour, in linear light. */
function linearLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const srgb = ((value >> shift) & 0xff) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
}

/**
 * What one lamp is worth at a point, as linear radiance on a facing mid wall.
 *
 * three's own model, not an approximation of it: inverse-square falloff times
 * the `distance` window `(1 - (d/d0)^4)^2`, then Lambert's `albedo / PI`. The
 * window is why a lamp's useful reach is so much shorter than its cut-off — a
 * bracket set to fourteen metres has already lost four fifths of its strength by
 * twelve — and getting that right is what lets the pool be eight instead of
 * sixteen.
 *
 * Head-on and unoccluded, so this is an upper bound. That is the correct
 * direction for a test that has to prove a dropped lamp did not matter.
 */
export function lanternContribution(
  lantern: Lantern,
  point: readonly [number, number, number],
): number {
  if (lantern.glowOnly) return 0;
  const spec = LANTERN_KINDS[lantern.kind];
  const flame = flamePoint(lantern);
  const d = Math.hypot(flame[0] - point[0], flame[1] - point[1], flame[2] - point[2]);
  if (d >= spec.distance) return 0;
  const window = Math.pow(Math.max(1 - Math.pow(d / spec.distance, 4), 0), 2);
  const irradiance =
    (linearLuminance(spec.colour) * spec.intensity * (lantern.gain ?? 1) * window) /
    Math.max(d * d, 0.09);
  return (irradiance * 0.16) / Math.PI;
}

/**
 * The authored light level a lantern is standing in.
 *
 * The whole honesty check in one function: a lamp drawn somewhere the stealth
 * field scores as dark is a lie told to the player at the exact moment they are
 * choosing whether to cross.
 */
export function authoredLightAt(lantern: Lantern): number {
  return lightLevelAt(M1_EFFIGY_RUN, AMBIENT_LIGHT, lantern.pos[0], lantern.pos[2]);
}

/**
 * The most light the pool ever throws away, over a set of points.
 *
 * With more lamps in range than slots, the pool keeps the strongest and drops
 * the rest. This is what the strongest DROPPED lamp would have added, at its
 * worst point on the whole route — the honest measure of the cost of a fixed
 * pool, and the number the test bounds.
 */
export function spilledLanternContribution(
  points: readonly (readonly [number, number, number])[],
  pool: number = LANTERN_POOL,
  lanterns: readonly Lantern[] = M1_LANTERNS,
): { worst: number; atIndex: number } {
  let worst = 0;
  let atIndex = -1;
  points.forEach((point, index) => {
    const ranked = lanterns
      .map((lantern) => lanternContribution(lantern, point))
      .sort((a, b) => b - a);
    const spilled = ranked[pool] ?? 0;
    if (spilled > worst) {
      worst = spilled;
      atIndex = index;
    }
  });
  return { worst, atIndex };
}
