// World-owned registry of authored GAMEPLAY actors — the shared source of truth
// directors read to reason about each other (a WatcherDirector querying the
// pursuer, a ChaseDirector querying named figures, etc). Per Production Plan
// D.0.2 / Build-Brief M0 task 2.
//
// This is a plain instance (created and owned by World3D via
// `createActorRegistry()`), NOT a module-level singleton — a scene swap builds
// a fresh registry so there is no cross-mount leakage. It performs NO React
// state updates and drives NO rerenders: directors publish() every frame from
// inside useFrame and other directors query() the plain Maps synchronously.
//
// AMBIENT POPULATION IS EXPLICITLY EXCLUDED. The ambient crowd
// (PopulationDirector) stays private deterministic route sampling with no
// AI/perception; it must never be published here. Only dedicated, authoritative
// actors that other systems need to perceive belong in this registry:
// directed named cast, watchers, pursuers, and lightweight thread figures.

export type ActorKind =
  | "DIRECTED_NPC" // named cast staged by ActorDirector / ReactiveNpcDirector
  | "WATCHER" // posted/patrol officer with authoritative forward for vision cones
  | "PURSUER" // chase actor with authoritative steering motion
  | "THREAD_FIGURE"; // lightweight Ned/Sarah-style breadcrumb figures

// Plain numeric vectors only. Directors reuse scratch THREE.Vector3 instances
// across frames, so publish() COPIES the components in — the registry never
// retains a reference to a caller-owned mutable vector.
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface GameplayActor {
  id: string;
  spaceId: string; // exterior scene id or interior id — see querySpace()
  kind: ActorKind;
  position: Vec3;
  forwardVec: Vec3; // unit-ish planar facing; watchers use it as the cone axis
  velocity?: Vec3; // present for moving actors (pursuers/patrols); omitted if static
  updatedTick: number; // the field tick (fieldSimulation) of the last publish
}

export interface ActorPublish {
  id: string;
  spaceId: string;
  kind: ActorKind;
  position: Vec3Like;
  forwardVec: Vec3Like;
  velocity?: Vec3Like | null;
  // The authoritative fixed-step tick (from fieldSimulation) this sample belongs
  // to. Used both for staleness pruning and duplicate-in-tick detection.
  tick: number;
  // Stable per-director token. A single owner may publish more than once in a
  // field tick when render FPS exceeds the fixed 60 Hz field clock; a different
  // token claiming the same id is a real ownership collision.
  owner?: object;
}

export interface ActorRegistryOptions {
  // Called when two distinct publish() calls claim the same id within the SAME
  // tick — a real ownership collision (two directors both driving "PURSUER_1").
  // Defaults to a dev-only console.error. The first writer wins; the colliding
  // second write is ignored so the earlier owner's sample is not corrupted.
  onDuplicateId?: (id: string, tick: number) => void;
}

export interface ActorRegistry {
  publish: (actor: ActorPublish) => void;
  remove: (id: string) => void;
  get: (id: string) => GameplayActor | undefined;
  queryKind: (kind: ActorKind) => GameplayActor[];
  querySpace: (spaceId: string) => GameplayActor[];
  // Drop actors whose last publish is older than `maxAgeTicks` ticks before
  // `currentTick`. Covers a director that stopped publishing without an explicit
  // remove() (unmount, cull, scene swap mid-frame).
  pruneStale: (currentTick: number, maxAgeTicks: number) => string[];
  clear: () => void;
  readonly size: number;
}

function copyVec(v: Vec3Like): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

function defaultOnDuplicateId(id: string, tick: number): void {
  // Vite injects import.meta.env.DEV; node test runner leaves it undefined, so
  // guard defensively and stay silent outside a browser dev build.
  const env = (import.meta as unknown as { env?: { DEV?: boolean } }).env;
  if (env?.DEV) {
    console.error(
      `[actorRegistry] duplicate actor id "${id}" published twice in tick ${tick}; ` +
        `two directors are claiming the same actor. Ignoring the second write.`,
    );
  }
}

export function createActorRegistry(
  options: ActorRegistryOptions = {},
): ActorRegistry {
  const onDuplicateId = options.onDuplicateId ?? defaultOnDuplicateId;
  const actors = new Map<string, GameplayActor>();
  const owners = new Map<string, object>();
  // Tick at which each id was last written, so a same-tick second write is a
  // collision but a next-tick update (the normal per-frame case) is not.
  const lastPublishTick = new Map<string, number>();

  return {
    publish(input) {
      const seenTick = lastPublishTick.get(input.id);
      const existingOwner = owners.get(input.id);
      if (
        seenTick === input.tick &&
        actors.has(input.id) &&
        (input.owner === undefined || existingOwner !== input.owner)
      ) {
        onDuplicateId(input.id, input.tick);
        return; // first writer wins
      }
      const next: GameplayActor = {
        id: input.id,
        spaceId: input.spaceId,
        kind: input.kind,
        position: copyVec(input.position),
        forwardVec: copyVec(input.forwardVec),
        updatedTick: input.tick,
      };
      if (input.velocity) next.velocity = copyVec(input.velocity);
      actors.set(input.id, next);
      lastPublishTick.set(input.id, input.tick);
      if (input.owner) owners.set(input.id, input.owner);
    },
    remove(id) {
      actors.delete(id);
      lastPublishTick.delete(id);
      owners.delete(id);
    },
    get(id) {
      return actors.get(id);
    },
    queryKind(kind) {
      const out: GameplayActor[] = [];
      for (const a of actors.values()) if (a.kind === kind) out.push(a);
      return out;
    },
    querySpace(spaceId) {
      const out: GameplayActor[] = [];
      for (const a of actors.values()) if (a.spaceId === spaceId) out.push(a);
      return out;
    },
    pruneStale(currentTick, maxAgeTicks) {
      const removed: string[] = [];
      for (const [id, a] of actors) {
        if (currentTick - a.updatedTick > maxAgeTicks) {
          actors.delete(id);
          lastPublishTick.delete(id);
          owners.delete(id);
          removed.push(id);
        }
      }
      return removed;
    },
    clear() {
      actors.clear();
      lastPublishTick.clear();
      owners.clear();
    },
    get size() {
      return actors.size;
    },
  };
}
