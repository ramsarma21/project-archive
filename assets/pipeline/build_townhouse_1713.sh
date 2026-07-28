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
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
HULL=assets/source/collision/$KEY.hull.json

# RE-AUTHORED, no Meshy raw. The shipped generation was 6721 near-coincident face
# pairs (the torn/doubled-facade signature the weld gate now blocks on) — the same
# defect the elm, the row facades and bldg-brick carried, and no weld/de-dup
# repair reaches it. build_civic_facade.py authors the whole Town House from this
# same hull: brick body with recessed sash, the two jettied galleries, the clock
# ledge, both cornices, the balcony hood, the plinth ring, the top lookout, and
# the tower blocker filled SOLID — which IS the cupola drum the old
# build_m1_civic + build_townhouse_drum pass produced to fix the 1.4m float, now
# reproduced in one continuous mesh (body -> drum -> lookout, no glued-on join).
# So neither the shared civic builder nor the separate drum step is called any
# more; build_townhouse_drum.py is kept only as the record of that first fix.

echo "== hull, from GEOMETRY"
node --import tsx assets/pipeline/export_m1_building_hull.mjs "$KEY"

echo "== author (body + galleries + cornices + solid drum + lookout, from the hull)"
"$BLENDER" --background --python assets/pipeline/build_civic_facade.py -- \
  "$HULL" assets/source/raw/townhouse-1713.final.glb | grep "^\[$KEY\]"

# Copied rather than synced. sync_web.mjs promotes everything it finds newer than
# public/, characters included, and it published a work-in-progress rig that way.
cp assets/source/raw/townhouse-1713.final.glb "apps/web/public/world/props/$KEY.glb"
echo "== published apps/web/public/world/props/$KEY.glb"

echo "== probe"
node --import tsx assets/pipeline/verify_m1_townhouse.mjs
node --import tsx scripts/check-world-visual-sweep.mjs --weld-gate | grep -iE "townhouse|WELD GATE:"
