import { useEffect, useRef, useState } from "react";
import {
  classifyHit,
  healthDelta,
  healthFraction,
  healthTone,
  healthToneLabel,
  type AmmoReadout,
  type HealthTone,
  type HitKind,
} from "./combatHudModel.js";

// The canvas-free pieces of the combat HUD: plain DOM driven by the pure model.
//
// They live apart from `CombatHud.tsx` for a concrete reason — that file imports the
// stylesheet and mounts WebGL portrait/weapon canvases, neither of which a headless
// component test can load. These parts import NOTHING but React and the pure model, so
// the bars, the hit marker and the controls legend can be rendered and asserted
// directly. `CombatHud.tsx` composes these with the live GLB views around them.

function toneClass(prefix: string, tone: HealthTone): string {
  return `${prefix} ${prefix}-${tone}`;
}

/**
 * A fraction that lags a FALLING target and eases down to it, so the size of the last
 * bite is visible for a beat. Rising jumps instantly (a refill is not damage). Reduced
 * motion collapses it to the target, and it degrades the same way wherever
 * `requestAnimationFrame` is absent (a test renderer) — the read stays, the trail goes.
 *
 * Frame-rate independent: the ease is driven by wall-clock elapsed, not by a per-frame
 * decrement, so 30/60/120fps reach the new value at the same wall time. No steady-state
 * allocation — the rAF closure exists only while an ease is in flight.
 */
export function useDamageChip(fraction: number, reducedMotion: boolean): number {
  const [chip, setChip] = useState(fraction);
  const chipRef = useRef(fraction);
  const prev = useRef(fraction);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    chipRef.current = chip;
  }, [chip]);

  useEffect(() => {
    const hasRaf = typeof requestAnimationFrame === "function";
    if (fraction >= prev.current || reducedMotion || !hasRaf) {
      prev.current = fraction;
      chipRef.current = fraction;
      setChip(fraction);
      return undefined;
    }
    prev.current = fraction;
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    const from = Math.max(chipRef.current, fraction);
    const durationMs = 620;
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = from + (fraction - from) * (1 - Math.pow(1 - t, 3));
      chipRef.current = eased;
      setChip(eased);
      if (t < 1) raf.current = requestAnimationFrame(step);
    };
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [fraction, reducedMotion]);

  return chip;
}

/**
 * Keyed impact/heal counters that increment ONCE per authoritative change.
 *
 * Event-driven off the health prop, so a duplicated or stale snapshot — which carries
 * an equal health — reports `"none"` and fires nothing. The returned counters are used
 * as React keys on the flash elements, which is what re-triggers a CSS animation
 * without a per-frame timer or any allocation between hits.
 */
export function useDamagePulse(health: number): { pulse: number; heal: number } {
  const prev = useRef(health);
  const [pulse, setPulse] = useState(0);
  const [heal, setHeal] = useState(0);
  useEffect(() => {
    const change = healthDelta(prev.current, health);
    prev.current = health;
    if (change === "damage") setPulse((n) => n + 1);
    else if (change === "heal") setHeal((n) => n + 1);
  }, [health]);
  return { pulse, heal };
}

/**
 * The shared bar body: a bevelled track, a quick main fill with a holographic sheen and
 * subtle segmentation, a slow damage-chip trail, a brief impact flash on damage and a
 * distinct heal flash, and an energy edge. `prefix` scopes it to the player or the
 * enemy without duplicating the markup.
 */
function Bar(props: {
  prefix: "cbt-health" | "cbt-enemy";
  fraction: number;
  chip: number;
  pulse: number;
  heal: number;
}) {
  const p = props.prefix;
  const chipWidth = Math.max(0, props.chip - props.fraction);
  return (
    <div className={`${p}-track`}>
      <div className={`${p}-fill`} style={{ width: `${props.fraction * 100}%` }}>
        <span className={`${p}-sheen`} aria-hidden />
      </div>
      <div
        className={`${p}-chip`}
        style={{ left: `${props.fraction * 100}%`, width: `${chipWidth * 100}%` }}
      />
      {props.pulse > 0 && <span key={`d${props.pulse}`} className={`${p}-impact`} aria-hidden />}
      {props.heal > 0 && <span key={`h${props.heal}`} className={`${p}-heal`} aria-hidden />}
      <span className={`${p}-edge`} aria-hidden />
    </div>
  );
}

/** The player's health bar with the recent-damage chip. Used inside the hero panel. */
export function HealthBar(props: {
  health: number;
  maxHealth: number;
  reducedMotion: boolean;
}) {
  const fraction = healthFraction(props.health, props.maxHealth);
  const chip = useDamageChip(fraction, props.reducedMotion);
  const { pulse, heal } = useDamagePulse(props.health);
  const tone = healthTone(props.health, props.maxHealth);
  const shown = Math.max(0, Math.round(props.health));
  const max = Math.max(0, Math.round(props.maxHealth));
  return (
    <div className={`cbt-health cbt-health-${tone}`}>
      <Bar prefix="cbt-health" fraction={fraction} chip={chip} pulse={pulse} heal={heal} />
      <div className="cbt-health-read">
        <span className="cbt-health-now">{shown}</span>
        <span className="cbt-health-max">/ {max}</span>
        {tone !== "healthy" && <span className="cbt-health-state">{healthToneLabel(tone)}</span>}
      </div>
    </div>
  );
}

/** The Cassidy-style current-over-reserve reading. Used inside the ammo cluster. */
export function AmmoNumbers(props: { ammo: AmmoReadout }) {
  return (
    <div className="cbt-ammo-read">
      <span className="cbt-ammo-now">{props.ammo.current}</span>
      <span className="cbt-ammo-total">/{props.ammo.total}</span>
    </div>
  );
}

/**
 * Top-centre: the enemy pool with a recent-damage chip trail, on a scrim. Bound purely
 * to the authoritative health shown; the round/timer sit above it on the same scrim.
 */
export function EnemyHealth(props: {
  name: string;
  role?: string;
  health: number;
  maxHealth: number;
  /** Clean hits the opponent is from the ground; omitted draws no line. */
  hitsToFall?: number;
  downed?: boolean;
  round?: number;
  clockSeconds?: number | null;
  clockUrgent?: boolean;
  reducedMotion: boolean;
}) {
  const tone = healthTone(props.health, props.maxHealth);
  const fraction = healthFraction(props.health, props.maxHealth);
  const chip = useDamageChip(fraction, props.reducedMotion);
  const { pulse, heal } = useDamagePulse(props.health);
  const shown = Math.max(0, Math.round(props.health));
  const max = Math.max(0, Math.round(props.maxHealth));
  const hits = props.hitsToFall;
  const standing = enemyStandingLine(hits, props.downed ?? false);
  return (
    <div className={toneClass("cbt-enemy", tone)}>
      {(props.round !== undefined || props.clockSeconds != null) && (
        <div className="cbt-clock">
          {props.round !== undefined && (
            <span className="cbt-clock-round">Round {Math.max(1, props.round)}</span>
          )}
          {props.clockSeconds != null && (
            <span className={`cbt-clock-time${props.clockUrgent ? " is-urgent" : ""}`}>
              {props.clockSeconds}
              <span className="cbt-clock-unit">s</span>
            </span>
          )}
        </div>
      )}
      <div className="cbt-enemy-head">
        <span className="cbt-enemy-name">{props.name}</span>
        {props.role && <span className="cbt-enemy-role">{props.role}</span>}
        <span className="cbt-enemy-read">
          <span className="cbt-enemy-now">{shown}</span>
          <span className="cbt-enemy-max">/ {max}</span>
          {tone !== "healthy" && <span className="cbt-enemy-state">{healthToneLabel(tone)}</span>}
        </span>
      </div>
      <Bar prefix="cbt-enemy" fraction={fraction} chip={chip} pulse={pulse} heal={heal} />
      {/* The clean-hits-to-the-ground read, persistent so it is legible WHILE shooting
          rather than on a card after the fight stops. Escalates as it closes. */}
      {standing && (
        <div
          className={`cbt-enemy-standing${
            hits !== undefined && !props.downed && hits <= 3 ? " is-closing" : ""
          }`}
        >
          {standing}
        </div>
      )}
      <p className="cbt-sr" role="status" aria-live="polite">
        {props.name} health {shown} of {max}, {healthToneLabel(tone)}
        {standing ? `. ${standing}` : ""}
      </p>
    </div>
  );
}

/**
 * The persistent clean-hits read, phrased to keep the retired card's character. Kept
 * pronoun-free so it reads correctly for the boss and for a PvP opponent alike — the
 * opponent's name sits directly above it, so "N clean hits from the ground" is plainly
 * about them. Returns null when there is nothing to say.
 */
export function enemyStandingLine(
  hitsToFall: number | undefined,
  downed: boolean,
): string | null {
  if (downed) return "down";
  if (hitsToFall === undefined) return null;
  const hits = Math.max(0, Math.round(hitsToFall));
  return `${hits} clean ${hits === 1 ? "hit" : "hits"} from the ground`;
}

/**
 * The centre reticle and its hit marker. Fires once per authoritative enemy-health fall.
 *
 * THE MARKER IS ONE COLOUR — the confirm yellow — on every kind of hit. It used to be
 * graded: white for a normal hit, gold at the critical threshold, red for the knockout.
 * Two reasons it is now uniform:
 *
 * White did not read. Not because the sky washed it out — the reticle is pinned to
 * screen centre, which in this arena sits below the horizon — but because it is drawn
 * ON the opponent, and the King's Officer wears a white uniform, so an arm crossing him
 * disappears into it. The fix that matters is in the stylesheet (a hard dark rim); the
 * hue is what makes it *identifiable* rather than merely visible.
 *
 * And red now means the opposite thing: `8399adb` made the impact burst yellow when you
 * strike the opponent and red when you take damage, so a red marker on a kill YOU landed
 * would read as damage taken.
 *
 * The kind still reaches the DOM and still selects the knockout's heavier arms and
 * longer hold — that says "they are down", not "this hit was worth more" — but it
 * selects no colour.
 */
export function HitMarker(props: {
  enemyHealth: number;
  enemyMaxHealth: number;
  reducedMotion: boolean;
}) {
  const prev = useRef(props.enemyHealth);
  const [flash, setFlash] = useState<{ id: number; kind: HitKind } | null>(null);
  const id = useRef(0);
  useEffect(() => {
    const kind = classifyHit(prev.current, props.enemyHealth, props.enemyMaxHealth);
    prev.current = props.enemyHealth;
    if (!kind) return undefined;
    id.current += 1;
    const marker = { id: id.current, kind };
    setFlash(marker);
    const holdMs = kind === "FATAL" ? 900 : 420;
    const timer = setTimeout(() => {
      setFlash((current) => (current?.id === marker.id ? null : current));
    }, holdMs);
    return () => clearTimeout(timer);
  }, [props.enemyHealth, props.enemyMaxHealth]);

  return (
    <div className="cbt-reticle" aria-hidden>
      <span className="cbt-reticle-dot" />
      {flash && (
        <span
          key={flash.id}
          className={`cbt-hitmark cbt-hitmark-${flash.kind.toLowerCase()}${
            props.reducedMotion ? " is-reduced" : ""
          }`}
        >
          <span className="cbt-hitmark-arm cbt-hitmark-tl" />
          <span className="cbt-hitmark-arm cbt-hitmark-tr" />
          <span className="cbt-hitmark-arm cbt-hitmark-bl" />
          <span className="cbt-hitmark-arm cbt-hitmark-br" />
        </span>
      )}
    </div>
  );
}

/** Top-left: a compact persistent hint, expanding to the full legend while Tab is held. */
export function ControlsLegend(props: {
  items: readonly { keys: string; action: string }[];
  held: boolean;
}) {
  return (
    <div className={`cbt-legend${props.held ? " is-open" : ""}`}>
      <div className="cbt-legend-hint">
        <kbd>Tab</kbd>
        <span>controls</span>
      </div>
      {props.held && (
        <div className="cbt-legend-list" role="list">
          {props.items.map((control) => (
            <span className="cbt-legend-row" role="listitem" key={control.action}>
              <kbd>{control.keys}</kbd>
              <span>{control.action}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
