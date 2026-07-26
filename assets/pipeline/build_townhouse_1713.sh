#!/usr/bin/env bash
# The Town House, from the raw Meshy generation to the shipped GLB.
#
# The hull is regenerated from GEOMETRY on every run and never hand-edited, so if
# the level moves a ledge the mesh moves with it. That is not a nicety on this
# asset: FittedGlb contain-fits the mesh into the box `sceneryPlacements()` asks
# for, so the drawn building is never larger than that box whatever the mesh is,
# and the mesh's own bounding box has to BE the box or every authored height comes
# down by the shortfall. The build pins it with corner studs for exactly that
# reason and the probe checks the scale is 1.0000.
#
# `--size` on the exporter and the probe is how to work against a proposed sizeM
# before assets.ts carries it: the declared 11 x 17.6 x 11 could not reach the
# north balcony at 5.6m or the clock ledge at 8.4m, both of which the route stands
# on, and both were built and probed against 14.6 x 17.6 x 16.2 a run ahead of the
# declaration moving. Keep it for the next time the two disagree.
#
# Usage:  bash assets/pipeline/build_townhouse_1713.sh [raw.glb]
set -euo pipefail
cd "$(dirname "$0")/../.."

KEY=bldg-townhouse-1713
RAW=${1:-assets/source/raw/townhouse-1713-g.glb}
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
# The plan collapses to the tower at 0.635 of the generated height, but that
# reading lands on the gambrel's upper slope: the band it defines is the ridge,
# 1.34 x 0.33, and fitted to a 4m square shaft the cupola comes out a metre wide
# with the ridge fanned either side of it. 0.76 is above the ridge, where the band
# really is the tower and is square in plan.
SPLIT=0.76
HULL=assets/source/collision/$KEY.hull.json

echo "== hull, from GEOMETRY"
node --import tsx assets/pipeline/export_m1_building_hull.mjs "$KEY"

echo "== build"
"$BLENDER" --background --python assets/pipeline/build_m1_civic.py -- \
  "$RAW" "$HULL" assets/source/raw/townhouse-1713.built.glb \
  --split $SPLIT --corbel 0.85 --tris 34000 --tex 2048 | grep "^\[$KEY\]"

# Copied rather than synced. sync_web.mjs promotes everything it finds newer than
# public/, characters included, and it published a work-in-progress rig that way.
cp assets/source/raw/townhouse-1713.built.glb "apps/web/public/world/props/$KEY.glb"
echo "== published apps/web/public/world/props/$KEY.glb"

echo "== probe"
node --import tsx assets/pipeline/verify_m1_townhouse.mjs
