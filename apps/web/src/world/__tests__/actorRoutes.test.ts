import test from "node:test";
import assert from "node:assert/strict";
import {
  NAMED_ACTOR_ROUTES,
  actorOwner,
  actorRoutePose,
} from "../actorRoutes.js";
import { interiorPoint } from "../interiorManifest.js";

test("all five named actors have deterministic exterior routes", () => {
  assert.deepEqual(Object.keys(NAMED_ACTOR_ROUTES).sort(), [
    "abigail",
    "clarke",
    "pike",
    "rider",
    "thomas",
  ]);
  for (const id of Object.keys(NAMED_ACTOR_ROUTES) as (keyof typeof NAMED_ACTOR_ROUTES)[]) {
    assert.deepEqual(
      actorRoutePose(id, "EXTERIOR", 4567, 1765),
      actorRoutePose(id, "EXTERIOR", 4567, 1765),
    );
  }
});

test("interior actors use isolated interiorPoint coordinates", () => {
  const abigail = actorRoutePose("abigail", "MERCER_PRESS", 100, 1765);
  assert.deepEqual(
    abigail?.position,
    interiorPoint("MERCER_PRESS", NAMED_ACTOR_ROUTES.abigail.homeLocal!),
  );
  assert.equal(actorRoutePose("abigail", "PIKE_OFFICE", 100, 1765), null);
  assert.ok((abigail?.position[0] ?? 0) > 600, "interior must not use stale exterior coordinates");
});

test("scripted choreography preempts reactive ownership", () => {
  assert.equal(actorOwner(true, true), "SCRIPTED");
  assert.equal(actorOwner(false, true), "REACTIVE");
  assert.equal(actorOwner(false, false), "NONE");
});

test("route sampling changes by fixed tick and field seed only", () => {
  const a = actorRoutePose("thomas", "EXTERIOR", 1200, 7);
  const b = actorRoutePose("thomas", "EXTERIOR", 1201, 7);
  const c = actorRoutePose("thomas", "EXTERIOR", 1200, 8);
  assert.notDeepEqual(a?.position, b?.position);
  assert.notDeepEqual(a?.position, c?.position);
});
