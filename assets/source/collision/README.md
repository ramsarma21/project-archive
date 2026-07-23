# Collision sidecars (asset-local collision metadata)

Authored, hand-owned collision primitives for the **currently imported** GLB
assets, keyed by asset key (`<asset-key>.collision.json`, where the runtime
loads `/world/props/<asset-key>.glb`). These files are the **source of truth**
the build/validate tooling reads:

- `assets/pipeline/build_collision_manifest.mjs` — measures the deployed GLBs
  (content hash, raw local bounds, node/mesh/tri counts), combines them with
  these sidecars, derives fitted visual bounds + audit deltas, and emits
  generated metadata + a report into `assets/build/collision/`.
- `assets/pipeline/validate_collision_manifest.mjs` — enforces the authoring
  contract below (hard errors fail; warnings are tolerated during migration).
- `assets/pipeline/author_collision_sidecars.mjs` — the authoring aid that
  produced these JSON files from measured bounds + a decision table. Edit that
  table (not the JSON) when re-authoring, then re-run build.

**Nothing here is wired into the runtime yet.** This is the foundation the later
runtime-collision integration consumes; it does not touch `manifest.ts`,
`collision.ts`, `playerMotion.ts`, `District.tsx`, or any door/traversal/water/
population/interior/density file.

## Coordinate frame

All colliders are authored in a **fit-normalized, asset-local frame, in
meters**:

- Origin is **centered on the asset footprint in X/Z**.
- `y = 0` is the asset's **feet** (grounded); `+y` is up.
- This is exactly the pre-rotation, pre-translation box `FittedGlb` builds in
  `apps/web/src/world/Character.tsx` (uniform **min-axis** fit to the manifest
  target size, recenter XZ, drop to ground).

Placement **yaw** and **world position** are applied later at integration time
(a pure rotate + translate). Sidecars never bake yaw/position in — long/rotated
props store their shape in local space and rely on the placement `rotY`.

Each sidecar records the `fit` context (`targetSize`/`scale`) its colliders were
authored against, mirroring the manifest placement. When an asset is used at
multiple fits, the sidecar is authored against the representative fit and the
build report flags the alternates (`multi-fit` warning); integration multiplies
the local collider by the per-placement fit ratio.

## Shape vocabulary

| shape | fields | use |
| --- | --- | --- |
| `box` | `center[3]`, `half[3]`, optional `yaw`, `tags[]` | compact convex solids, walls/panels, building broad phase |
| `capsule` | `a[3]`, `b[3]`, `radius`, `tags[]` | posts, bollards, tree trunks, stall/awning legs |
| `support` | `polygon[[x,z]…]`, `y`, `link`, `tags[]` | walkable surfaces: gangplanks, scaffold platforms, ship decks |
| `hazard` | `polygon[[x,z]…]`, `minY`, optional `maxY`, `link`, `tags[]` | hazard volumes (e.g. water); reserved for later use |
| `none` | — (empty `colliders`) | tiny/non-blocking assets; **must** document a `reason` in `note` |

Reserved composition references (recorded, **not** authored into final geometry
until their contracts land):

- `door` — front-wall / arch openings (see `pendingDoorContract`).
- `traversal` — route-gated leaves + density traversal props.

These appear in a sidecar's optional `compose[]` array as
`{ type: "door" | "traversal", ref, note }` and, for `support`/`hazard`, as a
`link` value of `"door"` / `"traversal"` / `"world:<anchor>"` / a sibling
collider `id`.

## Sidecar schema

```jsonc
{
  "assetKey": "market-stall",
  "category": "building|prop|ship|interior|surface|clutter|firstperson|skyline",
  "profile":  "solid|compound|capsule|none|pending",
  "fit": { "targetSize": [x, y, z] | null, "scale": 1 },
  "frontAxis": "+z",                 // optional; buildings/gates
  "pendingDoorContract": true,        // optional; openings deferred
  "pendingInteriorPlacement": true,   // optional; interior final profile deferred
  "note": "why this profile / documented reason for `none` or a margin",
  "colliders": [ /* shapes above; each needs a unique `id` */ ],
  "compose": [ { "type": "door", "ref": "…", "note": "…" } ]  // optional
}
```

Per-collider optional `marginReason` documents an intentional overrun of the
measured fitted bounds (otherwise overruns > 10cm are a hard error).

## Authoring rules (enforced or reviewed)

- Compact convex solids → a single measured `box`.
- Rotated/long props store **local** shapes; placement `rotY` is applied later.
- Complex carts / stalls / scaffolds / ships → **conservative compound**
  boxes/capsules/supports, never a full canopy/empty-space AABB.
- Posts / bollards / tree trunks → `capsule` (trunk only for the elm — the
  canopy never collides).
- Gangplanks / scaffold platforms / ship decks → include `support` polygons.
- Fences / rails → **finite-height** thin boxes/capsules, never infinite walls.
- No collisions for NPCs / crowds.
- Every margin beyond the measured visible bounds must be `<= 10cm` or carry an
  explicit `marginReason`. Door-frame safety margins stay **pending**.
- Buildings get a provisional **solid-body broad phase** at the measured fitted
  footprint (not the nominal slot) and are flagged `pendingDoorContract`;
  openings are never invented here.

## Categories & substantiality

`building`, `prop`, and `ship` are **substantial**: a missing/empty profile is a
hard error (unless explicitly `none` + reason, or a pending flag). `interior`,
`surface`, `clutter`, `firstperson`, and `skyline` are non-substantial:
unprofiled current assets in those buckets warn, they do not fail — so road,
density, interior and door assets can keep changing under their active workers.
