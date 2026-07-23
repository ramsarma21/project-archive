# Boston Act 1 — Environmental Lore ("Found History") catalog

**Status: the complete inspectable-object layer for Act 1 (Boston, 14 Aug 1765).** This is the spatial half of the creed — *"everything you **see** teaches you"* (`Boston-Concept-Delivery-Map.md`). Where `Act-1-World-Content.md` §6 lists the poster/sign knowledge interactables, this doc is the **superset**: every object in the world a player can look at and learn from, grounded in the deployed prop/building inventory (`apps/web/src/world/manifest.ts`) with real coordinates.

**Companions:** systems = `Boston-Quests-and-NPCs.md` (§2A living routes); concepts = `Act-1-Micro-Concepts.md`; delivery model = `Boston-Concept-Delivery-Map.md`; grammar = `Interaction-Spec.md` §3 (tracked-read); build manifest = `Act-1-World-Content.md`.

---

## 0. What "Found History" is

An inspectable is any world object that, when focused, surfaces **one short in-fiction line of meaning** — a merchant's mark burned into a barrel, a fish-flake rack standing empty, a stamp schedule nailed to a post. It is environmental storytelling in the Elden-Ring "item description" tradition, age-adjusted: no lore-dumps, one clause of *seeing history in a thing*.

**Three tiers, by learning weight:**

| Tier | Role | Tracked? | Logs | Annoyance budget |
|---|---|---|---|---|
| **A — Spine-support** | reinforces a required macro (①②③) or a gated fact; sits on a path the spine already walks | **yes** (focus-read) | reinforcement exposure toward a macro/gated concept | glyph only when relevant to current beat |
| **B — Concept micro** | carries one micro concept (`Act-1-Micro-Concepts.md`) | **yes** (focus-read/handle) | flips that micro to *engaged* | subtle glyph on approach |
| **C — Ambient flavor** | pure texture + context; the saturation-law payload of "empty" space | **never** | nothing (in-air context only) | no glyph; discovered by looking |

**Hard rules (inherited):** proximity/earshot **never** logs (only a focus-read or handle does, `Interaction-Spec` §3); no inspectable is a macro *carrier* (they *reinforce*, they don't gate); all deterministic; Tier-C is never tracked so it can be dense without polluting assessment. Tier assignment obeys the triple bind — a Tier-A/B inspectable must move the ledger (state), teach (learning), and reward the *curious look* (the fun of noticing).

**No new physical assets** — every inspectable below reuses a deployed GLB/texture. New work is limited to (a) 2 small textures already flagged in `Act-1-World-Content.md` §11 (`KN-coinpaper` object, effigy placard) and (b) the inspect-text strings (localhost text slice).

---

## 1. The catalog (by zone)

Coords are world `[x,y,z]` from the manifest. Assets in `code` are the exact deployed GLB/prop ids. "Says" is authored **draft** inspect text (final = text-slice pass). `KN-*` ids reconcile with `Act-1-World-Content.md` §6.

### Z1 — Wharf apron (−160…−118)

| ID | Asset @ coords | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-wharfage | `poster-wharfage` @ [−139,2,−10] (`KN-wharfage`) | B | `PORT_TOWN_BOSTON` | "Wharfage & duties, payable to the Collector. Every cask landed owes the Crown before it owes the merchant." |
| LORE-fishflakes | `fish-flakes-rack` @ [−122,0,−7.5] | B | `PORT_TOWN_BOSTON` | "Cod drying on the flakes — half the racks bare. 'No trade, no fish, no wage,' the dockhands say." |
| LORE-cargomark | `crate-mound` @ [−134,0,0.5] | A | ① `DEBT_POLICY_INTRO` (support) | "Crates stamped for London. A collector's chalk mark means it's been counted — and taxed." |
| LORE-cargonet | `cargo-net-bundle` @ [−149.5,0,5.8] | C | — (port ambience) | "A tangle of net and line, salt-stiff. The harbor's whole living, bundled up." |
| LORE-idleship | ship prop @ harbor edge | C | — | "A brig riding high and empty at anchor. Nothing to carry out, nothing coming in." |

### Z3 — West street & market (−95…−40)

| ID | Asset @ coords | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-nonimport | `poster-nonimportation` @ [−70,2,−10.5] (`KN-nonimport`) | B | `NON_IMPORTATION` | "AGREEMENT of the Merchants: to import no goods from England till the Act be repealed. Signed, and watched." |
| LORE-ropewalk | `bldg-warehouse-street` (ropewalk) @ [−103,0,15] | B | `PORT_TOWN_BOSTON` | "The ropewalk — cordage for the whole harbor spun here. Slack trade means slack rope." |
| LORE-firewood | `firewood-stack` @ [−64,0,−9] | C | — (winter/scarcity ambience) | "Split cordwood stacked high. Coin's short; folk lay in what they can't be taxed on." |
| LORE-haycart | `hay-cart` @ [−83,0,5.5] | C | — (also a vault obstacle) | "A carter's load, half-pitched. He's stopped to argue prices, not to work." |
| LORE-marketstall | `market-stall` @ [−50,0,−6.5] | A | ① (support, via Sarah) | "Fish and thread and little else. The duties took the rest." |

### Z4 — Central heart (−40…+16)

| ID | Asset @ coords | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-noticeboard | `poster-revenue-proclamation` + `poster-stamp-schedule` @ [6,0,8.8] (`KN-noticeboard`) | A | ① `SALUTARY_NEGLECT_END` **+** ② `STAMP_WHAT_COUNTS` | "By ORDER of Parliament: a duty on all paper printed, writ, or stamped. Effective the first of November." |
| LORE-noconsent | `poster-no-consent` @ [−4,2,10.5] (`KN-noconsent`) | A | ③ representation (support) | "'No taxation without representation.' Chalked over the King's proclamation, twice scrubbed, twice returned." |
| LORE-townmeeting | `poster-town-meeting` @ [−18,2,−10.5] (`KN-townmeeting`) | B | `LOYAL_NINE`, `NEWS_NETWORKS` | "Town Meeting called at the tavern. 'All friends of liberty' — the ones who can read between the lines." |
| LORE-typecase | `type-cases` @ Mercer's interior (`KN-typecase`) | B | `PRINTERS_ROLE` | "A case of sorts, letter by letter. Every stamped sheet costs the printer coin he hasn't got." |
| LORE-coinpaper | new object (`storage-chest`+coins) @ [2,0,16] (`KN-coinpaper`) | B | `HARD_COIN_SCARCITY` | "A box of paper notes and a few thin coins. The stamp must be paid in silver — and there's no silver." |
| LORE-pressbed | `bldg-printshop` press (Mercer's) | A | ② (support) | "The press bed, inked and waiting. Come November every pull owes the Crown." |
| LORE-clarkedoor | `clarke` building door @ [−32,0,10.4] | C | seeds `LOYALIST_VIEW` | "A tidy Loyalist door, brass polished. The King's peace, kept behind it." |
| LORE-drydinglaundry | `drying-line-rack` @ north alley [−33,0,−23.2] | C | seeds homespun/`NON_IMPORTATION` | "Homespun on the line — coarse but honest. 'Wear our own and owe England nothing.'" |

### Z5 — South civic & east (+16…+72)

| ID | Asset @ coords | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-customhouse | `bldg-customhouse` steps @ [55,0,13.6] | A | ① / `WRITS_OF_ASSISTANCE` (support) | "The Custom House. Officers may search on a writ that names no one and never expires." |
| LORE-vicecourt | Custom House interior notice | B | `VICE_ADMIRALTY_COURTS` | "Offenders to be tried in the admiralty court — before a judge, and no jury of their neighbors." |
| LORE-churchyard | `churchyard-fence` + gravestones @ [63,0,−10.6] | C | mortality/era texture | "Winged skulls and worn dates. 'Memento mori' — the town's memory, cut in slate." |
| LORE-wellpump-civic | `well-pump` @ [63.4,0,−13] | C | — (civic life) | "The parish pump. News travels faster here than at any meeting." |
| LORE-townhouse | `bldg-townhouse-civic` @ [53.5] | A | ③ representation (support) | "The Town House — where the colony's own assembly sits. It may vote a tax; London says only London may." |

### Z6 — East gate & Liberty pocket (+80…+108)

| ID | Asset @ coords | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-liberty-bill | `poster-liberty-tree` @ [100,2,−22] (`KN-liberty-bill`) | B | `LIBERTY_TREE`, `EFFIGY_PROTEST` | "'Liberty, Property, and no Stamps.' Nailed to the great elm where the crowd will gather." |
| LORE-effigy | effigy placard (new texture) @ elm [95] (`KN-effigy`) | A | ③ / `ANDREW_OLIVER` | "The figure hung in the elm wears a placard: A.O. — the man the Crown named to sell the stamps." |
| LORE-elm | the great elm @ [95] | B | `LIBERTY_TREE` | "An old elm at the crossroads. After today they'll call it the Liberty Tree." |

### Zone-spanning (shopfront signs)

| ID | Asset | Tier | Concept | Says (draft) |
|---|---|---|---|---|
| LORE-signs | `sign-printer`/`sign-tavern-grapes`/`sign-baker-sheaf`/`sign-chandler-anchor` (`KN-signs`) | C | the trades of a port town | per sign: "The printer's press-and-ball." / "The Bunch of Grapes." / "The baker's sheaf." / "The chandler's anchor." |

---

## 2. Coverage read

- **Tier A (spine-support, 8):** every required macro (①②③) and the two gated facts (Stamp schedule, writs/Custom House) has ≥1 reinforcing inspectable **on a path the spine already walks** — so even a pure-spine run passes several without detouring. These deepen the required concepts; they never gate them.
- **Tier B (concept micro, 10):** each maps 1:1 to a micro in `Act-1-Micro-Concepts.md` and is a *reliable tracked surface* for it — so a curious player engages micros through looking, not just talking.
- **Tier C (ambient flavor, 9+):** never tracked, deliberately dense — this is the saturation-law payload that makes "empty" streets teach. Reuses props already placed for collision/dressing, so it's ~free.

**Everything-you-see check:** there is no zone without a Tier-A or -B inspectable on its natural path, and no long stretch without Tier-C texture. A player who *only looks* still absorbs port economics, the stamp's reach, the town's division, and the coming protest.

---

## 3. How it plugs into the systems

- **Living routes (`Boston-Quests-and-NPCs.md` §2A):** fetch/ferry routes are deliberately drawn *past* Tier-A/B inspectables (e.g., the tavern-note north-alley route passes `LORE-nonimport`, `LORE-drydinglaundry`). Seeing history on the way is the route's learning payload.
- **Fetch targets:** several inspectables double as **quest items** — `LORE-typecase` (Ned's tray fetch), `LORE-coinpaper` (a Mercer's errand), the effigy placard (B11). Retrieving/handling one = quest progress **and** the micro log.
- **Ledger + provenance (`ledger` spec, forthcoming):** each tracked focus-read writes an **exposure with provenance** ("saw the stamp schedule at the notice board") so the Archive's memory-cued hints can later say *"remember the schedule nailed by the pump?"* — the hint engine draws only from what this student actually inspected.
- **Archive decision-frame:** inspectables seed the context the Archive references at choices (having read `LORE-vicecourt`, the frame *"no jury for smugglers"* lands).

## 4. Build hooks

- Reuse the **tracked-read grammar** (`Interaction-Spec` §3) for Tier A/B; Tier C uses a look-prompt with **no logging**.
- A `FoundHistoryRegistry` (data table: id, asset ref, anchor, tier, conceptId|null, text-slice key) parallels the poster wiring already in `Act-1-World-Content.md` §6 — most entries are pure data + a decal/anchor.
- Tier-B/A focus-reads call the ledger's exposure API with `{ type: ARTICLE, conceptId, provenanceTag }`.
- **New assets: none physical.** Two small textures (`KN-coinpaper`, effigy placard) already on the §11 worklist; everything else is placement + strings.
