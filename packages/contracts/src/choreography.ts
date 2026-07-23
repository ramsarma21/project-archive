// Serializable presentation-only choreography. These cues never mutate world
// state, learner state, outcomes, or the event log.
export const DAY1_CUES = {
  ARCHIVE_INTAKE: "BOS.MD01.CUE.ARCHIVE_INTAKE.v1",
  ARRIVE_BOSTON: "BOS.MD01.CUE.ARRIVE_BOSTON.v1",
  ENTER_MERCER: "BOS.MD01.ACT.ENTER_MERCER.v1",
  CATCH_SHEET: "BOS.MD01.ACT.CATCH_SHEET.v1",
  PRESS_PIKE_PROOF: "BOS.MD01.ACT.PRESS_PIKE_PROOF.v1",
  STAMP_PROOF_COMPARE: "BOS.MD01.CUE.STAMP_PROOF_COMPARE.v1",
  LEAVE_MERCER: "BOS.MD01.CUE.LEAVE_MERCER.v1",
} as const;

export type ChoreographyActorId =
  | "PLAYER"
  | "ABIGAIL"
  | "THOMAS"
  | "PIKE"
  | "CLARKE"
  | "RIDER"
  | "OFFICER"
  | "CROWD";

export type AuthoredMotion =
  | "IDLE"
  | "WALK"
  | "TALK"
  | "GESTURE"
  | "CATCH"
  | "PRESS"
  | "READ"
  | "HANDOFF"
  | "CARRY";

export interface ActorChoreography {
  actorId: ChoreographyActorId;
  anchorId: string;
  faceAnchorId?: string;
  motion: AuthoredMotion;
}

export interface CameraChoreography {
  shotId: string;
  position: [number, number, number];
  lookAt: [number, number, number];
  transitionMs: number;
  holdUntilInput?: boolean;
  firstPerson?: boolean;
}

export interface PropChoreography {
  propId: string;
  state: "HIDDEN" | "STAGED" | "HELD_PLAYER" | "HELD_ACTOR" | "ON_PRESS" | "ON_TABLE";
  anchorId?: string;
  actorId?: ChoreographyActorId;
}

export interface ChoreographyCue {
  cueId: string;
  locationId: string;
  blockingMs: number;
  camera?: CameraChoreography;
  actors: ActorChoreography[];
  props: PropChoreography[];
}
