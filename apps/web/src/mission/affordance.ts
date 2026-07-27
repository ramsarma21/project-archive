import {
  PARKOUR_TUNING,
  distanceToEdge,
  surveyHolds,
  type AffordanceHold as SurveyedHold,
  type TraversalVerb,
  type Vec3,
} from "@pa/engine-world";
import type { MissionRuntime } from "./traversal.js";

// ---------------------------------------------------------------------------
// What the player is shown about what their body can do.
//
// THE PROBLEM THIS EXISTS FOR. Ten of the twelve traversal verbs have no key.
// They fire off geometry, which is the right design and is the whole feel — but
// it only works if the architecture is readable, and a player who has never seen
// this game cannot tell a parapet they can catch from a wall they cannot. They
// have not been taught the vocabulary, so "read the roofline" is an instruction
// in a language nobody gave them.
//
// WHAT IS DRAWN AND WHERE IT COMES FROM. Nothing here decides what is climbable.
// `surveyHolds` puts that question to `probeAhead` and `rankVerbs` — the same two
// functions that will actually choose the verb a tenth of a second later — so the
// cue cannot promise a catch the physics will refuse, and cannot fall out of step
// when somebody tunes `climbMaxHeightM`. This file only decides HOW MUCH of that
// answer is worth showing, which is a question about attention rather than about
// physics, and therefore belongs on this side of the boundary.
//
// AND IT IS BUILT TO GO AWAY. The strength term below falls as the player
// actually performs verbs. A first-timer walking into the Shambles gets the
// district's catchable edges drawn for them; by the Town House they have vaulted
// four things and the same edges are a hairline; a player on their second run
// barely sees it. That ramp is the design — a permanent overlay would be a game
// that never stops explaining itself, and the run is meant to feel bare.
// ---------------------------------------------------------------------------

/** How far out edges are drawn at all. Past this the street is the street. */
const REACH_M = 15;
/**
 * Vertical band around the player's own footing.
 *
 * A hold six metres below is not something to climb, it is scenery, and a
 * rooftop player looking down at a lit market would otherwise get every crate
 * in it outlined. The band is generous upward — the tallest thing the ladder
 * will take is `climbMaxHeightM` — and short downward.
 */
const BAND_UP_M = PARKOUR_TUNING.climbMaxHeightM + 1;
const BAND_DOWN_M = 1.5;
/**
 * The most edges drawn at once.
 *
 * A market stall row surveys to fifty-odd holds and drawing them is a wireframe,
 * which teaches nothing: the player reads "everything is special", which is the
 * same information as "nothing is". Ten nearest is a handful the eye resolves.
 */
const MAX_DRAWN = 8;
/**
 * How much of one edge is drawn, in metres, centred on the nearest point of it.
 *
 * A surveyed face is as long as the thing is: the Shambles stall row answers as
 * one continuous ten-metre catch, and drawn whole it is a cyan rail across the
 * market. That reads as a fence — as a THING in the world — rather than as a
 * mark on a thing, and it says "all of this is special", which the player
 * correctly hears as "none of this is".
 *
 * Two metres is about a body and a half: enough to be unmistakably an edge and
 * short enough to be unmistakably a mark. Centred on the nearest point, so it
 * is always the part of the parapet the player is actually arriving at.
 */
const SPAN_M = 2.2;

/**
 * Verbs performed before the cue has faded to its floor.
 *
 * Six is about one section of the mission. It is deliberately counted in DISTINCT
 * verbs rather than in repetitions: a player who has vaulted the same crate six
 * times has learned one thing, and the cue is teaching a vocabulary rather than
 * drilling a move.
 */
const LEARNED_AT = 4;
/**
 * Where the fade stops.
 *
 * Not zero. Assassin's Creed never switches its ledge language off either — the
 * cue stops being an instruction and becomes a material property of the city,
 * which is what lets a competent player still glance at a roofline and read it.
 * A hairline at this weight is invisible until you look for it.
 */
const LEARNED_FLOOR = 0.2;

/** One edge, ready to draw. Plain data: the renderer knows no physics. */
export interface HoldRead {
  readonly id: string;
  readonly verb: TraversalVerb;
  readonly a: Vec3;
  readonly b: Vec3;
  /** Outward normal of the face the edge tops. Carried through from the survey. */
  readonly outX: number;
  readonly outZ: number;
  /** 0..1 by range. The near edges are the ones the next second is about. */
  readonly nearness: number;
}

export interface AffordanceRead {
  readonly holds: readonly HoldRead[];
  /** 0..1 overall strength: full for a beginner, `LEARNED_FLOOR` once taught. */
  readonly strength: number;
  /**
   * The verb the reader is offering right now, or NONE.
   *
   * Straight off `flow.previewVerb`, which the shipped flow controller already
   * computes every tick from the real probe and had been keeping for a dev
   * overlay that was never built. It is the single most honest signal in the
   * game about what is ABOUT to happen, and it was going in the bin.
   */
  readonly offered: TraversalVerb;
  /** True while that verb is one the player has not performed yet. */
  readonly offeredIsNew: boolean;
}

/**
 * Verbs this run has actually performed.
 *
 * Held on the runtime rather than in a component so it survives a re-render and
 * so the HUD, the cue and any test can read one answer. Counted from
 * `verbCommitted`, which is the flow controller saying the body did the thing —
 * not from the reader offering it, because being offered a vault you ran past is
 * not having learned what a vault is.
 */
export type VerbLedger = Set<TraversalVerb>;

export function createVerbLedger(): VerbLedger {
  return new Set<TraversalVerb>();
}

/** How far along the learning ramp a ledger is. 0 at the start, 1 once taught. */
export function taughtness(ledger: VerbLedger): number {
  return Math.min(1, ledger.size / LEARNED_AT);
}

/** The strength the cue draws at, given what the player has done. */
export function cueStrength(ledger: VerbLedger): number {
  return 1 - (1 - LEARNED_FLOOR) * taughtness(ledger);
}

/**
 * Everything the cue draws this sample, or null when there is nothing.
 *
 * Called a few times a second rather than per frame. The survey is cached
 * against the static world, so the repeated cost is the range filter over a
 * couple of dozen edges.
 */
/**
 * One face per thing: the one the player could actually run at.
 *
 * The survey answers every face of a blocker, and it is right to — a crate in an
 * alley is climbable from either side and which side depends on where you come
 * from. Drawing them all at once is what turns the cue into a wireframe box
 * hovering over the object, which reads as a container rather than as a mark on
 * a surface, and it is the single thing that made the first version look broken.
 *
 * So each thing keeps the face most squarely turned toward the player, and only
 * while they are actually on that side of it. Walk around the crate and the mark
 * walks around with you, which is also the truth: the edge you can catch is the
 * one in front of you.
 */
function approachable(holds: readonly SurveyedHold[], at: Vec3): SurveyedHold[] {
  const bestFace = new Map<string, { key: string; facing: number }>();
  const facingOf = (hold: SurveyedHold): number => {
    const midX = (hold.a.x + hold.b.x) / 2;
    const midZ = (hold.a.z + hold.b.z) / 2;
    const dx = at.x - midX;
    const dz = at.z - midZ;
    const length = Math.hypot(dx, dz) || 1;
    return (dx / length) * hold.outX + (dz / length) * hold.outZ;
  };
  const faceKey = (hold: SurveyedHold) =>
    `${hold.id}|${hold.outX.toFixed(2)}|${hold.outZ.toFixed(2)}`;

  for (const hold of holds) {
    const facing = facingOf(hold);
    const held = bestFace.get(hold.id);
    if (!held || facing > held.facing) {
      bestFace.set(hold.id, { key: faceKey(hold), facing });
    }
  }
  return holds.filter((hold) => {
    const best = bestFace.get(hold.id);
    // Square-ish onto the face. Below this the player is beside the thing
    // rather than in front of it, and the edge they would catch is a different
    // one that has not resolved yet — so nothing is drawn, which is honest.
    return best !== undefined && best.facing > 0.35 && best.key === faceKey(hold);
  });
}

/** `SPAN_M` of an edge, centred on the point of it nearest the player. */
function clipSpan(hold: SurveyedHold, at: Vec3): { a: Vec3; b: Vec3 } {
  const dx = hold.b.x - hold.a.x;
  const dz = hold.b.z - hold.a.z;
  const length = Math.hypot(dx, dz);
  if (length <= SPAN_M) return { a: hold.a, b: hold.b };

  const t = Math.max(
    0,
    Math.min(1, ((at.x - hold.a.x) * dx + (at.z - hold.a.z) * dz) / (length * length)),
  );
  const half = SPAN_M / 2 / length;
  const lo = Math.max(0, Math.min(1 - half * 2, t - half));
  const hi = lo + half * 2;
  return {
    a: { x: hold.a.x + dx * lo, y: hold.a.y, z: hold.a.z + dz * lo },
    b: { x: hold.a.x + dx * hi, y: hold.a.y, z: hold.a.z + dz * hi },
  };
}

export function affordanceRead(runtime: MissionRuntime): AffordanceRead {
  const at = runtime.motion.pos;
  const strength = cueStrength(runtime.verbsUsed);
  const offered = runtime.flow.previewVerb;

  const drawn: HoldRead[] = [];
  for (const hold of approachable(
    surveyHolds(runtime.instance.world, at, REACH_M),
    at,
  )) {
    const rise = hold.a.y - at.y;
    if (rise > BAND_UP_M || rise < -BAND_DOWN_M) continue;
    const range = distanceToEdge(at, hold);
    const span = clipSpan(hold, at);
    drawn.push({
      id: `${hold.id}:${hold.a.x.toFixed(2)}:${hold.a.z.toFixed(2)}`,
      verb: hold.verb,
      a: span.a,
      b: span.b,
      outX: hold.outX,
      outZ: hold.outZ,
      // Full weight inside a few metres, gone at the reach. The near edge is
      // the one the next second is about, and the far ones are context.
      nearness: 1 - Math.min(1, Math.max(0, (range - 3) / (REACH_M - 3))),
    });
    if (drawn.length >= MAX_DRAWN) break;
  }

  return {
    holds: drawn,
    strength,
    offered,
    offeredIsNew: offered !== "NONE" && !runtime.verbsUsed.has(offered),
  };
}

/**
 * The one-line teaching caption for a verb, or null for one that needs none.
 *
 * Shown once per verb, at the geometry, the first time the reader offers it —
 * and never again once the player has done it. That is the whole teaching
 * strategy in one sentence: name the thing at the moment it is about to happen,
 * to a player who is looking at the thing, and then never mention it again.
 *
 * The wording says what the BODY will do, not what the key is, because there is
 * no key. "Vault it" is a promise the geometry is making.
 */
export function verbCaption(verb: TraversalVerb): string | null {
  switch (verb) {
    case "STEP_UP":
      return "Step up · keep running";
    case "VAULT":
      return "Vault it · keep running";
    case "CLIMB_OVER":
      return "Over the top · keep running";
    case "MANTLE":
      return "Pull up · keep running";
    case "CLIMB_UP":
      return "Climb it · keep running";
    case "SLIDE":
      return "Slide under · keep running";
    case "JUMP_GAP":
      return "It jumps itself · keep running";
    case "HANG_DROP":
      return "Hang and drop";
    case "LEAP_OF_FAITH":
      return "Something down there will catch you";
    case "EDGE_BRAKE":
      return "Too far down · turn away";
    default:
      return null;
  }
}

/** Verbs whose caption is worth showing at all. The rest are silent. */
export function teachable(verb: TraversalVerb): boolean {
  return verbCaption(verb) !== null && verb !== "EDGE_BRAKE";
}
