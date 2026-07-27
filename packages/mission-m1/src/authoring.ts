// Authoring helpers. These exist so the level file reads as intent — "a
// three-storey house here, a lean-to against it, a plank across the alley" —
// while still emitting exactly the two primitives the engine understands.

import { JETTY_M, RAMP_STEP_RISE_M } from "./envelope.js";
import type {
  ClimbSpec,
  DeckSpec,
  MassSpec,
  RampSpec,
  Rect,
  RouteLink,
  RouteNode,
  SectionId,
  Vec3Tuple,
  Verb,
} from "./types.js";

export function rect(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
): Rect {
  return { minX, maxX, minZ, maxZ };
}

export function inflate(source: Rect, by: number): Rect {
  return {
    minX: source.minX - by,
    maxX: source.maxX + by,
    minZ: source.minZ - by,
    maxZ: source.maxZ + by,
  };
}

export function rectCentre(source: Rect): [number, number] {
  return [(source.minX + source.maxX) / 2, (source.minZ + source.maxZ) / 2];
}

export interface StructureOpts {
  id: string;
  section: SectionId;
  asset: string;
  rect: Rect;
  /** Wall top == roof deck height. The deck oversails it by `jetty`. */
  roofY: number;
  jetty?: number;
  /** Set false for a building with no reachable roof (backdrop mass). */
  walkableRoof?: boolean;
  tags?: string[];
  note?: string;
}

/**
 * A building: one full-height solid mass topped by a jettied roof deck.
 *
 * The jetty is not decoration. A capsule needs its centre CAPSULE_RADIUS clear
 * of a wall face, so a deck flush with its own wall would embed the player the
 * instant a fall took the foot below the wall top. Oversailing the mass by
 * JETTY_M puts every roof lip a safe stand-off outside the wall beneath it —
 * which is also, conveniently, how the city was actually built.
 */
export function structure(opts: StructureOpts): {
  mass: MassSpec;
  deck: DeckSpec | null;
} {
  const jetty = opts.jetty ?? JETTY_M;
  const mass: MassSpec = {
    id: opts.id,
    section: opts.section,
    asset: opts.asset,
    rect: opts.rect,
    baseY: 0,
    topY: opts.roofY,
    landable: false,
    tags: ["structure", ...(opts.tags ?? [])],
    ...(opts.note ? { note: opts.note } : {}),
  };
  if (opts.walkableRoof === false) return { mass, deck: null };
  const deck: DeckSpec = {
    id: `${opts.id}__ROOF`,
    section: opts.section,
    asset: null,
    rect: inflate(opts.rect, jetty),
    y: opts.roofY,
    carriedBy: [opts.id],
    tags: ["roof", ...(opts.tags ?? [])],
  };
  return { mass, deck };
}

export interface PropOpts {
  id: string;
  section: SectionId;
  asset: string;
  rect: Rect;
  topY: number;
  baseY?: number;
  landable?: boolean;
  yaw?: number;
  /** For a suspended dressing (an effigy hung from a bough): what carries it. */
  carriedBy?: string[];
  tags?: string[];
  note?: string;
}

/** A solid prop: crate stack, cart, barrel group, cover, wall stub. */
export function prop(opts: PropOpts): MassSpec {
  return {
    id: opts.id,
    section: opts.section,
    asset: opts.asset,
    rect: opts.rect,
    baseY: opts.baseY ?? 0,
    topY: opts.topY,
    landable: opts.landable ?? true,
    ...(opts.yaw === undefined ? {} : { yaw: opts.yaw }),
    ...(opts.carriedBy ? { carriedBy: opts.carriedBy } : {}),
    tags: ["prop", ...(opts.tags ?? [])],
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export interface DeckOpts {
  id: string;
  section: SectionId;
  asset: string | null;
  rect: Rect;
  y: number;
  carriedBy?: string[];
  tags?: string[];
  note?: string;
}

/** A surface you can stand on and walk under: plank, awning, gallery, bough. */
export function deck(opts: DeckOpts): DeckSpec {
  return {
    id: opts.id,
    section: opts.section,
    asset: opts.asset,
    rect: opts.rect,
    y: opts.y,
    carriedBy: opts.carriedBy ?? [],
    tags: opts.tags ?? [],
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/**
 * A soffit: solid slab with air under it. Two jobs — force a duck when its
 * underside sits between crouch and stand height, and break the sight line of
 * anything looking down from above.
 */
export function soffit(opts: {
  id: string;
  section: SectionId;
  asset: string;
  rect: Rect;
  baseY: number;
  thickness?: number;
  /** The body this slab is part of or guyed to; it rests on nothing itself. */
  carriedBy?: string[];
  tags?: string[];
  note?: string;
}): MassSpec {
  return {
    id: opts.id,
    section: opts.section,
    asset: opts.asset,
    rect: opts.rect,
    baseY: opts.baseY,
    topY: opts.baseY + (opts.thickness ?? 0.5),
    landable: false,
    ...(opts.carriedBy ? { carriedBy: opts.carriedBy } : {}),
    tags: ["soffit", ...(opts.tags ?? [])],
    ...(opts.note ? { note: opts.note } : {}),
  };
}

export interface ClimbVolumeOpts {
  section: SectionId;
  /** Route link this volume exists to make available; also names the volume. */
  serves: string;
  /** Deck or landable mass top the ascent arrives on. */
  onto: string;
  /** Where the player stands to make it — normally the link's from-node. */
  at: Vec3Tuple;
  /** Half extents of the standing footprint. */
  halfX?: number;
  halfZ?: number;
  note?: string;
}

/**
 * The foot of an authored vertical ascent.
 *
 * Sized to the arrival rather than to the storey: a player walks the last stride
 * into the spot and the volume has to already be true when they get there, so it
 * reaches back further than a body is wide. It should still be small enough that
 * standing under the far end of the same boards grants nothing, because the
 * whole value of authoring this is that it says where.
 */
export function climbVolume(opts: ClimbVolumeOpts): ClimbSpec {
  const halfX = opts.halfX ?? 0.9;
  const halfZ = opts.halfZ ?? 0.9;
  const [x, y, z] = opts.at;
  return {
    id: `CLIMBVOL_${opts.serves}`,
    section: opts.section,
    rect: rect(x - halfX, x + halfX, z - halfZ, z + halfZ),
    standMinY: y - 0.4,
    standMaxY: y + 0.4,
    onto: opts.onto,
    serves: opts.serves,
    ...(opts.note ? { note: opts.note } : {}),
  };
}

/**
 * Stepped strips for a walkable slope.
 *
 * There is no sloped-surface support in the collision model, so a stair or a
 * cart ramp is a run of strips under one imported asset. Each strip rises less
 * than STEP_UP, so the flow reader absorbs it as a step rather than stopping;
 * this is invisible collision, which the asset rule allows.
 */
export function rampStrips(spec: RampSpec): DeckSpec[] {
  const rise = spec.to.y - spec.from.y;
  const run = spec.to.at - spec.from.at;
  const steps = Math.max(1, Math.ceil(Math.abs(rise) / RAMP_STEP_RISE_M));
  const strips: DeckSpec[] = [];
  for (let index = 0; index <= steps; index++) {
    const t0 = index / (steps + 1);
    const t1 = (index + 1.35) / (steps + 1); // overlap so no seam can drop you
    const a = spec.from.at + run * t0;
    const b = spec.from.at + run * Math.min(1, t1);
    const y = spec.from.y + rise * ((index + 0.5) / (steps + 1));
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    strips.push({
      id: `${spec.id}__S${index}`,
      section: spec.section,
      asset: index === 0 ? spec.asset : null,
      rect:
        spec.axis === "X"
          ? rect(lo, hi, spec.cross - spec.halfWidth, spec.cross + spec.halfWidth)
          : rect(spec.cross - spec.halfWidth, spec.cross + spec.halfWidth, lo, hi),
      y,
      carriedBy: [],
      tags: ["ramp", ...spec.tags],
    });
  }
  return strips;
}

// ---- route sugar -----------------------------------------------------------

export function node(
  id: string,
  section: SectionId,
  pos: Vec3Tuple,
  surface: string,
  tags: string[] = [],
  note?: string,
): RouteNode {
  return { id, section, pos, surface, tags, ...(note ? { note } : {}) };
}

export function link(
  from: string,
  to: string,
  kind: RouteLink["kind"],
  line: RouteLink["line"],
  verb: Verb,
  extra: Partial<Omit<RouteLink, "id" | "from" | "to" | "kind" | "line" | "verb">> = {},
): RouteLink {
  return {
    id: `${from}->${to}`,
    from,
    to,
    kind,
    line,
    verb,
    ...extra,
  };
}
