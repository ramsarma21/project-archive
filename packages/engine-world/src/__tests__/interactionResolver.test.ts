import test from "node:test";
import assert from "node:assert/strict";
import {
  INTERACTION_PRIORITIES,
  createInteractionRegistry,
  interactionPresentationMetadata,
  type InteractionCandidate,
} from "../interactionRegistry.js";
import {
  INTERACTION_FACING_WAIVER_M,
  INTERACTION_HYSTERESIS_M,
  resolveInteraction,
  resolveInteractionAffordance,
} from "../interactionResolver.js";

function candidate(
  id: string,
  priority: InteractionCandidate["priority"],
  position: readonly [number, number, number],
  overrides: Partial<InteractionCandidate> = {},
): InteractionCandidate {
  return {
    id,
    sourceId: "test",
    kind: "NPC",
    label: id,
    priority,
    spaceId: "EXTERIOR",
    position,
    radius: 2,
    facingDot: -1,
    losRequired: true,
    enabled: true,
    activate: () => true,
    ...overrides,
  };
}

const player = {
  position: { x: 0, y: 0, z: 0 },
  facingX: 1,
  facingZ: 0,
  spaceId: "EXTERIOR",
};

test("authored priority order resolves exactly one candidate", () => {
  const candidates = [
    candidate("flavor", INTERACTION_PRIORITIES.FLAVOR, [0.5, 0, 0]),
    candidate("inspect", INTERACTION_PRIORITIES.KNOWLEDGE, [0.6, 0, 0]),
    candidate("thread", INTERACTION_PRIORITIES.SIDE_JOB_THREAD, [0.8, 0, 0]),
    candidate("npc", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0]),
    candidate("traversal", INTERACTION_PRIORITIES.SAFETY_TRAVERSAL, [1.2, 0, 0]),
    candidate("beat", INTERACTION_PRIORITIES.BLOCKING_AUTHORED, [1.8, 0, 0]),
  ];
  const resolved = resolveInteraction({
    candidates,
    player,
    currentId: null,
    segmentClear: () => true,
  });
  assert.equal(resolved?.candidate.id, "beat");
});

test("LOS, facing, enabled, and isolated space fail closed", () => {
  const blocked = candidate("blocked", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0]);
  assert.equal(
    resolveInteraction({
      candidates: [blocked],
      player,
      currentId: null,
      segmentClear: () => false,
    }),
    null,
  );
  for (const invalid of [
    candidate("wrong-space", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0], { spaceId: "MERCER_PRESS" }),
    candidate("behind", INTERACTION_PRIORITIES.STORY_NPC, [-1, 0, 0], { facingDot: 0.2 }),
    candidate("disabled", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0], { enabled: false }),
  ]) {
    assert.equal(
      resolveInteraction({
        candidates: [invalid],
        player,
        currentId: null,
        segmentClear: () => true,
      }),
      null,
    );
  }
});

test("facing is waived at arm's reach (feel-audit-1 P1-3)", () => {
  assert.equal(INTERACTION_FACING_WAIVER_M, 0.75);
  // Standing essentially on the anchor with an off heading still offers it…
  const onAnchor = candidate("on-anchor", INTERACTION_PRIORITIES.SIDE_JOB_THREAD, [-0.5, 0, 0], { facingDot: 0.2 });
  assert.equal(
    resolveInteraction({
      candidates: [onAnchor],
      player,
      currentId: null,
      segmentClear: () => true,
    })?.candidate.id,
    "on-anchor",
  );
  // …and the NEAREST eligible wins over a farther facing-aligned twin.
  const near = candidate("near", INTERACTION_PRIORITIES.KNOWLEDGE, [-0.4, 0, 0], { facingDot: 0.2 });
  const far = candidate("far", INTERACTION_PRIORITIES.KNOWLEDGE, [1.4, 0, 0], { facingDot: 0.2 });
  assert.equal(
    resolveInteraction({
      candidates: [far, near],
      player,
      currentId: null,
      segmentClear: () => true,
    })?.candidate.id,
    "near",
  );
});

test("hysteresis keeps current peer but never masks higher priority", () => {
  const current = candidate("current", INTERACTION_PRIORITIES.STORY_NPC, [1.2, 0, 0]);
  const peer = candidate("peer", INTERACTION_PRIORITIES.STORY_NPC, [1.1, 0, 0]);
  const held = resolveInteraction({
    candidates: [current, peer],
    player,
    currentId: "current",
    segmentClear: () => true,
  });
  assert.equal(held?.candidate.id, "current");
  assert.equal(INTERACTION_HYSTERESIS_M, 0.35);

  const traversal = candidate(
    "traversal",
    INTERACTION_PRIORITIES.SAFETY_TRAVERSAL,
    [1.9, 0, 0],
  );
  const preempted = resolveInteraction({
    candidates: [current, traversal],
    player,
    currentId: "current",
    segmentClear: () => true,
  });
  assert.equal(preempted?.candidate.id, "traversal");
});

test("registry upsert and source clearing prevent stacked prompts", () => {
  const registry = createInteractionRegistry();
  registry.upsert(candidate("same", INTERACTION_PRIORITIES.FLAVOR, [1, 0, 0]));
  registry.upsert(candidate("same", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0]));
  assert.equal(registry.size, 1);
  assert.equal(registry.get("same")?.priority, INTERACTION_PRIORITIES.STORY_NPC);
  registry.clearSource("test");
  assert.equal(registry.size, 0);
});

test("generic affordance resolves discovery, approach, and action ranges", () => {
  const source = candidate(
    "source",
    INTERACTION_PRIORITIES.KNOWLEDGE,
    [7, 0, 0],
    {
      label: "Read Revenue proclamation",
      radius: 2,
      discoveryRadius: 9,
      approachRadius: 4.5,
      displayName: "Revenue proclamation",
      verb: "Read",
    },
  );
  const at = (x: number) =>
    resolveInteractionAffordance({
      candidates: [{ ...source, position: [x, 0, 0] }],
      player,
      currentId: null,
      segmentClear: () => true,
    });
  assert.equal(at(8)?.phase, "DISCOVERY");
  assert.equal(at(4)?.phase, "APPROACH");
  assert.equal(at(1.8)?.phase, "ACTION");
  assert.equal(at(9.1), null);
  assert.equal(
    resolveInteraction({
      candidates: [source],
      player,
      currentId: null,
      segmentClear: () => true,
    }),
    null,
    "the activation resolver stays action-range only",
  );
});

test("far affordances preserve LOS, priority, gating, and one-target arbitration", () => {
  const source = candidate(
    "source",
    INTERACTION_PRIORITIES.KNOWLEDGE,
    [7, 0, 0],
    { discoveryRadius: 9 },
  );
  const npc = candidate(
    "npc",
    INTERACTION_PRIORITIES.STORY_NPC,
    [8, 0, 0],
    { discoveryRadius: 11 },
  );
  const resolve = (
    candidates: InteractionCandidate[],
    clear = true,
  ) =>
    resolveInteractionAffordance({
      candidates,
      player,
      currentId: null,
      segmentClear: () => clear,
    });
  assert.equal(resolve([source, npc])?.candidate.id, "npc");
  assert.equal(resolve([source], false), null, "no indicator through walls");
  assert.equal(resolve([{ ...source, enabled: false }]), null);
  assert.equal(
    resolve([{ ...source, spaceId: "MERCER_PRESS" }]),
    null,
    "no cross-floor/space indicator",
  );
});

test("metadata defaults produce consistent verbs and bounded accessible ranges", () => {
  const npc = interactionPresentationMetadata(
    candidate("npc", INTERACTION_PRIORITIES.STORY_NPC, [1, 0, 0], {
      label: "Talk to Abigail Mercer",
    }),
  );
  assert.deepEqual(
    {
      verb: npc.verb,
      displayName: npc.displayName,
      category: npc.category,
      discoveryRadius: npc.discoveryRadius,
      approachRadius: npc.approachRadius,
    },
    {
      verb: "Talk",
      displayName: "Abigail Mercer",
      category: "Person",
      discoveryRadius: 11,
      approachRadius: 4,
    },
  );
  const oversizedAction = interactionPresentationMetadata(
    candidate("job", INTERACTION_PRIORITIES.SIDE_JOB_THREAD, [1, 0, 0], {
      label: "Deliver the barrel",
      radius: 5,
      discoveryRadius: 4,
      approachRadius: 2,
    }),
  );
  assert.equal(oversizedAction.discoveryRadius, 5);
  assert.equal(oversizedAction.approachRadius, 5);
  assert.equal(oversizedAction.verb, "Deliver");
});
