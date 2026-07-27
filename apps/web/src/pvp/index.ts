// apps/web/src/pvp — the browser half of PvP.
//
// What is in here: a transport, a session, and four screens. What is deliberately
// NOT in here: any simulation. Every health value, every position and every verdict
// on screen was minted by the API process; this directory moves bytes and draws
// them.
//
// Boundaries this directory respects, because ten agents are working at once:
//
//   apps/web/src/duel/**    imported, never edited. The input controller, the control
//                           list, the yard's props, the clip policy, the weapon socket,
//                           the camera framing and the particle textures all come from
//                           there. The arena renderer that uses them lives here,
//                           because that directory is another agent's this week — see
//                           installPvpArena.tsx.
//   apps/web/src/mission/** imported, never edited. `duelView()` is read to report
//                           whether duel visuals exist; it is never mounted here.
//   packages/pvp/**         the server's policy. Not a dependency of @pa/web: the
//                           wire shapes in protocol.ts mirror it across HTTP.
//   packages/duel/**        a real dependency, and the source of the vocabulary and
//                           of the bullet economy. No tuning number is retyped.
//
// The hub can mount `PvpScreen` whenever its owner is ready; until then the
// duelling ground is its own page at /src/pvp/pvp.html, which is also what makes
// two accounts on one machine workable.

export { PvpScreen, type PvpScreenProps } from "./PvpScreen.js";
export { PvpLobby, type PvpLobbyProps } from "./PvpLobby.js";
export { PvpHud, type PvpHudProps } from "./PvpHud.js";
export { PvpQuestion, type PvpQuestionProps } from "./PvpQuestion.js";
export { PvpArena, type PvpArenaProps } from "./PvpArena.js";
export { PvpResult, type PvpResultProps } from "./PvpResult.js";
export { PvpLeaderboard, type PvpLeaderboardProps } from "./PvpLeaderboard.js";

export { usePvpSession, type PvpPhase, type PvpSession } from "./usePvpSession.js";

export {
  clearPvpArenaView,
  pvpArenaMode,
  pvpArenaView,
  registerPvpArenaView,
  type PvpArenaMode,
  type PvpArenaView,
  type PvpArenaViewProps,
} from "./arenaPort.js";

// The arena renderer, and the one call that lights it up. Any entry point that mounts
// `PvpScreen` makes this call before the app mounts, exactly as main.tsx calls
// `installMissionDuel()`; skip it and `PvpArena` consults an empty registry and says
// so rather than drawing a stand-in.
export { installPvpArena } from "./installPvpArena.js";
export { SnapshotArena } from "./SnapshotArena.js";
export { ArenaStage, type ArenaStageProps } from "./ArenaStage.js";

export {
  SIGHTING_GHOST_SECONDS,
  createSnapshotFeed,
  staleBodyOpacity,
  type ArenaCues,
  type ArenaSample,
  type ArenaSource,
  type DrawnBall,
  type OpponentSighting,
  type SnapshotFeed,
} from "./arenaFeed.js";

export {
  blockerCells,
  containFit,
  drawnArena,
  fillBlocker,
  pushOutside,
  type ArenaProp,
  type DrawnArena,
} from "./arenaScene.js";

// PvP does not own a camera: the poses and the follow rates are the duel's. This is the
// one clause it decides for itself — what the camera does while a question is open.
export {
  answeringCameraSettles,
  cameraPhaseFor,
  isAnsweringBeat,
} from "./arenaCamera.js";

export {
  EMPTY_PROGRESS,
  convergence,
  observeProgress,
  outcomeLine,
  type ConvergenceReading,
  type MatchProgress,
  type RoundRecord,
} from "./progress.js";

export {
  GOOGLE_SIGN_IN_URL,
  POLL_MS_LIVE,
  POLL_MS_LOBBY,
  POLL_MS_QUESTION,
  frameFrom,
  httpPvpTransport,
  pollIntervalFor,
  setCsrfToken,
  type AnswerAck,
  type IntentAck,
  type IntentFrame,
  type LeaderboardRow,
  type LobbyCreated,
  type LobbyJoined,
  type LobbyRead,
  type MatchRead,
  type MatchResultPayload,
  type MatchSnapshot,
  type OpponentView,
  type ProjectileView,
  type PvpActiveState,
  type PvpCall,
  type PvpIdentity,
  type PvpTransport,
  type QuestionPayload,
  type SelfView,
} from "./protocol.js";

export { MATCH_CODE_LENGTH, refusalText } from "./refusals.js";
