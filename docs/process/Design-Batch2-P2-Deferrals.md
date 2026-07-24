# Design Batch 2 P2 deferrals

## Gangplank balance interaction → Wave 5

The current dock assembly has a production-safe imported gangplank and support,
but it does not yet have a balance-specific motion/contact contract:

- `SJ-dock-haul-gangplank` is a committed reactive-exchange stage in
  `day1Exchanges.ts`; it has no analog balance sample in the event log.
- `MechanicRawResult` has no balance input/result shape, and the player motion
  controller exposes grounded traversal rather than a reliable plank-edge or
  load-shift signal.
- The current carry animation and speed cap are stable, but neither can prove
  that a left/right correction corresponds to physical barrel motion.

Shipping an `F` prompt or a detached HUD needle here would be fake interaction,
not physical balance. Wave 5 should add a deterministic balance result contract,
barrel/load shift on the imported rig, edge/contact tolerances, accessible
auto-correction, and Metal/ANGLE crossing tests together.

## Surface and morning palette

No replacement geometry or generated stand-ins were added. Existing imported
cobblestone materials, horizon blending, weather, water sheen, and seeded
population tint/role variation remain the production path. Batch 2 browser
evidence verifies those systems with the current world rather than hiding them
behind a code-only substitute.
