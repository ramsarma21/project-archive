# M0 web foundations — integration handoff

**Integrated 2026-07-21.** `Play` now owns the stable stealth store and typed
field-event bridge; `World3D` owns the fixed field clock, active
`GameplayWorld`, actor registry, and camera arbitration; `Player` consumes the
shared collision world and split camera/input policy. `WorldServicesContext`
provides the same gameplay world, registry, tick, store, and field submitter to
Canvas directors. The notes below remain as the original additive-core
handoff record.

**Acceptance closed 2026-07-21.** The Mercer ready-to-action regression was a
QA-only primer suppression: the locomotion harness hid every `.has-primer`
overlay, including the required first-use Choice primer. The harness now
acknowledges primers semantically, and `presentationActionSurface` explicitly
tests choreography/timeline → primer → authored request handoff without
auto-emitting or duplicating runtime events.

These four additive modules originally shipped **isolated** as pure/store code
plus tests. This doc records the integration points that were subsequently
wired after the interior rebuild released the shared files.

**Delivered (new files, no existing file modified):**

- `apps/web/src/world/actorRegistry.ts`
- `apps/web/src/world/fieldSimulation.ts`
- `apps/web/src/world/stealthStore.ts`
- `apps/web/src/presenter/StealthHud.tsx`
- `apps/web/src/world/cameraOwnership.ts`
- Tests: `apps/web/src/world/__tests__/{actorRegistry,fieldSimulation,stealthStore,cameraOwnership}.test.ts`

**Also integrated:** shared collision/LOS extraction
(`gameplayWorld.ts`/`collision.ts`) and the runtime/contract
heat·Standing·Thread persistence plus field-event bridge (`packages/*`). M0
still adds no visible stealth styling; player-facing gauges remain M1/M2 work.

---

## 1. `actorRegistry` — owned by `World3D`, published by directors

**Lifecycle (World3D):** create one registry per scene mount and hand it down.

```ts
// World3D body (NOT added yet):
const actorRegistryRef = useRef(createActorRegistry());
// On interior/scene swap: actorRegistryRef.current.clear();
// Once per field tick (after advanceFieldClock): pruneStale(tick, STALE_AGE_TICKS ~= 30).
```

**Publisher — `ActorDirector.tsx` `DirectedNpc` (props unchanged; add publish):**
Pass the registry + current `spaceId` (exterior id or active interior id) + the
current field `tick` in, and publish inside the existing `useFrame`:

```ts
// Inside DirectedNpc.useFrame, after group.position/rotation are set:
registry.publish({
  id: props.npc.id,
  spaceId,                 // World3D's active space (interior id or "EXTERIOR")
  kind: "DIRECTED_NPC",
  position: group.position,          // copied by the registry
  forwardVec: { x: Math.sin(group.rotation.y), y: 0, z: Math.cos(group.rotation.y) },
  tick,                    // fieldSimulation tick, threaded from World3D
});
// On unmount (useEffect cleanup): registry.remove(props.npc.id);
```

Future `WatcherDirector`/`ChaseDirector` publish `WATCHER`/`PURSUER` the same
way (with `velocity` for movers). **Ambient crowd (`PopulationDirector`) must
never publish here.** Consumers call `queryKind`/`querySpace`/`get`.

## 2. `fieldSimulation` — owned by `World3D`, one clock per attempt

`World3D` holds a `FieldClock` and advances it once per frame from the R3F frame
delta, then runs each field director for the returned fixed steps:

```ts
const fieldClockRef = useRef(createFieldClock(projectFieldSeed([attemptId, cueId])));
// In a single World3D useFrame (before directors that need the tick):
const { clock, steps, firstTick, lastTick } = advanceFieldClock(fieldClockRef.current, dt);
fieldClockRef.current = clock;
// pause when a modal/inspect is open: fieldClockRef.current = pauseFieldClock(...)
```

Watcher scan/suspicion/chase/heat kernels consume `firstTick..lastTick` (and
`fieldRandom(seed, tick, salt)` for any deterministic draw). The `tick` handed
to `actorRegistry.publish` is `clock.tick`.

## 3. `stealthStore` + `StealthHud` — QuestMarkerHud twin

**Store creation:** alongside the existing quest-marker store (World3D / Play).
Writers `patch()` only their own fields:

- Player / `ChaseDirector`: `{ stamina, chaseActive, timedDash }`
- `WatcherDirector`: `{ suspicion, detectionState: detectionStateForSuspicion(s), nearestWatcherDir }`
- runtime heat/Standing bridge: `{ heat, standing }`

**HUD mount:** add `<StealthHud store={stealthStore} />` in the same DOM overlay
layer as `<QuestMarkerHud>` (see `Play.tsx`/presenter overlay). It renders `null`
in M0; pass `dev` only for inspection. **No `styles.css` changes** until the M1
stamina bar / M2 suspicion pip land.

## 4. `cameraOwnership` — replaces the `Player.cameraOverride` coupling

Today `Player.tsx` takes a single `cameraOverride: boolean` (line ~263) that
gates **both** the follow-camera write and movement. World3D passes
`cameraOverride={choreographyCameraActive}` (World3D ~1058).

**Target wiring (later):** World3D computes claims and resolves once per frame:

```ts
const cam = resolveCameraOwnership({
  firstPerson: firstPersonActive,        // World3D ~849
  choreography: choreographyCameraActive, // World3D ~847
  chase: chaseActive,                     // from ChaseDirector (M1)
  chaseCameraYaw: chaseCamYaw,            // from ChaseDirector (M1)
});
```

Replace the single Player prop with two, driven by `cam`:

- `cameraControlledExternally={cam.cameraControlledExternally}` → the current
  `!props.cameraOverride` guards on the follow-camera write become
  `!cameraControlledExternally` (Player lines ~676, ~716, ~792, ~1142).
- `inputLocked={cam.inputLocked}` → folds into the movement-disable path
  (Player line ~310 `!props.cameraOverride`, and the World3D `disabled` calc
  ~1051). Choreography/FP set both true (identical to today — no visible change);
  chase sets `cameraControlledExternally` true with `inputLocked` false (the new
  live-movement capability).
- `externalMovementYaw={cam.externalMovementYaw}` → when `{mode:"CAMERA"}`,
  interpret WASD relative to `yaw`; `{mode:"PLAYER"}` = today's heading basis;
  `{mode:"LOCKED"}` = movement frozen.

**Transitions:** feed the prior/next resolved state to `cameraTransition()` and
act on the signals — `cancelPointerDrag` when entering an external owner (drop
Player's active pointer orbit), `resetFollowCamera` when returning to `PLAYER`
(re-snap the follow cam). Precedence is FIRST_PERSON > CHOREOGRAPHY > CHASE >
PLAYER.

**Acceptance already covered by tests:** choreography locks both; a chase-style
external hold keeps movement live with a camera-relative yaw; precedence and the
pointer-drag/reset transition signals.

---

## Verification (this handoff)

- `node --import tsx --test src/world/__tests__/*.test.ts` → 137 pass (103 prior
  + 34 new).
- `tsc -p tsconfig.json` (typecheck) → clean.
- No existing file modified; uncommitted work preserved.
