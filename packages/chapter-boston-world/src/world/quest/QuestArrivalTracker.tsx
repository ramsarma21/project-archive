import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { PlayerApi } from "../Player.js";
import type { ResolvedQuestMarker } from "../QuestMarkerDirector.js";
import { KIND_THRESHOLDS } from "../questMarkerManifest.js";
import { arrivalReady, planarDistance } from "../questMarkerResolver.js";
import {
  beginArrivalAttempt,
  createArrivalLatch,
  settleArrivalAttempt,
  shouldAttemptArrival,
} from "../questArrivalLatch.js";

// Proximity arrival + walk-in selection with kind-specific radii, arrival
// dwell, and selection-confirmation hysteresis (Interaction-Spec marker
// replacement). Selecting never moves the player: entering an unselected
// marker only emits FREE_ROAM_SELECT; the subsequently-selected marker must
// then be dwelt on (past the confirmation window) before FREE_ROAM_GOTO fires.
//
// The one-shot key is cueId|targetId — but it latches ONLY once the commit
// is actually accepted by the runtime. A dropped commit (transient busy /
// persist round-trip / choreography race) schedules a retry instead of
// consuming the arrival: latch-before-accept stranded fixed events forever
// when their single GOTO landed in a guard window (feel-audit-1 P0-6).
// Latch semantics live in questArrivalLatch.ts (pure, unit-tested).
export function QuestArrivalTracker(props: {
  markers: ResolvedQuestMarker[];
  apiRef: { current: PlayerApi | null };
  hostRef?: { current: HTMLDivElement | null };
  busy: boolean;
  selectedTargetId: string | null;
  cueId: string | null;
  onArrive: (targetId: string) => Promise<boolean>;
  onSelect: (targetId: string) => Promise<boolean>;
}) {
  const state = useRef({
    select: createArrivalLatch(),
    arrive: createArrivalLatch(),
    dwellEnter: null as number | null,
    selectedAt: 0,
  });
  useEffect(() => {
    const s = state.current;
    s.select = createArrivalLatch();
    s.arrive = createArrivalLatch();
    s.dwellEnter = null;
    s.selectedAt = performance.now();
  }, [props.selectedTargetId, props.cueId]);
  useFrame(() => {
    const s = state.current;
    const api = props.apiRef.current;
    const host = props.hostRef?.current;
    if (host) {
      host.dataset.arrivalBusy = String(props.busy);
      host.dataset.arrivalSelectedId = props.selectedTargetId ?? "";
      host.dataset.arrivalMarkerCount = String(props.markers.length);
    }
    if (props.busy || !api) {
      s.dwellEnter = null;
      if (host) {
        host.dataset.arrivalPhase = "BLOCKED";
        host.dataset.arrivalReady = "false";
      }
      return;
    }
    const px = api.position.x;
    const pz = api.position.z;
    const now = performance.now();
    if (!props.selectedTargetId) {
      // No selection yet: walking into any available marker's arrival radius
      // selects it. A dropped SELECT retries after a short backoff while the
      // player remains inside the radius.
      for (const m of props.markers) {
        const th = KIND_THRESHOLDS[m.kind];
        const d = planarDistance(px, pz, m.arrivalAnchor[0], m.arrivalAnchor[2]);
        if (host) {
          host.dataset.arrivalPhase = "SELECT";
          host.dataset.arrivalTargetId = m.targetId;
          host.dataset.arrivalAnchor = m.arrivalAnchor.join(",");
          host.dataset.arrivalDistance = d.toFixed(3);
          host.dataset.arrivalInside = String(d <= th.arrival);
          host.dataset.arrivalThreshold = String(th.arrival);
          host.dataset.arrivalReady = "false";
        }
        if (d <= th.arrival) {
          if (shouldAttemptArrival(s.select, m.targetId, now, true)) {
            s.select = beginArrivalAttempt(s.select, m.targetId);
            void props.onSelect(m.targetId).then((accepted) => {
              state.current.select = settleArrivalAttempt(
                state.current.select,
                m.targetId,
                accepted !== false,
                performance.now(),
              );
            });
          }
          return;
        }
      }
      return;
    }
    const marker = props.markers.find((m) => m.targetId === props.selectedTargetId);
    if (!marker) {
      s.dwellEnter = null;
      if (host) {
        host.dataset.arrivalPhase = "NO_MARKER";
        host.dataset.arrivalTargetId = "";
        host.dataset.arrivalReady = "false";
      }
      return;
    }
    const th = KIND_THRESHOLDS[marker.kind];
    const d = planarDistance(px, pz, marker.arrivalAnchor[0], marker.arrivalAnchor[2]);
    const inside = d <= th.arrival;
    if (inside) {
      if (s.dwellEnter === null) s.dwellEnter = now;
    } else {
      s.dwellEnter = null;
    }
    const dwellMs = s.dwellEnter === null ? 0 : now - s.dwellEnter;
    const key = `${props.cueId ?? ""}|${marker.targetId}`;
    const ready = arrivalReady({
      insideArrival: inside,
      dwellMs,
      msSinceSelection: now - s.selectedAt,
    });
    if (host) {
      host.dataset.arrivalPhase = "ARRIVE";
      host.dataset.arrivalTargetId = marker.targetId;
      host.dataset.arrivalAnchor = marker.arrivalAnchor.join(",");
      host.dataset.arrivalDistance = d.toFixed(3);
      host.dataset.arrivalInside = String(inside);
      host.dataset.arrivalThreshold = String(th.arrival);
      host.dataset.arrivalDwellMs = String(Math.round(dwellMs));
      host.dataset.arrivalSinceSelectionMs = String(
        Math.round(now - s.selectedAt),
      );
      host.dataset.arrivalReady = String(ready);
      host.dataset.arrivalInFlightKey = s.arrive.inFlightKey ?? "";
      host.dataset.arrivalFiredKey = s.arrive.firedKey ?? "";
    }
    if (shouldAttemptArrival(s.arrive, key, now, ready)) {
      s.arrive = beginArrivalAttempt(s.arrive, key);
      void props.onArrive(marker.targetId).then((accepted) => {
        state.current.arrive = settleArrivalAttempt(
          state.current.arrive,
          key,
          accepted !== false,
          performance.now(),
        );
      });
    }
  });
  return null;
}
