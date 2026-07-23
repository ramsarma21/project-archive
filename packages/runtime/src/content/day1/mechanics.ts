import type {
  PrintJobPhaseScores,
  PrintJobQuality,
  PrintJobState,
  PrintJobVariant,
} from "@pa/contracts";
import type { Ctx, Sub } from "../../engine/ctx.js";
import { choose, mechanic } from "../../engine/dsl.js";
import { STAMP_SORT } from "./tables.js";

function clampScore(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

export function scorePrintJob(
  raw: PrintJobPhaseScores,
): { phases: PrintJobPhaseScores; quality: PrintJobQuality } {
  const phases: PrintJobPhaseScores = {
    catch: clampScore(raw.catch),
    ink: clampScore(raw.ink),
    register: clampScore(raw.register),
    pull: clampScore(raw.pull),
    peel: clampScore(raw.peel),
  };
  const values = Object.values(phases);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const minimum = Math.min(...values);
  const quality: PrintJobQuality =
    average >= 0.85 && minimum >= 0.6
      ? "CRISP"
      : minimum < 0.35
        ? "SMUDGED"
        : "USABLE";
  return { phases, quality };
}

export function* printJob(
  ctx: Ctx,
  promptId: string,
  variant: PrintJobVariant,
): Sub<PrintJobState> {
  const raw = yield* mechanic(ctx, promptId, {
    kind: "PRINT_JOB",
    printVariant: variant,
    prompt:
      variant === "FINAL_PAGE"
        ? "Set the final sheet: catch, ink, register, pull, and peel."
        : "Run the proof: catch, ink, register, pull, and peel.",
  });
  const fallback: PrintJobPhaseScores = {
    catch: 0.7,
    ink: 0.7,
    register: 0.7,
    pull: 0.7,
    peel: 0.7,
  };
  const submitted = raw.kind === "PRINT_JOB" ? raw.phases : fallback;
  const accessible = raw.kind === "PRINT_JOB" && raw.accessible;
  const adjusted = accessible
    ? Object.fromEntries(
        Object.entries(submitted).map(([key, value]) => [
          key,
          Math.max(0.7, clampScore(value)),
        ]),
      ) as unknown as PrintJobPhaseScores
    : submitted;
  const scored = scorePrintJob(adjusted);
  const previous = ctx.world.printJobs[promptId];
  const state: PrintJobState = {
    promptId,
    variant,
    phases: scored.phases,
    quality: scored.quality,
    attempts: (previous?.attempts ?? 0) + 1,
  };
  ctx.world.printJobs[promptId] = state;
  return state;
}

export function* haulJob(
  ctx: Ctx,
  promptId: string,
  prompt: string,
): Sub<{ load: number; balance: number; thread: number }> {
  const raw = yield* mechanic(ctx, promptId, { kind: "HAUL_JOB", prompt });
  if (raw.kind !== "HAUL_JOB") {
    return { load: 0.7, balance: 0.7, thread: 0.7 };
  }
  return {
    load: clampScore(raw.phases.load),
    balance: clampScore(raw.phases.balance),
    thread: clampScore(raw.phases.thread),
  };
}

export function* postJob(
  ctx: Ctx,
  promptId: string,
  prompt: string,
): Sub<{ lineUp: number; tackLeft: number; tackRight: number }> {
  const raw = yield* mechanic(ctx, promptId, { kind: "POST_JOB", prompt });
  if (raw.kind !== "POST_JOB") {
    return { lineUp: 0.7, tackLeft: 0.7, tackRight: 0.7 };
  }
  return {
    lineUp: clampScore(raw.phases.lineUp),
    tackLeft: clampScore(raw.phases.tackLeft),
    tackRight: clampScore(raw.phases.tackRight),
  };
}

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
