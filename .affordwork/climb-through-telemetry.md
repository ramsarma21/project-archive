# Climb-through architecture fix — empirical before/after

Measured by `.affordwork/probe-climb-through.mjs`, which drives the REAL
production flow controller (`stepFlow`) into every authored CLIMB / MANTLE /
VAULT link on the compiled M1 world and, on every substep, measures the deepest
the capsule sinks into ANY solid blocker with **no ignore set at all** (the
phasing a player actually sees). Run it from `packages/mission-m1`:

    node --import tsx ../../.affordwork/probe-climb-through.mjs   # (path-adjust imports; see file)

## BEFORE (baseline c69f904, stepAuthored writes the interpolated sample directly)

    16 of 44 authored transitions drive the capsule >5cm into a solid.

Worst offenders (depth ≈ the 0.35m capsule radius = capsule centre planted on the
climbed surface, i.e. half the body inside it), every one against the collider in
the move's own `ignore` set:

    B_CRATES_FOOT->B_CRATES_A     MANTLE     0.346m in SHAMBLES_CRATES_A (IGNORED)
    B2_GOODS_IN->B2_GOODS_OUT     VAULT      0.346m in DOCK_BARRELS       (IGNORED)
    C_KING_CRATES_FOOT->..CRATES  MANTLE     0.345m in KING_LANE_CRATES   (IGNORED)
    B_CART_FOOT->B_CART_0         MANTLE     0.345m in CART_0             (IGNORED)
    D2_OUTSIDE->E_BUTTRESS        CLIMB_UP   0.338m in HOLLIS_BUTTRESS    (IGNORED)
    F_VAULT_IN->F_VAULT_OUT       VAULT      0.337m in LIBERTY_BARRELS    (IGNORED)
    D_VAULT_IN_0->D_VAULT_OUT_0   VAULT      0.337m in CHIMNEY_0          (IGNORED)  @y=13.42
    D_VAULT_IN_1->D_VAULT_OUT_1   VAULT      0.337m in CHIMNEY_1          (IGNORED)  @y=13.42
    D2_VENT_IN_0->..VENT_OUT_0    VAULT      0.337m in ROPEWALK_VENT_0    (IGNORED)
    D2_VENT_IN_1->..VENT_OUT_1    VAULT      0.337m in ROPEWALK_VENT_1    (IGNORED)
    C_LANE_FOOT->C_LANE_HAY       CLIMB_UP   0.336m in LANE_HAY           (IGNORED)
    D2_VAULT_IN->D2_VAULT_OUT     VAULT      0.326m in ROPE_CAPSTAN       (IGNORED)
    C_LANE_VAULT_IN->..VAULT_OUT  VAULT      0.326m in KING_LANE_BARRELS  (IGNORED)
    B_VAULT_IN->B_VAULT_OUT       VAULT      0.320m in GAOL_BARRELS       (IGNORED)
    C_LANE_GATE_IN->..GATE_OUT    CLIMB_OVER 0.230m in KING_LANE_GATE     (IGNORED)
    D2_OVER_IN->D2_OVER_OUT       CLIMB_OVER 0.215m in TAR_PARTITION      (IGNORED)

Note every penetrated collider is `(IGNORED)` — it is in the move's own ignore
set, which is exactly why the production non-penetration invariant
(`motionPenetration`, which excluded `action.ignore`) never saw it, and why the
prior swept `authoredTrajectoryClear` check (which also ignores it) passed.

## AFTER (solver owns final position during authored transitions)

    0 of 44 authored transitions drive the capsule >5cm into a solid.

Only residual reading is a 0.043m grounded contact on HOLLIS_MEETING (a body
resting against a wall on a GROUNDED tick, not an authored climb-through, and
below the 5cm gate). Every crate/cart/barrel/chimney/vent/gate climb and vault
now keeps the capsule on the OUTSIDE surface for the whole motion.

## The change

`packages/engine-world/src/playerMotion.ts`:
- `stepAuthored` no longer writes the interpolated anchor sample straight onto
  the body. The sample is a PROPOSAL; the kinematic solver (`resolveOverlapXZ`,
  MTV depenetration) decides the final position each substep against the FULL
  solid world — the climbed surface INCLUDED, nothing ignored. This is the
  PhysX-CCT `move()`-not-`setPosition()` discipline: a landable top's solid span
  no longer overlaps the capsule once the feet reach it, so topping out is never
  pushed back, but the near face is solid while the feet are below it, so the
  body climbs from the outside.
- `motionPenetration` no longer excludes `action.ignore` from the solid-embed
  test, so the always-on dev assertion and the fuzzer now SEE a climb-through.
  (The deck-plane test keeps the exclusion: a legitimate top-out passes the head
  through the destination deck's own plane.)

Permanent gate: `packages/mission-m1/src/__tests__/climbSurfaceInvariant.test.ts`.
