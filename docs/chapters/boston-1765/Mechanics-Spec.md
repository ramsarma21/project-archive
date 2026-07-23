# Boston — Mechanics-as-Lessons catalog

**Status: the canonical spec for every load-bearing gameplay mechanic in the Boston chapter, Act 1 first.** This is the operational half of the creed — *"everything you **do** teaches you"* — built on the delivery hierarchy's top rung: **the historical constraint IS the game constraint** (`Concept-Delivery-Map.md`). Each mechanic encodes its concept into its *rules, costs, and consequences*, so a player can't succeed without internalizing the history.

**Companions:** systems/stealth = `Act-1-Production-Plan.md` (Part D); quests/routes = `Quests-and-NPCs.md`; concepts = `Micro-Concepts.md`; spine = `Day-1-Build-Script.md`; existing rigs = `apps/web/src/world/MechanicRigs.tsx`; anim law = `Production.md` §3.

**Every mechanic entry follows one template:**
- **Verb / do** — the input + compound stages (no 1-second beats — `Gameplay-Design` §6).
- **Constraint = lesson** — the historical rule the mechanic encodes.
- **Cost** — clock / stamina / heat / Standing / coin (the two-budget model, `Gameplay-Design` §2).
- **Consequence** — bounded, deterministic, world-state (never a dead-end, never randomness).
- **Concept** — macro (①②③) or micro + draft TEKS.
- **Animation** — obeys the no-mocap law (object animates; body holds a library clip).
- **Accessibility equivalent** — a non-twitch way to succeed.
- **Build** — existing systems reused.

**Triple-bind gate:** every mechanic below teaches (learning), moves the world (state), and rewards skill (fun). If a proposed mechanic misses one leg, it's cut or redesigned.

---

## 1. The Press (compound occupational job) — `PRINTERS_ROLE`, macro ②

- **Verb / do:** the existing 3-stage press job — ink the bed → set/lock the sheet → pull the bar (`ProceduralPress`, cues `PRESS_PIKE_PROOF`/`PIKE_REPRINT`/`FINAL_PRESS_PULL`). Compound: each stage is a held/timed input with a clean-pull grade.
- **Constraint = lesson:** come 1 November **every sheet needs a stamp paid in coin** — so the shop's livelihood is directly taxed. The job *feels* laborious and valuable, which is exactly why the tax on it stings. Printers become the loudest opponents because the Act hits their press bed.
- **Cost:** clock (activity-budget); a sloppy pull wastes a sheet (minor Standing with Abigail).
- **Consequence:** clean run → Abigail vouches (Standing, a Mercer's route favor); the printed handbill becomes the item the rider-relay run carries (links mechanics).
- **Concept:** ② Stamp = internal tax on paper; micro `PRINTERS_ROLE`, `HARD_COIN_SCARCITY`. TEKS (draft) 8.4(A), 8.29.
- **Animation:** object = press bed/bar (`ProceduralPress`); body = `work1/work2`; FP hands for ink/lock. New clips: none.
- **Accessibility:** hold-to-complete with a generous window; grade optional.
- **Build:** live in `MechanicRigs.tsx`; extend cue set only if a new proof is needed.

## 2. The Search / Writs of Assistance (compliance set-piece) — `WRITS_OF_ASSISTANCE`

- **Verb / do:** at the customs checkpoint (`officer` @ [−56], `WATCH-customs`) or Custom House, you're stopped and must **present the bag**: a short interaction where the officer paws through your goods while you hold position (can't flee without converting to a chase). Player choice: **comply** (safe, slow, galling) or **refuse/evade** (converts to the stealth/chase system).
- **Constraint = lesson:** the officer searches **on a writ that names no one and never expires** — you have no standing to object, and that powerlessness is the point. The mechanic makes you *feel* the general warrant by removing your agency during it.
- **Cost:** comply → clock + a bite of dignity (a Standing note "searched"); refuse → heat↑ and a chase.
- **Consequence:** deterministic — comply always clears you (handbills aren't yet contraband); the *experience* of being searched is the payload. High heat later makes searches more frequent (the town tightens).
- **Concept:** micro `WRITS_OF_ASSISTANCE`, `VICE_ADMIRALTY_COURTS` (the notice inside); supports ①. TEKS (draft) 8.4(A), 8.19 rights.
- **Animation:** object = bag/goods lifted and inspected (reuse `RiderBundle`/`HaulBoltStaging` tween); body = `idle`/`argu1`; officer `talk`/`work1`.
- **Accessibility:** comply path is fully non-twitch; the lesson lands either way.
- **Build:** field tag + the existing encounter/camera grammar; escalation to chase uses `ChaseDirector` (Part D.7).

## 3. Contraband / Ferry run (stealth carry) — `LOYAL_NINE`, `EFFIGY_PROTEST`

- **Verb / do:** carry a wrapped bundle across the **watched** Custom House stretch (Z5, 2 posted watchers) to a contact — a full stealth traversal: concealment folds, crowd cover, timing the cones, and the owned back-routes. This is `CH-agitator-dare`, generalized as the template for every risky ferry.
- **Constraint = lesson:** the movement must move **material and messages in secret because the Crown can search at will** (ties to §2). You learn *why* the Sons of Liberty operated covertly by having to operate covertly — organized resistance as tradecraft, not spectacle.
- **Cost:** clock + heat exposure; stamina if it becomes a chase. Standing *buys* safety (a high-Standing face draws fewer checks — social camouflage, Part D.5).
- **Consequence:** clean run → big Standing + movement trust (unlocks rumors/threads); a drawn spot-check → heat↑ but **the contact still takes it later** (bounded, no dead-end). The Archive decision-frame fires at the entry: *"(The watch remembers faces.)"*
- **Concept:** micro `LOYAL_NINE`, `EFFIGY_PROTEST`, `NEWS_NETWORKS`; supports ③. TEKS (draft) 8.4(A)(B).
- **Animation:** carry = `carry`/`carryWalk`; conceal fold reused; hand-off = `handoff` + bundle tween.
- **Accessibility:** a slower, patient route always exists (wait out cones with crowd cover); no reflex requirement.
- **Build:** full Part-D stealth stack + `ReactiveNpcDirector` giver/contact; deterministic detection.

## 4. Boycott & Homespun (economic choice mechanic) — `NON_IMPORTATION`, macro-support ①

- **Verb / do:** a **provisioning choice** surfaced whenever you buy/haul for an errand or a Thread: take the **cheaper imported British goods** (fast, plentiful) or the **costlier local/homespun** (slower, scarcer). Sarah's stall, Thomas's ledgers, the drying-line homespun (`LORE-drydinglaundry`) are the touchpoints. It recurs — it's a standing decision, not a one-off.
- **Constraint = lesson:** **non-importation only works if the town holds together** — and it costs *you* (and ordinary people like Sarah) real comfort now for collective leverage later. The mechanic makes the boycott a genuine tradeoff, so the student feels why it was hard to sustain and why merchants defected. Collective action + its human cost, encoded.
- **Cost:** choosing homespun → more clock/coin now, but Standing with the movement + Thomas/Sarah warmth; choosing imports → cheap/fast now, but a Standing ding and a Loyalist-adjacent read.
- **Consequence:** a persistent **boycott-participation flag** the town references (crowd lines, Sarah's Thread B trajectory toward the Daughters of Liberty in Act 2, Thomas's favor → dock route). Deterministic, bounded.
- **Concept:** micro `NON_IMPORTATION`, `PORT_TOWN_BOSTON`, `HARD_COIN_SCARCITY`; supports ① and the "free markets vs. coercion" pattern. TEKS (draft) 8.4(A), 8.12 economics.
- **Animation:** object = goods swapped at a stall/counter (reuse market props + `handoff`); body = `talk`/`work1`. No new clips.
- **Accessibility:** purely a menu-style choice; no execution skill.
- **Decision-frame:** *"(A boycott only bites if everyone holds.)"*
- **Build:** a `ProvisioningChoice` hook on buy/haul interactions; a boycott flag in the runtime contract beside Standing.

## 5. Town-meeting / Rally (crowd set-piece with on-ramp) — `LOYAL_NINE`, `NEWS_NETWORKS`, macro ③

- **Verb / do:** the tavern meeting and the dusk gathering at the elm. **Not a passive watch** — it keeps a gameplay on-ramp (`Gameplay-Design` §10): spread the call (`SJ-crier` hold-to-call at 3 spots), carry the meeting-note (§3 ferry), then at the elm **join the crowd action** (a chant/press-in `cheer1`/`argu1` input) as the effigy goes up.
- **Constraint = lesson:** the Aug 14 action was **planned, organized, and theatrical — not a random riot** (the Loyal Nine staged it). By *participating in the staging* — spreading word, assembling, chanting — the player learns organized, deliberately non-violent protest as a *process* with organizers, not a spontaneous mob.
- **Cost:** clock + heat (a rally raises the town's temperature); Standing gates how the crowd receives you.
- **Consequence:** attendance + your spread-the-word contribution set flags that ripple into Act 2 (the movement remembers who showed); the fixed event B11 plays out regardless (spine-safe), but your involvement colors it.
- **Concept:** ③ organized resistance; micro `LOYAL_NINE`, `NEWS_NETWORKS`, `EFFIGY_PROTEST`, `ANDREW_OLIVER`, `LIBERTY_TREE`. TEKS (draft) 8.4(A)(B), 8.29.
- **Animation:** object = effigy raise (existing event rig) + notice/bell; body = `cheer1`/`argu1`/`idle`; crowd via `PopulationDirector` staging.
- **Accessibility:** the chant on-ramp is a simple timed press or hold; observing still logs the tracked beat.
- **Sparing cutscene budget:** the effigy-raise itself is the one marquee moment allowed a short cinematic (delivery hierarchy rung 3); everything around it is playable.
- **Build:** `SJ-crier` markers + `ChoreographyDirector`/`PopulationDirector` for the crowd + the existing B11 event.

## 6. News-network relay (timed ferry) — `NEWS_NETWORKS`

- **Verb / do:** the rider handoff (B10) generalized: printed handbill from Mercer's press (§1) → carry to the rider post (`RIDER_POST` [−95]) **before the bell** — a soft-timed run that can route through owned back-lanes to shave heat.
- **Constraint = lesson:** ideas moved through **informal networks — printers, riders, taverns — the seedbed of the committees of correspondence.** The relay makes the network tangible: you *are* the link between press and post.
- **Cost:** clock (soft timer); late → the bundle "stays in Boston" (a flavor consequence + rider-trust ding), never a fail-state.
- **Consequence:** on-time → rider network trust (a route/rumor favor); links the Press mechanic (§1) to the wider chapter.
- **Concept:** micro `NEWS_NETWORKS`; supports ③. TEKS (draft) 8.4(A), 8.29.
- **Animation:** `RiderBundle` tween + `carryWalk`/`handoff`.
- **Accessibility:** timer is generous; owned routes make it trivial once discovered (rewarding exploration).
- **Build:** existing `RiderBundle` + timer + `MARKER_ANCHORS` corridors.

---

## 7. Cross-mechanic principles

- **Mechanics interlock (the alive world):** the Press prints the handbill → the relay carries it → the meeting it announces is the rally → the rally's secrecy is why the ferry run is stealthed → the search is why secrecy is needed. Doing one exposes the next; that chain *is* the chapter's engagement engine.
- **Standing is the connective currency** (`Act-1-Production-Plan` D.5): every mechanic reads/writes it, so social choices and skill both compound into how safe and welcome the town makes you.
- **Two budgets, always** (`Gameplay-Design` §2): the required spine mechanics (Press, Search, one relay) spend the learning budget; contraband/boycott/rally depth is optional and spends the escalation clock.
- **Determinism + bounded consequence** (`Backend-AI-System`, FR): no mechanic uses randomness; failure costs heat/Standing/clock, never a dead-end or lost macro.
- **Anim law honored everywhere:** every mechanic above maps to an existing body clip + object motion; the only flagged new clip across the catalog is *none* (all reuse `work/carry/handoff/cheer/argu/idle`). New work is data, markers, and text.

## 8. Build order (maps to Production Plan milestones)

- **M1-M2 (spine):** Press (exists), Search compliance, one relay — the required carriers.
- **M3 (reactive world + Standing):** Boycott/Homespun choice hook, town-meeting on-ramps, `ReactiveNpcDirector` givers.
- **M4 (stealth stack):** Contraband/ferry run, search→chase conversion, escape sequence.
- **M5 (polish):** rally crowd choreography + the one sanctioned cutscene.

## 9. Locked decisions (2026-07-21)
1. **Search→chase conversion** — refuse/run is **always allowed** (GTA-style agency); it converts to a chase **deterministically** (no random draw for *whether*). Current **heat sets the difficulty**: low heat → 1 pursuer, short cones; high heat → up to the ≤4 cap join, longer cones. Comply always clears you (seeded outcome for wrapped goods per `Day-1-Build-Script` B9). No dead-ends.
2. **Boycott flag granularity** — a single global `boycottStanding` scalar (0..N) **plus** two named per-merchant flags where threads need them (`thomas`, `sarah`). Not per-merchant across the board — the scalar drives crowd/Standing reactions; the two flags drive Thread B / Thomas payoffs in Act 2.
- **Deferred to content/text-slice (not a systems blocker):**
  3. Author the **draft dialogue/prompts** for each mechanic's choice moments (localhost text slice).
