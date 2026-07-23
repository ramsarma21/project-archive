import type {
  AuthoredMotion,
  ChoreographyActorId,
  ChoreographyCue,
  InputRequest,
  PresentationDirective,
  Speaker,
} from "@pa/contracts";
import { DAY1_CUES } from "@pa/chapter-boston";
import {
  INTERIOR_STORY_LOCAL,
  interiorPoint,
  type InteriorVec3,
} from "./interiorManifest.js";

const ip = (locationId: string, local: InteriorVec3): [number, number, number] =>
  interiorPoint(locationId, local);

// World layout v3 (Bible §3): Mercer stays the anchor at [0, south row]
// (fronts now at z≈11), Thomas at [-70, north row], Pike at [+30, south],
// Custom House at [+55, south], Clarke at [-32, south], checkpoint at the
// market (x≈-56), rider post at the north-alley mouth (x≈-95), and the
// Liberty Tree pocket at [+95, -25] past the east gate.
export const STAGE_ANCHORS: Record<string, [number, number, number]> = {
  STREET_ARRIVAL: [-6, 0, 1.5],
  MERCER_DOOR_OUTSIDE: [-1.3, 0, 7.1],
  // Exterior-facing point used only before the independent scene swap.
  MERCER_ENTRY_FACE: [-0.31, 0, 11.0],
  MERCER_DOOR_INSIDE: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_DOOR_INSIDE),
  MERCER_DOOR_EXIT_FACE: ip("MERCER_PRESS", [0, 0, -9]),
  MERCER_PLAYER_CENTER: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PLAYER_CENTER),
  // A pressman's step back from the working face: the head camera stands
  // here, so the lever sweep and the platen stay ahead of the near plane.
  MERCER_PLAYER_PRESS: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PLAYER_PRESS),
  MERCER_ABIGAIL_DESK: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_ABIGAIL_DESK),
  MERCER_ABIGAIL_PRESS: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_ABIGAIL_PRESS),
  MERCER_PRESS_BED: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PRESS_BED),
  // Working face of the press: the procedural lever/platen/bed rig stands
  // here, in front of the press-common GLB, facing the pressman.
  MERCER_PRESS_RIG: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PRESS_RIG),
  MERCER_PROOF_TABLE: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PROOF_TABLE),
  MERCER_SHEET_HANDOFF: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_SHEET_HANDOFF),
  MERCER_ABIGAIL_HAND: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_ABIGAIL_HAND),
  MERCER_PLAYER_CATCH: ip("MERCER_PRESS", INTERIOR_STORY_LOCAL.MERCER_PLAYER_CATCH),
  THOMAS_PLAYER: ip("THOMAS_COUNTINGHOUSE", INTERIOR_STORY_LOCAL.THOMAS_PLAYER),
  THOMAS_ACTOR: ip("THOMAS_COUNTINGHOUSE", INTERIOR_STORY_LOCAL.THOMAS_ACTOR),
  THOMAS_WORK: ip("THOMAS_COUNTINGHOUSE", INTERIOR_STORY_LOCAL.THOMAS_WORK),
  THOMAS_COUNTER: ip("THOMAS_COUNTINGHOUSE", INTERIOR_STORY_LOCAL.THOMAS_COUNTER),
  PIKE_PLAYER: ip("PIKE_OFFICE", INTERIOR_STORY_LOCAL.PIKE_PLAYER),
  PIKE_ACTOR: ip("PIKE_OFFICE", INTERIOR_STORY_LOCAL.PIKE_ACTOR),
  CUSTOMHOUSE_PLAYER: ip("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_PLAYER),
  CUSTOMHOUSE_CLERK: ip("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_CLERK),
  CUSTOMHOUSE_BOARD: ip("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_BOARD),
  // Tack spot: an arm's reach out from the board's display face, along the
  // posted sheet's outward normal (rotY 0.35 + PI => roughly south-west),
  // so the tack camera looks squarely at the face the notice lands on.
  CUSTOMHOUSE_TACKER: ip("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_TACKER),
  // Board-facing work spot: south of the notice board, squared to its face,
  // so a first-person shot from here reaches the board with nothing
  // (counter, desk) intersecting the frustum.
  CUSTOMHOUSE_READER: ip("CUSTOM_HOUSE", INTERIOR_STORY_LOCAL.CUSTOMHOUSE_READER),
  // The standing broadside board on the elm approach ("right in your path"),
  // clear of the barrel dressing and outside the forming crowd ring.
  CROWD_BOARD_POST: [86.9, 0, -19.4],
  CLARKE_PLAYER: [-32, 0, 8.6],
  CLARKE_ACTOR: [-32, 0, 10.4],
  RIDER_PLAYER: [-95, 0, -17],
  RIDER_ACTOR: [-96.8, 0, -18.2],
  CUSTOMS_PLAYER: [-56, 0, -2],
  CUSTOMS_OFFICER: [-56, 0, -4.4],
  CROWD_PLAYER: [89, 0, -19],
  CROWD_FOCUS: [95, 2.4, -25],
  CROWD_EFFIGY: [91.9, 3.6, -20.3],
  CROWD_MARCH_FAR: [113, 0, -26.5],
};

export const DAY1_CHOREOGRAPHY: Record<string, ChoreographyCue> = {
  [DAY1_CUES.ARCHIVE_INTAKE]: {
    cueId: DAY1_CUES.ARCHIVE_INTAKE,
    locationId: "ARCHIVE_TRANSIT",
    blockingMs: 650,
    camera: {
      shotId: "ARCHIVE_ESTABLISH",
      position: [-10.5, 2.9, 1.5],
      lookAt: [-6, 1.2, 1.5],
      transitionMs: 400,
    },
    actors: [{ actorId: "PLAYER", anchorId: "STREET_ARRIVAL", motion: "IDLE" }],
    props: [],
  },
  [DAY1_CUES.ARRIVE_BOSTON]: {
    cueId: DAY1_CUES.ARRIVE_BOSTON,
    locationId: "BOSTON_STREET",
    blockingMs: 1100,
    camera: {
      shotId: "BOSTON_ARRIVAL_WIDE",
      position: [-11.5, 3.2, 5.8],
      lookAt: [-2, 1.2, 3.2],
      transitionMs: 650,
    },
    actors: [{ actorId: "PLAYER", anchorId: "STREET_ARRIVAL", faceAnchorId: "MERCER_DOOR_OUTSIDE", motion: "IDLE" }],
    props: [],
  },
  [DAY1_CUES.ENTER_MERCER]: {
    cueId: DAY1_CUES.ENTER_MERCER,
    locationId: "BOSTON_STREET",
    blockingMs: 600,
    camera: {
      shotId: "MERCER_DOOR_APPROACH",
      position: [-1.3, 2.0, 5.3],
      lookAt: [-1.3, 1.2, 10.5],
      transitionMs: 420,
      holdUntilInput: true,
    },
    actors: [
      { actorId: "PLAYER", anchorId: "MERCER_DOOR_OUTSIDE", faceAnchorId: "MERCER_ENTRY_FACE", motion: "IDLE" },
    ],
    props: [],
  },
  [DAY1_CUES.CATCH_SHEET]: {
    cueId: DAY1_CUES.CATCH_SHEET,
    locationId: "MERCER_PRESS",
    blockingMs: 1200,
    camera: {
      shotId: "ABIGAIL_SHEET_HANDOFF",
      position: ip("MERCER_PRESS", [0, 1.45, -4.2]),
      lookAt: ip("MERCER_PRESS", [-1.8, 1.18, -1.2]),
      transitionMs: 380,
      holdUntilInput: true,
      firstPerson: true,
    },
    actors: [
      { actorId: "PLAYER", anchorId: "MERCER_PLAYER_CENTER", faceAnchorId: "MERCER_ABIGAIL_PRESS", motion: "CATCH" },
      { actorId: "ABIGAIL", anchorId: "MERCER_ABIGAIL_PRESS", faceAnchorId: "MERCER_PLAYER_CENTER", motion: "HANDOFF" },
    ],
    props: [{
      propId: "FRESH_SHEET",
      state: "HELD_ACTOR",
      anchorId: "MERCER_SHEET_HANDOFF",
      actorId: "ABIGAIL",
    }],
  },
  [DAY1_CUES.PRESS_PIKE_PROOF]: {
    cueId: DAY1_CUES.PRESS_PIKE_PROOF,
    locationId: "MERCER_PRESS",
    blockingMs: 1000,
    camera: {
      shotId: "PRESS_WORK_CLOSE",
      position: ip("MERCER_PRESS", [-2.0, 1.6, -1.5]),
      lookAt: ip("MERCER_PRESS", [-4.2, 1.02, 1.2]),
      transitionMs: 420,
      holdUntilInput: true,
      firstPerson: true,
    },
    actors: [
      { actorId: "PLAYER", anchorId: "MERCER_PLAYER_PRESS", faceAnchorId: "MERCER_PRESS_RIG", motion: "PRESS" },
      { actorId: "ABIGAIL", anchorId: "MERCER_ABIGAIL_DESK", faceAnchorId: "MERCER_PLAYER_PRESS", motion: "IDLE" },
    ],
    props: [{ propId: "PIKE_PROOF", state: "ON_PRESS", anchorId: "MERCER_PRESS_BED" }],
  },
  [DAY1_CUES.STAMP_PROOF_COMPARE]: {
    cueId: DAY1_CUES.STAMP_PROOF_COMPARE,
    locationId: "MERCER_PRESS",
    blockingMs: 850,
    camera: {
      // Looks down at the two physical proofs on the table; aimed low so
      // the sheets ride the upper frame, above the centered offer panel.
      shotId: "PROOF_INSERT",
      position: ip("MERCER_PRESS", [1.8, 1.85, 2.5]),
      lookAt: ip("MERCER_PRESS", [1.8, 0.42, 4.2]),
      transitionMs: 360,
      holdUntilInput: true,
      firstPerson: true,
    },
    actors: [
      { actorId: "PLAYER", anchorId: "MERCER_PLAYER_CENTER", faceAnchorId: "MERCER_PROOF_TABLE", motion: "READ" },
      { actorId: "ABIGAIL", anchorId: "MERCER_ABIGAIL_DESK", faceAnchorId: "MERCER_PROOF_TABLE", motion: "IDLE" },
    ],
    props: [
      { propId: "OLD_PROOF", state: "ON_TABLE", anchorId: "MERCER_PROOF_TABLE" },
      { propId: "PIKE_PROOF", state: "ON_TABLE", anchorId: "MERCER_PROOF_TABLE" },
    ],
  },
  [DAY1_CUES.LEAVE_MERCER]: {
    cueId: DAY1_CUES.LEAVE_MERCER,
    locationId: "MERCER_PRESS",
    blockingMs: 800,
    camera: {
      shotId: "MERCER_DEPARTURE",
      position: ip("MERCER_PRESS", [3.0, 2.0, -5.0]),
      lookAt: ip("MERCER_PRESS", [0, 1.1, -8.0]),
      transitionMs: 420,
    },
    actors: [
      { actorId: "PLAYER", anchorId: "MERCER_DOOR_INSIDE", faceAnchorId: "MERCER_DOOR_EXIT_FACE", motion: "WALK" },
      { actorId: "ABIGAIL", anchorId: "MERCER_ABIGAIL_DESK", faceAnchorId: "MERCER_DOOR_INSIDE", motion: "TALK" },
    ],
    props: [{ propId: "DELIVERY_BUNDLE", state: "HELD_PLAYER", actorId: "PLAYER" }],
  },
  // ---- August 14 fixed event: directed witness set-piece at the great elm.
  // All of these hold the camera until input (historical-lock control state);
  // the EventDirector stages the crowd, organizer, effigy, march, and glow.
  "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1": {
    cueId: "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 900,
    camera: {
      shotId: "EVENT_OBSERVE_WIDE",
      position: [84.5, 4.4, -16.6],
      lookAt: [91.9, 2.0, -20.3],
      transitionMs: 1100,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "IDLE" }],
    props: [],
  },
  "BOS.MD01.ACT.EVENT_ONRAMP.v1": {
    cueId: "BOS.MD01.ACT.EVENT_ONRAMP.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 700,
    camera: {
      shotId: "EVENT_ONRAMP_THICKENING",
      position: [88.9, 2.5, -14.8],
      lookAt: [91.9, 2.7, -20.2],
      transitionMs: 900,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "IDLE" }],
    props: [],
  },
  "BOS.MD01.ACT.EVENT_CLIMB.v1": {
    cueId: "BOS.MD01.ACT.EVENT_CLIMB.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 800,
    camera: {
      shotId: "EVENT_CLIMB_VANTAGE",
      position: [87.6, 5.0, -16.4],
      lookAt: [92.2, 2.6, -20.6],
      transitionMs: 1000,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "IDLE" }],
    props: [],
  },
  "BOS.MD01.ACT.EVENT_PUSH.v1": {
    cueId: "BOS.MD01.ACT.EVENT_PUSH.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 800,
    camera: {
      shotId: "EVENT_PUSH_LOW",
      position: [90.5, 1.15, -16.0],
      lookAt: [92.0, 3.3, -20.4],
      transitionMs: 800,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "WALK" }],
    props: [],
  },
  "BOS.MD01.ACT.EVENT_CHANT.v1": {
    cueId: "BOS.MD01.ACT.EVENT_CHANT.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 800,
    camera: {
      shotId: "EVENT_CHANT_MID",
      position: [88.6, 1.8, -16.6],
      lookAt: [91.7, 2.8, -20.1],
      transitionMs: 800,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "GESTURE" }],
    props: [],
  },
  "BOS.MD01.CUE.FIXED_EVENT_MARCH.v1": {
    cueId: "BOS.MD01.CUE.FIXED_EVENT_MARCH.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 1500,
    camera: {
      // Reduced-motion static frame; the EventDirector camera rig animates the
      // push-in and the pan that tracks the carried effigy otherwise.
      shotId: "EVENT_MARCH_DIRECTED",
      position: [88.3, 2.25, -16.9],
      lookAt: [91.9, 2.6, -20.3],
      transitionMs: 1200,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_EFFIGY", motion: "IDLE" }],
    props: [],
  },
  "BOS.MD01.CUE.FIXED_EVENT_AFTERMATH.v1": {
    cueId: "BOS.MD01.CUE.FIXED_EVENT_AFTERMATH.v1",
    locationId: "LIBERTY_TREE_APPROACH",
    blockingMs: 1400,
    camera: {
      shotId: "EVENT_AFTERMATH_GLOW",
      position: [88.6, 3.2, -15.0],
      lookAt: [113, 2.6, -26.5],
      transitionMs: 1400,
      holdUntilInput: true,
    },
    actors: [{ actorId: "PLAYER", anchorId: "CROWD_PLAYER", faceAnchorId: "CROWD_MARCH_FAR", motion: "IDLE" }],
    props: [],
  },
};

interface ContextStage {
  playerAnchor: string;
  actorAnchor?: string;
  cameraPosition: [number, number, number];
  cameraLookAt: [number, number, number];
  // Focus-read offers: a third-person framing of the physical read object
  // (the poster/board itself), with a clean line of sight to it. Stages
  // without read framing fall back to the conversation shot.
  readPlayerAnchor?: string;
  readFaceAnchor?: string;
  readCameraPosition?: [number, number, number];
  readCameraLookAt?: [number, number, number];
}

const CONTEXT_STAGES: Record<string, ContextStage> = {
  MERCER_PRESS: {
    playerAnchor: "MERCER_PLAYER_CENTER",
    actorAnchor: "MERCER_ABIGAIL_DESK",
    cameraPosition: ip("MERCER_PRESS", [3.2, 1.9, -4.8]),
    cameraLookAt: ip("MERCER_PRESS", [0.4, 1.15, -0.8]),
  },
  THOMAS_COUNTINGHOUSE: {
    playerAnchor: "THOMAS_PLAYER",
    actorAnchor: "THOMAS_ACTOR",
    cameraPosition: ip("THOMAS_COUNTINGHOUSE", [5.0, 2.0, -4.8]),
    cameraLookAt: ip("THOMAS_COUNTINGHOUSE", [0.5, 1.15, -0.5]),
  },
  PIKE_OFFICE: {
    playerAnchor: "PIKE_PLAYER",
    actorAnchor: "PIKE_ACTOR",
    cameraPosition: ip("PIKE_OFFICE", [-4.5, 1.9, -4.5]),
    cameraLookAt: ip("PIKE_OFFICE", [1.0, 1.15, -0.5]),
  },
  CUSTOM_HOUSE: {
    playerAnchor: "CUSTOMHOUSE_PLAYER",
    actorAnchor: "CUSTOMHOUSE_CLERK",
    cameraPosition: ip("CUSTOM_HOUSE", [-5.0, 2.0, -5.5]),
    cameraLookAt: ip("CUSTOM_HOUSE", [2.0, 1.2, 2.0]),
    // The proclamation offer frames the notice board square-on from the open
    // floor south of it (the posted sheets face SSW), west of the counter
    // (counter spans x 53..57 at z 14.9..16.3) so nothing crosses the ray.
    // Aim low so the board rides the upper third of the frame, clear of the
    // centered offer panel.
    readPlayerAnchor: "CUSTOMHOUSE_READER",
    readFaceAnchor: "CUSTOMHOUSE_BOARD",
    readCameraPosition: ip("CUSTOM_HOUSE", [-7.0, 1.6, 2.0]),
    readCameraLookAt: ip("CUSTOM_HOUSE", [-9.5, 0.98, 6.3]),
  },
  CLARKE_DOORWAY: {
    playerAnchor: "CLARKE_PLAYER",
    actorAnchor: "CLARKE_ACTOR",
    cameraPosition: [-28.7, 2.0, 7.1],
    cameraLookAt: [-32, 1.2, 9.7],
  },
  RIDER_POST: {
    playerAnchor: "RIDER_PLAYER",
    actorAnchor: "RIDER_ACTOR",
    cameraPosition: [-92.1, 2.1, -14.2],
    cameraLookAt: [-96, 1.2, -17.7],
  },
  CUSTOMS_POST: {
    playerAnchor: "CUSTOMS_PLAYER",
    actorAnchor: "CUSTOMS_OFFICER",
    cameraPosition: [-52.6, 2.0, 0.3],
    cameraLookAt: [-56, 1.2, -3.3],
  },
  LIBERTY_TREE_APPROACH: {
    playerAnchor: "CROWD_PLAYER",
    actorAnchor: "CROWD_FOCUS",
    cameraPosition: [84.4, 3.0, -14.3],
    cameraLookAt: [93, 2.2, -23.2],
    // The crowd-board offer pushes in past the barrel dressing to frame the
    // standing broadside board, aimed low so it rides above the offer panel;
    // the gathering stays behind the camera.
    readPlayerAnchor: "CROWD_PLAYER",
    readFaceAnchor: "CROWD_BOARD_POST",
    readCameraPosition: [88.9, 1.7, -17.9],
    readCameraLookAt: [86.8, 0.8, -19.5],
  },
};

const SPEAKER_ACTOR: Partial<Record<Speaker, ChoreographyActorId>> = {
  ABIGAIL: "ABIGAIL",
  THOMAS: "THOMAS",
  PIKE: "PIKE",
  CLARKE: "CLARKE",
  RIDER: "RIDER",
  OFFICER: "OFFICER",
  CROWD: "CROWD",
  PLAYER: "PLAYER",
};
const LOCATION_ACTOR: Partial<Record<string, ChoreographyActorId>> = {
  MERCER_PRESS: "ABIGAIL",
  THOMAS_COUNTINGHOUSE: "THOMAS",
  PIKE_OFFICE: "PIKE",
  CUSTOM_HOUSE: "OFFICER",
  CLARKE_DOORWAY: "CLARKE",
  RIDER_POST: "RIDER",
  CUSTOMS_POST: "OFFICER",
  LIBERTY_TREE_APPROACH: "CROWD",
};

export function choreographyFor(
  cueId: string | null | undefined,
  context?: {
    locationId: string;
    request: InputRequest | null;
    present: PresentationDirective[];
  },
): ChoreographyCue | null {
  if (!cueId) return null;
  const authored = DAY1_CHOREOGRAPHY[cueId];
  if (authored) return authored;
  if (
    !context?.request ||
    context.request.kind === "FREE_ROAM" ||
    context.request.kind === "BREATHER" ||
    context.request.kind === "DAY_END"
  ) return null;
  const stage = CONTEXT_STAGES[context.locationId];
  if (!stage) return null;

  const dialogue = [...context.present].reverse().find((directive) => directive.kind === "DIALOGUE");
  const actorId =
    (dialogue?.kind === "DIALOGUE" ? SPEAKER_ACTOR[dialogue.speaker] : undefined) ??
    LOCATION_ACTOR[context.locationId];
  const playerSpeaking = actorId === "PLAYER";
  const thirdPersonEffort =
    cueId === "BOS.MD01.ACT.THOMAS_HAUL.v1" ||
    cueId === "BOS.MD01.ACT.CUSTOMS_SLIP.v1" ||
    cueId.startsWith("BOS.MD01.ACT.EVENT_") ||
    cueId === "BOS.MD01.ACT.OBSERVE_CROWD_FORMING.v1";
  const mechanicMotion: AuthoredMotion =
    cueId === "BOS.MD01.ACT.THOMAS_HAUL.v1"
      ? "CARRY"
      : cueId === "BOS.MD01.ACT.EVENT_CHANT.v1"
        ? "GESTURE"
      : cueId === "BOS.MD01.ACT.CUSTOMS_SLIP.v1" || cueId.startsWith("BOS.MD01.ACT.EVENT_")
        ? "WALK"
      : cueId === "BOS.MD01.ACT.CONCEAL_HANDBILLS.v1" ||
          cueId === "BOS.MD01.ACT.THOMAS_CIRCULAR_HANDOFF.v1" ||
          cueId === "BOS.MD01.ACT.PIKE_PROOF_HANDOFF.v1" ||
          cueId === "BOS.MD01.ACT.RIDER_QUICK_HANDOFF.v1" ||
          cueId === "BOS.MD01.ACT.RIDER_GAP_HANDOFF.v1"
        ? "HANDOFF"
      : context.request.kind === "MECHANIC"
      ? context.request.params.kind === "PRESS"
        ? "PRESS"
        : context.request.params.kind === "SORT"
          ? "READ"
          : context.request.params.kind === "EFFORT"
            ? "PRESS"
            : "HANDOFF"
      // A focus-read OFFER is a look at the object in the world, not the
      // read itself: the player stands considering it. The legible document
      // only appears in the post-open holographic read panel.
      : "IDLE";
  const props =
    cueId === "BOS.MD01.ACT.THOMAS_HAUL.v1"
      ? [{ propId: "CLOTH_BOLT", state: "STAGED" as const, anchorId: "THOMAS_WORK" }]
      : context.request.kind === "MECHANIC" && context.request.params.kind === "PRESS"
        ? [{ propId: "WORK_SHEET", state: "ON_PRESS" as const, anchorId: "MERCER_PRESS_BED" }]
        : context.request.kind === "MECHANIC" && context.request.params.kind === "PLACE"
          ? [{ propId: "CUSTOMHOUSE_NOTICE", state: "ON_TABLE" as const, anchorId: "CUSTOMHOUSE_BOARD" }]
          : [];
  // Focus-read offers are deliberately NOT first person: pre-choice, the
  // player sees the object in the world (third-person contextual framing).
  // First person with the document in hand would leak the tracked read.
  const focusRead = context.request.kind === "FOCUS_READ";
  const firstPerson = context.request.kind === "MECHANIC" && !thirdPersonEffort;
  // Press-work mechanics at Mercer's face the press bed, not the room's
  // conversation anchor: the player stands at the press and watches the
  // lever/platen rig perform the pull.
  const pressWork =
    context.locationId === "MERCER_PRESS" &&
    context.request.kind === "MECHANIC" &&
    (context.request.params.kind === "PRESS" ||
      context.request.params.kind === "PRINT_JOB" ||
      cueId.includes("FINAL_PRESS_PULL"));
  // The haul shuttle plays under the mechanic panel: frame the stack-to-
  // counter lane in the lower band of the shot so the carry stays visible.
  const haulWork = cueId === "BOS.MD01.ACT.THOMAS_HAUL.v1";
  // Board-facing work at the Custom House (tacking the notice) stands the
  // player at the reader spot so the counter never fills the frustum.
  const boardWork =
    context.locationId === "CUSTOM_HOUSE" &&
    context.request.kind === "MECHANIC" &&
    (context.request.params.kind === "PLACE" ||
      context.request.params.kind === "POST_JOB");
  const readStaged = focusRead &&
    Boolean(stage.readCameraPosition && stage.readCameraLookAt);
  const cameraPosition: [number, number, number] = haulWork
    ? ip("THOMAS_COUNTINGHOUSE", [5.5, 2.3, -4.0])
    : readStaged
      ? stage.readCameraPosition!
      : stage.cameraPosition;
  const cameraLookAt: [number, number, number] = haulWork
    ? ip("THOMAS_COUNTINGHOUSE", [-6.5, 1.8, 3.8])
    : readStaged
      ? stage.readCameraLookAt!
      : stage.cameraLookAt;
  const playerAnchor =
    focusRead && stage.readPlayerAnchor
      ? stage.readPlayerAnchor
      : boardWork
        ? "CUSTOMHOUSE_TACKER"
        : stage.playerAnchor;
  const playerPosition = STAGE_ANCHORS[playerAnchor];
  const actorPosition = stage.actorAnchor ? STAGE_ANCHORS[stage.actorAnchor] : undefined;
  const pressRig = STAGE_ANCHORS.MERCER_PRESS_RIG;
  // Handoff/fold framing around the center input panel: gazing at the
  // receiver's chest pitches the head camera down just enough that their
  // face rides the visible band ABOVE the panel while the held bundle and
  // the player's own hands stay in the band BELOW it.
  const handoffWork = context.request.kind === "MECHANIC" && mechanicMotion === "HANDOFF";
  const firstPersonLookAtPoint: [number, number, number] | undefined =
    context.request.kind === "MECHANIC" && context.request.params.kind === "PLACE" && STAGE_ANCHORS.CUSTOMHOUSE_BOARD
      ? [
          STAGE_ANCHORS.CUSTOMHOUSE_BOARD[0],
          STAGE_ANCHORS.CUSTOMHOUSE_BOARD[1] + 0.35,
          STAGE_ANCHORS.CUSTOMHOUSE_BOARD[2],
        ]
      : pressWork && pressRig
        ? [pressRig[0], pressRig[1] + 1.02, pressRig[2]]
        : actorPosition
          ? [actorPosition[0], actorPosition[1] + (handoffWork ? 0.9 : 1.05), actorPosition[2]]
          : undefined;

  return {
    cueId,
    locationId: context.locationId,
    blockingMs: context.present.length > 0 ? 650 : 350,
    camera: {
      shotId: `CONTEXT_${context.locationId}_${context.request.kind}`,
      position: firstPerson && playerPosition
        ? [playerPosition[0], playerPosition[1] + 1.48, playerPosition[2]]
        : cameraPosition,
      lookAt: firstPerson && firstPersonLookAtPoint
        ? firstPersonLookAtPoint
        : cameraLookAt,
      transitionMs: 360,
      holdUntilInput: context.request.kind !== "CONTINUE" && context.request.kind !== "ACK",
      firstPerson,
    },
    actors: [
      {
        actorId: "PLAYER",
        anchorId: playerAnchor,
        faceAnchorId: pressWork
          ? "MERCER_PRESS_RIG"
          : focusRead && stage.readFaceAnchor
            ? stage.readFaceAnchor
            : boardWork
              ? "CUSTOMHOUSE_BOARD"
              : actorId && actorId !== "PLAYER" && stage.actorAnchor
                ? stage.actorAnchor
                : undefined,
        motion: playerSpeaking ? "TALK" : mechanicMotion,
      },
      ...(actorId && actorId !== "PLAYER" && stage.actorAnchor
        ? [{
            actorId,
            anchorId: stage.actorAnchor,
            faceAnchorId: playerAnchor,
            // During a read offer the room's occupant is not part of the
            // beat; they keep working rather than turning to talk.
            motion: context.request.kind === "MECHANIC"
              ? mechanicMotion
              : focusRead
                ? "IDLE" as const
                : "TALK" as const,
          }]
        : []),
    ],
    props,
  };
}
