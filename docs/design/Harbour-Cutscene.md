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

# Small first test (iterate before the full clip)

**Do this before generating the full clip.** The owner validated image-to-video on Kling (a
screenshot of one of our 3D assets → clean 3D-game motion); production runs on **Runway Max
(Gen-4.5)**, and the method is **iterative**: prove the model on the smallest useful shot, judge it,
*then* expand — so credits are not spent on a full sequence that drifts. Two small tests are worth
running, both seeded off frames rendered from our **actual** GLBs: **(1)** the establishing wide of
the shut harbour — does the model hold our art style in motion; and **(2)** a **character
identity-lock** via Runway References — does *our* character survive into a generation, the thing a
plain start-frame test never covers.

**These frames are re-done, correctly.** The earlier `shot1/2/3.png` were composed wrong (owner's
call — they did not match the real scene) and are **not** used here. The frames below were
re-rendered by `assets/pipeline/shot_harbour_refs.mjs` (`SHOT=test`) to match the owner's real
in-game harbour photo `assets/reference/harbour-cutscene/real-harbour-ingame.png`: near eye-level
third-person, a plank deck filling the foreground, two tall ships moored close on the LEFT (hulls +
furled rigging), working gear (idle timber crane + a leaning ladder) on the RIGHT, a rope rail at
the water's edge, and a **low hazy sun over open water**. (Note the mood is the photo's low warm
haze, *not* the flat overcast the older prompts below describe — the prompt here matches the frame
actually uploaded.)

## Picture naming — how to tag each reference in Runway

Runway References are strongest at **characters and locations** (object/style support is weaker), so
tag those and lean on the init frame for ships. Save each picture in the References panel (hover →
**tag** → name → Enter); the name is what you type as `@name` in prompts, and it persists across
sessions.

| Picture (in `test/`) | Tag it in Runway as | Type | Note |
|---|---|---|---|
| `establishing.png` | — (do **not** tag) | scene seed | this is the **Image-to-Video init frame**, not an `@`-reference |
| `ref-player.png` | `@player` | character | strong |
| `ref-dockhand.png` | `@dockhand` | character | strong |
| `ref-wharf.png` | `@wharf` | location | strong |
| `ref-brig.png` | `@brig` | ship | weaker — Runway favours characters/locations; the init frame carries ships better |

Keep the scheme **one word, lowercase**, matching our cast/place names. Going forward: characters
`@abigail @thomas @pike @clarke @rider @constable`; locations `@printshop @shambles @townhouse
@meetinghouse @elm @yard`. Name the files to match the tag (`player.png`, `dockhand.png`, …) so the
library stays legible.

## Test 1 — the establishing scene (Runway Gen-4.5, Image → Video, no references)

Upload `assets/reference/harbour-cutscene/test/establishing.png` as the image. The art style is
already in the frame, so the prompt is only the motion:

```
Slow, gentle push-in over a still, shuttered 1774 Boston harbour at dawn. Everything is quiet and
idle — no crew, no cargo, nothing loading. Only faint motion: a slow shimmer on grey-green water,
thin drifting haze, one distant gull, the barest sway of furled rigging. Hold the uploaded frame's
stylized 3D game-render look, muted palette and low warm haze exactly. One continuous camera move
only — no shake, no orbit, no crash-zoom. No new objects, no people appearing, no text or captions
anywhere.
```
Settings: Gen-4.5 · **16:9** · **~5 s** for the test (10 s once it holds) · one gentle move · silent
(audio is dubbed in post).

## Test 2 — character identity-lock (Runway References) — the useful one

This tests what the start-frame shot doesn't: whether **our** character survives into a generation.
Two steps.

**Step A — make the keyframe (Image tool).** Drag `ref-dockhand.png` into References, tag it
`dockhand`. Prompt (uses `@dockhand`):
```
@dockhand standing on the weathered plank deck of a shuttered 1774 Boston wharf, coiling a rope,
idle — no cargo moving. Behind him, tall square-rigged merchant ships lie moored with furled sails;
a low hazy sun over calm grey-green water. Keep @dockhand's exact face, hair and 1774 clothing from
the reference. Stylized 3D rendered game-engine look, PBR materials, soft global illumination, muted
maritime palette — not photoreal, no photographic skin, no live-action. No text, signage, captions,
logos or modern objects anywhere.
```
Judge the image: does the dockhand still look like ours? If yes, identity-lock works — that is the
result we need before building any character-driven cutscene.

**Step B — animate it.** Hover the good image → **camera icon** → Image-to-Video. The character is
baked into the keyframe now, so the prompt is just motion:
```
Slow push-in as the dockworker finishes coiling the rope and glances up. Minimal ambient motion —
water shimmer, faint haze, a slight sway of rigging. One gentle camera move, no shake. Silent, no
text.
```
Settings: Gen-4.5 · **16:9** · **~5 s** · up to **3 references** per generation · silent. The clip's
**last frame** seeds the next shot (the chaining pipeline).

## VO for post-dub (NOT sent to Kling)

Added later as TTS + our own subtitle overlay; trim to the shot length. IRIS, calm and precise:
> "June, 1774. For the tea thrown into this harbour, Parliament closed the whole of it — every
> wharf, every ship — until Boston paid for what a few men had done."

## If this looks right, expand to →

Add the next shots, chaining each from the previous clip's **last frame** (Runway's Image-to-Video
seeds cleanly from it) — **Shot 2**, a slow track along a line of idled dockhands (`@dockhand` /
`@player` held via References), then **Shot 3**, a close on one ruined dockworker — i.e. the full
three-cut sequence and prompts already specified in **Deliverable B** and the **send-package**
below. Validate the wide **and** the identity-lock first; only then spend on the rest.

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

---

# Platform pricing comparison (30 Jul)

Deliverable A priced everything on fal.ai. This section verifies those fal rates against every
platform that carries each shortlisted model, to answer one question: **is fal the right place to
run this, or is there a materially cheaper / better-access path for our exact job** — 10–20 s
clips, **1080p**, **silent** (we dub, so audio-on is wasted spend), iterated ~10× per beat across
~4 beats + the intro.

**All rates captured 29–30 Jul 2026 from each platform's own pricing/model page where possible;
prices in this category move weekly, so re-verify before committing spend.** Confidence is labelled
per number (H/M/L) with the source; anything unread-from-source is flagged. "Silent 1080p $/s" is
the audio-off (or audio-bundled-but-free) per-second rate at 1080p — the number that governs our
spend.

## Master table — silent 1080p per-second, by model × platform

| Model | Platform | Silent 1080p $/s | Access / minimum | Conf. | Source |
|---|---|---|---|---|---|
| **Kling 3.0 Pro** | **fal.ai** | **$0.112** (+refs **$0.224**; Std tier $0.084) | PAYG, no minimum, audio-toggle | **H** | fal.ai/models/fal-ai/kling-video/v3/pro |
| Kling 3.0 | Kuaishou official (kling.ai/dev) | ~$0.10–0.112 | Prepaid packages, **$9.80 min**, credits expire 30–180 d | M | kling.ai/dev summaries (login-gated) |
| Kling 3.0 | WaveSpeed | $0.112 (Pro) / $0.14 (Turbo Pro) | PAYG | M-H | wavespeed.ai/kling-3-api |
| Kling 3.0 | Replicate | ~$0.168 (**~1.5–2× fal**) | PAYG job API | M | reapi.ai; replicate.com/kwaivgi/kling-v3-video (listed) |
| Kling 3.0 | reAPI / EvoLink | $0.099 / $0.106 | PAYG resellers | M-L | reapi.ai; eesel/EvoLink |
| Kling 3.0 | Runway / Google / Ofox | **not hosted** | — | H | — |
| **Seedance 2.0** | **Ofox** | **$0.34** | One key, PAYG per-sec | M-H | ofox.ai (Seedance 2.0 page) |
| Seedance 2.0 | Segmind | $0.34 | PAYG, no minimum | M | segmind.com/models/seedance-2.0 |
| Seedance 2.0 | **ByteDance ModelArk / Volcano (direct)** | **$0.374** (no-video); **~$0.229 with video-ref** | Token-based; **free trial tokens** (see below) | H | byteplus.com/en/product/modelark |
| Seedance 2.0 | Runway direct | $0.40 (fast 720p $0.29; mini $0.16, $0.64 min) | Credits, $10 min | H | docs.dev.runwayml.com/guides/pricing |
| Seedance 2.0 | WaveSpeed | $0.50 (Fast t2v) / $0.325 (with-ref) | PAYG | M | wavespeed.ai (Seedance 2.0 Fast) |
| Seedance 2.0 | **fal.ai** | **$0.682** (720p $0.303 std / $0.242 fast) | PAYG; **~2× the cheapest 1080p route** | H | fal.ai/models/bytedance/seedance-2.0 |
| Seedance 2.0 | Replicate | listed, ~official per-sec (2.0 not pinned); older lite ~$0.018 (prior gen) | PAYG | L | replicate.com/bytedance |
| **Veo 3.1** | **fal.ai** | Std **$0.20** / Fast **$0.10** / Lite **$0.05** | PAYG, audio-toggle | H | fal.ai/models/fal-ai/veo3.1 |
| Veo 3.1 | Google **Vertex AI** (video-only rows) | Std $0.20 / Fast $0.10 / Lite $0.05 | GCP project; **$300 GCP trial** | M-H | Vertex AI generative pricing (captured 22 Jul) |
| Veo 3.1 | Runway direct | Std $0.20 / Fast $0.10 (no Lite) | Credits, $10 min | H | docs.dev.runwayml.com/guides/pricing |
| Veo 3.1 | Replicate | Fast $0.10 | PAYG | M-H | replicate.com/google/veo-3.1-fast |
| Veo 3.1 | Google **Gemini API** | **audio BUNDLED — no silent rate**: Std $0.40 / Fast $0.12 / Lite $0.08 | API key; no free tier | H | ai.google.dev/gemini-api/docs/pricing |
| **Runway Gen-4.5** | **Runway direct** | **$0.12** (~720p native; 1080p via upscale) | Credits $0.01, **$10 min**, no waitlist | H | docs.dev.runwayml.com/guides/pricing |
| Runway Gen-4 Turbo | Runway direct | $0.05 | as above | H | docs.dev.runwayml.com/guides/pricing |
| Runway Gen-4.5 / Turbo | Apiframe | ~$0.20 / ~$0.086 (cheaper on monthly plans) | PAYG or subscription | M | apiframe.ai/blog/best-runway-api-providers-2026 |
| Runway Gen-4 Turbo | Segmind / WaveSpeed | $0.10 / $0.01 (i2v only — see gotcha) | PAYG | M / L | segmind.com; wavespeed.ai |
| Runway Gen-4.x | fal / Google / Ofox | **not hosted** | — | H | — |

Also carrying all three bake-off models under one credential: **Higgsfield** (Sora 2, Veo 3.1,
Kling 3.0, Seedance 2.0, Hailuo, one credit pool, ~$0.10/s, M, techsy.io) — creator-grade,
per-model pricing less transparent than fal.

## Per-beat and ~10×-iteration cost (silent 1080p, cheapest viable route)

One accepted 15 s beat, and the same beat iterated ~10× (drafts + final). Kling and Seedance make
15 s in one call; Veo (8 s cap) and Runway (10 s cap) need two generations per beat.

| Model | Cheapest viable silent-1080p route | 1× 15 s beat | ~10× iteration |
|---|---|---|---|
| **Kling 3.0 Pro** (primary) | fal, no refs | **$1.68** | **~$17** |
| Kling 3.0 Pro **+ element/character refs** (our anti-slop lever) | fal, $0.224/s | **$3.36** | **~$34** |
| **Seedance 2.0** 1080p | Ofox/Segmind $0.34/s | **$5.10** | **~$51** |
| Seedance 2.0 1080p | **on fal $0.682/s** | $10.23 | **~$102** |
| Seedance 2.0 1080p + video-ref | ByteDance direct ~$0.229/s | $3.44 | ~$34 |
| **Veo 3.1** (reserve) Fast silent | fal/Vertex/Runway $0.10/s | $1.50 | ~$15 |
| Veo 3.1 Standard silent | fal/Vertex/Runway $0.20/s | $3.00 | ~$30 |
| **Runway Gen-4.5** | Runway direct $0.12/s (~720p) | $1.80 | ~$18 |
| Runway Gen-4 Turbo | Runway direct $0.05/s (~720p) | $0.75 | ~$7.50 |

**Whole lesson (4 beats + intro ≈ 5 beats, iterated ~10×), cheapest viable:** on the **Kling
primary path** ~$85 (no refs) to ~$170 (all with element refs), blended ~$120. **If Seedance wins
the bake-off and runs at 1080p, the platform choice swings the bill: ~$255 on Ofox/Segmind vs
~$510 on fal.** Every path is still low-hundreds-of-dollars — capability fit decides, not cost, as
Deliverable A said. But the Seedance-on-fal case is the one place platform choice doubles spend.

## Bottom line

**Get the fal.ai key — it is still the right call as the one credential for the bake-off and for
the likely primary (Kling) and reserve (Veo).** fal carries all three bake-off models, matches
Kuaishou's official Kling rate to the cent, lets you toggle audio off on Kling and Veo (the
silent discount we need), and is the cleanest PAYG with no minimum. The one caveat below is a
production-time move, not a reason to skip fal.

**(a) Cheapest place to run each model silently at ~1080p.**
- **Kling 3.0:** fal ($0.112/s) ≈ Kuaishou official ($0.10–0.112/s); a couple of resellers shave
  ~10% (reAPI $0.099, EvoLink $0.106) — immaterial. **Avoid Replicate (~1.5–2×).** fal is at/near
  the floor and the cleanest.
- **Seedance 2.0:** **Ofox or Segmind ($0.34/s)**, or ByteDance ModelArk direct ($0.374/s) — each
  **~half of fal's $0.682/s at 1080p.** fal is the *worst* place for Seedance 1080p.
- **Veo 3.1 (silent):** fal / Vertex AI video-only rows / Runway all tie ($0.20 Std, $0.10 Fast,
  $0.05 Lite; Lite only on fal & Vertex). **Do NOT use the Gemini API for silent Veo** — it bundles
  audio at $0.40/s with no toggle.
- **Runway Gen-4.5:** Runway direct ($0.12/s); Gen-4 Turbo $0.05/s. Not on fal.

**(b) One platform for the Kling + Seedance + Veo bake-off?** Yes: **fal, Replicate, and Higgsfield
each carry all three.** Runway direct covers Seedance + Veo but **not Kling**; Google is Veo-only;
ByteDance is Seedance-only; Ofox has neither Kling nor Veo. **fal is the best one-key option** —
official-rate Kling, audio-toggle on Kling/Veo, cleanest DX. Replicate is ~1.5–2× on Kling;
Higgsfield's per-model pricing is opaque. So: **run the bake-off on fal**, and *only if Seedance
wins and needs 1080p volume* move Seedance's production runs to Ofox/Segmind/ByteDance to halve
that model's cost. Kling and Veo are already at/near their floor on fal.

**(c) Free tier / credits worth doing first drafts on.**
- **ByteDance/Volcengine: new users get ~5M free tokens (~16 full 15 s 720p Seedance clips)** — a
  genuine free first-draft budget, *specifically for Seedance* (BytePlus ModelArk international also
  grants trial credits). Best free route to evaluate Seedance quality before paying.
- **Google Cloud: $300 GCP trial covers Vertex AI Veo** (~3,000 s of Veo Fast silent). Good for Veo
  drafts if Veo re-enters contention.
- **fal / Replicate:** small trial credits + cheap PAYG, no minimum — fine for Kling drafts at
  pennies each.
- Verdict: at ~50 total clips and low-hundreds total spend, free credits are a nice-to-have, not a
  deciding factor; the one-fal-key convenience for the bake-off outweighs chasing them. The
  Volcengine free tokens are worth using *if* Seedance is a serious Seedance-quality trial.

**(d) Gotchas that change the ranking.**
1. **Seedance audio can't be turned off** on any platform (bundled, same price on/off) — so for our
   silent workflow every Seedance second partly pays for audio we discard, and Seedance is the
   priciest model per silent 1080p second regardless of platform. Model property, not a platform
   lever. (Deliverable A already notes this.)
2. **Veo on the Gemini API bundles audio (no silent toggle) → $0.40/s instead of $0.20/s.** Use
   Vertex AI's video-only rows, or fal/Runway audio-off, to get silent Veo. Picking the wrong
   Google endpoint doubles Veo's cost.
3. **fal marks up Seedance ~2× at 1080p** ($0.682/s vs ~$0.34–0.374/s elsewhere). If Seedance is
   the pick at 1080p, fal is the wrong production platform for it.
4. **Kling element/character reference ~doubles the rate** (fal $0.112→$0.224/s; official 8→16
   cr/s at 1080p) — Deliverable A's "element-reference doubling" is **verified**. Our anti-slop plan
   feeds our GLB reference frames, so budget the 2× on Kling for real runs.
5. **Resolution isn't free everywhere:** Seedance 2.0 Fast caps at 720p (1080p only on the Standard
   tier), and Runway Gen-4.5 is ~720p native (1080p via upscale). Only Kling and Veo give true
   silent 1080p in one shot.
6. **WaveSpeed Gen-4 Turbo at $0.01/s** is image-to-video only and 5× below Runway direct — treat
   as a loss-leader/typo, don't budget on it (L confidence).

## Corrections to Deliverable A's fal figures (verified against fal's live pages, 30 Jul)

- **Kling $0.112/s silent, ~$0.224/s with element refs — CONFIRMED exact** (fal Kling v3 Pro page).
  Standard tier is $0.084/s silent; audio-on $0.168/s; audio+voice $0.196/s.
- **Seedance "720p cap on fal" is now STALE — fal offers Seedance 1080p**, but at **$0.682/s**
  (token-priced, $14/M). The doc's "$0.302 std / $0.242 fast" are the **720p** rates (fal lists
  $0.3034 / $0.2419) and remain roughly right *for 720p only*. **The 1080p rate is the one to
  budget, and it is ~2× the cheapest alternative.** Seedance audio is bundled (no discount), so the
  doc's "audio always included" holds.
- **Seedance R2V-with-video ~$0.18/s (×0.6)** — the with-video-input discount is **real** (ByteDance
  direct charges $4.7/M vs $7.7/M at 1080p, ×0.61); on fal the multiplier lands the 1080p with-video
  rate near ~$0.42/s, not $0.18/s. Confirm the exact fal multiplier at call time.
- **Veo $0.20/s silent, Fast $0.10/s — CONFIRMED**; add a **Lite tier at $0.05/s silent 1080p**
  ($0.03/s at 720p) if quality allows, and the Gemini-API-bundles-audio gotcha above.
- **Runway "not on fal" — still TRUE** (Gen-4.x is Runway-direct/Apiframe only). New since the doc:
  Runway's *own* API now also hosts Seedance 2.0 and Veo 3.1 (but still not Kling).

## Confidence & sources

- **High** (read from the platform's own page): all fal rates (fal.ai model pages); Runway direct
  credit table (docs.dev.runwayml.com/guides/pricing); Veo Gemini-API rates (ai.google.dev); ByteDance
  ModelArk Seedance token rates (byteplus.com/en/product/modelark); WaveSpeed model pages.
- **Medium**: Vertex AI video-only (silent) Veo rows (secondary capture 22 Jul, consistent with fal's
  audio-off rates); Ofox/Segmind Seedance $0.34/s (vendor pages via comparison blogs); Kuaishou
  official Kling per-second (login-gated page; several third-party summaries converge ~$0.10–0.112/s);
  Higgsfield one-pool ~$0.10/s (single source).
- **Low / flagged**: Replicate's *exact* Kling and Seedance 2.0 per-second (listed but "not
  normalized" — the ~1.5–2× Kling figure is from reAPI, not read from Replicate directly); reseller
  rates (reAPI/EvoLink/AIReiter/PiAPI); WaveSpeed Gen-4 Turbo $0.01/s (implausibly low).
- **Could not verify:** whether the Kuaishou API and web UI truly share one credit pool (sources
  conflict); exact live Replicate 2.0 numbers; whether Volcano Engine (China) needs Chinese
  credentials vs BytePlus ModelArk (international) for Seedance direct.
- **Prices move weekly.** Re-verify the two or three models/platforms that survive the bake-off
  before the owner commits spend.

---

# Runway send-package (reference-anchored, ready to paste/upload)

**This is the package the owner pastes/uploads into the Runway Max web UI.** It is
reference-anchored: each shot ships with a PNG **rendered from our own production GLBs** so the
video model matches the game's exact art style, palette and staging instead of inventing a
generic dockside. Produced on branch `workflow/harbour-refs`.

**What changed since the shot list above:** the harbour is **not** prompt-only. Ships, masts and
the whole wharf kit exist in the current tree (`apps/web/public/world/props/`) and were composed
into the reference frames below, so **Shot 1 is now reference-anchored, not prompt-driven** (owner's
memory of "the first full Boston world had the entire harbor rendered" was correct — the assets
survive on `main`; only the deleted redesign's *composed scene* is gone, and it was rebuilt here
from the same GLBs per `World-Design-Bible.md` §"THE WHARF" + §7). See the asset verdict at the end.

## Reference images — render these from our GLBs, upload to Runway

Rendered by `assets/pipeline/shot_harbour_refs.mjs` (a self-served Playwright + Three harness — no
dev server, no port; adapts the `shot_rig_clipsheet.mjs` architecture). 16:9, 2560×1440.
Re-run with `node assets/pipeline/shot_harbour_refs.mjs` (or `SHOT=shot1 …`).

| Shot | Upload this file | What the frame anchors (from our GLBs) | What stays prompt-driven |
|---|---|---|---|
| 1 (wide) | `assets/reference/harbour-cutscene/shot1.png` | Wharf apron/pier, warehouses, **moored square-rigged ships + forest of masts** (`ship-brig-hero`, `ship-snow-background`, `ship-sloop`, `rowboat`), crane, crates/barrels/rope/fish-flakes, water + overcast palette | The **two Royal Navy warships (broadside, gunports)** across the harbour mouth — we have merchant hulls, no man-of-war asset; the model adds them, in our style |
| 2 (mid) | `assets/reference/harbour-cutscene/shot2.png` | **Our character style** — `dockhand-rigged` (×2), `townsman-rigged`, `goodwife-rigged` in period working dress, idle on the planks; barrels, rope coil; moored brig + masts behind | The specific props-in-hand (an *uncast net*); a porter *seated on a capstan* (rigs have `sitIdle`/`sitTalk` but no capstan-height seat was staged — they stand idle) |
| 3 (close) | `assets/reference/harbour-cutscene/shot3.png` | **The dockworker rig head-and-shoulders** — `dockhand-rigged`: weathered face, stubble, off-white linen shirt, brown wool waistcoat, faded red neck kerchief; anchored ship soft in the fog behind | The **knit cap** (rig is bare-headed); the eyeline-to-water and mouth motion |

Confidence: Shots 1–3 dockside/character look = **reference-anchored (high)**. Warship gunport
detailing, handheld net, knit cap, seated pose = **prompt-driven (flagged)** — we do **not** have
those assets; the prompt asks the model to add them in our style. Do not imply we have warships.

## Shared style prefix (already folded into each shot prompt below)

```
Stylized 3D rendered cinematic, real-time game-engine look: clean 3D character and vessel models,
PBR materials, soft global illumination, gentle volumetric harbour haze. NOT photoreal, NOT
live-action, NOT a documentary, no hyperreal skin. Match the art style, materials, muted colour
palette and staging of the uploaded reference image exactly — it is a frame rendered from our
actual game. Setting: the waterfront of colonial Boston, June 1774; overcast flat grey daylight,
muted maritime palette, grey-green water; accurate 18th-century detail (period ships, rigging,
dockside gear, dress).
```

---

### Shot 1 — WIDE: the port shut (~5–6 s)

**Upload:** `assets/reference/harbour-cutscene/shot1.png` — mode **Image → Video**, as the
**first/start frame** (the push-in begins from our composed harbour frame).

**Prompt (paste whole):**

```
Stylized 3D rendered cinematic, real-time game-engine look: clean 3D character and vessel models,
PBR materials, soft global illumination, gentle volumetric harbour haze. NOT photoreal, NOT
live-action, NOT a documentary, no hyperreal skin. Match the art style, materials, muted colour
palette and staging of the uploaded reference image exactly — it is a frame rendered from our
actual game. Setting: the waterfront of colonial Boston, June 1774; overcast flat grey daylight,
muted maritime palette, grey-green water.
Wide high-angle establishing shot looking down a long wooden wharf into a shut harbour: a dense
forest of tall bare ship masts, sails furled and gasketed on the yards; moored square-rigged
merchant vessels lying motionless; an idle timber crane, empty handcarts, stacked crates and
barrels left unmoved on the plank apron; a timber warehouse along the wharf. Across the harbour
mouth in the far water, two Royal Navy warships lie at anchor broadside-on, gunports visible,
blockading. Nothing works — no loading, no crew, no one moving; a couple of gulls drift. The
camera slowly dollies forward, a gentle push-in toward the dead wharf; only the water, a gull and
faint rigging sway move.
Must NOT appear: on-screen text, signage, lettering, captions, numbers, logos, watermarks; any
modern object; bright saturated colour; cartoon or anime styling; photoreal skin.
```

**Runway settings:** Image→Video · **Gen-4.5** for drafts (relaxed/unlimited on Max) · **16:9**,
1080p · **duration 5 s** (try 10 s for a slower push) · **audio OFF** (we dub) · lock a **seed**
once the look is right (reuse it for 2 and 3) · camera control: slow **push-in**.

**VO (post-dub — NOT sent to Runway), IRIS over Shot 1:**
> "June, 1774. For the tea thrown into this harbour, Parliament closed the whole of it — every
> wharf, every ship — until Boston paid for what a few men had done."

---

### Shot 2 — MID: the people it idled (~5–6 s)

**Upload:** `assets/reference/harbour-cutscene/shot2.png` — mode **Image → Video**, first/start
frame (the track begins from our line of idled workers).

**Prompt (paste whole):**

```
Stylized 3D rendered cinematic, real-time game-engine look: clean 3D character and vessel models,
PBR materials, soft global illumination, gentle volumetric harbour haze. NOT photoreal, NOT
live-action, NOT a documentary, no hyperreal skin. Match the art style, materials, muted colour
palette and staging of the uploaded reference image exactly — it is a frame rendered from our
actual game. Setting: the waterfront of colonial Boston, June 1774; overcast flat grey daylight,
muted maritime palette, grey-green water.
Eye-level shot on the wharf planks: a short line of idle 18th-century working people standing
still — a fisherman holding an uncast net, a porter, a cooper beside a stack of his own barrels,
and a woman — in plain 1774 working dress (linen shirts, wool waistcoats, leather aprons, buckled
shoes, knit and cocked caps). Faces worried, weary, banked anger; no one is working because there
is no work. Behind them a moored square-rigged ship and a forest of bare masts over grey water —
the shut port. The camera tracks slowly along the line of idled workers (or holds a slow
over-the-shoulder past them toward the anchored ships). Characters shift their weight and move
their mouths as if murmuring; audio not needed.
Must NOT appear: on-screen text, signage, lettering, captions, numbers, logos, watermarks; any
modern object; bright saturated colour; cartoon or anime styling; photoreal skin.
```

**Runway settings:** Image→Video · **Gen-4.5** · **16:9**, 1080p · **duration 5 s** · **audio OFF**
· same locked **seed** · camera control: slow lateral **track** (or over-the-shoulder).

**VO (post-dub), IRIS over the cut into Shot 2:**
> "The order did not stop to ask who was guilty."

---

### Shot 3 — CLOSE: one ruined man (~5 s, hold a beat longer for the dubbed line)

**Upload:** `assets/reference/harbour-cutscene/shot3.png` — mode **Image → Video**, first/start
frame (the rack focus begins from our dockworker head-and-shoulders).

**Prompt (paste whole):**

```
Stylized 3D rendered cinematic, real-time game-engine look: clean 3D character and vessel models,
PBR materials, soft global illumination, gentle volumetric harbour haze. NOT photoreal, NOT
live-action, NOT a documentary, no hyperreal skin. Match the art style, materials, muted colour
palette and staging of the uploaded reference image exactly — it is a frame rendered from our
actual game. Setting: the waterfront of colonial Boston, June 1774; overcast flat grey daylight,
muted maritime palette, grey-green water.
Tight close-up on a weathered male dockworker in his forties — stubble, tired eyes, off-white
linen shirt, brown wool waistcoat, faded red neck kerchief, a knit cap — looking out over the
water and speaking quietly, mouth moving mid-sentence. Shallow depth of field; behind him, soft
focus, an anchored square-rigged Royal Navy warship and its rigging. A slow rack focus shifts
sharpness from his face to the ship and back; otherwise a locked, minimal close-up. Audio not
needed — mouth movement only.
Must NOT appear: on-screen text, signage, lettering, captions, numbers, logos, watermarks; any
modern object; bright saturated colour; cartoon or anime styling; photoreal skin.
```

**Runway settings:** Image→Video · **Gen-4.5** · **16:9**, 1080p · **duration 5 s** · **audio OFF**
· same locked **seed** · camera control: minimal move + **rack focus**.

**VO (post-dub), DOCKWORKER over Shot 3 (diegetic, plain, bitter):**
> "I never laid a hand on their tea. Fifteen year I've hauled on this wharf. Now there's not a
> ship to unload, and the King's shut the water on every soul in Boston — the honest man with the
> guilty."

---

## Step-by-step in Runway Max

1. **New generation → Image to Video** (Gen-4.5).
2. **Upload the reference image** for the shot (Shot 1 → `shot1.png`, Shot 2 → `shot2.png`,
   Shot 3 → `shot3.png`) as the **first / init frame**.
3. **Paste the shot's full prompt** into the prompt box (the blocks above already include the
   style prefix and the "must not appear" clause).
4. **Settings:** 16:9 · 1080p · duration 5 s (Shot 1 may go 10 s for a slower push) · **audio OFF**
   · set the camera move (push-in / track / rack focus) · **lock a seed** after the first good take
   and reuse it across all three so the palette and characters carry between cuts.
5. **Generate the 3 shots**, one per reference image; regenerate freely (relaxed is unlimited on
   Max) and accept one take each — human review is the real anti-slop gate.
6. **Download the three MP4s and hand them back.** The orchestrator stitches them with `ffmpeg`
   to ~15–17 s (cut on motion settling; hold Shot 3 a beat longer for the dubbed line), then drops
   the result into the `ModuleVideo` slot (one line in File 1's scene). TTS voice + ambient +
   subtitles are added in post; the clip is generated **silent**.

## Bake-off first (Shot 1: Kling vs Seedance, inside Runway's bundled models)

Before committing the look, generate **Shot 1 three ways from the same `shot1.png` + prompt**:
**Gen-4.5**, **Kling 3.0**, and **Seedance 2.0** (all bundled in the Runway dashboard), audio off.
Judge **by eye against the game** which best preserves our stylized GLB palette and staging with the
least drift — the one thing no spec sheet can settle (Deliverable A). Kling wins on 1080p /
multi-shot-in-one-call / cost; Seedance is the stylization leader and may hold our look better.
Whichever holds the house style with least drift wins the lesson; use it for Shots 2–3.

## Two gates before it ships (unchanged, from Deliverable B)

- **Historical QA** by eye: mid-1770s ship rig (not Napoleonic), 1774 working dress, wharf
  construction, and — the prompt-driven layer — that any warships read as period men-of-war with no
  anachronisms or stray modern shapes.
- **Provenance:** the finished clip is a **`PROJECT_RECONSTRUCTION`** and must be classified as one;
  the primary source for File 1 stays the Committee-of-Correspondence circular still, not the clip.

---

# Appendix — harbour/ship asset verdict (investigated on `workflow/harbour-refs`)

**Verdict: the harbour and ships EXIST NOW in the working tree — nothing needs recovering.** The
owner's memory is correct. Shot 1 is reference-anchored, not prompt-driven (except the warship
gunport layer, flagged above).

**Present now** in `apps/web/public/world/` (confirmed on `main` @ `440677c`):
- **Ships / masts:** `props/ship-brig-hero.glb` (hero two-masted brig, **furled sails**, ~26 m
  hull), `props/ship-snow-background.glb` (anchored square-rigger, furled sails), `props/ship-sloop.glb`
  (single-masted sloop, furled), `props/rowboat.glb`, `props/buoy.glb`.
- **Wharf kit:** `colonial-wharf-apron`, `colonial-wharf-boardwalk`, `wharf-pier-module`,
  `wharf-boardwalk-plank`, `colonial-wharf-pier-finger`, `wharf-rope-rail-{straight,corner,end}`,
  `bldg-warehouse-wharf-a`/`-b`, `timber-crane`, `bollard`, `rope-coil-large`, `cargo-net-bundle`,
  `crate-mound`, `crate-stack`, `barrel-group`, `fish-flakes-rack`, `ropewalk-laying-rig` (all
  `props/*.glb`).
- **Dockside cast:** `characters/dockhand-rigged.glb` (the fisherman/porter/close dockworker),
  plus `goodwife-`, `townsman-`, `townswoman-`, `agitator-`, `towncrier-rigged.glb`.
- **Layout/scale of record:** `World-Design-Bible.md` §"THE WHARF" (Town Wharf x −160..−118, water
  to south/west at y≈−1.1, hero brig + anchored snow + sloop + rowboats, warehouses on the north
  side) and §7 "Water & ships." Meshy normalizes GLBs to ~1.9 m; real size is applied at placement
  (`assets/pipeline/write_wharf_manifest.mjs` notes: brig scale ~26 m).

**Recoverable-from-history (not needed):** the *composed* "full Boston world" the owner remembers
was the redesign tracked at commit **`9f9a4d0`** ("track the redesigned game and its world assets",
2026-07-26), whose world/engine lived in the since-deleted `packages/chapter-boston-world` +
`engine-world` `RunnerMap.tsx`. That composed **scene** was removed in cleanup (the `qa_*` scripts
importing `chapter-boston(-world)` were deleted on `m1-prune` `232d25c`), but **every harbour ASSET
above survives on `main`** — so this task rebuilt the scene from the live GLBs rather than
recovering the old package. If a ready-made composed harbour is ever wanted, `git show 9f9a4d0`
and the `engine-world` world files are the recovery point.

**Genuinely absent:** a Royal-Navy **warship with visible gunports** (our three hulls are merchant
brig/snow/sloop); a **handheld fishing net** prop; a **knit cap** on the dockhand rig; a
capstan-height **seat** for a seated pose. These four are the prompt-driven layer in the package
above and are called out as such.
