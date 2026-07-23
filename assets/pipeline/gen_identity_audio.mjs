// Identity-audio factory for the 1765-Boston world (World-Design-Bible §8).
//
// Composes the game's ~10 "audio identity moments" as production audio files.
// The ElevenLabs key lacks the `sound_generation` permission (see
// gen_ambient_audio.mjs), so this follows the established offline-DSP path and
// synthesizes every sound with a small period-plausible synth kit. It extends
// the technique in gen_ambient_audio.mjs (same primitives, same quality bar)
// WITHOUT modifying that script.
//
// Every output is 44.1kHz / 16-bit / mono. Beds/loops get a seamless
// end->start crossfade; one-shots are DC-blocked and normalized to peaks that
// match the existing one-shot family (church-bell 0.70, door-creak 0.55, ...).
//
// After writing, the script runs a LISTEN-CHECK: it decodes each WAV back and
// reports peak / RMS / DC-offset / duration and a coarse spectral read
// (low-band energy ratio, zero-crossing rate), then flags anything that clips,
// carries DC, or reads implausibly loud/quiet against the existing one-shots.
//
// Output:
//   apps/web/public/audio/identity/<name>.wav
//   assets/build/audio/identity-manifest.json   (written separately/by hand)
// Usage: node assets/pipeline/gen_identity_audio.mjs

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = resolve(ROOT, "apps/web/public/audio/identity");
const EXISTING_DIR = resolve(ROOT, "apps/web/public/audio");

// ---------------------------------------------------------------------------
// DSP kit (44.1kHz mono, 16-bit WAV out). Mirrors gen_ambient_audio.mjs so the
// texture and quality bar match the established beds/one-shots.
// ---------------------------------------------------------------------------
const SR = 44100;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buffer(seconds) {
  return new Float32Array(Math.round(seconds * SR));
}

function whiteInto(buf, rnd, gain = 1) {
  for (let i = 0; i < buf.length; i++) buf[i] += (rnd() * 2 - 1) * gain;
  return buf;
}

// Paul Kellet pink noise approximation.
function pink(seconds, rnd, gain = 1) {
  const out = buffer(seconds);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < out.length; i++) {
    const w = rnd() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    const p = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
    out[i] = p * 0.11 * gain;
  }
  return out;
}

function brown(seconds, rnd, gain = 1) {
  const out = buffer(seconds);
  let acc = 0;
  for (let i = 0; i < out.length; i++) {
    acc = (acc + (rnd() * 2 - 1) * 0.02) * 0.997;
    out[i] = acc * gain * 3.5;
  }
  return out;
}

function onePoleLP(buf, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y = (1 - a) * buf[i] + a * y;
    buf[i] = y;
  }
  return buf;
}

function onePoleHP(buf, cutoffHz) {
  const a = Math.exp((-2 * Math.PI * cutoffHz) / SR);
  let y = 0, xPrev = 0;
  for (let i = 0; i < buf.length; i++) {
    y = a * (y + buf[i] - xPrev);
    xPrev = buf[i];
    buf[i] = y;
  }
  return buf;
}

// RBJ constant-skirt bandpass.
function bandpass(buf, centerHz, q) {
  const w0 = (2 * Math.PI * centerHz) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = Math.sin(w0) / 2, b1 = 0, b2 = -b0;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    buf[i] = y;
  }
  return buf;
}

function addInto(target, src, atSeconds, gain = 1) {
  const at = Math.max(0, Math.round(atSeconds * SR));
  for (let i = 0; i < src.length && at + i < target.length; i++) target[at + i] += src[i] * gain;
}

function tone(seconds, freqFn, gain = 1, phase = 0) {
  const out = buffer(seconds);
  let ph = phase;
  for (let i = 0; i < out.length; i++) {
    const f = typeof freqFn === "function" ? freqFn(i / SR) : freqFn;
    ph += (2 * Math.PI * f) / SR;
    out[i] = Math.sin(ph) * gain;
  }
  return out;
}

function envAD(buf, attack, decayTau) {
  const aN = Math.max(1, Math.round(attack * SR));
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    const a = i < aN ? i / aN : 1;
    buf[i] *= a * Math.exp(-Math.max(0, t - attack) / decayTau);
  }
  return buf;
}

function gainLfo(buf, fns) {
  for (let i = 0; i < buf.length; i++) {
    const t = i / SR;
    let g = 1;
    for (const fn of fns) g *= fn(t);
    buf[i] *= g;
  }
  return buf;
}

// Remove any DC offset (brown-noise integration can build one; the existing
// cart-passby/press-shop show ~0.006-0.008 of DC). Subtract mean then a gentle
// 18Hz high-pass, which is safely below the lowest musical content (~65Hz).
function dcBlock(buf) {
  let mean = 0;
  for (let i = 0; i < buf.length; i++) mean += buf[i];
  mean /= Math.max(1, buf.length);
  for (let i = 0; i < buf.length; i++) buf[i] -= mean;
  onePoleHP(buf, 18);
  return buf;
}

function normalize(buf, peak = 0.7) {
  let max = 1e-9;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const s = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= s;
  return buf;
}

// Seamless loop: crossfade the final `fadeSeconds` into the head, then trim.
function loopify(buf, fadeSeconds = 0.6) {
  const X = Math.round(fadeSeconds * SR);
  const N = buf.length - X;
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) out[i] = buf[i];
  for (let i = 0; i < X; i++) {
    const w = i / X;
    out[i] = out[i] * w + buf[N + i] * (1 - w);
  }
  return out;
}

function writeWav(path, buf) {
  const n = buf.length;
  const bytes = new Uint8Array(44 + n * 2);
  const dv = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE");
  str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, SR, true); dv.setUint32(28, SR * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  str(36, "data"); dv.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, buf[i]));
    dv.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  writeFileSync(path, bytes);
}

// ---------------------------------------------------------------------------
// Synth recipes. Period-plausible, abstract; no voiced words anywhere.
// Each returns a Float32Array at SR. `identity` bakes in envelopes/normalize.
// ---------------------------------------------------------------------------

// A short wooden knock: noise attack exciting a ringing bandpass, plus body.
function woodKnock(rnd, centerHz, q, len, decay) {
  const k = bandpass(whiteInto(buffer(len), rnd, 1), centerHz, q);
  envAD(k, 0.0008, decay);
  return k;
}

const SYNTH = {
  // 1. press-pull-thunk (~0.5s): the "perfect pull" payoff. A low platen THUNK
  // (pitch-dropping body) + hard contact knock + a slight frame creak tail.
  "press-pull-thunk": () => {
    const rnd = mulberry32(4101);
    const out = buffer(0.55);
    // Body thunk: quick pitch drop from ~96Hz, dense low sine + a touch of 2nd.
    const body = tone(0.42, (t) => 96 - 42 * Math.min(1, t / 0.18), 1);
    const body2 = tone(0.42, (t) => 192 - 80 * Math.min(1, t / 0.18), 0.28);
    for (let i = 0; i < body.length; i++) body[i] += body2[i];
    envAD(body, 0.003, 0.09);
    addInto(out, body, 0.02, 1);
    // Platen contact knock: broadband attack tightly bandpassed around wood.
    addInto(out, woodKnock(rnd, 820, 2.2, 0.06, 0.018), 0.02, 0.85);
    addInto(out, woodKnock(rnd, 1650, 3, 0.04, 0.01), 0.02, 0.3);
    // Frame creak tail: short rising resonant stick-slip after the seat.
    const creak = tone(0.24, (t) => 210 + 120 * t + 10 * Math.sin(2 * Math.PI * 11 * t), 0.5);
    bandpass(creak, 300, 3.2);
    envAD(creak, 0.03, 0.12);
    addInto(out, creak, 0.16, 0.28);
    dcBlock(out);
    return normalize(out, 0.72);
  },

  // 2. paper-snap (~0.4s): crisp sheet peel then a snap. High-passed noise with
  // a fast crackle front and a bright transient release.
  "paper-snap": () => {
    const rnd = mulberry32(4202);
    const out = buffer(0.4);
    // Peel: brief rising HF crackle (rustle of the sheet lifting).
    const peel = onePoleHP(whiteInto(buffer(0.16), rnd, 1), 2600);
    gainLfo(peel, [(t) => (0.4 + 0.6 * t / 0.16)]);
    // granular crackle so it reads like fibre, not hiss
    for (let i = 0; i < peel.length; i++) peel[i] *= 0.5 + 0.5 * (rnd() < 0.3 ? 1 : 0.2);
    envAD(peel, 0.006, 0.09);
    addInto(out, peel, 0.0, 0.5);
    // Snap: sharp broadband transient with HF emphasis + tiny body.
    const snap = onePoleHP(whiteInto(buffer(0.09), rnd, 1), 1500);
    envAD(snap, 0.0006, 0.02);
    const snapBody = woodKnock(rnd, 2400, 1.6, 0.05, 0.012);
    addInto(out, snap, 0.17, 0.9);
    addInto(out, snapBody, 0.17, 0.5);
    dcBlock(out);
    return normalize(out, 0.62);
  },

  // 3. ink-dab (two variants, ~0.3s each): soft double-tap of a leather ink
  // ball on the metal type. Leather = damped lowpassed thud; metal = a faint,
  // very short ring. Two taps ("dab-dab").
  "ink-dab": (seed) => {
    const rnd = mulberry32(seed);
    const out = buffer(0.32);
    const tap = (at, pitch) => {
      // Leather contact: lowpassed noise puff (soft, no bright edge).
      const puff = onePoleLP(whiteInto(buffer(0.09), rnd, 1), 900);
      envAD(puff, 0.002, 0.03);
      addInto(out, puff, at, 0.6);
      // Metal type ring: faint high resonance, tightly damped.
      const ring = bandpass(whiteInto(buffer(0.05), rnd, 1), pitch, 8);
      envAD(ring, 0.0008, 0.012);
      addInto(out, ring, at, 0.18);
      // Soft body so the dab has weight.
      const body = tone(0.06, 150, 0.5);
      envAD(body, 0.003, 0.025);
      addInto(out, body, at, 0.35);
    };
    tap(0.02, 2100 + rnd() * 400);
    tap(0.15 + rnd() * 0.02, 1900 + rnd() * 400);
    dcBlock(out);
    return normalize(out, 0.5);
  },

  // 4. chase-drum-layer (~8s seamless loop): tense heartbeat drum keyed to
  // HUNTED. A lub-dub every second (60bpm, taut), low membrane hits. Tiles 8s
  // exactly so the loop crossfade lands in the quiet gap.
  "chase-drum-layer": () => {
    const rnd = mulberry32(4404);
    const total = 8.3; // 8.0 loop + 0.3 crossfade tail
    const out = buffer(total);
    // Membrane hit: pitch-dropping low sine + soft noise skin + short body.
    const hit = (at, gain, pitch) => {
      const skin = tone(0.28, (t) => pitch - pitch * 0.35 * Math.min(1, t / 0.05), 1);
      const skin2 = tone(0.28, (t) => pitch * 1.5 - pitch * 0.4 * Math.min(1, t / 0.05), 0.22);
      for (let i = 0; i < skin.length; i++) skin[i] += skin2[i];
      envAD(skin, 0.004, 0.075);
      addInto(out, skin, at, gain);
      const thud = onePoleLP(whiteInto(buffer(0.05), rnd, 1), 240);
      envAD(thud, 0.002, 0.03);
      addInto(out, thud, at, gain * 0.4);
    };
    // 8 heartbeats, one per second: strong "lub" then softer "dub" +0.3s.
    for (let beat = 0; beat < 9; beat++) {
      const t0 = beat * 1.0;
      hit(t0, 1.0, 78);
      hit(t0 + 0.3, 0.62, 70);
    }
    // Very low tension drone under it (keeps the loop from feeling empty).
    const drone = tone(total, 41.5, 0.12);
    bandpass(drone, 42, 0.7);
    gainLfo(drone, [(t) => 0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t)]);
    for (let i = 0; i < out.length; i++) out[i] += drone[i];
    dcBlock(out);
    normalize(out, 0.62);
    return loopify(out, 0.3); // -> exactly 8.0s
  },

  // 5. crowd-swell-sting (~4s): procession start. Crowd murmur rises to a
  // shout, capped by a fife phrase + drum sting.
  "crowd-swell-sting": () => {
    const rnd = mulberry32(4505);
    const sec = 4.0;
    const out = buffer(sec);
    // Crowd walla: band-limited rumble that swells over ~3s.
    const crowd = bandpass(brown(sec, rnd, 1), 500, 0.55);
    gainLfo(crowd, [
      (t) => 0.18 + 0.82 * Math.min(1, (t / 3.0) ** 1.5),
      (t) => 0.82 + 0.18 * Math.sin(2 * Math.PI * 0.7 * t),
    ]);
    // wordless voice blips scattered, denser as it swells
    for (let t = 0.2; t < 3.2; t += 0.12 + rnd() * 0.18) {
      const dens = Math.min(1, t / 3.0);
      const blip = bandpass(whiteInto(buffer(0.1 + rnd() * 0.14), rnd, 1), 360 + rnd() * 520, 2.4);
      envAD(blip, 0.02, 0.08);
      addInto(crowd, blip, t, (0.1 + rnd() * 0.12) * dens);
    }
    for (let i = 0; i < out.length; i++) out[i] += crowd[i] * 0.9;
    // Shout peak at ~2.9s: broadband crowd surge.
    const shout = bandpass(pink(0.7, rnd, 1), 700, 0.9);
    gainLfo(shout, [(t) => Math.max(0, Math.sin(Math.PI * t / 0.7)) ** 1.3]);
    addInto(out, shout, 2.85, 0.5);
    // Fife phrase over the sting: reedy square-ish tone, 3 notes.
    const fife = (at, f, len) => {
      const n = tone(len, f, 1);
      const n3 = tone(len, f * 3, 0.16); // odd harmonic -> reedy
      for (let i = 0; i < n.length; i++) n[i] = (n[i] + n3[i]) * 0.5;
      bandpass(n, f, 6);
      envAD(n, 0.02, len * 0.5);
      addInto(out, n, at, 0.3);
    };
    fife(3.0, 1046, 0.26); // C6
    fife(3.28, 1318, 0.24); // E6
    fife(3.52, 1568, 0.42); // G6
    // Drum sting: two martial hits under the fife.
    const drum = (at) => {
      const d = tone(0.2, (t) => 120 - 40 * Math.min(1, t / 0.04), 1);
      envAD(d, 0.003, 0.05);
      const sn = onePoleHP(whiteInto(buffer(0.12), rnd, 1), 1400);
      envAD(sn, 0.002, 0.05);
      addInto(out, d, at, 0.5);
      addInto(out, sn, at, 0.18);
    };
    drum(3.0);
    drum(3.5);
    dcBlock(out);
    return normalize(out, 0.66);
  },

  // 6. bell-toll-daylight (~3s + tail): a deep single toll, distinct from the
  // brighter G4 church-bell. Lower strike (A2 ~110Hz) with dark inharmonic
  // partials, per daylight unit spent.
  "bell-toll-daylight": () => {
    const sec = 3.0;
    const f0 = 110; // A2 - a full two octaves below the church-bell G4
    const parts = [
      [0.5, 0.55, 2.6], [1.0, 0.9, 2.2], [1.183, 0.55, 1.7], [1.506, 0.32, 1.2],
      [2.0, 0.42, 0.9], [2.66, 0.18, 0.55], [3.01, 0.1, 0.35],
    ];
    const out = buffer(sec);
    const rnd = mulberry32(4606);
    for (const [ratio, g, tau] of parts) {
      const det = 1 + (rnd() - 0.5) * 0.004;
      const p = tone(sec, f0 * ratio * det, g);
      envAD(p, 0.003, tau);
      for (let i = 0; i < out.length; i++) out[i] += p[i];
      // slow beating partner for a living, breathing tail
      const beat = tone(sec, f0 * ratio * det * 1.0028, g * 0.5);
      envAD(beat, 0.003, tau * 0.85);
      for (let i = 0; i < out.length; i++) out[i] += beat[i];
    }
    // Soft mallet strike (dark, not the bright church clang).
    const strike = bandpass(whiteInto(buffer(0.06), rnd, 1), 1400, 2.2);
    envAD(strike, 0.001, 0.02);
    addInto(out, strike, 0, 0.4);
    dcBlock(out);
    return normalize(out, 0.7);
  },

  // 7. quill-scratch (two variants, ~0.8s each): quill on paper for Archive
  // filing. Filtered noise strokes with fast amplitude jitter (fibre drag).
  "quill-scratch": (seed) => {
    const rnd = mulberry32(seed);
    const sec = 0.8;
    const out = buffer(sec);
    // Base drag: bandpassed noise with rapid AM to read as scratchy strokes.
    const drag = bandpass(whiteInto(buffer(sec), rnd, 1), 2600, 1.4);
    gainLfo(drag, [
      // three quick strokes with pen-lift gaps
      (t) => {
        const p = (t % 0.27) / 0.27;
        const stroke = Math.max(0, Math.sin(Math.PI * Math.min(1, p / 0.7))) ** 1.2;
        return t < sec - 0.05 ? stroke : 0;
      },
      // fine fibre jitter
      (t) => 0.55 + 0.45 * Math.sin(2 * Math.PI * (140 + 40 * Math.sin(2 * Math.PI * 7 * t)) * t),
    ]);
    for (let i = 0; i < out.length; i++) out[i] += drag[i] * 0.8;
    // Discrete nib ticks along the strokes.
    for (let t = 0.02; t < sec - 0.05; t += 0.012 + rnd() * 0.02) {
      const tick = bandpass(whiteInto(buffer(0.01), rnd, 1), 3200 + rnd() * 2200, 6);
      envAD(tick, 0.0004, 0.004);
      const p = (t % 0.27) / 0.27;
      const strokeGate = p < 0.7 ? 1 : 0.15;
      addInto(out, tick, t, (0.12 + rnd() * 0.1) * strokeGate);
    }
    dcBlock(out);
    return normalize(out, 0.42);
  },

  // 8. coin-clink (~0.4s): small coin/pouch clink for stake/receipt moments.
  // Two-three bright metallic pings + a soft pouch settle.
  "coin-clink": () => {
    const rnd = mulberry32(4808);
    const out = buffer(0.4);
    const ping = (at, f, gain) => {
      // two close inharmonic partials = small coin
      const a = tone(0.18, f, 1);
      const b = tone(0.18, f * 1.94, 0.5);
      const c = tone(0.18, f * 2.7, 0.25);
      for (let i = 0; i < a.length; i++) a[i] = a[i] + b[i] + c[i];
      bandpass(a, f, 9);
      envAD(a, 0.0006, 0.05);
      addInto(out, a, at, gain);
    };
    ping(0.0, 3400 + rnd() * 400, 0.7);
    ping(0.05 + rnd() * 0.02, 4200 + rnd() * 500, 0.55);
    ping(0.12 + rnd() * 0.03, 3800 + rnd() * 500, 0.4);
    // Soft pouch/cloth settle underneath.
    const pouch = onePoleLP(whiteInto(buffer(0.14), rnd, 1), 500);
    envAD(pouch, 0.004, 0.05);
    addInto(out, pouch, 0.0, 0.25);
    dcBlock(out);
    return normalize(out, 0.55);
  },

  // 9. constable-whistle (~1s): sharp period watchman's pea-whistle blast.
  // Strong ~2.4kHz tone with a fast pea-rattle warble + breath, hard attack.
  "constable-whistle": () => {
    const rnd = mulberry32(4909);
    const sec = 1.0;
    const out = buffer(sec);
    // Whistle body: near-sine with slight overblow harmonic, rising pitch.
    const body = tone(sec, (t) => 2380 + 60 * Math.min(1, t / 0.05) + 40 * Math.sin(2 * Math.PI * 6 * t), 1);
    const over = tone(sec, (t) => (2380 + 60 * Math.min(1, t / 0.05)) * 2.01, 0.16);
    for (let i = 0; i < body.length; i++) body[i] += over[i];
    // Blast envelope: sharp attack, a strong hold, then a taper over the tail
    // (a real whistle blast decays as breath runs out — it is not flat-loud).
    const blastEnv = (t) => {
      const attack = Math.min(1, t / 0.012);
      if (t > 0.82) return attack * Math.max(0, 1 - (t - 0.82) / 0.18);
      // gentle decay across the hold so RMS reads in the one-shot family
      return attack * (1 - 0.35 * Math.min(1, (t - 0.05) / 0.75));
    };
    // pea-rattle AM (fast trill ~28Hz) with deep gaps, like a real pea whistle
    gainLfo(body, [
      (t) => blastEnv(t) * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 28 * t)) ** 1.4),
    ]);
    for (let i = 0; i < out.length; i++) out[i] += body[i] * 0.8;
    // Breath/air hiss shaped to the same envelope, bandpassed high.
    const air = bandpass(whiteInto(buffer(sec), rnd, 1), 2600, 1.1);
    gainLfo(air, [(t) => blastEnv(t)]);
    for (let i = 0; i < out.length; i++) out[i] += air[i] * 0.14;
    dcBlock(out);
    return normalize(out, 0.62);
  },

  // 10. cheer-short (~2s): small crowd cheer burst for effigy participation.
  // Fast rise, a "huzzah" swell, quick decay; a couple of bright whoops.
  "cheer-short": () => {
    const rnd = mulberry32(5010);
    const sec = 2.0;
    const out = buffer(sec);
    // Crowd body: vowel-ish bandpassed noise with a burst envelope.
    const crowd = bandpass(brown(sec, rnd, 1), 620, 0.7);
    gainLfo(crowd, [
      (t) => {
        const rise = Math.min(1, t / 0.18) ** 0.8;
        const fall = t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 1.3) ** 1.2 : 1;
        return rise * fall;
      },
      (t) => 0.8 + 0.2 * Math.sin(2 * Math.PI * 1.1 * t),
    ]);
    // formant lift so it reads as open "ah" voices, not rumble
    const bright = bandpass(pink(sec, rnd, 1), 1100, 0.9);
    gainLfo(bright, [(t) => (Math.min(1, t / 0.15) * (t > 0.5 ? Math.max(0, 1 - (t - 0.5) / 1.4) : 1)) ** 1.1]);
    for (let i = 0; i < out.length; i++) out[i] += crowd[i] * 0.8 + bright[i] * 0.35;
    // A few bright whoops riding the top.
    for (let k = 0; k < 5; k++) {
      const at = 0.1 + rnd() * 0.5;
      const f = 700 + rnd() * 500;
      const whoop = tone(0.4, (t) => f * (1 + 0.3 * Math.min(1, t / 0.2)), 1);
      bandpass(whoop, f * 1.2, 3);
      envAD(whoop, 0.03, 0.18);
      addInto(out, whoop, at, 0.12 + rnd() * 0.08);
    }
    dcBlock(out);
    return normalize(out, 0.64);
  },
};

// ---------------------------------------------------------------------------
// Sound catalogue -> variants. `loop` gets loopify (already applied inside the
// recipe for the drum layer, which needs exact-length tiling).
// ---------------------------------------------------------------------------
const SOUNDS = [
  { name: "press-pull-thunk", loop: false },
  { name: "paper-snap", loop: false },
  { name: "ink-dab", loop: false, variants: [{ suffix: "-1", seed: 4303 }, { suffix: "-2", seed: 4353 }] },
  { name: "chase-drum-layer", loop: true, preLooped: true },
  { name: "crowd-swell-sting", loop: false },
  { name: "bell-toll-daylight", loop: false },
  { name: "quill-scratch", loop: false, variants: [{ suffix: "-1", seed: 4707 }, { suffix: "-2", seed: 4757 }] },
  { name: "coin-clink", loop: false },
  { name: "constable-whistle", loop: false },
  { name: "cheer-short", loop: false },
];

// ---------------------------------------------------------------------------
// LISTEN-CHECK: decode a written WAV and report peak/RMS/DC/duration + a coarse
// spectral read (low-band <500Hz energy fraction, zero-crossing rate). Flags
// clipping, DC, and implausible loudness vs the existing one-shot family.
// ---------------------------------------------------------------------------
function readWavMono(path) {
  const b = readFileSync(path);
  const sr = b.readUInt32LE(24);
  let off = 12, dataOff = 44, dataLen = b.length - 44;
  while (off + 8 <= b.length) {
    const id = b.toString("ascii", off, off + 4);
    const sz = b.readUInt32LE(off + 4);
    if (id === "data") { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  const n = Math.floor(dataLen / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(dataOff + i * 2) / 32768;
  return { sr, data: out };
}

function analyze(path) {
  const { sr, data } = readWavMono(path);
  const n = data.length;
  let peak = 0, sumSq = 0, dc = 0, zc = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    const v = data[i];
    const a = Math.abs(v);
    peak = Math.max(peak, a);
    sumSq += v * v;
    dc += v;
    if (a >= 0.999) clipped++;
    if (i > 0 && ((data[i - 1] < 0 && v >= 0) || (data[i - 1] >= 0 && v < 0))) zc++;
  }
  const rms = Math.sqrt(sumSq / Math.max(1, n));
  // low-band energy fraction via a lowpass copy at 500Hz
  const lp = new Float32Array(data);
  onePoleLP(lp, 500);
  let lowSq = 0;
  for (let i = 0; i < n; i++) lowSq += lp[i] * lp[i];
  const lowRatio = lowSq / Math.max(1e-12, sumSq);
  return {
    sr,
    durationSec: n / sr,
    peak,
    rms,
    dc: dc / Math.max(1, n),
    zcrHz: (zc / 2) / (n / sr),
    lowRatio,
    clippedSamples: clipped,
  };
}

// Existing one-shot RMS band (measured): church-bell 0.108, gull 0.073,
// cart 0.119, dog 0.048, door 0.142. Identity one-shots should read in a
// comparable 0.03..0.20 window; the layerable drum loop is intentionally lower.
const RMS_MIN = 0.03;
const RMS_MAX = 0.22;

// ---------------------------------------------------------------------------
mkdirSync(OUT_DIR, { recursive: true });

const jobs = [];
for (const spec of SOUNDS) {
  if (spec.variants) {
    for (const v of spec.variants) {
      jobs.push({ ...spec, file: `${spec.name}${v.suffix}.wav`, arg: v.seed });
    }
  } else {
    jobs.push({ ...spec, file: `${spec.name}.wav`, arg: undefined });
  }
}

console.log(`\nSynthesizing ${jobs.length} identity sounds -> ${OUT_DIR}\n`);
const results = [];
for (const job of jobs) {
  let pcm = SYNTH[job.name](job.arg);
  if (job.loop && !job.preLooped) pcm = loopify(pcm, 0.4);
  const path = resolve(OUT_DIR, job.file);
  writeWav(path, pcm);
  const a = analyze(path);
  const flags = [];
  if (a.clippedSamples > 0) flags.push(`CLIP(${a.clippedSamples})`);
  if (Math.abs(a.dc) > 0.005) flags.push(`DC(${a.dc.toFixed(4)})`);
  if (a.rms < RMS_MIN) flags.push(`QUIET(${a.rms.toFixed(3)})`);
  if (a.rms > RMS_MAX && !job.loop) flags.push(`LOUD(${a.rms.toFixed(3)})`);
  if (a.peak > 0.95) flags.push(`HOT(${a.peak.toFixed(3)})`);
  results.push({ file: job.file, ...a, flags });
  const tag = flags.length ? `  ⚠ ${flags.join(" ")}` : "  ok";
  console.log(
    `${job.file.padEnd(24)} ${a.durationSec.toFixed(2)}s  ` +
    `peak ${a.peak.toFixed(3)}  rms ${a.rms.toFixed(4)}  dc ${a.dc.toFixed(5)}  ` +
    `low ${(a.lowRatio * 100).toFixed(0)}%  zcr ${a.zcrHz.toFixed(0)}Hz${tag}`,
  );
}

const anyFlags = results.some((r) => r.flags.length);
console.log(`\n${jobs.length} files written. ${anyFlags ? "SOME CHECKS FLAGGED (see ⚠ above)" : "All listen-checks passed."}`);
console.log(`SR=${SR}  dir=${OUT_DIR}`);
