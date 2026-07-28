// Patrols, diversions, crowds and catches.
//
// Four watchers exist but at most two are ever live at once, so the player is
// always solving a two-cone problem, never a five-cone one. Each cone is
// authored to deny one specific line — which is asserted in stealth.test.ts by
// sampling the line's own route nodes against the cone over a full patrol
// cycle, rather than by asserting that a number looks about right.

import type {
  BlendVolume,
  CatchVolume,
  DiversionAnchor,
  LightVolume,
  PatrolSpec,
  PrecisionBeat,
} from "../types.js";
import { rect } from "../authoring.js";

export const THROW_BEAT_NOTE =
  "A throw is a real object on a real arc, so it can fall short, and a short throw here strikes one of the bodies standing between you and the wall. The noise then happens at that body, three metres from you, instead of eighteen metres away — attention arrives where you are standing. That is the failure the verb needs in order to be a skill.";

export const PATROLS: PatrolSpec[] = [
  {
    id: "WATCH_SHAMBLES",
    section: "B_SHAMBLES",
    asset: "constable-rigged",
    role: "the market watch",
    kind: "PATROL",
    perchIgnore: [],
    waypoints: [
      [17.5, 0, -1.2],
      [27.0, 0, 1.2],
      [38.5, 0, -0.8],
    ],
    speedMps: 1.15,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 30,
    rangeM: 12,
    scanAmplitudeDeg: 0,
    scanRateDegPerSec: 0,
    baseYaw: 0,
    phaseOffsetsS: [0, 6.5, 13.0],
    denies: ["street-line"],
    note: "Walks the market with his back turned half the time. His west end sits inside earshot of the printshop hay wain, so the eight-second dive announces you and the alley descent does not.",
  },
  {
    id: "SENTRY_GAOL",
    section: "B_SHAMBLES",
    asset: "officer-rigged",
    role: "the sentry at the gaol door",
    kind: "POSTED",
    perchIgnore: ["GAOL"],
    waypoints: [[24.2, 0, -2.9]],
    speedMps: 0,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 26,
    rangeM: 10,
    scanAmplitudeDeg: 42,
    scanRateDegPerSec: 24,
    baseYaw: Math.PI / 2,
    phaseOffsetsS: [0, 2.4, 4.8],
    denies: ["mid-line"],
    note: "Sweeps across the stall canopies. Standing still, he is the one you cannot outrun — only redirect.",
  },
  {
    id: "WATCH_OLD_BRICK",
    section: "C_ASCENT",
    asset: "officer-rigged",
    role: "the watch on the Old Brick tower",
    kind: "POSTED",
    perchIgnore: ["OLD_BRICK_TOWER", "OLD_BRICK"],
    waypoints: [[52.0, 13.6, -13.2]],
    speedMps: 0,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 30,
    rangeM: 18,
    scanAmplitudeDeg: 34,
    scanRateDegPerSec: 19,
    baseYaw: 0,
    phaseOffsetsS: [0, 3.1, 6.2],
    denies: ["exposed"],
    note: "Eight metres above the balcony and looking down, so crouching behind the rail does nothing. Only the pediment, the corner, or the ground break this one.",
  },
  {
    id: "WATCH_DOCK",
    section: "B2_THRONG",
    asset: "constable-rigged",
    role: "the watch working the market floor",
    kind: "PATROL",
    perchIgnore: [],
    waypoints: [
      [33.0, 0, 8.6],
      [38.6, 0, 16.0],
      [29.0, 0, 18.4],
    ],
    speedMps: 1.05,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 34,
    rangeM: 13,
    scanAmplitudeDeg: 0,
    scanRateDegPerSec: 0,
    baseYaw: 0,
    phaseOffsetsS: [0, 7.0, 14.0],
    denies: ["blend"],
    note: "He walks through the crowd rather than round it, which is what makes the pierce rule bite: enter the throng in front of him and he watched you do it.",
  },
  {
    id: "SENTRY_ARCADE",
    section: "B2_THRONG",
    asset: "officer-rigged",
    role: "the sentry in the arcade",
    kind: "POSTED",
    perchIgnore: [],
    waypoints: [[43.6, 0, 13.0]],
    speedMps: 0,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 24,
    rangeM: 15,
    scanAmplitudeDeg: 30,
    scanRateDegPerSec: 16,
    baseYaw: Math.PI,
    phaseOffsetsS: [0, 2.8, 5.6],
    denies: ["dark"],
    note: "The price of the dark route. Unlit costs him 55% of his read, not all of it, so the arcade is quieter than the square but never free.",
  },
  {
    id: "SENTRY_ROPEWALK",
    section: "D2_ROPEWALK",
    asset: "dockhand-rigged",
    role: "the ropewalk's night man",
    kind: "POSTED",
    perchIgnore: [],
    // Mid-shed on the south side, looking north-west along the laying floor.
    //
    // He used to stand at the west gable facing SOUTH — at the wall, with his
    // back to every metre of route in the building. His cone therefore denied
    // nothing: the darkest place in the mission was also the safest, the bales
    // and the tarring partition were cover against nobody, and the loud drop was
    // loud for its own sake. A night man watches the floor he is paid to watch,
    // and from here his sweep covers the walk from the capstan to the stage,
    // which is the route.
    waypoints: [[72.6, 0, 23.6]],
    speedMps: 0,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 30,
    rangeM: 14,
    scanAmplitudeDeg: 38,
    scanRateDegPerSec: 20,
    baseYaw: (-135 * Math.PI) / 180,
    phaseOffsetsS: [0, 3.4, 6.8],
    denies: ["dark"],
    note: "One man and a lantern in a shed with no windows. He is the reason the 5.2m drop is a decision, the reason the bales and the tarring gear are cover, and the reason the beam is walked rather than run.",
  },
  {
    id: "CONSTABLE_ORANGE",
    section: "D_ROOFLINE",
    asset: "constable-rigged",
    role: "the constable coming up Orange Street",
    kind: "PATROL",
    perchIgnore: [],
    waypoints: [
      [86.0, 0, 0.6],
      [72.0, 0, -0.6],
      [63.0, 0, 0.4],
    ],
    speedMps: 1.55,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 32,
    rangeM: 14,
    scanAmplitudeDeg: 0,
    scanRateDegPerSec: 0,
    baseYaw: 0,
    phaseOffsetsS: [0, 4.0, 8.0],
    denies: ["street-line"],
    note: "The man who is going to paper over the board, walking the other way up the street you are running above. His line passes under the roof crossing, so the 5.3m roll on the far side is audible to him and the quiet south roofs are not.",
  },
  {
    id: "BILLMAN_HOLLIS",
    // The roofline crossing his stop bridges (D_SROOF_E onto the meeting leads),
    // not E_LEAP: the leap section carries no reroute budget by design, and a
    // section with a watcher needs one (route.test.ts). D_ROOFLINE already hosts
    // CONSTABLE_ORANGE and its budget covers being read on the crossing.
    section: "D_ROOFLINE",
    asset: "dockhand-rigged",
    role: "the printer's bill-sticker",
    kind: "POSTED",
    perchIgnore: [],
    // On the meeting-house leads themselves, at the west parapet, where the
    // notices go up. He is NOT a stealth cone: he hosts the relocated STAMP_SCOPE
    // perspective encounter (ROPEWALK_STOP, re-fictioned as the bill-sticker) on
    // the direct roofline the route lane built over Hollis Meeting, so the
    // guided line no longer has to dive through the ropewalk shed to reach the
    // beat. He stands on the flat lead roof (y=8.20) clear of the raised monitor,
    // a short walk south of the player's landing, and closes on the player to
    // speak when the stop arms. His sweep is off (scanAmplitude 0) and faces the
    // wall he is pasting, so he polices no line — the encounter machine turns him
    // to face the player during its approach.
    waypoints: [[74.9, 8.2, 12.0]],
    speedMps: 0,
    capsuleHeightM: 1.55,
    coneHalfAngleDeg: 30,
    rangeM: 8,
    scanAmplitudeDeg: 0,
    scanRateDegPerSec: 0,
    baseYaw: (-90 * Math.PI) / 180,
    phaseOffsetsS: [0, 3.0, 6.0],
    denies: [],
    note: "The printer's paste-man, up on the meeting-house leads by lantern to hang the night's bills. He is the speaker for the relocated STAMP_SCOPE stop: his whole trade is the printed paper the Act taxes, so he is the man to argue the tax's reach to. Posted, not patrolling, and authored to deny no route line — the beat is the stop, not the cone.",
  },
];

export const DIVERSIONS: DiversionAnchor[] = [
  {
    id: "DIVERT_PASSAGE",
    section: "B_SHAMBLES",
    asset: "tankard-cluster",
    throwFromNodes: ["B_STREET_W", "B_CART_0", "B_PENTICE"],
    landsAt: [24.5, 0, 6.4],
    noiseRadiusM: 9,
    pullsPatrols: ["WATCH_SHAMBLES"],
    opensLinks: ["B_VAULT_OUT->B_DUCK", "B_DUCK->B_STREET_MID"],
    note: "A pewter tankard into the butchers' passage turns the watch south and opens the whole street line.",
  },
  {
    // A 15-metre throw over the Shambles crowd, and the only place in the
    // mission the verb's actual skill is asked for.
    //
    // `solveThrow` picks the flatter of its two roots, so range and loft are one
    // decision: at the tuned speed an 18m throw passes about 3.3m over the ground
    // four metres out and clears a standing body comfortably, while a short toss
    // arrives at chest height and hits whoever is in front of you. That means a
    // long throw over a crowd is a real thing to learn — and M1 authored nothing
    // longer than 12.8m, so it was never available. This is 17.1m from the west
    // end of the market with three bodies of the CROWD_SHAMBLES cluster standing
    // on the line, which is the lesson in one throw.
    //
    // It pulls the Dock Square watch rather than the market's own, so the throw is
    // spent on the section AHEAD: the crossing is where the blend has to complete
    // uninterrupted, and this is how a player buys that before arriving.
    id: "DIVERT_STALL_GAP",
    section: "B_SHAMBLES",
    asset: "tankard-cluster",
    throwFromNodes: ["B_STREET_W", "B_VAULT_OUT"],
    landsAt: [34.6, 0, 2.6],
    noiseRadiusM: 12,
    pullsPatrols: ["WATCH_DOCK"],
    opensLinks: ["B2_WELL->B2_THRONG_W", "B2_THRONG_W->B2_DUCK"],
    bodiesInLine: [
      [28.0, 0, 1.4],
      [31.0, 0, 2.0],
      [33.2, 0, 2.4],
    ],
    note: THROW_BEAT_NOTE,
  },
  {
    id: "DIVERT_SHUTTERS",
    section: "B_SHAMBLES",
    asset: "coin-paper-set",
    // B_CRATES_A is gone from this list: from there the anchor is 1.17m away at
    // -68 degrees, which is not a throw, it is dropping the thing at your feet.
    throwFromNodes: ["B_CANOPY_1", "B_CANOPY_2"],
    landsAt: [29.0, 0, -3.4],
    noiseRadiusM: 8,
    pullsPatrols: ["SENTRY_GAOL"],
    opensLinks: ["B_CANOPY_2->B_CANOPY_3", "B_CANOPY_3->B_CANOPY_4"],
    note: "Rattles the shutters at the gaol's east end and swings the sentry's sweep away from the canopy run behind it.",
  },
  {
    id: "DIVERT_ARCADE_WALL",
    section: "B2_THRONG",
    asset: "tankard-cluster",
    throwFromNodes: ["B2_WELL", "B2_THRONG_W"],
    // Was [45.4, 0, 16.2], which was broken in both directions: 18.38m from
    // B2_WELL, so past the 18m ceiling and never offered at all; and from
    // B2_THRONG_W the object came to rest 5.9m short, stopped by ARCADE_PIER_3,
    // because the aim point was on the far side of the colonnade. On the square
    // side of the pier line it is 8.4m and 14.4m, both clear, and the sentry is
    // 5.2m from the impact so it still turns him.
    landsAt: [40.8, 0, 17.4],
    noiseRadiusM: 11,
    pullsPatrols: ["SENTRY_ARCADE"],
    opensLinks: [
      "B2_ARCADE_STOCK->B2_ARCADE_PIER",
      "B2_ARCADE_PIER->B2_ARCADE_CASKS",
    ],
    bodiesInLine: [
      [35.0, 0, 16.0],
      [37.5, 0, 16.5],
      [39.0, 0, 16.9],
    ],
    note: THROW_BEAT_NOTE,
  },
  {
    id: "DIVERT_BELL_ROPE",
    section: "C_ASCENT",
    asset: "protest-torch",
    // C_SCAFF_1 is gone from this list for the same reason B_CRATES_A is gone
    // from the shutters: 2.72m at -53 degrees is a drop, not a throw.
    throwFromNodes: ["C_SQUARE_W", "C_LANE_HAY"],
    landsAt: [44.0, 0, -9.0],
    noiseRadiusM: 12,
    pullsPatrols: ["WATCH_OLD_BRICK"],
    opensLinks: ["C_GALLERY_W->C_GALLERY_HOOD", "C_GALLERY_HOOD->C_GALLERY_E"],
    note: "A torch into the scaffolding at the Town House's west end, thrown before the climb. It turns the tower watch away from the balcony and the reflex-time beat never fires: pre-empting the set piece is a legitimate way to beat it.",
  },
];

/**
 * Rigged civilians per crowd. THE MECHANICAL FLOOR IS FOUR.
 *
 * `density` is read in exactly one line of the stealth field — the gate in
 * clusterContaining — and it is a cliff rather than a slope. Three bodies hide
 * nobody at all; four produce a complete break; a hundred produce exactly the
 * same complete break. Blend strength is insideTicks/enterTicks and nothing
 * else. Measured in crowd.test.ts rather than read off the source.
 *
 * So the count is an art budget, not a design number, and this is the single
 * place to change it. Twelve is three times the floor, which leaves the art
 * pipeline room to cut for frame time without silently switching the mechanic
 * off — at four it still works, at three it stops existing.
 *
 * The number that must NOT shrink is radiusM. It is the distance over which
 * the blend holds, it costs nothing to render, and entering a different cluster
 * resets the 0.7s ramp — so two small crowds are strictly worse than one large
 * one, and cutting radius to save bodies would buy nothing and cost the verb.
 */
export const CROWD_CIVILIANS = 12;

export const BLEND: BlendVolume[] = [
  {
    id: "CROWD_DOCK_MAIN",
    section: "B2_THRONG",
    asset: "crowd-market-1765",
    centre: [33.0, 0, 13.2],
    radiusM: 6.4,
    civilians: CROWD_CIVILIANS,
    note: "One cluster covering the whole crossing, not a chain of knots: switching cluster restarts the ramp, so a player crossing on the blend must never leave it. The square is already full of stalls, carts and a pump, so twelve rigged bodies plus that dressing reads as a market.",
  },
  {
    id: "CROWD_SHAMBLES",
    section: "B_SHAMBLES",
    asset: "crowd-market-1765",
    centre: [32.0, 0, 0.0],
    radiusM: 5.0,
    civilians: CROWD_CIVILIANS,
    note: "Butchers and their customers. Same count, smaller footprint, so it reads denser than the square.",
  },
  {
    id: "CROWD_LIBERTY",
    section: "F_TREE",
    asset: "crowd-market-1765",
    centre: [80.0, 0, 0.6],
    radiusM: 6.0,
    civilians: CROWD_CIVILIANS,
    note: "The crowd that gathered under the elm and would not disperse. Scenery from the boughs and cover on the ground, and the player spends most of this section eight metres above it.",
  },
];

/** Pre-dawn ambient. Everything not inside an authored volume is this. */
export const AMBIENT_LIGHT = 0.34;

export const LIGHT: LightVolume[] = [
  {
    id: "LIGHT_QUEEN_STREET",
    section: "A_LEADS",
    rect: rect(0, 17, -4, 4),
    level: 0.55,
    note: "Shop lanterns still burning on Queen Street. Bright enough that the street line costs you something from the first second.",
  },
  {
    id: "LIGHT_DASSETT_ALLEY",
    section: "A_LEADS",
    rect: rect(13, 17, -17, -3.2),
    level: 0.06,
    note: "The alley descent is not merely quieter than the dive, it is nearly unlit. Two systems agreeing on the same answer is how a line reads as the careful one.",
  },
  {
    id: "LIGHT_SHAMBLES",
    section: "B_SHAMBLES",
    rect: rect(17, 42, -3.4, 3.4),
    level: 0.7,
    note: "Butchers work before dawn and they work by lamplight.",
  },
  {
    id: "LIGHT_TOWNHOUSE_SQUARE",
    section: "C_ASCENT",
    rect: rect(42, 62, -11.2, 11.2),
    level: 0.5,
  },
  {
    id: "LIGHT_TOWNHOUSE_LANE",
    section: "C_ASCENT",
    rect: rect(46, 58, -11.2, -5.5),
    level: 0.15,
    note: "The north lane is in the building's own shadow, which is why the fast way up the scaffolding is also the dark one.",
  },
  {
    id: "LIGHT_LIBERTY_CORNER",
    section: "F_TREE",
    rect: rect(74, 88, -7, 7),
    level: 0.85,
    note: "Torches under the elm. The crowd brought them, and they are why the precision beat happens somewhere you can be seen.",
  },
];

export const CATCHES: CatchVolume[] = [
  // Only three of these are dive targets. A leap of faith is offered at drops
  // of 6m or more against an explicit acceptance radius, so a catch that merely
  // breaks a chain drop must not be advertised as one — otherwise the solver
  // offers a dive at the top of the printshop and the descent stops being a run.
  {
    id: "CATCH_PRINTSHOP_HAY",
    section: "A_LEADS",
    kind: "HAY",
    asset: "hay-cart",
    // Centred on the two-wain footprint (HAY_WAIN_W x10.0-12.2 + HAY_WAIN_E
    // x12.2-14.4, both z-0.2..3.0), not biased east onto HAY_WAIN_E alone. At
    // x=13.3 the 1.6m disc reached east to 14.9m, 0.5m past the drawn hay's east
    // edge (14.4) — the "caught by air beside the hay" overrun (88% over hay). At
    // x=12.2, the footprint centre, the same 1.6m disc lands x[10.6,13.8] z[-0.2,
    // 3.0], wholly over the two wains (a BLOCK asset that fills its rect), so the
    // acceptance disc is backed by real hay everywhere. Radius unchanged: the hay
    // is wide enough, it was only off-centre.
    centre: [12.2, 2.2, 1.4],
    radiusM: 1.6,
    offersLeap: false,
    note: "The 4.9m roll off the south-east corner, onto the pair of hay wains. A roll, not a dive: the drop is under the 6m floor.",
  },
  {
    id: "CATCH_LANE_HAY",
    section: "C_ASCENT",
    kind: "HAY",
    asset: "hay-cart",
    // Already centred on LANE_HAY (x48.0-51.0, z-10.4..-8.2, a single 3.0x2.2m
    // wain), so recentering cannot help: the 1.6m disc (3.2m across) was simply
    // wider than the wain's 2.2m depth and spilled 0.5m off each z edge onto air
    // (75% over hay). The acceptance radius is cut to 1.1m — the half-depth the
    // wain actually presents — so the disc it advertises is backed by hay on
    // every side. This is a bail-out catch, NOT an offered dive (offersLeap
    // false), so it feeds no leap the solver picks and tightening it makes no
    // guided move harder; it only stops the catch claiming hay that is not there.
    centre: [49.5, 2.2, -9.3],
    radiusM: 1.1,
    offersLeap: false,
    note: "The balcony's bail-out when the tower watch calls out. 1.1m to sit inside the lane wain.",
  },
  {
    id: "LEAP_CROWN",
    section: "F_TREE",
    kind: "BOUGH",
    asset: "liberty-elm-hero",
    centre: [79.6, 8.3, 1.9],
    radiusM: 1.6,
    offersLeap: true,
    note: "The signature dive: 7.5m off the steeple gallery into the crown of the elm, landing at the nail height.",
  },
  {
    id: "LEAP_UPPER",
    section: "F_TREE",
    kind: "BOUGH",
    asset: "liberty-elm-hero",
    centre: [82.0, 11.2, 2.6],
    radiusM: 1.6,
    offersLeap: true,
    note: "8.2m off the weathervane platform onto the upper limb. Nearer to the vane lip than the crown target, so the solver picks it.",
  },
  {
    id: "LEAP_YARD_HAY",
    section: "G_YARD",
    kind: "HAY",
    asset: "hay-cart",
    // Centred on COVER_HAY_NW's footprint (see geometry.ts, widened to 3.2x3.2 to
    // back this disc). This is an OFFERED dive (offersLeap true), so its radius is
    // pinned at the reader's leapTargetRadiusM (1.6m) by traversability.test —
    // shrinking it to stop the "caught by air" overrun is not open, because the
    // reader assumes a 1.6m acceptance and a smaller one would advertise a target
    // it then refuses. So the fix here is the OTHER lever the brief names: a
    // bigger, better-placed catching object. At [90.4,-3.2] the 1.6m disc reached
    // 0.6m west onto the wall side and 0.8m south into open yard air (59% over
    // hay); centred on COVER_HAY_NW's grown footprint at [90.65,-4.0] — the wain
    // extended into the dead NW corner (see geometry.ts) — the 9.0m dive lands on
    // real hay across the whole acceptance radius. The wain grows only toward the
    // corner walls, not into the duel's playing area, so the six line-of-sight
    // breaks the fight is graded on are untouched.
    centre: [90.65, 2.2, -4.0],
    radiusM: 1.6,
    offersLeap: true,
    note: "9.0m off the upper limb, over 3.6m of yard wall, straight into the duel, onto the corner hay wain. Only that limb is high enough to clear the brick.",
  },
];

export const PRECISION: PrecisionBeat = {
  id: "POST_JOB_LIBERTY_TREE",
  section: "F_TREE",
  target: [80.15, 9.45, 0.55],
  stance: [79.6, 8.3, 0.4],
  stanceSurface: "BOUGH_CROWN",
  facingYaw: Math.atan2(0.55, 0.15),
  patterns: [
    {
      id: "POST_PATTERN_A",
      beatsMs: [0, 900, 1750, 2500, 3450, 4300],
      windowMs: 150,
    },
    {
      id: "POST_PATTERN_B",
      beatsMs: [0, 780, 1560, 2600, 3380, 4160],
      windowMs: 145,
    },
    {
      id: "POST_PATTERN_C",
      beatsMs: [0, 1000, 1650, 2300, 3300, 4600],
      windowMs: 155,
    },
  ],
  passQuality: 0.7,
  minPhaseQuality: 0.5,
  note: "Six hammer strokes into the trunk beside the effigy, eight metres up, with the crowd roaring underneath and the constable coming up Orange Street. Nothing to read; it is pure timing.",
};
