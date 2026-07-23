# Gameplay world integration handoff

**Integrated 2026-07-21.** The interior rebuild released its shared files and
the deferred patch below is now live: `World3D` builds/selects one active
`GameplayWorld`, provides it through `WorldServicesContext`, and passes it to
`Player`. `Player` no longer composes a private collision world.

`gameplayWorld.ts` binds locomotion and exact semantic LOS to one selected
collision world.

## Deferred `World3D.tsx` patch

At the existing `colliders` memo (currently near the
`exteriorColliders`/`doorAwareBuildingColliders` composition):

1. Compute the existing density-enabled browser flag in `World3D`, not
   `Player`.
2. Memoize `buildExteriorGameplayCollision({ colliders, includeDensity })`.
3. After the interior rebuild's `interiorWorld` memo settles, select:
   - `EXTERIOR_GAMEPLAY_SPACE` when `interiorId` is null.
   - `interiorGameplaySpace(interiorId)` otherwise.
4. Memoize `buildGameplayWorld`. For an active interior, pass its already-built
   collision as `{ [interiorId]: interiorWorld }`. A missing active interior
   world deliberately throws instead of silently falling back outdoors.
5. Pass that single `GameplayWorldService` to `Player` and later to watcher,
   chase, and camera directors. Rebuild it when door target, route state,
   density state, or active interior changes.

Do not rebuild any interior collision in `gameplayWorld.ts`; isolated-room
construction remains owned by the interior system.

## Deferred `Player.tsx` patch

At the `Player` props and private `collisionWorld` memo (currently around lines
250 and 315):

1. Add `gameplayWorld: GameplayWorldService`.
2. Remove the private exterior/interior construction memo, its
   `DENSITY_TRAVERSAL_COLLISION` module constant, and now-unused builder imports.
3. Set `const collisionWorld = props.gameplayWorld.collision` and keep
   `worldRef.current = collisionWorld` so authored-action event handlers retain
   the latest selected space.
4. Keep all `stepMotion`, support, depenetration, and position checks unchanged.
   They must receive the same `collisionWorld` object.
5. Route new LOS consumers through `props.gameplayWorld.segmentClear` and use
   `segmentOccluderIds`/`blockerIds` for diagnostics.
6. During the first mechanical patch, retain the legacy `colliders` prop only
   for the existing camera-boom and `routeBlockerMatrix` QA paths. Migrate those
   separately to service blocker IDs/bounds after parity is confirmed; do not
   combine that behavior change with collision ownership extraction.
7. Remove `interiorWorld` from `Player` only after interior camera activation
   uses the active-space discriminator (`gameplayWorld.activeSpace.kind`).

## Required integration gate

- Existing collision, density traversal, doorway, and all 36 interior tests.
- `gameplayWorld.test.ts` parity tests.
- Typecheck and production build.
- Browser smoke: exterior movement, closed/open door, route unlock, density
  on/off, enter two different interiors, return outdoors.
