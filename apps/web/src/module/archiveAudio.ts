// Soft UI blips for the Archive room, synthesised at runtime.
//
// NO AUDIO ASSET, ON PURPOSE — the same approach as duel/duelAudio.ts: short
// WebAudio tones with nothing to load, decode or ship, and a safe no-op wherever
// `AudioContext` is absent (SSR, a node test, an old browser). The imported-
// visible-world rule governs visible physical props, not sound.
//
// The palette is deliberately restrained — a costly system does not chirp. A
// hover is a barely-there tick; arming a file is a short rising confirm; sealing
// (a locked file) is a low, curt refusal. All route through one master gain a
// caller can mute.

interface WindowWithAudio {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as WindowWithAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
    } catch {
      context = null;
      master = null;
      return null;
    }
  }
  // A context created before a user gesture starts suspended; the first hover or
  // click is itself the gesture, so resuming here unlocks it.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
}

/** Mute or unmute every Archive blip. */
export function setArchiveAudioMuted(value: boolean): void {
  muted = value;
}

interface BlipSpec {
  readonly freq: number;
  readonly toFreq?: number;
  readonly startGain: number;
  readonly durationS: number;
  readonly type: OscillatorType;
  readonly delayS?: number;
}

function blip(spec: BlipSpec): void {
  if (muted) return;
  const ctx = audioContext();
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (spec.delayS ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, t0);
  if (spec.toFreq !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.toFreq), t0 + spec.durationS);
  }
  gain.gain.setValueAtTime(Math.max(0.0001, spec.startGain), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.durationS);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + spec.durationS + 0.02);
}

/** A file gains focus (hover / cursor lands): a barely-there high tick. */
export function playArchiveHover(): void {
  blip({ freq: 1180, toFreq: 1480, startGain: 0.05, durationS: 0.05, type: "sine" });
}

/** A ready file is opened: a short, clean rising confirm. */
export function playArchiveOpen(): void {
  blip({ freq: 560, toFreq: 940, startGain: 0.12, durationS: 0.11, type: "triangle" });
  blip({ freq: 900, toFreq: 1320, startGain: 0.06, durationS: 0.12, type: "sine", delayS: 0.04 });
}

/** A sealed (locked) file is prodded: a low, curt refusal. */
export function playArchiveSealed(): void {
  blip({ freq: 180, toFreq: 120, startGain: 0.11, durationS: 0.12, type: "sine" });
}

/** The handoff transmits: a warmer two-note rise. */
export function playArchiveHandoff(): void {
  blip({ freq: 480, toFreq: 720, startGain: 0.12, durationS: 0.14, type: "triangle" });
  blip({ freq: 720, toFreq: 1080, startGain: 0.08, durationS: 0.16, type: "sine", delayS: 0.07 });
}
