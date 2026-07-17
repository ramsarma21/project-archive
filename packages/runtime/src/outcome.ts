import { draw } from "./seed.js";

export interface WeightedOutcome {
  outcome: string;
  weight: number;
}

// Deterministic weighted pick. Given identical seed + label, always the same.
export function resolveOutcome(
  attemptSeed: Uint8Array,
  label: string,
  weights: WeightedOutcome[],
): string {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  const r = draw(attemptSeed, label) * total;
  let acc = 0;
  for (const w of weights) {
    acc += w.weight;
    if (r < acc) return w.outcome;
  }
  return weights[weights.length - 1]!.outcome;
}
