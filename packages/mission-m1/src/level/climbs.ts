// The vertical ascents, declared.
//
// Every other move in this level is inferred: the reader walks forward until
// the ground steps up, finds a face, measures it, and offers a verb. That works
// because there is something to find. A vertical ascent has nothing — the two
// route nodes share an x and a z, the body stands in the middle of a floor and
// goes straight up, and no amount of looking distinguishes it from standing
// under a canopy that happens to be within reach.
//
// The mission spent a morning on both sides of that. With the reader guessing
// generously it climbed players up through market awnings and scaffold boards
// from anywhere underneath; with it guessing carefully the Town House, the
// clock, the cornice, the meeting-house ridge and the Liberty Elm all went
// silent and there was no route to the objective at all. The clock stands 3.5m
// inside its own ledge and the cornice 5.7m inside its own: no bound that means
// anything reaches them, because they are not near an edge.
//
// So the twelve places where this level genuinely wants a straight climb are
// written down here, each one against the route link it exists to serve, and
// route.test.ts checks that the two still agree. Everywhere else the reader's
// half-metre reach applies and a body under the middle of a floor is offered
// nothing.

import { climbVolume } from "../authoring.js";
import type { ClimbSpec } from "../types.js";

export const CLIMBS: ClimbSpec[] = [
  // ---- B_SHAMBLES: the merchant's house — the covert drop-in ---------------
  // Off the Shambles crate up the goods-ladder in the merchant's open window
  // onto the projecting balcony ledge, and out of the parlour up the window
  // reveal onto the leads. Both are straight-up climbs the reader would not
  // otherwise offer (a ledge over a crate, a floor under an eave), so they are
  // written down here against the links they serve.
  // ALL THREE MERCHANT VOLUMES RETIRED 31-Jul, and leaving them behind is what
  // killed the covert climb-in.
  //
  // They were authored when the chain was laddered. The re-mass that same day
  // took the ladders out and left the volumes, which is precisely the mistake
  // the C_ASCENT note below warns about: a climb volume does not ENABLE a deck
  // mantle, it RESTRICTS one. With a volume over the foot and no ladder or grip
  // to validate it, `readRaisedSurface` refuses at probe.ts:502-511 and the
  // climb is silently never offered. Driving real stepFlow up the chain, the
  // body sat on the Shambles crate at 2.15 and was offered BLOCKED, then
  // RUN_OFF — the whole covert entry into the merchant's house was dead, and no
  // gate in the tree said so. The three steps are ordinary lipped ledges now
  // (parlour floor 4.00 → gallery 5.70 → eave 7.10, rises 1.85 / 1.70 / 1.40,
  // every one inside the mantle band) and they need nothing here.

  // ---- C_ASCENT: the Town House, twice round and up the tower --------------
  // The two scaffold climb volumes were REMOVED 31-Jul with the staging
  // regeneration, and removing them is what makes the ascent work rather than
  // what breaks it. A climb volume does not enable a deck mantle; it RESTRICTS
  // one. `readRaisedSurface` refuses the ascent wherever a volume covers the
  // surface and no ladder or grip validates it at that foot, and passes an
  // ordinary lipped ledge straight through. With the ladders retired, a volume
  // left behind would have refused every step on the new staging — silently, and
  // only in play. The seven staging lifts are bare lipped board, which is what a
  // scaffold is, and they need nothing here.
  climbVolume({
    section: "C_ASCENT",
    serves: "C_GALLERY_EMID->C_CLOCK",
    onto: "CLOCK_LEDGE",
    at: [58.3, 5.6, -4.0],
    halfX: 0.8,
    halfZ: 1.2,
    note: "Under the clock ledge's north edge, where it overhangs the east gallery. This is the lip a normal ascent climbs onto — not the mid-gallery interior 4m south, nor the exposed edge half a metre north that the tower watch sees.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_CLOCK->C_CORNICE_E",
    onto: "CORNICE_E",
    at: [58.3, 7.9, 0],
    halfX: 0.8,
    halfZ: 1.2,
    note: "Clock ledge to cornice, the deepest-set climb in the mission at 5.7m in.",
  }),
  climbVolume({
    section: "C_ASCENT",
    serves: "C_LEADS_TOWERFOOT->C_TOWER_PLINTH",
    onto: "TOWER_PLINTH",
    at: [52.0, 12.4, 2.9],
    halfX: 1.4,
    halfZ: 0.9,
    note: "The foot of the tower, standing on the leads.",
  }),

  // ---- E_LEAP: the meeting house and the steeple ---------------------------
  climbVolume({
    section: "E_LEAP",
    serves: "D2_OUTSIDE->E_BUTTRESS",
    onto: "HOLLIS_BUTTRESS",
    at: [75.4, 0, 17.4],
    halfX: 1.2,
    halfZ: 1.1,
    note: "Ground to the buttress set-off at the corner of the meeting house.",
  }),
  climbVolume({
    section: "E_LEAP",
    serves: "E_BUTTRESS->E_LEANTO",
    onto: "HOLLIS_LEANTO",
    at: [75.4, 2.6, 16.2],
    halfX: 1.2,
    halfZ: 0.7,
    note: "Buttress to lean-to roof. The buttress top sits 1.6m inside the lean-to's boards.",
  }),
  // The two MEETING_RIDGE volumes RETIRED 01-Aug with the RIDGE_W/RIDGE_S
  // ladders they served, and retired IN THE SAME COMMIT deliberately. A volume
  // that outlives its ladder does not fail loudly — it keeps answering
  // `climbVolumeAt` for a chain that has been re-authored around it and silently
  // refuses the new ascent. That is exactly how the merchant's covert entry was
  // dead for a rebuild, and the LOUVRE note below warns about it too; this is
  // the third time. Both volumes served the single 3.0m rise onto the walk,
  // which is now the two mantles D_MEETING_ROOF -> E_MEETING_STEP -> E_RIDGE
  // (and E_GAMBREL_S -> E_GAMBREL_STEP -> E_RIDGE_W on the south face). Both
  // steps are ordinary lipped ledges in front of the body and need no volume.
  // The E_RIDGE->E_LOUVRE volume RETIRED 31-Jul with LOUVRE_SILL and the LOUVRE
  // ladder. The belfry set-offs are staggered onto separate faces now, so each
  // step is an ordinary lipped ledge in front of the body and needs nothing
  // authored — and a volume left behind here would have refused all three, the
  // way the merchant's leftovers did.

  // ---- F_TREE: the Liberty Elm --------------------------------------------
  // RETIRED 31-Jul with GRIP_ELM_CROWN. The note here used to read "the crown
  // overhangs the standing spot on every side", which was written about the tree
  // and was also an exact description of why the ascent had to be authored at
  // all: F_LOW stood 0.1 m inside BOUGH_CROWN's own rect, so the forward read
  // skipped the surface as overhead and only the vertical `readOverhead` fallback
  // could offer it — behind a volume, and therefore behind a grip. F_LOW now
  // stands at the crown's WEST RIM (x<78.6), where the crown is a face in front
  // of the body and the 1.90 m rise is an ordinary mantle. Nothing is authored
  // for it, which is the point: a volume RESTRICTS a deck mantle rather than
  // enabling one, so leaving it behind would have refused the new climb.
];
