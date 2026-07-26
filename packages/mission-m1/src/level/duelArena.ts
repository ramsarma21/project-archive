// The rope-walk yard: six rounds, six honest breaks.
//
// "The constable breaks line of sight every twenty seconds" is only interesting
// if the break is a property of the geometry rather than a scripted teleport.
// So the arena declares six break stations, and duelArena.test.ts proves each
// one against the same `segmentClear` the game uses: from the station the boss
// really is hidden from most of the yard, from his peek he really can shoot,
// and the player really does have to move to find him again.
//
// The cover reads at a glance because it is graded:
//   HIGH  (2.35-2.60m)  breaks a standing sight line outright
//   MID   (1.55m)       breaks it if you crouch
//   LOW   (1.15m)       the laying floor: splits the yard, hides nobody
// and one raised stage gives the fight an up as well as a sideways.

import type { DuelArena } from "../types.js";
import { rect } from "../authoring.js";

export const ARENA: DuelArena = {
  id: "ROPEWALK_YARD",
  section: "G_YARD",
  bounds: rect(88, 100, -6.5, 6.5),
  floorY: 0,
  gateNodeId: "G_GATE",
  playerSpawn: [90.5, 0, 0.0],
  bossSpawn: [95.5, 0, -1.6],
  rounds: 6,
  roundSeconds: 20,
  cover: [
    { id: "CV_HAY_NW", massId: "COVER_HAY_NW", grade: "HIGH" },
    { id: "CV_CRANE", massId: "COVER_CRANE_BASE", grade: "HIGH" },
    { id: "CV_STACK_SE", massId: "COVER_STACK_SE", grade: "HIGH" },
    { id: "CV_BARRELS_NE", massId: "COVER_BARRELS_NE", grade: "LOW" },
    { id: "CV_BARRELS_SW", massId: "COVER_BARRELS_SW", grade: "LOW" },
    { id: "CV_LAYING_RIG", massId: "COVER_LAYING_RIG", grade: "LOW" },
    { id: "CV_STAGE", massId: "YARD_STAGE", grade: "LOW" },
  ],
  // Solved against the yard's own geometry rather than placed by eye: each
  // station hides him from at least seven of the ten positions a player will
  // actually fight from, each peek shows him at least half of them again, and
  // the six of them walk a circuit so no two rounds look the same.
  breakStations: [
    {
      id: "BREAK_R1",
      round: 1,
      pos: [88.6, 0, -4.5],
      peek: [88.6, 0, -2.5],
      behind: ["COVER_HAY_NW"],
      note: "The corner nearest the gate: round one is fought where the player came in.",
    },
    {
      id: "BREAK_R2",
      round: 2,
      pos: [91.0, 0, -6.1],
      peek: [88.6, 0, -6.1],
      behind: ["COVER_HAY_NW"],
    },
    {
      id: "BREAK_R3",
      round: 3,
      pos: [93.4, 0, -4.1],
      peek: [92.6, 0, -2.5],
      behind: ["COVER_CRANE_BASE"],
    },
    {
      id: "BREAK_R4",
      round: 4,
      pos: [98.6, 0, -4.5],
      peek: [97.0, 0, -2.5],
      behind: ["COVER_BARRELS_NE"],
      note: "The long move, five metres across the yard behind the laying floor.",
    },
    {
      id: "BREAK_R5",
      round: 5,
      pos: [99.0, 0, 3.1],
      peek: [96.6, 0, 2.3],
      behind: ["COVER_STACK_SE"],
    },
    {
      id: "BREAK_R6",
      round: 6,
      pos: [92.2, 0, 4.7],
      peek: [91.4, 0, 2.3],
      behind: ["COVER_BARRELS_SW"],
      note: "Back round to the player's side of the yard for the last round.",
    },
  ],
  // Farthest-point sampled across the clear floor, so the break test is scored
  // against the whole yard and not a convenient handful of spots.
  playerStations: [
    [88.6, 0, -6.1],
    [99.4, 0, 5.9],
    [88.6, 0, 5.1],
    [99.4, 0, -5.3],
    [93.8, 0, -0.9],
    [93.8, 0, 5.9],
    [88.6, 0, -0.5],
    [94.2, 0, -6.1],
    [97.0, 0, 2.3],
    [91.4, 0, 2.3],
  ],
};
