// How far the player still has to travel, measured along the route they are on.
//
// This exists because of one number and how easily it lies. A marker on the
// Liberty Elm can print the distance to it, and the obvious distance — the
// straight line — reads 78m from the printshop leads. The route between those
// two points is half as long again: down off the leads, through the Shambles,
// round or over the Town House, along the Orange Street roofline and off the
// steeple. A player told "78m" on a rooftop parkour level is being told the
// wrong thing in the most confident possible voice, and there is nothing on
// screen that would look wrong.
//
// So the number is walked. `routeDistanceGraph` costs the authored links by
// their own geometry, `cheapestPath` finds the shortest chain of them, and the
// leg from wherever the player actually is to the nearest node is added on top.
//
// NOTHING HERE DECIDES A ROUTE FOR ANYBODY. It reads the graph and returns a
// scalar. It does not pick a line, it does not name the next node, and the
// only thing that consumes it draws a distance on a plate — which is the whole
// difference between telling a player where they are going and telling them how
// to get there. Every line is allowed in the search precisely so that the
// answer is "the shortest way left" rather than an opinion about which way to
// take.

import type { Vec3 } from "@pa/engine-world/collision";
import { RUN_SPEED } from "@pa/engine-world/playerMotion";
import type { TraversalVerb } from "@pa/engine-world/parkour";
import { cheapestPath, routeDistanceGraph, type RouteGraph } from "./routeGraph.js";
import type { LinkKind, MissionLevel, RouteLink, SectionId } from "./types.js";

const EVERY_LINE: ReadonlyArray<RouteLink["line"]> = ["SAFE", "FAST", "EXPERT"];

/**
 * A fixed-tick sample of the body, richer than a bare position.
 *
 * Position alone cannot tell a completed climb from a body that merely drifted
 * over a node: after topping out onto the leads the feet are a metre above the
 * cornice node they climbed off, and a position-only mark holds it, pointing back
 * down at a step already taken. So the runtime hands the guidance what it knows —
 * where the feet are, whether they are down, WHAT they are standing on, the verb
 * in flight, and the ONE traversal that completed this tick — and the mark reads
 * a completion against the authored links to prove which node the body is now on.
 */
export interface WayfindSample {
  readonly pos: Vec3;
  readonly grounded?: boolean;
  /** The deck or mass id under the feet, or null when airborne / off any surface. */
  readonly supportId?: string | null;
  /** The verb executing this tick, for context. */
  readonly verb?: TraversalVerb;
  /**
   * A traversal that FINISHED on this tick — an authored climb/vault, a landing,
   * a received dive — carried once, so the mark can match it to a directed link
   * and rejoin the route at the proven node. Null on a tick nothing completed.
   */
  readonly completed?: {
    readonly verb: TraversalVerb;
    /** The surface the body ended on, when known. */
    readonly landingId: string | null;
  } | null;
}

/** How the verb a traversal finished under maps to the authored link kinds. */
const COMPLETION_KINDS: Readonly<Record<string, ReadonlyArray<LinkKind>>> = {
  // MANTLE folded into CLIMB_UP, so a completed CLIMB_UP now also proves an
  // authored MANTLE-kind link. CLIMB_OVER stays a distinct verb (see tuning.ts).
  CLIMB_UP: ["CLIMB", "MANTLE"],
  CLIMB_DOWN: ["CLIMB", "DROP"],
  CLIMB_OVER: ["CLIMB"],
  // A jump-catch completes an authored CLIMB link exactly as a climb does. The
  // level authors the ascent and places (or omits) a ladder; whether the body
  // rides one or catches the lip is the engine's answer to what is there, and the
  // link is the same link either way. Absent from here, the clock ledge's
  // completion would prove nothing, the gateway would stay held on a take-off the
  // body had already left, and the cornice climb above it would never arm — the
  // node-distance soft-lock this table's own note describes.
  JUMP_HANG: ["CLIMB", "MANTLE"],
  VAULT: ["VAULT"],
  JUMP: ["JUMP", "DASH_JUMP"],
  JUMP_GAP: ["JUMP", "DASH_JUMP"],
  DASH: ["DASH_JUMP"],
  RUN_OFF: ["DROP"],
  HANG_DROP: ["DROP"],
  ROLL: ["DROP"],
  LEAP_OF_FAITH: ["LEAP_OF_FAITH"],
  SLIDE: ["DUCK_UNDER"],
  STEP_UP: ["RUN", "RAMP"],
};

/** A completion is credited to a link whose destination is within this of the feet. */
const COMPLETION_ARRIVE_M = 2.5;

/**
 * The verb families that COMPLETE each authored action kind. A link whose kind is
 * a key here is an action gateway (it has a takeoff and a receiver a committed
 * traversal has to bridge); its value is the verbs whose completion releases it.
 * The inverse of COMPLETION_KINDS, and like it an authored vocabulary, not an id
 * allowlist.
 *
 * A RUN/RAMP/BLEND has no takeoff to hold and is not here. A DROP is here but
 * conditionally: see `isActionLink`. An ordinary drop onto a wide deck keeps the
 * old lead-the-receiver behaviour (a body that runs off a roof lip onto the roof
 * below does not need a gateway held over it), but a directed drop onto a NARROW
 * board — the ropewalk tie beam, where a sprint entry overshoots the 1.6m plank
 * into the dark — must own its lip, so a competing automatic JUMP_GAP/LEAP cannot
 * commit while the body is stepping down onto the board. Its completing family is
 * the controlled descents: a run-off (the chain drop) or a hang drop.
 */
const ACTION_VERBS: Partial<Record<LinkKind, readonly TraversalVerb[]>> = {
  VAULT: ["VAULT"],
  // A CLIMB link is directional in the geometry, not in the verb: most are the
  // upward reaches (a scaffold staging, the tower, a bough), but a few are
  // authored climb-DOWNS, and the crown of the Liberty Elm is the one on the
  // guaranteed path — F_POST -> F_POST_STEP lowers the body off the objective
  // onto the low bough, because the crown overhangs it and a stroll off the rim
  // falls to the street. The reader answers that rim with the controlled descent
  // (a hang drop, or a climb-down), so a CLIMB gateway that allowed only the
  // upward verbs filtered the body's own descent out and left it braking at the
  // rim with the sheet already nailed — a soft-lock one node past the objective.
  // Including the downward member costs the upward climbs nothing: a scaffold or
  // tower approach never offers a hang drop, so this only ever matters where the
  // authored CLIMB genuinely goes down. HANG_DROP is the verb the reader answers
  // a lowering rim with (there is no CLIMB_DOWN verb; a controlled descent off a
  // ledge is a hang drop), so it is the one downward member the family needs.
  // JUMP_HANG is in the CLIMB family for the same reason CLIMB_UP is: it is what
  // the reader answers an upward authored ascent with when the ascent has no
  // ladder. Omitting it would have the commit filter drop the only verb available
  // at the clock ledge while the gateway is held on its axis — the body would
  // stand at a lip it can reach, with the guidance pointing at it, and be offered
  // nothing.
  CLIMB: ["CLIMB_UP", "JUMP_HANG", "CLIMB_OVER", "HANG_DROP"],
  MANTLE: ["CLIMB_UP", "JUMP_HANG"],
  JUMP: ["JUMP", "JUMP_GAP"],
  DASH_JUMP: ["DASH", "JUMP_GAP"],
  LEAP_OF_FAITH: ["LEAP_OF_FAITH"],
  DUCK_UNDER: ["SLIDE"],
  DROP: ["RUN_OFF", "HANG_DROP"],
};

/**
 * How close the body must be to a gateway's takeoff before the mark hands on from
 * the takeoff to the receiver. A node the run LEAPS from arrives tight (the dive
 * is a commit); an ordinary takeoff hands on at about a capsule's reach, so the
 * body is genuinely ON the take-off point before it is aimed at the landing.
 *
 * TIGHT ON PURPOSE. Hand on too early and the body cuts the corner: aimed at the
 * receiver a metre before it reaches the take-off, the Dock goods vault sent the
 * body south-west of B2_GOODS_IN into the ARCADE_PIER_N wall instead of onto the
 * IN->OUT line. Two thirds of a metre keeps the approach on the authored axis.
 */
const GATEWAY_TAKEOFF_ARRIVE_M = 0.35;

/**
 * How far BEYOND the receiver, along the authored axis, the body must be for the
 * gateway to release when no matching completion was surfaced — a headless walk
 * that never emits a verb event, or a missed completion. It is past the receiver,
 * not short of it, so it is not the early bank the gateway exists to prevent.
 */
const GATEWAY_PAST_M = 1.0;

/**
 * Tight arrival for a node the run LEAPS from. The dive off the steeple gallery
 * is a commit, not a step: at a metre out the body must still be aimed at
 * E_GALLERY (retain it), and only inside a third of a metre does the mark hand on
 * to the crown it is diving for. The ordinary 3m arrival would advance the mark
 * off the gallery a full second before the take-off, pointing it across the void.
 */
const LEAP_ARRIVE_M = 0.35;

/**
 * Surfaces narrow enough that the authored walk pace is a landing constraint, not
 * a pacing hint: a sprint entry overshoots the board. The ropewalk tie beam is
 * 1.6m wide and authored at 2.3 m/s, and the runtime holds a Shift-held body to
 * that on the leg onto and along it. A named set rather than a width heuristic so
 * it is auditable and cannot quietly start capping a wide roof or the throng.
 */
const NARROW_BOARD_SURFACES: ReadonlySet<string> = new Set(["ROPEWALK_TIE_BEAM"]);

/**
 * How much more a metre of height counts than a metre of ground when deciding
 * which node the player is standing at.
 *
 * A level with eight vertical bands has nodes stacked: the street under the
 * market shed is 5.6m below its roof and within two metres of it on the ground
 * plane. Weighting height is what stops a player on the roof being matched to
 * the node in the street, which would price their remaining route as though
 * they had already come down.
 */
const HEIGHT_WEIGHT = 2.5;

/** How far the player may be from every node before the match is not worth using. */
const OFF_ROUTE_M = 30;

export interface WayRange {
  /** Metres still to travel. */
  readonly metres: number;
  /**
   * True when the figure was walked along the authored links, false when the
   * graph could not answer and it fell back to the straight line.
   *
   * Carried rather than hidden because the two mean different things and the
   * fallback is a real case: a player who has gone past the objective, or who
   * is standing somewhere no link leads out of, gets the honest crow-flies
   * number instead of nothing.
   */
  readonly viaRoute: boolean;
}

/**
 * A directed ACTION GATEWAY: a selected action link (a VAULT, CLIMB, JUMP, dive
 * — any authored committed traversal with a takeoff and a receiver) that the
 * guidance holds STATEFUL until the body has actually performed it.
 *
 * Ordinary lead/arrival retires a node once the body is within a few metres of
 * it. For an under-4m action link that is wrong: the receiver is inside the lead,
 * so the mark skips it and points at the node PAST the action before the action
 * has happened. The Dock goods VAULT is exactly this — the mark jumped to B2_EXIT
 * and the body chased that intent ~15° off the authored IN->OUT axis, probed the
 * wrong pier and wedged. A gateway pins the mark to the takeoff, then the
 * receiver, and does not release either until a MATCHING completed traversal has
 * reached the directed destination. It also carries the authored axis and the
 * verb family the runtime may commit, so the reader probes and commits ALONG the
 * authored line rather than off it. Nothing here forces a commit: consent, speed,
 * collision, preflight and the high-ascent gate all still decide.
 */
export interface WayGateway {
  readonly linkId: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  /** The authored action kind (VAULT/CLIMB/JUMP/LEAP_OF_FAITH/...). */
  readonly kind: LinkKind;
  /** APPROACH aims the mark at the takeoff; RECEIVER (tight-arrived) at the landing. */
  readonly phase: "APPROACH" | "RECEIVER";
  /** Unit XZ authored axis, takeoff -> receiver. */
  readonly axisX: number;
  readonly axisZ: number;
  /** The verb family a completion must belong to to release this gateway. */
  readonly allowedVerbs: readonly TraversalVerb[];
  /**
   * The DIRECTED elevation of the action, receiver Y minus take-off Y, read off
   * the authored FROM->TO nodes. Positive is a climb, negative a drop.
   *
   * The gateway carries the truthful destination elevation off the authored link,
   * not off wherever the mark currently sits — so during the APPROACH phase, when
   * the waypoint is still pinned to the take-off and its own rise reads flat, a
   * reader/HUD can still post the upward affordance for the action ahead. It is the
   * directed ascent, separated from where the held mark happens to be.
   */
  readonly riseM: number;
}

/** A place on the way, far enough off to be worth turning toward. */
export interface WayPoint {
  readonly nodeId: string;
  readonly pos: readonly [number, number, number];
  /** The section it belongs to, for naming the leg in a player's words. */
  readonly section: SectionId;
  /**
   * Set when this mark IS a directed action gateway held until completion. The
   * runtime reads the axis/verb family off it to guide the action; presentation
   * ignores it and just draws the point.
   */
  readonly gateway?: WayGateway;
}

export interface Wayfinder {
  /** The route node the player is standing at, height weighted. */
  nearestNodeId(from: Vec3): string | null;
  /** How far there is left to go to a node, along the route where possible. */
  rangeTo(from: Vec3, toNodeId: string): WayRange;
  /**
   * Advance and return the next place on the cheapest route to a goal, or null
   * when the graph cannot answer. THE ONE MUTATION IN THIS FILE.
   *
   * THIS FILE SAID IT WOULD NEVER DO THIS, and the header above still carries
   * the argument for why: reading the architecture is the thing the mission is
   * for, and a mark that solves the roofline is a mark that deletes it. The
   * argument is good and it turned out to be about the wrong risk. The mission
   * was played, three times, and the report was not "it solved itself" — it was
   * "there's genuinely just no path for getting to the tree". A player standing
   * in Dock Square is looking at a twelve-metre Town House with the objective
   * marked on the far side of it, and the way up is a scaffold eight metres to
   * their left that nothing on screen distinguishes from a wall. That is not a
   * puzzle they failed to read; it is a question the level never asked out loud.
   *
   * What is returned is deliberately thin: ONE place, the next one, and only
   * while it is further off than `WAYPOINT_ARRIVED_M`. Not a line, not a chain,
   * not a minimap. The player still has to find the hold that gets them up the
   * scaffold; they are no longer being asked to guess that the scaffold is the
   * answer.
   *
   * IT HAS EXACTLY ONE CALLER: the mission runtime's fixed step. The waypoint is
   * committed across reads on purpose (see WAYPOINT_ABANDON_M), so a second
   * caller advancing it from a slightly different position a few times a second
   * would fight the first and the mark would walk in a loop — the very failure
   * the commitment exists to prevent. Presentation surfaces do not call this;
   * they call `peekWaypoint`.
   */
  advanceWaypoint(sample: WayfindSample | Vec3, toNodeId: string): WayPoint | null;
  /**
   * The authored ground speed the CURRENT committed leg is walked at, or null
   * when the leg has no authored cap (a plain run at full pace). A pure peek the
   * runtime reads to hold a Shift-held body to the leg's pace — the ropewalk tie
   * beam is 1.6m wide and authored at 2.3 m/s, and a sprint entry overshoots it.
   */
  legSpeedCap(from: Vec3, toNodeId: string): number | null;
  /**
   * The committed waypoint as it stands, WITHOUT advancing it. Pure.
   *
   * This is what the HUD sample and the in-canvas mark read, at whatever rate
   * each renders, so neither drives the mutation and the two can never disagree
   * or oscillate. It returns exactly what the last `advanceWaypoint` committed,
   * and null before the runtime has taken its first step toward this goal.
   */
  peekWaypoint(toNodeId: string): WayPoint | null;
  /** The graph, exposed so a test can assert what it was built from. */
  readonly graph: RouteGraph;
}

/** How a wayfinder is tuned for one attempt. */
export interface WayfinderOptions {
  /**
   * The route lines guidance may use. Defaults to every authored line.
   *
   * Attempt one is handed SAFE-only, so a first-time player is pointed down the
   * line whose promise is "always goes" rather than at a FAST or EXPERT
   * shortcut that assumes reads they have not been taught yet. Later attempts
   * pass every line and get the shortest guidance the graph can find. The
   * DISTANCE to the goal is always measured over every line — how far the elm
   * is does not depend on which way a first-timer is being pointed — so this
   * narrows the waypoint and never the number on the plate.
   */
  readonly guidanceLines?: readonly RouteLink["line"][];
}

/**
 * How far ahead the waypoint sits.
 *
 * Route nodes are dense — 162 of them over 181m — so the literal next node is
 * often a metre away and says nothing, and the mark would sit on the player's
 * own feet. The search walks forward along the path until it finds one at least
 * this far off.
 *
 * FOUR METRES, AND SHORT IS THE WHOLE POINT. Nine was tried and it is actively
 * worse than nothing: from the middle of Dock Square a nine-metre lead skips
 * the foot of the Town House scaffold, the first two of its stagings and the
 * gallery, and lands on a node up on the cornice — so the player is aimed at a
 * place ten metres above them with a building in the way, runs at its ground
 * position, and goes straight past the only thing they could have climbed. That
 * was measured: the run reached the east face of the Town House with the
 * scaffold behind it. A lead that overshoots the hold is a lead that recreates
 * the bug.
 */
const WAYPOINT_LEAD_M = 4;

/** Close enough that the waypoint has been reached and the next one is picked. */
const WAYPOINT_ARRIVED_M = 3;

/**
 * How far the player may get from a waypoint before it is abandoned.
 *
 * A WAYPOINT IS COMMITTED TO, and this is the only thing that lets it go. The
 * route is three crossing lines, not a corridor, so `nearestNodeId` legitimately
 * snaps between lines as the player moves a couple of metres — and a waypoint
 * re-derived from scratch every read therefore flips between the Shambles line
 * and the Dock Square line several times a second. Measured with an
 * unstabilised mark, a driver steering at it walked east, north, back west and
 * north again, and its remaining distance went UP twice: the mark was not
 * pointing anywhere, it was averaging two answers.
 *
 * So a waypoint, once chosen, is kept until it is reached or until the player
 * has plainly gone somewhere else. Eighteen metres is about two sections' worth
 * of deviation, which is far more than a line swap and far less than being
 * lost.
 */
const WAYPOINT_ABANDON_M = 18;

/**
 * How close to the nearest reachable node another node must be to count as
 * "here" for the distance anchor. Short, so every candidate's approach leg is a
 * step the player could actually take in a straight line rather than a chord
 * through a wall — which is what keeps the measured distance honest.
 */
const ANCHOR_NEAR_BAND_M = 3;

/**
 * How much further along the route a candidate anchor must be before the
 * committed one is abandoned for it. This is the hysteresis that turns "nearest
 * reachable each sample" — which flipped branches and jumped the plate ~97m on a
 * centimetre — into a monotone, forward-only anchor whose reported distance is
 * continuous.
 */
const ANCHOR_HYSTERESIS_M = 3;

/**
 * How far the player can get from the committed anchor before it is abandoned
 * even backward. Forward-only progress is right for a run that walks the route,
 * but a respawn or a large relocation leaves the old anchor stranded tens of
 * metres away; past this the anchor re-commits to where the player now is. Well
 * beyond any per-step movement, so continuity under normal play is untouched.
 */
const ANCHOR_RELOCATE_M = 25;

/**
 * A node this far above or below the player's feet is a climb or a drop they
 * have to physically make, not somewhere they are standing. It is the height
 * that separates "reached" from "reachable" for the mark: on the ground at the
 * foot of the Shambles crates, B_CRATES_A is 1.9m up and 1.88m along — a 2.66m
 * straight line the old reach test read as underfoot, so the mark banked the
 * climb it had not made and skipped ahead to a canopy the body could only get to
 * by taking it. Half a metre absorbs a step-up; anything past this is a hold.
 */
const VERTICAL_REACH_M = 0.9;

/**
 * How close to a descent receiver's height an AIRBORNE body must be before the
 * mark may retire it and re-select the next leg.
 *
 * Distinct from `VERTICAL_REACH_M`, and much tighter, because it defends a
 * different thing: not "is this a hold I have to make" but "have I landed yet".
 * While a body is falling, `reachCost` is height-weighted, so a receiver a metre
 * below reads far nearer than its planar distance — which both retires the
 * receiver mid-fall AND, worse, makes the grounded-distance the next gateway arms
 * against wrong: the capstan VAULT one short run past the hemp floor was rejected
 * because a body still 0.88m in the air scored the vault take-off at 4.3m (2.1m
 * planar + the height penalty), past the lead, so the mark fell through to the
 * slide beyond and the vault was skipped. Holding the receiver until the feet are
 * within a step of it means every downstream selection runs from where the body
 * actually stands. A small band, not zero, so the last airborne tick before a
 * clean touchdown does not stall the mark on a hair of coyote height.
 */
const DESCENT_LAND_BAND_M = 0.3;

function planar(from: Vec3, to: readonly [number, number, number]): number {
  return Math.hypot(to[0] - from.x, to[2] - from.z);
}

/**
 * How far a node is from the player for the purpose of deciding it is REACHED —
 * underfoot, arrived at, banked as passed. Height weighted for the same reason
 * `matchCost` is: a level stacked eight bands deep puts a climb hold a couple of
 * metres overhead within a short straight line of the body, and a mark that
 * counted that as reached would advance off the hold before it was taken. So a
 * metre up counts for `HEIGHT_WEIGHT` metres along, and the straight-line reach
 * that used to bank an unclimbed hold no longer does.
 */
function reachCost(from: Vec3, to: readonly [number, number, number]): number {
  return (
    Math.hypot(to[0] - from.x, to[2] - from.z) +
    HEIGHT_WEIGHT * Math.abs(to[1] - from.y)
  );
}

/**
 * A wayfinder over one level's route.
 *
 * Built once per mission instance and held, because the graph is derived from
 * authored data that cannot change during a run. The per-call work is a linear
 * scan for the nearest node and one Dijkstra over ~150 nodes, which is cheap
 * enough for the eight samples a second the HUD takes and is memoised on the
 * node pair anyway — a player standing still asks the same question sixty times.
 */
export function createWayfinder(
  level: MissionLevel,
  options: WayfinderOptions = {},
): Wayfinder {
  const graph = routeDistanceGraph(level);
  const guidanceLines = options.guidanceLines ?? EVERY_LINE;
  const nodes = level.nodes;
  const posOf = new Map(nodes.map((node) => [node.id, node.pos]));
  const sectionOf = new Map(nodes.map((node) => [node.id, node.section]));
  /** Deck/mass id each node stands on — the surface a completion has to land on. */
  const surfaceOf = new Map(nodes.map((node) => [node.id, node.surface]));
  /** Authored links keyed by their from-node, for the completion match and cap. */
  const linksFrom = new Map<string, RouteLink[]>();
  for (const link of level.links) {
    const list = linksFrom.get(link.from);
    if (list) list.push(link);
    else linksFrom.set(link.from, [link]);
  }
  const walked = new Map<string, number | null>();
  const routed = new Map<string, readonly string[] | null>();
  const committed = new Map<string, WayPoint>();
  /** Waypoints already reached, per goal. A mark never sends you back to one. */
  const behind = new Map<string, Set<string>>();
  /**
   * The committed route anchor per goal — the node the displayed distance is
   * measured from. Advanced forward-only by `commitAnchor` so the plate cannot
   * jump branches on a centimetre of movement.
   */
  const anchors = new Map<string, string>();
  /**
   * The armed action gateway per goal. Stateful: once a selected action link is
   * armed it is held (through APPROACH then RECEIVER) until a matching completion
   * reaches its destination or the body genuinely relocates. See WayGateway.
   */
  const gateways = new Map<
    string,
    { linkId: string; from: string; to: string; kind: LinkKind; phase: "APPROACH" | "RECEIVER" }
  >();

  /**
   * Is this authored link a directed action gateway — a takeoff and a receiver a
   * committed traversal has to bridge, held stateful until it is performed?
   *
   * The kind must be one the action-verb table knows (VAULT/CLIMB/JUMP/dive/…).
   * DROP is the one that is not unconditional: an ordinary run-off onto a wide
   * deck keeps the old lead-the-receiver behaviour and is NOT a gateway, so the
   * south-row → ropewalk-roof descent still points the mark across the fall. A
   * drop becomes a gateway only when its receiver is a NARROW BOARD — the tie
   * beam — where overshoot is fatal and the lip must be owned so a competing
   * automatic JUMP_GAP/LEAP cannot fling the body past the plank. Keyed on the
   * authored surface class the speed cap already uses, not on any node id.
   */
  function isActionLink(link: RouteLink): boolean {
    if (!(link.kind in ACTION_VERBS)) return false;
    if (link.kind === "DROP") {
      return NARROW_BOARD_SURFACES.has(surfaceOf.get(link.to) ?? "");
    }
    return true;
  }

  /** The authored link between two adjacent path nodes, on the given lines. */
  function linkBetween(
    fromNodeId: string,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): RouteLink | null {
    for (const link of linksFrom.get(fromNodeId) ?? []) {
      if (link.to === toNodeId && lines.includes(link.line)) return link;
    }
    return null;
  }

  function pathNodes(
    fromNodeId: string,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): readonly string[] | null {
    // Keyed by the line set as well as the node pair: guidance and the distance
    // read ask the same graph with different lines, and one cache entry cannot
    // answer both.
    const key = `${fromNodeId}>${toNodeId}>${lines.join(",")}`;
    const cached = routed.get(key);
    if (cached !== undefined) return cached;
    // `requireVerified: false` is mandatory on this graph and is why the call
    // lives here rather than at every call site: `routeDistanceGraph` marks
    // every edge unverified, because nothing simulated them.
    const path = cheapestPath(graph, fromNodeId, toNodeId, lines, {
      requireVerified: false,
    });
    routed.set(key, path ? path.nodes : null);
    walked.set(key, path ? path.metres : null);
    return path ? path.nodes : null;
  }

  function pathMetres(
    fromNodeId: string,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): number | null {
    const key = `${fromNodeId}>${toNodeId}>${lines.join(",")}`;
    const cached = walked.get(key);
    if (cached !== undefined) return cached;
    pathNodes(fromNodeId, toNodeId, lines);
    return walked.get(key) ?? null;
  }

  function matchCost(node: (typeof nodes)[number], from: Vec3): number {
    return (
      Math.hypot(node.pos[0] - from.x, node.pos[2] - from.z) +
      HEIGHT_WEIGHT * Math.abs(node.pos[1] - from.y)
    );
  }

  function nearestNodeId(from: Vec3): string | null {
    let best: string | null = null;
    let bestCost = Infinity;
    for (const node of nodes) {
      const cost = matchCost(node, from);
      if (cost < bestCost) {
        bestCost = cost;
        best = node.id;
      }
    }
    return bestCost <= OFF_ROUTE_M ? best : null;
  }

  function remainingOf(
    nodeId: string,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): number | null {
    return nodeId === toNodeId ? 0 : pathMetres(nodeId, toNodeId, lines);
  }

  /**
   * The best route node the player is essentially STANDING ON: among the nodes
   * within a short band of the nearest reachable one — so every approach leg is
   * short and honest, never a straight line cutting through a building — the one
   * furthest along the route to the goal.
   *
   * Why "furthest along" and not "nearest". Dock Square straddles two crossings a
   * metre apart: one whose SAFE route to the elm is short, one whose route is a
   * hundred metres around. Picking by a hair of Euclidean distance flipped
   * between them and the plate jumped ~97m on a centimetre of movement. Picking
   * the lower remaining among the near cluster settles on the branch the player
   * is actually on and never offers the detour — the true remaining trip is the
   * shorter one, and quoting the longer was simply wrong.
   *
   * Nodes the goal cannot be reached from under `lines` are skipped, so a first
   * run on a FAST-only crossing recovers to the nearest SAFE-reachable node
   * rather than going blank. Null when the nearest reachable node is further than
   * a run ever legitimately strays — the caller then quotes the straight line.
   */
  /**
   * The near-band anchor candidates, furthest-along-the-route first.
   *
   * Every node within a short leg of the nearest reachable one — so each is a
   * step the player could take in a straight line, not a chord through a wall —
   * ranked by remaining distance ascending (furthest along first), leg breaking
   * ties. When the body is grounded on a known surface, candidates on THAT
   * surface are preferred outright over a stride away on a different deck (the
   * feet are on the leads, not the gantry board a hair nearer on a deck the body
   * is not standing on). Empty when the nearest reachable node is further than a
   * run ever legitimately strays.
   *
   * Returning the ranked BAND rather than a single winner is what lets
   * `commitAnchor` advance past a front-runner it must refuse: the lowest-
   * remaining near node can be one straight DOWN through the deck (the ropewalk
   * tie beam sits 3.4m under the roof the body just dropped onto), which
   * `contiguousProgress` correctly rejects — and a single-candidate anchor then
   * stranded behind the just-taken drop, pointing the mark back up at the
   * take-off. With the band in hand the anchor advances to the furthest node the
   * body has actually reached instead.
   */
  function nearBandAnchors(
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
    supportId: string | null = null,
  ): { id: string; leg: number; remaining: number }[] {
    const reachable: {
      id: string;
      leg: number;
      remaining: number;
      onSupport: boolean;
    }[] = [];
    let nearest = Infinity;
    for (const node of nodes) {
      const remaining = remainingOf(node.id, toNodeId, lines);
      if (remaining === null) continue;
      const leg = Math.hypot(
        node.pos[0] - from.x,
        node.pos[1] - from.y,
        node.pos[2] - from.z,
      );
      reachable.push({
        id: node.id,
        leg,
        remaining,
        onSupport: surfaceOf.get(node.id) === supportId,
      });
      if (leg < nearest) nearest = leg;
    }
    if (reachable.length === 0 || nearest > OFF_ROUTE_M) return [];
    const band = reachable.filter(
      (candidate) => candidate.leg <= nearest + ANCHOR_NEAR_BAND_M,
    );
    const sameSupport = supportId ? band.filter((c) => c.onSupport) : [];
    const pool = sameSupport.length > 0 ? sameSupport : band;
    pool.sort((a, b) => a.remaining - b.remaining || a.leg - b.leg);
    return pool.map(({ id, leg, remaining }) => ({ id, leg, remaining }));
  }

  function bestNearAnchor(
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
    supportId: string | null = null,
  ): string | null {
    return nearBandAnchors(from, toNodeId, lines, supportId)[0]?.id ?? null;
  }

  /**
   * Is advancing the anchor from `held` to `candidate` route-contiguous progress
   * the body has actually made — rather than a jump to a merely-near node across
   * geometry it never crossed?
   *
   * Two ways it can be. Either the body is STANDING on the candidate — a tight,
   * height-weighted arrival (see `reachCost`) at the order of the waypoint's own
   * arrival radius, so a hold overhead does not count as stood-upon — which is an
   * unambiguous statement that this node (on whatever branch) has been reached; or
   * the candidate is at the body's own level, lies on the cheapest route forward
   * from the held anchor, and the route distance being banked is one a straight
   * approach could have covered.
   *
   * The second half is the whole of the Shambles fix. At the stall gap the node
   * with the lowest remaining distance near the player is B_GAP_N / B_STALL_GAP,
   * a short hop east THROUGH a solid stall; but reaching them along the SAFE line
   * is a climb up the crates, three canopy leaps and a drop — tens of route
   * metres for a three-metre straight span. `routeGap` is that authored length
   * and `span` is the straight distance by way of the player, so a leg that
   * detours through untraversed geometry prices itself far above the span and is
   * refused until the body physically reaches it.
   */
  function contiguousProgress(
    held: string,
    heldRemaining: number,
    candidate: string,
    candRemaining: number,
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): boolean {
    const candPos = posOf.get(candidate);
    const heldPos = posOf.get(held);
    if (!candPos || !heldPos) return false;
    // Height weighted, so a hold overhead is not counted as stood-upon.
    if (reachCost(from, candPos) <= WAYPOINT_ARRIVED_M) return true;
    // A candidate a climb up or a drop down from the body's feet is progress it
    // has not made yet, whatever the graph costs the leg — the crate top is a
    // metre and a half over the street it is climbed from. Banking it here is the
    // anchor advancing up a climb the body is still standing under, which is the
    // Shambles skip in its second form: refuse it until the body is at its height.
    if (Math.abs(candPos[1] - from.y) > VERTICAL_REACH_M) return false;
    const path = pathNodes(held, toNodeId, lines);
    if (!path || !path.includes(candidate)) return false;
    // `candidate` is on the held anchor's cheapest path, so the held-to-candidate
    // leg is exactly the difference in their remaining distances.
    const routeGap = heldRemaining - candRemaining;
    const span =
      Math.hypot(heldPos[0] - from.x, heldPos[1] - from.y, heldPos[2] - from.z) +
      Math.hypot(candPos[0] - from.x, candPos[1] - from.y, candPos[2] - from.z);
    return routeGap <= span + ANCHOR_NEAR_BAND_M;
  }

  /**
   * The committed route anchor, advanced forward-only. THE ONE MUTATOR of the
   * distance's anchor state, and the reason a centimetre of movement cannot jump
   * the plate: a wobble that surfaces a different-branch node is ignored, and the
   * anchor is only ever re-committed to a node meaningfully further along the
   * route AND route-contiguous with where it already is — see `contiguousProgress`
   * for why a near node reached only through untraversed geometry is refused. Real
   * forward progress steps it down by an adjacent node's worth; real backtracking
   * keeps the held anchor and simply grows its approach leg.
   */
  /**
   * Would advancing the anchor from `held` to `cand` step PAST an authored action
   * the body has not performed — a vault/climb/leap whose receiver is not yet
   * banked?
   *
   * The near-band is a global reach, and a BYPASSABLE obstacle lets it reach the
   * far side of an action across a short straight span. The rope capstan's VAULT
   * take-off and receiver are 2.3m apart with open floor a stride north, so a body
   * that lands beside it scores the receiver (D2_VAULT_OUT) inside the band and
   * `contiguousProgress` accepts it — advancing the anchor onto the far side of a
   * vault the body only walked AROUND. The anchor then arms the NEXT action (the
   * slide) and the vault is never offered. A short transition into an
   * action-critical vault must preserve its take-off: the anchor may advance up to
   * an action's take-off but not past its receiver until the action is performed
   * (its receiver banked by a matching completion, see stepGateway). armGateway
   * then holds the vault from the take-off the anchor stopped at.
   */
  function skipsUnperformedAction(
    from: Vec3,
    held: string,
    candId: string,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
    passed: ReadonlySet<string>,
  ): boolean {
    const path = pathNodes(held, toNodeId, lines);
    if (!path) return false;
    const candIdx = path.indexOf(candId);
    if (candIdx < 0) return false;
    for (let i = 0; i + 1 < path.length && i + 1 <= candIdx; i += 1) {
      const link = linkBetween(path[i]!, path[i + 1]!, lines);
      if (!link || !isActionLink(link) || passed.has(path[i + 1]!)) continue;
      // Only an action the body is actually ON THE APPROACH TO reserves its
      // take-off. Preserving a take-off matters when the body has just arrived at
      // the action's doorstep (the hemp floor a stride from the capstan vault); a
      // relocation far past an action — a headless jump onto the far roof, a
      // respawn — must not strand the anchor behind a climb the body has plainly
      // already made. So the guard binds only while the take-off is within a lead
      // of the feet; beyond that the ordinary contiguity/relocation rules run.
      const takeoff = posOf.get(path[i]!);
      if (takeoff && reachCost(from, takeoff) <= WAYPOINT_LEAD_M) return true;
    }
    return false;
  }

  function commitAnchor(
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
    passed: ReadonlySet<string>,
    supportId: string | null = null,
  ): string | null {
    const band = nearBandAnchors(from, toNodeId, lines, supportId);
    const candidate = band[0]?.id ?? null;
    const held = anchors.get(toNodeId);
    const heldRemaining =
      held !== undefined ? remainingOf(held, toNodeId, lines) : null;
    if (candidate === null) {
      if (held !== undefined && heldRemaining !== null) return held;
      anchors.delete(toNodeId);
      return null;
    }
    if (held === undefined || heldRemaining === null) {
      anchors.set(toNodeId, candidate);
      return candidate;
    }
    // Forward progress: advance to the FURTHEST-along near-band node that is both
    // meaningfully closer to the goal than the held anchor AND route-contiguous
    // with it — progress the body actually walked, not a hop across a stall front
    // to a node the route only reaches the long way round. The band is ranked
    // furthest-first, so the first qualifier is the furthest legitimate step.
    //
    // Scanning the whole band, not just its front-runner, is the descent-handoff
    // repair: after a directed drop the lowest-remaining near node can be one
    // straight down through the deck the body just landed on (`contiguousProgress`
    // refuses it on the height gate), and testing only that one left the anchor
    // stranded behind the take-off — which the lead loop then offered as a mark,
    // commanding an impossible climb back up the drop. Every candidate still has
    // to pass the same contiguity gate, so a body that merely fell onto an
    // unrelated nearby deck advances nothing.
    for (const cand of band) {
      if (
        cand.remaining + ANCHOR_HYSTERESIS_M < heldRemaining &&
        !skipsUnperformedAction(from, held, cand.id, toNodeId, lines, passed) &&
        contiguousProgress(
          held,
          heldRemaining,
          cand.id,
          cand.remaining,
          from,
          toNodeId,
          lines,
        )
      ) {
        anchors.set(toNodeId, cand.id);
        return cand.id;
      }
    }
    // Relocation: the player is no longer anywhere near the held anchor (a
    // respawn or a large jump), so holding it would strand the mark. Re-commit.
    const heldPos = posOf.get(held);
    const heldLeg = heldPos
      ? Math.hypot(heldPos[0] - from.x, heldPos[1] - from.y, heldPos[2] - from.z)
      : Infinity;
    if (heldLeg > ANCHOR_RELOCATE_M) {
      anchors.set(toNodeId, candidate);
      return candidate;
    }
    return held;
  }

  function dist3(a: Vec3, b: readonly [number, number, number]): number {
    return Math.hypot(b[0] - a.x, b[1] - a.y, b[2] - a.z);
  }

  /**
   * Does the node's SELECTED outgoing edge dive? Such a node arrives tight — the
   * mark is retained until the body is all but on the take-off. See LEAP_ARRIVE_M.
   */
  function leapsFrom(
    nodeId: string,
    lines: readonly RouteLink["line"][],
  ): boolean {
    const allow = new Set(lines);
    for (const link of linksFrom.get(nodeId) ?? []) {
      if (link.kind === "LEAP_OF_FAITH" && allow.has(link.line)) return true;
    }
    return false;
  }

  /**
   * The node a traversal that completed this tick PROVES the body is on, rejoined
   * to the selected guidance lines.
   *
   * Position alone cannot say a climb finished; a directed link can. The
   * completion is credited to the authored link whose kind matches the verb, whose
   * destination the body is standing on (landing surface), and whose destination
   * is closest to the feet. That destination is where the body now is. If it is
   * off the selected lines (a FAST completion on a SAFE run), the mark rejoins at
   * the nearest selected-line node ON THE SAME SURFACE — never a node on a
   * different deck a straight line happens to pass near. Null when nothing
   * completed or nothing matches, and the position-only progression stands.
   */
  function provenRejoin(
    sample: WayfindSample,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): string | null {
    const completed = sample.completed;
    if (!completed) return null;
    const kinds = COMPLETION_KINDS[completed.verb];
    const supportId = completed.landingId ?? sample.supportId ?? null;
    let best: { to: string; d: number } | null = null;
    for (const link of level.links) {
      if (kinds && !kinds.includes(link.kind)) continue;
      const toPos = posOf.get(link.to);
      if (!toPos) continue;
      if (supportId && surfaceOf.get(link.to) !== supportId) continue;
      const d = dist3(sample.pos, toPos);
      if (d > COMPLETION_ARRIVE_M) continue;
      if (!best || d < best.d) best = { to: link.to, d };
    }
    if (!best) return null;
    if (remainingOf(best.to, toNodeId, lines) !== null) return best.to;
    // The proven node is off the selected lines: rejoin at the nearest selected
    // node on the same landing surface — the downstream point the body can walk on.
    let alt: { id: string; d: number } | null = null;
    for (const node of nodes) {
      if (supportId && node.surface !== supportId) continue;
      if (remainingOf(node.id, toNodeId, lines) === null) continue;
      const d = dist3(sample.pos, node.pos);
      if (!alt || d < alt.d) alt = { id: node.id, d };
    }
    return alt?.id ?? null;
  }

  /**
   * Manage the armed action gateway for a goal, and — when one owns the mark —
   * return it: the takeoff while approaching, the receiver once the body is on the
   * take-off point. Null when no unfinished action link is the next thing on the
   * committed path, in which case the ordinary retire/lead logic runs.
   *
   * This is the whole of the under-4m fix. The ordinary loop retires a node the
   * moment the body is within the lead, which skips an action link's receiver
   * before the action has happened; a gateway instead holds takeoff then receiver
   * and releases only on a MATCHING completion at the destination (or a genuine
   * relocation), so the mark cannot advance past the vault/climb/leap early.
   */
  type GatewayState = {
    linkId: string;
    from: string;
    to: string;
    kind: LinkKind;
    phase: "APPROACH" | "RECEIVER";
  };

  /**
   * Has the body reached the take-off, so the mark hands on to the receiver?
   * True when it is ON the take-off point (tight for a dive, a capsule's reach
   * otherwise) OR already past the midpoint toward the receiver — the latter for
   * a body mid-action. Position, not the passed set: a node banked as some other
   * link's receiver (the gallery, banked by the climb onto it, is also the leap's
   * take-off) must still get its approach.
   */
  function gatewayAtReceiver(
    state: GatewayState,
    from: Vec3,
    takeoffPos: readonly [number, number, number],
    receiverPos: readonly [number, number, number],
    lines: readonly RouteLink["line"][],
  ): boolean {
    const arrive = leapsFrom(state.from, lines) ? LEAP_ARRIVE_M : GATEWAY_TAKEOFF_ARRIVE_M;
    if (reachCost(from, takeoffPos) <= arrive) return true;
    return dist3(from, receiverPos) < dist3(from, takeoffPos);
  }

  /** The mark a live gateway state projects: takeoff while approaching, else receiver. */
  function gatewayWaypoint(
    state: GatewayState,
    takeoffPos: readonly [number, number, number],
    receiverPos: readonly [number, number, number],
  ): WayPoint | null {
    const atReceiverPhase = state.phase === "RECEIVER";
    const markNode = atReceiverPhase ? state.to : state.from;
    const markPos = atReceiverPhase ? receiverPos : takeoffPos;
    const section = sectionOf.get(markNode);
    if (!section) return null;
    const dx = receiverPos[0] - takeoffPos[0];
    const dz = receiverPos[2] - takeoffPos[2];
    const axisLen = Math.hypot(dx, dz) || 1;
    return {
      nodeId: markNode,
      pos: markPos,
      section,
      gateway: {
        linkId: state.linkId,
        fromNodeId: state.from,
        toNodeId: state.to,
        kind: state.kind,
        phase: state.phase,
        axisX: dx / axisLen,
        axisZ: dz / axisLen,
        allowedVerbs: ACTION_VERBS[state.kind] ?? [],
        riseM: receiverPos[1] - takeoffPos[1],
      },
    };
  }

  /**
   * Advance a HELD gateway: release it when a matching completion reaches the
   * destination or the body relocates (returning null so the caller re-selects),
   * otherwise hand the mark from takeoff to receiver at the take-off point and
   * return it held. Runs every tick, before commitAnchor, so a hold tick does not
   * re-evaluate the anchor.
   */
  function stepGateway(
    state: GatewayState,
    toNodeId: string,
    from: Vec3,
    sample: WayfindSample,
    passed: Set<string>,
    lines: readonly RouteLink["line"][],
  ): WayPoint | null {
    const takeoffPos = posOf.get(state.from);
    const receiverPos = posOf.get(state.to);
    if (!takeoffPos || !receiverPos) {
      gateways.delete(toNodeId);
      return null;
    }
    const allowed = ACTION_VERBS[state.kind] ?? [];
    const completion = sample.completed;
    // A matching completion releases the gateway either by ARRIVING at the receiver
    // node or by LANDING ON THE RECEIVER'S OWN DECK. The surface half matters where
    // the action tops out somewhere other than the node coordinate: the clock ledge
    // is climbed onto at its north lip (z=-4.5) but its node sits mid-deck at z=0,
    // ~3.9m away — past COMPLETION_ARRIVE_M — so a node-distance-only release left
    // the gateway held forever, the mark pinned to the take-off, and the next climb
    // never armed. Landing on the receiver's surface with the matching verb is proof
    // the authored action completed, wherever on that deck the body ended up.
    const toSurface = surfaceOf.get(state.to) ?? null;
    const matched =
      !!completion &&
      allowed.includes(completion.verb) &&
      (dist3(sample.pos, receiverPos) <= COMPLETION_ARRIVE_M ||
        (toSurface !== null && completion.landingId === toSurface));
    // The body is grounded BEYOND the receiver along the authored axis: the action
    // is behind it now, whether it completed or the run simply carried past it. Not
    // an early bank — this is past the receiver, not short of it — and it is what
    // lets the mark advance when a completion is not surfaced (a headless walk, a
    // missed event). Airborne mid-action never triggers it (grounded gate).
    const dxAxis = receiverPos[0] - takeoffPos[0];
    const dzAxis = receiverPos[2] - takeoffPos[2];
    const axisLen = Math.hypot(dxAxis, dzAxis);
    const proj =
      axisLen > 1e-6
        ? ((from.x - takeoffPos[0]) * dxAxis + (from.z - takeoffPos[2]) * dzAxis) /
          axisLen
        : 0;
    const pastReceiver =
      sample.grounded !== false && axisLen > 1e-6 && proj > axisLen + GATEWAY_PAST_M;
    const relocated =
      dist3(from, takeoffPos) > ANCHOR_RELOCATE_M &&
      dist3(from, receiverPos) > ANCHOR_RELOCATE_M;
    if (matched || pastReceiver || relocated) {
      passed.add(state.from);
      if (matched || pastReceiver) passed.add(state.to);
      gateways.delete(toNodeId);
      committed.delete(toNodeId);
      return null;
    }
    if (
      state.phase === "APPROACH" &&
      gatewayAtReceiver(state, from, takeoffPos, receiverPos, lines)
    ) {
      state.phase = "RECEIVER";
    }
    return gatewayWaypoint(state, takeoffPos, receiverPos);
  }

  /**
   * At re-selection, arm a gateway on the FIRST action link on the committed path
   * whose receiver is not yet passed and which sits at or before where the
   * ordinary lead would land the mark. Returns the gateway mark, or null when no
   * action link is the next thing (the ordinary lead loop then runs).
   */
  function armGateway(
    at: string,
    path: readonly string[],
    from: Vec3,
    passed: Set<string>,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): WayPoint | null {
    void at;
    let ordinaryNextIdx = path.length;
    for (let i = 1; i < path.length; i += 1) {
      const pos = posOf.get(path[i]!);
      if (pos && reachCost(from, pos) >= WAYPOINT_LEAD_M) {
        ordinaryNextIdx = i;
        break;
      }
    }
    let candidate: { link: RouteLink; from: string; to: string } | null = null;
    for (let i = 0; i + 1 < path.length; i += 1) {
      const fromN = path[i]!;
      const toN = path[i + 1]!;
      if (passed.has(toN)) continue;
      const link = linkBetween(fromN, toN, lines);
      if (!link || !isActionLink(link)) continue;
      if (i + 1 <= ordinaryNextIdx) candidate = { link, from: fromN, to: toN };
      break;
    }
    if (!candidate) return null;
    const takeoffPos = posOf.get(candidate.from);
    const receiverPos = posOf.get(candidate.to);
    if (!takeoffPos || !receiverPos) return null;
    const state: GatewayState = {
      linkId: candidate.link.id,
      from: candidate.from,
      to: candidate.to,
      kind: candidate.link.kind,
      phase: "APPROACH",
    };
    if (gatewayAtReceiver(state, from, takeoffPos, receiverPos, lines)) {
      state.phase = "RECEIVER";
    }
    gateways.set(toNodeId, state);
    return gatewayWaypoint(state, takeoffPos, receiverPos);
  }

  /**
   * The authored ground speed of the leg the body is currently on: the first hop
   * of the committed path from the anchor, when that link authors a pace below a
   * full run. Null otherwise.
   */
  /**
   * The authored cap a HELD directed drop gateway imposes on its whole approach,
   * or null. This is what turns `speedMps: 2.3` from a number the runtime only
   * reads once the anchor is already on the lip into a real safety constraint: a
   * gateway arms a few metres out (see `armGateway`), so returning its authored
   * drop speed here caps free movement for the entire run-in, and a body entering
   * the leg at a full sprint decelerates to the safe pace BEFORE the takeoff
   * corridor rather than sailing off the plank still at 4.6 m/s. Only a drop onto
   * a narrow board caps — the same surface class `isActionLink` gates arming on —
   * so no ordinary gateway (a vault, a wide-deck drop) touches an unrelated leg.
   */
  function gatewayLegCap(
    state: GatewayState,
    lines: readonly RouteLink["line"][],
  ): number | null {
    if (state.kind !== "DROP") return null;
    if (!NARROW_BOARD_SURFACES.has(surfaceOf.get(state.to) ?? "")) return null;
    let cap: number | null = null;
    for (const link of linksFrom.get(state.from) ?? []) {
      if (link.to !== state.to || !lines.includes(link.line)) continue;
      if (link.speedMps === undefined || link.speedMps >= RUN_SPEED) continue;
      cap = cap === null ? link.speedMps : Math.min(cap, link.speedMps);
    }
    return cap;
  }

  function legSpeedCapFor(
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): number | null {
    // A held directed drop gateway owns the pace of its whole approach. Read it
    // FIRST so the cap bites while the body is still running in, not only once
    // the frozen anchor happens to sit on the lip.
    const held = gateways.get(toNodeId);
    if (held) {
      const cap = gatewayLegCap(held, lines);
      if (cap !== null) return cap;
    }
    const at = peekAnchor(from, toNodeId, lines);
    if (!at) return null;
    const path = pathNodes(at, toNodeId, lines);
    if (!path || path.length < 2) return null;
    const next = path[1];
    if (next === undefined) return null;
    // The cap bites only on the leg ONTO or ALONG a narrow board — the ropewalk
    // tie beam — where the authored pace is a real landing constraint rather than
    // a pacing hint. A chain drop authors a speed too (the momentum carried off a
    // lip, which section A's tutorial turns on), and the throng authors a walk
    // pace, and neither is a board a sprint falls off; capping them would be the
    // broad speed change this is careful not to be. So the destination surface,
    // not the leg kind, is the gate: the 1.6m board is the thing sprint overshoots.
    if (!NARROW_BOARD_SURFACES.has(surfaceOf.get(next) ?? "")) return null;
    let cap: number | null = null;
    for (const link of linksFrom.get(at) ?? []) {
      if (link.to !== next || !lines.includes(link.line)) continue;
      if (link.speedMps === undefined || link.speedMps >= RUN_SPEED) continue;
      cap = cap === null ? link.speedMps : Math.min(cap, link.speedMps);
    }
    return cap;
  }

  /**
   * The anchor to MEASURE from, without committing. Reads the committed anchor
   * when the runtime has advanced one and it is still reachable; otherwise the
   * best near anchor computed fresh, so a one-shot query (or the first frame) is
   * still answered honestly.
   */
  function peekAnchor(
    from: Vec3,
    toNodeId: string,
    lines: readonly RouteLink["line"][],
  ): string | null {
    const held = anchors.get(toNodeId);
    if (held !== undefined && remainingOf(held, toNodeId, lines) !== null) {
      return held;
    }
    return bestNearAnchor(from, toNodeId, lines);
  }

  return {
    graph,
    nearestNodeId,
    rangeTo(from, toNodeId) {
      const target = posOf.get(toNodeId);
      const direct = target ? planar(from, target) : 0;
      // The distance is measured over the SAME lines the guidance uses, so a
      // first-run plate reads the length of the SAFE route the mark is walking
      // rather than a shorter all-lines figure the player is not being sent
      // along. The anchor minimises leg + remaining, which makes this figure a
      // continuous function of position: it reads the committed anchor, which a
      // centimetre of movement cannot switch to a different branch. See
      // `commitAnchor`/`peekAnchor`.
      const at = peekAnchor(from, toNodeId, guidanceLines);
      if (!at || !target) return { metres: direct, viaRoute: false };

      const along = pathMetres(at, toNodeId, guidanceLines);
      if (along === null) return { metres: direct, viaRoute: false };

      const here = posOf.get(at)!;
      const leg = Math.hypot(
        here[0] - from.x,
        here[1] - from.y,
        here[2] - from.z,
      );
      // The walked route can only ever be longer than the straight line, and a
      // shorter one would mean the graph disagreed with the geometry it was
      // built from. Taking the larger keeps the number monotone in the thing a
      // player can see — their own distance from the tree — whatever the route
      // does around a corner.
      return { metres: Math.max(direct, leg + along), viaRoute: true };
    },
    peekWaypoint(toNodeId) {
      return committed.get(toNodeId) ?? null;
    },
    legSpeedCap(from, toNodeId) {
      return legSpeedCapFor(from, toNodeId, guidanceLines);
    },
    advanceWaypoint(fromOrSample, toNodeId) {
      // A bare Vec3 is a position-only sample: the mark still works from position
      // alone, it just cannot credit a completed traversal. Every production call
      // hands the rich sample; tests and one-shot queries may pass a point.
      const sample: WayfindSample =
        "pos" in fromOrSample ? fromOrSample : { pos: fromOrSample };
      const from = sample.pos;
      const supportId = sample.grounded === false ? null : sample.supportId ?? null;
      const target = posOf.get(toNodeId);
      if (!target) return null;

      let passed = behind.get(toNodeId);
      if (!passed) {
        passed = new Set<string>();
        behind.set(toNodeId, passed);
      }
      // A node is banked as passed only when the body could actually be leaving
      // it: airborne (support unknown) it is the old position rule, but grounded
      // on a KNOWN surface a node on a DIFFERENT surface is not underfoot and is
      // not banked — the leads node D_GANTRY is not passed by a body standing on
      // the Town House roof a stride from it. Preserves the Shambles, where each
      // node is banked while the body is on its own deck.
      const canBank = (nodeId: string): boolean => {
        if (!supportId) return true;
        const surface = surfaceOf.get(nodeId);
        return surface === undefined || surface === supportId;
      };

      // A DIRECTED DESCENT MUST LAND BEFORE DOWNSTREAM GUIDANCE ADVANCES.
      //
      // Reach is height weighted (a metre up counts for HEIGHT_WEIGHT along), so
      // a body still FALLING onto a lower node reads as having arrived at it: a
      // 1.1m run-off overshoot off the hemp low bale is 1.07m above the floor
      // receiver with almost no planar offset, which reachCost scores 2.85 —
      // inside the 3m arrival radius. Retiring the receiver mid-fall then let the
      // lead loop bank the very next action nodes past it (the rope-capstan VAULT
      // take-off and receiver, 2.5m on) as though the body had walked through
      // them, so the vault was skipped and the mark jumped to the slide beyond.
      // While the body is airborne and still more than a step above a node, that
      // node is a descent target, not somewhere it is standing: it may not be
      // banked as passed, and a held receiver may not be retired as arrived.
      const airborne = sample.grounded === false;
      const descendingToward = (p: readonly [number, number, number]): boolean =>
        airborne && from.y - p[1] > DESCENT_LAND_BAND_M;

      // A selected action link (VAULT/CLIMB/JUMP/dive) held STATEFUL until it is
      // actually performed. While one is armed it owns the mark — takeoff then
      // receiver — and neither lead nor arrival can retire it early. This runs
      // FIRST and, crucially, before commitAnchor: a hold tick returns here and
      // never re-evaluates the anchor, which is what keeps the plate continuous
      // (re-committing the anchor every tick flips branches at the crossings).
      const gwState = gateways.get(toNodeId);
      if (gwState) {
        const gw = stepGateway(gwState, toNodeId, from, sample, passed, guidanceLines);
        if (gw) {
          committed.set(toNodeId, gw);
          return gw;
        }
        // Released inside stepGateway: fall through to re-select the next mark.
      }

      // A completed authored traversal proves which node the body is on. Retire
      // any waypoint that PRECEDES that proven node on the route — a climb onto
      // the leads retires the cornice mark below it, a canopy leap retires the
      // canopy behind it — so the mark cannot stay pinned to a step already
      // taken. The anchor itself is left to the support-aware `commitAnchor`
      // below: forcing it here diverged the fragile Shambles canopy chain, and a
      // proven forward node is exactly what `commitAnchor` advances to anyway.
      const rejoin = provenRejoin(sample, toNodeId, guidanceLines);
      if (rejoin) {
        const rejoinRemaining = remainingOf(rejoin, toNodeId, guidanceLines);
        const held = committed.get(toNodeId);
        if (held && rejoinRemaining !== null && held.nodeId !== rejoin) {
          const heldRemaining = remainingOf(held.nodeId, toNodeId, guidanceLines);
          if (heldRemaining !== null && heldRemaining > rejoinRemaining) {
            passed.add(held.nodeId);
            committed.delete(toNodeId);
          }
        }
      }

      // The one held per goal. Kept across reads on purpose; see
      // WAYPOINT_ABANDON_M for what that is defending against. It is still a
      // pure function of the sequence of samples the run visited, so a replay
      // of the same run produces the same marks.
      const held = committed.get(toNodeId);
      if (held) {
        // Reached is height weighted — a mark on a hold overhead is not reached
        // by standing under it — but abandonment is the plain straight line: a
        // large deviation is a large deviation whichever axis it is on. A node
        // the run LEAPS from arrives tight, so the mark is not handed across the
        // void a second before the take-off.
        const arriveThresh = leapsFrom(held.nodeId, guidanceLines)
          ? LEAP_ARRIVE_M
          : WAYPOINT_ARRIVED_M;
        const reach = reachCost(from, held.pos);
        const away = Math.hypot(
          held.pos[0] - from.x,
          held.pos[1] - from.y,
          held.pos[2] - from.z,
        );
        if (
          (reach > arriveThresh || descendingToward(held.pos)) &&
          away < WAYPOINT_ABANDON_M
        ) {
          return held;
        }
        // Reached, or left behind. Either way it is done with.
        if (
          reach <= arriveThresh &&
          !descendingToward(held.pos) &&
          canBank(held.nodeId)
        ) {
          passed.add(held.nodeId);
        }
        committed.delete(toNodeId);
      }

      // Re-select. commitAnchor stays HERE — reached only when no gateway is held
      // and the ordinary held-check retired its mark — so the anchor advances in
      // discrete forward steps, not every tick.
      const at = commitAnchor(from, toNodeId, guidanceLines, passed, supportId);
      if (!at) {
        gateways.delete(toNodeId);
        return null;
      }
      const path = pathNodes(at, toNodeId, guidanceLines);
      if (!path || path.length === 0) {
        gateways.delete(toNodeId);
        return null;
      }

      // Arm a directed gateway when the next thing on the path is an action link
      // whose receiver the ordinary lead would otherwise skip.
      const armed = armGateway(at, path, from, passed, toNodeId, guidanceLines);
      if (armed) {
        committed.set(toNodeId, armed);
        return armed;
      }

      // THE MARK ONLY EVER ADVANCES, and these two rules are the whole of it.
      //
      // The route is three crossing lines over the same streets, so the node
      // the player is nearest to legitimately jumps between lines as they move
      // — and a cheapest path recomputed from a node slightly BEHIND them
      // starts by sending them back to it. Held for a few seconds and then
      // recomputed from a node behind them again, that is a mark that walks
      // somebody in a loop, which is what the owner reported and which is worse
      // than having no mark at all.
      //
      //   1. A place already reached is never offered again. A loop needs to
      //      revisit something, and this makes that impossible outright.
      //   2. A candidate must be closer to the goal, along the route, than the
      //      player is now. Pointing at somewhere further from the tree than
      //      the place you are standing is not a direction, whatever the graph
      //      thinks the cheapest path through it costs.
      const remainingNow = pathMetres(at, toNodeId, guidanceLines);
      for (const nodeId of path) {
        if (nodeId === at || passed.has(nodeId)) continue;
        const pos = posOf.get(nodeId);
        const section = sectionOf.get(nodeId);
        if (!pos || !section) continue;
        // Height weighted, so a hold a climb above the body is offered as the
        // next mark rather than skipped as underfoot — a metre and a half of
        // vertical is not something the body has already walked past.
        const away = reachCost(from, pos);
        if (away < WAYPOINT_LEAD_M) {
          // Close enough to count as underfoot: bank it so the search cannot
          // come back to it later from a node further behind — but only a node
          // on the body's own surface (see `canBank`), and never a node the
          // airborne body is still falling toward (see `descendingToward`).
          if (
            away <= WAYPOINT_ARRIVED_M &&
            canBank(nodeId) &&
            !descendingToward(pos)
          ) {
            passed.add(nodeId);
          }
          continue;
        }
        const remainingThere = pathMetres(nodeId, toNodeId, guidanceLines);
        if (
          remainingNow !== null &&
          remainingThere !== null &&
          remainingThere >= remainingNow
        ) {
          continue;
        }
        const next: WayPoint = { nodeId, pos, section };
        committed.set(toNodeId, next);
        return next;
      }
      return null;
    },
  };
}
