import { clamp01 } from "@pa/engine-world";
import { dawnSky } from "./dawn.js";
import type { DuelSky } from "./duelPort.js";

// ---------------------------------------------------------------------------
// The bridge from the mission's dawn clock to the duel arena's lighting.
//
// The arena lights ITSELF at a stand-alone midday, which made the cutscene→duel
// seam jump from pre-dawn to broad daylight — a continuity break worse than the
// missing cutscene was, in a mission whose whole premise is beating the sunrise.
// This is the fix the container threads through `duelPort`: the sky at the
// moment the player reached the yard, expressed in a form the arena can apply.
//
// TWO PIPELINES, ONE PICTURE. The mission stage tone-maps with the Khronos
// Neutral curve and `dawn.ts`'s light intensities are solved against it (an
// `ambient` of ~6 is right there). The duel arena tone-maps with ACES at a
// different exposure, where those numbers would be miscalibrated. So this takes
// dawn's COLOURS verbatim — a colour is a colour across tone curves, and the
// colour is what actually reads as "before dawn" versus "midday" — and expresses
// the INTENSITIES in the arena's own range (its daylight rig is hemi ~0.55, key
// ~2.1), scaled down toward the dark for an earlier arrival. The result is the
// arena's own readable pipeline wearing the mission's palette, not a second
// lighting model bolted on.
//
// Pure and deterministic: a function of the dawn lift the arrival tick produced,
// no clock and no RNG.
// ---------------------------------------------------------------------------

/**
 * The arena sky for a dawn lift in [0,1]. `lift01` is `DawnRead.lift01` at the
 * moment traversal reached the duel — pre-dawn for a mission fought before
 * sunrise, and the same value the arrival cutscene was lit at.
 */
export function missionDuelSky(lift01: number): DuelSky {
  const lift = clamp01(lift01);
  const sky = dawnSky(lift);
  return {
    // Colours straight from the shared dawn palette — identical to the sky the
    // cutscene faded from, so the two frames read as one moment.
    background: sky.sky,
    fogColor: sky.sky,
    // The arena is twelve metres across; a light fog reads as air without eating
    // the far wall the way the stand-alone day density (0.026) would in the dark.
    fogDensity: 0.02,
    hemiSky: sky.hemiSky,
    hemiGround: sky.hemiGround,
    // Arena-range intensities, dark before dawn and rising toward (but staying
    // under) the arena's own daylight level as the sky lifts — the yard at
    // arrival is greying, not golden-hour. Tuned by eye against the arena's ACES
    // pipeline and the cutscene it must be continuous with, not carried over from
    // the mission stage's Neutral one. Kept bright enough to keep the fight
    // readable: a duel you cannot see is worse than one at the wrong hour.
    hemiIntensity: 0.22 + 0.3 * lift,
    sunColor: sky.sunColour,
    sunIntensity: 0.6 + 1.65 * lift,
  };
}
