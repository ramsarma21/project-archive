import { BULLETS_FOR_WRONG, type BulletGrant } from "@pa/duel";
import type { DuelHud } from "./duelRuntime.js";

// The round's state, read off the core.
//
// Ammunition is drawn as discrete balls rather than a number, because the number IS
// the mechanic: a correct answer's magazine against a wrong answer's is the whole
// knowledge-to-power conversion, and a player has to feel that difference at a
// glance while moving. A numeral would make it inventory.
//
// THE GRANT IS 14 AGAINST 7, AND FOURTEEN DOES NOT MAKE A TIDY ROW. Fourteen dots in
// a line is a bar, and nobody counts it. Laid out in rows of seven it becomes the
// comparison the economy is actually about — a wrong answer is one full row and a
// right answer two, so knowing the answer is a whole extra row — and no row is short,
// which is what stops a stub reading as a magazine that failed to draw.
//
// THE WIDTH IS DERIVED FROM THE ECONOMY AND NOT TYPED, and it deliberately does not
// come from the magazine being drawn: both grants have to land on the same grid or
// there is nothing to compare. The current pair divides exactly, which is the easy
// case; the general path is what let the economy sit at 9 and 14 for a while (rows of
// five: 5+4 against 5+5+4) and what will absorb the next pair too. A HUD test used to
// require the correct grant to be exactly twice the wrong one, which held the
// wrong-answer round two-thirds empty for as long as it stood; the test now asks
// whether the magazine reads, which is its business, and leaves the ratio to balance.
//
// HEALTH IS THE PROGRESS BAR, because health is what ends the duel. Each bar carries
// two extra reads the open-ended round count made necessary: the ghost of where it
// stood when the round opened, and the number of clean hits left in it.

function healthFraction(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(1, value / max));
}

/** Narrowest and widest countable row. Below 4 a magazine is a column; above 8 it is a bar. */
const MIN_ROW = 4;
const MAX_ROW = 8;

/**
 * The countable width that leaves the fullest last row, or null if `count` is too
 * narrow to be a row at all. An exact division counts as a full last row.
 */
function tidiestWidth(count: number): number | null {
  if (count < MIN_ROW) return null;
  if (count <= MAX_ROW) return count;
  let best: number | null = null;
  let bestFullness = -1;
  for (let width = MIN_ROW + 1; width <= MAX_ROW; width++) {
    const remainder = count % width;
    const fullness = remainder === 0 ? 1 : remainder / width;
    if (fullness > bestFullness) {
      bestFullness = fullness;
      best = width;
    }
  }
  return best;
}

/**
 * How wide a row of pips should be.
 *
 * THE WIDTH COMES FROM THE ECONOMY AND NOT FROM THE MAGAZINE IN FRONT OF IT, which
 * is the whole of what makes this widget a comparison. Both grants have to land on
 * the same grid: 7 balls in rows of 7 beside 14 in rows of 5 is two unrelated
 * shapes, and the player learns nothing by looking from one to the other. So the
 * wrong-answer grant picks the width — it is the smaller of the two, so a width that
 * suits it suits the larger one as well — and every magazine drawn this round uses
 * it, including an authored one and a carried-over one.
 *
 * At the shipped 7 and 14 that is rows of seven, and the correct grant stacks exactly:
 * one row against two. A pair that does NOT divide still lays out — at 9 and 14 this
 * picked rows of five, giving 5+4 against 5+5+4 — and that general path is the reason
 * the economy can move without this widget being retyped. The shapes were looked at
 * rendered at both pairs. See `duelPresentation.test.ts`.
 */
export function magazineRowSize(capacity: number, unit: number = BULLETS_FOR_WRONG): number {
  const total = Math.max(1, Math.trunc(capacity));
  if (total <= MAX_ROW) return total;
  // A unit too narrow to be a row — a one-ball economy, or an authored magazine
  // drawn with no economy behind it — leaves the capacity to lay itself out.
  return tidiestWidth(Math.trunc(unit)) ?? tidiestWidth(total) ?? 7;
}

function HealthBar(props: {
  label: string;
  value: number;
  max: number;
  opening: number;
  hits: number;
  hitsLabel: string;
  tone: "player" | "boss";
  downed: boolean;
}) {
  const fraction = healthFraction(props.value, props.max);
  // The ghost runs from current health up to where the round opened, so the round's
  // damage is a lit segment on the bar rather than a number that already moved.
  const ghost = Math.max(0, healthFraction(props.opening, props.max) - fraction);
  return (
    <div className={`duel-health duel-health-${props.tone}${props.downed ? " is-down" : ""}`}>
      <div className="duel-health-head">
        <span className="duel-kicker">{props.label}</span>
        <span className="duel-health-count">
          {Math.max(0, Math.round(props.value))}
          <span className="duel-health-max">/{props.max}</span>
        </span>
      </div>
      <div className="duel-health-track">
        <div className="duel-health-fill" style={{ width: `${fraction * 100}%` }} />
        <div
          className="duel-health-lost"
          style={{ left: `${fraction * 100}%`, width: `${ghost * 100}%` }}
        />
      </div>
      {/* Escalates as it drops: a large count is context, a small one is the endgame. */}
      <div className={`duel-health-hits${props.hits <= 3 ? " is-closing" : ""}`}>
        {props.downed ? "down" : `${props.hits} ${props.hits === 1 ? "hit" : "hits"} ${props.hitsLabel}`}
      </div>
    </div>
  );
}

/** One pip per ball, in rows. Empty sockets stay visible so a spent magazine reads. */
function Magazine(props: { ammo: number; magazine: number }) {
  // Sockets are the magazine this round was granted, so a spent one still shows what
  // it held. Before the first grant there is no magazine and therefore no sockets —
  // a single empty pip would read as "one ball", which is a number the player never had.
  const sockets = Math.max(props.magazine, props.ammo);
  const rowSize = magazineRowSize(Math.max(1, sockets));
  return (
    <div className="duel-mag">
      <div
        className="duel-mag-rows"
        style={{ gridTemplateColumns: `repeat(${rowSize}, 1fr)` }}
        aria-label={`${props.ammo} balls remaining`}
      >
        {Array.from({ length: sockets }, (_, index) => (
          <span
            key={index}
            className={`duel-ball${index < props.ammo ? " is-loaded" : ""}`}
          />
        ))}
      </div>
      <span className="duel-mag-label">
        {props.ammo === 0 ? "no shot" : props.ammo === 1 ? "1 ball" : `${props.ammo} balls`}
      </span>
    </div>
  );
}

export function grantSummary(grant: BulletGrant): string {
  const parts = [`${grant.granted} granted`];
  if (grant.carriedIn > 0) parts.push(`${grant.carriedIn} carried`);
  if (grant.expired > 0) parts.push(`${grant.expired} expired at the break`);
  return parts.join(" · ");
}

export function RoundHud(props: { hud: DuelHud; opponentName?: string }) {
  const { hud } = props;
  const opponent = props.opponentName ?? (hud.mode === "BOSS" ? "The officer" : "Opponent");
  const clockPhase =
    hud.phase === "ENGAGEMENT_LIVE"
      ? "engaged"
      : hud.phase === "LINE_OF_SIGHT_BREAK"
        ? "he breaks off"
        : hud.phase === "BULLETS_GRANTED"
          ? "resuming"
          : hud.phase === "QUESTION_PENDING"
            ? "clock stopped"
            : hud.phase === "FACE_OFF"
              ? "face-off"
              : "";

  return (
    <div className="duel-hud">
      <div className="duel-hud-side">
        <HealthBar
          label="You"
          value={hud.health.A}
          max={hud.maxHealth.A}
          opening={hud.roundOpeningHealth.A}
          hits={hud.hitsToFall.A}
          hitsLabel="left in you"
          tone="player"
          downed={hud.downed.A}
        />
        <Magazine ammo={hud.ammo.A} magazine={hud.magazine.A} />
      </div>

      <div className="duel-hud-centre">
        <div className="duel-round">
          <span className="duel-kicker">Round</span>
          <strong>{Math.max(1, hud.round)}</strong>
        </div>
        {hud.secondsRemaining !== null && (
          <div className={`duel-clock${hud.phase === "ENGAGEMENT_LIVE" && hud.secondsRemaining <= 5 ? " is-urgent" : ""}`}>
            {hud.secondsRemaining}
            <span className="duel-clock-unit">s</span>
          </div>
        )}
        <div className="duel-phase">{clockPhase}</div>
      </div>

      <div className="duel-hud-side duel-hud-right">
        <HealthBar
          label={opponent}
          value={hud.health.B}
          max={hud.maxHealth.B}
          opening={hud.roundOpeningHealth.B}
          hits={hud.hitsToFall.B}
          hitsLabel={hud.mode === "BOSS" ? "left in him" : "left in them"}
          tone="boss"
          downed={hud.downed.B}
        />
        <Magazine ammo={hud.ammo.B} magazine={hud.magazine.B} />
      </div>
    </div>
  );
}
