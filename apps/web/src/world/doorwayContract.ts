// ---------------------------------------------------------------------------
// Shared doorway contract / resolver (single source of truth).
//
// WHY THIS EXISTS (root causes 1-5, confirmed by Sol's diagnosis):
//   1. Buildings render with a UNIFORM min-axis contain-fit to their nominal
//      manifest slot, so the VISUAL facade sits at the FITTED half-depth, not
//      the nominal `size/2`. Doors placed at the nominal plane float/protrude
//      0.5-2.1m. This module resolves every doorway against the *actual fitted
//      facade*, exactly mirroring Character.tsx > FittedGlbInner.
//   2/3/4/5. Placement (lateral door centre, hinge side, recess, sill),
//      the imported-leaf hinge, sensor lanes, quest-marker visual anchors,
//      room-opening lanes and collision shapes are all derived HERE, once, so
//      DoorDirector / World3D portals / EntryDirector / questMarkerManifest /
//      District room openings / collision integration never re-derive the math.
//
// This module is framework-free (no React / three imports) and pure, so it is
// unit-testable and safe to import from any director or pipeline step.
//
// COORDINATE MODEL (matches manifest + District exactly):
//   A building renders as <group position=pos rotation=[0,rotY,0]> with a
//   FittedGlb(size=slot) child that min-axis-fits the GLB, recentres XZ and
//   grounds y. Its street-facing model axis is +z (frontAxis "+z" in the
//   collision sidecars). So, with effective yaw B = rotY + assetYaw:
//     outward normal  n = [ sin B, 0, cos B ]   (rotateY(+z, B))
//     facade tangent  t = [ cos B, 0, -sin B ]  (rotateY(+x, B))
//   The fitted footprint is centred on `pos` (FittedGlb recentres XZ), so the
//   facade plane is `actualHalfDepth = fittedDepth/2` along n from pos.
// ---------------------------------------------------------------------------

import {
  ALL_INTERIOR_LOCATIONS,
  BUILDINGS,
  EXPLORE_LOCATIONS,
  INTERIOR_BUILDING_ID,
  exploreLocationId,
  type BuildingDef,
  type LocationDef,
  type RoomDef,
} from "./manifest.js";

export type Vec3 = [number, number, number];

// ---- measured raw GLB bounds ------------------------------------------------
// GENERATED SOURCE OF TRUTH: assets/build/collision/collision-manifest.generated.ts
// (COLLISION_METADATA[key].rawSize). Snapshotted here because the runtime
// tsconfig only includes apps/web/src, so the generated file under assets/ is
// not importable. Regenerate with:
//   node assets/pipeline/build_collision_manifest.mjs
// then copy the rawSize for any changed building GLB below. These are geometry
// facts (native GLB local bounds, y-up), never hand-tuned.
export const BUILDING_GLB_RAW_SIZE: Record<string, Vec3> = {
  "bldg-brick": [1.283, 1.904, 1.107],
  "bldg-clapboard": [1.668, 1.903, 1.647],
  "bldg-counting": [1.876, 1.601, 1.904],
  "bldg-customhouse": [1.901, 1.457, 1.375],
  "bldg-printshop": [1.632, 1.754, 1.901],
  "bldg-row-brick-a": [1.364, 1.899, 1.21],
  "bldg-row-brick-b": [1.269, 1.9, 1.272],
  "bldg-row-clapboard-a": [1.022, 1.899, 1.193],
  "bldg-row-clapboard-b": [1.303, 1.9, 1.145],
  "bldg-row-clapboard-c": [1.29, 1.9, 1.596],
  "bldg-row-shop": [1.1, 1.899, 1.276],
  "bldg-scaffold": [1.898, 1.344, 1.896],
  "bldg-tavern": [1.899, 1.707, 1.244],
  "bldg-townhouse-civic": [1.513, 1.898, 1.312],
  "bldg-warehouse-street": [0.99, 0.908, 1.898],
  "bldg-warehouse-wharf-a": [1.367, 1.732, 1.898],
  "bldg-warehouse-wharf-b": [1.07, 1.9, 1.079],
  "church-meetinghouse": [0.679, 1.899, 1.089],
};

// ---- imported door-kit geometry contract ------------------------------------
// The production asset (see assets/pipeline/*door_kit* + collision sidecar
// colonial-door-kit.collision.json). Named nodes: Door_Frame (stationary jamb
// + lintel), Door_Recess (stationary dark vestibule that occludes the baked
// static door), Door_Leaf (hinged at its bottom edge, pivot on the hinge stile)
// and optional Door_Latch. Clips: `openInward`, `openOutward` (~1.0-1.4s);
// closing reverses the matching clip.
export const DOOR_KIT_GLB_KEY = "colonial-door-kit";
export const DOOR_LEAF_NODE = "Door_Leaf";
export const DOOR_FRAME_NODE = "Door_Frame";
export const DOOR_RECESS_NODE = "Door_Recess";
export const DOOR_LATCH_NODE = "Door_Latch";
export const DOOR_CLIP_OPEN_INWARD = "openInward";
export const DOOR_CLIP_OPEN_OUTWARD = "openOutward";

// Nominal leaf/opening from the brief. Clear leaf ~1.12 x 2.0m, 0.08-0.12m
// thick, frame suitable for a ~1.2 x 2.05m opening.
export const DOOR_LEAF_CLEAR_WIDTH = 1.12;
export const DOOR_LEAF_CLEAR_HEIGHT = 2.0;
export const DOOR_LEAF_THICKNESS = 0.1;
export const DOOR_OPENING_WIDTH = 1.2;
export const DOOR_OPENING_HEIGHT = 2.05;

// Peak swing of the leaf (radians). ~78 degrees: enough to walk through, short
// of clipping the reveal walls of a modest jamb.
export const DOOR_OPEN_ANGLE = 1.36;

// Sensor lane offsets along the outward normal (metres). Exterior arm sensor
// sits just outside the facade; inside landing just past the threshold; outside
// exit is where an interior->street crossing lands the player.
export const SENSOR_EXTERIOR_M = 0.72;
export const SENSOR_INSIDE_LANDING_M = 0.72;
export const SENSOR_OUTSIDE_EXIT_M = 1.3;

// ---- small vector helpers (pure) -------------------------------------------
export function rotateY([x, y, z]: Vec3, yaw: number): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [x * c + z * s, y, -x * s + z * c];
}
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function scale(a: Vec3, k: number): Vec3 {
  return [a[0] * k, a[1] * k, a[2] * k];
}
export function addScaled(a: Vec3, b: Vec3, k: number): Vec3 {
  return [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
}

// ---- fit math (mirrors Character.tsx > FittedGlbInner) ----------------------
export function fitScale(rawSize: Vec3, target: Vec3): number {
  return Math.min(
    target[0] / (rawSize[0] || 1),
    target[1] / (rawSize[1] || 1),
    target[2] / (rawSize[2] || 1),
  );
}
export function fittedSize(rawSize: Vec3, target: Vec3): Vec3 {
  const s = fitScale(rawSize, target);
  return [rawSize[0] * s, rawSize[1] * s, rawSize[2] * s];
}

// The visual facade of a building placement, resolved from its ACTUAL fitted
// bounds (not the nominal slot). This is the fix for root cause #1.
export interface BuildingFacade {
  buildingId: string;
  glbKey: string;
  effectiveYaw: number;
  outwardNormal: Vec3; // n
  tangent: Vec3; // t
  fitScale: number;
  fittedSize: Vec3;
  actualHalfWidth: number; // fitted extent along tangent / 2
  actualHalfDepth: number; // fitted extent along outward normal / 2
  center: Vec3; // world XZ centre of the fitted footprint (== pos), ground y
}

export function buildingFacade(b: BuildingDef, assetYaw = 0): BuildingFacade | null {
  const raw = b.glb ? BUILDING_GLB_RAW_SIZE[b.glb] : undefined;
  if (!raw) return null;
  const s = fitScale(raw, b.size);
  const fitted: Vec3 = [raw[0] * s, raw[1] * s, raw[2] * s];
  const effectiveYaw = b.rotY + assetYaw;
  return {
    buildingId: b.id,
    glbKey: b.glb!,
    effectiveYaw,
    outwardNormal: rotateY([0, 0, 1], effectiveYaw),
    tangent: rotateY([1, 0, 0], effectiveYaw),
    fitScale: s,
    fittedSize: fitted,
    actualHalfWidth: fitted[0] / 2,
    actualHalfDepth: fitted[2] / 2,
    center: [b.pos[0], b.pos[1], b.pos[2]],
  };
}

// ---- doorway profile (authored intent per unique doorway) -------------------
export type TrimPolicy =
  // The building GLB has usable modeled trim framing the opening; the kit
  // supplies only the leaf + recess (no imported frame drawn).
  | "authored-trim"
  // No usable modeled trim: draw the imported Door_Frame + Door_Recess + leaf.
  | "imported-frame"
  // Decorative, permanently sealed leaf with no portal semantics.
  | "sealed-decorative";

export interface DoorwayProfile {
  doorId: string; // stable id keyed to collision sidecar + runtime target(s)
  buildingId: string;
  // Runtime target ids that swing this door (empty => decorative/no portal).
  targetIds: string[];
  // Optional yaw of the modeled facade relative to the building's rotY (0 for
  // all audited buildings; kept for GLBs whose front axis is offset).
  assetYaw?: number;
  // Lateral door centre along the facade tangent, in metres from the fitted
  // footprint centre. AUDIT NOTE: authored doors vary left/centre/right; each
  // unique GLB must be visually audited from a QA render and this value set.
  // Until that audit lands it defaults to 0 (centre) and is flagged
  // `lateralCenterAudited: false`.
  lateralCenter?: number;
  lateralCenterAudited?: boolean;
  // Hinge side along the tangent: +1 hinge on the +t stile, -1 on the -t stile.
  hingeSign: 1 | -1;
  // Recess: how far the leaf sits BEHIND the facade plane (metres), so the
  // stationary frame/recess buries into the wall and no black reveal leaks.
  recess?: number;
  // Sill lift (metres) for doorways seated on a stoop/stair platform.
  sill?: number;
  clearWidth?: number;
  clearHeight?: number;
  trim: TrimPolicy;
  // Explicit approach distance override (hero recesses / stairs).
  approachDistance?: number;
  // For hero doors whose modeled door is unusable/offset: pin the facade point
  // directly (world XZ + y) instead of deriving it from fitted bounds.
  facadeOverride?: Vec3;
  note?: string;
}

// A fully resolved doorway: everything a consumer needs, computed once.
export interface ResolvedDoorway {
  doorId: string;
  buildingId: string;
  targetIds: string[];
  glbKey: string; // door kit
  effectiveYaw: number;
  outwardNormal: Vec3; // n
  tangent: Vec3; // t
  facadePoint: Vec3; // F: opening centre on the facade plane
  leafCenter: Vec3; // C: centre of the closed leaf slab
  hinge: Vec3; // H: world hinge edge
  hingeSign: 1 | -1;
  clearWidth: number;
  clearHeight: number;
  thickness: number;
  recess: number;
  sill: number;
  // Signed rotation applied to the hinge group (about world Y) to reach a fully
  // open leaf. Exterior doors swing inward; interior representations outward.
  // inwardSign = -hingeSign, outwardSign = +hingeSign (see tests).
  inwardOpenAngle: number;
  outwardOpenAngle: number;
  trim: TrimPolicy;
  // Sensor / portal lanes on the door tangent lane (no lateral pop).
  sensors: {
    exterior: Vec3; // arm sensor just outside the facade
    insideLanding: Vec3; // landing just inside after entering
    outsideExit: Vec3; // where an interior->street crossing lands
  };
  approachDistance: number;
  // Quest-marker visual anchor: beside the jamb, a touch toward the approach.
  visualMarkerAnchor: Vec3;
  fittedSize: Vec3 | null;
  lateralCenterAudited: boolean;
}

function resolveFacadePoint(
  profile: DoorwayProfile,
  facade: BuildingFacade | null,
): { F: Vec3; n: Vec3; t: Vec3; yaw: number; fitted: Vec3 | null; halfWidth: number } {
  const lateral = profile.lateralCenter ?? 0;
  const sill = profile.sill ?? 0;
  const recess = profile.recess ?? 0.06;
  if (profile.facadeOverride) {
    // Hero override: derive n/t from the building yaw but pin the plane point.
    const b = BUILDINGS.find((bd) => bd.id === profile.buildingId);
    const yaw = (b?.rotY ?? 0) + (profile.assetYaw ?? 0);
    const n = rotateY([0, 0, 1], yaw);
    const t = rotateY([1, 0, 0], yaw);
    let F = addScaled(profile.facadeOverride, t, lateral);
    F = addScaled(F, n, -recess);
    F = [F[0], profile.facadeOverride[1] + sill, F[2]];
    return { F, n, t, yaw, fitted: null, halfWidth: 0 };
  }
  if (!facade) {
    // No measured bounds: cannot seat safely. Consumers must skip (render null).
    return { F: [0, 0, 0], n: [0, 0, 1], t: [1, 0, 0], yaw: 0, fitted: null, halfWidth: 0 };
  }
  const n = facade.outwardNormal;
  const t = facade.tangent;
  // Facade plane point at the audited lateral centre, pulled in by the recess.
  let F = addScaled(facade.center, t, lateral);
  F = addScaled(F, n, facade.actualHalfDepth - recess);
  F = [F[0], facade.center[1] + sill, F[2]];
  return { F, n, t, yaw: facade.effectiveYaw, fitted: facade.fittedSize, halfWidth: facade.actualHalfWidth };
}

export function resolveDoorway(profile: DoorwayProfile): ResolvedDoorway | null {
  const b = BUILDINGS.find((bd) => bd.id === profile.buildingId);
  const facade = b ? buildingFacade(b, profile.assetYaw ?? 0) : null;
  // A measured facade (or explicit override) is required to seat the door; a
  // building with no measured bounds and no override yields null so the
  // consumer renders NOTHING (imported-visible-world rule: no primitive seat).
  if (!facade && !profile.facadeOverride) return null;

  const { F, n, t, yaw, fitted, halfWidth } = resolveFacadePoint(profile, facade);
  const clearWidth = profile.clearWidth ?? DOOR_LEAF_CLEAR_WIDTH;
  const clearHeight = profile.clearHeight ?? DOOR_LEAF_CLEAR_HEIGHT;
  const thickness = DOOR_LEAF_THICKNESS;
  const recess = profile.recess ?? 0.06;
  const sill = profile.sill ?? 0;
  const hingeSign = profile.hingeSign;

  // Leaf centre sits a hair behind the facade plane (thickness + 1cm skin).
  const leafCenter = addScaled(F, n, -(thickness / 2 + 0.01));
  // Hinge edge is width/2 along the tangent on the hinge stile.
  const hinge = addScaled(leafCenter, t, hingeSign * (clearWidth / 2));

  const approachDistance = profile.approachDistance ?? SENSOR_EXTERIOR_M;
  const groundF: Vec3 = [F[0], b?.pos[1] ?? 0, F[2]];

  return {
    doorId: profile.doorId,
    buildingId: profile.buildingId,
    targetIds: profile.targetIds,
    glbKey: DOOR_KIT_GLB_KEY,
    effectiveYaw: yaw,
    outwardNormal: n,
    tangent: t,
    facadePoint: F,
    leafCenter,
    hinge,
    hingeSign,
    clearWidth,
    clearHeight,
    thickness,
    recess,
    sill,
    // Exterior leaf opens INWARD (toward -n): inwardSign = -hingeSign.
    inwardOpenAngle: -hingeSign * DOOR_OPEN_ANGLE,
    // Interior representation opens OUTWARD (toward -n out of the room, i.e.
    // toward the street) about the SAME hinge edge: outwardSign = +hingeSign.
    outwardOpenAngle: hingeSign * DOOR_OPEN_ANGLE,
    trim: profile.trim,
    sensors: {
      exterior: addScaled(groundF, n, approachDistance),
      insideLanding: addScaled(groundF, n, -SENSOR_INSIDE_LANDING_M),
      outsideExit: addScaled(groundF, n, SENSOR_OUTSIDE_EXIT_M),
    },
    approachDistance,
    // Marker sits beside the latch jamb (opposite the hinge), a touch outward.
    visualMarkerAnchor: addScaled(
      addScaled(groundF, t, -hingeSign * (clearWidth / 2 + 0.32)),
      n,
      0.28,
    ),
    fittedSize: fitted,
    lateralCenterAudited: profile.lateralCenterAudited ?? false,
  };
}

// ---- interior doorway (room-opening lane) -----------------------------------
// The interior representation of the same semantic door: same tangent lane and
// hinge world edge, but seated on the ROOM'S door wall and opening outward for
// exit. Interior room defs gain an explicit doorX/threshold lane; the wall is
// built/opened around this lane, not the room centre. Kept additive so the
// later independent-interiors rebuild can migrate it.
export interface InteriorDoorway {
  locationId: string;
  doorZ: number; // world z of the room's door wall
  doorX: number; // world x of the opening centre (audited lateral lane)
  outwardNormal: Vec3; // toward the street
  tangent: Vec3;
  facadePoint: Vec3;
  leafCenter: Vec3;
  hinge: Vec3;
  hingeSign: 1 | -1;
  outwardOpenAngle: number;
  clearWidth: number;
  clearHeight: number;
  thresholdLaneHalfWidth: number; // half-width of the wall gap to leave open
}

export function resolveInteriorDoorway(
  locationId: string,
  room: RoomDef,
  opts: { hingeSign?: 1 | -1; doorX?: number; clearWidth?: number; clearHeight?: number } = {},
): InteriorDoorway {
  const south = room.doorSide === "S";
  const doorZ = south ? room.center[1] - room.size[1] / 2 : room.center[1] + room.size[1] / 2;
  // Outward = toward the street: south wall faces -z, north wall faces +z.
  const yaw = south ? Math.PI : 0;
  const n = rotateY([0, 0, 1], yaw);
  const t = rotateY([1, 0, 0], yaw);
  const hingeSign = opts.hingeSign ?? -1;
  const clearWidth = opts.clearWidth ?? DOOR_LEAF_CLEAR_WIDTH;
  const clearHeight = opts.clearHeight ?? DOOR_LEAF_CLEAR_HEIGHT;
  const doorX = opts.doorX ?? room.center[0];
  const facadePoint: Vec3 = [doorX, 0, doorZ];
  const leafCenter = addScaled(facadePoint, n, -(DOOR_LEAF_THICKNESS / 2 + 0.01));
  const hinge = addScaled(leafCenter, t, hingeSign * (clearWidth / 2));
  return {
    locationId,
    doorZ,
    doorX,
    outwardNormal: n,
    tangent: t,
    facadePoint,
    leafCenter,
    hinge,
    hingeSign,
    outwardOpenAngle: hingeSign * DOOR_OPEN_ANGLE,
    clearWidth,
    clearHeight,
    thresholdLaneHalfWidth: clearWidth / 2 + 0.2,
  };
}

// ---- authored doorway profile registry --------------------------------------
// Runtime hero buildings whose modeled/baked door is offset or unusable: pin
// the facade and case the imported frame. (Facade planes match the audited
// values previously hand-tuned in DoorDirector, re-expressed through the
// contract so there is one owner of the math.)
const RUNTIME_DOOR_BUILDINGS = new Set(["mercer", "thomas", "pike", "customs"]);
const AUDITED_EXPLORE_LATERAL: Partial<Record<string, number>> = {
  rowN1: 0,
  warehouseN2: 1.05,
  church: 0,
  rowS3: 0.7,
};
const AUDITED_EXPLORE_TRIM: Partial<Record<string, TrimPolicy>> = {
  warehouseN2: "authored-trim",
  church: "authored-trim",
  rowS3: "authored-trim",
};

export const HERO_DOORWAY_PROFILES: DoorwayProfile[] = [
  {
    doorId: "MERCER",
    buildingId: "mercer",
    targetIds: ["MERCER_PRESS", "MERCER_REPRINT", "MERCER_RETURN"],
    hingeSign: -1,
    trim: "imported-frame",
    facadeOverride: [-0.31, 0, 11.27],
    recess: 0.06,
    clearWidth: 0.82,
    clearHeight: 1.66,
    lateralCenter: 0,
    lateralCenterAudited: true,
    note: "Printshop porch enclosure face; modeled glazed door is offset ~2.2m and unusable, so the kit frame is cased onto the porch face.",
  },
  {
    doorId: "THOMAS",
    buildingId: "thomas",
    targetIds: ["THOMAS_CIRCULAR"],
    hingeSign: -1,
    trim: "authored-trim",
    facadeOverride: [-72, 0, -10.88],
    recess: 0.02,
    clearWidth: 0.78,
    clearHeight: 1.9,
    lateralCenter: 0,
    lateralCenterAudited: true,
    approachDistance: 0.85,
    note: "Counting-house authored side-door opening. The explicit interior doorX follows this lane, avoiding the modeled double carriage doors without shifting the building.",
  },
  {
    doorId: "PIKE",
    buildingId: "pike",
    targetIds: ["PIKE_PROOF", "PIKE_RETURN"],
    hingeSign: -1,
    trim: "authored-trim",
    facadeOverride: [30.08, 0.58, 14.26],
    recess: 0.02,
    sill: 0,
    clearWidth: 1.02,
    clearHeight: 1.9,
    lateralCenter: 0,
    lateralCenterAudited: true,
    approachDistance: 0.9,
    note: "Seated inside the modeled recessed doorway; building pilaster/pediment frames it, so no imported frame drawn.",
  },
  {
    doorId: "CUSTOMS",
    buildingId: "customs",
    targetIds: ["CUSTOMHOUSE_NOTICE"],
    hingeSign: -1,
    trim: "authored-trim",
    facadeOverride: [55, 1.16, 13.26],
    recess: 0.02,
    clearWidth: 1.12,
    clearHeight: 1.98,
    lateralCenter: 0,
    lateralCenterAudited: true,
    approachDistance: 1.0,
    note: "Seated inside the modeled arched doorway behind the portico; modeled white arch frames it.",
  },
];

// Rear decorative doorways (Bible route corridors). No portal semantics: the
// leaf stays visibly sealed (trim sealed-decorative) so it never reads as an
// impossible open door.
export const REAR_DOORWAY_PROFILES: DoorwayProfile[] = [
  { doorId: "REAR_MERCER", buildingId: "mercer", targetIds: [], hingeSign: -1, trim: "sealed-decorative", facadeOverride: [1.6, 0, 18.86], assetYaw: Math.PI, note: "Alley-side decorative door; sealed." },
  { doorId: "REAR_TAVERN", buildingId: "tavern", targetIds: [], hingeSign: -1, trim: "sealed-decorative", facadeOverride: [-19.5, 0, -19.36], note: "Alley-side decorative door; sealed. Known ~1.08m depth mismatch vs the fitted rear wall — sealed leaf avoids a leaking reveal." },
  { doorId: "REAR_THOMAS", buildingId: "thomas", targetIds: [], hingeSign: -1, trim: "sealed-decorative", facadeOverride: [-68.4, 0, -19.36], note: "Alley-side decorative door; sealed." },
];

// Common EXPLORE exterior doorways: one per non-runtime building, seated on the
// ACTUAL fitted street facade (root cause #1 fix) at the room's door lane.
export function buildExploreDoorwayProfiles(): DoorwayProfile[] {
  const out: DoorwayProfile[] = [];
  for (const b of BUILDINGS) {
    if (RUNTIME_DOOR_BUILDINGS.has(b.id)) continue;
    const loc = EXPLORE_LOCATIONS[exploreLocationId(b.id)];
    if (!loc?.room) continue;
    // Lateral door lane = room door centre relative to the building footprint
    // centre, projected onto the facade tangent. For the audited rooms this is
    // ~0 (centre); a per-GLB visual audit can override per building later.
    const auditedLateral = AUDITED_EXPLORE_LATERAL[b.id];
    const lateral = auditedLateral ?? (loc.room.center[0] - b.pos[0]);
    out.push({
      doorId: `EXPLORE_${b.id}`,
      buildingId: b.id,
      targetIds: [exploreLocationId(b.id)],
      hingeSign: -1,
      trim: AUDITED_EXPLORE_TRIM[b.id] ?? "imported-frame",
      recess: 0.06,
      lateralCenter: lateral,
      lateralCenterAudited: auditedLateral !== undefined,
      note: auditedLateral !== undefined
        ? "Common explore door seated on its browser-audited authored opening."
        : "Common explore door seated on the fitted facade; lateral centre pending per-GLB QA audit.",
    });
  }
  return out;
}

export const ALL_EXTERIOR_DOORWAY_PROFILES: DoorwayProfile[] = [
  ...HERO_DOORWAY_PROFILES,
  ...buildExploreDoorwayProfiles(),
  ...REAR_DOORWAY_PROFILES,
];

export function resolveAllExteriorDoorways(): ResolvedDoorway[] {
  const out: ResolvedDoorway[] = [];
  for (const profile of ALL_EXTERIOR_DOORWAY_PROFILES) {
    const resolved = resolveDoorway(profile);
    if (resolved) out.push(resolved);
  }
  return out;
}

const RESOLVED_EXTERIOR_DOORS = resolveAllExteriorDoorways();

export function doorwayForTarget(targetId: string): ResolvedDoorway | null {
  return RESOLVED_EXTERIOR_DOORS.find((door) => door.targetIds.includes(targetId)) ?? null;
}

export function doorwayForBuilding(buildingId: string): ResolvedDoorway | null {
  return RESOLVED_EXTERIOR_DOORS.find(
    (door) => door.buildingId === buildingId && door.targetIds.length > 0,
  ) ?? null;
}

export function interiorDoorwayForLocation(locationId: string): InteriorDoorway | null {
  const loc = ALL_INTERIOR_LOCATIONS[locationId];
  if (!loc?.room) return null;
  const buildingId = INTERIOR_BUILDING_ID[locationId];
  const exterior = buildingId ? doorwayForBuilding(buildingId) : null;
  return resolveInteriorDoorway(locationId, loc.room, {
    hingeSign: exterior?.hingeSign ?? -1,
    doorX: exterior?.facadePoint[0] ?? loc.room.doorX ?? loc.room.center[0],
    clearWidth: exterior?.clearWidth,
    clearHeight: exterior?.clearHeight,
  });
}

export function thresholdAnchorForLocation(
  loc: LocationDef,
  side: "INSIDE" | "OUTSIDE",
): Vec3 {
  if (!loc.room) return loc.anchor;
  const interior = interiorDoorwayForLocation(loc.id) ??
    resolveInteriorDoorway(loc.id, loc.room, { doorX: loc.room.doorX });
  if (side === "INSIDE") {
    return addScaled(interior.facadePoint, interior.outwardNormal, -SENSOR_INSIDE_LANDING_M);
  }
  const buildingId = INTERIOR_BUILDING_ID[loc.id];
  const exterior = buildingId ? doorwayForBuilding(buildingId) : null;
  return exterior?.sensors.outsideExit ??
    addScaled(interior.facadePoint, interior.outwardNormal, SENSOR_OUTSIDE_EXIT_M);
}

export function interiorDoorVisualAnchor(locationId: string): Vec3 | null {
  const interior = interiorDoorwayForLocation(locationId);
  if (!interior) return null;
  return addScaled(
    addScaled(
      interior.facadePoint,
      interior.tangent,
      -interior.hingeSign * (interior.clearWidth / 2 + 0.32),
    ),
    interior.outwardNormal,
    -0.12,
  );
}

// Axis-aligned semantic collision adapter for the current Player collision
// world. All building placements are yaw 0/PI, so splitting the measured fitted
// footprint along the doorway tangent is exact. The corridor remains open only
// while the semantic leaf is open; otherwise a finite closed-leaf rectangle
// blocks it. This replaces nominal full-slot boxes without touching density,
// roads, traversal or non-building collision.
export function doorAwareBuildingColliders(
  openTargetId: string | null,
): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  for (const building of BUILDINGS) {
    const facade = buildingFacade(building);
    if (!facade) continue;
    const door = doorwayForBuilding(building.id);
    if (!door) {
      out.push([
        building.pos[0],
        building.pos[2],
        facade.fittedSize[0] / 2,
        facade.fittedSize[2] / 2,
      ]);
      continue;
    }
    const minX = building.pos[0] - facade.fittedSize[0] / 2;
    const maxX = building.pos[0] + facade.fittedSize[0] / 2;
    const laneHalf = door.clearWidth / 2 + 0.38;
    const laneMin = Math.max(minX, door.facadePoint[0] - laneHalf);
    const laneMax = Math.min(maxX, door.facadePoint[0] + laneHalf);
    if (laneMin > minX + 0.05) {
      out.push([
        (minX + laneMin) / 2,
        building.pos[2],
        (laneMin - minX) / 2,
        facade.fittedSize[2] / 2,
      ]);
    }
    if (laneMax < maxX - 0.05) {
      out.push([
        (laneMax + maxX) / 2,
        building.pos[2],
        (maxX - laneMax) / 2,
        facade.fittedSize[2] / 2,
      ]);
    }
    const jambOffset = door.clearWidth / 2 + 0.05;
    out.push([
      door.facadePoint[0] - jambOffset,
      door.facadePoint[2],
      0.05,
      0.1,
    ]);
    out.push([
      door.facadePoint[0] + jambOffset,
      door.facadePoint[2],
      0.05,
      0.1,
    ]);
    const open = openTargetId !== null && door.targetIds.includes(openTargetId);
    if (!open) {
      out.push([
        door.leafCenter[0],
        door.leafCenter[2],
        door.clearWidth / 2,
        door.thickness / 2,
      ]);
    }
  }
  return out;
}

// ---- collision integration (world-space, keyed by stable door id) -----------
// Exports the frame/leaf/trigger shapes the runtime collision system consumes.
// Frame + recess are static solids; the closed leaf is a dynamic OBB the runtime
// rotates about the hinge (open leaf follows the actual hinge); passage clears
// only when the aperture exceeds the player capsule + margin. The trigger
// corridor is where building broad-phase collision must be split so the sensor
// stays reachable (never a global removal of building collision).
export interface Obb {
  id: string;
  center: Vec3;
  half: Vec3;
  yaw: number;
  tags: string[];
}
export interface DoorCollisionShapes {
  doorId: string;
  buildingId: string;
  yaw: number;
  // Static frame solids (only drawn/collided for imported-frame doors; authored
  // -trim doors rely on the building's own modeled trim + broad phase).
  frame: Obb[];
  // Closed-leaf dynamic OBB. `openAngle` is the signed rotation about world Y
  // applied at the hinge to reach fully open (exterior => inward).
  closedLeaf: Obb;
  hinge: Vec3;
  openAngle: number;
  // Corridor through the building broad-phase box to keep the doorway passable
  // and the sensor reachable (centre on the tangent lane, depth along n).
  passageCorridor: { center: Vec3; half: Vec3; yaw: number };
}

export function doorCollisionShapes(d: ResolvedDoorway): DoorCollisionShapes {
  const t = d.tangent;
  const n = d.outwardNormal;
  const jamb = 0.08;
  const halfOpen = d.clearWidth / 2 + jamb / 2;
  const mkObb = (id: string, base: Vec3, half: Vec3, tags: string[]): Obb => ({
    id,
    center: base,
    half,
    yaw: d.effectiveYaw,
    tags,
  });
  const jambL = addScaled(d.facadePoint, t, d.clearWidth / 2 + jamb / 2);
  const jambR = addScaled(d.facadePoint, t, -(d.clearWidth / 2 + jamb / 2));
  const frame: Obb[] =
    d.trim === "imported-frame"
      ? [
          mkObb("jamb-l", [jambL[0], d.clearHeight / 2, jambL[2]], [jamb / 2, d.clearHeight / 2, Math.max(0.06, d.thickness)], ["door-frame", "static"]),
          mkObb("jamb-r", [jambR[0], d.clearHeight / 2, jambR[2]], [jamb / 2, d.clearHeight / 2, Math.max(0.06, d.thickness)], ["door-frame", "static"]),
        ]
      : [];
  return {
    doorId: d.doorId,
    buildingId: d.buildingId,
    yaw: d.effectiveYaw,
    frame,
    closedLeaf: mkObb(
      "leaf",
      [d.leafCenter[0], d.clearHeight / 2, d.leafCenter[2]],
      [d.clearWidth / 2, d.clearHeight / 2, d.thickness / 2],
      ["door-leaf", "dynamic"],
    ),
    hinge: d.hinge,
    openAngle: d.inwardOpenAngle,
    passageCorridor: {
      center: addScaled([d.facadePoint[0], d.clearHeight / 2, d.facadePoint[2]], n, -0.4),
      half: [halfOpen, d.clearHeight / 2, 0.6],
      yaw: d.effectiveYaw,
    },
  };
}

// Buildings whose baked opening could not be production-covered by the imported
// stationary frame/recess and are therefore documented + adjusted (sealed or
// pinned). Consumed by the QA report; empty when every doorway seats cleanly.
export function doorwayCoverageReport(): {
  doorId: string;
  buildingId: string;
  issue: string;
}[] {
  const issues: { doorId: string; buildingId: string; issue: string }[] = [];
  for (const profile of ALL_EXTERIOR_DOORWAY_PROFILES) {
    if (profile.trim === "sealed-decorative" && profile.note?.includes("mismatch")) {
      issues.push({ doorId: profile.doorId, buildingId: profile.buildingId, issue: profile.note });
    }
    const resolved = resolveDoorway(profile);
    if (!resolved) {
      issues.push({
        doorId: profile.doorId,
        buildingId: profile.buildingId,
        issue: "no measured bounds and no facadeOverride: cannot seat; renders nothing (no primitive fallback).",
      });
    }
  }
  return issues;
}
