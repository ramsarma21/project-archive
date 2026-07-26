#!/usr/bin/env bash
# Every M1 building whose authored roof deck is flat and whose art was pitched.
#
# `structure()` tops each building with a level deck at the wall head and the
# whole roof route was tuned standing on those decks; the generated meshes were
# pitched houses, so the collision plane floated over the art and the player ran
# on air. `build_m1_flat_deck.py` replaces the geometry above the eaves with a
# lead flat at the exact deck plane. Read that file's header for why the roof has
# to be flat edge to edge rather than a captain's walk, and why nothing may stand
# above the leadwork.
#
# The hull is regenerated from GEOMETRY on every run and never hand-edited, so if
# the level moves a roof the mesh is rebuilt against the new height.
#
# --eaves is per building and is a MEASUREMENT of its own mesh, taken off the
# plan-extent profile. It is passed explicitly rather than auto-detected because
# two of these are gambrels, whose plan narrows in two stages: the detector's own
# threshold picks the first stage on `bldg-row-clapboard-b` and the second on
# `bldg-row-shop`, and one of those answers is a roof cut in half.
#
# Usage:  bash assets/pipeline/build_m1_flat_decks.sh [key ...]
set -euo pipefail
cd "$(dirname "$0")/../.."

BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
OUT=assets/build/world-m1-roof-opt
# The pitched originals, kept out of the served tree on purpose. Reading the
# source from apps/web/public — which is where these came from — makes the build
# eat its own output: a second run cuts the eaves off a building that no longer
# has a pitch, and the printing office came back tiled two by two on a mesh that
# was already the whole block.
SRC=assets/source/raw/m1-buildings
mkdir -p "$OUT"

# key : source glb : blender options
#
# keepbbox 1 on every ROW mesh, and it is load-bearing: MODULE_RUNS in runtime.ts
# carries each one's measured `naturalM` and rowPlacements divides a block by it
# to decide how many houses cover the frontage, so a mesh that came back a
# fraction shorter would silently re-tile six blocks of Boston.
#
# bldg-printshop is the exception on both counts. It is a PROP contain-fit rather
# than a tiled row, so its mesh's ASPECT is what decides how much of its 13 x 14m
# block gets drawn — at 1.63 x 1.90 it covered 6.6 x 7.7m of it — and no scale
# fixes an aspect. Two by two copies of the office land within 9% of the block's
# shape, and the mesh then ships at exactly the declared 13 x 7.1 x 14 so the
# contain-fit is 1.0000.
BUILDS=(
  "bldg-row-brick-b|bldg-row-brick-b.glb|--eaves 0.65 --keepbbox 1 --tris 18000"
  "bldg-row-clapboard-a|bldg-row-clapboard-a.glb|--eaves 0.60 --keepbbox 1 --tris 18000"
  "bldg-row-clapboard-b|bldg-row-clapboard-b.glb|--eaves 0.78 --keepbbox 1 --tris 18000"
  "bldg-row-shop|bldg-row-shop.glb|--eaves 0.58 --keepbbox 1 --tris 18000"
  "bldg-brick|bldg-brick.glb|--eaves 0.84 --keepbbox 1 --tris 18000"
  # The printing office, built out of the street warehouse's body rather than out
  # of `bldg-printshop.glb`, and the swap is a measurement rather than a taste.
  #
  # The level authored a 13 x 7.1 x 14m building; the generated printshop is a
  # 2.1m-walled cottage under a roof that is 70% of its height. Fitted, it drew a
  # cottage at twice life size across half the block, and any wall stretch that
  # reaches a 6.68m parapet from 2.1m of wall is a three-times-life-size door. The
  # warehouse body is the right SHAPE for this box: 1.09 : 2.09 : 1 against the
  # 1.83 : 1.97 : 1 the block asks for, so two bays of it land within 8% of the
  # plot on both plan axes and its own wall reaches the parapet on a 1.44 stretch.
  # It is also the right building — a boarded commercial front with loading doors
  # on Queen Street — and the printer's own dressing, the drying rack and the
  # hanging sign, are separate props that sit on top of it either way.
  #
  # `bldg-printshop.glb` is kept in the raw folder rather than deleted, because the
  # thing this asset actually wants is a generated printing office at the block's
  # own aspect, and whoever builds it will want to see what was there before.
  "bldg-printshop|bldg-warehouse-street.glb|--tilex 2 --tilez 1 --eaves 0.47 --keepbbox 0 --tris 26000"
  # The sugar house, the other way round: a 7 x 12.4 x 14m box is tall and narrow
  # and the warehouse body is low and wide, so it cannot fill its own key's box
  # either — two ranks of the tall brick row land within 16% of it on both axes.
  # Its roof is not route-bearing, so this one is silhouette rather than footing:
  # the market's high line dies against this wall and the player looks at it for
  # twenty seconds from the canopies.
  "bldg-warehouse-street|bldg-row-brick-b.glb|--tilex 1 --tilez 2 --eaves 0.65 --keepbbox 0 --tris 22000"
  # The Hollis Street body, out of the church mesh's bottom third. Its top 70% is
  # a steeple and M1 draws that steeple as a separate climbable asset, so
  # carrying it here would put two spires on one meeting house. --yaw90 because
  # the source body is deeper than it is wide and this block is the other way
  # round: turned, the fit is 0.77 / 0.88 against the height instead of
  # 1.23 / 0.55.
  "bldg-meeting-hollis|church-meetinghouse.glb|--cut 0.30 --yaw90 1 --keepbbox 0 --tris 20000"
)

WANTED=("$@")
for entry in "${BUILDS[@]}"; do
  IFS='|' read -r key source options <<< "$entry"
  if [ ${#WANTED[@]} -gt 0 ] && ! printf '%s\n' "${WANTED[@]}" | grep -qx "$key"; then
    continue
  fi
  echo "== $key: hull, from GEOMETRY"
  node --import tsx assets/pipeline/export_m1_building_hull.mjs "$key" >/dev/null

  echo "== $key: build"
  # shellcheck disable=SC2086
  "$BLENDER" --background --python assets/pipeline/build_m1_flat_deck.py -- \
    "$SRC/$source" \
    "assets/source/collision/$key.hull.json" \
    "$OUT/$key.glb" $options | grep "^\[$key\]"

  # Copied rather than synced. sync_web.mjs promotes everything it finds under a
  # mapped directory, and it published a work-in-progress rig that way once.
  cp "$OUT/$key.glb" "apps/web/public/world/props/$key.glb"
  echo "== $key: published apps/web/public/world/props/$key.glb ($(du -h "$OUT/$key.glb" | cut -f1))"
done

echo "== probe"
node --import tsx assets/pipeline/verify_m1_placements.mjs 2>/dev/null | tail -5 || true
