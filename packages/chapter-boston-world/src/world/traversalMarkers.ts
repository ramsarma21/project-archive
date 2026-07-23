// Traversal & parkour layer (World-Design-Bible §5): authored marker table,
// walkable roof zones, and the placeholder dressing rigs that make each verb
// read tonight. Consumed by TraversalDirector (mechanics + visuals) and by
// World3D (blocker colliders). Player.tsx consumes only TraversalPlayerState.
//
// PLACEMENT: derives from the layout-v3 manifest exports (BUILDINGS / PROPS
// ids) wherever a stable anchor exists, so spots track the layout worker's
// coordinates; anything locally authored carries an ADJUST comment.
//
// ANIMATION SWAP (Bible §5 wishlist): every placeholder is a clip name plus a
// path style. Real clips arriving tomorrow replace placeholders by editing the
// single `clip` field on the marker (all rig clips are in-place; the authored
// path displacement stays either way).

import { BUILDINGS, PROPS } from "./manifest.js";

export type TraversalKind =
  | "CLIMB"
  | "VAULT"
  | "DUCK_ZONE"
  | "SQUEEZE"
  | "JUMP"
  | "LADDER"
  | "INTERACT_FLAVOR";

export interface TraversalPose {
  pos: [number, number, number];
  faceY?: number; // authored facing at this pose; default = travel direction
}

// path styles: LINEAR follows the poses exactly (climbs, ladders); ARC lofts
// y across the hop (vault, jump); SWAY adds the balance-walk lateral wobble;
// NONE stays in place (flavor interactions).
export interface TraversalAnim {
  clip: string;
  reverseClip?: string;
  loopOnce?: boolean;
  path: "LINEAR" | "ARC" | "SWAY" | "NONE";
  arcHeight?: number;
}

export interface TraversalZone {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  // Squeeze comfort rail: while inside the zone the director eases the body
  // toward this line so the tight thread never wedges on the flanking crates.
  rail?: { axis: "x" | "z"; at: number };
}

export interface RoofZone extends TraversalZone {
  id: string;
  y: number;
}

export interface TraversalMarker {
  id: string;
  kind: TraversalKind;
  label: string;
  reverseLabel?: string;
  position: [number, number, number]; // interact point (start of path)
  facing?: number; // required rough approach facing; default from path
  path: TraversalPose[];
  anim: TraversalAnim;
  durationMs: number;
  bidirectional?: boolean;
  zone?: TraversalZone; // DUCK_ZONE / SQUEEZE membership (no button)
  // 'pa:flavor' CustomEvent detail.id fired at path progress; fxPos hosts the
  // local pulse effect (splash/clang) when set.
  flavor?: { event: string; fireAt: number; fxPos?: [number, number, number] };
  seat?: { pose: TraversalPose; stand: TraversalPose };
}

// What the traversal layer tells the player rig each frame. Consumed by
// Player.tsx additively next to the mechanic clip override.
export interface TraversalPlayerState {
  clip: string | null;
  loopOnce: boolean;
  inputLocked: boolean;
  crouch: boolean;
}

// Placeholder dressing rendered by TraversalDirector so each verb reads in
// the world tonight; the asset/layout passes replace these with real GLBs.
export type TraversalDressing =
  | { type: "LAUNDRY"; pos: [number, number, number]; spanZ: number }
  | { type: "CRATE_ROW"; pos: [number, number, number]; spanZ: number }
  | { type: "BOX"; pos: [number, number, number]; size: [number, number, number]; rotY?: number; tone?: string }
  | { type: "CART"; pos: [number, number, number]; rotY: number }
  | { type: "SHED"; pos: [number, number, number]; size: [number, number, number] }
  | { type: "SCAFFOLD"; pos: [number, number, number]; platformY: number }
  | { type: "PLATFORM"; pos: [number, number, number]; size: [number, number] } // planks at pos[1]
  | { type: "LADDER"; pos: [number, number, number]; topY: number; rotY: number }
  | { type: "BEAM"; from: [number, number, number]; to: [number, number, number] }
  | { type: "BELL_POST"; pos: [number, number, number]; rotY: number }
  | { type: "PUDDLE"; pos: [number, number, number]; radius: number }
  | { type: "BENCH"; pos: [number, number, number]; rotY: number };

export interface TraversalSet {
  markers: TraversalMarker[];
  roofZones: RoofZone[];
  dressing: TraversalDressing[];
  blockers: [number, number, number, number][]; // [cx, cz, halfX, halfZ]
}

// ---- manifest lookups ------------------------------------------------------

function building(idOrGlb: string) {
  return (
    BUILDINGS.find((b) => b.id === idOrGlb) ??
    BUILDINGS.find((b) => (b.glb ?? "").includes(idOrGlb)) ??
    null
  );
}

function propNear(glb: string, x: number, z: number) {
  let best: (typeof PROPS)[number] | null = null;
  let bestD = Infinity;
  for (const p of PROPS) {
    if (!p.glb.includes(glb)) continue;
    const d = Math.hypot(p.pos[0] - x, p.pos[2] - z);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

// North alley corridor: from the shallowest row-house back line to the alley
// back wall (BARRIERS in the manifest put it at z=-26).
const NORTH_ALLEY_WALL_Z = -26;

function northAlley(): { back: number; center: number; halfSpan: number } {
  let back = -Infinity;
  for (const b of BUILDINGS) {
    if (b.pos[2] >= 0 || b.pos[0] < -118) continue; // street rows only
    back = Math.max(back, b.pos[2] - b.size[2] / 2);
  }
  if (!Number.isFinite(back)) back = -19; // ADJUST: no north row in manifest
  return {
    back,
    center: (back + NORTH_ALLEY_WALL_Z) / 2,
    halfSpan: (back - NORTH_ALLEY_WALL_Z) / 2,
  };
}

function yawBetween(a: [number, number, number], b: [number, number, number]): number {
  return Math.atan2(b[0] - a[0], b[2] - a[2]);
}

// ---- the authored table ------------------------------------------------------

function buildTraversalSet(): TraversalSet {
  const markers: TraversalMarker[] = [];
  const roofZones: RoofZone[] = [];
  const dressing: TraversalDressing[] = [];
  const blockers: [number, number, number, number][] = [];

  const alley = northAlley();

  // ---- NORTH ALLEY (the parkour rider route): duck lines + crate vaults -----

  // Laundry duck lines hang across the alley behind two row houses.
  const duckHosts = [
    building("rowD") ?? building("rowN3"),
    building("rowG") ?? building("rowN7"),
  ].filter(Boolean);
  duckHosts.forEach((host, i) => {
    const x = host!.pos[0] + 1.5;
    markers.push({
      id: `NALLEY_DUCK_${i === 0 ? "W" : "E"}`,
      kind: "DUCK_ZONE",
      label: "Duck",
      position: [x, 0, alley.center],
      path: [],
      anim: { clip: "crouchWalk", path: "NONE" },
      durationMs: 0,
      zone: {
        minX: x - 1.2,
        maxX: x + 1.2,
        minZ: alley.center - alley.halfSpan,
        maxZ: alley.center + alley.halfSpan,
      },
    });
    dressing.push({ type: "LAUNDRY", pos: [x, 0, alley.center], spanZ: alley.halfSpan * 2 - 0.6 });
  });

  // Crate rows blocking the full alley corridor: vault over along x.
  // ADJUST: x slots picked clear of the manifest's alley clutter props.
  const vaultXs: [string, number][] = [
    ["W", -43],
    ["E", 9],
  ];
  for (const [tag, x] of vaultXs) {
    markers.push({
      id: `NALLEY_VAULT_${tag}`,
      kind: "VAULT",
      label: "Vault",
      position: [x - 1.5, 0, alley.center],
      path: [
        { pos: [x - 1.5, 0, alley.center] },
        { pos: [x + 1.5, 0, alley.center] },
      ],
      anim: { clip: "vault", loopOnce: true, path: "ARC", arcHeight: 0.8 },
      durationMs: 950,
      bidirectional: true,
    });
    dressing.push({ type: "CRATE_ROW", pos: [x, 0, alley.center], spanZ: alley.halfSpan * 2 - 0.4 });
    blockers.push([x, alley.center, 0.6, alley.halfSpan - 0.2]);
  }

  // ---- SQUEEZE: the east mid-cut (x 16..19) narrowed by stacked cargo -------
  // Bible §5's squeeze rebound to layout v3: the rowD/E gap became this
  // authored mid-cut, so the crate squeeze guards its alley mouth instead.
  {
    const cx = 17.5; // ADJUST with the mid-cut if the layout worker moves it
    const mouthZ = alley.back + 0.2;
    markers.push({
      id: "MIDCUT_E_SQUEEZE",
      kind: "SQUEEZE",
      label: "Squeeze",
      position: [cx, 0, mouthZ],
      path: [],
      anim: { clip: "crouchWalk", path: "NONE" },
      durationMs: 0,
      zone: {
        minX: cx - 0.8,
        maxX: cx + 0.8,
        minZ: mouthZ - 1.6,
        maxZ: mouthZ + 1.6,
        rail: { axis: "x", at: cx },
      },
    });
    dressing.push({ type: "BOX", pos: [cx - 1.05, 0, mouthZ], size: [1.0, 1.7, 1.8], rotY: 0.06, tone: "#5d4630" });
    dressing.push({ type: "BOX", pos: [cx + 1.05, 0, mouthZ], size: [1.0, 1.5, 1.8], rotY: -0.08, tone: "#6a5138" });
    blockers.push([cx - 1.05, mouthZ, 0.5, 0.9], [cx + 1.05, mouthZ, 0.5, 0.9]);
  }

  // ---- Scaffolded facade climb (bldg-scaffold at its placed slot) -----------
  const scaffoldHost = building("scaffold") ?? building("rowB");
  if (scaffoldHost) {
    const sx = scaffoldHost.pos[0];
    const north = scaffoldHost.pos[2] < 0;
    // The repainting scaffold hugs the STREET facade (Bible §5).
    const frontZ = north
      ? scaffoldHost.pos[2] + scaffoldHost.size[2] / 2
      : scaffoldHost.pos[2] - scaffoldHost.size[2] / 2;
    const out = north ? 1 : -1; // toward the street
    const platY = 3.05;
    markers.push({
      id: "SCAFFOLD_FACADE_CLIMB",
      kind: "CLIMB",
      label: "Climb",
      reverseLabel: "Climb down",
      position: [sx, 0, frontZ + out * 1.75],
      path: [
        { pos: [sx, 0, frontZ + out * 1.75] },
        { pos: [sx, 1.6, frontZ + out * 0.85] },
        { pos: [sx, platY, frontZ - out * 0.15], faceY: north ? 0 : Math.PI },
      ],
      anim: { clip: "climbUp", reverseClip: "climbDown", path: "LINEAR" },
      durationMs: 2300,
      bidirectional: true,
    });
    roofZones.push({
      id: "SCAFFOLD_PLATFORM",
      minX: sx - 1.55,
      maxX: sx + 1.55,
      minZ: north ? frontZ - 0.85 : frontZ - 0.55,
      maxZ: north ? frontZ + 0.55 : frontZ + 0.85,
      y: platY,
    });
    dressing.push({ type: "SCAFFOLD", pos: [sx, 0, frontZ - out * 0.15], platformY: platY });
  }

  // ---- WHARF: crane ladder, crate climb to warehouse roof, balance beam -----

  const crane = propNear("crane", -146, 4);
  const craneAt: [number, number] = crane ? [crane.pos[0], crane.pos[2]] : [-146, 4]; // ADJUST
  {
    const [cx, cz] = craneAt;
    const platY = 2.7;
    // Ladder foot stands clear of the crane's collider footprint.
    const lx = cx + 1.9;
    markers.push({
      id: "WHARF_CRANE_LADDER",
      kind: "LADDER",
      label: "Climb ladder",
      reverseLabel: "Climb down",
      position: [lx, 0, cz + 1.9],
      path: [
        { pos: [lx, 0, cz + 1.9] },
        { pos: [lx, platY, cz + 0.55] },
        { pos: [lx - 0.9, platY, cz + 0.1], faceY: -Math.PI / 2 },
      ],
      anim: { clip: "climbUp", reverseClip: "climbDown", path: "LINEAR" },
      durationMs: 2100,
      bidirectional: true,
    });
    roofZones.push({
      id: "WHARF_CRANE_PLATFORM",
      minX: cx - 1.4,
      maxX: cx + 2.4,
      minZ: cz - 1.1,
      maxZ: cz + 1.0,
      y: platY,
    });
    dressing.push({ type: "LADDER", pos: [lx, 0, cz + 1.45], topY: platY, rotY: 0 });
    dressing.push({ type: "PLATFORM", pos: [cx + 0.35, platY, cz - 0.05], size: [3.5, 2.1] });
  }

  // Crate-stack climb to the hero warehouse roof vantage.
  const warehouse = building("warehouseHero") ?? building("warehouse");
  const whAt: [number, number, number] = warehouse
    ? [warehouse.pos[0], warehouse.pos[2], warehouse.size[1]]
    : [-155, -15, 9]; // ADJUST: Bible wharf warehouse slot, north side
  {
    const [wx, wz] = whAt;
    const southZ = wz + (warehouse ? warehouse.size[2] / 2 : 5);
    const roofY = 3.0; // ADJUST to the placed warehouse GLB's eave height
    markers.push({
      id: "WHARF_WAREHOUSE_CLIMB",
      kind: "CLIMB",
      label: "Climb",
      reverseLabel: "Climb down",
      position: [wx + 3.2, 0, southZ + 1.7],
      path: [
        { pos: [wx + 3.2, 0, southZ + 1.7] },
        { pos: [wx + 3.2, 0.72, southZ + 0.85] },
        { pos: [wx + 2.2, 1.55, southZ + 0.35] },
        { pos: [wx + 1.6, roofY, southZ - 0.7], faceY: Math.PI },
      ],
      anim: { clip: "climbUp", reverseClip: "climbDown", path: "LINEAR" },
      durationMs: 2700,
      bidirectional: true,
    });
    roofZones.push({
      id: "WHARF_WAREHOUSE_ROOF",
      minX: wx - 4.5,
      maxX: wx + 4.5,
      minZ: southZ - 4.2,
      maxZ: southZ - 0.4,
      y: roofY,
    });
    dressing.push({ type: "BOX", pos: [wx + 3.2, 0, southZ + 0.85], size: [1.15, 0.72, 1.15], tone: "#6a5138" });
    dressing.push({ type: "BOX", pos: [wx + 2.2, 0, southZ + 0.35], size: [1.1, 1.55, 1.05], rotY: 0.12, tone: "#5d4630" });
    blockers.push([wx + 3.2, southZ + 0.85, 0.57, 0.57], [wx + 2.2, southZ + 0.35, 0.55, 0.52]);
  }

  // Balance-walk beam along the wharf edge, beside the apron water rail.
  {
    // ADJUST: sits just north of the manifest's eastern apron rail segment.
    const from: [number, number, number] = [-134.5, 0, 9.2];
    const to: [number, number, number] = [-128.3, 0, 9.2];
    markers.push({
      id: "WHARF_BALANCE_BEAM",
      kind: "JUMP",
      label: "Balance",
      reverseLabel: "Balance",
      position: from,
      path: [
        { pos: from },
        { pos: [from[0] + 0.6, 0.3, from[2]] },
        { pos: [to[0] - 0.6, 0.3, to[2]] },
        { pos: to },
      ],
      anim: { clip: "walk", path: "SWAY" },
      durationMs: 4600,
      bidirectional: true,
    });
    dressing.push({ type: "BEAM", from: [from[0] + 0.3, 0, from[2]], to: [to[0] - 0.3, 0, to[2]] });
  }

  // ---- ELM POCKET: cart-to-roof observe vantage + roof gap hop --------------

  // Staged on the pocket's northwest side (the walk-in approach), east of the
  // gate palisade line and clear of the pocket's barrel dressing.
  const elm = propNear("liberty-elm", 95, -25);
  const ex = (elm?.pos[0] ?? 95) - 11; // ADJUST with the pocket dressing pass
  const ez = (elm?.pos[2] ?? -25) + 9;
  {
    const shedY = 1.9;
    const shedBY = 1.72;
    const elmAt: [number, number, number] = [elm?.pos[0] ?? 95, 0, elm?.pos[2] ?? -25];
    markers.push({
      id: "ELM_VANTAGE_CLIMB",
      kind: "CLIMB",
      label: "Climb",
      reverseLabel: "Climb down",
      position: [ex + 1.1, 0, ez - 1.1],
      path: [
        { pos: [ex + 1.1, 0, ez - 1.1] },
        { pos: [ex, 0.62, ez] },
        { pos: [ex - 1.1, 1.2, ez + 1.3] },
        { pos: [ex - 2.0, shedY, ez + 2.9], faceY: yawBetween([ex - 2, 0, ez + 2.9], elmAt) },
      ],
      anim: { clip: "climbUp", reverseClip: "climbDown", path: "LINEAR" },
      durationMs: 2700,
      bidirectional: true,
    });
    // Shed A: the observe vantage roof over the pocket.
    roofZones.push({
      id: "ELM_SHED_A",
      minX: ex - 3.3,
      maxX: ex - 0.7,
      minZ: ez + 1.9,
      maxZ: ez + 3.9,
      y: shedY,
    });
    // Shed B across a short gap: the JUMP verb on the vantage line.
    roofZones.push({
      id: "ELM_SHED_B",
      minX: ex + 0.1,
      maxX: ex + 2.3,
      minZ: ez + 2.0,
      maxZ: ez + 3.8,
      y: shedBY,
    });
    markers.push({
      id: "ELM_ROOF_GAP_HOP",
      kind: "JUMP",
      label: "Hop across",
      reverseLabel: "Hop back",
      position: [ex - 0.95, shedY, ez + 2.9],
      path: [
        { pos: [ex - 0.95, shedY, ez + 2.9] },
        { pos: [ex + 0.35, shedBY, ez + 2.9] },
      ],
      anim: { clip: "walk", path: "ARC", arcHeight: 0.5 },
      durationMs: 680,
      bidirectional: true,
    });
    // Climb down off shed B via the rear crate; ground pose stands clear of
    // the crate's collider footprint so the dismount never wedges.
    markers.push({
      id: "ELM_SHED_B_CLIMB",
      kind: "CLIMB",
      label: "Climb",
      reverseLabel: "Climb down",
      position: [ex + 3.3, 0, ez + 1.05],
      path: [
        { pos: [ex + 3.3, 0, ez + 1.05] },
        { pos: [ex + 2.2, 0.8, ez + 2.2] },
        { pos: [ex + 1.5, shedBY, ez + 2.9] },
      ],
      anim: { clip: "climbUp", reverseClip: "climbDown", path: "LINEAR" },
      durationMs: 1900,
      bidirectional: true,
    });
    dressing.push({ type: "BOX", pos: [ex, 0, ez], size: [1.05, 0.62, 1.05], tone: "#6a5138" });
    dressing.push({ type: "CART", pos: [ex - 1.1, 0, ez + 1.3], rotY: 0.7 });
    dressing.push({ type: "SHED", pos: [ex - 2.0, 0, ez + 2.9], size: [2.6, 1.9, 2.0] });
    dressing.push({ type: "SHED", pos: [ex + 1.2, 0, ez + 2.9], size: [2.2, 1.72, 1.8] });
    dressing.push({ type: "BOX", pos: [ex + 2.2, 0, ez + 2.2], size: [0.95, 0.8, 0.95], rotY: 0.3, tone: "#5d4630" });
    blockers.push(
      [ex, ez, 0.52, 0.52],
      [ex - 1.1, ez + 1.3, 0.85, 0.62],
      [ex - 2.0, ez + 2.9, 1.3, 1.0],
      [ex + 1.2, ez + 2.9, 1.1, 0.9],
      [ex + 2.2, ez + 2.2, 0.47, 0.47],
    );
  }

  // ---- STREET: cart/barrel/crate vaults, puddle hops, flavor ----------------

  // Hand-cart vault mid-street (across z).
  const cart = propNear("hand-cart", 11, -4);
  if (cart && Math.abs(cart.pos[2]) < 9) {
    const [px, , pz] = cart.pos;
    const off = (cart.collide?.[1] ?? 1.6) / 2 + 0.95;
    markers.push({
      id: "STREET_CART_VAULT",
      kind: "VAULT",
      label: "Vault",
      position: [px, 0, pz + off],
      path: [
        { pos: [px, 0, pz + off] },
        { pos: [px, 0, pz - off] },
      ],
      anim: { clip: "vault", loopOnce: true, path: "ARC", arcHeight: 0.85 },
      durationMs: 1000,
      bidirectional: true,
    });
  }

  // Barrel-row vault by the south row (across z, landing short of the facade).
  const barrels = propNear("barrel-group", -19, 8.6);
  if (barrels && Math.abs(barrels.pos[2]) < 10) {
    const [px, , pz] = barrels.pos;
    const toward = pz > 0 ? 1 : -1;
    markers.push({
      id: "STREET_BARREL_VAULT",
      kind: "VAULT",
      label: "Vault",
      position: [px, 0, pz - toward * 1.75],
      path: [
        { pos: [px, 0, pz - toward * 1.75] },
        { pos: [px, 0, pz + toward * 1.65] },
      ],
      anim: { clip: "vault", loopOnce: true, path: "ARC", arcHeight: 0.75 },
      durationMs: 950,
      bidirectional: true,
    });
  }

  // Crate-stack vault (along x — the stack sits against the north row).
  const crates = propNear("crate-stack", 24, -8.6);
  if (crates && Math.abs(crates.pos[2]) < 10) {
    const [px, , pz] = crates.pos;
    const off = (crates.collide?.[0] ?? 2.2) / 2 + 1.0;
    markers.push({
      id: "STREET_CRATE_VAULT",
      kind: "VAULT",
      label: "Vault",
      position: [px - off, 0, pz],
      path: [
        { pos: [px - off, 0, pz] },
        { pos: [px + off, 0, pz] },
      ],
      anim: { clip: "vault", loopOnce: true, path: "ARC", arcHeight: 0.85 },
      durationMs: 1100,
      bidirectional: true,
    });
  }

  // Puddle hops (JUMP tween). ADJUST alongside the street re-dressing pass.
  const puddles: [number, number, number][] = [
    [3, -2.0, 0.68],
    [-26, 1.5, 0.62],
  ];
  puddles.forEach(([px, pz, r], i) => {
    markers.push({
      id: `STREET_PUDDLE_HOP_${i}`,
      kind: "JUMP",
      label: "Hop",
      position: [px, 0, pz - (r + 0.55)],
      path: [
        { pos: [px, 0, pz - (r + 0.55)] },
        { pos: [px, 0, pz + (r + 0.55)] },
      ],
      anim: { clip: "walk", path: "ARC", arcHeight: 0.48 },
      durationMs: 640,
      bidirectional: true,
    });
    dressing.push({ type: "PUDDLE", pos: [px, 0, pz], radius: r });
  });

  // Church bell rope: on the churchyard corner beside the church's west face.
  const church = building("church");
  const bellPos: [number, number, number] = church
    ? [church.pos[0] - church.size[0] / 2 - 1.2, 0, church.pos[2] + church.size[2] / 2 + 1.4]
    : [64, 0, -8.6]; // ADJUST: Bible church slot fallback
  {
    const bellFace = -Math.PI / 2;
    markers.push({
      id: "CHURCH_BELL_ROPE",
      kind: "INTERACT_FLAVOR",
      label: "Ring the bell",
      position: [bellPos[0] + 0.75, 0, bellPos[2]],
      facing: bellFace,
      path: [{ pos: [bellPos[0] + 0.75, 0, bellPos[2]], faceY: bellFace }],
      anim: { clip: "reach", loopOnce: true, path: "NONE" },
      durationMs: 1250,
      flavor: {
        event: "CHURCH_BELL",
        fireAt: 0.45,
        fxPos: [bellPos[0] + 0.62, 2.55, bellPos[2]],
      },
    });
    dressing.push({ type: "BELL_POST", pos: bellPos, rotY: 0 });
    blockers.push([bellPos[0], bellPos[2], 0.28, 0.28]);
  }

  // Town pump splash (the mid-street pump).
  const pump = propNear("well-pump", -8, -1.5);
  if (pump) {
    const standAt: [number, number, number] = [
      pump.pos[0] + (pump.collide?.[0] ?? 1.4) / 2 + 0.55,
      0,
      pump.pos[2] + 0.35,
    ];
    markers.push({
      id: "TOWN_PUMP_SPLASH",
      kind: "INTERACT_FLAVOR",
      label: "Work the pump",
      position: standAt,
      facing: yawBetween(standAt, pump.pos),
      path: [{ pos: standAt, faceY: yawBetween(standAt, pump.pos) }],
      anim: { clip: "reach", loopOnce: true, path: "NONE" },
      durationMs: 1150,
      flavor: {
        event: "PUMP_SPLASH",
        fireAt: 0.4,
        fxPos: [pump.pos[0], 1.0, pump.pos[2]],
      },
    });
  }

  // Tavern bench sit (against the tavern's street face).
  const tavern = building("tavern") ?? building("rowD");
  if (tavern) {
    const north = tavern.pos[2] < 0;
    const frontZ = north
      ? tavern.pos[2] + tavern.size[2] / 2
      : tavern.pos[2] - tavern.size[2] / 2;
    const outward = north ? 1 : -1;
    const bx = tavern.pos[0] - 2.0;
    const bz = frontZ + outward * 0.55;
    const faceStreet = north ? 0 : Math.PI;
    markers.push({
      id: "TAVERN_BENCH_SIT",
      kind: "INTERACT_FLAVOR",
      label: "Sit",
      position: [bx, 0, bz + outward * 0.75],
      path: [{ pos: [bx, 0, bz + outward * 0.75] }],
      anim: { clip: "crouchIdle", path: "NONE" }, // placeholder seat pose; swap for a sit clip
      durationMs: 0,
      flavor: { event: "BENCH_SIT", fireAt: 0 },
      seat: {
        pose: { pos: [bx, 0.34, bz], faceY: faceStreet },
        stand: { pos: [bx, 0, bz + outward * 0.8], faceY: faceStreet },
      },
    });
    dressing.push({ type: "BENCH", pos: [bx, 0, bz], rotY: faceStreet });
    blockers.push([bx, bz, 0.85, 0.3]);
  }

  // Imported-visible-world law: the density pass now mounts the physical
  // ladder/plank/duck-frame/scaffold/cargo GLBs. Keep legacy marker/blocker
  // data for the active locomotion worker, but never render its primitive
  // placeholder obstacle kit in production.
  return { markers, roofZones, dressing: [], blockers };
}

export const TRAVERSAL_SET: TraversalSet = buildTraversalSet();

export function traversalBlockerColliders(): [number, number, number, number][] {
  return TRAVERSAL_SET.blockers;
}
