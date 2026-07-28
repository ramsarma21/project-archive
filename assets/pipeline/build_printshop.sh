#!/usr/bin/env bash
# The printshop (Edes & Gill), re-authored — no Meshy raw.
#
# The shipped generation was 1189 near-coincident face pairs (the torn/doubled-
# facade signature the weld gate blocks on), on a half-resolution atlas, the same
# defect class as the elm, the row facades and bldg-brick. build_civic_facade.py
# authors it from its collision hull: a brick box with recessed Georgian sash and
# a leaded flat roof — the leads the run opens on. The drying rack and the sign
# hood are SEPARATE assets (printer-drying-rack, printshop-sign-hood) and are not
# touched, so the 6.20m catch off the eaves keeps its relationship to this roof.
set -euo pipefail
cd "$(dirname "$0")/../.."

KEY=bldg-printshop
BLENDER=${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}
HULL=assets/source/collision/$KEY.hull.json

echo "== hull, from GEOMETRY"
node --import tsx assets/pipeline/export_m1_building_hull.mjs "$KEY"

echo "== author (brick box + recessed sash + leaded roof, from the hull)"
"$BLENDER" --background --python assets/pipeline/build_civic_facade.py -- \
  "$HULL" "apps/web/public/world/props/$KEY.glb" | grep "^\[$KEY\]"
echo "== published apps/web/public/world/props/$KEY.glb"

echo "== gates"
node --import tsx scripts/check-world-visual-sweep.mjs --weld-gate | grep -iE "printshop|WELD GATE:"
node --import tsx scripts/check-world-collision.mjs | grep -iE "PRINTSHOP|world-collision:"
