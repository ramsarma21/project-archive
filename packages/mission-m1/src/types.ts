// Authored level schema. Thirteen more missions follow M1, so nothing here is
// M1-specific: this file is the format, `level/` is the content, and
// `compile.ts` turns the content into the engine's collision representation.
//
// Rule of the format: geometry is declared once, as *masses* (solid volumes)
// and *decks* (thin walkable surfaces). Everything else — route, patrols,
// cover, catches — refers to those by id. There is no second collision model.

import type { RouteLine } from "./envelope.js";

export type Vec3Tuple = [number, number, number];
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export type SectionId =
  | "A_LEADS"
  | "B_SHAMBLES"
  | "B2_THRONG"
  | "C_ASCENT"
  | "D_ROOFLINE"
  | "D2_ROPEWALK"
  | "E_LEAP"
  | "F_TREE"
  | "G_YARD";

/** Which of the base parkour verbs a piece of geometry exists to show off. */
export type Verb =
  | "RUN"
  | "CHAIN_DROP"
  | "VAULT"
  | "MANTLE"
  | "CLIMB"
  | "DASH"
  | "LEAP"
  | "LEAP_OF_FAITH"
  | "DUCK_UNDER"
  | "BLEND"
  | "DIVERT"
  | "REFLEX"
  | "PRECISION"
  | "SLIDE"
  | "STEP_UP"
  | "CLIMB_OVER";

// ---------------------------------------------------------------------------
// geometry
// ---------------------------------------------------------------------------

/**
 * A solid volume. `topY = Infinity` is a full-height wall. A finite `topY`
 * with `landable` exposes its top as a surface (crates, carts, cover).
 */
export interface MassSpec {
  id: string;
  section: SectionId;
  /** Stable art key; see assets.ts. `null` for invisible collision only. */
  asset: string | null;
  rect: Rect;
  baseY: number;
  topY: number;
  landable: boolean;
  /** Rotation of the exact footprint, radians. Omitted = axis aligned. */
  yaw?: number;
  /** Round footprint (tree trunks, posts, capstans) instead of a box. */
  round?: { radius: number };
  tags: string[];
  note?: string;
}

/**
 * A thin support surface at a fixed height: roof decks, planks, awnings,
 * galleries, boughs. Decks never occlude sight and never block movement — they
 * only catch a descending capsule, which is exactly what a roof should do.
 */
export interface DeckSpec {
  id: string;
  section: SectionId;
  asset: string | null;
  rect: Rect;
  y: number;
  /** Mass ids this deck sits on; the jetty invariant is checked against them. */
  carriedBy: string[];
  tags: string[];
  note?: string;
}

/** A walkable slope, emitted as stepped strips because the mover snaps 6cm. */
export interface RampSpec {
  id: string;
  section: SectionId;
  asset: string | null;
  /** Travel axis; strips are laid perpendicular to it. */
  axis: "X" | "Z";
  from: { at: number; y: number };
  to: { at: number; y: number };
  /** Half width across the travel axis. */
  halfWidth: number;
  /** Fixed coordinate on the non-travel axis. */
  cross: number;
  tags: string[];
}

// ---------------------------------------------------------------------------
// route
// ---------------------------------------------------------------------------

export type LinkKind =
  | "RUN"
  | "RAMP"
  | "VAULT"
  | "MANTLE"
  | "CLIMB"
  | "DROP"
  | "JUMP"
  /**
   * A jump taken out of a burst.
   *
   * Its own kind rather than a JUMP with a faster `speedMps`, because the two
   * are verified against different ceilings and must never be confused: a JUMP
   * is budgeted against `levelDesignMaxGapM`, which every player clears without
   * pressing anything, while this reaches past it. The verifier supplies the
   * burst speed itself — an author may not pick it — and refuses a DASH_JUMP
   * over a gap a running jump would make anyway, because that would be a link
   * claiming to need a verb it does not.
   *
   * A DASH_JUMP may never sit on the guaranteed path. See `dash.test.ts`.
   */
  | "DASH_JUMP"
  | "LEAP_OF_FAITH"
  | "DUCK_UNDER"
  | "BLEND"
  | "PRECISION";

export interface RouteNode {
  id: string;
  section: SectionId;
  pos: Vec3Tuple;
  /** Deck or mass id the node stands on. Verified against `supportBelow`. */
  surface: string;
  tags: string[];
  note?: string;
}

export interface RouteLink {
  id: string;
  from: string;
  to: string;
  kind: LinkKind;
  /**
   * SAFE lines are on the guaranteed path and spend only part of the gap
   * budget; FAST and EXPERT may sit against it.
   */
  line: RouteLine;
  verb: Verb;
  /** LEAP_OF_FAITH only: the receiving target this dive is authored to hit. */
  target?: string;
  /** Obstacle ids ignored during an authored affordance. */
  ignore?: string[];
  /** Overrides the derived duration when the beat is authored (precision). */
  fixedMs?: number;
  /** Ground speed the player is assumed to hold along a RUN/BLEND link. */
  speedMps?: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// opposition
// ---------------------------------------------------------------------------

export interface PatrolSpec {
  id: string;
  section: SectionId;
  asset: string;
  role: string;
  kind: "PATROL" | "POSTED";
  /** PATROL: walked out-and-back. POSTED: single point. */
  waypoints: Vec3Tuple[];
  speedMps: number;
  /** Body height; the eye landmark is derived from it by the stealth field. */
  capsuleHeightM: number;
  coneHalfAngleDeg: number;
  rangeM: number;
  /** Head sweep either side of the base facing. */
  scanAmplitudeDeg: number;
  scanRateDegPerSec: number;
  /** POSTED only: the facing the sweep is centred on. */
  baseYaw: number;
  /** The collider the watcher is standing in or on; it must not blind him. */
  perchIgnore: string[];
  /** Seeded start phases, in seconds. §4.13 wants at least three. */
  phaseOffsetsS: number[];
  /** What this cone is supposed to deny; the stealth test asserts it. */
  denies: string[];
  note?: string;
}

export interface DiversionAnchor {
  id: string;
  section: SectionId;
  asset: string;
  /** Nodes the player can realistically throw from. */
  throwFromNodes: string[];
  landsAt: Vec3Tuple;
  noiseRadiusM: number;
  pullsPatrols: string[];
  /** Route link ids this throw is meant to make safe. */
  opensLinks: string[];
  /**
   * Bodies standing between a throw anchor and the aim point. A throw that
   * falls short strikes one of them and puts the noise beside the player
   * instead of away from them, which is the whole risk of the verb.
   */
  bodiesInLine?: Vec3Tuple[];
  note?: string;
}

/**
 * A knot of civilians, compiled straight into the stealth field's CrowdCluster.
 * `civilians` is a count, not a density: the field refuses to hide anybody in a
 * cluster below STEALTH_TUNING.crowdBlendMinDensity.
 */
export interface BlendVolume {
  id: string;
  section: SectionId;
  asset: string;
  centre: Vec3Tuple;
  radiusM: number;
  civilians: number;
  note?: string;
}

/**
 * Authored light. The mission runs before dawn, and `visibility` takes light as
 * an input, so an unlit colonnade is a stealth tool that costs nothing to build.
 * Smallest volume containing a point wins, so a lantern pool inside a dark
 * arcade reads correctly.
 */
export interface LightVolume {
  id: string;
  section: SectionId;
  rect: Rect;
  /** [0,1]. 1 is full daylight; the tuned dark factor is 0.45 at zero. */
  level: number;
  note?: string;
}

/**
 * A receiving target for a leap of faith. The parkour system captures a dive
 * against an explicit point and radius rather than against whatever collider
 * happens to be underneath, so these are declared, not inferred, and compile
 * straight into `ReceivingTarget`.
 */
export interface CatchVolume {
  id: string;
  section: SectionId;
  kind: "HAY" | "AWNING" | "CANOPY" | "BOUGH" | "NETTING";
  asset: string;
  /** Centre of the accepting surface. */
  centre: Vec3Tuple;
  /** Horizontal acceptance radius. */
  radiusM: number;
  /** True when this target may be offered as a leap-of-faith destination. */
  offersLeap: boolean;
  note?: string;
}

// ---------------------------------------------------------------------------
// set pieces
// ---------------------------------------------------------------------------

export interface PrecisionPattern {
  id: string;
  /** One entry per tack: beat offset in ms from the start of the pattern. */
  beatsMs: number[];
  /** Half-width of the hit window, ms. */
  windowMs: number;
}

export interface PrecisionBeat {
  id: string;
  section: SectionId;
  /** Where the handbill goes. */
  target: Vec3Tuple;
  /** Where the player's feet are while doing it. */
  stance: Vec3Tuple;
  stanceSurface: string;
  facingYaw: number;
  patterns: PrecisionPattern[];
  /** Average normalised quality needed to clear. */
  passQuality: number;
  minPhaseQuality: number;
  note?: string;
}

export interface CoverPiece {
  id: string;
  massId: string;
  /** LOW breaks sight on a crouched body, HIGH on a standing one. */
  grade: "LOW" | "HIGH";
}

export interface BreakStation {
  id: string;
  round: number;
  /** Where the boss goes to break sight. */
  pos: Vec3Tuple;
  /** Where he leans back out from. */
  peek: Vec3Tuple;
  /** The cover this station is honest about hiding behind. */
  behind: string[];
  note?: string;
}

export interface DuelArena {
  id: string;
  section: SectionId;
  bounds: Rect;
  floorY: number;
  gateNodeId: string;
  playerSpawn: Vec3Tuple;
  bossSpawn: Vec3Tuple;
  rounds: number;
  roundSeconds: number;
  cover: CoverPiece[];
  breakStations: BreakStation[];
  /** Sampled positions a player will actually fight from. */
  playerStations: Vec3Tuple[];
}

// ---------------------------------------------------------------------------
// pacing + the level itself
// ---------------------------------------------------------------------------

export interface SectionSpec {
  id: SectionId;
  title: string;
  /** The verb this section exists to show off. */
  builtAround: Verb;
  /** Design intent, in one sentence, for whoever tunes it later. */
  intent: string;
  budgetS: number;
  street: string;
  /**
   * Seconds a competent player is expected to lose in this section to being
   * read and having to change line. Authored rather than derived, and stated
   * rather than buried: it is a design allowance, not a measurement.
   */
  rerouteBudgetS: number;
}

export interface MissionLevel {
  id: string;
  title: string;
  date: string;
  bounds: Rect;
  missionClockS: number;
  sections: SectionSpec[];
  masses: MassSpec[];
  decks: DeckSpec[];
  ramps: RampSpec[];
  nodes: RouteNode[];
  links: RouteLink[];
  patrols: PatrolSpec[];
  diversions: DiversionAnchor[];
  blend: BlendVolume[];
  light: LightVolume[];
  catches: CatchVolume[];
  precision: PrecisionBeat;
  arena: DuelArena;
  startNode: string;
  postNode: string;
  arenaNode: string;
}
