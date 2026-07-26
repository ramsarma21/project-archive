// ---------------------------------------------------------------------------
// The visor's palette, and the one place it is written down.
//
// The System is an object the player has already met: the hub is thin cyan-white
// holographic line work on dark glass, and the visor has to read as the same
// machine rather than as a tutorial layer wearing its colours. Every value here
// is the hub's or the mission HUD's, carried across so the two surfaces cannot
// drift apart:
//
//   CYAN / INK / DIM     `--hub-cyan`, `--hub-ink`, `--hub-ink-dim` in hub.css
//   TEAL                 `--hub-done`, and the mission HUD's met-objective green
//   ROSE                 the mission HUD's `.is-lost` warm rose
//   AMBER                the mission HUD's over-budget clock
//
// The semantic assignment matters more than the hex. Three route lines need three
// hues because telling them apart IS the lesson; danger needs a hue that is not
// one of them; and the two concealment tools the floor actually grants — dark and
// crowd — share the teal so that "this is a tool" is one read rather than two.
// ---------------------------------------------------------------------------

/** The System's own hue. SAFE lines, structure, chrome. */
export const VISOR_CYAN = "#9fdcff";
/** Near-white. The objective, and anything the eye must land on first. */
export const VISOR_INK = "#eaf8ff";
/** Recessive cyan, for range ticks and everything held back. */
export const VISOR_DIM = "#5f93bd";
/** FAST lines, and the concealment the floor grants: dark and crowd. */
export const VISOR_TEAL = "#7ee3d8";
/** EXPERT lines. Cool violet: still holographic, unmistakably not the other two. */
export const VISOR_VIOLET = "#c3b4ff";
/** Watchers, cones, and anything that ends an attempt. */
export const VISOR_ROSE = "#ffb0a0";
/** Light you can be seen in. The mission HUD's own warning warmth. */
export const VISOR_AMBER = "#f0cd94";

/** One route line's drawing treatment. */
export interface LineStyle {
  readonly colour: string;
  /** Core line opacity. SAFE reads brightest because it always works. */
  readonly opacity: number;
  /** World radius of the glow body around the core, in metres. */
  readonly glowRadiusM: number;
  /** Dash length in metres, or null for a continuous line. */
  readonly dashM: number | null;
  readonly label: string;
  /** What this line promises, in the player's words. Drawn once per line. */
  readonly promise: string;
}

/**
 * How each authored line is drawn.
 *
 * The dash pattern is doing real work rather than decoration: SAFE is unbroken
 * because it is unbroken — it always goes, and it demands no timing. FAST is
 * dashed because it wants a clean run-up, and EXPERT is finely dashed because it
 * sits against the envelope's wall. A player who reads nothing else has still
 * been told which of the three is the one that cannot fail them.
 */
export const LINE_STYLE: Record<"SAFE" | "FAST" | "EXPERT", LineStyle> = {
  SAFE: {
    colour: VISOR_CYAN,
    opacity: 0.95,
    glowRadiusM: 0.075,
    dashM: null,
    label: "SAFE",
    promise: "Always goes. Nothing to time.",
  },
  FAST: {
    colour: VISOR_TEAL,
    opacity: 0.8,
    glowRadiusM: 0.055,
    dashM: 0.7,
    label: "FAST",
    promise: "Shorter. Wants a run-up, and shows you to the street.",
  },
  EXPERT: {
    colour: VISOR_VIOLET,
    opacity: 0.72,
    glowRadiusM: 0.045,
    dashM: 0.32,
    label: "EXPERT",
    promise: "The ceiling. Full sprint, no margin.",
  },
};

/**
 * How far along the route the three lines are DRAWN rather than described.
 *
 * The whole range problem of a standing viewpoint is in this number, and the
 * first answer to it was wrong. Drawing every authored link whose ends both sat
 * inside 26m sounded like "the near field" and turned out to be 32 segments: the
 * opening, all three descents off the leads, both ways across Queen Street and
 * the shed roofs past it, crossing each other from one fixed eye height. A dozen
 * bright lines over a street that is silhouettes and fog at full dark is not a
 * briefing, it is a wireframe, and a player reads nothing out of it.
 *
 * 10m is the distance to the FORK, which is the only thing here a picture says
 * better than a sentence: run the rack, then choose your way down. It draws six
 * segments — one shared trunk and three branches — and ends them 11 to 13 metres
 * out, pointing. Everything past the fork is a thing to be discovered by playing,
 * which is the division the whole hold exists to hold.
 */
export const LINE_REACH_M = 10;

/**
 * The hard cap on any drawn node, whatever the walk out from the spawn says.
 *
 * A belt rather than a design decision. `LINE_REACH_M` decides how much of the
 * route is worth showing; this refuses to draw a line to somewhere the player is
 * not standing near, so a route graph carrying one bad link cannot put a bright
 * cyan line straight across the level. Route data is authored, verified and
 * revised, and the visor should degrade to saying less rather than to lying.
 */
export const NEAR_FIELD_M = 26;

/** Watchers inside this range get a drawn cone; the rest get a mark and a count. */
export const CONE_FIELD_M = 34;

/** The most cones ever drawn at once, however many watchers qualify. */
export const MAX_CONES = 2;
