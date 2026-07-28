// The placed climb ladders.
//
// The owner's rule: "you CANNOT climb without a ladder, and when you can climb
// it is ONLY when it visually makes sense with the ladder and grips and stuff."
// The arming predicate (`alignClimbToLadder`) and the compile pipe
// (`LadderPlacementSpec` -> `world.ladders`) were landed inert ahead of the art;
// this file is the content that lights them up. One `work-ladder` GLB (a re-fit
// of the delivered mesh — see assets.ts) is placed at the foot of every route
// climb-up that a ladder honestly serves, measured off `.affordwork/
// ladder-findings.md` (base, served surface, rise, outward face derived from the
// compiled world, not guessed).
//
// Base = the climb-volume foot. `onto` = the served surface, whose height IS the
// ladder top (compile resolves it off the surface, never a re-typed number).
// `faceX/faceZ` = the outward face normal in XZ, the side the body climbs,
// pointing back at the climber.
//
// The visible ladder is drawn by `ladderPlacements` in runtime.ts, sized to the
// rise and oriented on this face. It carries NO collision: a solid ladder mass
// at a climb foot would occupy the exact spot the player must stand in to climb
// (the route node lives there), so the affordance stays the authored climb
// volume and the ladder is purely the thing the player sees themselves grip.
//
// TWO climbs are deliberately NOT laddered, and the owner agreed:
//   - F_LOW->F_CROWN (the Liberty Elm): a bolted ladder up a tree crown is
//     nonsense. Left for a branch-GRIP follow-up (honest holds up the bole), not
//     forced here — there is no grip asset yet and the predicate models a ladder.
//   - D2_OUTSIDE->E_BUTTRESS: onto the SOLID `buttress-stepped-stone`, which
//     already draws as masonry set-offs the body grips. A bolted ladder would
//     read worse than the stone that is already there, so it keeps its stone.

import type { GripPlacementSpec, LadderPlacementSpec } from "../types.js";

export const LADDERS: LadderPlacementSpec[] = [
  // ---- C_ASCENT: the Town House, under repair -----------------------------
  // The mason's scaffold on the west front, its two stagings stacked. The safe
  // way up is its own access ladder; the south bay reads perfectly as one.
  {
    id: "SCAFFOLD_1",
    at: [44.8, 0, -6.4],
    onto: "SCAFFOLD_D1",
    faceX: 0,
    faceZ: -1,
  },
  {
    id: "SCAFFOLD_2",
    at: [44.8, 2.9, -6.4],
    onto: "SCAFFOLD_D2",
    faceX: 0,
    faceZ: -1,
  },
  // The east face of the tower storeys. The foot sits on the oversailing east
  // gallery/ledge, out past the wall at x=57.5, so the ladder leans WEST onto
  // the wall (+X outward). ladder-findings marked these AMBIGUOUS — the volume
  // is centred under its destination, so its (0,-1) was the platform's nearest
  // edge, not a wall to lean on; the wall is the east face at 57.5.
  {
    id: "CLOCK",
    at: [58.3, 5.6, -4.0],
    onto: "CLOCK_LEDGE",
    faceX: 1,
    faceZ: 0,
  },
  {
    id: "CORNICE_E",
    at: [58.3, 7.9, 0],
    onto: "CORNICE_E",
    faceX: 1,
    faceZ: 0,
  },
  // On the leads, against the south face of the tower shaft (a solid mass), up
  // onto the balustraded plinth ring.
  {
    id: "TOWER_PLINTH",
    at: [52.0, 12.4, 2.9],
    onto: "TOWER_PLINTH",
    faceX: 0,
    faceZ: 1,
  },

  // ---- E_LEAP: the Hollis Street meeting house ----------------------------
  // Buttress top to the lean-to roof. A leaning ladder up the shed's south side.
  {
    id: "LEANTO",
    at: [75.4, 2.6, 16.2],
    onto: "HOLLIS_LEANTO",
    // Outward NORTH (−Z): the buttress sits 1.6m inside the lean-to's boards and
    // the meeting-house second storey rises off the roof's north edge (z=15.6),
    // so the top-out has to step SOUTH onto the open shed roof — a south-facing
    // ladder would top out into that wall and refuse. ladder-findings' (−0.24,
    // 0.97) was the volume-centroid edge, not a wall with head room above it.
    faceX: 0,
    faceZ: -1,
  },
  // The ridge monitor's WEST END face (x=75.3), off the meeting-house roof — the
  // roof-walk site. The climb-volume foot (76.5) sits under the monitor, which is
  // where the old bare climb rose straight through the drawn monitor; the ladder
  // is set at the monitor's own west face so the body rides the outside of it, not
  // through it. Foot just west of the edge, leaning east onto the ridge top.
  {
    id: "RIDGE_W",
    at: [75.1, 8.2, 9.0],
    onto: "MEETING_RIDGE",
    faceX: -1,
    faceZ: 0,
  },
  // The same ridge from the south slope, set at the monitor's SOUTH face (z=10.4):
  // foot just south of the edge, leaning north onto the ridge top.
  {
    id: "RIDGE_S",
    at: [78.0, 8.2, 10.6],
    onto: "MEETING_RIDGE",
    faceX: 0,
    faceZ: 1,
  },
  // Off the ridge onto the louvre sill under the belfry.
  {
    id: "LOUVRE",
    at: [79.5, 11.2, 8.6],
    onto: "LOUVRE_SILL",
    faceX: -0.45,
    faceZ: -0.89,
  },
];

// The two ascents a ladder should NOT serve, authored as GRIPS instead. Each
// names a DRAWN solid the body genuinely grips, and the arming predicate
// (`alignClimbToGrip`) checks the structure spans the rise and tops out with
// clearance — the same gate a ladder passes, not an exemption keyed on the link.
export const GRIPS: GripPlacementSpec[] = [
  // D2_OUTSIDE -> E_BUTTRESS: the body climbs the solid `buttress-stepped-stone`
  // (HOLLIS_BUTTRESS), whose set-offs read as masonry holds. A bolted ladder up
  // it would read worse than the stone already drawn. The foot stands north of
  // the buttress (z=17.4, the buttress ends at z=16.8), so the outward face is +Z.
  {
    id: "GRIP_BUTTRESS",
    at: [75.4, 0, 17.4],
    onto: "HOLLIS_BUTTRESS",
    faceX: 0,
    faceZ: 1,
    support: "HOLLIS_BUTTRESS",
    kind: "STEPPED_MASONRY",
  },
  // F_LOW -> F_CROWN (the Liberty Elm): honest holds up the bole/boughs. It will
  // not bolt a ladder to a tree, and the elm's own trunk (LIBERTY_ELM_TRUNK,
  // solid to 12 m) is the structure gripped. The foot sits under the crown at
  // (79, 2.6); the outward face points from the bole back at the climber.
  {
    id: "GRIP_ELM_CROWN",
    at: [79.0, 6.4, 2.6],
    onto: "BOUGH_CROWN",
    faceX: -0.74,
    faceZ: 0.67,
    support: "LIBERTY_ELM_TRUNK",
    kind: "BOUGHS",
  },
];
