import { test } from "node:test";
import assert from "node:assert/strict";
import { TRAVERSAL_SET } from "../traversalMarkers.js";
import {
  buildTraversalEndpoints,
  duckRequestFor,
} from "../traversalRegistration.js";
import { decideAction, selectPrompt } from "../traversalResolver.js";
import {
  beginAuthored,
  createGroundedState,
  stepMotion,
} from "../playerMotion.js";
import type { CollisionWorld } from "../collision.js";
import { CROUCH_HEIGHT, STAND_HEIGHT } from "../collision.js";

const duck = TRAVERSAL_SET.markers.find((marker) => marker.id === "NALLEY_DUCK_W");
assert.ok(duck?.zone, "stable duck marker missing");
const endpoints = buildTraversalEndpoints(TRAVERSAL_SET.markers).filter(
  (endpoint) => endpoint.affordanceId === duck.id,
);

function playerAt(
  endpoint: (typeof endpoints)[number],
  facingX: number,
  facingZ: number,
) {
  return {
    x: endpoint.pos[0],
    y: endpoint.pos[1],
    z: endpoint.pos[2],
    facingX,
    facingZ,
    speed: 0,
    velX: 0,
    velZ: 0,
    grounded: true,
    airtimeMs: 0,
  };
}

test("current-world duck marker registers both natural approaches", () => {
  assert.equal(endpoints.length, 2);
  assert.deepEqual(endpoints.map((endpoint) => endpoint.dir), [1, -1]);
  assert.ok(endpoints.every((endpoint) => endpoint.kind === "DUCK_UNDER"));
  // The laundry beam spans Z; the actor must cross it on X, not follow the
  // inaccessible long axis into the back wall/building colliders.
  assert.equal(endpoints[0]!.pos[2], endpoints[1]!.pos[2]);
  assert.notEqual(endpoints[0]!.pos[0], endpoints[1]!.pos[0]);
  assert.ok(CROUCH_HEIGHT < 1.42 && STAND_HEIGHT > 1.42);
});

test("aligned approach prompts F; misaligned approach suppresses", () => {
  const endpoint = endpoints[0]!;
  const aligned = playerAt(endpoint, endpoint.approachDirX, endpoint.approachDirZ);
  const prompt = selectPrompt(endpoints, aligned, null);
  assert.equal(prompt?.affordanceId, duck.id);
  assert.equal(
    decideAction({
      affordances: endpoints,
      player: aligned,
      prompt,
      nowMs: 1000,
      fPressedAtMs: 1000,
      fReleasedSinceAction: true,
      uiFocused: false,
      busy: false,
      actionActive: false,
      cooldownUntilMs: 0,
    }).kind,
    "AFFORDANCE",
  );

  const misaligned = playerAt(
    endpoint,
    endpoint.approachDirZ,
    -endpoint.approachDirX,
  );
  // Stand one metre back so facing is evaluated rather than waived on top.
  misaligned.x -= endpoint.approachDirX;
  misaligned.z -= endpoint.approachDirZ;
  const noPrompt = selectPrompt(endpoints, misaligned, null);
  assert.equal(noPrompt, null);
  assert.equal(
    decideAction({
      affordances: endpoints,
      player: misaligned,
      prompt: null,
      nowMs: 1000,
      fPressedAtMs: 1000,
      fReleasedSinceAction: true,
      uiFocused: false,
      busy: false,
      actionActive: false,
      cooldownUntilMs: 0,
    }).kind,
    "SUPPRESS",
  );
});

test("F duck request uses crouched capsule and completes exact safe endpoint", () => {
  const request = duckRequestFor(duck, 1);
  assert.ok(request);
  const start = request.anchors[0]!;
  const end = request.anchors.at(-1)!;
  const world: CollisionWorld = {
    blockers: [],
    platforms: [],
    bounds: { minX: -200, maxX: 200, minZ: -40, maxZ: 40 },
  };
  const initial = createGroundedState({ ...start }, 0);
  let state = beginAuthored(world, initial, request);
  assert.ok(state);
  assert.equal(state.phase, "DUCK_UNDER");
  assert.ok(state.capsuleHeight < 1);
  for (let frame = 0; frame < 500 && state.phase === "DUCK_UNDER"; frame++) {
    state = stepMotion(world, state, {
      dt: 1 / 60,
      targetVelX: 0,
      targetVelZ: 0,
      reducedMotion: false,
    }).state;
  }
  assert.equal(state.phase, "GROUNDED");
  assert.ok(Math.abs(state.pos.x - end.x) < 0.01);
  assert.ok(Math.abs(state.pos.y - end.y) < 0.01);
  assert.ok(Math.abs(state.pos.z - end.z) < 0.01);
});
