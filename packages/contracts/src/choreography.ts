// Serializable presentation-only choreography machinery. These cues never
// mutate world state, learner state, outcomes, or the event log. Concrete cue
// id tables (e.g. Boston's DAY1_CUES) are chapter content.

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
