import type {
  FieldCommittedEvent,
  InputRequest,
  PresentationDirective,
  PresenterEvent,
  RuntimeView,
} from "@pa/contracts";

export interface MutableRef<T> {
  current: T;
}

export interface PresenterSpatialState {
  pos: [number, number, number];
  yaw: number;
  interiorId: string | null;
  locationId: string;
}

export interface ChapterMapLandmark {
  id: string;
  label: string;
  position: readonly [number, number];
  discoveryRadius: number;
  kind: "PRESS" | "MARKET" | "CIVIC" | "WHARF" | "LIBERTY" | "ALLEY";
}

export interface ChapterMapRoute {
  id: string;
  label: string;
  points: readonly (readonly [number, number])[];
}

export interface ChapterMapData {
  title: string;
  subtitle: string;
  bounds: {
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  };
  landmarks: readonly ChapterMapLandmark[];
  routes: readonly ChapterMapRoute[];
  objectiveAnchors: Readonly<Record<string, readonly [number, number]>>;
}

export interface ChapterWorldComponentProps<TChoiceAnimation, TStealthStore> {
  view: RuntimeView | null;
  presentationLocationId: string | null;
  request: InputRequest | null;
  present: PresentationDirective[];
  busy: boolean;
  movementLocked: boolean;
  keyboardOnly: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
  chaseAssist: "STANDARD" | "SLOW_PURSUER" | "AUTO_STAMINA" | "CONFIRM_RESOLVE";
  readPanelActive: boolean;
  cueId: string | null;
  choreographyReady: boolean;
  choiceAnimation: TChoiceAnimation | null;
  stealthStore: TStealthStore;
  committedEventCount?: () => number;
  overlayActive?: boolean;
  restoreSpatial?: PresenterSpatialState | null;
  spatialSnapshotRef?: MutableRef<PresenterSpatialState | null>;
  onChoreographyReady(cueId: string): void;
  onWebglStatus(available: boolean): void;
  onEvent(event: PresenterEvent): void | Promise<boolean>;
  onFieldEvent(event: FieldCommittedEvent): Promise<boolean>;
}

export interface ChapterWorldDefinition<
  TChoiceAnimation,
  TStealthStore,
  TStealthPatch,
  TDocument,
> {
  readonly chapterId: string;
  readonly World: (
    props: ChapterWorldComponentProps<TChoiceAnimation, TStealthStore>,
  ) => unknown;
  readonly createStealthStore: () => TStealthStore;
  readonly stealthPatchFromRuntimeField: (
    field: RuntimeView["field"],
  ) => TStealthPatch;
  readonly documents: {
    forReadPanel(objectId: string): TDocument | null;
    imageUrl(documentId: string): string;
  };
  readonly map: ChapterMapData;
  readonly qa: {
    readonly runtimeEnabled: boolean;
  };
}
