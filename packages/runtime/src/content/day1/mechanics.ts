import type { Ctx, Sub } from "../../engine/ctx.js";
import { choose, mechanic } from "../../engine/dsl.js";
import { STAMP_SORT } from "./tables.js";

// Graded press pull. Deterministic from the player's stopOffset (stored in the
// committed event), so replay reproduces the same grade.
export function* pressPull(ctx: Ctx, promptId: string): Sub<"CRISP" | "USABLE" | "SMUDGED"> {
  const r = yield* mechanic(ctx, promptId, {
    kind: "PRESS",
    prompt: "The needle sweeps faster each pass. Stop it in the center for a clean pull.",
  });
  if (r.kind !== "PRESS") return "SMUDGED";
  const d = Math.abs(r.stopOffset - 0.5);
  if (d <= 0.08) return "CRISP";
  if (d <= 0.22) return "USABLE";
  return "SMUDGED";
}

export function* effortHold(ctx: Ctx, promptId: string, prompt: string): Sub<void> {
  yield* mechanic(ctx, promptId, { kind: "EFFORT", prompt });
}

export function* placeTack(ctx: Ctx, promptId: string, prompt: string): Sub<number> {
  const r = yield* mechanic(ctx, promptId, { kind: "PLACE", prompt });
  return r.kind === "PLACE" ? r.alignment : 0;
}

// Stamp sort demonstration with bounded correction (spec §26).
export function* stampSort(ctx: Ctx, promptId: string): Sub<void> {
  while (true) {
    const r = yield* mechanic(ctx, promptId, {
      kind: "SORT",
      prompt: "Sort the ones that will need the stamp.",
      sortItems: STAMP_SORT.items.map((i) => ({ itemId: i.itemId, label: i.label })),
      sortBuckets: STAMP_SORT.buckets.map((b) => ({ bucketId: b.bucketId, label: b.label })),
    });
    if (r.kind !== "SORT") continue;
    const wrong = STAMP_SORT.items.filter((item) => {
      const a = r.assignments.find((x) => x.itemId === item.itemId);
      return !a || a.bucketId !== item.correct;
    });
    if (wrong.length === 0) return;
    ctx.dialogue("PIKE", STAMP_SORT.nudge);
  }
}

// Generic multiple-choice demonstration with directional-nudge correction.
export function* correctedChoice(
  ctx: Ctx,
  promptId: string,
  frame: string,
  speaker: "ABIGAIL" | "PIKE" | "ARCHIVE",
  choices: { choiceId: string; label: string; correct: boolean; nudge?: string }[],
): Sub<void> {
  const disabled = new Set<string>();
  while (true) {
    const options = choices.map((c) => ({
      choiceId: c.choiceId,
      label: c.label,
      tags: [] as string[],
      disabled: disabled.has(c.choiceId),
    }));
    const choiceId = yield* choose(ctx, `${promptId}:${ctx.nextTxId()}`, frame, options);
    const picked = choices.find((c) => c.choiceId === choiceId)!;
    if (picked.correct) return;
    if (picked.nudge) ctx.dialogue(speaker, picked.nudge);
    disabled.add(picked.choiceId);
  }
}
