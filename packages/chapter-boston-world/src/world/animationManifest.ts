import type { AuthoredMotion } from "@pa/contracts";

export interface CharacterAnimationSpec {
  fallback: string;
  expected: readonly string[];
  motions: Partial<Record<AuthoredMotion, string>>;
}

const PLAYER_CLIPS = [
  "idle", "walk", "run", "leftTurn", "rightTurn", "reach", "search", "carry",
  "carryWalk", "handoff", "crouchIdle", "crouchWalk", "crouchLeft",
  "crouchRight", "crouchToStand", "climbUp", "climbDown", "vault", "work1",
  "work2", "cheer1", "cheer2", "talk", "talk2", "talk3", "talk4", "argu1",
  "argue2", "circleWalk1", "circleWalk2",
  // Locomotion physics clips (playerboy-v5-native): the standing/running free
  // jumps, the door-knock interaction, and the two humanoid door-handling
  // performances staged for later door work. Until the v5 GLB lands these
  // resolve to a graceful idle fallback (chooseAvailableClip warns once).
  "jump", "runJump", "knock", "doorOpenInward", "doorOpenOutward",
  // Feel-pass performances (2026-07-22 Mixamo pull): the Watch House
  // scolding stance, the ropewalk strand pull, and a standing paper read.
  "scolded", "ropePull", "read",
] as const;

// Clips that should play once and clamp (physics/motion owns displacement; the
// mixer only plays out the visible pose). Consumed by Character for fade length
// and by callers deciding loopOnce.
export const PLAYER_ACTION_CLIPS: ReadonlySet<string> = new Set([
  "jump", "runJump", "vault", "climbUp", "climbDown", "knock",
  "doorOpenInward", "doorOpenOutward",
]);
const NPC_CLIPS = [
  "idle", "walk", "run", "carryWalk", "work1", "work2", "talk", "talk2",
  "argu1", "argue2",
] as const;
// Per-character extensions beyond the shared NPC set (baked only onto the
// rigs that perform them; keeping them out of NPC_CLIPS avoids missing-clip
// warnings on the rest of the cast).
const CONSTABLE_CLIPS = [
  "idle", "walk", "run", "search", "talk", "talk2", "argu1", "reach",
  "shout", "satchelSearch",
] as const;
const TOWNCRIER_CLIPS = [...NPC_CLIPS, "shout"] as const;
const TOWNSMAN_CLIPS = [...NPC_CLIPS, "sitIdle", "sitTalk"] as const;
const PLAYER_MOTIONS: CharacterAnimationSpec["motions"] = {
  IDLE: "idle",
  WALK: "walk",
  TALK: "talk",
  GESTURE: "talk2",
  CATCH: "reach",
  PRESS: "work1",
  // A proper two-handed standing read (was the search rummage).
  READ: "read",
  HANDOFF: "handoff",
  CARRY: "carry",
};
const NPC_MOTIONS: CharacterAnimationSpec["motions"] = {
  IDLE: "idle",
  WALK: "walk",
  TALK: "talk",
  GESTURE: "talk2",
  CATCH: "talk2",
  PRESS: "work1",
  READ: "work2",
  HANDOFF: "talk2",
  CARRY: "carryWalk",
};
// Pike's rebaked conversational clips read best when he keeps a settled
// stance: plain talk for dialogue, the calmer talk2 gesture only for GESTURE,
// and a quiet idle while he receives the proof so his hands stay low for the
// first-person exchange (work1 bows to a table that is not under him).
const PIKE_MOTIONS: CharacterAnimationSpec["motions"] = {
  ...NPC_MOTIONS,
  TALK: "talk",
  GESTURE: "talk2",
  CATCH: "idle",
  HANDOFF: "idle",
  READ: "work2",
};

export const CHARACTER_ANIMATIONS: Record<string, CharacterAnimationSpec> = {
  "playerboy-rigged": { fallback: "idle", expected: PLAYER_CLIPS, motions: PLAYER_MOTIONS },
  "abigail-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "thomas-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "pike-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: PIKE_MOTIONS },
  "clarke-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "rider-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "officer-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "townsman-rigged": { fallback: "idle", expected: TOWNSMAN_CLIPS, motions: NPC_MOTIONS },
  "townswoman-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "constable-rigged": { fallback: "idle", expected: CONSTABLE_CLIPS, motions: NPC_MOTIONS },
  // World-v3 street archetypes (Bible §9): Meshy image-to-3D -> Meshy rig ->
  // rest-delta Mixamo bake, same production path as abigail-production.
  "dockhand-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "agitator-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "taxclerk-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
  "towncrier-rigged": { fallback: "idle", expected: TOWNCRIER_CLIPS, motions: NPC_MOTIONS },
  "goodwife-rigged": { fallback: "idle", expected: NPC_CLIPS, motions: NPC_MOTIONS },
};

export function clipForMotion(glbKey: string, motion: AuthoredMotion): string {
  return CHARACTER_ANIMATIONS[glbKey]?.motions[motion] ?? (
    motion === "WALK" ? "walk" : "idle"
  );
}

const warned = new Set<string>();

export function chooseAvailableClip(
  glbKey: string,
  requested: string,
  availableNames: readonly string[],
): string | null {
  const spec = CHARACTER_ANIMATIONS[glbKey];
  if (spec) {
    const missing = spec.expected.filter((name) => !availableNames.includes(name));
    const manifestWarning = `${glbKey}:manifest:${missing.join(",")}`;
    if (missing.length > 0 && !warned.has(manifestWarning)) {
      warned.add(manifestWarning);
      console.warn(`[animation] ${glbKey} is missing expected clips: ${missing.join(", ")}.`);
    }
  }
  if (availableNames.includes(requested)) return requested;
  const fallbackName = spec?.fallback ?? "idle";
  const fallback = availableNames.includes(fallbackName) ? fallbackName : availableNames[0] ?? null;
  const warningKey = `${glbKey}:${requested}:${fallback ?? "none"}`;
  if (!warned.has(warningKey)) {
    warned.add(warningKey);
    console.warn(
      `[animation] ${glbKey} has no "${requested}" clip; using ${fallback ? `"${fallback}"` : "a static pose"}.`,
    );
  }
  return fallback;
}
