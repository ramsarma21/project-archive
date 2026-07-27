import { beatDurationMs } from "./moduleTimeline.js";
import type { ModuleBeatAudio } from "./moduleFormat.js";

// ---------------------------------------------------------------------------
// The lip-sync seam (pure, unit-testable).
//
// HONEST RIG NOTE. The published `system-presenter-rigged.glb` carries a
// standard humanoid skeleton (Hips, Spine, neck, Head) and, as of the facial
// pass, exactly ONE facial morph target: `jawOpen`. It was added by the
// reproducible Blender step assets/pipeline/add_presenter_face_rig.py, which
// was authored against the INSPECTED mesh: the head is a single closed skin
// (lips are a textured seam on a continuous surface, no mouth cavity, no
// teeth), so an anatomically open mouth would tear the surface or expose a
// hole. `jawOpen` is therefore a restrained JAW DROP — the lower lip, chin and
// jaw underside rotate down/back about a hinge while the nose, upper lip,
// cheeks, eyes, forehead and hair stay put. That is broad jaw/mouth motion, NOT
// phoneme-perfect viseme sync, and it is the honest motion this topology can
// carry. The renderer drives `jawOpen` from `openness` below.
//
// What this file is, then, is the SEAM plus the mapping onto that one control:
//
//   1. A provider/timeline contract. A `LipSyncProvider` turns a spoken cue
//      into a `LipSyncTimeline` of timed visemes. Today the default provider
//      derives that timeline deterministically from the cue TEXT. When real
//      ElevenLabs audio + character alignment is wired later, a provider that
//      reads `cue.alignment` drives the SAME timeline shape — the player and
//      the renderer never change.
//
//   2. A pure sampler. `sampleLipSync` reads an openness (0..1) and the active
//      viseme at a time, with linear coarticulation between frames, that maps
//      straight onto the `jawOpen` morph influence (see `speechJawInfluence`).
//
//   3. A deterministic speech clock. `advanceSpeechClock` only accrues time
//      while speaking, so pausing, a mastery-check interruption, replay and
//      seek are all deterministic: the motion freezes and resumes exactly.
//
// The viseme labels are carried for a future asset with distinct mouth shapes;
// today only `openness` is used, mapped to the jaw and to a tiny head accent.
// ---------------------------------------------------------------------------

/** The maximum head-pitch accent, in radians (~0.7°), a spoken beat may add.
 * Deliberately tiny: a speaking cadence on top of the mouth, not the mouth. */
export const SPEECH_HEAD_PITCH_MAX = 0.012;

/** The glTF morph target name the facial pass added to the presenter mesh. */
export const JAW_OPEN_MORPH = "jawOpen";

/**
 * Ceiling on the `jawOpen` morph influence. The shape key's full (1.0) pose is
 * a wide-open jaw; capping the driven influence well below it keeps speech in
 * the believable, non-grotesque range confirmed by close-up QA (a vowel opens
 * the mouth clearly without the over-long chin the full pose shows).
 */
export const JAW_OPEN_MAX = 0.6;

/**
 * Map a sampled `openness` (0..1) to the target `jawOpen` morph influence.
 *
 * Pure and deterministic so the mouth-drive contract is unit-testable without a
 * canvas: speaking maps openness to a capped influence; silence, a paused/
 * interrupted clock (`speaking=false`) and reduced motion all drive it to 0 so
 * the mouth closes rather than freezing half-open. The renderer smooths toward
 * this target for coarticulation; this returns the steady-state target.
 */
export function speechJawInfluence(
  openness: number,
  opts: { speaking: boolean; reducedMotion: boolean },
): number {
  if (opts.reducedMotion || !opts.speaking) return 0;
  const clamped = Math.max(0, Math.min(1, openness));
  return clamped * JAW_OPEN_MAX;
}

/** A coarse viseme vocabulary. Enough to map onto a future mouth; not IPA. */
export type Viseme =
  | "REST" // closed / silence
  | "AI" // open front (a, i)
  | "E" // mid front (e)
  | "O" // rounded (o)
  | "U" // rounded closed (u)
  | "MBP" // bilabial closure (m, b, p)
  | "FV" // labiodental (f, v)
  | "CONS"; // generic consonant

/** One timed viseme sample. `openness` is the jaw/mouth aperture 0..1. */
export interface VisemeFrame {
  readonly tMs: number;
  readonly openness: number;
  readonly viseme: Viseme;
}

/** A cue's full viseme track. `frames` are strictly increasing in `tMs`. */
export interface LipSyncTimeline {
  readonly cueId: string;
  readonly durationMs: number;
  readonly frames: readonly VisemeFrame[];
}

/**
 * Real audio alignment, as an external provider (ElevenLabs) would deliver it:
 * one entry per character with its start/end in milliseconds. Present on the
 * seam now so a future integration attaches it to the cue; unused by the
 * text-only default provider.
 */
export interface SpeechAlignment {
  readonly characters: readonly string[];
  readonly startTimesMs: readonly number[];
  readonly endTimesMs: readonly number[];
}

/** A cue to speak: its stable id, verbatim text, and optional future timings. */
export interface LipSyncCue {
  readonly cueId: string;
  readonly text: string;
  /** Overrides the text-estimated duration when known (e.g. real audio length). */
  readonly durationMs?: number;
  readonly audio?: ModuleBeatAudio;
  /** Real per-character alignment, when a provider has it. */
  readonly alignment?: SpeechAlignment;
}

/** Builds a viseme timeline for a cue. The seam an ElevenLabs provider fills. */
export interface LipSyncProvider {
  timelineFor(cue: LipSyncCue): LipSyncTimeline;
}

/** Classify a single character into a viseme + its aperture. */
function classifyChar(char: string): { viseme: Viseme; openness: number } {
  const c = char.toLowerCase();
  if (/[aiàáâ]/.test(c)) return { viseme: "AI", openness: 0.9 };
  if (/[e]/.test(c)) return { viseme: "E", openness: 0.6 };
  if (/[o]/.test(c)) return { viseme: "O", openness: 0.72 };
  if (/[u]/.test(c)) return { viseme: "U", openness: 0.5 };
  if (/[y]/.test(c)) return { viseme: "E", openness: 0.5 };
  if (/[mbp]/.test(c)) return { viseme: "MBP", openness: 0.05 };
  if (/[fv]/.test(c)) return { viseme: "FV", openness: 0.22 };
  if (/[a-z]/.test(c)) return { viseme: "CONS", openness: 0.32 };
  return { viseme: "REST", openness: 0 };
}

/**
 * A frame per non-space character, spread evenly across the duration. A run of
 * spaces/punctuation collapses to a single REST frame, which is the pause
 * between words. Deterministic: the same text always yields the same track.
 */
function framesFromText(text: string, durationMs: number): VisemeFrame[] {
  const chars = [...text];
  if (chars.length === 0) return [];
  // The cue begins closed (mouth shut before the first sound) and ends closed.
  const frames: VisemeFrame[] = [{ tMs: 0, openness: 0, viseme: "REST" }];
  const step = durationMs / (chars.length + 1);
  let lastWasRest = true;
  chars.forEach((char, index) => {
    const { viseme, openness } = classifyChar(char);
    const isRest = viseme === "REST";
    // Collapse consecutive silence into one frame so gaps read as pauses.
    if (isRest && lastWasRest) return;
    lastWasRest = isRest;
    frames.push({ tMs: Math.round((index + 1) * step), openness, viseme });
  });
  frames.push({ tMs: Math.round(durationMs), openness: 0, viseme: "REST" });
  return frames;
}

/** Builds a timeline from real alignment: one aperture per character span. */
function framesFromAlignment(alignment: SpeechAlignment): VisemeFrame[] {
  const { characters, startTimesMs, endTimesMs } = alignment;
  const frames: VisemeFrame[] = [{ tMs: 0, openness: 0, viseme: "REST" }];
  let lastWasRest = true;
  characters.forEach((char, index) => {
    const { viseme, openness } = classifyChar(char);
    const isRest = viseme === "REST";
    if (isRest && lastWasRest) return;
    lastWasRest = isRest;
    frames.push({ tMs: Math.round(startTimesMs[index] ?? 0), openness, viseme });
  });
  frames.push({ tMs: Math.round(endTimesMs.at(-1) ?? 0), openness: 0, viseme: "REST" });
  return frames;
}

/**
 * The default provider. Uses real alignment when a cue carries it (the future
 * ElevenLabs path), and otherwise derives a deterministic timeline from the cue
 * text at the module's own reading rate. Either way it returns a `LipSyncTimeline`
 * the renderer samples identically.
 */
export function defaultLipSyncProvider(): LipSyncProvider {
  return {
    timelineFor(cue: LipSyncCue): LipSyncTimeline {
      const durationMs = cue.durationMs ?? beatDurationMs(cue.text);
      if (cue.alignment && cue.alignment.characters.length > 0) {
        const frames = framesFromAlignment(cue.alignment);
        const end = cue.alignment.endTimesMs.at(-1) ?? durationMs;
        return { cueId: cue.cueId, durationMs: end, frames };
      }
      return { cueId: cue.cueId, durationMs, frames: framesFromText(cue.text, durationMs) };
    },
  };
}

/**
 * Sample the openness (0..1) and active viseme at a time within a timeline.
 *
 * Openness is linearly interpolated between the surrounding frames — the coarse
 * coarticulation that keeps the aperture from stepping — and clamped into range.
 * Before the first frame and after the last it reads closed (REST).
 */
export function sampleLipSync(
  timeline: LipSyncTimeline,
  tMs: number,
): { openness: number; viseme: Viseme } {
  const { frames } = timeline;
  if (frames.length === 0) return { openness: 0, viseme: "REST" };
  const t = Math.max(0, Math.min(tMs, timeline.durationMs));
  if (t <= frames[0]!.tMs) return { openness: frames[0]!.openness, viseme: frames[0]!.viseme };
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1]!;
    const next = frames[i]!;
    if (t <= next.tMs) {
      const span = next.tMs - prev.tMs;
      const f = span > 0 ? (t - prev.tMs) / span : 0;
      const openness = prev.openness + (next.openness - prev.openness) * f;
      // The viseme is the frame we are heading INTO once past the midpoint.
      const viseme = f < 0.5 ? prev.viseme : next.viseme;
      return { openness: Math.max(0, Math.min(1, openness)), viseme };
    }
  }
  const last = frames.at(-1)!;
  return { openness: Math.max(0, Math.min(1, last.openness)), viseme: last.viseme };
}

/**
 * Advance a speech clock by one frame.
 *
 * Time accrues ONLY while speaking, and a single frame is clamped so a stall
 * cannot fast-forward the mouth. This is what makes pause, a mastery-check
 * interruption, and resume deterministic: a paused frame adds nothing and the
 * clock continues from exactly where it stopped.
 */
export function advanceSpeechClock(
  clockMs: number,
  dtMs: number,
  speaking: boolean,
): number {
  if (!speaking) return clockMs;
  const step = Math.max(0, Math.min(dtMs, 250));
  return clockMs + step;
}
