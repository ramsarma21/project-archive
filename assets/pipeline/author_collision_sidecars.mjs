// Authoring aid: emit the asset-local collision sidecars from a hand-specified
// decision table combined with MEASURED bounds.
//
// Provenance model (no circular dependency): the measured block in
// collision-manifest.json comes purely from the GLB geometry, never from the
// sidecars. This generator consumes that measured data + the AUTHOR table below
// (the actual human collision decisions: shape choice, which parts collide,
// front axis, pending flags) and writes assets/source/collision/*.collision.json.
// Those JSON files are the committed source of truth the build/validate tools
// read. Re-run only when re-authoring; edit the AUTHOR table here, not the JSON,
// to keep the intent readable.
//
// All colliders are in the FIT-NORMALIZED, ASSET-LOCAL, METERS frame described
// in assets/source/collision/README.md (centered XZ, grounded y=0). fb = the
// asset's measured fitted size [fx, fy, fz] at its representative fit; for
// assets with no manifest placement fb == the raw normalized size (scale 1).
//
// Run: node assets/pipeline/build_collision_manifest.mjs   (measure first)
//      node assets/pipeline/author_collision_sidecars.mjs  (then author)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PATHS, round } from "./collision_lib.mjs";

const manifestPath = join(PATHS.outDir, "collision-manifest.json");
if (!existsSync(manifestPath)) {
  console.error("run build_collision_manifest.mjs first (need measured bounds)");
  process.exit(1);
}
const model = JSON.parse(readFileSync(manifestPath, "utf8"));

// ---- collider builders (fitted-local meters) -------------------------------
const box = (id, center, half, tags, extra = {}) => ({ id, shape: "box", center: center.map((n) => round(n)), half: half.map((n) => round(n)), tags, ...extra });
const capsule = (id, a, b, radius, tags, extra = {}) => ({ id, shape: "capsule", a: a.map((n) => round(n)), b: b.map((n) => round(n)), radius: round(radius), tags, ...extra });

// A vertical post whose capped ends sit exactly at [0, height] in Y (the round
// caps do not dip below ground or poke above the measured height), at footprint
// offset [ox, oz].
function postCapsule(id, height, radius, tags, ox = 0, oz = 0, extra = {}) {
  const r = Math.min(radius, height / 2);
  return capsule(id, [ox, r, oz], [ox, height - r, oz], r, tags, extra);
}
const support = (id, polygon, y, link, tags, extra = {}) => ({ id, shape: "support", polygon: polygon.map((p) => p.map((n) => round(n))), y: round(y), link, tags, ...extra });

// A conservative solid-body broad-phase box hugging the fitted footprint,
// inset 6cm so it never pokes past the measured visual bounds.
function solidBody(fb, tags = ["obstacle"], extra = {}) {
  const [fx, fy, fz] = fb;
  return box("body", [0, fy / 2, 0], [Math.max(0.05, fx / 2 - 0.06), fy / 2, Math.max(0.05, fz / 2 - 0.06)], tags, extra);
}

// ---- AUTHOR table ----------------------------------------------------------
// Each entry: (fb) => { category, profile, frontAxis?, pendingDoorContract?,
// pendingInteriorPlacement?, note?, colliders?[], compose?[] }.
const BUILDINGS = [
  "bldg-brick", "bldg-clapboard", "bldg-counting", "bldg-customhouse", "bldg-printshop",
  "bldg-row-brick-a", "bldg-row-brick-b", "bldg-row-clapboard-a", "bldg-row-clapboard-b",
  "bldg-row-clapboard-c", "bldg-row-shop", "bldg-scaffold", "bldg-tavern",
  "bldg-townhouse-civic", "bldg-warehouse-street", "bldg-warehouse-wharf-a",
  "bldg-warehouse-wharf-b", "church-meetinghouse",
];

const INTERIOR = [
  "bed-fourpost", "bookshelf-ledgers", "candle-sconce", "church-pew-block", "church-pulpit",
  "clerk-desk", "dresser-shelves", "hearth-mantel", "iron-stove", "press-common",
  "shop-counter", "shop-counter-long", "spinning-wheel", "storage-chest", "table-chairs-set",
  "tankard-cluster", "tavern-bar-barrels", "tavern-table-set", "type-cases", "washbasin-stand",
  "stone-steps",
];

const SURFACES = [
  "colonial-alley-a", "colonial-alley-b", "colonial-civic-square", "colonial-gutter-corner",
  "colonial-gutter-straight", "colonial-liberty-courtyard", "colonial-street-a",
  "colonial-street-b", "colonial-street-c", "colonial-street-endcap", "colonial-street-junction",
  "colonial-wharf-apron", "colonial-wharf-boardwalk", "colonial-wharf-pier-finger",
  "colonial-yard-ground", "colonial-yard-perimeter", "colonial-yard-east-cap",
];

const DENSITY_BUILDINGS = [
  "infill-lean-to", "infill-service-shed",
];

const DENSITY_CITY = [
  "city-block-rear-a", "city-block-rear-b", "city-block-rear-c",
];

const AUTHOR = {};

// Buildings: provisional solid-body broad phase; door openings deferred.
for (const key of BUILDINGS) {
  AUTHOR[key] = (fb) => ({
    category: "building",
    profile: "solid",
    frontAxis: "+z", // model-local street-facing axis; placement rotY orients it
    pendingDoorContract: true,
    note: "Provisional solid-body broad phase at the measured fitted footprint (NOT the nominal slot). Door/threshold openings are deferred to the door contract.",
    colliders: [solidBody(fb, ["obstacle", "building", "broadphase"])],
    compose: [{ type: "door", ref: "pendingDoorContract", note: "front-wall opening to be cut when the door contract lands" }],
  });
}

// Interior props: bounds metadata only; final profile pending placement.
for (const key of INTERIOR) {
  AUTHOR[key] = (fb) => {
    const [fx, fy, fz] = fb;
    return {
      category: "interior",
      profile: "solid",
      pendingInteriorPlacement: true,
      note: "Provisional bounds box in the raw-normalized local frame. Final footprint depends on per-room interior placement (owned by the interior worker); re-fit when that lands.",
      colliders: [box("body", [0, fy / 2, 0], [fx / 2 - 0.05, fy / 2, fz / 2 - 0.05], ["obstacle", "provisional"])],
    };
  };
}

// Walkable ground surfaces: the implicit ground plane already supports the
// player, so the GLB itself carries no vertical blocker.
for (const key of SURFACES) {
  AUTHOR[key] = () => ({
    category: "surface",
    profile: "none",
    note: "Walkable ground surface; support is the implicit ground plane. Road/yard kit is still changing — no vertical collider on the module itself.",
    colliders: [],
  });
}

// Density buildings are imported physical structures. They are currently
// decorative/infill placements, but keep a measured local broad phase for the
// later metadata-driven runtime integration.
for (const key of DENSITY_BUILDINGS) {
  AUTHOR[key] = (fb) => ({
    category: "building",
    profile: "solid",
    pendingDoorContract: true,
    note: "Imported density infill building; measured solid broad phase. Any usable doorway remains deferred to the door contract.",
    colliders: [solidBody(fb, ["obstacle", "building", "density"])],
    compose: [{ type: "door", ref: "pendingDoorContract", note: "decorative density placement today; future threshold requires authored opening" }],
  });
}

for (const key of DENSITY_CITY) {
  AUTHOR[key] = () => ({
    category: "skyline",
    profile: "none",
    note: "Grounded non-explorable land-side city envelope outside playable bounds; coarse world boundary remains runtime-owned.",
    colliders: [],
  });
}

// The covered passage visibly contains an opening. A full-body AABB would
// block that opening, so leave exact composition to the door/traversal pass.
AUTHOR["infill-passage-gate"] = () => ({
  category: "prop",
  profile: "pending",
  pendingDoorContract: true,
  note: "Imported covered passage with a real opening; no invented solid AABB. Opening/frame collision is deferred.",
  colliders: [],
  compose: [{ type: "door", ref: "density-passage-opening", note: "author frame legs + lintel around measured opening" }],
});

function thinDensityPanel(fb, tags) {
  return box(
    "panel",
    [0, fb[1] / 2, 0],
    [Math.max(0.05, fb[0] / 2 - 0.02), fb[1] / 2, Math.max(0.04, fb[2] / 2)],
    tags,
  );
}

for (const key of [
  "yard-fence-straight", "yard-fence-end", "yard-fence-gate",
  "service-wall-straight", "service-wall-end",
  "town-gate-wing-straight", "town-gate-wing-end",
  "wharf-rope-rail-straight", "wharf-rope-rail-end",
]) {
  AUTHOR[key] = (fb) => ({
    category: "prop",
    profile: "solid",
    note: "Finite imported density barrier in asset-local X; placement scale/yaw is applied later.",
    colliders: [thinDensityPanel(fb, ["obstacle", "density-barrier"])],
  });
}

for (const key of [
  "yard-fence-corner", "service-wall-corner",
  "town-gate-wing-corner", "wharf-rope-rail-corner",
]) {
  AUTHOR[key] = (fb) => ({
    category: "prop",
    profile: "compound",
    note: "Imported right-angle density barrier; two finite perpendicular wings, never an oversized corner AABB.",
    colliders: [
      box("wing-x", [0, fb[1] / 2, -fb[2] * 0.22], [fb[0] / 2, fb[1] / 2, Math.max(0.04, fb[2] * 0.08)], ["obstacle", "density-barrier"]),
      box("wing-z", [-fb[0] * 0.22, fb[1] / 2, 0], [Math.max(0.04, fb[0] * 0.08), fb[1] / 2, fb[2] / 2], ["obstacle", "density-barrier"]),
    ],
  });
}

AUTHOR["work-ladder"] = (fb) => ({
  category: "prop",
  profile: "compound",
  note: "Imported climb affordance; two conservative rail capsules keep the central climb path open. Exact support binds to densityManifest traversal anchors later.",
  colliders: [
    postCapsule("rail-l", fb[1], Math.max(0.04, fb[0] * 0.05), ["obstacle", "ladder"], -fb[0] * 0.28, 0),
    postCapsule("rail-r", fb[1], Math.max(0.04, fb[0] * 0.05), ["obstacle", "ladder"], fb[0] * 0.28, 0),
  ],
  compose: [{ type: "traversal", ref: "densityManifest:work-ladder", note: "CLIMB_UP/DOWN start, end, landing and support" }],
});

AUTHOR["balance-plank"] = (fb) => ({
  category: "prop",
  profile: "compound",
  note: "Imported trestle plank; walkable top recorded for later traversal integration.",
  colliders: [
    support(
      "plank-top",
      [[-fb[0] / 2, -fb[2] / 2], [fb[0] / 2, -fb[2] / 2], [fb[0] / 2, fb[2] / 2], [-fb[0] / 2, fb[2] / 2]],
      fb[1],
      "traversal",
      ["support", "walkable", "density"],
    ),
  ],
  compose: [{ type: "traversal", ref: "densityManifest:balance-plank", note: "BALANCE endpoints and cooldown" }],
});

AUTHOR["duck-beam-frame"] = (fb) => ({
  category: "prop",
  profile: "compound",
  note: "Imported duck-under frame; side posts and overhead beam only, center opening remains clear.",
  colliders: [
    postCapsule("post-l", fb[1], Math.max(0.05, fb[2] * 0.12), ["obstacle", "density"], -(fb[0] / 2 - 0.08), 0),
    postCapsule("post-r", fb[1], Math.max(0.05, fb[2] * 0.12), ["obstacle", "density"], fb[0] / 2 - 0.08, 0),
    box("beam", [0, fb[1] * 0.88, 0], [fb[0] / 2, fb[1] * 0.12, fb[2] / 2], ["obstacle", "overhead", "duck"]),
  ],
  compose: [{ type: "traversal", ref: "densityManifest:duck-beam-frame", note: "DUCK_UNDER center path and clearance" }],
});

AUTHOR["printshop-hanging-sign"] = () => ({
  category: "clutter",
  profile: "none",
  note: "Wall-mounted imported trade sign above player reach; facade placement is non-blocking.",
  colliders: [],
});

// ---- Major outdoor props (explicit shapes) ---------------------------------
Object.assign(AUTHOR, {
  "barrel-group": (fb) => ({ category: "prop", profile: "solid", note: "Barrel cluster; single convex box.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.06, fb[1] / 2, fb[2] / 2 - 0.06], ["obstacle"])] }),
  "crate-stack": (fb) => ({ category: "prop", profile: "solid", note: "Stacked crates; box top is landable.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.06, fb[1] / 2, fb[2] / 2 - 0.06], ["obstacle", "landable"])] }),
  "crate-mound": (fb) => ({ category: "prop", profile: "solid", note: "Crate mound; conservative box, landable top. Used at two fits — authored against the larger.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.08, fb[1] / 2, fb[2] / 2 - 0.08], ["obstacle", "landable"])] }),
  "hand-cart": (fb) => ({ category: "prop", profile: "compound", note: "Cart body only; wheels/handle empty space excluded (conservative, not a full AABB).", colliders: [box("bed", [0, fb[1] * 0.42, 0], [fb[0] / 2 - 0.2, fb[1] * 0.34, fb[2] / 2 - 0.18], ["obstacle"])] }),
  "hay-cart": (fb) => ({ category: "prop", profile: "compound", note: "Loaded cart body; conservative box excluding wheel overhang.", colliders: [box("bed", [0, fb[1] * 0.5, 0], [fb[0] / 2 - 0.2, fb[1] * 0.42, fb[2] / 2 - 0.15], ["obstacle"])] }),
  "roof-ramp-cart": (fb) => ({ category: "prop", profile: "compound", note: "Ramp cart body; conservative box.", colliders: [box("body", [0, fb[1] * 0.5, 0], [fb[0] / 2 - 0.15, fb[1] * 0.45, fb[2] / 2 - 0.12], ["obstacle"])] }),
  "market-stall": (fb) => ({
    category: "prop", profile: "compound",
    note: "Counter + front posts; awning canopy up high is NOT collided.",
    colliders: [
      box("counter", [0, fb[1] * 0.38, fb[2] * 0.18], [fb[0] / 2 - 0.15, fb[1] * 0.34, fb[2] * 0.22], ["obstacle"]),
      postCapsule("post-l", fb[1], 0.06, ["obstacle"], -(fb[0] / 2 - 0.15), -(fb[2] / 2 - 0.15)),
      postCapsule("post-r", fb[1], 0.06, ["obstacle"], fb[0] / 2 - 0.15, -(fb[2] / 2 - 0.15)),
    ],
  }),
  "market-awning": (fb) => ({
    category: "prop", profile: "compound",
    note: "Four support posts only; the canopy is open air (no AABB over the empty span).",
    colliders: [
      postCapsule("post-fl", fb[1], 0.06, ["obstacle"], -(fb[0] / 2 - 0.12), -(fb[2] / 2 - 0.12)),
      postCapsule("post-fr", fb[1], 0.06, ["obstacle"], fb[0] / 2 - 0.12, -(fb[2] / 2 - 0.12)),
      postCapsule("post-bl", fb[1], 0.06, ["obstacle"], -(fb[0] / 2 - 0.12), fb[2] / 2 - 0.12),
      postCapsule("post-br", fb[1], 0.06, ["obstacle"], fb[0] / 2 - 0.12, fb[2] / 2 - 0.12),
    ],
  }),
  "timber-crane": (fb) => ({
    category: "prop", profile: "compound",
    note: "Base + vertical mast; the jib arm overhead is not collided (conservative).",
    colliders: [
      box("base", [0, fb[1] * 0.12, 0], [fb[0] * 0.3, fb[1] * 0.12, fb[2] * 0.4], ["obstacle"]),
      postCapsule("mast", fb[1], 0.28, ["obstacle"]),
    ],
  }),
  "churchyard-fence": (fb) => ({ category: "prop", profile: "solid", note: "Finite thin fence panel (NOT an infinite wall).", colliders: [box("panel", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.02, fb[1] / 2, Math.max(0.06, fb[2] / 2)], ["obstacle", "fence"])] }),
  "drying-line-rack": (fb) => ({
    category: "prop", profile: "compound",
    note: "Two end A-frames; the wash-lines between are pass-through dressing.",
    colliders: [
      postCapsule("frame-l", fb[1], 0.08, ["obstacle"], -(fb[0] / 2 - 0.12), 0),
      postCapsule("frame-r", fb[1], 0.08, ["obstacle"], fb[0] / 2 - 0.12, 0),
    ],
  }),
  "fence-gate": (fb) => ({
    category: "prop", profile: "solid",
    note: "Swing-gate leaf. Route-gated in the manifest (THOMAS_DOCK_ROUTE) — collider clears when the route unlocks; that gating stays runtime-owned.",
    colliders: [box("leaf", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.03, fb[1] / 2, Math.max(0.08, fb[2] / 2)], ["obstacle", "gate", "route-gated"])],
    compose: [{ type: "traversal", ref: "THOMAS_DOCK_ROUTE", note: "route-gated blocker; unlock handling owned by runtime" }],
  }),
  "firewood-stack": (fb) => ({ category: "prop", profile: "solid", note: "Compact stacked wood; landable top.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.05, fb[1] / 2, fb[2] / 2 - 0.05], ["obstacle", "landable"])] }),
  "fish-flakes-rack": (fb) => ({ category: "prop", profile: "solid", note: "Low drying rack.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.06, fb[1] / 2, fb[2] / 2 - 0.06], ["obstacle"])] }),
  "gangplank": (fb) => ({
    category: "prop", profile: "compound",
    note: "Walkable plank bridging deck to ship; support surface, not a wall. Long axis is local X.",
    colliders: [support("deck", [[-(fb[0] / 2 - 0.05), -(fb[2] / 2 - 0.02)], [fb[0] / 2 - 0.05, -(fb[2] / 2 - 0.02)], [fb[0] / 2 - 0.05, fb[2] / 2 - 0.02], [-(fb[0] / 2 - 0.05), fb[2] / 2 - 0.02]], Math.min(0.2, fb[1] * 0.5), "world:wharf-deck", ["support", "walkable"])],
  }),
  "rope-coil-large": (fb) => ({ category: "prop", profile: "solid", note: "Low coil; minor obstacle, landable.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.05, fb[1] / 2, fb[2] / 2 - 0.05], ["obstacle", "landable"])] }),
  "cargo-net-bundle": (fb) => ({ category: "prop", profile: "solid", note: "Bundled cargo net.", colliders: [box("body", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.04, fb[1] / 2, fb[2] / 2 - 0.04], ["obstacle"])] }),
  "notice-board": (fb) => ({ category: "prop", profile: "solid", note: "Post + board; thin footprint.", colliders: [box("board", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.04, fb[1] / 2, Math.max(0.1, fb[2] / 2)], ["obstacle"])] }),
  "well-pump": (fb) => ({ category: "prop", profile: "solid", note: "Pump + trough base.", colliders: [box("body", [0, fb[1] * 0.4, 0], [fb[0] / 2 - 0.05, fb[1] * 0.4, fb[2] / 2 - 0.05], ["obstacle"])] }),
  "hitching-post": (fb) => ({ category: "prop", profile: "capsule", note: "Post → capsule. NOTE: the manifest fit target [1.6,1.1,0.4] over-constrains this asset (z=0.4), so its fitted footprint collapses to ~0.4m; integration should widen the fit or the capsule radius.", colliders: [postCapsule("post", fb[1], Math.max(0.1, Math.min(fb[0], fb[2]) / 2 - 0.02), ["obstacle", "post"], 0, 0, { marginReason: "fit target z=0.4 collapses the footprint; post radius intentionally near the fitted half-extent until the fit is widened" })] }),
  "street-lantern-bracket": () => ({ category: "prop", profile: "none", note: "Wall-mounted bracket at y≈2.4 (see manifest); out of player reach, so no ground collider. Light comes from SkyDirector LANTERN anchors." }),
  "liberty-elm": (fb) => ({
    category: "prop", profile: "compound",
    note: "Trunk + root flare ONLY; the canopy is deliberately non-colliding (players stand under the elm).",
    colliders: [
      postCapsule("trunk", Math.min(4.5, fb[1] * 0.35), 0.6, ["obstacle", "tree-trunk"]),
      box("root", [0, 0.25, 0], [1.1, 0.25, 1.1], ["obstacle", "root"]),
    ],
  }),
  "scaffold-low": (fb) => ({
    category: "prop", profile: "compound",
    note: "Lower frame is solid; the plank platform on top is a landable support.",
    colliders: [
      box("frame", [0, fb[1] * 0.42, 0], [fb[0] / 2 - 0.1, fb[1] * 0.42, fb[2] / 2 - 0.1], ["obstacle"]),
      support("platform", [[-(fb[0] / 2 - 0.1), -(fb[2] / 2 - 0.1)], [fb[0] / 2 - 0.1, -(fb[2] / 2 - 0.1)], [fb[0] / 2 - 0.1, fb[2] / 2 - 0.1], [-(fb[0] / 2 - 0.1), fb[2] / 2 - 0.1]], fb[1] * 0.84, "frame", ["support", "walkable"]),
    ],
  }),
});

// ---- Gate arch -------------------------------------------------------------
AUTHOR["town-gate"] = () => ({
  category: "prop",
  profile: "pending",
  frontAxis: "+x",
  pendingDoorContract: true,
  note: "Town gate arch. Its wings + clear opening are modelled in manifest.GATES/exteriorColliders; the arch opening itself is deferred to the door contract, so no box colliders are authored here yet.",
  colliders: [],
  compose: [
    { type: "door", ref: "GATES:halfOpening", note: "clear arch opening owned by manifest.GATES" },
    { type: "traversal", ref: "GATES:wings", note: "wing palisades owned by manifest.GATES/BARRIERS" },
  ],
});

// ---- Ships + wharf furniture ----------------------------------------------
AUTHOR["ship-brig-hero"] = (fb) => ({
  category: "ship", profile: "compound",
  note: "Hero brig. Authored in the raw-normalized local frame; the moored world scale/position is owned by WaterDirector (atmosphere worker) and applied later. Hull is a solid; the deck is a landable support.",
  colliders: [
    box("hull", [0, fb[1] * 0.3, 0], [fb[0] / 2 - 0.05, fb[1] * 0.3, fb[2] / 2 - 0.03], ["obstacle", "hull"]),
    support("deck", [[-(fb[0] / 2 - 0.1), -(fb[2] / 2 - 0.05)], [fb[0] / 2 - 0.1, -(fb[2] / 2 - 0.05)], [fb[0] / 2 - 0.1, fb[2] / 2 - 0.05], [-(fb[0] / 2 - 0.1), fb[2] / 2 - 0.05]], fb[1] * 0.6, "hull", ["support", "deck"]),
  ],
});
AUTHOR["ship-sloop"] = (fb) => ({
  category: "ship", profile: "compound",
  note: "Sloop. Local-normalized; world scale owned by WaterDirector. Hull solid + deck support.",
  colliders: [
    box("hull", [0, fb[1] * 0.35, 0], [fb[0] / 2 - 0.05, fb[1] * 0.35, fb[2] / 2 - 0.03], ["obstacle", "hull"]),
    support("deck", [[-(fb[0] / 2 - 0.1), -(fb[2] / 2 - 0.05)], [fb[0] / 2 - 0.1, -(fb[2] / 2 - 0.05)], [fb[0] / 2 - 0.1, fb[2] / 2 - 0.05], [-(fb[0] / 2 - 0.1), fb[2] / 2 - 0.05]], fb[1] * 0.7, "hull", ["support", "deck"]),
  ],
});
AUTHOR["ship-snow-background"] = (fb) => ({
  category: "ship", profile: "solid",
  note: "Background vessel (not boarded). Local-normalized hull solid; world scale/pos owned by WaterDirector.",
  colliders: [box("hull", [0, fb[1] * 0.35, 0], [fb[0] / 2 - 0.05, fb[1] * 0.35, fb[2] / 2 - 0.03], ["obstacle", "hull"])],
});
AUTHOR["rowboat"] = (fb) => ({
  category: "ship", profile: "solid",
  note: "Small rowboat. Local-normalized hull; world placement owned by WaterDirector.",
  colliders: [box("hull", [0, fb[1] / 2, 0], [fb[0] / 2 - 0.04, fb[1] / 2, fb[2] / 2 - 0.03], ["obstacle", "hull"])],
});
AUTHOR["bollard"] = (fb) => ({ category: "prop", profile: "capsule", note: "Mooring bollard → short capsule.", colliders: [postCapsule("post", Math.min(fb[1], 1.0), Math.max(0.12, Math.min(fb[0], fb[2]) / 2 - 0.02), ["obstacle", "post"])] });
AUTHOR["buoy"] = () => ({ category: "clutter", profile: "none", note: "Floating buoy in water; non-blocking to on-foot locomotion." });
AUTHOR["wharf-pier-module"] = () => ({ category: "surface", profile: "none", note: "Walkable pier deck module; support is the implicit ground/deck plane per the wharf contract." });
AUTHOR["wharf-boardwalk-plank"] = () => ({ category: "surface", profile: "none", note: "Walkable boardwalk plank; support is the implicit deck plane." });

// ---- Tiny / non-blocking clutter + first-person rigs -----------------------
AUTHOR["paper-satchel"] = () => ({ category: "clutter", profile: "none", note: "Loose papers/satchel; non-blocking clutter." });
AUTHOR["printer-ink-balls"] = () => ({ category: "clutter", profile: "none", note: "Hand-held common-press ink-ball pair; a first-person press tool carried and animated (dab/rock) by the runtime, never a world collider. No ground blocker." });
AUTHOR["first-person-arms"] = () => ({ category: "firstperson", profile: "none", note: "First-person arm rig; camera-attached, never a world collider." });
AUTHOR["first-person-left-arm"] = () => ({ category: "firstperson", profile: "none", note: "First-person arm rig; camera-attached, never a world collider." });
AUTHOR["first-person-left-grip"] = () => ({ category: "firstperson", profile: "none", note: "First-person grip rig; camera-attached, never a world collider." });
AUTHOR["first-person-right-arm"] = () => ({ category: "firstperson", profile: "none", note: "First-person arm rig; camera-attached, never a world collider." });
AUTHOR["skyline-cluster-a"] = () => ({ category: "skyline", profile: "none", note: "Distant skyline backdrop beyond the play bounds; never reachable." });
AUTHOR["skyline-cluster-b"] = () => ({ category: "skyline", profile: "none", note: "Distant skyline backdrop beyond the play bounds; never reachable." });
AUTHOR["skyline-cluster-c"] = () => ({ category: "skyline", profile: "none", note: "Distant skyline backdrop beyond the play bounds; never reachable." });
AUTHOR["colonial-door"] = () => ({
  category: "prop", profile: "pending", pendingDoorContract: true,
  note: "Legacy fused frame+leaf door (single mesh). Superseded by colonial-door-kit (separate Door_Frame/Door_Recess/Door_Leaf nodes). No collider authored on the fused mesh.",
  colliders: [], compose: [{ type: "door", ref: "colonial-door-kit", note: "replaced by the imported door kit + doorwayContract resolver" }],
});

// Imported production door kit (colonial-door-kit.glb): separate named nodes
// Door_Frame (stationary jamb + lintel), Door_Recess (stationary dark
// vestibule occluding the baked static door), Door_Leaf (hinged leaf) and
// optional Door_Latch. Authored in the fit-normalized asset-local frame, meters
// (centered XZ, grounded). The runtime places these per doorway via the
// doorwayContract resolver (frame/recess solid + stationary; closed leaf a
// dynamic OBB; trigger keyed by stable door id). This entry is only EMITTED
// once colonial-door-kit.glb is measured (assemble_door_kit.py output synced);
// until then the author script lists it as skipped (no measured asset).
AUTHOR["colonial-door-kit"] = () => {
  const openW = 1.2, openH = 2.05, jamb = 0.08, leafW = 1.12, leafH = 2.0, leafT = 0.1;
  const halfOpen = openW / 2;
  return {
    category: "prop",
    profile: "compound",
    frontAxis: "+z",
    note: "Imported door kit: stationary frame (jambs + lintel) + recess back wall are solid; the closed leaf is a dynamic OBB the runtime rotates about the hinge; passage clears only when the aperture exceeds the player capsule + margin. Frame never moves; open leaf follows the actual hinge; never an infinite-height leaf. Per-door triggers are keyed by stable door id at integration.",
    colliders: [
      box("jamb-l", [-(halfOpen + jamb / 2), openH / 2, 0], [jamb / 2, openH / 2, Math.max(0.06, leafT)], ["obstacle", "door-frame", "static"]),
      box("jamb-r", [halfOpen + jamb / 2, openH / 2, 0], [jamb / 2, openH / 2, Math.max(0.06, leafT)], ["obstacle", "door-frame", "static"]),
      box("lintel", [0, openH + jamb / 2, 0], [halfOpen + jamb, jamb / 2, Math.max(0.06, leafT)], ["obstacle", "door-frame", "static"]),
      box("recess", [0, openH / 2, -0.14], [halfOpen, openH / 2, 0.04], ["obstacle", "door-recess", "static", "occluder"]),
      box("leaf", [0, leafH / 2, 0], [leafW / 2, leafH / 2, leafT / 2], ["obstacle", "door-leaf", "dynamic"], {
        marginReason: "leaf is a dynamic OBB rotated about the hinge stile at runtime; closed state authored here, open state follows the resolved hinge.",
      }),
    ],
    compose: [
      { type: "door", ref: "doorwayContract", note: "hinge/opening/trigger world placement owned by apps/web/src/world/doorwayContract.ts, keyed by stable door id" },
    ],
  };
};

// ---- emit ------------------------------------------------------------------
mkdirSync(PATHS.sidecars, { recursive: true });
let written = 0;
const missing = [];
for (const [key, fn] of Object.entries(AUTHOR)) {
  const asset = model.assets[key];
  if (!asset) {
    missing.push(key);
    continue;
  }
  const fb = asset.derived?.fittedSize ?? asset.measured?.rawSize ?? [1, 1, 1];
  const authored = fn(fb);
  const sidecar = {
    assetKey: key,
    category: authored.category,
    profile: authored.profile,
    fit: asset.fit ? { targetSize: asset.fit.targetSize ?? null, scale: asset.fit.scale ?? 1 } : { targetSize: null, scale: 1 },
    ...(authored.frontAxis ? { frontAxis: authored.frontAxis } : {}),
    ...(authored.pendingDoorContract ? { pendingDoorContract: true } : {}),
    ...(authored.pendingInteriorPlacement ? { pendingInteriorPlacement: true } : {}),
    note: authored.note,
    colliders: authored.colliders ?? [],
    ...(authored.compose ? { compose: authored.compose } : {}),
  };
  writeFileSync(join(PATHS.sidecars, `${key}.collision.json`), JSON.stringify(sidecar, null, 2) + "\n");
  written++;
}
console.log(`authored ${written} sidecars into ${PATHS.sidecars}`);
if (missing.length) console.warn(`skipped (no measured asset): ${missing.join(", ")}`);
