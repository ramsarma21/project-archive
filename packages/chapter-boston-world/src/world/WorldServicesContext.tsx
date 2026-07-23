import {
  createContext,
  useContext,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { FieldCommittedEvent } from "@pa/contracts";
import type { ActorRegistry } from "./actorRegistry.js";
import type { GameplayWorldService } from "./gameplayWorld.js";
import type { StealthStore } from "./stealthStore.js";

export interface WorldServices {
  gameplayWorld: GameplayWorldService;
  actors: ActorRegistry;
  spaceId: string;
  fieldTickRef: MutableRefObject<number>;
  stealthStore: StealthStore;
  submitFieldEvent: (event: FieldCommittedEvent) => Promise<boolean>;
  // Count of committed presenter events. Interrupt ids are suffixed with it
  // so an exchange re-engaged after an Escape-abandon never reuses the
  // abandoned attempt's eventId (the runtime rejects duplicate eventIds).
  // Deterministic: identical action histories produce identical counts.
  committedEventCount: () => number;
}

const WorldServicesContext = createContext<WorldServices | null>(null);

export function WorldServicesProvider(props: {
  value: WorldServices;
  children: ReactNode;
}) {
  return (
    <WorldServicesContext.Provider value={props.value}>
      {props.children}
    </WorldServicesContext.Provider>
  );
}

export function useWorldServices(): WorldServices {
  const services = useContext(WorldServicesContext);
  if (!services) {
    throw new Error("world services must be consumed inside WorldServicesProvider");
  }
  return services;
}
