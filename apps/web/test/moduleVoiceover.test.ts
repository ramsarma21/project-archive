import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserVoiceoverProvider,
  defaultModuleVoiceoverProvider,
  silentVoiceoverController,
} from "../src/module/moduleVoiceover.js";

// The voiceover seam must never block reading, must stop totally on a card
// change or unmount, and must never let a stale utterance talk over the next
// card. These drive a fake SpeechSynthesis to assert exactly that.

interface FakeUtterance {
  text: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
}

class FakeSpeechSynthesisUtterance {
  text: string;
  voice: unknown = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

function fakeSynth() {
  const spoken: FakeUtterance[] = [];
  let cancels = 0;
  const synth = {
    spoken,
    cancels: () => cancels,
    getVoices: () => [{ lang: "en-US", localService: true, name: "Test", default: true }],
    addEventListener: () => {},
    speak: (u: FakeUtterance) => spoken.push(u),
    cancel: () => {
      cancels += 1;
    },
    pause: () => {},
    resume: () => {},
  };
  return synth as unknown as SpeechSynthesis & { spoken: FakeUtterance[]; cancels: () => number };
}

function withUtterance<T>(run: () => T): T {
  const prior = (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
  (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
    FakeSpeechSynthesisUtterance;
  try {
    return run();
  } finally {
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = prior;
  }
}

test("the silent controller no-ops and never blocks", () => {
  const controller = silentVoiceoverController();
  assert.equal(controller.available, false);
  // None of these throw or do anything observable.
  controller.play([{ cueId: "a", text: "x" }]);
  controller.pause();
  controller.resume();
  controller.setMuted(true);
  assert.equal(controller.muted, true);
  controller.stop();
});

test("the default provider falls back to silent with no speechSynthesis", () => {
  // In the node test runner there is no window.speechSynthesis.
  const controller = defaultModuleVoiceoverProvider().create();
  assert.equal(controller.available, false);
});

test("play speaks each beat and fires cue callbacks in order", () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const controller = browserVoiceoverProvider(synth).create();
    const started: number[] = [];
    let completed = 0;
    controller.play(
      [
        { cueId: "a", text: "first" },
        { cueId: "b", text: "second" },
      ],
      {
        onBeatStart: (_id, i) => started.push(i),
        onComplete: () => {
          completed += 1;
        },
      },
    );
    assert.equal(synth.spoken.length, 2);
    // Drive the fake engine's events.
    synth.spoken[0]!.onstart?.();
    synth.spoken[0]!.onend?.();
    synth.spoken[1]!.onstart?.();
    synth.spoken[1]!.onend?.();
    assert.deepEqual(started, [0, 1]);
    assert.equal(completed, 1);
  });
});

test("stop cancels and a late event from the cancelled run never fires", () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const controller = browserVoiceoverProvider(synth).create();
    let completed = 0;
    controller.play([{ cueId: "a", text: "first" }], {
      onComplete: () => {
        completed += 1;
      },
    });
    const stale = synth.spoken[0]!;
    controller.stop();
    assert.ok(synth.cancels() >= 1, "stop cancels the engine");
    // A late onend arriving after stop must be ignored — no talking over the
    // next card, no phantom completion.
    stale.onend?.();
    assert.equal(completed, 0);
  });
});

test("a card change (new play) cancels the previous card's speech", () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const controller = browserVoiceoverProvider(synth).create();
    controller.play([{ cueId: "a", text: "first card" }]);
    const beforeCancels = synth.cancels();
    controller.play([{ cueId: "b", text: "second card" }]);
    assert.ok(synth.cancels() > beforeCancels, "the new card cancelled the old speech");
    assert.equal(synth.spoken.at(-1)!.text, "second card");
  });
});

test("muting stops current speech and suppresses new speech", () => {
  withUtterance(() => {
    const synth = fakeSynth();
    const controller = browserVoiceoverProvider(synth).create();
    controller.play([{ cueId: "a", text: "audible" }]);
    const spokenBefore = synth.spoken.length;
    controller.setMuted(true);
    assert.equal(controller.muted, true);
    controller.play([{ cueId: "b", text: "should be silent" }]);
    assert.equal(synth.spoken.length, spokenBefore, "nothing new is spoken while muted");
  });
});
