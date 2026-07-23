import { FIELD_TICK_HZ } from "./fieldSimulation.js";
import {
  INTERIOR_STORY_LOCAL,
  interiorPoint,
  type InteriorVec3,
} from "./interiorManifest.js";

export type NamedActorId =
  | "abigail"
  | "thomas"
  | "pike"
  | "clarke"
  | "rider";

export interface ActorRouteDefinition {
  actorId: NamedActorId;
  homeInterior: string | null;
  homeLocal: InteriorVec3 | null;
  exterior: readonly (readonly [number, number, number])[];
  speedMps: number;
}

export interface ActorRoutePose {
  position: [number, number, number];
  yaw: number;
  moving: boolean;
  spaceId: string;
}

export const NAMED_ACTOR_ROUTES: Record<NamedActorId, ActorRouteDefinition> = {
  abigail: {
    actorId: "abigail",
    homeInterior: "MERCER_PRESS",
    homeLocal: INTERIOR_STORY_LOCAL.MERCER_ABIGAIL_DESK,
    exterior: [
      [1.4, 0, 10.2],
      [6, 0, 8.8],
    ],
    speedMps: 0.82,
  },
  thomas: {
    actorId: "thomas",
    homeInterior: "THOMAS_COUNTINGHOUSE",
    homeLocal: INTERIOR_STORY_LOCAL.THOMAS_ACTOR,
    exterior: [
      [-71, 0, -9.6],
      [-58, 0, -6],
      [-50, 0, -6.5],
    ],
    speedMps: 0.86,
  },
  pike: {
    actorId: "pike",
    homeInterior: "PIKE_OFFICE",
    homeLocal: INTERIOR_STORY_LOCAL.PIKE_ACTOR,
    exterior: [
      [31, 0, 10.2],
      [44, 0, 7.4],
      [55, 0, 7.1],
    ],
    speedMps: 0.8,
  },
  clarke: {
    actorId: "clarke",
    homeInterior: "EXPLORE_clarke",
    homeLocal: [2.5, 0, 2.5],
    exterior: [
      [-32, 0, 10.4],
      [-24, 0, 7.5],
      [-8, 0, 7.4],
    ],
    speedMps: 0.72,
  },
  rider: {
    actorId: "rider",
    homeInterior: null,
    homeLocal: null,
    exterior: [[-96.8, 0, -18.2]],
    speedMps: 0,
  },
};

function seedOffset(seed: number, actorId: string): number {
  let hash = seed >>> 0;
  for (const char of actorId) {
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return (hash % 2400) / 100;
}

function sampleExterior(
  route: ActorRouteDefinition,
  tick: number,
  seed: number,
): ActorRoutePose {
  if (route.exterior.length === 1 || route.speedMps <= 0) {
    return {
      position: [...route.exterior[0]!] as [number, number, number],
      yaw: route.actorId === "rider" ? 0.9 : 0,
      moving: false,
      spaceId: "EXTERIOR",
    };
  }
  const legs: {
    from: readonly [number, number, number];
    to: readonly [number, number, number];
    length: number;
  }[] = [];
  for (let index = 0; index < route.exterior.length - 1; index += 1) {
    const from = route.exterior[index]!;
    const to = route.exterior[index + 1]!;
    legs.push({ from, to, length: Math.hypot(to[0] - from[0], to[2] - from[2]) });
  }
  for (let index = route.exterior.length - 1; index > 0; index -= 1) {
    const from = route.exterior[index]!;
    const to = route.exterior[index - 1]!;
    legs.push({ from, to, length: Math.hypot(to[0] - from[0], to[2] - from[2]) });
  }
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  const seconds = tick / FIELD_TICK_HZ + seedOffset(seed, route.actorId);
  let distance = (seconds * route.speedMps) % total;
  let selected = legs[0]!;
  for (const leg of legs) {
    selected = leg;
    if (distance <= leg.length) break;
    distance -= leg.length;
  }
  const amount = selected.length > 0 ? distance / selected.length : 0;
  return {
    position: [
      selected.from[0] + (selected.to[0] - selected.from[0]) * amount,
      selected.from[1] + (selected.to[1] - selected.from[1]) * amount,
      selected.from[2] + (selected.to[2] - selected.from[2]) * amount,
    ],
    yaw: Math.atan2(
      selected.to[0] - selected.from[0],
      selected.to[2] - selected.from[2],
    ),
    moving: true,
    spaceId: "EXTERIOR",
  };
}

export function actorRoutePose(
  actorId: NamedActorId,
  spaceId: string,
  tick: number,
  seed: number,
): ActorRoutePose | null {
  const route = NAMED_ACTOR_ROUTES[actorId];
  if (spaceId === "EXTERIOR") return sampleExterior(route, tick, seed);
  if (route.homeInterior !== spaceId || !route.homeLocal) return null;
  return {
    position: interiorPoint(spaceId, route.homeLocal),
    yaw: Math.PI,
    moving: false,
    spaceId,
  };
}

export function actorOwner(
  scripted: boolean,
  reactiveEnabled: boolean,
): "SCRIPTED" | "REACTIVE" | "NONE" {
  if (scripted) return "SCRIPTED";
  return reactiveEnabled ? "REACTIVE" : "NONE";
}
