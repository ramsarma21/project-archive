import { test } from "node:test";
import assert from "node:assert/strict";
import type { FieldRuntimeView } from "@pa/contracts";
import {
  createStealthStore,
  detectionStateForSuspicion,
  stealthPatchFromRuntimeField,
  EMPTY_STEALTH_SNAPSHOT,
  STAMINA_EPS,
  SUSPICION_EPS,
  DIR_EPS,
} from "../stealthStore.js";

test("starts empty and returns a stable snapshot reference", () => {
  const store = createStealthStore();
  assert.equal(store.getSnapshot(), EMPTY_STEALTH_SNAPSHOT);
  // A no-op patch keeps the same object identity (no render churn).
  store.patch({});
  assert.equal(store.getSnapshot(), EMPTY_STEALTH_SNAPSHOT);
});

test("subscribers fire only on meaningful change; sub-epsilon drift is gated", () => {
  const store = createStealthStore();
  let notifications = 0;
  const unsub = store.subscribe(() => notifications++);

  // Below the stamina epsilon -> gated, no notify, identity preserved.
  const before = store.getSnapshot();
  store.patch({ stamina: 1 - STAMINA_EPS / 2 });
  assert.equal(notifications, 0);
  assert.equal(store.getSnapshot(), before);

  // A real change notifies once.
  store.patch({ stamina: 0.5 });
  assert.equal(notifications, 1);
  assert.equal(store.getSnapshot().stamina, 0.5);

  unsub();
  store.patch({ stamina: 0.1 });
  assert.equal(notifications, 1, "unsubscribed listener must not fire");
});

test("independent writers patch disjoint fields without clobbering", () => {
  const store = createStealthStore();
  // Player/ChaseDirector writer:
  store.patch({ stamina: 0.4, chaseActive: true, timedDash: true });
  // WatcherDirector writer:
  store.patch({ suspicion: 0.8, detectionState: "ALERTED", nearestWatcherDir: 1.2 });
  // Runtime bridge writer:
  store.patch({ heat: "hunted", standing: "marked" });

  const s = store.getSnapshot();
  assert.equal(s.stamina, 0.4);
  assert.equal(s.chaseActive, true);
  assert.equal(s.timedDash, true);
  assert.equal(s.suspicion, 0.8);
  assert.equal(s.detectionState, "ALERTED");
  assert.equal(s.heat, "hunted");
  assert.equal(s.standing, "marked");
  assert.equal(s.nearestWatcherDir, 1.2);
});

test("numeric fields clamp to [0,1]", () => {
  const store = createStealthStore();
  store.patch({ stamina: 5, suspicion: -3 });
  const s = store.getSnapshot();
  assert.equal(s.stamina, 1);
  assert.equal(s.suspicion, 0);
});

test("enum and boolean changes always notify", () => {
  const store = createStealthStore();
  let n = 0;
  store.subscribe(() => n++);
  store.patch({ heat: "noticed" });
  store.patch({ detectionState: "WARY" });
  store.patch({ chaseActive: true });
  store.patch({ standing: "familiar" });
  assert.equal(n, 4);
});

test("nearestWatcherDir: null<->value notifies; sub-epsilon rotation is gated; wraparound handled", () => {
  const store = createStealthStore();
  let n = 0;
  store.subscribe(() => n++);

  store.patch({ nearestWatcherDir: 0.0 }); // null -> 0
  assert.equal(n, 1);

  store.patch({ nearestWatcherDir: DIR_EPS / 2 }); // tiny rotation, gated
  assert.equal(n, 1);

  store.patch({ nearestWatcherDir: 0.5 }); // real rotation
  assert.equal(n, 2);

  store.patch({ nearestWatcherDir: null }); // value -> null
  assert.equal(n, 3);

  // Wraparound: +pi and -pi are the same bearing -> gated.
  store.patch({ nearestWatcherDir: Math.PI });
  const afterPi = n;
  store.patch({ nearestWatcherDir: -Math.PI });
  assert.equal(n, afterPi, "±pi is the same bearing, must not notify");
});

test("suspicion above epsilon notifies, and detection thresholds map per D.3", () => {
  const store = createStealthStore();
  let n = 0;
  store.subscribe(() => n++);
  store.patch({ suspicion: SUSPICION_EPS * 2 });
  assert.equal(n, 1);

  assert.equal(detectionStateForSuspicion(0.0), "CLEAR");
  assert.equal(detectionStateForSuspicion(0.34), "CLEAR");
  assert.equal(detectionStateForSuspicion(0.35), "WARY");
  assert.equal(detectionStateForSuspicion(0.69), "WARY");
  assert.equal(detectionStateForSuspicion(0.7), "ALERTED");
  assert.equal(detectionStateForSuspicion(0.99), "ALERTED");
  assert.equal(detectionStateForSuspicion(1.0), "CAUGHT");
});

test("reset restores the empty snapshot and notifies once", () => {
  const store = createStealthStore();
  store.patch({ stamina: 0.2, heat: "hunted", chaseActive: true });
  let n = 0;
  store.subscribe(() => n++);
  store.reset();
  assert.equal(store.getSnapshot(), EMPTY_STEALTH_SNAPSHOT);
  assert.equal(n, 1);
  store.reset(); // already empty -> no notify
  assert.equal(n, 1);
});

test("runtime hydration maps durable heat/Standing without resetting live defaults", () => {
  const store = createStealthStore();
  const durable = {
    heat: { band: "HUNTED" },
    standing: { band: "TRUSTED" },
    activeChase: null,
  } as unknown as FieldRuntimeView;
  store.patch(stealthPatchFromRuntimeField(durable));
  assert.deepEqual(store.getSnapshot(), {
    ...EMPTY_STEALTH_SNAPSHOT,
    heat: "hunted",
    standing: "trusted",
  });

  store.patch(
    stealthPatchFromRuntimeField({
      ...durable,
      activeChase: {
        interruptId: "interrupt-1",
        chaseId: "chase-1",
        sourceId: "watcher-1",
      },
    }),
  );
  assert.equal(store.getSnapshot().chaseActive, true);
});
