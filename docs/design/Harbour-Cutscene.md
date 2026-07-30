# Harbour cutscene — File 1, "the closure" (Boston Port Act)

Production package for the **first** cutscene we generate: the M1 lesson's File 1 clip. Two
deliverables: **(A)** a video-model recommendation researched against our exact constraints, and
**(B)** the harbour scene nailed down shot by shot.

**This is the design of record for THIS clip only.** The binding, accumulated decisions live in
`docs/design/M1-Remedial-Slice.md` (cited throughout, not edited — the orchestrator is editing it).
Docs-only; no code changed.

**What File 1 teaches** (from measured STAAR data, `content/staar/item-performance.json`; see
`M1-Remedial-Slice.md` §"The slate", concept 2): the Boston Port Act **punished the whole town,
not just the men who destroyed the tea.** This is the #1-missed idea in the slice — 41–43% correct
on the two released items (STAAR 2021 #38, 2022 #4). The distractor to refute: that Parliament's
response was *ordinary governance* aimed at *the guilty*, rather than *collective punishment* aimed
at a whole town, innocent and guilty together.

**Inherited constraints that bind this package** (all from `M1-Remedial-Slice.md`, owner, 29–30 Jul):
- Clips run **10–20 s**, built as a **short edited sequence of cut shots** (wide → over-shoulder →
  close), stitched or via multi-shot generation — not one unbroken take.
- **Audio is dubbed in post.** Generate **silent, mouth-moving** video; TTS voice + ambient +
  subtitles are added later. **Native lip-sync is NOT required** — mouths moving is the floor.
- **Render style is the game's own stylized 3D-asset look** — matching our Meshy/GLB characters and
  world. NOT photoreal, NOT hologram-filtered. "History as it was" governs *content and staging*
  (accurate period detail, real events); the *render* is a real-time game-cinematic.
- **No text baked into frames** — no signage, labels or captions. Documents are separate real
  stills (`ModuleVisual`); subtitles are our own UI overlay.
- **Period/historically accurate** — teacher-facing product, no invented events. Real curriculum
  figures only where they genuinely fit, never forced.

---

# Deliverable A — video-model recommendation

Researched against current (2026) sources; see **Sources & confidence** at the end. Native audio is
now a **don't-care** (we dub), so it carries **zero weight** here. The field is judged on: 10–20 s
via multi-shot/extend · prompt adherence · character/style consistency from reference images ·
stylized (non-photoreal) look on demand · no-baked-text control · per-clip **silent** cost · API
access.

## The field (verified July 2026)

| Model | Max single take | Multi-shot / extend | Reference & consistency | Stylized-on-demand | Native res | Silent per-sec (fal.ai) | API access |
|---|---|---|---|---|---|---|---|
| **Kling 3.0 / 3.0 Omni** (Kuaishou, rel. 5 Feb 2026) | 3–15 s (flexible) | **2–6 connected cut shots in ONE call**; each shot its own prompt/duration | Start-frame + **element reference**, **multi-character coreference (3+)**, identity lock from one photo or a short clip | Photoreal *bias*; overridable via reference frames | **1080p** (4K mode, up to 60 fps) | **$0.112/s** (audio off); ~**$0.224/s** with element refs | fal.ai · Replicate · official Kuaishou API |
| **Seedance 2.0 / 2.5** (ByteDance, rel. Feb 2026) | 4–15 s (one coherent take) | Multi-shot via prompt; strongest **multi-reference blend** | **Reference-to-video: up to 9 images + 3 videos + 3 audio** (2.0); @-tag asset system (2.5) | **Creative-stylization leader** — define a look, hold it across shots | 480p/720p (2.0, **720p cap on fal**); 2.5 claims 4K¹ | **$0.302/s** std, **$0.242/s** fast; **~$0.18/s** R2V-with-video¹ (audio always included) | fal.ai · Replicate · Volcano Engine (CN) |
| **Runway Gen-4.5 / Gen-4** | 5–10 s | Stitch (Extend is Gen-3-era¹); strong cross-shot **character reuse** | 1–3 reference images (style/environment), best-in-class **character consistency**, Motion Brush, camera rig | **Good** — architecture skews creative/cinematic | 720p (4K via upscale) | **$0.12/s** (Gen-4.5); **$0.05/s** (Gen-4 Turbo) | Runway API · WaveSpeed (**not on fal**) |
| **Veo 3.1** (Google DeepMind) | **4/6/8 s only** (ref-image = 8 s) | Extend to >1 min via **Flow** scene-chaining | 1–3 reference images; first/last frame | **Weakest** — "tries to make everything look real"¹ | 720p/1080p/**4K** | **$0.20/s** (no audio); Fast **$0.10/s** | Google Gemini API / Vertex · fal.ai · Atlas Cloud |
| **Sora 2 / 2-pro** (OpenAI) | up to 20 s (pro)¹ | Video-extend; Characters API | Image conditioning (first-frame); Characters best for **non-human** subjects | Moderate | 720p/1024p/1080p | $0.10/s (sora-2); $0.30–0.70/s (pro) | **Excluded — see below** |

¹ Lower-confidence claim; see **Sources & confidence**.

## Ranked

### 1. Kling 3.0 / 3.0 Omni — **recommended pick**
- **10–20 s:** best structural fit. Its **multi-shot mode returns 2–6 connected cut shots in a
  single generation**, each with its own prompt, size and camera — i.e. *one lesson beat = one job*,
  which is exactly the "wide → over-shoulder → close" sequence the design calls for. A 15 s beat is
  one call; a 20 s beat is two.
- **Reference/consistency:** start-frame + **element reference** + **multi-character coreference**
  and identity-lock from a single still or a short clip. This is the hook for our #1 anti-slop
  lever — feed frames/clips rendered from our own `*-rigged` GLBs and the harbour set, and it holds
  our characters and palette across the cuts (`M1-Remedial-Slice.md` §"Style match").
- **Stylized:** it has a photoreal *bias* (a real weakness), but that bias is neutralised by
  anchoring on our own stylized frames — the same lever that makes any of these usable for a
  non-photoreal house look. It is not a stylization *specialist* the way Seedance is.
- **No-baked-text:** controllable via negative prompt; **caution** — Kling now advertises "native
  text rendering," so we must *explicitly* suppress lettering/signage (all text lives in stills +
  UI overlay).
- **Cost:** lowest silent per-second of the serious contenders ($0.112/s at 1080p, audio off).
- **API:** mature — fal.ai, Replicate, and Kuaishou's own API.

### 2. Seedance 2.0 / 2.5 — **co-lead; win it in a bake-off**
- **The strongest style-lock.** Reference-to-video accepts **up to 9 images + 3 videos + 3 audio**
  in one call, and it is the **creative-stylization leader** — purpose-built to take a defined look
  and hold it across shots. For preserving *our* GLB art style specifically, it is at least Kling's
  equal and plausibly better. It also directly supports the doc's "render a 5–10 s reference clip
  from our rigs and feed *that*" recommendation (up to 3 reference **videos**).
- **10–20 s:** 4–15 s coherent takes; strong. Its idiom is "blend these references," less "direct
  this cut list" than Kling's Omni multi-shot.
- **Weaknesses vs us:** **720p ceiling** on international APIs (2.0) matters for a full-screen
  classroom cutscene; audio can't be turned off for a discount (we pay for audio we discard);
  slightly higher per-second than Kling.
- **API:** fal.ai, Replicate, Volcano Engine.

### 3. Runway Gen-4.5 — **cheap, character-consistent alternative**
- **Best cross-shot character reuse** (save a character, reuse it) and good stylization, Motion
  Brush and precise camera control, cheapest per-second ($0.05–$0.12/s). If the harbour clips ever
  need a *recurring named figure* across File 1→4, this is the strongest at holding one identity.
- **Weaknesses vs us:** **10 s max** (a 10–20 s beat is stitched, not one call) and **not on
  fal.ai** — a separate Runway/WaveSpeed credential. Reference is tuned more to *style/environment*
  than to *face* identity by some accounts.

### Noted, not ranked
- **Veo 3.1 — the realism specialist, which is the wrong axis for us.** Highest prompt adherence
  and the only easy 4K, but it is reported the **weakest at non-photoreal/stylized output** — it
  "will fight you" on a stylized look. Since the owner's call is explicitly *non-photoreal game-3D*,
  Veo's headline strength is a liability here. **Keep it in reserve only if that call is ever
  reversed** (it would be the top pick for a photoreal "history as it was" look). Also stamps
  **SynthID + C2PA** provenance on every frame (invisible; not a legibility problem, but note it).
- **Sora 2 — excluded.** Technically a fit (up to 20 s, image conditioning), but **OpenAI has
  scheduled the Sora 2 / Videos API for removal on 24 Sep 2026.** Building the pipeline on a
  deprecated endpoint is disqualifying. Its Characters feature is also documented as best for
  *non-human* subjects, and human-likeness content policy adds friction.

## Recommendation

**Primary: Kling 3.0 Omni.** It is the only contender that produces a **multi-shot cut sequence in
one generation** at **1080p** with **element/character references** at the **lowest silent cost** —
a direct match to "a 10–20 s beat built as cut shots, in the game's style, anchored on our own
assets, audio dubbed later."

**But settle Kling vs Seedance with a one-afternoon bake-off**, because the single thing that most
determines quality for us — *how faithfully a model preserves OUR specific stylized art style when
fed our GLB reference frames* — **cannot be read off a spec sheet.** Generate the same harbour Shot 1
on both from the same reference frame and judge by eye against the game. Seedance is the stylization
leader and may hold our look better; Kling wins on 1080p, multi-shot-in-one-call, and cost. Whichever
preserves the house style with the least drift wins the lesson.

## Cost

Published fal.ai per-second rates, July 2026, **audio off** (we dub). Estimates — real spend depends
on the accept/reject ratio and whether element references are enabled (which roughly doubles Kling's
rate).

- **One 10–20 s harbour beat, single accepted render (Kling 3.0 Pro, 1080p, silent):**
  ~**$1.70** (15 s, no refs) → ~**$4.50** (20 s, with element references).
- **Iterating that beat ~10×** (drafts + final): ~**$20–$45**. Seedance lands ~$27–$45 (720p);
  Runway Gen-4.5, two stitched 10 s shots, ~$24 (Gen-4 Turbo far less for drafts).
- **The whole 4-file lesson pass, iterated:** **low hundreds of dollars** (~$80–$180). Cheap next
  to the design/authoring cost. (Consistent with the doc's "~$10 for a 60 s single pass" once you
  add ~10× iteration.)

Cost is **not** the deciding factor — all four serious models sit in the same low-tens-of-dollars
band per beat. Capability fit decides.

## Exact owner action to obtain access

**Create a fal.ai account, add billing, and generate an API key.** One credential unlocks **Kling
3.0 Pro, Seedance 2.0, and Veo 3.1** behind one SDK with one-line endpoint swaps — so the owner can
run the Kling-vs-Seedance bake-off (and sanity-check Veo) on a single key without per-vendor signup.

- Primary: **`FAL_KEY`** from <https://fal.ai> → Dashboard → API Keys. Load ~$20–$50 to iterate the
  first beat comfortably.
- Only if Runway Gen-4.5 enters the bake-off: a **separate Runway API key**
  (<https://dev.runwayml.com>) or WaveSpeed — Runway is **not** on fal.
- Deliver the finished clip as an MP4; the `ModuleVideo` slot already accepts a real MP4 of any
  length, drop-in is one line in the file's scene (`M1-Remedial-Slice.md` §"BLOCKER").

Everything downstream (silent generation, TTS dub, ambient, subtitle overlay, `PROJECT_RECONSTRUCTION`
classification, historical QA) is already specified in `M1-Remedial-Slice.md` and needs no new access.

---

# Deliverable B — the harbour scene, shot by shot

## The teaching target

**Refute the distractor, not the topic** (`M1-Remedial-Slice.md` §"The organising principle"). The
41–43% who miss this read the closure as ordinary, targeted governance. The clip refutes that by
**showing the blast radius on people who had nothing to do with the tea** — a shut harbour and the
fisherman, porter and cooper idled beside it. The concept is carried by *what is on screen and who is
ruined*, not by narration explaining it.

## Scene summary (one paragraph)

June 1774. We open on Boston's harbour the way the Act left it: a forest of idle masts, furled
sails, not one vessel working, and Royal Navy warships anchored across the harbour mouth enforcing
the blockade — a working port gone silent. We move in to the wharf itself, where ordinary working
people stand idle: a fisherman with nets he can't cast, a porter on a dead capstan, a cooper beside
barrels no ship will carry, a mother with children. We close on one weathered dockworker who looks
out at the warships and says, plainly, that he never touched their tea and yet the King has shut the
water on every soul in Boston, honest and guilty alike. Silent, mouth-moving footage in the game's
3D style; IRIS narrates two lean lines and the dockworker's grievance is dubbed over the close — all
added in post. It runs ~17 s as three cut shots and refutes exactly one thing: that this punished
only the guilty.

## Shot list (~17 s, three cut shots; trims to ~12 s, extends to ~20 s)

### Shot 1 — WIDE: the port shut (≈6 s)
- **On screen:** High, wide view down Boston's Long Wharf and harbour, June 1774. A forest of bare
  ship masts, sails furled and gasketed; cargo cranes/gin-poles idle; empty handcarts and stacked
  crates that no one is moving. Across the harbour mouth, two Royal Navy warships lie anchored,
  broadside on, gunports visible — the blockade. Overcast, flat grey light; a couple of gulls.
- **Camera:** slow dolly **push-in** from the high wide toward the dead wharf (or a slow lateral
  drift left-to-right across the still masts). Nothing in the frame moves under its own power — the
  stillness is the shot.
- **Staging:** the working machinery of a port, all stopped. Read the Navy ships as the *cause*, not
  scenery.
- **Conveys:** the port is closed and the closure is *enforced by force*. Scale first.
- **Advances the misconception:** shows the *whole* harbour dead — not a fine levied on a few, but
  the entire town's livelihood frozen at once.

### Shot 2 — MID / tracking: the people it idled (≈6 s)
- **On screen:** Down on the wharf planks. A short line of ordinary working people standing idle: a
  **fisherman** holding a net he has nowhere to cast; a **porter/dockworker** sitting on a silent
  capstan, forearms on his knees; a **cooper** beside a stack of his own barrels; a **woman with two
  children**. Plain 1774 working dress — linen shirts, wool waistcoats, leather aprons, buckled
  shoes, cocked or knit caps. Faces: worry, bafflement, banked anger. No one is working because
  there is no work.
- **Camera:** slower, lower, closer — a gentle **track** along the line of idled workers, or a slow
  **over-the-shoulder** from behind the dockworker looking out at the ships.
- **Staging:** these are visibly *tradespeople*, not agitators — the point is who they are.
- **Conveys:** the human cost, spread across every trade the wharf fed.
- **Advances the misconception:** puts faces on "the whole town" — fishermen, porters, coopers,
  families. None of them threw any tea.

### Shot 3 — CLOSE: one ruined man (≈5 s)
- **On screen:** Close on the **weathered dockworker's** face as he speaks (mouth moving), eyes on
  the water. Behind him, soft-focus, the anchored warship. A slow **rack focus** or short pull
  shifts the sharpness from his face to the ship and back — tying the single ruined man to the power
  that ruined him.
- **Camera:** locked close-up, shallow depth; minimal move.
- **Staging:** one human face holds the whole lesson; the warship in the background is the sentence
  he's serving for another man's act.
- **Conveys:** the injustice lands on an individual, in his own words.
- **Advances the misconception:** the innocent-and-guilty-together thesis, spoken by one of the
  innocent, straight to camera-adjacent.

**Assembly.** Generate as **Kling Omni multi-shot** (three shots, one job) so characters and palette
carry across the cuts, or generate three short shots and stitch with `ffmpeg` locally
(`M1-Remedial-Slice.md` §"Clip length"). Cut on motion settling; hold Shot 3 a beat longer for the
dubbed line to breathe. Total 10–20 s.

## VO / dialogue script (write now; **dubbed in post** — TTS voice + our subtitle overlay)

Two voices only, per the two-voices rule (`M1-Remedial-Slice.md` §"Adopt the established
vocabulary"): **IRIS** narrates in the handler/lesson register; the **dockworker** speaks only his
own 1774 grievance and knows nothing of any Archive. Keep IRIS lean — she frames, she does not
lecture.

- **IRIS** *(over Shot 1, calm, precise):*
  > "June, 1774. For the tea thrown into this harbour, Parliament closed the whole of it —
  > every wharf, every ship — until Boston paid for what a few men had done."

- **IRIS** *(over the cut into Shot 2, one clipped line):*
  > "The order did not stop to ask who was guilty."

- **DOCKWORKER** *(diegetic, over Shot 3 — plain, bitter, unhurried; a working man, not a
  narrator):*
  > "I never laid a hand on their tea. Fifteen year I've hauled on this wharf. Now there's not a
  > ship to unload, and the King's shut the water on every soul in Boston — the honest man with the
  > guilty."

*Notes.* Keep the dockworker un-AI: short clauses, a concrete number of years, a working verb
("hauled"), no vocabulary he wouldn't own. Two IRIS lines is the ceiling — the picture and the
dockworker do the teaching. Subtitles carry meaning regardless of sync, so mouth movement need only
be *present*, not matched (`M1-Remedial-Slice.md` §"Audio is added in post").

## Ambient (added in post; **silence is the design**)

- **Shot 1:** water lapping pilings; the slow creak of idle rigging; wind; one lone gull. The
  *absence* of the normal port roar — no windlasses, no shouting stevedores, no rolling casks — is
  the ambient point. A working harbour that makes no working sound.
- **Shot 2:** low murmur of a few voices; a child; footsteps on wet planks; a distant ship's bell
  from a Navy vessel across the water.
- **Shot 3:** wind and water close; a single rigging creak; the dockworker's voice near the mic. Let
  it end quiet.

## Per-shot generation prompts (game-3D style, period-accurate, no on-screen text)

Built on the agreed anchors in `M1-Remedial-Slice.md` §"Render style". Use the **shared prefix** on
every shot for cohesion, then the per-shot body. For image-to-video, anchor each on a frame rendered
from our own harbour set + townsfolk GLBs (or a short clip from the rigs) so identity and palette
lock across cuts.

**Shared prefix (all shots):**

```
Stylized 3D rendered cinematic, real-time game-engine look: clean 3D character models, PBR
materials, soft global illumination, gentle volumetric haze. NOT photoreal, NOT live-action, NOT a
documentary, no hyperreal skin. Cohesive with a stylized historical video game. Setting: the
waterfront of colonial Boston, June 1774 — accurate 18th-century detail (period ships, rigging,
dress, dockside gear). Overcast grey daylight, muted maritime palette.
Negative / must not appear: on-screen text, signage, lettering, captions, subtitles, numbers,
logos, watermarks; any modern object; bright saturated color; cartoon/anime styling; photoreal
skin. Characters may move their mouths and gesture as if mid-conversation; audio is not needed.
```

**Shot 1 (wide, push-in):**

```
[shared prefix] Wide high-angle establishing shot looking down a long wooden wharf into a shut
harbour. A dense forest of tall bare ship masts, sails furled and tied; idle cargo cranes and
gin-poles; empty handcarts and stacked wooden crates left unmoved. Across the harbour mouth, two
Royal Navy warships lie at anchor broadside-on, gunports visible, blockading. Nothing works: no
loading, no crew activity. A few gulls; flat grey overcast light on grey-green water. Camera slowly
dollies forward toward the dead wharf. Anchored on the provided reference frame of our harbour set;
hold that art style and palette.
```

**Shot 2 (mid, tracking / over-shoulder):**

```
[shared prefix] Eye-level shot on the wharf planks. A short line of idle 18th-century working
people: a fisherman holding an uncast net, a porter sitting on a still capstan with forearms on his
knees, a cooper beside a stack of barrels, a woman with two children. Plain working dress — linen
shirts, wool waistcoats, leather aprons, buckled shoes, knit and cocked caps. Faces worried and
weary; no one working. Camera tracks slowly along the line (or holds over the dockworker's shoulder
looking out at the anchored warship). Same characters, palette and art style as the establishing
shot; anchored on the provided reference frames of our townsfolk GLBs.
```

**Shot 3 (close, rack focus):**

```
[shared prefix] Tight close-up on a weathered male dockworker in his forties, knit cap, stubble,
tired eyes, looking out over the water and speaking quietly (mouth moving, mid-sentence). Shallow
depth of field; behind him, soft-focus, the anchored Royal Navy warship. A slow rack focus shifts
sharpness from his face to the ship and back. Same character and palette as the previous shots;
anchored on the provided reference frame/clip of the dockworker.
```

## The real document is a separate still, never baked into the clip

File 1's authenticated primary source — the **Boston Committee of Correspondence's port-closure
circular**, which states the collective-punishment thesis nearly verbatim (*"…in Revenge to the
Patriotism of some, whom probably this Clause was inserted to punish."*), LoC, public domain — is a
**`ModuleVisual` still IRIS raises after the clip**, not text rendered into the video
(`M1-Remedial-Slice.md` §"Historical documents acquired", File 1 = STRONG). Every model garbles
in-frame text; our pipeline puts all readable text in real stills + the subtitle overlay. The clip
carries the *feeling* of the closure; the circular carries the *words* — and it is the strongest
document we have, so let it do that job.

## Does a real curriculum figure fit here? **No — and don't force one.**

A generic ruined dockside is exactly the case the doc warns against forcing a named figure into.
Putting Samuel Adams or John Hancock on the wharf as an idled laborer would be **invented and false**
— the opposite of a teacher-facing product's job. The authenticated named voice for File 1 is the
**Committee of Correspondence circular** (above), which appears as the document still, not as a
character. Keep the on-screen figures **anonymous period townspeople**; that anonymity *is* the
point of collective punishment.

*Optional, and only as a game-cohesion choice (not a historical claim):* the ruined merchant/worker
could be seeded on the game's **`thomas-rigged`** asset, since Thomas is the mission's merchant
"ruined by a closure he had no part in" (`M1-Remedial-Slice.md` §"Use the authored cast"). That
would tie the lesson to the mission visually. It is **optional** — a generic dockworker reads fine
and avoids over-loading the lesson with mission casting. Do not force it.

## Gates this clip must pass (from `M1-Remedial-Slice.md` §"Two gates")

1. **Historical QA.** These models hallucinate period detail — wrong ship rigs, wrong uniforms,
   anachronistic dockside gear, modern objects. The clip goes through the pipeline's
   visual/historical QA before it ships. Likely failure points to check by eye: the Navy ships'
   period (mid-1770s rig, not Napoleonic), the dress, the wharf construction, no stray modern shapes.
2. **Provenance.** The clip is a **`PROJECT_RECONSTRUCTION`** and must be classified as one; a
   student must never be able to file a generated clip as primary evidence. (The circular still is
   the primary source; the clip is a reconstruction.)

---

# Historical accuracy notes (verified; see Sources)

- **Dates.** Passed by Parliament in spring 1774 (sources differ: 25 vs 31 March — low-stakes here),
  royal assent **20 May 1774**, **effective 1 June 1774**. The **1 June** effective date is firm and
  universally agreed. June 1774 is the correct setting for the clip.
- **What it did.** Closed the Port of Boston to *all* commercial loading and unloading — any ship,
  any business — between Nahant Point and Alderton Point, until Boston made restitution to the **East
  India Company** (for the destroyed tea) **and** to the Crown (for lost customs duty), and the King
  judged the town fit to obey; otherwise the blockade stood indefinitely. Massachusetts' seat of
  government was moved to Salem. (Not needed on screen; supports accuracy.)
- **Enforcement.** **Royal Navy** warships patrolled/blockaded the harbour mouth; the **British Army**
  under **Gen. Thomas Gage** (Commander-in-Chief, and now governor) filled Boston with troops. The
  warships in the shots are historically correct and are the visible instrument of the closure.
- **The blast radius (the lesson).** The Act "damaged the provincial economy, drove up unemployment,
  and starved the Boston people" — thousands who had no part in the Tea Party. The only imports
  permitted were provisions for the Army and necessities such as fuel and food, landed under control.
  This is the historical backbone of the collective-punishment concept.
- **Solidarity (context, not in this clip).** Other colonies sent relief overland — South Carolina
  rice, grain, sheep — and Boston leaders boasted the town could become a chief grain port. This is
  the seed of the *mission's* relief-distribution loop (`M1-Remedial-Slice.md` §"The core loop"), and
  is better left to the mission than crowded into File 1, which should stay on the closure itself.

---

# Sources & confidence

**High confidence (multiple independent sources, July 2026):**
- **History** — Wikipedia *Boston Port Act*; Mount Vernon *Coercive (Intolerable) Acts of 1774*;
  Britannica *Boston Port Bill*; bostonteapartyship.com (Act text); Gettysburg *Coercion Gone Wrong*.
  Agree on the 1 June 1774 effective date, the all-shipping closure, Royal-Navy enforcement, the
  economic devastation across the town, and the relief from other colonies.
- **Kling 3.0** — kling.ai model guide + Nasdaq launch release (5 Feb 2026): 15 s max, 2–6 multi-shot,
  element reference, multi-character coreference, 1080p/4K, native audio. **fal.ai** pricing:
  $0.112/s (audio off) / $0.168/s (audio on) / +$0.224/s with elements.
- **Veo 3.1** — Google Cloud model card: **4/6/8 s only**, ref-image = 8 s, 720p/1080p/4K, SynthID +
  C2PA. **fal.ai**: $0.20/s (no audio) / $0.40/s (audio).
- **Seedance 2.0** — ByteDance technical report (arXiv) + seed.bytedance.com: 4–15 s, up to 9 images
  / 3 videos / 3 audio references, native 480p/720p. **fal.ai**: $0.302/s std, $0.242/s fast.
- **Runway Gen-4/4.5** — runway.com research page + Runway API pricing: 5–10 s, character consistency
  from references, $0.05/s (Turbo) / $0.12/s (Gen-4.5); not on fal.
- **Sora 2 deprecation** — OpenAI deprecations page via multiple trackers: Videos API / sora-2 removal
  **24 Sep 2026**. This is the disqualifier; verify on OpenAI's own deprecations page before relying.

**Lower confidence — label as unverified / bake-off before trusting (marked ¹ above):**
- **Prompt-adherence percentages** (Veo ~87% > Seedance ~82% > Runway ~78% > Kling ~71%) come from a
  *single* comparison blog (aivideoadvisor). Treat as directional, not measured. The *stylized-vs-
  photoreal* ranking (Seedance/Runway strong, Veo weakest, Kling photoreal-biased) recurs across
  several sources and is more trustworthy.
- **Seedance 2.5** specifics (4K native, 50-reference @-tag system) are from marketing/one source; the
  peer-reviewed 2.0 report says 480p/720p. Verify before assuming 4K.
- **Seedance R2V-with-video ~$0.18/s** is a fal multiplier (×0.6) reading; confirm at call time.
- **Runway "Extend is Gen-3-only"** is from one guide; Runway ships fast — check current docs.
- **The one claim no source can settle: how well each model preserves OUR specific stylized GLB look
  from reference frames.** That is why the recommendation is "Kling, but bake off against Seedance on
  a real reference frame." Judge by eye against the game; do not trust a spec sheet for it.

Model capabilities and prices move week to week — re-verify the two or three that survive the
bake-off before the owner commits spend.
