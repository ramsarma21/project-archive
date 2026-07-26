import { useMemo } from "react";
import {
  HoloBeacon,
  HoloCone,
  HoloDisc,
  HoloField,
  HoloPath,
  HoloPin,
  HoloSweep,
  HoloWatcherMark,
} from "./VisorMarks.js";
import {
  LINE_STYLE,
  VISOR_AMBER,
  VISOR_CYAN,
  VISOR_INK,
  VISOR_ROSE,
  VISOR_TEAL,
} from "./visorPalette.js";
import { rangeLabel, type VisorPlan } from "./visorPlan.js";

// ---------------------------------------------------------------------------
// The plan, drawn.
//
// Every decision about WHAT to show was made in visorPlan.ts. This file only
// places it, and the one judgement it makes of its own is TIMING: how the reveal
// travels outward so that a frame filling with a dozen marks reads as one scan
// rather than as a dozen things appearing at once.
//
// The stagger is derived from range, which is the same axis the whole design turns
// on. The leads under the player's feet light immediately, the market a beat later,
// the Town House after that, the elm last — so the sequence the player watches is
// also the sequence they are about to run, and the last thing to arrive is the
// thing they are aiming at.
// ---------------------------------------------------------------------------

/** Range over which the reveal travels. The level's own length, roughly. */
const SCAN_REACH_M = 92;

/** The reveal is finished by here, leaving the tail of the ramp for the chrome. */
const SCAN_WINDOW = 0.66;

function stagger(distanceM: number): number {
  return Math.min(SCAN_WINDOW, (distanceM / SCAN_REACH_M) * SCAN_WINDOW);
}

const ZONE_STYLE = {
  DARK: { colour: VISOR_TEAL, hatchM: 0.9 },
  LIT: { colour: VISOR_AMBER, hatchM: 2.2 },
  CROWD: { colour: VISOR_TEAL, hatchM: 1.4 },
} as const;

export function VisorAnnotation(props: {
  plan: VisorPlan;
  spawn: readonly [number, number, number];
}) {
  const { plan } = props;

  // The chip on each line is drawn once per line rather than once per polyline: a
  // line that forks three ways is still one promise, and three copies of "SAFE"
  // is three copies of the same sentence.
  const chips = useMemo(() => {
    const seen = new Set<string>();
    return plan.paths.filter((path) => {
      if (seen.has(path.line)) return false;
      seen.add(path.line);
      return true;
    });
  }, [plan.paths]);

  return (
    <group name="visor-annotation">
      <HoloSweep at={props.spawn} maxRadiusM={SCAN_REACH_M} colour={VISOR_CYAN} />

      {/* ---- near field: the three lines, drawn ------------------------- */}
      {plan.paths.map((path) => {
        const style = LINE_STYLE[path.line];
        return (
          <HoloPath
            key={path.id}
            points={path.points}
            colour={style.colour}
            opacity={style.opacity}
            glowRadiusM={style.glowRadiusM}
            dashM={style.dashM}
            appearAt={stagger(path.points[0]![0] - props.spawn[0])}
          />
        );
      })}

      {/* The tag names the line and stops there. What each line PROMISES is
          already in the chrome's own "lines drawn" list, in the same words, and
          the two were landing three metres apart on screen — a duplicated
          sentence sitting across the one pin that matters at the spawn. Which
          line is which is a fact about a place and belongs here; what it costs
          you is a sentence and belongs in the corner. */}
      {chips.map((path) => {
        const style = LINE_STYLE[path.line];
        return (
          <HoloPin
            key={`chip:${path.id}`}
            at={path.chipAt}
            appearAt={stagger(6)}
            spec={{
              title: style.label,
              accent: style.colour,
              tone: path.line === "SAFE" ? "NORMAL" : "DIM",
            }}
          />
        );
      })}

      {plan.pins.map((pin) => (
        <HoloPin
          key={`pin:${pin.id}`}
          at={pin.pos}
          appearAt={stagger(pin.distanceM)}
          leaderToY={pin.pos[1] - 1.4}
          spec={{
            title: pin.title,
            detail: pin.detail,
            range: rangeLabel(pin.distanceM),
            accent: VISOR_INK,
            tone: "BRIGHT",
          }}
        />
      ))}

      {/* ---- near field: what the dark and the light are worth ---------- */}
      {plan.zones.map((zone) => {
        const style = ZONE_STYLE[zone.kind];
        const appearAt = stagger(zone.distanceM);
        return (
          <group key={`zone:${zone.id}`}>
            {zone.radiusM !== undefined ? (
              <HoloDisc
                at={zone.centre}
                radiusM={zone.radiusM}
                colour={style.colour}
                appearAt={appearAt}
              />
            ) : (
              <HoloField
                at={zone.centre}
                halfX={zone.halfX ?? 1}
                halfZ={zone.halfZ ?? 1}
                colour={style.colour}
                hatchM={style.hatchM}
                appearAt={appearAt}
              />
            )}
            {/* A tag, not a caption. What the area is WORTH went to the chrome's
                cover row: these lie flat on the street, the route lines cross
                the same ground, and a line ran clean through the crowd's
                sentence. The shape and the hue carry the meaning here — teal is
                a tool, amber is exposure — and the words carry it in the
                corner, where nothing is drawn over them. */}
            <HoloPin
              at={[zone.centre[0], zone.centre[1] + 2.4, zone.centre[2]]}
              appearAt={appearAt}
              leaderToY={zone.centre[1] + 0.2}
              spec={{
                title: zone.label,
                accent: style.colour,
                tone: "DIM",
              }}
            />
          </group>
        );
      })}

      {/* ---- mid field: who is looking, and where the rest of them are --
          The cone and the diamond, and no label on either. A watcher had a
          three-row plate naming his post, his reach and his range, two of them
          were drawn at once, and both landed in the same forty pixels as the
          crowd's tag — the single least readable thing in the frame, and it was
          restating the chrome, which already says how many men are on the route
          and how many of them have cones drawn. The shape IS the answer to "may
          I walk there", and it is the answer at the place the question is asked;
          a name for the man is colour, and it cost the shape its legibility. */}
      {plan.cones.map((cone) => (
        <group key={`cone:${cone.id}`}>
          <HoloCone
            at={cone.pos}
            yaw={cone.yaw}
            halfAngleRad={cone.halfAngleRad}
            rangeM={cone.rangeM}
            colour={VISOR_ROSE}
            appearAt={stagger(cone.distanceM)}
          />
          <HoloWatcherMark
            at={cone.pos}
            colour={VISOR_ROSE}
            headroomM={2.6}
            appearAt={stagger(cone.distanceM)}
          />
        </group>
      ))}

      {plan.marks.map((mark) => (
        <HoloWatcherMark
          key={`mark:${mark.id}`}
          at={mark.pos}
          colour={VISOR_ROSE}
          headroomM={2.4}
          appearAt={stagger(mark.distanceM)}
        />
      ))}

      {/* ---- range: named, not drawn ------------------------------------ */}
      {plan.landmarks.map((landmark) => (
        <HoloPin
          key={`landmark:${landmark.id}`}
          at={[landmark.pos[0], landmark.pos[1] + 3.2, landmark.pos[2]]}
          appearAt={stagger(landmark.distanceM)}
          leaderToY={landmark.pos[1]}
          spec={{
            title: landmark.label,
            detail: landmark.detail,
            range: rangeLabel(landmark.distanceM),
            accent: VISOR_CYAN,
            tone: "DIM",
          }}
        />
      ))}

      <HoloBeacon
        at={plan.beacon.pos}
        groundY={0}
        topY={plan.beacon.topY}
        workY={plan.beacon.workY}
        colour={VISOR_CYAN}
        accent={VISOR_INK}
        appearAt={stagger(plan.beacon.distanceM)}
      />
      <HoloPin
        at={[plan.beacon.pos[0], plan.beacon.labelY, plan.beacon.pos[2]]}
        appearAt={stagger(plan.beacon.distanceM)}
        spec={{
          title: plan.beacon.label,
          detail: plan.beacon.detail,
          range: rangeLabel(plan.beacon.distanceM),
          accent: VISOR_INK,
          tone: "BRIGHT",
        }}
      />
    </group>
  );
}
