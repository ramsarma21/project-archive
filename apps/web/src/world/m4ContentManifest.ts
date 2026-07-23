import {
  MICRO_CONCEPT_IDS,
  OPTIONAL_ACTIVITY_IDS,
  type MicroConceptId,
  type OptionalActivityId,
} from "@pa/contracts";

export interface KnowledgePlacement {
  id: string;
  spaceId: string;
  title: string;
  body: string;
  texture?: string;
  carrier: "PAPER" | "HANGING_SIGN" | "COIN_SET" | "EVENT_PROP" | "EXISTING";
  position: readonly [number, number, number];
  rotY: number;
  size: readonly [number, number, number];
  micros: readonly MicroConceptId[];
}

export const M4_KNOWLEDGE: readonly KnowledgePlacement[] = [
  {
    id: "KN-noticeboard-revenue",
    spaceId: "EXTERIOR",
    title: "Revenue proclamation",
    body: "Parliament states that the new duties raise colonial revenue after the war, ending the older habit of loose enforcement.",
    texture: "poster-revenue-proclamation",
    carrier: "PAPER",
    position: [5.65, 1.72, 8.54],
    rotY: -0.35,
    size: [0.64, 0.2, 0.86],
    micros: [MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END],
  },
  {
    id: "KN-noticeboard-stamp",
    spaceId: "EXTERIOR",
    title: "Stamp schedule",
    body: "The schedule names printed and legal papers that will require a stamp when the law takes effect.",
    texture: "poster-stamp-schedule",
    carrier: "PAPER",
    position: [6.35, 1.7, 8.32],
    rotY: -0.35,
    size: [0.58, 0.2, 0.82],
    micros: [MICRO_CONCEPT_IDS.STAMP_WHAT_COUNTS],
  },
  {
    id: "KN-liberty-bill",
    spaceId: "EXTERIOR",
    title: "Liberty Tree bill",
    body: "The elm has become a public organizing place. The bill points readers toward the effigy protest gathered beneath it.",
    texture: "poster-liberty-tree",
    carrier: "PAPER",
    position: [101.5, 2.0, -22.2],
    rotY: -Math.PI / 2,
    size: [0.72, 0.2, 0.96],
    micros: [MICRO_CONCEPT_IDS.LIBERTY_TREE, MICRO_CONCEPT_IDS.EFFIGY_PROTEST],
  },
  {
    id: "KN-nonimport",
    spaceId: "EXTERIOR",
    title: "Non-importation notice",
    body: "Merchants propose refusing selected British imports so trade pressure carries the protest beyond a single speech.",
    texture: "poster-nonimportation",
    carrier: "PAPER",
    position: [-70, 2.05, -10.55],
    rotY: 0,
    size: [0.72, 0.2, 0.94],
    micros: [MICRO_CONCEPT_IDS.NON_IMPORTATION],
  },
  {
    id: "KN-townmeeting",
    spaceId: "EXTERIOR",
    title: "Town meeting notice",
    body: "Printed calls, taverns, and riders move meeting news through an informal network before any official newspaper account.",
    texture: "poster-town-meeting",
    carrier: "PAPER",
    position: [-18.2, 2.0, -10.5],
    rotY: 0,
    size: [0.72, 0.2, 0.94],
    micros: [MICRO_CONCEPT_IDS.LOYAL_NINE, MICRO_CONCEPT_IDS.NEWS_NETWORKS],
  },
  {
    id: "KN-noconsent",
    spaceId: "EXTERIOR",
    title: "No consent broadside",
    body: "The complaint is not only the amount charged: colonists say Parliament taxes them without an elected colonial voice there.",
    texture: "poster-no-consent",
    carrier: "PAPER",
    position: [-4, 2.0, 10.55],
    rotY: Math.PI,
    size: [0.72, 0.2, 0.94],
    micros: [],
  },
  {
    id: "KN-wharfage",
    spaceId: "EXTERIOR",
    title: "Wharfage schedule",
    body: "Fees, customs delays, idle ships, and wages connect imperial policy to the daily economy of a port town.",
    texture: "poster-wharfage",
    carrier: "PAPER",
    position: [-139, 2.05, -10.4],
    rotY: 0,
    size: [0.72, 0.2, 0.94],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  },
  {
    id: "KN-sign-printer",
    spaceId: "EXTERIOR",
    title: "Printer's sign",
    body: "A press emblem identifies a trade to customers who may not read every word.",
    texture: "sign-printer",
    carrier: "HANGING_SIGN",
    position: [-2.9, 2.65, 10.75],
    rotY: Math.PI / 2,
    size: [1.8, 1.02, 0.16],
    micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
  },
  {
    id: "KN-sign-tavern",
    spaceId: "EXTERIOR",
    title: "Bunch of Grapes sign",
    body: "The tavern sign marks a meeting place where travelers, merchants, and political organizers exchange news.",
    texture: "sign-tavern-grapes",
    carrier: "HANGING_SIGN",
    position: [-21.4, 2.65, -10.75],
    rotY: -Math.PI / 2,
    size: [1.8, 1.02, 0.16],
    micros: [MICRO_CONCEPT_IDS.NEWS_NETWORKS],
  },
  {
    id: "KN-sign-baker",
    spaceId: "EXTERIOR",
    title: "Baker's sheaf",
    body: "A sheaf emblem advertises a baker among the mixed trades serving the port.",
    texture: "sign-baker-sheaf",
    carrier: "HANGING_SIGN",
    position: [24.5, 2.55, -10.75],
    rotY: Math.PI / 2,
    size: [1.65, 0.96, 0.15],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  },
  {
    id: "KN-sign-chandler",
    spaceId: "EXTERIOR",
    title: "Chandler's anchor",
    body: "The anchor identifies a supplier whose candles and stores serve ships and waterfront work.",
    texture: "sign-chandler-anchor",
    carrier: "HANGING_SIGN",
    position: [-85, 2.55, 10.75],
    rotY: -Math.PI / 2,
    size: [1.65, 0.96, 0.15],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  },
  {
    id: "KN-watchhouse",
    spaceId: "EXTERIOR",
    title: "Boston Watch House",
    body: "This civic watch house is the constables' local office and release point. It is distinct from the Crown customs building across the street.",
    texture: "sign-watchhouse",
    carrier: "HANGING_SIGN",
    position: [49.7, 2.75, -10.7],
    rotY: Math.PI / 2,
    size: [1.9, 1.08, 0.17],
    micros: [MICRO_CONCEPT_IDS.WRITS_OF_ASSISTANCE],
  },
  {
    id: "KN-coinpaper",
    spaceId: "MERCER_PRESS",
    title: "Coin and paper promises",
    body: "Silver coin is scarce. Shop credit and paper promises keep trade moving, while imperial duties still demand hard payment.",
    texture: "coinpaper-card",
    carrier: "COIN_SET",
    position: [2.2, 0.86, 2.6],
    rotY: 0.2,
    size: [0.9, 0.35, 0.7],
    micros: [MICRO_CONCEPT_IDS.HARD_COIN_SCARCITY],
  },
  {
    id: "KN-typecase",
    spaceId: "MERCER_PRESS",
    title: "Type cases",
    body: "Printers compose lines from individual pieces of type before the press can reproduce the argument.",
    carrier: "EXISTING",
    // Matches the interior manifest's actual `type-cases` placement (east
    // wall) so the read prompt sits on the visible cases.
    position: [8.0, 1.0, 1.7],
    rotY: -Math.PI / 2,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.PRINTERS_ROLE],
  },
  {
    id: "KN-effigy",
    spaceId: "EXTERIOR",
    title: "Andrew Oliver placard",
    body: "The placard names Andrew Oliver, appointed to distribute stamps. The effigy turns a distant office into a public target.",
    carrier: "EVENT_PROP",
    position: [91.9, 1.5, -20.3],
    rotY: 0,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.ANDREW_OLIVER],
  },
  // ---- Found-History density pass (Act-1-Environmental-Lore catalog). ----
  // EXISTING carriers attach a read to props already placed and verified; no
  // new visuals. Tier-B entries log their micro; Tier-C entries log nothing
  // (micros: []) — pure saturation-law texture. Tier-A entries additionally
  // reinforce a macro through the runtime's LORE_MACRO_SUPPORT bridge.
  {
    id: "KN-fishflakes",
    spaceId: "EXTERIOR",
    title: "Empty fish flakes",
    body: "Cod dries on the flakes — half the racks bare. No trade means no fish, and no wage on this wharf.",
    carrier: "EXISTING",
    position: [-122, 0.9, -7.5],
    rotY: 0,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  },
  {
    id: "KN-cargomark",
    spaceId: "EXTERIOR",
    title: "Collector's chalk marks",
    body: "Crates stamped for London. A collector's chalk mark means the cargo has been counted — and owes the Crown before it owes the merchant.",
    carrier: "EXISTING",
    position: [-134, 1.0, 0.5],
    rotY: 0,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.SALUTARY_NEGLECT_END],
  },
  {
    id: "KN-ropewalk-front",
    spaceId: "EXTERIOR",
    title: "The ropewalk",
    body: "Cordage for the whole harbor is spun in the long hall. Slack trade means slack rope — the walk's quiet is the harbor's ledger.",
    carrier: "EXISTING",
    position: [-103, 1.1, 13.2],
    rotY: 0,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.PORT_TOWN_BOSTON],
  },
  {
    id: "KN-marketstall",
    spaceId: "EXTERIOR",
    title: "Sarah's market stall",
    body: "Fish and thread and little else on the boards. The duties took the rest of what this stall could carry.",
    carrier: "EXISTING",
    position: [-50, 1.0, -6.5],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
  {
    id: "KN-elm",
    spaceId: "EXTERIOR",
    title: "The great elm",
    body: "An old elm at the crossroads, hung with lanterns and now an effigy. After today they will call it the Liberty Tree.",
    carrier: "EXISTING",
    // At the trunk (liberty-elm prop @ [95,0,-25], collide 2.4x2.4): the
    // anchor sits just clear of the collision box on the street side.
    position: [95, 1.2, -22.3],
    rotY: 0,
    size: [1, 1, 1],
    micros: [MICRO_CONCEPT_IDS.LIBERTY_TREE],
  },
  {
    id: "KN-assembly",
    spaceId: "EXTERIOR",
    title: "The colony's own assembly",
    body: "Massachusetts elects its own assembly, and that assembly may vote a tax. The quarrel is that London claims only London may.",
    carrier: "EXISTING",
    position: [55, 1.0, 4],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
  {
    id: "KN-churchyard",
    spaceId: "EXTERIOR",
    title: "Slate and winged skulls",
    body: "Winged skulls and worn dates along the fence. Memento mori — the town's memory, cut in slate.",
    carrier: "EXISTING",
    position: [63, 1.0, -10.6],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
  {
    id: "KN-clarkedoor",
    spaceId: "EXTERIOR",
    title: "A tidy Loyalist door",
    body: "Brass polished, step swept. The King's peace, kept carefully behind it.",
    carrier: "EXISTING",
    position: [-32, 1.2, 10.4],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
  {
    id: "KN-laundry",
    spaceId: "EXTERIOR",
    title: "Homespun on the line",
    body: "Coarse cloth, honestly made. 'Wear our own and owe England nothing,' the goodwives say.",
    carrier: "EXISTING",
    position: [-33, 1.1, -23.2],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
  {
    id: "KN-firewood",
    spaceId: "EXTERIOR",
    title: "Cordwood laid in",
    body: "Split wood stacked high against winter. Coin is short; folk lay in what can't be taxed away.",
    carrier: "EXISTING",
    position: [-64, 0.9, -9],
    rotY: 0,
    size: [1, 1, 1],
    micros: [],
  },
] as const;

export interface EavesdropScene {
  id: string;
  position: readonly [number, number, number];
  rigs: readonly [string, string];
  speakers: readonly [string, string];
  lines: readonly [string, string];
}

export const M4_EAVESDROPS: readonly EavesdropScene[] = [
  {
    id: "EAV-market",
    position: [-50, 0, -6.5],
    rigs: ["townsman-rigged", "townswoman-rigged"],
    speakers: ["PAPER SELLER", "GOODWIFE"],
    lines: ["A shilling a ream now, and a stamp on top come fall!", "Then we buy naught from England—let them feel it."],
  },
  {
    id: "EAV-dock",
    position: [-140, 0, 3],
    rigs: ["dockhand-rigged", "dockhand-rigged"],
    speakers: ["DOCKHAND", "SAILOR"],
    lines: ["Half the ships idle. No trade, no wage.", "Thank the Crown's collectors for that."],
  },
  {
    id: "EAV-church",
    position: [71.5, 0, -9],
    rigs: ["townsman-rigged", "townsman-rigged"],
    speakers: ["TOWNSMAN", "NEIGHBOR"],
    lines: ["We've no vote in London, yet London taxes us.", "Careful who hears you, friend."],
  },
  {
    id: "EAV-customs",
    position: [-56, 0, -2],
    rigs: ["constable-rigged", "townsman-rigged"],
    speakers: ["CONSTABLE", "TRADESMAN"],
    lines: ["Open the bag. The King's warrant is enough.", "On whose warrant? That is the question."],
  },
] as const;

export const M4_ACTIVITY_ANCHORS: Readonly<
  Record<OptionalActivityId, readonly (readonly [number, number, number])[]>
> = {
  [OPTIONAL_ACTIVITY_IDS.TAVERN_NOTE]: [],
  [OPTIONAL_ACTIVITY_IDS.DOCK_HAUL]: [],
  [OPTIONAL_ACTIVITY_IDS.ROPEWALK]: [],
  [OPTIONAL_ACTIVITY_IDS.ROOF_KID]: [
    [-24, 0, 9.8],
    [13.5, 3.05, -10.8],
  ],
  [OPTIONAL_ACTIVITY_IDS.CRIER]: [
    [6, 0, 7.2],
    [-8, 0, 4],
    [6, 0, 4],
    [24, 0, 4],
  ],
  [OPTIONAL_ACTIVITY_IDS.AGITATOR_DARE]: [
    [-16, 0, 6],
    [50, 0, 8],
  ],
  [OPTIONAL_ACTIVITY_IDS.ROOFTOP_RUN]: [
    [14.8, 3.05, -11.15],
    [89.6, 2.78, -14.7],
  ],
  [OPTIONAL_ACTIVITY_IDS.LOSE_WATCH]: [
    [-8, 0, 2],
  ],
};

export const M4_FLAVOR = {
  GULLS: { id: "FLV-gulls", position: [-145, 0, 6] as const },
  DOG: { id: "FLV-dog", position: [-30.2, 0, 9.8] as const },
} as const;

