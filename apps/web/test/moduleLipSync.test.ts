import { test } from "node:test";
import assert from "node:assert/strict";
import {
  JAW_OPEN_MAX,
  SPEECH_HEAD_PITCH_MAX,
  advanceSpeechClock,
  defaultLipSyncProvider,
  sampleLipSync,
  speechJawInfluence,
  type SpeechAlignment,
} from "../src/module/moduleLipSync.js";

// HONEST NOTE, pinned as a test: the presenter mesh carries exactly ONE facial
// control — a `jawOpen` morph target (a restrained lower-lip/chin/jaw drop, the
// only honest motion its closed-skin topology allows). This is broad jaw/mouth
// motion driven deterministically from the cue, NOT phoneme-accurate viseme
// sync. These pin the seam + the mouth-drive mapping so a future ElevenLabs
// alignment drives the same shape.

const provider = defaultLipSyncProvider();

test("a spoken cue becomes a timeline of timed visemes", () => {
  const tl = provider.timelineFor({ cueId: "c1", text: "The debt came first." });
  assert.ok(tl.durationMs > 0, "the timeline has a real duration");
  assert.ok(tl.frames.length > 1, "the timeline has frames");
  // Frames are non-decreasing in time so the sampler can walk them.
  for (let i = 1; i < tl.frames.length; i += 1) {
    assert.ok(tl.frames[i]!.tMs >= tl.frames[i - 1]!.tMs, "frames advance in time");
  }
  // Every aperture is a real 0..1 value.
  for (const frame of tl.frames) {
    assert.ok(frame.openness >= 0 && frame.openness <= 1, `openness out of range: ${frame.openness}`);
  }
});

test("openness varies between open and closed across a cue", () => {
  const tl = provider.timelineFor({ cueId: "c1", text: "Boston elects nobody in Parliament." });
  let maxOpen = 0;
  let minOpen = 1;
  for (let t = 0; t <= tl.durationMs; t += 20) {
    const { openness } = sampleLipSync(tl, t);
    maxOpen = Math.max(maxOpen, openness);
    minOpen = Math.min(minOpen, openness);
  }
  assert.ok(maxOpen > 0.5, "a vowel opens the mouth");
  assert.ok(minOpen < 0.2, "a closure/pause shuts it");
});

test("sampling is deterministic and clamps outside the cue", () => {
  const tl = provider.timelineFor({ cueId: "c1", text: "Not one member." });
  assert.deepEqual(sampleLipSync(tl, 40), sampleLipSync(tl, 40), "same t, same sample");
  // Before the start and after the end, the mouth is closed at rest.
  assert.equal(sampleLipSync(tl, -100).viseme, "REST");
  const past = sampleLipSync(tl, tl.durationMs + 5000);
  assert.ok(past.openness <= 0.05, "the cue ends closed");
});

test("openness interpolates between frames rather than stepping", () => {
  const tl = provider.timelineFor({ cueId: "c1", text: "ao" });
  // Between the two vowel frames the aperture is a blend, never a hard jump.
  const first = tl.frames[0]!;
  const second = tl.frames[1]!;
  const mid = (first.tMs + second.tMs) / 2;
  const between = sampleLipSync(tl, mid).openness;
  const lo = Math.min(first.openness, second.openness);
  const hi = Math.max(first.openness, second.openness);
  assert.ok(between >= lo - 1e-9 && between <= hi + 1e-9, "interpolated within the pair");
});

test("real alignment drives the same timeline shape (the ElevenLabs seam)", () => {
  // A provider handed per-character timings must produce a timeline the same
  // sampler reads — no player or renderer change when audio alignment lands.
  const alignment: SpeechAlignment = {
    characters: ["h", "e", "l", "l", "o"],
    startTimesMs: [0, 80, 160, 220, 300],
    endTimesMs: [80, 160, 220, 300, 420],
  };
  const tl = provider.timelineFor({ cueId: "c1", text: "hello", alignment });
  assert.equal(tl.durationMs, 420, "duration comes from the alignment, not the text estimate");
  assert.ok(tl.frames.length >= 3, "alignment produced timed frames");
  const open = sampleLipSync(tl, 90); // on the 'e'
  assert.ok(open.openness > 0.3, "a vowel span reads open under real timings");
});

test("the speech clock only advances while speaking (deterministic pause/resume)", () => {
  let clock = 0;
  clock = advanceSpeechClock(clock, 16, true);
  assert.ok(clock > 0, "speaking advances the clock");
  const paused = advanceSpeechClock(clock, 16, false);
  assert.equal(paused, clock, "a paused frame (or a check interruption) freezes it");
  const resumed = advanceSpeechClock(paused, 16, true);
  assert.ok(resumed > paused, "resume continues from exactly where it stopped");
});

test("a stalled frame cannot fast-forward the mouth", () => {
  const clock = advanceSpeechClock(0, 100_000, true);
  assert.ok(clock <= 250, `a huge delta is clamped, got ${clock}`);
});

test("the head accent is tiny by construction (a cadence on top of the mouth)", () => {
  // The mouth is the jaw morph; the head nod is only a sub-degree accent.
  assert.ok(SPEECH_HEAD_PITCH_MAX > 0 && SPEECH_HEAD_PITCH_MAX < 0.02, "accent is < ~1 degree");
});

test("speaking drives a nonzero, capped jaw influence from a vowel", () => {
  const tl = provider.timelineFor({ cueId: "c1", text: "Boston" });
  // Find the peak openness across the cue (a vowel).
  let peak = 0;
  for (let t = 0; t <= tl.durationMs; t += 10) {
    peak = Math.max(peak, sampleLipSync(tl, t).openness);
  }
  const jaw = speechJawInfluence(peak, { speaking: true, reducedMotion: false });
  assert.ok(jaw > 0, "a spoken vowel opens the jaw");
  assert.ok(jaw <= JAW_OPEN_MAX + 1e-9, "the driven influence is capped below the full pose");
});

test("silence, pause and a check interruption close the mouth (zero jaw)", () => {
  // Even at a high sampled openness, not-speaking (paused / interrupted /
  // between cues) must drive the jaw to 0 so the mouth closes, not freeze open.
  assert.equal(speechJawInfluence(0.9, { speaking: false, reducedMotion: false }), 0);
  assert.equal(speechJawInfluence(0.0, { speaking: true, reducedMotion: false }), 0);
});

test("reduced motion holds the mouth shut", () => {
  assert.equal(speechJawInfluence(0.9, { speaking: true, reducedMotion: true }), 0);
});

test("the jaw influence clamps its input into range", () => {
  assert.equal(speechJawInfluence(-1, { speaking: true, reducedMotion: false }), 0);
  assert.equal(speechJawInfluence(5, { speaking: true, reducedMotion: false }), JAW_OPEN_MAX);
});
