# The frame spike: attributed, and mitigated in lane

## What it is (evidence, from the running accelerated client)

`.affordwork/spike-hunt.mjs` runs the real accelerated client (headless=new +
GPU raster, NOT SwiftShader), captures a Chrome devtools-timeline trace over the
route via CDP, and records `window.__diag.frames` (now carrying player position)
plus the Resource Timing entries.

BEFORE any fix, 3 runs / 11,930 frames:

    spikes >83ms: 2 (0.02%): 119ms @(15,-5), 101ms @(24,-1)   [both in run 1]
    the 119ms frame's trace: RunTask 118ms > FireAnimationFrame 118ms >
        v8.callFunction 118ms > FunctionCall 118ms
    co-occurring: GLES2Implementation::GetProgramiv 96ms, CommandBufferHelper::
        Finish 96ms, CommandBufferProxyImpl::WaitForGetOffset 96ms
    MinorGC max 20ms; no MajorGC; resources finishing mid-route: NONE

Read: the lurch is a single render-frame (`FireAnimationFrame`) spending ~96-118ms
of JS blocked on `GetProgramiv` — the CPU waiting on a WebGL program LINK to
finish. That is **three.js compiling a material's shader program the first time
it is drawn**, synchronously inside the render callback. When it lands above the
83ms five-step catch-up window it discards ~10 sim ticks, which is the slow-motion
lurch the owner reports: mostly fine, then a random lurch.

Ruled OUT with the same trace, not by assumption:
- **GC** — MinorGC max 20ms, no MajorGC in the spike.
- **Resource / GLB / texture streaming** — zero resources finished loading
  mid-route; everything loads before the route starts. So it is not scenery
  streaming in as it comes into view; the meshes are already resident, it is
  their programs being compiled on first draw.
- **Crowd spawn / runtime** — the sim costs 0.04ms/tick (sim-cost.mjs); a 118ms
  frame is 3000x that. The dominant event is a GL link wait, not JS allocation.

Reproducibility and location: rare and FRONT-LOADED. Only run 1 of 3 crossed
83ms; the spikes clustered at x=15-24 (early, as the camera reveals the first
scenery after spawn). Runs 2-3 still showed the same mechanism at 42-64ms (under
the window). So the mechanism is consistent; whether a given first-sight compile
crosses 83ms is timing jitter — which is exactly why it is intermittent.

## The fix (in lane: the MissionStage Canvas, not the scenery)

The materials being compiled are authored by M1Scenery, the rig components and
the assets (other lanes) — but the REMEDY is a render-init concern the Canvas
owns: compile ahead of time so the first-sight link happens during the opening
(behind the settle / camera ease) instead of mid-route. Added `<ShaderWarmup>` to
`apps/web/src/mission/MissionStage.tsx`: a few `compileAsync(scene, camera)` passes
across the first ~160 frames (re-run because the scenery, crowd and watch rigs
mount under Suspense over the opening, so one early pass would miss the late
arrivals). `compileAsync` uses KHR_parallel_shader_compile where present, so the
warm-up itself does not stall. It reads the scene the level already mounted and
authors nothing — it does not touch M1Scenery or any asset.

## Measured effect (AFTER, 4 runs / 16,002 frames)

    worst route-window GetProgramiv (shader link): 96ms -> 44ms
    worst route-window FireAnimationFrame:        118ms -> 69ms   (now UNDER 83ms)
    spikes >83ms: 2/11,930 (0.02%) -> 1/16,002 (0.01%)
    and the one remaining spike is 86ms at (3,-11) — SPAWN, before the player
    moves (frame ~0-4, masked by the opening), not mid-route.

The mid-route lurches (x=15-24, scenery revealed during movement) are gone; the
worst render frame in the route window now sits below the catch-up window. The
compile load moved to the opening as intended.

## What remains (for the scenery lane to sequence)

One marginal first-frame compile survives at spawn (86ms, once in four runs): a
program that is drawn on the very first frame, before or as the warm-up's first
pass runs, likely a shadow-map depth-material variant three compiles on the first
shadow pass. Pushing it out fully is a scenery/render concern that is cleaner to
own where the materials are authored — a full drei `<Preload>`-style pass that
also warms the shadow and instanced variants, or simpler/shared materials so
there are fewer programs to compile. Reported rather than chased across the lane
boundary. It is at the opening, so it does not read as an in-play lurch.

## Magnitude caveat (unchanged from before)

All of this is on THIS machine's accelerated path, which is not the owner's
hardware. It settles the MECHANISM (first-sight shader compile) and shows the
warm-up moves it off the route here. The MAGNITUDE the owner sees is what
`.affordwork/owner-frame-trace.mjs` settles when he runs it — before and after
this change, the in-window dropped-tick count is the number that matters.
