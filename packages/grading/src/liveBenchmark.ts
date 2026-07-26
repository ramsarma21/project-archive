// Measuring the thing rather than estimating it.
//
//   pnpm --filter @pa/grading grading:bench
//   pnpm --filter @pa/grading grading:bench --models a,b,c --samples 12
//
// Reports, per model: latency percentiles against the real gateway, the share of
// samples that would have blown the 1.5-second cap, token usage per call, and the
// cache-hit latency for comparison. The last of those is the number that decides
// what a classroom costs, because it is the path most answers take.
//
// This is a tool, not a test. It calls a paid API and it is not in `pnpm test`.

import { performance } from "node:perf_hooks";
import { loadRepoEnv } from "./env.js";
import { m1ItemBank } from "./items/m1.js";
import { GRADING_TIMEOUT_MS } from "./tuning.js";
import { MemoryVerdictCache } from "./cache.js";
import { GradingService } from "./service.js";
import {
  DEFAULT_GRADING_MODEL,
  TrueFoundryClassifierProvider,
  providerConfigured,
} from "./provider.js";

// A spread of answer shapes, because latency tracks prompt size and the items
// differ by a factor of three in rubric length.
const SAMPLES: readonly { itemId: string; answer: string }[] = [
  { itemId: "BOS.MD01.DUEL.STAMP.FROM_WHEN.v1", answer: "november 1st" },
  { itemId: "BOS.MD01.DUEL.POSTWAR.WHO_PAYS.v1", answer: "the colonies" },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.WHY_NOW.v1",
    answer: "they were broke after the war with france so they came to us for the money",
  },
  {
    itemId: "BOS.MD01.DUEL.POSTWAR.CAME_FROM_NOWHERE.v1",
    answer:
      "the war with france ended in 1763 and left britain owing a lot of money, so parliament decided the colonies should pay some of it and the stamp is how they collect it",
  },
  {
    itemId: "BOS.MD01.DUEL.REP.LAWFUL_BUT_UNJUST.v1",
    answer:
      "it was a legal vote for them but nobody in that room was elected by anyone in Boston, so it is not our consent",
  },
  {
    itemId: "BOS.MD01.DUEL.STAMP.NAME_TWO.v1",
    answer: "a newspaper and a court deed",
  },
];

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? 0;
}

async function benchmarkModel(model: string, samples: number): Promise<void> {
  const bank = m1ItemBank();
  const cache = new MemoryVerdictCache();
  const service = new GradingService({
    bank,
    provider: new TrueFoundryClassifierProvider(model),
    cache,
    // Well past the production cap, so a slow model reports its real latency
    // instead of being clipped to 1500ms and looking fine.
    timeoutMs: 20_000,
  });

  const latencies: number[] = [];
  let promptTokens = 0;
  let completionTokens = 0;
  let fallbacks = 0;
  let overCap = 0;

  for (let round = 0; round < samples; round += 1) {
    const sample = SAMPLES[round % SAMPLES.length];
    if (sample === undefined) continue;
    // A distinct attempt id per round keeps this honest about cache: the cache key
    // is item + rubric + answer, so repeating a sample WOULD hit, and we want cold
    // numbers here. Vary the answer with an invisible suffix instead.
    const answer =
      round < SAMPLES.length ? sample.answer : `${sample.answer} ${" ".repeat(round)}.`;
    const verdict = await service.grade({
      itemId: sample.itemId,
      answer,
      profileId: "bench",
      attemptId: `bench-${round}`,
      roundIndex: round % 6,
    });
    latencies.push(verdict.provenance.latencyMs);
    promptTokens += verdict.provenance.promptTokens ?? 0;
    completionTokens += verdict.provenance.completionTokens ?? 0;
    if (verdict.provenance.fallbackReason !== null) fallbacks += 1;
    if (verdict.provenance.latencyMs > GRADING_TIMEOUT_MS) overCap += 1;
  }

  // The cache path, measured rather than asserted. Re-grade the first sample,
  // which is now warm.
  const first = SAMPLES[0];
  const cacheTimes: number[] = [];
  if (first !== undefined) {
    for (let i = 0; i < 200; i += 1) {
      const started = performance.now();
      await service.grade({
        itemId: first.itemId,
        answer: first.answer,
        profileId: "bench",
        attemptId: "bench-cache",
        roundIndex: 0,
      });
      cacheTimes.push(performance.now() - started);
    }
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const cacheSorted = [...cacheTimes].sort((a, b) => a - b);
  const calls = Math.max(1, latencies.length - fallbacks);
  console.log(
    [
      `model              ${model}`,
      `cold samples       ${latencies.length} (${fallbacks} fell back)`,
      `latency ms         p50 ${percentile(sorted, 0.5).toFixed(0)}  p90 ${percentile(sorted, 0.9).toFixed(0)}  p95 ${percentile(sorted, 0.95).toFixed(0)}  max ${(sorted[sorted.length - 1] ?? 0).toFixed(0)}`,
      `over 1500ms cap    ${overCap}/${latencies.length}`,
      `tokens per call    ${(promptTokens / calls).toFixed(0)} prompt + ${(completionTokens / calls).toFixed(0)} completion`,
      `cache hit ms       p50 ${percentile(cacheSorted, 0.5).toFixed(3)}  p99 ${percentile(cacheSorted, 0.99).toFixed(3)}`,
      `cache stats        ${JSON.stringify(service.cacheStats)}`,
      "",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  loadRepoEnv();
  if (!providerConfigured()) {
    console.error("no grading credential configured; see .env.example");
    process.exit(2);
  }
  const models = (flag("models") ?? DEFAULT_GRADING_MODEL).split(",");
  const samples = Number(flag("samples") ?? SAMPLES.length);
  for (const model of models) await benchmarkModel(model.trim(), samples);
}

void main();
