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
