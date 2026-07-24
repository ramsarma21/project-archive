import test from "node:test";
import assert from "node:assert/strict";
import { qaWalkDirection } from "../Player.js";
import { questMarkerMeta } from "../questMarkerManifest.js";

test("QA walking targets current arrival anchors without teleporting", () => {
  const mercer = questMarkerMeta("MERCER_PRESS");
  assert.deepEqual(mercer?.arrivalAnchor, [-0.3099999999999999, 0, 10.61]);
  const direction = qaWalkDirection(
    [-6, 1.5],
    [mercer!.arrivalAnchor[0], mercer!.arrivalAnchor[2]],
  );
  assert.ok(direction);
  assert.ok(direction.distance > 10);
  assert.ok(direction.x > 0 && direction.z > 0);
  assert.equal(
    qaWalkDirection(
      [mercer!.arrivalAnchor[0], mercer!.arrivalAnchor[2]],
      [mercer!.arrivalAnchor[0], mercer!.arrivalAnchor[2]],
    ),
    null,
  );
});
