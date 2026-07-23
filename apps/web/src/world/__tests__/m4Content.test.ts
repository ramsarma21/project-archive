import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  M4_ACTIVITY_ANCHORS,
  M4_EAVESDROPS,
  M4_KNOWLEDGE,
} from "../m4ContentManifest.js";
import {
  DENSITY_PLACEMENTS,
  TRAVERSAL_AFFORDANCES,
} from "../densityManifest.js";
import { DENSITY_TRAVERSAL_TYPE_STATUS } from "../densityTraversalAdapter.js";
import { WATCHERS } from "../stealthManifest.js";
import { headCamBeat } from "../FirstPersonCamera.js";

test("M4 knowledge and ambient scope is complete and stable", () => {
  const ids = new Set(M4_KNOWLEDGE.map((entry) => entry.id));
  for (const id of [
    "KN-noticeboard-revenue",
    "KN-noticeboard-stamp",
    "KN-liberty-bill",
    "KN-nonimport",
    "KN-townmeeting",
    "KN-noconsent",
    "KN-wharfage",
    "KN-sign-printer",
    "KN-sign-tavern",
    "KN-sign-baker",
    "KN-sign-chandler",
    "KN-watchhouse",
    "KN-coinpaper",
    "KN-typecase",
    "KN-effigy",
  ]) {
    assert.ok(ids.has(id), `missing ${id}`);
  }
  assert.equal(M4_EAVESDROPS.length, 4);
  // 8 = the M4 seven + the ropewalk trades job (slice activity-family pillar).
  assert.equal(Object.keys(M4_ACTIVITY_ANCHORS).length, 8);
});

test("minimal roof route uses two imported supports without unsupported F verbs", () => {
  const boards = DENSITY_PLACEMENTS.filter((entry) =>
    entry.tags.includes("roof-route"),
  );
  assert.deepEqual(
    boards.map((entry) => entry.glb).sort(),
    ["roof-walk-board", "roof-walk-board-long"],
  );
  assert.equal(
    TRAVERSAL_AFFORDANCES.some((entry) =>
      entry.placementId.startsWith("m4-roof-board"),
    ),
    false,
  );
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.BALANCE, "DISABLED");
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.MANTLE, "DISABLED");
  assert.equal(DENSITY_TRAVERSAL_TYPE_STATUS.JUMP_GAP, "DISABLED");
});

test("production constables preserve the exact watcher roster", () => {
  assert.equal(WATCHERS.length, 4);
  assert.equal(new Set(WATCHERS.map((watcher) => watcher.id)).size, 4);
  const watcherSource = readFileSync(
    new URL("../WatcherDirector.tsx", import.meta.url),
    "utf8",
  );
  const chaseSource = readFileSync(
    new URL("../ChaseDirector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(watcherSource, /glbKey="constable-rigged"/);
  assert.match(chaseSource, /glbKey="constable-rigged"/);
  assert.doesNotMatch(watcherSource, /glbKey="officer-rigged"/);
  assert.doesNotMatch(chaseSource, /glbKey="officer-rigged"/);
});

test("B11 touched code contains no procedural event physical kit", () => {
  const eventSource = readFileSync(
    new URL("../EventDirector.tsx", import.meta.url),
    "utf8",
  );
  const rigsSource = readFileSync(
    new URL("../MechanicRigs.tsx", import.meta.url),
    "utf8",
  );
  for (const primitive of [
    "boxGeometry",
    "cylinderGeometry",
    "sphereGeometry",
    "capsuleGeometry",
    "<Text",
  ]) {
    assert.equal(eventSource.includes(primitive), false, primitive);
    assert.equal(rigsSource.includes(primitive), false, primitive);
  }
});

test("compound print uses the imported named ink tools on synthetic hands", () => {
  for (const promptId of [
    "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
    "BOS.MD01.ACT.PIKE_REPRINT.v1",
    "BOS.MD01.ACT.FINAL_PRESS_PULL.v1",
  ]) {
    assert.equal(
      headCamBeat(promptId, promptId),
      false,
      `${promptId} must keep first-person hand attachments visible`,
    );
  }
  const bytes = readFileSync(
    new URL(
      "../../../public/world/props/printer-ink-balls.glb",
      import.meta.url,
    ),
  );
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(
    bytes.subarray(20, 20 + jsonLength).toString("utf8"),
  ) as { nodes?: { name?: string }[] };
  const names = new Set((json.nodes ?? []).map((node) => node.name));
  for (const name of [
    "InkBall_Left",
    "InkBall_Left_grip",
    "InkBall_Left_rock",
    "InkSurface_Left",
    "InkBall_Right",
    "InkBall_Right_grip",
    "InkBall_Right_rock",
    "InkSurface_Right",
  ]) {
    assert.ok(names.has(name), `ink asset missing ${name}`);
  }
  const inkSource = readFileSync(
    new URL("../PrinterInkBalls.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    inkSource,
    /(box|sphere|cylinder|capsule|plane)Geometry/,
  );
});
