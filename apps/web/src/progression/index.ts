// The client's durable-progression layer.
//
// One rule governs everything behind this barrel: the server decides, the
// client displays. XP, Level, Rank, the attempt ordinal, whether a mission is
// spent, which Codex cards are PvP-legal and which abilities are unlocked are
// all read from the progression snapshot and none of them is ever computed,
// stored or asserted here. What the client owns is presentation, a cache it
// labels as a cache, a durable queue of outcomes it has not managed to deliver
// yet, and which four of its unlocked abilities it carries.

export {
  authorizeAttempt,
  type AttemptAuthorization,
  type AuthorizationRefusal,
  type AuthorizationResult,
} from "./authorize.js";
export {
  commitForResult,
  missionOutcomeRequest,
  moduleCompletionRequest,
  type PayloadResult,
} from "./commit.js";
export { deployStanding, type DeployStanding } from "./gate.js";
export { snapshotBelongsTo } from "./identity.js";
export {
  EQUIPPED_ABILITY_SLOTS,
  loadoutScopeKey,
  poolFor,
  readEquipped,
  resolveEquipped,
  writeEquipped,
  type LoadoutScope,
  type ResolvedEquipped,
} from "./loadout.js";
export {
  classifyDelivery,
  enqueueOutcome,
  flushOutcomes,
  outstandingOutcomes,
  retryDelayMs,
  type OutboxFlush,
  type OutboxQueue,
  type OutboxVerdict,
} from "./outbox.js";
export {
  attemptsSpent,
  masteredConceptIds,
  missionStanding,
  newRunnerView,
  projectProgression,
  standingFor,
  type AbilityStanding,
  type CodexStanding,
  type MissionStanding,
  type ProgressionView,
} from "./projection.js";
export {
  forgetProgressionCache,
  useProgression,
  type ProgressionApi,
  type ProgressionOptions,
  type ProgressionSource,
} from "./useProgression.js";
