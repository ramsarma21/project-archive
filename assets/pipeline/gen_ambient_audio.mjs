// Ambient audio factory for the 1765-Boston world (World-Design-Bible §8).
//
// For each sound below it tries the ElevenLabs sound-generation API
// (ELEVENLABS_API_KEY in .env; POST /v1/sound-generation {text,
// duration_seconds<=22, prompt_influence} -> mp3). If the call fails (the
// current key is missing the `sound_generation` permission and returns 401)
// it synthesizes a period-plausible fallback with a small offline DSP kit and
// writes a WAV instead, so the audio system always ships with real files.
// Re-running the script upgrades synth files to ElevenLabs takes when the key
// gains the permission (pass --force to regenerate everything).
//
// Output: apps/web/public/audio/<name>.(mp3|wav) + manifest.json
// Usage: node assets/pipeline/gen_ambient_audio.mjs [--force] [--synth-only]

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_DIR = resolve(ROOT, "apps/web/public/audio");
const FORCE = process.argv.includes("--force");
const SYNTH_ONLY = process.argv.includes("--synth-only");

function envKey() {
  try {
    const env = readFileSync(resolve(ROOT, ".env"), "utf8");
    const m = env.match(/^ELEVENLABS_API_KEY=(.+)$/m);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sound catalogue. `loop: true` beds get a seamless end->start crossfade.
// Every duration stays <= 22s (ElevenLabs cap, and keeps the payload light).
// ---------------------------------------------------------------------------
const SOUNDS = [
  {
    name: "street-murmur",
    seconds: 18,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: 1765 colonial town street crowd walla, low murmur of many distant voices, no distinct words, occasional footsteps on packed earth, period market town, no music, no modern sounds",
  },
  {
    name: "market-clatter",
    seconds: 16,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: colonial market stalls, wooden crates set down, barrels shifted, cloth awnings flapping lightly, occasional clink of pottery and hand tools, sparse, no voices, no music",
  },
  {
    name: "harbor-lap",
    seconds: 20,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: small colonial harbor, water lapping against timber pilings and wooden hulls, slow rigging rope creak, distant halyard knock, gentle wavelets, no voices, no music, no engine",
  },
  {
    name: "wind-gusts",
    seconds: 18,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: low coastal wind gusting softly over rooftops and through narrow streets, occasional whistle around timber eaves, smooth airy noise, no voices, no music",
  },
  {
    name: "rain-bed",
    seconds: 16,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: light steady drizzle on wooden shingle roofs and packed earth street, soft rain patter, occasional drips from eaves, no thunder, no voices, no music",
  },
  {
    name: "room-tone",
    seconds: 16,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: quiet 18th century timber room interior, muffled street murmur through small windows, faint floorboard creaks, low hearth crackle, cozy room tone, no voices, no music",
  },
  {
    name: "press-shop",
    seconds: 14,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: colonial printing shop, slow rhythmic wooden hand press thumps every few seconds, paper rustle, wooden frame squeak, quiet workshop room tone between pulls, no voices, no music",
  },
  {
    name: "church-hush",
    seconds: 18,
    loop: true,
    kind: "bed",
    prompt:
      "seamless loop ambience: hushed stone church interior, airy silence with soft reverberant air, very faint distant town sounds through thick walls, occasional pew wood settle, reverent quiet, no voices, no music",
  },
  {
    name: "church-bell",
    seconds: 6,
    loop: false,
    kind: "oneshot",
    prompt:
      "single church bell toll, large bronze bell struck once, long warm decaying resonance, 18th century meeting house bell, no other sounds",
  },
  {
    name: "gull-cry",
    seconds: 3,
    loop: false,
    kind: "oneshot",
    prompt: "two seagull cries overhead, harbor gull calling, clear and close, no other sounds",
  },
  {
    name: "cart-passby",
    seconds: 7,
    loop: false,
    kind: "oneshot",
    prompt:
      "wooden horse cart passing by on a packed earth and cobble street, wheel rumble and rattle approaching then fading, slow horse hooves, 18th century, no voices",
  },
  {
    name: "dog-bark",
    seconds: 2,
    loop: false,
    kind: "oneshot",
    prompt: "medium dog barking twice in the distance on a town street, natural outdoor echo, no other sounds",
  },
  {
    name: "door-creak",
    seconds: 2,
    loop: false,
    kind: "oneshot",
    prompt: "heavy wooden colonial door opening with a slow hinge creak and a soft latch clack, close, no other sounds",
  },
];

// ---------------------------------------------------------------------------
// Offline DSP kit (22.05kHz mono, 16-bit WAV out)
// ---------------------------------------------------------------------------
const SR = 22050;

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

function normalize(buf, peak = 0.72) {
  let max = 1e-9;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  const s = peak / max;
  for (let i = 0; i < buf.length; i++) buf[i] *= s;
  return buf;
}

// Seamless loop: crossfade the final `fadeSeconds` into the head, then trim.
function loopify(buf, fadeSeconds = 1.2) {
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
// Fallback synth recipes (period-plausible, abstract; no voices anywhere).
// ---------------------------------------------------------------------------
const SYNTH = {
  "street-murmur": (sec) => {
    const rnd = mulberry32(101);
    // Crowd walla: band-limited rumble with slow uneven swell, plus soft
    // wordless "voice" blips (bandpassed noise bursts) scattered through.
    const bed = bandpass(brown(sec, rnd, 1), 520, 0.55);
    gainLfo(bed, [
      (t) => 0.78 + 0.22 * Math.sin(2 * Math.PI * 0.11 * t + 1.2),
      (t) => 0.85 + 0.15 * Math.sin(2 * Math.PI * 0.043 * t),
    ]);
    for (let t = 0.3; t < sec - 0.6; t += 0.35 + rnd() * 1.1) {
      const blip = bandpass(whiteInto(buffer(0.12 + rnd() * 0.22), rnd, 1), 380 + rnd() * 520, 2.2);
      envAD(blip, 0.03, 0.09);
      addInto(bed, blip, t, 0.16 + rnd() * 0.1);
    }
    return normalize(bed, 0.6);
  },
  "market-clatter": (sec) => {
    const rnd = mulberry32(202);
    const bed = bandpass(brown(sec, rnd, 0.7), 480, 0.6);
    gainLfo(bed, [(t) => 0.5 + 0.15 * Math.sin(2 * Math.PI * 0.07 * t)]);
    // Wood knocks: noise attack exciting a ringing bandpass.
    for (let t = 0.4; t < sec - 0.5; t += 0.5 + rnd() * 1.6) {
      const knock = bandpass(whiteInto(buffer(0.16), rnd, 1), 640 + rnd() * 1500, 9);
      envAD(knock, 0.002, 0.05 + rnd() * 0.05);
      addInto(bed, knock, t, 0.5 + rnd() * 0.4);
      if (rnd() < 0.3) {
        const scrape = bandpass(whiteInto(buffer(0.3), rnd, 1), 1400 + rnd() * 900, 3);
        envAD(scrape, 0.06, 0.14);
        addInto(bed, scrape, t + 0.12, 0.14);
      }
    }
    return normalize(bed, 0.55);
  },
  "harbor-lap": (sec) => {
    const rnd = mulberry32(303);
    // Wave laps: lowpassed noise with rhythmic swell; drips; rope creak.
    const water = onePoleLP(whiteInto(buffer(sec), rnd, 1), 620);
    gainLfo(water, [
      (t) => 0.42 + 0.4 * Math.max(0, Math.sin(2 * Math.PI * 0.24 * t)) ** 1.6,
      (t) => 0.8 + 0.2 * Math.sin(2 * Math.PI * 0.052 * t + 0.7),
    ]);
    for (let t = 0.8; t < sec - 0.4; t += 1.1 + rnd() * 2.2) {
      const drip = bandpass(whiteInto(buffer(0.06), rnd, 1), 2100 + rnd() * 1400, 12);
      envAD(drip, 0.001, 0.02);
      addInto(water, drip, t, 0.1 + rnd() * 0.08);
    }
    for (let t = 1.5; t < sec - 1.4; t += 3.4 + rnd() * 3.4) {
      // Rigging creak: slow resonant sweep with stick-slip jitter.
      const creak = tone(0.9, (tt) => 96 + 70 * tt + 14 * Math.sin(2 * Math.PI * 13 * tt), 0.55);
      bandpass(creak, 220, 3.2);
      envAD(creak, 0.12, 0.3);
      addInto(water, creak, t, 0.5);
    }
    return normalize(water, 0.6);
  },
  "wind-gusts": (sec) => {
    const rnd = mulberry32(404);
    const wind = pink(sec, rnd, 1);
    bandpass(wind, 430, 0.5);
    gainLfo(wind, [
      (t) => 0.5 + 0.5 * Math.max(0, Math.sin(2 * Math.PI * 0.06 * t + 0.4)) ** 1.4,
      (t) => 0.72 + 0.28 * Math.sin(2 * Math.PI * 0.145 * t + 2.1),
    ]);
    const whistle = bandpass(pink(sec, rnd, 0.8), 1150, 7);
    gainLfo(whistle, [(t) => Math.max(0, Math.sin(2 * Math.PI * 0.05 * t + 1.4)) ** 4]);
    for (let i = 0; i < wind.length; i++) wind[i] += whistle[i] * 0.14;
    return normalize(wind, 0.55);
  },
  "rain-bed": (sec) => {
    const rnd = mulberry32(505);
    const hiss = onePoleLP(onePoleHP(whiteInto(buffer(sec), rnd, 1), 900), 5600);
    gainLfo(hiss, [(t) => 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.09 * t)]);
    for (let t = 0.1; t < sec - 0.2; t += 0.08 + rnd() * 0.5) {
      const drop = bandpass(whiteInto(buffer(0.05), rnd, 1), 1600 + rnd() * 2600, 8);
      envAD(drop, 0.001, 0.015);
      addInto(hiss, drop, t, 0.12 + rnd() * 0.14);
    }
    return normalize(hiss, 0.5);
  },
  "room-tone": (sec) => {
    const rnd = mulberry32(606);
    const air = onePoleLP(brown(sec, rnd, 0.8), 240);
    const street = bandpass(brown(sec, rnd, 0.7), 420, 0.6);
    onePoleLP(street, 340);
    gainLfo(street, [(t) => 0.5 + 0.2 * Math.sin(2 * Math.PI * 0.08 * t)]);
    for (let i = 0; i < air.length; i++) air[i] = air[i] * 0.8 + street[i] * 0.25;
    // Hearth crackle + floor creaks.
    for (let t = 0.3; t < sec - 0.3; t += 0.25 + rnd() * 0.9) {
      const pop = bandpass(whiteInto(buffer(0.03), rnd, 1), 1900 + rnd() * 1800, 6);
      envAD(pop, 0.001, 0.012);
      addInto(air, pop, t, 0.05 + rnd() * 0.06);
    }
    for (let t = 2.5; t < sec - 1; t += 4 + rnd() * 4) {
      const creak = tone(0.5, (tt) => 130 + 90 * tt, 0.4);
      bandpass(creak, 200, 4);
      envAD(creak, 0.08, 0.16);
      addInto(air, creak, t, 0.35);
    }
    return normalize(air, 0.42);
  },
  "press-shop": (sec) => {
    const rnd = mulberry32(707);
    const room = onePoleLP(brown(sec, rnd, 0.7), 300);
    for (let i = 0; i < room.length; i++) room[i] *= 0.5;
    // Platen pull cycle every ~2.4s: lever squeak, THUMP, paper rustle.
    for (let t = 0.6; t < sec - 1.2; t += 2.4) {
      const squeak = tone(0.35, (tt) => 420 - 160 * tt, 0.4);
      bandpass(squeak, 380, 6);
      envAD(squeak, 0.05, 0.1);
      addInto(room, squeak, t, 0.3);
      const thump = tone(0.5, (tt) => 88 - 26 * tt, 1);
      envAD(thump, 0.004, 0.11);
      addInto(room, thump, t + 0.42, 0.95);
      const knockAttack = bandpass(whiteInto(buffer(0.05), rnd, 1), 900, 2);
      envAD(knockAttack, 0.001, 0.02);
      addInto(room, knockAttack, t + 0.42, 0.4);
      const rustle = onePoleHP(whiteInto(buffer(0.5), rnd, 1), 1800);
      envAD(rustle, 0.09, 0.16);
      addInto(room, rustle, t + 1.15, 0.1);
    }
    return normalize(room, 0.6);
  },
  "church-hush": (sec) => {
    const rnd = mulberry32(808);
    const air = onePoleLP(pink(sec, rnd, 1), 480);
    gainLfo(air, [(t) => 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.035 * t)]);
    const drone = tone(sec, 64.5, 0.12);
    const drone2 = tone(sec, 97, 0.05);
    for (let i = 0; i < air.length; i++) air[i] = air[i] * 0.4 + drone[i] + drone2[i];
    for (let t = 4; t < sec - 1; t += 5.5 + rnd() * 4) {
      const settle = bandpass(whiteInto(buffer(0.2), rnd, 1), 500 + rnd() * 400, 5);
      envAD(settle, 0.01, 0.07);
      addInto(air, settle, t, 0.1);
    }
    return normalize(air, 0.34);
  },
  "church-bell": (sec) => {
    // Inharmonic bronze bell partials over a G4-ish strike.
    const f0 = 392;
    const parts = [
      [0.5, 0.5, 5.2], [1.0, 0.8, 3.6], [1.188, 0.62, 2.7], [1.53, 0.34, 1.9],
      [2.0, 0.5, 1.35], [2.74, 0.2, 0.8], [3.02, 0.12, 0.55], [4.17, 0.06, 0.3],
    ];
    const out = buffer(sec);
    const rnd = mulberry32(909);
    for (const [ratio, g, tau] of parts) {
      const det = 1 + (rnd() - 0.5) * 0.004;
      const p = tone(sec, f0 * ratio * det, g);
      envAD(p, 0.002, tau);
      for (let i = 0; i < out.length; i++) out[i] += p[i];
      const beat = tone(sec, f0 * ratio * det * 1.0035, g * 0.5);
      envAD(beat, 0.002, tau * 0.85);
      for (let i = 0; i < out.length; i++) out[i] += beat[i];
    }
    const clang = bandpass(whiteInto(buffer(0.05), rnd, 1), 3200, 2.5);
    envAD(clang, 0.001, 0.014);
    addInto(out, clang, 0, 0.8);
    return normalize(out, 0.7);
  },
  "gull-cry": (sec) => {
    const out = buffer(sec);
    const cry = (at, len, base) => {
      const c = buffer(len);
      let ph = 0;
      for (let i = 0; i < c.length; i++) {
        const t = i / SR;
        const u = t / len;
        const f = base * (1.12 - 0.38 * u) + 55 * Math.sin(2 * Math.PI * 31 * t);
        ph += (2 * Math.PI * f) / SR;
        c[i] = (Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) * 0.5;
      }
      bandpass(c, 1500, 1.4);
      envAD(c, 0.02, len * 0.42);
      addInto(out, c, at, 1);
    };
    cry(0.15, 0.42, 1240);
    cry(0.85, 0.6, 1120);
    return normalize(out, 0.5);
  },
  "cart-passby": (sec) => {
    const rnd = mulberry32(111);
    const rumble = onePoleLP(brown(sec, rnd, 1), 260);
    const pass = (t) => Math.exp(-(((t - sec * 0.52) / (sec * 0.3)) ** 2)); // swell in/out
    gainLfo(rumble, [pass]);
    for (let t = 0.2; t < sec - 0.2; t += 0.1 + rnd() * 0.24) {
      const rattle = bandpass(whiteInto(buffer(0.05), rnd, 1), 700 + rnd() * 1700, 7);
      envAD(rattle, 0.001, 0.02);
      addInto(rumble, rattle, t, 0.4 * pass(t));
      if (rnd() < 0.35) {
        const hoof = tone(0.09, 140 - rnd() * 30, 1);
        envAD(hoof, 0.002, 0.03);
        addInto(rumble, hoof, t + 0.03, 0.5 * pass(t));
      }
    }
    return normalize(rumble, 0.6);
  },
  "dog-bark": (sec) => {
    const rnd = mulberry32(222);
    const out = buffer(sec);
    const bark = (at) => {
      const b = buffer(0.22);
      let ph = 0;
      for (let i = 0; i < b.length; i++) {
        const t = i / SR;
        const f = 340 + 240 * Math.exp(-t * 22);
        ph += (2 * Math.PI * f) / SR;
        b[i] = (Math.sin(ph) + 0.6 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph)) * 0.6 + (rnd() * 2 - 1) * 0.25;
      }
      bandpass(b, 620, 1.6);
      envAD(b, 0.008, 0.06);
      addInto(out, b, at, 1);
      // faint street slapback
      addInto(out, b, at + 0.16, 0.2);
    };
    bark(0.1);
    bark(0.52);
    return normalize(out, 0.55);
  },
  "door-creak": (sec) => {
    const rnd = mulberry32(333);
    // Stick-slip hinge: jittery rising resonant tone, then latch clack.
    const creak = buffer(sec * 0.75);
    let ph = 0;
    for (let i = 0; i < creak.length; i++) {
      const t = i / SR;
      const u = t / (sec * 0.75);
      const jitter = rnd() < 0.004 ? rnd() * 90 : 0;
      const f = 150 + 260 * u + 26 * Math.sin(2 * Math.PI * 9 * t) + jitter;
      ph += (2 * Math.PI * f) / SR;
      creak[i] = Math.sin(ph) * 0.5 + Math.sin(2.01 * ph) * 0.22;
    }
    bandpass(creak, 420, 2.6);
    envAD(creak, 0.05, sec * 0.4);
    const out = buffer(sec);
    addInto(out, creak, 0.05, 1);
    const clack = bandpass(whiteInto(buffer(0.05), mulberry32(334), 1), 1300, 4);
    envAD(clack, 0.001, 0.02);
    addInto(out, clack, sec * 0.78, 0.8);
    return normalize(out, 0.55);
  },
};

// ---------------------------------------------------------------------------
async function tryElevenLabs(key, spec) {
  const res = await fetch("https://api.elevenlabs.io/v1/sound-generation", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: spec.prompt,
      duration_seconds: Math.min(22, spec.seconds),
      prompt_influence: 0.45,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 160)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) throw new Error(`suspiciously small payload (${buf.length}B)`);
  return buf;
}

mkdirSync(OUT_DIR, { recursive: true });
const key = envKey();
const manifest = [];
let elCount = 0, synthCount = 0;

for (const spec of SOUNDS) {
  const mp3Path = resolve(OUT_DIR, `${spec.name}.mp3`);
  const wavPath = resolve(OUT_DIR, `${spec.name}.wav`);
  let file = null, source = null;

  if (!FORCE && existsSync(mp3Path)) {
    file = `${spec.name}.mp3`; source = "elevenlabs (cached)";
  } else if (!SYNTH_ONLY && key) {
    try {
      const mp3 = await tryElevenLabs(key, spec);
      writeFileSync(mp3Path, mp3);
      file = `${spec.name}.mp3`; source = "elevenlabs"; elCount++;
      console.log(`[elevenlabs] ${spec.name} (${spec.seconds}s)`);
    } catch (err) {
      console.warn(`[elevenlabs FAILED] ${spec.name}: ${err.message}`);
    }
  }

  if (!file) {
    let pcm = SYNTH[spec.name](spec.seconds + (spec.loop ? 1.2 : 0));
    if (spec.loop) pcm = loopify(pcm, 1.2);
    writeWav(wavPath, pcm);
    file = `${spec.name}.wav`; source = "synth"; synthCount++;
    console.log(`[synth] ${spec.name} (${(pcm.length / SR).toFixed(1)}s)`);
  }

  manifest.push({ name: spec.name, file, kind: spec.kind, loop: spec.loop, seconds: spec.seconds, source });
}

writeFileSync(
  resolve(OUT_DIR, "manifest.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), sampleRateHint: SR, sounds: manifest }, null, 2),
);
console.log(`\nwrote ${manifest.length} sounds -> ${OUT_DIR} (elevenlabs: ${elCount}, synth: ${synthCount})`);
