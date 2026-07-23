import { RELATIONSHIP_RANGE, type WorldState } from "@pa/contracts";

// Political Read uses a centered scale (-100..+100); everything else 0..100.
export function setRelationship(
  world: WorldState,
  key: string,
  value: number,
  centered = false,
): { direction: "UP" | "DOWN"; changed: boolean } {
  const prev = world.relationships[key] ?? 0;
  const min = centered ? -100 : RELATIONSHIP_RANGE.min;
  const max = centered ? 100 : RELATIONSHIP_RANGE.max;
  const clamped = Math.max(min, Math.min(max, value));
  world.relationships[key] = clamped;
  return { direction: clamped >= prev ? "UP" : "DOWN", changed: clamped !== prev };
}

export function adjustRelationship(
  world: WorldState,
  key: string,
  delta: number,
  centered = false,
): { direction: "UP" | "DOWN"; changed: boolean } {
  const prev = world.relationships[key] ?? 0;
  return setRelationship(world, key, prev + delta, centered);
}
