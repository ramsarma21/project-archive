// Wave 3 determinism-fixture helpers (save-compatibility gate).
//
// A fixture freezes, at a known-good commit, the FULL committed event log of a
// scripted run plus the byte-exact RuntimeView and MasteryReport projected by
// replaying that log. The replay test re-projects the log through the current
// session factory and byte-compares. Any refactor that changes replay
// semantics (event acceptance, state projection, report derivation) fails the
// gate; content-intentional changes regenerate fixtures explicitly with
// `node --import tsx test/recordWave3Fixtures.ts`.
import type { PresenterEvent, RuntimeView, MasteryReport } from "@pa/contracts";

export interface Wave3FixtureMeta {
  profileId: string;
  packageId: string;
  chapterId: string;
  variationRootSeedHex: string;
  committedEventCount: number;
  generatedAt: string;
}

export interface Wave3Fixture {
  name: string;
  seedHex: string;
  mode: "happy" | "missSyncs";
  assessmentMode: "QA_DRAFT";
  done: boolean;
  meta: Wave3FixtureMeta;
  events: PresenterEvent[];
  view: RuntimeView;
  report: MasteryReport;
}

export const WAVE3_CASES = [
  { name: "seedA-happy", seedHex: "11".repeat(32), mode: "happy" },
  { name: "seedB-happy", seedHex: "22".repeat(32), mode: "happy" },
  { name: "seedA-missSyncs", seedHex: "11".repeat(32), mode: "missSyncs" },
] as const;

// Pinned meta: the report generator takes generatedAt as an input, so the
// fixture pins it (worker passes wall-clock; determinism is over the rest).
export function pinnedMeta(
  packageId: string,
  chapterId: string,
  seedHex: string,
  committedEventCount: number,
): Wave3FixtureMeta {
  return {
    profileId: "wave3-fixture-profile",
    packageId,
    chapterId,
    variationRootSeedHex: seedHex,
    committedEventCount,
    generatedAt: "2026-07-23T00:00:00.000Z",
  };
}

// First differing JSON path between two serializable values, for actionable
// failure output (the assertion itself is a byte compare).
export function firstDiffPath(a: unknown, b: unknown, path = "$"): string | null {
  if (typeof a !== typeof b) return path;
  if (a === null || b === null || typeof a !== "object") {
    return Object.is(a, b) ? null : path;
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) {
    const extra = aKeys.filter((k) => !bKeys.includes(k)).concat(bKeys.filter((k) => !aKeys.includes(k)));
    return `${path}{keys:${extra.join(",")}}`;
  }
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return `${path}{keyOrder:${aKeys[i]}<>${bKeys[i]}}`;
  }
  for (const key of aKeys) {
    const hit = firstDiffPath(aObj[key], bObj[key], `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}
