// D2 — through the ropewalk. Verbs: SLIDE, CLIMB_OVER, STEP_UP, in the dark.
//
// Going *through* a building instead of over it. A Boston ropewalk was a long
// covered shed, a couple of hundred feet of spinning floor with the laying
// tackle running down the middle, and it is the one building type in the town
// that is naturally a corridor. That makes it the right place for the beats the
// roofline cannot give: a low ceiling, a tight camera, a slide, a partition too
// thin to stand on, and no sky.
//
// It is also the mission's only dark interior, which matters because the same
// `visibility` that reads the balcony reads this at 0.45 of the exposure. A
// player who has spent ninety seconds learning that height is safety arrives
// somewhere height does not exist and darkness is the substitute.
//
// The shell is authored as four walls plus a roof with a hole in it, not as one
// solid box, because the whole point is that the inside is a place.

import { deck, prop, rect, soffit } from "../authoring.js";
import type { DeckSpec, LightVolume, MassSpec } from "../types.js";

const masses: MassSpec[] = [];
const decks: DeckSpec[] = [];

export const ROPEWALK_BOUNDS = rect(58, 80, 17, 27);
const ROOF_Y = 8.6;

// ---- shell -----------------------------------------------------------------
// Gaps in the north wall are the exit door; the west wall is blind.
const walls: Array<[string, ReturnType<typeof rect>]> = [
  ["ROPEWALK_WALL_N_W", rect(58.0, 73.4, 17.0, 17.6)],
  ["ROPEWALK_WALL_N_E", rect(76.6, 80.0, 17.0, 17.6)],
  ["ROPEWALK_WALL_S", rect(58.0, 80.0, 26.4, 27.0)],
  ["ROPEWALK_WALL_W", rect(58.0, 58.6, 17.0, 27.0)],
  ["ROPEWALK_WALL_E", rect(79.4, 80.0, 17.0, 27.0)],
];
walls.forEach(([id, r]) => {
  masses.push(
    prop({
      id,
      section: "D2_ROPEWALK",
      asset: "int-shell-ropewalk-a",
      rect: r,
      topY: ROOF_Y,
      landable: false,
      tags: ["interior-shell"],
    }),
  );
});

// The roof, as four decks around a hatch. A hole you drop through is the only
// honest way in: a door at street level would make this a detour rather than a
// continuation of the descent off the Town House.
//
// The roof stops exactly on the shell's own footprint, and it used to oversail it
// by 0.7m on all four sides as eaves. That was undrawable, not merely undrawn.
// `int-shell-ropewalk-a` is served from world/structures, so it draws with
// fit: "SHELL" — scaled per axis ONTO its box rather than fitted inside it — and
// the box is the union of the shell's own walls, 22 x 8.6 x 10. A shell therefore
// fills its box exactly and can never reach past it, so 0.7m of roof all the way
// round had nothing beneath it: the probe measured ROPEWALK_ROOF_E at 67.9% drawn
// and the west deck, which the roof run crosses, at 84.2%.
//
// Widening the shell's box instead was the other way out and is worse. The mesh's
// walls ARE its extremes — it was built to 22 x 8.6 x 10 at scale 1.0000 — so a
// 23.4 x 11.4 box stretches the walls outward with the eaves and leaves the wall
// collision 0.7m inside the visible wall, which puts a gap round the whole of the
// mission's only interior. Eaves you can stand on need something under them; eaves
// are the thing to give up.
const ROOF = rect(58.0, 80.0, 17.0, 27.0);
const HATCH = rect(74.6, 77.6, 19.8, 22.8);
decks.push(
  deck({
    id: "ROPEWALK_ROOF_W",
    section: "D2_ROPEWALK",
    asset: "int-shell-ropewalk-a",
    rect: rect(ROOF.minX, HATCH.minX, ROOF.minZ, ROOF.maxZ),
    y: ROOF_Y,
    carriedBy: [],
    tags: ["roof"],
  }),
  deck({
    id: "ROPEWALK_ROOF_E",
    section: "D2_ROPEWALK",
    asset: "int-shell-ropewalk-a",
    rect: rect(HATCH.maxX, ROOF.maxX, ROOF.minZ, ROOF.maxZ),
    y: ROOF_Y,
    carriedBy: [],
    tags: ["roof"],
  }),
  deck({
    id: "ROPEWALK_ROOF_N",
    section: "D2_ROPEWALK",
    asset: "int-shell-ropewalk-a",
    rect: rect(HATCH.minX, HATCH.maxX, ROOF.minZ, HATCH.minZ),
    y: ROOF_Y,
    carriedBy: [],
    tags: ["roof"],
  }),
  deck({
    id: "ROPEWALK_ROOF_S",
    section: "D2_ROPEWALK",
    asset: "int-shell-ropewalk-a",
    rect: rect(HATCH.minX, HATCH.maxX, HATCH.maxZ, ROOF.maxZ),
    y: ROOF_Y,
    carriedBy: [],
    tags: ["roof"],
  }),
);

// ---- inside ----------------------------------------------------------------

decks.push(
  deck({
    id: "ROPEWALK_TIE_BEAM",
    section: "D2_ROPEWALK",
    asset: "roof-walk-board-long",
    rect: rect(59.6, 79.0, 20.5, 22.1),
    y: 5.2,
    carriedBy: [],
    tags: ["beam"],
    note: "A tie beam the length of the shed, 1.6m wide. You land on it out of the hatch and run it in the dark with the floor four metres down.",
  }),
);

// The quiet way down, at the WEST gable.
//
// It used to be at the east end, two metres from the door, and that put the
// section's whole grammar the wrong way round: the loud 5.2m roll landed a
// runner at the far end of a floor they then had to cross, and the quiet bales
// dropped them beside the exit. So the guaranteed route was the short one, the
// three slides and partitions this section is BUILT around were reachable only
// off the loud drop, and a cautious player walked through a ropewalk without
// ever sliding under anything.
//
// Raw hemp belongs at the head of the walk anyway — it is spun from the west end
// toward the tackle — so the stacks come west, the beam is run its full length in
// the dark to get to them, and the floor is walked back east through the tarring
// gear to the door. The loud drop keeps its four seconds and now genuinely skips
// something.
masses.push(
  prop({
    id: "HEMP_BALES_HIGH",
    section: "D2_ROPEWALK",
    asset: "cargo-net-bundle",
    rect: rect(61.4, 64.6, 22.4, 25.4),
    topY: 3.2,
    tags: ["bales", "cover"],
    note: "2.0m below the beam's west end: a run-off, so the descent out of the roof never stops. Also the only full-height mass between the night man's post and the floor route.",
  }),
  prop({
    id: "HEMP_BALES_LOW",
    section: "D2_ROPEWALK",
    asset: "cargo-net-bundle",
    rect: rect(58.8, 61.4, 22.6, 25.2),
    topY: 1.1,
    tags: ["bales", "cover"],
  }),
  // The laying stage: half a step, wide enough to stand on, so the reader
  // resolves STEP_UP and a sprint crosses it without a pause.
  prop({
    id: "LAYING_STAGE",
    section: "D2_ROPEWALK",
    asset: "ropewalk-laying-rig",
    rect: rect(69.8, 78.0, 18.6, 20.4),
    topY: 0.34,
    tags: ["step-up"],
  }),
  // Too thin on top to stand on, so it is a CLIMB_OVER rather than a mantle.
  prop({
    id: "TAR_PARTITION",
    section: "D2_ROPEWALK",
    asset: "int-partition-board-a",
    rect: rect(67.4, 67.9, 17.9, 22.3),
    topY: 1.6,
    landable: false,
    tags: ["climb-over"],
    note: "0.5m deep: below the 0.75m a body needs on top, which is exactly what makes the reader pick CLIMB_OVER.",
  }),
  soffit({
    id: "STRETCHER_FRAME",
    section: "D2_ROPEWALK",
    asset: "duck-beam-frame",
    rect: rect(63.4, 64.6, 18.2, 20.4),
    baseY: 1.25,
    thickness: 1.2,
    tags: ["slide"],
    note: "Underside at 1.25m, inside the slide's 1.00-1.45m band. A standing body does not fit and a crouched one does not need to stop.",
  }),
  // The tarring floor's own stock, and the only hard cover on the walked half of
  // the interior. D2_OVER_OUT is read by the night man for 79% of his cycle —
  // the largest single exposure in the mission — with nothing whatsoever between
  // them across four metres of open floor.
  //
  // 1.10m is measured. He stands on the floor rather than above it, so here
  // height separates the two stances instead of deleting them both: the crouched
  // chest is behind 1.10m and the standing chest is not, which gives
  //
  //   standing, out on the floor     mean read 0.244
  //   standing, behind the barrels   mean read 0.073
  //   crouched behind them           mean read 0.000
  //
  // At 0.95m nothing fires and at 1.25m the standing read goes to zero as well.
  // It is also exactly BAND.BARREL and exactly the gaol barrels the player
  // vaulted in the Shambles, so the object says what it does before it is tested.
  prop({
    id: "TAR_BARRELS",
    section: "D2_ROPEWALK",
    asset: "barrel-group",
    rect: rect(69.2, 71.4, 20.5, 21.8),
    topY: 1.1,
    landable: false,
    tags: ["cover", "tar"],
    note: "Pitch barrels standing off the laying stage, between the tarring partition and the night man's post. Chest-high: they take half of a standing body and all of a crouched one.",
  }),
  prop({
    id: "ROPE_CAPSTAN",
    section: "D2_ROPEWALK",
    asset: "rope-coil-large",
    rect: rect(60.4, 61.5, 18.7, 19.9),
    topY: 1.05,
    tags: ["vault"],
    note: "Vaultable, and the only thing between the west wall and the slide.",
  }),
);

export const ROPEWALK_LIGHT: LightVolume[] = [
  {
    id: "LIGHT_ROPEWALK",
    section: "D2_ROPEWALK",
    rect: rect(58, 80, 17, 27),
    level: 0.1,
    note: "No windows worth the name. The darkest place in the mission, and the only one where standing still is safer than moving.",
  },
  {
    id: "LIGHT_ROPEWALK_DOOR",
    section: "D2_ROPEWALK",
    rect: rect(73.4, 76.6, 16.4, 18.6),
    level: 0.7,
    note: "Lamplight through the open door. The exit is the one lit patch inside, so leaving is the exposed part.",
  },
];

// Roof vents. The shed roof is twenty-two metres of surface the roof run had
// no reason to touch; two vents and a hatch at the far end turn it into the
// transition between the Town House and the interior, which is the one place
// where more of the same is the right answer because a transition's job is to
// breathe.
[69.0, 72.2].forEach((x, index) => {
  masses.push(
    prop({
      id: `ROPEWALK_VENT_${index}`,
      section: "D2_ROPEWALK",
      asset: "roof-chimney-stack",
      rect: rect(x, x + 1.1, 19.4, 20.5),
      baseY: ROOF_Y,
      topY: ROOF_Y + 1.05,
      tags: ["vault", "roof-run"],
    }),
  );
});

export const ROPEWALK_GEOMETRY = { masses, decks } as const;
