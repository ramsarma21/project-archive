import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { RuntimeView } from "@pa/contracts";
import type { PlayerApi } from "./Player.js";
import { useWorldServices } from "./WorldServicesContext.js";
import { dispatchPresentationNotice } from "../presenter/noticeArbiter.js";

// Archive R3 — the routes reminder (Archive-Spec §4): one optional
// clause surfacing an EARNED capability at the moment of approach. Fires once
// per approach (re-arms after leaving), never names a route not yet owned,
// and stays silent during interrupts/skill execution. Pure presentation over
// committed route state.
interface RouteReminder {
  routeId: string;
  anchor: readonly [number, number];
  radius: number;
  line: string;
}

const REMINDERS: readonly RouteReminder[] = [
  {
    routeId: "NORTH_ALLEY_ROUTE",
    anchor: [-33, -14],
    radius: 8,
    line: "You know the laundry-lane cut through here — quieter than the main street.",
  },
  {
    routeId: "THOMAS_DOCK_ROUTE",
    anchor: [-104, 8],
    radius: 9,
    line: "Thomas's dock gate is open to you — it skips the watched corner.",
  },
];

export function RouteReminderDirector(props: {
  view: RuntimeView | null;
  apiRef: { current: PlayerApi | null };
  enabled: boolean;
}) {
  const services = useWorldServices();
  const inside = useRef(new Set<string>());

  useFrame(() => {
    const player = props.apiRef.current;
    const view = props.view;
    if (!player || !view || !props.enabled || services.spaceId !== "EXTERIOR") {
      return;
    }
    for (const reminder of REMINDERS) {
      if (view.routes[reminder.routeId] !== "UNLOCKED") continue;
      const distance = Math.hypot(
        player.position.x - reminder.anchor[0],
        player.position.z - reminder.anchor[1],
      );
      const wasInside = inside.current.has(reminder.routeId);
      if (distance <= reminder.radius && !wasInside) {
        inside.current.add(reminder.routeId);
        dispatchPresentationNotice({
          id: `route:${reminder.routeId}`,
          kind: "ROUTE_WARNING",
          speaker: "ARCHIVE",
          text: reminder.line,
          dedupeKey: reminder.routeId,
          cooldownMs: 20_000,
          durationMs: 4_200,
          captions: true,
        });
      } else if (distance > reminder.radius + 5 && wasInside) {
        inside.current.delete(reminder.routeId);
      }
    }
  });

  return null;
}
