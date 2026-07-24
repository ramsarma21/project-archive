import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  footstepStrideM,
  IDENTITY_GAIN,
  IDENTITY_ONESHOT_NAMES,
  initialAudioMuted,
} from "../ambientAudio.js";

test("sound defaults on unless the player explicitly stored mute", () => {
  assert.equal(initialAudioMuted(null), false);
  assert.equal(initialAudioMuted("0"), false);
  assert.equal(initialAudioMuted("1"), true);
});

test("footstep cadence tightens with movement speed", () => {
  assert.equal(footstepStrideM(0.8), 0.58);
  assert.equal(footstepStrideM(2.3), 0.72);
  assert.equal(footstepStrideM(4.6), 1.05);
});

test("every gameplay identity sound has gain guidance and a deployed WAV", () => {
  const root = resolve(process.cwd().endsWith("apps/web") ? "../.." : ".");
  for (const name of IDENTITY_ONESHOT_NAMES) {
    assert.ok(IDENTITY_GAIN[name] > 0, `${name} gain`);
    assert.ok(
      existsSync(
        resolve(root, `apps/web/public/audio/identity/${name}.wav`),
      ),
      `${name} WAV`,
    );
  }
});
