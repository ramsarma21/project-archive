import { STEALTH_TUNING, type WatcherPose } from "@pa/engine-world";
import {
  CONE_FIELD_M,
  LINE_REACH_M,
  MAX_CONES,
  NEAR_FIELD_M,
} from "./visorPalette.js";

// ---------------------------------------------------------------------------
// What the visor draws, decided before anything is drawn.
//
// This file computes NOTHING about the world. Every position, cone, crowd radius
// and light level in here was authored by the level or published by the stealth
// field, and the only arithmetic performed is arithmetic of presentation: how far
// away a thing is from where the player is standing, whether that is near enough
// to draw or only near enough to name, and which handful survives the cull.
//
// That division is the reason it is worth a file of its own. The visor's one real
// design problem is RANGE — spawn is on the printshop leads and the elm is eighty
// metres east, so most of the mission is distance — and range is a decision about
// what to say, not a rendering technique. Deciding it here, in plain data, means
// the decision can be read, reasoned about and changed without touching a shader,
// and means the renderer downstream is dumb enough to be obviously correct.
//
// Two rules hold the whole thing together.
//
// THE CULL IS AGGRESSIVE AND IT IS THE POINT. A held moment does not repeat, so
// it has one pass to be legible. Every list below is capped: at most two vision
// cones, at most one crowd, one dark pool and one lit pool, one mid-range
// landmark, one destination, and route line only as far as the first fork. A
// visor that annotated everything would be a visor that taught nothing — and it
// was one, until it was looked at: range alone kept 32 of M1's links and drew the
// whole opening third of the level as one crossing tangle. See `LINE_REACH_M`.
//
// NOTHING HERE IS M1. The level supplies a `VisorSource`; `m1VisorSource.ts` is
// one implementation of it. Mission 2 writes its own and this file does not move.
// ---------------------------------------------------------------------------

export type Vec3Tuple = readonly [number, number, number];
export type RouteLineName = "SAFE" | "FAST" | "EXPERT";

// ---------------------------------------------------------------------------
// what a level supplies
// ---------------------------------------------------------------------------

export interface VisorNode {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly tags: readonly string[];
}

export interface VisorLink {
  readonly from: string;
  readonly to: string;
  readonly line: RouteLineName;
  readonly verb: string;
}

/** A concealment tool or an exposure the level authored, as an area. */
export interface VisorZone {
  readonly id: string;
  readonly kind: "CROWD" | "DARK" | "LIT";
  /** Centre at ground level. */
  readonly centre: Vec3Tuple;
  /** Circular extent (crowds) or the half-extents of a rect (light volumes). */
  readonly radiusM?: number;
  readonly halfX?: number;
  readonly halfZ?: number;
  readonly label: string;
  readonly detail: string;
}

/** Somewhere worth naming from a distance. Not a waypoint; not on any path. */
export interface VisorLandmark {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly label: string;
  readonly detail: string;
}

/** Where the run is going, and what happens on arrival. */
export interface VisorDestination {
  readonly pos: Vec3Tuple;
  readonly label: string;
  readonly detail: string;
  /** Height the annotation ring sits at: the work itself, not the ground. */
  readonly workY: number;
}

export interface VisorSource {
  readonly nodes: readonly VisorNode[];
  readonly links: readonly VisorLink[];
  readonly startNodeId: string;
  /** Watcher id to the phrase that names him. Positions come from the field. */
  readonly watcherRoles: Readonly<Record<string, string>>;
  readonly zones: readonly VisorZone[];
  readonly landmarks: readonly VisorLandmark[];
  readonly destination: VisorDestination;
  /**
   * The node whose annotation is the first thing to do. M1's is the drying rack:
   * custody of the unstamped sheets, four metres from the spawn, no stop and no
   * line of dialogue — so if it is not annotated the player runs straight past
   * the object the entire mission is about.
   */
  readonly firstBeatNodeId: string | null;
}

// ---------------------------------------------------------------------------
// what the renderer is handed
// ---------------------------------------------------------------------------

export interface VisorPath {
  readonly id: string;
  readonly line: RouteLineName;
  /** Already lifted clear of the surface it lies on. */
  readonly points: readonly Vec3Tuple[];
  /** Where this line's chip goes, and which verb it opens with. */
  readonly chipAt: Vec3Tuple;
  readonly openingVerb: string;
}

export interface VisorCone {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly yaw: number;
  readonly halfAngleRad: number;
  readonly rangeM: number;
  readonly role: string;
  readonly distanceM: number;
}

/** A watcher too far to draw a cone for, but not too far to be counted. */
export interface VisorMark {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly distanceM: number;
  readonly role: string;
}

export interface VisorZoneDraw extends VisorZone {
  readonly distanceM: number;
}

export interface VisorPin {
  readonly id: string;
  readonly pos: Vec3Tuple;
  readonly title: string;
  readonly detail: string;
  readonly distanceM: number;
}

export interface VisorBeacon {
  readonly pos: Vec3Tuple;
  /** Top of the shaft. Above the rooflines, so the destination is visible. */
  readonly topY: number;
  /** The ring at the work: the nail height, not the ground. */
  readonly workY: number;
  /**
   * Height the destination's NAME is written at, which is not the top of the
   * shaft. See `BEACON_LABEL_RISE_M` — a label at 34m and 78m out sits above the
   * frame of a player standing on the leads, so the one thing the beacon exists
   * to say was drawn off screen.
   */
  readonly labelY: number;
  readonly label: string;
  readonly detail: string;
  readonly distanceM: number;
  /** Compass bearing from the spawn, degrees clockwise from north. */
  readonly bearingDeg: number;
}

/** The four questions the held moment exists to answer, already answered. */
export interface VisorAnswers {
  readonly destination: string;
  readonly destinationRange: string;
  readonly bearing: string;
  readonly objectives: readonly string[];
  readonly dangerHeadline: string;
  readonly dangerDetail: string;
  /**
   * What the areas the visor drew are worth, in the level's own words.
   *
   * Exactly the zones in `plan.zones` and no others, so this cannot name cover
   * the player has not been shown. The sentences used to be printed on the areas
   * themselves and a route line ran straight through one of them; a sentence
   * belongs where the chrome keeps sentences, and the area keeps its tag.
   */
  readonly cover: readonly {
    /** Carried so the chrome can hue it the way the street is hued. */
    readonly kind: VisorZone["kind"];
    readonly label: string;
    readonly detail: string;
  }[];
  readonly lines: readonly {
    readonly line: RouteLineName;
    readonly promise: string;
  }[];
}

export interface VisorPlan {
  readonly paths: readonly VisorPath[];
  readonly cones: readonly VisorCone[];
  readonly marks: readonly VisorMark[];
  readonly zones: readonly VisorZoneDraw[];
  readonly pins: readonly VisorPin[];
  readonly landmarks: readonly (VisorLandmark & { readonly distanceM: number })[];
  readonly beacon: VisorBeacon;
  readonly answers: VisorAnswers;
}

// ---------------------------------------------------------------------------
// geometry of presentation
// ---------------------------------------------------------------------------

/** Planar range. Height is never part of "how far away is that". */
export function planarRange(a: Vec3Tuple, b: Vec3Tuple): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2]);
}

/** Degrees clockwise from +Z, which is the level's north. */
export function bearingDeg(from: Vec3Tuple, to: Vec3Tuple): number {
  const deg = (Math.atan2(to[0] - from[0], to[2] - from[2]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

export function compassOf(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]!;
}

/** Metres, as the visor prints them: whole numbers, and never "0 m". */
export function rangeLabel(metres: number): string {
  return `${Math.max(1, Math.round(metres))} m`;
}

/**
 * Is this in front of the player?
 *
 * Generous — a hemisphere and then some — because the player can look around
 * during the hold and annotation that vanished the moment they turned their head
 * would read as a bug. What it is really for is refusing to draw the stretch of
 * route BEHIND the spawn, which on a level that runs west to east is a line
 * leaving the frame in the wrong direction.
 */
function inFront(spawn: Vec3Tuple, facingYaw: number, at: Vec3Tuple): boolean {
  const dx = at[0] - spawn[0];
  const dz = at[2] - spawn[2];
  const length = Math.hypot(dx, dz);
  if (length < 0.5) return true;
  const dot = (Math.sin(facingYaw) * dx + Math.cos(facingYaw) * dz) / length;
  return dot > -0.4;
}

/** Clear of the surface a path lies on, so a roof deck cannot z-fight with it. */
const PATH_LIFT_M = 0.12;

function lift(pos: Vec3Tuple): Vec3Tuple {
  return [pos[0], pos[1] + PATH_LIFT_M, pos[2]];
}

// ---------------------------------------------------------------------------
// the three lines, as polylines
// ---------------------------------------------------------------------------

/**
 * Chains one line's links into polylines, walked outward from where it starts.
 *
 * The authored route is a graph, not three paths: the lines cross, and a player
 * may swap at any shared node. So a line becomes SEVERAL polylines wherever it
 * forks, and each fork is drawn from the node it left — which is exactly the
 * picture worth showing, because the fork IS the choice.
 *
 * Two bounds, doing different jobs. `drawable` refuses a node outright.
 * `canExpand` lets a node be REACHED but not walked past, so the one link that
 * crosses the reach is kept and the branch ends pointing somewhere — a stub cut
 * off before it has committed to a direction is a stub that says nothing, and the
 * direction off the leads is the entire message.
 *
 * Links are walked from nodes with nothing arriving at them, so a chain is drawn
 * in travel order and its chip lands at the end the player is standing at rather
 * than in the middle of a descent.
 */
function chainPolylines(
  links: readonly VisorLink[],
  positionOf: (id: string) => Vec3Tuple | undefined,
  drawable: (id: string) => boolean,
  canExpand: (id: string) => boolean,
  startNodeId: string | null,
  rangeTo: (id: string) => number | null,
): Array<{ ids: string[]; verb: string }> {
  const out: Array<{ ids: string[]; verb: string }> = [];
  const outgoing = new Map<string, VisorLink[]>();
  const arrivals = new Set<string>();
  for (const link of links) {
    const list = outgoing.get(link.from);
    if (list) list.push(link);
    else outgoing.set(link.from, [link]);
    arrivals.add(link.to);
  }

  const heads = [...outgoing.keys()].filter((id) => !arrivals.has(id));
  // The node the ROUTE DECLARES it starts at seeds a polyline whether or not
  // anything arrives there, because "nothing arrives here" is a bad proxy for
  // "the run begins here" and this level proved it. A reserved pad is authored
  // with RUN links in BOTH directions by construction — onto the pad, and back
  // off it to the golden line — so a single authored back-link is enough to drop
  // the start node out of `heads`. `S1_PRINTSHOP_VANTAGE -> A_START` did exactly
  // that, leaving the only heads up in Dock Square, both outside LINE_REACH_M of
  // spawn, and the briefing drew NOTHING at all. Seeding the declared start
  // survives any number of pads authored the same way.
  const declared = startNodeId !== null && outgoing.has(startNodeId) ? [startNodeId] : [];
  const starts = [...new Set([...declared, ...heads])];

  const walked = new Set<VisorLink>();
  const walk = (from: string, prefix: string[], verb: string): void => {
    const next = canExpand(from)
      ? (outgoing.get(from) ?? []).filter(
          // A link survives only if BOTH ends are drawable, and the near end
          // already is by construction: half a jump annotated is worse than no
          // jump annotated, because it points at nothing.
          //
          // It must also not double back onto a node this polyline has already
          // drawn. The pads are authored with RUN links both ways, so without
          // this the hold drew a line that left the player's feet and returned to
          // them — a closed loop under the reticle, spending a quarter of the
          // four-polyline budget to say nothing. Truncating it leaves a stub that
          // at least points at the pad.
          (link) => !walked.has(link) && drawable(link.to) && !prefix.includes(link.to),
        )
      : [];
    if (next.length === 0) {
      if (prefix.length >= 2) out.push({ ids: prefix, verb });
      return;
    }
    for (const link of next) {
      walked.add(link);
      walk(link.to, [...prefix, link.to], verb);
    }
  };

  const seedFrom = (start: string): void => {
    if (!drawable(start) || !canExpand(start)) return;
    const first = (outgoing.get(start) ?? [])[0];
    walk(start, [start], first?.verb ?? "RUN");
  };

  for (const start of starts) seedFrom(start);

  // The last resort runs when nothing was DRAWN, not when no head EXISTS. Those
  // are different conditions, and only the first one is the failure: a graph can
  // have heads and still draw nothing when every head is out of reach, which the
  // old `heads.length > 0` test could not see — so it drew an empty hold and
  // reported success. Ordered by range so the pick is the nearest line out of
  // where the player stands; the previous version took whichever node the first
  // authored link happened to leave from, which was authoring order deciding
  // what a player sees. One seed is a briefing, so stop at the first that draws.
  if (out.length === 0) {
    walked.clear();
    const nearestFirst = [...outgoing.keys()]
      .filter((id) => drawable(id) && canExpand(id))
      .sort((a, b) => (rangeTo(a) ?? Infinity) - (rangeTo(b) ?? Infinity));
    for (const start of nearestFirst) {
      seedFrom(start);
      if (out.length > 0) break;
    }
  }

  return out.filter((chain) => chain.ids.every((id) => positionOf(id)));
}

function buildPaths(
  source: VisorSource,
  spawn: Vec3Tuple,
  facingYaw: number,
): VisorPath[] {
  const byId = new Map(source.nodes.map((node) => [node.id, node]));
  const positionOf = (id: string) => byId.get(id)?.pos;

  /** Planar range to a node, or null when it is unknown or behind the player. */
  const rangeTo = (id: string): number | null => {
    const node = byId.get(id);
    if (!node) return null;
    if (!inFront(spawn, facingYaw, node.pos)) return null;
    return planarRange(spawn, node.pos);
  };

  const drawable = (id: string): boolean => {
    const range = rangeTo(id);
    return range !== null && range <= NEAR_FIELD_M;
  };
  const canExpand = (id: string): boolean => {
    const range = rangeTo(id);
    return range !== null && range <= LINE_REACH_M;
  };

  const paths: VisorPath[] = [];
  for (const line of ["SAFE", "FAST", "EXPERT"] as const) {
    const chains = chainPolylines(
      source.links.filter((link) => link.line === line),
      positionOf,
      drawable,
      canExpand,
      source.startNodeId,
      rangeTo,
    );
    chains.forEach((chain, index) => {
      const points = chain.ids.map((id) => lift(positionOf(id)!));
      // The chip goes on the second point rather than the first: every line out
      // of a shared node starts in the same place, and three chips stacked on one
      // pixel is three chips nobody can read.
      const chipAt = points[1] ?? points[0]!;
      paths.push({
        id: `${line}:${chain.ids[0]}:${index}`,
        line,
        points,
        chipAt: [chipAt[0], chipAt[1] + 0.85, chipAt[2]],
        openingVerb: chain.verb,
      });
    });
  }
  return paths;
}

// ---------------------------------------------------------------------------
// the plan
// ---------------------------------------------------------------------------

/** The height the destination shaft reaches. Clear of every roof in the level. */
const BEACON_TOP_Y = 34;

/**
 * How far above the player's own footing the destination is NAMED.
 *
 * The shaft and the name have different jobs and therefore different heights.
 * The shaft has to clear every roof between here and the elm, which is what
 * `BEACON_TOP_Y` is for. The name only has to be readable — and a name at the
 * top of a 34m shaft eighty metres away sits twenty-two degrees above the
 * horizon, which is outside the frame of a player standing on the leads, so the
 * destination went unnamed in the one view the whole hold is anchored to.
 *
 * Ten metres above the player's own feet is inside that frame at any range and
 * still well over the street, so the plate reads against sky rather than against
 * a roof. Relative to the spawn rather than absolute because the spawn is what
 * the camera's height is derived from.
 */
const BEACON_LABEL_RISE_M = 10;

export function buildVisorPlan(input: {
  readonly source: VisorSource;
  readonly spawn: Vec3Tuple;
  readonly facingYaw: number;
  /** Straight from `instance.watcherPosesAtTick(0, seed)`. Never recomputed. */
  readonly watchers: readonly WatcherPose[];
  /** Required objectives, in the level's own words. */
  readonly objectives: readonly string[];
  readonly lineNotes: readonly { line: RouteLineName; promise: string }[];
}): VisorPlan {
  const { source, spawn, facingYaw, watchers } = input;

  const paths = buildPaths(source, spawn, facingYaw);

  // Watchers, nearest first. The two closest get a cone; the rest are counted,
  // because seven cones drawn from a rooftop is a diagram of a stealth system
  // rather than a briefing about a street.
  const ranked = watchers
    .map((watcher) => {
      const pos: Vec3Tuple = [
        watcher.position.x,
        watcher.position.y,
        watcher.position.z,
      ];
      return {
        id: watcher.id,
        pos,
        yaw: watcher.baseYaw,
        // A pose may leave either of these out, and the field then falls back to
        // its own tuning. The visor falls back to the SAME numbers, because a cone
        // drawn at a width the simulation is not using is worse than no cone.
        halfAngleRad: watcher.halfAngleRad ?? STEALTH_TUNING.coneHalfAngleRad,
        rangeM: watcher.rangeM ?? STEALTH_TUNING.coneRangeM,
        role: source.watcherRoles[watcher.id] ?? "the watch",
        distanceM: planarRange(spawn, pos),
      };
    })
    .sort((a, b) => a.distanceM - b.distanceM);

  const cones = ranked
    .filter((watcher) => watcher.distanceM <= CONE_FIELD_M)
    .slice(0, MAX_CONES);
  const coneIds = new Set(cones.map((cone) => cone.id));
  const marks = ranked
    .filter((watcher) => !coneIds.has(watcher.id))
    .map(({ id, pos, distanceM, role }) => ({ id, pos, distanceM, role }));

  // One of each kind of tool, and the nearest one, because the nearest one is
  // the one the next thirty seconds will actually ask about.
  const zones: VisorZoneDraw[] = [];
  for (const kind of ["DARK", "LIT", "CROWD"] as const) {
    const nearest = source.zones
      .filter((zone) => zone.kind === kind)
      .map((zone) => ({ ...zone, distanceM: planarRange(spawn, zone.centre) }))
      .filter((zone) => inFront(spawn, facingYaw, zone.centre))
      .sort((a, b) => a.distanceM - b.distanceM)[0];
    if (nearest) zones.push(nearest);
  }

  const pins: VisorPin[] = [];
  const firstBeat = source.nodes.find((node) => node.id === source.firstBeatNodeId);
  if (firstBeat) {
    pins.push({
      id: firstBeat.id,
      pos: [firstBeat.pos[0], firstBeat.pos[1] + 1.5, firstBeat.pos[2]],
      title: "Take the sheets",
      detail: "Run the rack. No stop.",
      distanceM: planarRange(spawn, firstBeat.pos),
    });
  }

  const landmarks = source.landmarks
    .map((landmark) => ({
      ...landmark,
      distanceM: planarRange(spawn, landmark.pos),
    }))
    .filter((landmark) => inFront(spawn, facingYaw, landmark.pos))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, 1);

  const destination = source.destination;
  const destinationRange = planarRange(spawn, destination.pos);
  const heading = bearingDeg(spawn, destination.pos);

  const beacon: VisorBeacon = {
    pos: destination.pos,
    topY: BEACON_TOP_Y,
    workY: destination.workY,
    labelY: spawn[1] + BEACON_LABEL_RISE_M,
    label: destination.label,
    detail: destination.detail,
    distanceM: destinationRange,
    bearingDeg: heading,
  };

  const inCone = cones.length;
  return {
    paths,
    cones,
    marks,
    zones,
    pins,
    landmarks,
    beacon,
    answers: {
      destination: destination.label,
      destinationRange: rangeLabel(destinationRange),
      bearing: compassOf(heading),
      objectives: input.objectives,
      dangerHeadline: `${watchers.length} watch on the route`,
      dangerDetail:
        inCone === 0
          ? "None inside the visor's reach. They are ahead of you."
          : `${inCone} inside ${CONE_FIELD_M} m — their cones are drawn. The rest are marked.`,
      cover: zones.map((zone) => ({
        kind: zone.kind,
        label: zone.label,
        detail: zone.detail,
      })),
      lines: input.lineNotes.filter((note) =>
        paths.some((path) => path.line === note.line),
      ),
    },
  };
}
