import assert from "node:assert/strict";
import { test } from "node:test";
import { PresentationNoticeArbiter } from "../../presenter/noticeArbiter.js";

test("notice arbiter prioritizes, deduplicates, and expires captions", () => {
  const arbiter = new PresentationNoticeArbiter();
  const flavor = arbiter.offer(
    {
      id: "flavor-1",
      kind: "FLAVOR",
      text: "A gull cries.",
      captions: true,
      cooldownMs: 5_000,
      durationMs: 2_000,
    },
    1_000,
  );
  assert.equal(flavor?.id, "flavor-1");
  const cinematic = arbiter.offer(
    {
      id: "release-1",
      kind: "CINEMATIC_DIALOGUE",
      speaker: "CONSTABLE",
      text: "Off with you.",
      captions: true,
      durationMs: 2_000,
    },
    1_100,
  );
  assert.equal(cinematic?.id, "release-1");
  const suppressed = arbiter.offer(
    {
      id: "ambient-1",
      kind: "AMBIENT",
      text: "Street chatter.",
      captions: true,
    },
    1_200,
  );
  assert.equal(suppressed?.id, "release-1");
  assert.equal(arbiter.current(3_200), null);

  const first = arbiter.offer(
    {
      id: "route-1",
      kind: "ROUTE_WARNING",
      text: "Use the lane.",
      captions: true,
      cooldownMs: 10_000,
    },
    4_000,
  );
  assert.equal(first?.id, "route-1");
  arbiter.clear();
  assert.equal(
    arbiter.offer(
      {
        id: "route-1",
        kind: "ROUTE_WARNING",
        text: "Use the lane.",
        captions: true,
        cooldownMs: 10_000,
      },
      4_500,
    ),
    null,
  );
});

