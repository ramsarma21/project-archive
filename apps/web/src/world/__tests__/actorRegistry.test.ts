import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createActorRegistry,
  type ActorPublish,
} from "../actorRegistry.js";

function pub(
  id: string,
  over: Partial<ActorPublish> = {},
): ActorPublish {
  return {
    id,
    spaceId: over.spaceId ?? "EXTERIOR",
    kind: over.kind ?? "DIRECTED_NPC",
    position: over.position ?? { x: 0, y: 0, z: 0 },
    forwardVec: over.forwardVec ?? { x: 0, y: 0, z: 1 },
    velocity: over.velocity,
    tick: over.tick ?? 1,
    owner: over.owner,
  };
}

test("publish/get/queryKind/querySpace round-trip with copied vectors", () => {
  const reg = createActorRegistry();
  const scratch = { x: 3, y: 0, z: 4 };
  reg.publish(pub("WATCH_1", { kind: "WATCHER", spaceId: "EXTERIOR", position: scratch, tick: 1 }));
  reg.publish(pub("NED", { kind: "THREAD_FIGURE", spaceId: "MERCER_PRESS", tick: 1 }));

  const got = reg.get("WATCH_1");
  assert.ok(got);
  assert.equal(got!.kind, "WATCHER");
  assert.deepEqual(got!.position, { x: 3, y: 0, z: 4 });

  // Registry must COPY: mutating the caller's scratch vector must not bleed in.
  scratch.x = 999;
  assert.equal(reg.get("WATCH_1")!.position.x, 3);

  assert.equal(reg.queryKind("WATCHER").length, 1);
  assert.equal(reg.queryKind("THREAD_FIGURE").length, 1);
  assert.equal(reg.queryKind("PURSUER").length, 0);
  assert.equal(reg.querySpace("EXTERIOR").length, 1);
  assert.equal(reg.querySpace("MERCER_PRESS").length, 1);
  assert.equal(reg.size, 2);
});

test("per-frame publish updates in place across ticks (no duplicate error)", () => {
  const dupes: string[] = [];
  const reg = createActorRegistry({ onDuplicateId: (id) => dupes.push(id) });
  reg.publish(pub("PURSUER_1", { kind: "PURSUER", position: { x: 0, y: 0, z: 0 }, tick: 1 }));
  reg.publish(pub("PURSUER_1", { kind: "PURSUER", position: { x: 1, y: 0, z: 0 }, tick: 2 }));
  reg.publish(pub("PURSUER_1", { kind: "PURSUER", position: { x: 2, y: 0, z: 0 }, tick: 3 }));
  assert.equal(reg.size, 1);
  assert.equal(reg.get("PURSUER_1")!.position.x, 2);
  assert.equal(reg.get("PURSUER_1")!.updatedTick, 3);
  assert.deepEqual(dupes, []);
});

test("duplicate id within the same tick fires dev error and first writer wins", () => {
  const dupes: string[] = [];
  const reg = createActorRegistry({ onDuplicateId: (id) => dupes.push(id) });
  reg.publish(pub("WATCH_1", { kind: "WATCHER", position: { x: 5, y: 0, z: 0 }, tick: 7 }));
  reg.publish(pub("WATCH_1", { kind: "WATCHER", position: { x: 9, y: 0, z: 0 }, tick: 7 }));
  assert.deepEqual(dupes, ["WATCH_1"]);
  assert.equal(reg.get("WATCH_1")!.position.x, 5, "first same-tick writer must win");
  assert.equal(reg.size, 1);
});

test("one stable owner may publish at render FPS above the field clock", () => {
  const dupes: string[] = [];
  const reg = createActorRegistry({ onDuplicateId: (id) => dupes.push(id) });
  const owner = {};
  reg.publish(pub("ABIGAIL", {
    owner,
    tick: 12,
    position: { x: 1, y: 0, z: 2 },
  }));
  reg.publish(pub("ABIGAIL", {
    owner,
    tick: 12,
    position: { x: 1.1, y: 0, z: 2 },
  }));
  assert.deepEqual(dupes, []);
  assert.equal(reg.get("ABIGAIL")!.position.x, 1.1);

  reg.publish(pub("ABIGAIL", {
    owner: {},
    tick: 12,
    position: { x: 9, y: 0, z: 9 },
  }));
  assert.deepEqual(dupes, ["ABIGAIL"]);
  assert.equal(reg.get("ABIGAIL")!.position.x, 1.1);
});

test("space isolation: interior and exterior actors do not cross-contaminate queries", () => {
  const reg = createActorRegistry();
  reg.publish(pub("A", { spaceId: "EXTERIOR", kind: "WATCHER", tick: 1 }));
  reg.publish(pub("B", { spaceId: "EXTERIOR", kind: "DIRECTED_NPC", tick: 1 }));
  reg.publish(pub("C", { spaceId: "PIKE_OFFICE", kind: "DIRECTED_NPC", tick: 1 }));
  const ext = reg.querySpace("EXTERIOR").map((a) => a.id).sort();
  const pike = reg.querySpace("PIKE_OFFICE").map((a) => a.id);
  assert.deepEqual(ext, ["A", "B"]);
  assert.deepEqual(pike, ["C"]);
  assert.equal(reg.querySpace("CUSTOM_HOUSE").length, 0);
});

test("remove() unmounts an actor and clears duplicate tracking", () => {
  const dupes: string[] = [];
  const reg = createActorRegistry({ onDuplicateId: (id) => dupes.push(id) });
  reg.publish(pub("NED", { tick: 4 }));
  reg.remove("NED");
  assert.equal(reg.get("NED"), undefined);
  assert.equal(reg.size, 0);
  // Re-publishing at the same tick after remove is NOT a duplicate.
  reg.publish(pub("NED", { tick: 4 }));
  assert.deepEqual(dupes, []);
  assert.equal(reg.size, 1);
});

test("pruneStale drops actors that stopped publishing, keeps fresh ones", () => {
  const reg = createActorRegistry();
  reg.publish(pub("STALE", { tick: 10 }));
  reg.publish(pub("FRESH", { tick: 58 }));
  // currentTick 60, maxAge 30 -> STALE (age 50) dropped, FRESH (age 2) kept.
  const removed = reg.pruneStale(60, 30);
  assert.deepEqual(removed, ["STALE"]);
  assert.equal(reg.get("STALE"), undefined);
  assert.ok(reg.get("FRESH"));
  assert.equal(reg.size, 1);
});

test("velocity is optional and copied when present", () => {
  const reg = createActorRegistry();
  reg.publish(pub("STATIC", { tick: 1 }));
  const vel = { x: 4.3, y: 0, z: 0 };
  reg.publish(pub("MOVER", { kind: "PURSUER", velocity: vel, tick: 1 }));
  assert.equal(reg.get("STATIC")!.velocity, undefined);
  vel.x = 0;
  assert.equal(reg.get("MOVER")!.velocity!.x, 4.3, "velocity must be copied, not referenced");
});

test("clear() empties the registry (scene swap)", () => {
  const reg = createActorRegistry();
  reg.publish(pub("A", { tick: 1 }));
  reg.publish(pub("B", { tick: 1 }));
  reg.clear();
  assert.equal(reg.size, 0);
  assert.equal(reg.queryKind("DIRECTED_NPC").length, 0);
});
