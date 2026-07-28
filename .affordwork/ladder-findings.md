# Ladder climb-through + refusal — findings (workflow/mission-world)

Working dir: project-archive-worktrees/mission-world. Servers on 5273 (mine),
NOT main's 5173/3001. Evidence = real client (floor.html harness) + window.__diag.

## Owner ruling (supersedes "assess proposal")
- No bare-wall climb. Climb-up REQUIRES a visible ladder (or explicit grips).
  No ladder => no climb offered.
- Climb derives from the ladder geometry (base/top/face/rungs), not authored
  coords. Body must be ON the ladder's outer face (hands on rungs), not near it.
- Enforce with a gate. Placement spec now mandatory (geometry.ts = mission-flow).

## Real-play evidence (mw-climb-angles.mjs, 6 climbs x 5 angles, seed 0xb057)
Per-tick __diag (spline vs solver divergence, strict no-ignore hull embed, lift):
- Solver is CLEAN after last night's tangent-rise inset: maxDivergence ~0 and
  low-ignore authored embed ~0 on EVERY climb, front and off-angle. So the
  "through geometry" is NOT the solver fighting the spline.
- Angle dependence is real but shows as MISFIRE, not deep embed:
  - E_RIDGE->E_LOUVRE: @0 rose +3.76m (ok); @30/-30 rose -3m (HANG_DROP: fell);
    @70 rose 0; @120 rose -4.8m. Off-axis top-out is projected along probe dir
    (ahead() uses probe.dirX/dirZ), so it misses / becomes a drop.
  - F_LOW->F_CROWN: @0 CLIMB_UP rose 0; @70 rose -6.4m (fell into street).
  - C_SCAFF_FOOT->C_SCAFF_1: @70 rose 0 (armed CLIMB_UP but no rise).
  - D_MEETING_ROOF->E_RIDGE: rose 0m at ALL angles (never armed) -- suspicious.
- Persistent strict embed LAYING_STAGE ~0.32m at the buttress foot (treated as a
  low-step, so 0 in the low-ignore ring): a foot-level horizontal overlap.

Interpretation: with collision clean, the body the owner sees "through the
building" is riding tangent to the COLLISION face while the visible GLB art
(walls/eaves/shingles/clapboard) has no collision there, so he watches himself
pass through art; and from off-axis the projected top-out misses. Exactly the
class the ladder ruling removes: a visible ladder gives a defined outer face the
body hugs, clear of the wall, angle-independent.

## Mechanism summary (to confirm w/ roof-walk repro)
- Arming too permissive: authored climb volumes + inferred overhead/bare-face
  reads offer a vertical ascent from a footprint even where the destination is a
  thin platform plane with solid-looking (but non-collided) building art around
  it. Body rises the column, tops out -> "forced straight up and through."
- Top-out/rise path anchors are projected along probe.dirX/dirZ (ahead()), so
  off-axis approaches place lip+landing diagonally -> miss / clip / drop.
- beginAuthored DOES check headClearance + crossesPlatform along the sampled
  path, but with start+destination surfaces IGNORED, so a rise straight into the
  destination deck (the only "ceiling") is never refused.

## Lane constraints
Mine: engine-world/{parkour/*,playerMotion,collision}.ts + mission-m1/level/climbs.ts.
NOT mine: geometry.ts, assets.ts, assets/** (mission-flow); encounters/*,
opposition.ts (mission-encounters); and shared infra types.ts/authoring.ts/
compile.ts/route.ts (avoid to keep lanes clean).
ClimbVolume TYPE is in collision.ts (mine); it is POPULATED by compile.ts (not
mine) from ClimbSpec. So ladder face/geometry must be DERIVED inside
collision.ts/parkour from the volume + world geometry, or authored in climbs.ts
in a shape compile.ts already forwards.
