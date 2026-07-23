// Deterministic atmosphere schedule for the 1765-Boston day (World-Design-Bible §6).
// One pure function maps the runtime clock (t = spentUnits / fixedEventBoundary,
// dusk flag, evening flag) to sun, palette, weather, fog, and lantern values.
// SkyDirector / WeatherDirector / WaterDirector / AudioDirector all read this
// so the whole world agrees about the hour. Presentation-only; no game state.

import * as THREE from "three";

export type WeatherState = "GLOOM" | "DRIZZLE" | "CLEARING";

export interface AtmosphereClock {
  t: number; // 0..1 day progress (already smoothed by World3D)
  dusk: boolean; // runtime DUSK phase or the Liberty-Tree approach
  evening: boolean; // clock at/after fixedEventBoundary: moon + stars beats
}

export interface Atmosphere {
  t: number;
  dusk: boolean;
  night: number; // 0..1 evening/night blend
  // sun + lights
  sunDir: THREE.Vector3; // unit vector toward the sun
  sunColor: THREE.Color;
  sunIntensity: number; // weather-dimmed
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  moonDir: THREE.Vector3;
  // sky dome
  turbidity: number;
  rayleigh: number;
  horizonColor: THREE.Color; // gradient band near the horizon
  overcastColor: THREE.Color; // dome tint (pewter by day, deep blue at night)
  overcastOpacity: number; // 0..1 dome coverage (kills the blue in GLOOM)
  cloudColor: THREE.Color;
  cloudCover: number; // 0..1 drifting layer density
  // weather
  weather: WeatherState; // dominant state (for audio/QA labels)
  gloom: number;
  drizzle: number;
  clearing: number;
  rain: number; // 0..1 particle density
  wetness: number; // 0..1 puddle sheen
  shafts: number; // 0..1 broken-cloud light shafts
  // fog
  fogColor: THREE.Color;
  fogNear: number;
  fogFar: number;
  // dressing
  lanternWarmth: number; // 0..1 window/lantern emissive ramp
}

export function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function smoothstep(a: number, b: number, x: number): number {
  const u = clamp01((x - a) / (b - a));
  return u * u * (3 - 2 * u);
}

// Small deterministic PRNG shared by atmosphere consumers (gull paths, audio
// event scheduling, star field). Never Math.random in anything world-visible.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---- Weather schedule -------------------------------------------------------
// Day 1 pattern per the Bible: GLOOM morning -> DRIZZLE midday -> CLEARING
// toward dusk (so the burning effigy pops). Boundaries sit on the runtime's
// phase edges (14u and 19u of 24) and can be jittered a touch by the profile
// seed when one is provided, staying deterministic per save.
export function weatherBlend(
  t: number,
  daySeed?: string,
): { gloom: number; drizzle: number; clearing: number; weather: WeatherState } {
  let j1 = 0;
  let j2 = 0;
  if (daySeed) {
    const rnd = mulberry32(hashString(daySeed));
    j1 = (rnd() - 0.5) * 0.04;
    j2 = (rnd() - 0.5) * 0.04;
  }
  const inDrizzle = smoothstep(0.545 + j1, 0.62 + j1, t);
  const inClearing = smoothstep(0.75 + j2, 0.8 + j2, t);
  const gloom = 1 - inDrizzle;
  const drizzle = inDrizzle * (1 - inClearing);
  const clearing = inClearing;
  const weather: WeatherState =
    clearing >= Math.max(gloom, drizzle) ? "CLEARING" : drizzle >= gloom ? "DRIZZLE" : "GLOOM";
  return { gloom, drizzle, clearing, weather };
}

// ---- Palette stops (Bible §6: dawn rose-gray -> pewter -> amber -> ember) ---
interface PaletteStop {
  t: number;
  sun: string;
  horizon: string;
  overcast: string;
  cloud: string;
  hemiSky: string;
  hemiGround: string;
  sunIntensity: number;
}

const STOPS: PaletteStop[] = [
  { t: 0.0, sun: "#e9b39c", horizon: "#c9a8a0", overcast: "#9aa0ab", cloud: "#8a8288", hemiSky: "#bcc4d2", hemiGround: "#7d6f5c", sunIntensity: 1.7 },
  { t: 0.2, sun: "#efe8d8", horizon: "#b6bec6", overcast: "#8f99a3", cloud: "#767e8a", hemiSky: "#c3ccd8", hemiGround: "#847660", sunIntensity: 2.3 },
  { t: 0.55, sun: "#f2eddf", horizon: "#adb6be", overcast: "#87909b", cloud: "#6f7883", hemiSky: "#c8d9ee", hemiGround: "#8a7355", sunIntensity: 2.5 },
  { t: 0.8, sun: "#ffc274", horizon: "#d8a76c", overcast: "#8a8a92", cloud: "#a8825f", hemiSky: "#b9c2d4", hemiGround: "#8a7355", sunIntensity: 2.0 },
  { t: 1.0, sun: "#ff7d3a", horizon: "#c76a3f", overcast: "#5c5560", cloud: "#6e4f40", hemiSky: "#8d90ab", hemiGround: "#6a5a48", sunIntensity: 1.15 },
];

const NIGHT = {
  horizon: new THREE.Color("#25304a"),
  overcast: new THREE.Color("#0e1524"),
  cloud: new THREE.Color("#2c3446"),
  hemiSky: new THREE.Color("#2c3850"),
  hemiGround: new THREE.Color("#1c1a18"),
  fog: new THREE.Color("#131a28"),
};

function paletteAt(t: number): PaletteStop & { sunC: THREE.Color; horizonC: THREE.Color; overcastC: THREE.Color; cloudC: THREE.Color; hemiSkyC: THREE.Color; hemiGroundC: THREE.Color } {
  let a = STOPS[0]!;
  let b = STOPS[STOPS.length - 1]!;
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (t >= STOPS[i]!.t && t <= STOPS[i + 1]!.t) {
      a = STOPS[i]!;
      b = STOPS[i + 1]!;
      break;
    }
  }
  const u = a.t === b.t ? 0 : clamp01((t - a.t) / (b.t - a.t));
  const mix = (ka: string, kb: string) => new THREE.Color(ka).lerp(new THREE.Color(kb), u);
  return {
    ...a,
    sunIntensity: THREE.MathUtils.lerp(a.sunIntensity, b.sunIntensity, u),
    sunC: mix(a.sun, b.sun),
    horizonC: mix(a.horizon, b.horizon),
    overcastC: mix(a.overcast, b.overcast),
    cloudC: mix(a.cloud, b.cloud),
    hemiSkyC: mix(a.hemiSky, b.hemiSky),
    hemiGroundC: mix(a.hemiGround, b.hemiGround),
  };
}

// ---- Main schedule ----------------------------------------------------------
export function atmosphereAt(clock: AtmosphereClock, daySeed?: string): Atmosphere {
  const t = clock.dusk ? Math.max(clamp01(clock.t), 1) : clamp01(clock.t);
  const night = clock.evening ? 1 : 0;
  const pal = paletteAt(t);
  const wb = weatherBlend(t, daySeed);

  // Sun path: dawn low NE -> noon high S -> dusk low NW (Bible §6). The arc
  // is squeezed slightly so dawn/dusk hold a raking ~8 degree key instead of
  // dropping to zero (the ember light must still draw the street).
  const azimuthDeg = THREE.MathUtils.lerp(52, 293, t);
  const elevationDeg = night > 0.5 ? -12 : 3 + 62 * Math.sin(Math.PI * (0.03 + t * 0.94));
  const phi = THREE.MathUtils.degToRad(90 - elevationDeg);
  const theta = THREE.MathUtils.degToRad(azimuthDeg);
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
  // Moon rises opposite the sunset track, low in the east so street-level
  // framings looking down the spine catch it over the rooftops.
  const moonDir = new THREE.Vector3().setFromSphericalCoords(
    1,
    THREE.MathUtils.degToRad(90 - 19),
    THREE.MathUtils.degToRad(azimuthDeg - 193),
  );

  // Weather-driven light shaping. Overcast reads as SOFT light, not dark:
  // the sun key drops but the hemisphere dome compensates hard.
  const sunDim = 0.52 * wb.gloom + 0.38 * wb.drizzle + 0.96 * wb.clearing;
  const hemiBoost = 1.9 * wb.gloom + 1.68 * wb.drizzle + 0.98 * wb.clearing;
  const duskness = smoothstep(0.9, 1, t);
  const lanternWarmth = Math.max(smoothstep(0.84, 0.98, t), night);

  // Fog per weather phase (thick gray morning -> thin at dusk) with dusk/night overrides.
  const fogColor = new THREE.Color("#b7bfc7")
    .multiplyScalar(wb.gloom)
    .add(new THREE.Color("#a9b2b9").multiplyScalar(wb.drizzle))
    .add(new THREE.Color("#c9c0ae").multiplyScalar(wb.clearing));
  let fogNear = 44 * wb.gloom + 26 * wb.drizzle + 70 * wb.clearing;
  let fogFar = 155 * wb.gloom + 112 * wb.drizzle + 205 * wb.clearing;
  fogColor.lerp(new THREE.Color("#4a3a30"), duskness * 0.75);
  fogColor.lerp(NIGHT.fog, night);
  fogNear = THREE.MathUtils.lerp(fogNear, 30, night);
  fogFar = THREE.MathUtils.lerp(fogFar, 150, night);

  const overcastOpacity = Math.max(
    0.86 * wb.gloom + 0.96 * wb.drizzle + 0.4 * wb.clearing - duskness * 0.25,
    night * 0.97,
  );

  const sunColor = pal.sunC.clone();
  const horizonColor = pal.horizonC.clone().lerp(NIGHT.horizon, night);
  const overcastColor = pal.overcastC.clone().lerp(NIGHT.overcast, night);
  const cloudColor = pal.cloudC.clone().lerp(NIGHT.cloud, night);
  const hemiSky = pal.hemiSkyC.clone().lerp(NIGHT.hemiSky, night);
  const hemiGround = pal.hemiGroundC.clone().lerp(NIGHT.hemiGround, night);

  return {
    t,
    dusk: clock.dusk,
    night,
    sunDir,
    sunColor,
    sunIntensity: pal.sunIntensity * sunDim * (1 - night),
    hemiSky,
    hemiGround,
    hemiIntensity: THREE.MathUtils.lerp(0.85, 0.52, t) * hemiBoost * (1 - night * 0.62),
    moonDir,
    turbidity: 6 + t * 6 + wb.drizzle * 2,
    rayleigh: 1.2 + t * 2.4,
    horizonColor,
    overcastColor,
    overcastOpacity: clamp01(overcastOpacity),
    cloudColor,
    cloudCover: clamp01(0.85 * wb.gloom + 0.97 * wb.drizzle + 0.45 * wb.clearing - night * 0.35),
    weather: wb.weather,
    gloom: wb.gloom,
    drizzle: wb.drizzle,
    clearing: wb.clearing,
    rain: wb.drizzle,
    wetness: clamp01(0.35 * wb.gloom + 0.95 * wb.drizzle + 0.5 * wb.clearing),
    // late-day broken-cloud shafts; gone once the ember dusk takes over
    shafts: wb.clearing * (1 - night) * (1 - smoothstep(0.82, 0.9, t)),
    fogColor,
    fogNear,
    fogFar,
    lanternWarmth,
  };
}

// ---- Zones ------------------------------------------------------------------
// manifest.ts owns the world-zone map; re-export it so atmosphere consumers
// (audio, population) keep a single import site for schedule + zones.
export { zoneForPosition, type WorldZone } from "./manifest.js";
