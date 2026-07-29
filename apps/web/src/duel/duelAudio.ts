// Synthesised combat-feedback sounds for the duel.
//
// NO AUDIO ASSET, ON PURPOSE. These are short WebAudio tones generated at runtime,
// so there is nothing to load, decode, or ship, and the imported-visible-world rule
// does not apply (it governs visible physical props, not sound). A no-op anywhere
// `AudioContext` is absent — SSR, a node test, an old browser — so importing this
// file is always safe and never throws.
//
// TWO CUES, AND THE SPLIT IS THE SAME COLOUR LANGUAGE THE VFX USES. A confirmed hit
// on the OPPONENT — your shot landing — is a bright, short, rising "tick": the
// classic hitmarker sound, and per the owner the single biggest "I felt that"
// signal, which is why its absence read as nothing happening. Damage TAKEN by the
// player is a duller, lower thud, so the ear tells you who got hit exactly as the
// yellow/red of the burst tells the eye. Nothing here reads or changes game state.

interface WindowWithAudio {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let context: AudioContext | null = null;
let master: GainNode | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as WindowWithAudio;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      context = null;
      master = null;
      return null;
    }
  }
  // A context created before a user gesture starts suspended. A duel is click-driven
  // — you click to fire — so by the time a ball lands the first shot's gesture has
  // already unlocked it; resuming here covers the case where it has not.
  if (context.state === "suspended") void context.resume().catch(() => {});
  return context;
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
  const ctx = audioContext();
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + (spec.delayS ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = spec.type;
  osc.frequency.setValueAtTime(spec.freq, t0);
  if (spec.toFreq !== undefined) {
    // Exponential ramps cannot reach 0, so both endpoints are clamped above it.
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.toFreq), t0 + spec.durationS);
  }
  gain.gain.setValueAtTime(Math.max(0.0001, spec.startGain), t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.durationS);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + spec.durationS + 0.02);
}

/** The hitmarker "tick": a bright, rising confirmation that YOUR shot connected. */
export function playHitConfirm(): void {
  blip({ freq: 880, toFreq: 1500, startGain: 0.28, durationS: 0.06, type: "triangle" });
  blip({ freq: 1320, toFreq: 1760, startGain: 0.16, durationS: 0.07, type: "square", delayS: 0.03 });
}

/** Damage TAKEN by the player: a duller, lower thud, distinct from the confirm tick. */
export function playDamageTaken(): void {
  blip({ freq: 200, toFreq: 90, startGain: 0.3, durationS: 0.16, type: "sine" });
  blip({ freq: 130, toFreq: 70, startGain: 0.16, durationS: 0.2, type: "triangle" });
}
