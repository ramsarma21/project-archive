# @pa/beat — the precision beat

The osu-side of "Metal Gear Solid V plus osu": a short burst of timed input at a
fixed spot, **inside a live stealth field**, where imprecision is paid for in
attention rather than in points.

Headless. No React, no three, no rendering. Runs under `node --test`, in a replay
harness, and in the browser. The fixed-step clock, the seeded kernel and the
noise model all belong to `@pa/engine-world` and are consumed through
`src/engine.ts`.

## The one idea

A rhythm minigame that subtracts points for a missed beat could be lifted out of
this game and dropped into any other one. What makes this beat belong to a
stealth mission is that **a mistimed stroke is loud**, and loud is something the
world already knows how to react to.

Every judgement emits an ordinary `PLAYER_MOVE` `NoiseEvent` — the same kind a
hard landing emits — at the work. The stealth field needed no changes at all:

- `noiseImplicatesPlayer` is true for that kind, so the noise raises the hearer's
  suspicion and points his attention **at** the player's stance. It is the exact
  opposite of a thrown bottle.
- `noiseSuspicionCeiling` caps what noise alone can build, so a botched beat can
  never complete a detection by itself. It brings a watcher over and turns his
  cone onto the tree; his eyes do the rest.
- Loudness scales continuously with error, so getting slightly better is worth
  something on every attempt rather than only at a threshold.

A centred stroke is quieter than the field's own audibility floor — it is
**provably inaudible to every watcher in the game, at any distance**. That is the
reward for the ceiling, and `assertFlushIsInaudible` refuses to let the package
load if a later edit breaks it.

## Timing, in ticks

Nothing here is in milliseconds. Every window, gap and duration is an integer
count of `FIELD_TICK_HZ` steps.

| Judgement  | Half-window | ≈       | Quality | Loudness | Carries |
| ---------- | ----------- | ------- | ------- | -------- | ------- |
| `FLUSH`    | 2 ticks     | ±33 ms  | 1.00    | 0.04     | silent  |
| `TRUE`     | 5 ticks     | ±83 ms  | 0.80    | 0.12     | 1.7 m   |
| `GLANCING` | 9 ticks     | ±150 ms | 0.50    | 0.30     | 4.2 m   |
| `SLIP`     | —           | expired | 0.00    | 0.45     | 6.3 m   |
| `STRAY`    | —           | no beat | penalty | 0.62     | 8.7 m   |

`GLANCING` is the floor: wide enough that a thirteen-year-old on a school
Chromebook connects with every stroke first time. `FLUSH` is the ceiling and it
is deliberately brutal, which is only fair because rhythm precision is
*anticipatory* rather than reactive and therefore has no human reaction floor
under it.

## The chart

`deriveChart(spec, seed)` is a pure function of the seed. An attempt replays, a
retry differs, and a **re-entry does not** — leaving the stance and coming back
re-derives the same chart from the same attempt seed, so a chart cannot be fished
for.

Charts are built on a 24-tick pulse grid (150 bpm, a hammering cadence) in bars
of four pulses, and each bar is filled by a **figure** whose intervals sum to
exactly one bar. The vocabulary is authored; the sentence is drawn. A player who
has heard one bar knows where the next downbeat is.

Two things follow from the bar, and both are load-bearing rather than tidy.

**A chart is exactly as long on every seed.** M1's is 336 ticks — 5.6 seconds —
whatever the draw. The pacing budget is therefore charged what the beat costs
rather than a tail it reaches once in four hundred attempts, and, more to the
point, the player can judge the patrol gap they are about to spend. A commitment
whose length is a dice roll cannot be a stealth decision.

**A chart has a difficulty curve.** Phases run in order and may not get sparser.
M1 runs three strokes to the bar, then four, then five — and five to the bar
cannot fit in the grid without two `DOUBLE`s, so the closing bar has teeth by
arithmetic rather than by authoring. No seed is a free pass, and no spike ever
lands in the bar that is still teaching. Two spikes are never adjacent, including
across a bar line.

## The read

The first stroke starts the chart and is not judged. That removes the tutorial:
the player swings when ready, one mark travels toward a fixed line, and they
swing again when it arrives. The authored opening gap has demonstrated the read
before anything with a window happens — and it is a full approach long, because
what the opening teaches is how fast a mark travels and a speed cannot be read
off a partial journey.

This package draws nothing. It publishes `approach01` per pending beat — 0 at
first visibility, exactly 1.0 on the beat's tick — plus the windows in that same
normalised space. A renderer turns that into **one convergence**. Two things
touching is a pre-verbal read; a shrinking ring or a sweeping needle is
iconography somebody has to be told the meaning of.

`preview` lays the whole chart out in space before the player commits, so the
doubles are visible in advance and "when do I start" is a real decision against a
patrol they can see. `downbeats` divides that layout into bars, because a dozen
marks in a row read as a queue and the same dozen in three groups read as a
rhythm that gets harder.

## Grades

`SILENT` › `CLEAN` › `RAGGED` › `TORN`. `SILENT` needs every judged stroke
centred and no swings at nothing, and by construction makes no sound the world
can hear. `TORN` is §4.11's terminal precision failure. One dropped stroke in
thirteen is `RAGGED` — the sheet goes up crooked and you were heard — because a
three-minute traversal must not be discarded by a single lapse.

## Mounting one

`BEAT_MOUNT_CONTRACT` in `src/mount.ts` lists, as data, everything the container
and the level must do. The load-bearing line is one array spread: the step's
`noise` goes into the array already handed to `stepStealthField` alongside the
parkour and thrown-object noise.

`beatObjective(...)` is shaped exactly like the container's `MissionObjective`,
so a level swaps its proximity predicate for "the work actually got done" without
this package importing the app.

## What the beat costs the clock

`beatWorstCaseTicks` is the chart's span plus the outer window the last stroke
may still be struck in plus the follow-through. For M1 that is **375 ticks —
6.25 seconds — for thirteen judged strokes**, and because the span is fixed it
is a price rather than a bound. The five-stroke chart it replaced reserved 3.65
seconds, so the beat asks the mission clock for 2.6 seconds more and returns
2.6× the timed input.

It does not include the time the player spends in stance deciding when to start.
That is traversal they are choosing to spend watching a patrol.

## One location is not enough, and that is not this package's to fix

Thirteen judged strokes is as much skill as a single encounter can hold, and a
single encounter is still one sample. What makes rhythm worth practising is
returning to the same skill at rising difficulty, which needs a second place in
the level. `M1_SECOND_BEAT_CHART` is the costed shape of one: a single bar behind
the same opening, five judged strokes for **3.05 seconds** — cheaper than the
beat this rework replaced, for the same five strokes.

One bar is also the floor. With the opening stroke unjudged, a three-stroke chart
offers two judged beats, and two is not enough to entrain to a pulse: the player
reads each mark cold, which is a reaction test, and reaction tests pay nothing
back to the anticipation the 33 ms window is built for. Several one- and
two-stroke beats scattered through a mission would add timed inputs without
adding a skill.

## Where M1's content belongs

`src/m1NailStance.ts` mirrors `PRECISION` in `@pa/mission-m1`. It lives here
because that package is owned by another workstream; `m1NailStanceBeat()` takes
its geometry as arguments so that when the level adopts it there is no second
source of truth.
