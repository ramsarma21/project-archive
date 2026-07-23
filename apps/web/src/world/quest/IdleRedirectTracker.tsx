import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PlayerApi } from "../Player.js";
import type { ResolvedQuestMarker } from "../QuestMarkerDirector.js";
import { KIND_THRESHOLDS } from "../questMarkerManifest.js";
import { IDLE_PARK_EXTRA_M, planarDistance } from "../questMarkerResolver.js";

// ---- Gold-marker redirect (Interaction-Spec §1.2a / Day-1 L11) ----------
// Fires FREE_ROAM_IDLE only on genuine non-progress toward the selected gold
// marker: no distance progress for a lenient grace period AND the player is
// either essentially stationary or has drifted net-away from the marker.
// Walking toward the marker continuously never triggers it.
const REDIRECT_SAMPLE_MS = 500; // distance sampling cadence
const REDIRECT_PROGRESS_EPS_M = 1.5; // closer-than-best-so-far that counts as progress
const REDIRECT_MOVE_EPS_M = 0.08; // per-sample position delta that counts as movement
const REDIRECT_NO_PROGRESS_MS = 11000; // grace with zero progress before the first nudge
const REDIRECT_STATIONARY_MS = 6000; // "essentially AFK" window
const REDIRECT_AWAY_WINDOW_MS = 6000; // net-away comparison window
const REDIRECT_AWAY_EPS_M = 1.5; // net distance gained over the window that reads as moving away
const REDIRECT_COOLDOWN_MS = [22000, 35000] as const; // escalating re-fire spacing

export function IdleRedirectTracker(props: {
  markers: ResolvedQuestMarker[];
  apiRef: { current: PlayerApi | null };
  busy: boolean;
  selectedTargetId: string | null;
  trackingKey: string | null; // cueId + selected target; a change resets all state
  onIdle: () => void;
}) {
  const state = useRef({
    lastSampleAt: 0,
    lastPos: null as [number, number] | null,
    bestDist: Infinity,
    lastProgressAt: 0,
    lastMovementAt: 0,
    samples: [] as { t: number; dist: number }[],
    fireCount: 0,
    nextEligibleAt: 0,
    parked: true,
  });
  useEffect(() => {
    const s = state.current;
    s.parked = true;
    s.fireCount = 0;
    s.nextEligibleAt = 0;
  }, [props.trackingKey]);
  useFrame(() => {
    const s = state.current;
    const now = performance.now();
    if (now - s.lastSampleAt < REDIRECT_SAMPLE_MS) return;
    s.lastSampleAt = now;
    const api = props.apiRef.current;
    const marker = props.selectedTargetId
      ? props.markers.find((m) => m.targetId === props.selectedTargetId)
      : undefined;
    const px = api?.position.x ?? 0;
    const pz = api?.position.z ?? 0;
    const dist = marker
      ? planarDistance(px, pz, marker.arrivalAnchor[0], marker.arrivalAnchor[2])
      : Infinity;
    // Parking radius is the marker's own arrival radius plus a small margin, so
    // the nudge never fires while the player is effectively arriving.
    const parkRadius = marker
      ? KIND_THRESHOLDS[marker.kind].arrival + IDLE_PARK_EXTRA_M
      : 0;
    // Park (the grace restarts fresh) while there is no live gold target,
    // while any blocking UI or subtitle is up, or once the player is close
    // enough to be arriving. Escalation state survives a park so the nudge's
    // own Archive line cannot reset its cooldown.
    if (!api || !marker || props.busy || dist <= parkRadius) {
      s.parked = true;
      return;
    }
    if (s.parked) {
      s.parked = false;
      s.lastPos = [px, pz];
      s.bestDist = dist;
      s.lastProgressAt = now;
      s.lastMovementAt = now;
      s.samples = [{ t: now, dist }];
      return;
    }
    if (s.lastPos && Math.hypot(px - s.lastPos[0], pz - s.lastPos[1]) >= REDIRECT_MOVE_EPS_M) {
      s.lastMovementAt = now;
    }
    s.lastPos = [px, pz];
    if (dist <= s.bestDist - REDIRECT_PROGRESS_EPS_M) {
      // Real progress toward the gold marker: full reset, including escalation.
      s.bestDist = dist;
      s.lastProgressAt = now;
      s.fireCount = 0;
      s.nextEligibleAt = 0;
    }
    s.samples.push({ t: now, dist });
    while (
      s.samples.length > 0 &&
      now - s.samples[0]!.t > REDIRECT_AWAY_WINDOW_MS + REDIRECT_SAMPLE_MS * 2
    ) {
      s.samples.shift();
    }
    const oldest = s.samples[0]!;
    const netAway =
      now - oldest.t >= REDIRECT_AWAY_WINDOW_MS - REDIRECT_SAMPLE_MS &&
      dist - oldest.dist >= REDIRECT_AWAY_EPS_M;
    const stationary = now - s.lastMovementAt >= REDIRECT_STATIONARY_MS;
    if (
      now - s.lastProgressAt >= REDIRECT_NO_PROGRESS_MS &&
      (stationary || netAway) &&
      now >= s.nextEligibleAt
    ) {
      s.fireCount += 1;
      s.nextEligibleAt =
        now + REDIRECT_COOLDOWN_MS[Math.min(s.fireCount, REDIRECT_COOLDOWN_MS.length) - 1]!;
      props.onIdle();
    }
  });
  return null;
}
