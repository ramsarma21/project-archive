import { useEffect } from "react";
import type { PlayerApi } from "../Player.js";
import type { MotionState } from "../playerMotion.js";
import {
  CAPSULE_RADIUS,
  blockerIdsAt,
  type CollisionWorld,
} from "../collision.js";
import { createStamina, type StaminaState } from "../stamina.js";
import { routeBlockerMatrix } from "../outdoorCollisionAdapter.js";
import { QA_RUNTIME_ENABLED } from "../qaEnvironment.js";

// QA-only Player hooks (pa:qa-player-command + window.__paCollision), moved
// verbatim from Player.tsx. Gated on QA_RUNTIME_ENABLED — no-ops in
// production builds.
export function usePlayerQaHooks(args: {
  api: PlayerApi;
  motionRef: { current: MotionState };
  worldRef: { current: CollisionWorld };
  safeHistoryRef: { current: Array<{ x: number; y: number; z: number }> };
  staminaRef: { current: StaminaState };
  colliders: [number, number, number, number][];
}): void {
  const { api, motionRef, worldRef, safeHistoryRef, staminaRef } = args;
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    const onQaCommand = (
      event: Event,
    ) => {
      const detail = (
        event as CustomEvent<{
          teleport?: [number, number, number];
          faceY?: number;
          stamina?: number;
        }>
      ).detail;
      if (detail?.teleport) api.teleport(detail.teleport, detail.faceY);
      // Dev/QA-only chase-stamina seed. Lets the M1 exhausted-catch harness
      // reach the zero-stamina precondition deterministically: the feel-tuned
      // 0.14/s drain would otherwise need ~7s of unobstructed sprint, which
      // overruns the authored QA street segment. Gated by QA_RUNTIME_ENABLED,
      // so it is never present in production builds.
      if (typeof detail?.stamina === "number" && Number.isFinite(detail.stamina)) {
        staminaRef.current = createStamina(detail.stamina);
      }
    };
    window.addEventListener("pa:qa-player-command", onQaCommand);
    return () => window.removeEventListener("pa:qa-player-command", onQaCommand);
  }, [api]);
  useEffect(() => {
    if (!QA_RUNTIME_ENABLED) return;
    type CollisionProbeWindow = Window & {
      __paCollision?: (probe?: {
        x?: number;
        y?: number;
        z?: number;
        radius?: number;
        height?: number;
      }) => unknown;
    };
    const target = window as CollisionProbeWindow;
    target.__paCollision = (probe = {}) => {
      const state = motionRef.current;
      const point = {
        x: probe.x ?? state.pos.x,
        y: probe.y ?? state.pos.y,
        z: probe.z ?? state.pos.z,
      };
      const radius = probe.radius ?? CAPSULE_RADIUS;
      const height = probe.height ?? state.capsuleHeight;
      return {
        point,
        radius,
        height,
        hitIds: blockerIdsAt(
          worldRef.current,
          point,
          radius,
          height,
        ),
        lastSafe:
          safeHistoryRef.current[safeHistoryRef.current.length - 1] ?? null,
        blockers: worldRef.current.blockers.map((blocker) => ({
          id: blocker.id,
          bounds: [
            blocker.minX,
            blocker.maxX,
            blocker.minZ,
            blocker.maxZ,
            blocker.baseY,
            blocker.topY,
          ],
          footprint: blocker.footprint ?? null,
          tags: [...blocker.tags],
        })),
        platforms: worldRef.current.platforms.map((platform) => ({
          id: platform.id,
          bounds: [
            platform.minX,
            platform.maxX,
            platform.minZ,
            platform.maxZ,
            platform.y,
          ],
          polygon: platform.polygon ?? null,
        })),
        routes: routeBlockerMatrix(args.colliders),
      };
    };
    if (
      new URLSearchParams(window.location.search).get("collisionDebug") === "1"
    ) {
      console.info(
        "[collisionDebug] call window.__paCollision({x,y,z}) for IDs, bounds, hits, routes and last-safe",
      );
    }
    return () => {
      delete target.__paCollision;
    };
  }, [args.colliders]);
}
