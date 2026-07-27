import type { ModuleBeatAudio } from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The module's voiceover seam.
//
// The lesson is narrated. Today the narration is spoken by the browser's own
// speech synthesiser over the authored beat text; tomorrow it is pre-rendered
// audio from an external provider (ElevenLabs), addressed by authored cue id.
// This file is the seam that lets the second replace the first WITHOUT the
// player changing: the player talks to a `ModuleVoiceoverController` and never
// to `speechSynthesis` directly.
//
// Three rules the seam enforces:
//
//   Never block. Reading and advancing must work when there is no voice at all
//   — a headless test, a browser without speech, a muted learner. An
//   unavailable provider is a controller whose methods are safe no-ops, not a
//   throw and not a spinner.
//
//   Subtitles are the source of truth, audio is the decoration. Completion and
//   card advancement are the learner's and the visual timeline's; the voice
//   only offers cue callbacks so a caller CAN keep the subtitle in step with
//   real audio when it wants to. It is never the thing that finishes a card.
//
//   Cleanup is total. Leaving, unmounting, and every card change stop the
//   voice, so a stale utterance can never talk over the next card.
//
// No key, URL, or network call is added here. The external seam is a type and
// a place to plug one in, and the default provider is browser speech.
// ---------------------------------------------------------------------------

/** One thing to say: the beat's stable cue id and its verbatim text. */
export interface ModuleVoiceoverUtterance {
  cueId: string;
  text: string;
  /** Authored external-audio cue, ignored by the browser-speech provider. */
  audio?: ModuleBeatAudio;
}

/** Optional callbacks so a caller can track the voice against the subtitle. */
export interface ModuleVoiceoverHandlers {
  onBeatStart?(cueId: string, index: number): void;
  onBeatEnd?(cueId: string, index: number): void;
  onComplete?(): void;
}

/**
 * A live voiceover session. `play` speaks a card's beats in order; the rest are
 * the learner's transport controls. Every method is safe to call in any state,
 * including on an unavailable provider.
 */
export interface ModuleVoiceoverController {
  /** True when a real voice will actually be produced. */
  readonly available: boolean;
  play(utterances: readonly ModuleVoiceoverUtterance[], handlers?: ModuleVoiceoverHandlers): void;
  pause(): void;
  resume(): void;
  /** Cancels the current utterance and clears the queue. Fires no callbacks. */
  stop(): void;
  /** Silences audio without ending the lesson. Muting mid-utterance stops it. */
  setMuted(muted: boolean): void;
  readonly muted: boolean;
}

/**
 * A provider builds fresh controllers. The default is browser speech; an
 * external-audio provider (future) would implement this to stream authored
 * audio addressed by `utterance.audio`.
 */
export interface ModuleVoiceoverProvider {
  create(): ModuleVoiceoverController;
}

/** The no-voice controller. Every method is a safe no-op. Used in tests and
 * whenever the platform offers no speech. Reading is never blocked by it. */
export function silentVoiceoverController(): ModuleVoiceoverController {
  let muted = false;
  return {
    available: false,
    play: () => {},
    pause: () => {},
    resume: () => {},
    stop: () => {},
    setMuted: (next: boolean) => {
      muted = next;
    },
    get muted() {
      return muted;
    },
  };
}

/** Picks a sensible English voice, preferring a local one if the list has any. */
function pickEnglishVoice(
  synth: SpeechSynthesis,
): SpeechSynthesisVoice | null {
  const voices = synth.getVoices();
  if (voices.length === 0) return null;
  const english = voices.filter((voice) => /^en(-|$)/i.test(voice.lang));
  const pool = english.length > 0 ? english : voices;
  return pool.find((voice) => voice.localService) ?? pool[0] ?? null;
}

/**
 * The browser-speech controller.
 *
 * It speaks each utterance as a separate `SpeechSynthesisUtterance` so that a
 * per-beat `onstart`/`onend` can drive the cue callbacks. A monotonically
 * increasing token guards against a late event from a cancelled run: after
 * `stop`, `play`, or a mute, the token moves and any older utterance's callback
 * is ignored, which is the whole defence against a stale voice talking over the
 * next card.
 */
function speechSynthesisController(synth: SpeechSynthesis): ModuleVoiceoverController {
  let token = 0;
  let muted = false;
  let voice: SpeechSynthesisVoice | null = null;

  function refreshVoice(): void {
    if (!voice) voice = pickEnglishVoice(synth);
  }
  // Voices can arrive asynchronously in some browsers.
  refreshVoice();
  if (typeof synth.addEventListener === "function") {
    synth.addEventListener("voiceschanged", refreshVoice);
  }

  function cancel(): void {
    token += 1;
    try {
      synth.cancel();
    } catch {
      /* some engines throw if nothing is speaking; harmless */
    }
  }

  return {
    available: true,
    play(utterances, handlers) {
      cancel();
      if (muted || utterances.length === 0) return;
      const run = token;
      refreshVoice();
      utterances.forEach((utterance, index) => {
        const speech = new SpeechSynthesisUtterance(utterance.text);
        if (voice) speech.voice = voice;
        speech.lang = voice?.lang ?? "en-US";
        speech.rate = 1;
        speech.pitch = 1;
        speech.onstart = () => {
          if (run !== token) return;
          handlers?.onBeatStart?.(utterance.cueId, index);
        };
        speech.onend = () => {
          if (run !== token) return;
          handlers?.onBeatEnd?.(utterance.cueId, index);
          if (index === utterances.length - 1) handlers?.onComplete?.();
        };
        synth.speak(speech);
      });
    },
    pause() {
      try {
        synth.pause();
      } catch {
        /* harmless */
      }
    },
    resume() {
      try {
        synth.resume();
      } catch {
        /* harmless */
      }
    },
    stop() {
      cancel();
    },
    setMuted(next: boolean) {
      muted = next;
      // Muting mid-utterance silences immediately; the visual timeline carries
      // on, so the lesson is not paused, only quieted.
      if (next) cancel();
    },
    get muted() {
      return muted;
    },
  };
}

/**
 * A provider over a specific SpeechSynthesis instance. Exposed so a test can
 * inject a fake synth and assert the stop/cancel and card-change behaviour
 * without a browser. Requires `SpeechSynthesisUtterance` to exist globally.
 */
export function browserVoiceoverProvider(
  synth: SpeechSynthesis,
): ModuleVoiceoverProvider {
  return { create: () => speechSynthesisController(synth) };
}

/**
 * The default provider. Browser speech when the platform offers it, the silent
 * controller otherwise — so a caller gets a working controller unconditionally.
 */
export function defaultModuleVoiceoverProvider(): ModuleVoiceoverProvider {
  return {
    create() {
      const synth =
        typeof window !== "undefined" ? window.speechSynthesis : undefined;
      if (!synth || typeof SpeechSynthesisUtterance === "undefined") {
        return silentVoiceoverController();
      }
      return speechSynthesisController(synth);
    },
  };
}
