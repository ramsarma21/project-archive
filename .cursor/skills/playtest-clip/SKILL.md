---
name: playtest-clip
description: Turn a playtest video into a routed defect list. Use when the owner pastes a link to a runthrough recording, attaches a screen capture of play, or says to watch a clip and fix what is wrong in it.
---

# Playtest Clip

The owner records himself playing and narrates what is wrong. This turns that into
frames, then into defects mapped to acceptance conditions and dispatched to lanes.

**Every visible defect this project has fixed was found by him playing, not by an
instrument.** A clip is the highest-signal input there is; treat it accordingly.

## 1. Extract

```bash
.cursor/skills/playtest-clip/scripts/extract.sh <url-or-path> <label> [interval-seconds]
```

Writes to `.affordwork/clips/<label>/` (gitignored): `info.txt`, `t0000.jpg`-style
interval frames named by their own timestamp, and `scene-NN.jpg` at scene changes.

Default interval is 3 s. Use 1–2 s for a short clip about one moment, 5 s for a full
run. Frame filenames are timestamps — that is how a frame maps to what he said at that
point in the clip.

**A private Loom or Drive link will fail to download.** Say so and ask for the file
rather than guessing at what the video showed.

## 2. Read

Read the interval frames in order to follow the run, then the scene-change frames —
cuts, teleports, deaths and cutscene starts are usually what he is pointing at.

**Crop into anything suspicious. Do not judge a wide frame.** Nine ladders were merged
as "flush to the face" on captures too dark and cramped to read, and the owner
disproved it with one frame. If a frame is too dark to be sure, say so rather than
guessing — an illegible frame is a failed check, not a caption.

**There is no local transcription.** If he narrated in audio, the words are not
available; work from his typed message and the frames. Ask for the key points in text
rather than inventing them.

## 3. Locate

Frames carry a HUD with an objective, a distance and a section, and the mission is one
guided west-east line — so a frame usually says where it is. Sections run
`A_LEADS` (printshop) → `B` (market/shambles) → `C_ASCENT` (Town House) →
`D`/`D2` (roofs, ropewalk) → `E_LEAP` (Hollis meeting, steeple) → `F_TREE` (Liberty
Elm) → the rope-walk yard and the duel.

## 4. Route

Before writing any brief:

- Read `docs/process/M1-DONE.md` — the acceptance conditions. A defect he reports is
  usually an unmet or partly-met line, not a new one. Say which.
- Read `docs/process/M1-STATUS.md` — what is already fixed, and the **disproven** list.
  Do not re-open a hypothesis that has been measured and refuted.
- Read `docs/process/LANES.md` — who owns the files. A `preToolUse` hook refuses
  out-of-lane writes, so a brief that ignores ownership wastes a lane.

Then dispatch one worker per coherent defect, with the frame path in the brief so it
can see what he saw.

## Report format

```markdown
## What the clip shows
[timestamp] — [what is visibly wrong], frame `.affordwork/clips/<label>/tNNNN.jpg`

## Already known
[defect] — matches M1-DONE §N, in flight / fixed in <commit> / disproven because …

## New
[defect] — no condition covers this; added to M1-DONE as …

## Dispatched
[lane] — [what it was asked to fix]
```

Lead with what is wrong, not with the process. If the clip shows something already
fixed on `main` but not in his build, say that — it is a stale-build answer, not a bug.

## What not to do

- Do not infer a cause and put it in a brief as fact. Give the symptom, the frame, and
  candidates to distinguish. Asserting untraced mechanisms produced three wrong
  diagnoses in one afternoon here; offering candidates produced a worker who found the
  real one.
- Do not fix a list of plausible-sounding defects he did not report. Several "clunky"
  candidates turned out to be already handled, and a worker checking beat a worker
  fixing.
