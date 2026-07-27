import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NO_SUPPRESSION,
  anySuppressed,
  calmWatchers,
  investigateWatchers,
  isPerceptionSuppressed,
  posesWithoutSuppressed,
  pruneSuppression,
  suppressWatchers,
  suppressedIdsAt,
  suppressionTicks,
} from "../stealth/suppression.js";
import { createWatcherAlert } from "../stealth/alert.js";
import { STEALTH_TUNING } from "../stealth/tuning.js";

test("suppression is scoped to the named watchers and nobody else", () => {
  const s = suppressWatchers(NO_SUPPRESSION, ["WATCH_MARKET"], 100, 600);
  assert.equal(isPerceptionSuppressed(s, "WATCH_MARKET", 200), true);
  assert.equal(isPerceptionSuppressed(s, "WATCH_GAOL", 200), false);
});

test("suppression expires at fromTick + duration and not before", () => {
  const from = 100;
  const dur = suppressionTicks(10);
  const s = suppressWatchers(NO_SUPPRESSION, ["A"], from, dur);
  assert.equal(dur, 600);
  assert.equal(isPerceptionSuppressed(s, "A", from), true);
  assert.equal(isPerceptionSuppressed(s, "A", from + dur - 1), true);
  // The expiry tick itself is the first tick the watcher is normal again.
  assert.equal(isPerceptionSuppressed(s, "A", from + dur), false);
  assert.equal(isPerceptionSuppressed(s, "A", from + dur + 5), false);
});

test("a later grant extends rather than shortens an existing one", () => {
  const first = suppressWatchers(NO_SUPPRESSION, ["A"], 0, 600);
  const extended = suppressWatchers(first, ["A"], 300, 600); // expiry 900 > 600
  assert.equal(isPerceptionSuppressed(extended, "A", 700), true);
  // A shorter, earlier grant does not pull the expiry back in.
  const notShortened = suppressWatchers(extended, ["A"], 0, 100);
  assert.equal(isPerceptionSuppressed(notShortened, "A", 700), true);
});

test("suppressedIdsAt and anySuppressed read the live set", () => {
  const s = suppressWatchers(
    suppressWatchers(NO_SUPPRESSION, ["A"], 0, 600),
    ["B"],
    0,
    720, // 12 world seconds
  );
  assert.deepEqual([...suppressedIdsAt(s, 100)].sort(), ["A", "B"]);
  // A lapses at 600, B lives to 720.
  assert.deepEqual([...suppressedIdsAt(s, 650)], ["B"]);
  assert.equal(anySuppressed(s, 650), true);
  assert.equal(anySuppressed(s, 800), false);
});

test("posesWithoutSuppressed drops only suppressed poses, keeping order", () => {
  const poses = [{ id: "A" }, { id: "B" }, { id: "C" }] as const;
  const s = suppressWatchers(NO_SUPPRESSION, ["B"], 0, 600);
  assert.deepEqual(posesWithoutSuppressed(poses, s, 100), [
    { id: "A" },
    { id: "C" },
  ]);
  // After expiry the full list comes back by identity.
  assert.equal(posesWithoutSuppressed(poses, s, 600), poses);
  // Empty ledger returns the same reference.
  assert.equal(posesWithoutSuppressed(poses, NO_SUPPRESSION, 0), poses);
});

test("investigateWatchers moves only the named actors toward the confrontation", () => {
  const alerts = [
    createWatcherAlert("WATCH_SHAMBLES"),
    createWatcherAlert("SENTRY_GAOL"),
    createWatcherAlert("SENTRY_ROPEWALK"),
  ];
  const at = { x: 16, y: 0, z: 0.4 };
  const next = investigateWatchers(alerts, ["WATCH_SHAMBLES", "SENTRY_GAOL"], at);
  const byId = new Map(next.map((a) => [a.id, a]));
  assert.equal(byId.get("WATCH_SHAMBLES")!.state, "INVESTIGATING");
  assert.deepEqual(byId.get("WATCH_SHAMBLES")!.lastKnown, at);
  assert.ok(
    byId.get("WATCH_SHAMBLES")!.suspicion >= STEALTH_TUNING.thresholds.investigating,
  );
  assert.equal(byId.get("SENTRY_GAOL")!.state, "INVESTIGATING");
  // The untouched watcher is returned by reference, calm.
  assert.equal(byId.get("SENTRY_ROPEWALK")!.state, "UNAWARE");
  assert.equal(byId.get("SENTRY_ROPEWALK"), alerts[2]);
});

test("calmWatchers resets only the named actors out of contact", () => {
  const hot = { ...createWatcherAlert("WATCH_SHAMBLES"), state: "ALERTED" as const, suspicion: 1, lastKnown: { x: 1, y: 0, z: 1 } };
  const other = { ...createWatcherAlert("SENTRY_GAOL"), state: "INVESTIGATING" as const, suspicion: 0.7 };
  const next = calmWatchers([hot, other], ["WATCH_SHAMBLES"]);
  const byId = new Map(next.map((a) => [a.id, a]));
  assert.equal(byId.get("WATCH_SHAMBLES")!.state, "UNAWARE");
  assert.equal(byId.get("WATCH_SHAMBLES")!.suspicion, 0);
  assert.equal(byId.get("WATCH_SHAMBLES")!.lastKnown, null);
  // Unnamed watcher untouched.
  assert.equal(byId.get("SENTRY_GAOL"), other);
});

test("pruning drops lapsed entries and keeps live ones", () => {
  const s = suppressWatchers(
    suppressWatchers(NO_SUPPRESSION, ["A"], 0, 600),
    ["B"],
    0,
    720,
  );
  const pruned = pruneSuppression(s, 650);
  assert.equal(pruned.until.has("A"), false);
  assert.equal(pruned.until.has("B"), true);
  // Nothing to prune returns the same reference.
  assert.equal(pruneSuppression(pruned, 0), pruned);
});
