#!/bin/bash
# Turn a playtest recording into readable frames.
#
#   extract.sh <url-or-path> [label] [interval-seconds]
#
# Writes to .affordwork/clips/<label>/ (gitignored):
#   info.txt        duration, fps, resolution
#   t<secs>.jpg     one frame every <interval> seconds, named by timestamp
#   scene-NN.jpg    frames at detected scene changes (cuts, teleports, deaths)
#
# The timestamp in the filename is the whole point: it is how a frame maps back to
# what the owner said at that moment in the clip.

set -uo pipefail

SRC="${1:?usage: extract.sh <url-or-path> [label] [interval]}"
LABEL="${2:-clip}"
INTERVAL="${3:-3}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
OUT="$ROOT/.affordwork/clips/$LABEL"
mkdir -p "$OUT"

VID="$OUT/source.mp4"

if [[ "$SRC" =~ ^https?:// ]]; then
  echo "downloading…"
  # -N 4 for speed; recode only if the container is something ffmpeg dislikes.
  yt-dlp -q --no-warnings -N 4 -o "$VID" "$SRC" || {
    echo "DOWNLOAD FAILED. Common causes: the link needs a login (Loom/Drive private"
    echo "links usually do), or it is a page rather than a media URL. Ask the owner to"
    echo "share the file directly, or drop the recording somewhere readable and re-run."
    exit 2
  }
else
  [[ -f "$SRC" ]] || { echo "no such file: $SRC"; exit 2; }
  VID="$SRC"
fi

ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate \
  -of default=noprint_wrappers=1 "$VID" > "$OUT/info.txt" 2>&1
echo "--- $OUT/info.txt ---"; cat "$OUT/info.txt"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VID" | cut -d. -f1)
echo "duration ${DUR}s; sampling every ${INTERVAL}s"

# Interval frames, named by their own timestamp so a frame is self-locating.
i=0
while [[ $i -lt ${DUR:-0} ]]; do
  ffmpeg -nostdin -v error -ss "$i" -i "$VID" -frames:v 1 -q:v 3 "$OUT/t$(printf '%04d' "$i").jpg" -y
  i=$(( i + INTERVAL ))
done

# Scene changes: where the picture jumps. Catches cuts, teleports, deaths, a
# cutscene starting - the moments most likely to be what the owner is pointing at.
ffmpeg -nostdin -v error -i "$VID" \
  -vf "select='gt(scene,0.4)',showinfo" -vsync vfr -q:v 3 \
  "$OUT/scene-%02d.jpg" -y 2>/dev/null || true

echo
echo "frames:  $(ls "$OUT"/t*.jpg 2>/dev/null | wc -l | tr -d ' ') interval, $(ls "$OUT"/scene-*.jpg 2>/dev/null | wc -l | tr -d ' ') scene-change"
echo "in:      $OUT"
echo
echo "Read the interval frames first to follow the run, then the scene-change frames"
echo "for the moments something jumped. Crop into anything suspicious rather than"
echo "judging a wide frame."
