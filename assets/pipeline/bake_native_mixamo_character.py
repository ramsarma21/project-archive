# Combine a Mixamo auto-rigged character-with-skin source with the user's native
# Mixamo motion-only FBXs. Skeleton and actions are canonical Mixamo, so no
# retargeting or rotation conversion is performed.
#
# The input may be the original skinned FBX or an already-baked GLB. The GLB path
# exists because the player's skinned FBX is not in the repo (assets/source/
# characters/ is gitignored and only holds abigail.glb), so the shipped
# playerboy-v6-native.glb is the only remaining source of that mesh. A GLB import
# restores bone names as "mixamorig:*" at the same 0.01 armature scale as an FBX
# import, so the direct action copy below is still exact — verified with
# probe_rig_space.py (33/33 bone-name overlap).
#
# Usage:
#   blender --background --python bake_native_mixamo_character.py -- in.fbx|in.glb out.glb
import bpy
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :]
INPUT = os.path.abspath(argv[0])
OUTPUT = os.path.abspath(argv[1])
# Role selects the clip set. "npc" is the legacy dialogue-cast subset and is kept
# only so old rebake commands still reproduce; new work uses boss/patrol/civilian.
ROLE = argv[2] if len(argv) > 2 else "player"
NPC_MODE = ROLE == "npc"
MATERIAL_SOURCE = os.path.abspath(argv[3]) if len(argv) > 3 else None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIMS = os.path.join(ROOT, "source", "mixamo")

# The player's production clip set for the new game: continuous parkour, stealth,
# the handbill precision beat, and the flintlock duel.
#
# The 23 dialogue-game performances this list used to carry (talk/talk2/talk3/
# talk4, argu1, argue2, cheer1, cheer2, work1, work2, search, carry, carryWalk,
# handoff, circleWalk1, circleWalk2, scolded, ropePull, read, doorOpenInward,
# doorOpenOutward) are deliberately gone: they only served scenes that are being
# deleted, several ran 10-21s, and the rig they bloat is resident for the whole
# game. leftTurn/rightTurn/crouchLeft/crouchRight go with them — nothing in the
# surviving movement code selects them (freeLocomotionClip and parkour/flow.ts
# return only idle/walk/run), and the two crouch strafes additionally carried
# ~1.3m of un-frozen root translation.
#
# knock and reach are kept out of that cull on purpose: knock is a raised-fist
# striking motion and reach is a placement, which together are the handbill-on-
# post beat.
CLIPS = [
    # Locomotion and parkour. The parkour system's contract is
    # packages/engine-world/src/parkour/clips.ts (EXISTING_PLAYER_CLIPS).
    "idle", "walk", "run", "sprint",
    "jump", "runJump", "vault", "climbUp", "climbDown",
    "land", "landHard",
    # Chained-traversal verbs (parkour/clips.ts PARKOUR_CLIP_REQUESTS).
    #
    # "stepUp" is deliberately ABSENT. Mixamo's only candidate ("Step Up To Jump
    # Over Object") gathers, then launches into a fully airborne two-legged
    # hurdle over 2.90s — the exact opposite of a 200ms curb absorb that "must
    # not read as a stop". Its authored fallback of plain "run" is genuinely
    # better for a sub-0.5m lip, so this omits the clip and takes the fallback.
    "mantle", "slide", "climbOver", "landRun", "hangDrop",
    "leapOfFaithDive", "leapOfFaith", "leapOfFaithLand", "throwLight",
    # Stealth.
    "crouchIdle", "crouchWalk", "crouchToStand", "blendWalk",
    # Handbill precision beat.
    "knock", "reach",
    # Flintlock duel: face-off, engagement, and defeat.
    "standoff", "draw", "idleAim", "fire", "reload",
    "aimWalk", "aimRun",
    "dodge", "dropRoll", "hitReaction", "death",
]

# Per-role clip sets for the rest of the cast. The old dialogue game gave every
# character talk/argue/work and nothing else; the new game needs a duel opponent,
# readable patrols, and a crowd that is not a set of statues.
ROLE_CLIPS = {
    # Legacy dialogue subset. Retained only for reproducibility.
    "npc": [
        "idle", "walk", "run", "carryWalk", "work1", "work2",
        "talk", "talk2", "argu1", "argue2",
    ],
    # The duel antagonist. Six 20-second rounds where both sides move, take
    # cover, shoot and dodge, so he needs the player's full combat vocabulary
    # rather than a shooting pose: locomotion to close and break line of sight,
    # armed locomotion so he reads as armed while moving, and dodge because the
    # tuning has him evading roughly a third of incoming fire.
    "boss": [
        "idle", "walk", "run",
        "standoff", "draw", "idleAim", "fire", "reload",
        "aimWalk", "aimRun", "dodge", "hitReaction", "death",
    ],
    # A patrolling guard, one clip per stealth alert state so the player can read
    # escalation from body language alone. See PATROL_STATE_CLIPS below.
    "patrol": [
        "idle", "walk", "run",
        "patrolWalk", "scan", "investigate", "searchLook", "alerted",
        # A patrol that spots you in the duel arena also has to fight.
        "idleAim", "fire", "hitReaction", "death",
    ],
    # Street crowd. Deliberately small: enough that a cluster reads as people
    # going about their business and breaks a pursuer's vision cone.
    "civilian": [
        "idle", "walk", "blendWalk", "standIdle", "converse",
    ],
}
if ROLE in ROLE_CLIPS:
    CLIPS = ROLE_CLIPS[ROLE]
elif ROLE != "player":
    raise SystemExit(f"unknown role {ROLE!r}; known: player, {', '.join(ROLE_CLIPS)}")

# clip name -> FBX basename in assets/source/mixamo, where they differ.
#
# land/landHard still bake the same performance under two names: the duel
# (packages/duel) asks for "land" while the parkour contract asks for "landHard",
# and a missing name there degrades to a visibly wrong fallback. The shared
# source is Mixamo's "Hard Landing", which is correct for landHard and heavier
# than a soft landing wants — worth splitting once the duel can take a separate
# clip. Collapse to one name if the two contracts ever agree.
#
# dropRoll USED to alias dodge the same way, and that was the worse bug of the
# two: the landing roll and the combat evade were one 1.20s "Sprint To Forward
# Roll To Sprinting" under two names, so rolling out of a 4m drop played the
# animation for ducking a shot. It now has its own "Falling To Roll" (Game
# Blend), which is a roll that absorbs downward momentum rather than lateral.
CLIP_SOURCE = {
    "idle": "idleGrounded",
    "run": "runGrounded",
    "landHard": "land",
    # Both halves of the leap of faith are cut from the one dive performance;
    # see CLIP_TRIM.
    "leapOfFaithDive": "leapOfFaithDive",
    "leapOfFaith": "leapOfFaithDive",
}

# Clips baked time-reversed. "draw" is Mixamo's "Pistol Aim" ("Pistol Aim To
# Holster Idle"): played backwards it is exactly the duel's draw, weapon coming
# up from a lowered hand into the aim that idleAim then holds. Mixamo has no
# draw-from-holster performance (searched "Quick Draw", "Holster", "Draw
# Pistol" — 0, 1 and 0 usable results).
REVERSE = {"draw"}

# clip -> (firstFrame, lastFrame) kept from the source action, in SOURCE frame
# numbering. Used to cut one performance into the two beats a move needs.
#
# The leap of faith is built entirely out of Mixamo's "Run To Dive":
#   frames  0-22   run-up, plant, launch, extend into a face-down swan
#   frames 19-23   that swan attitude, held and looped for the descent
# Past frame ~23 the dive keeps rotating into a head-first vertical plummet,
# which is why the tail is cut. Chaining the dive to Mixamo's separate
# "Mid-Air Falling Idle" was tried first and looked worse than either clip
# alone: a fully extended dive snapping into a knees-tucked ball.
CLIP_TRIM = {
    "leapOfFaithDive": (0, 22),
    "leapOfFaith": (19, 23),
}

# Clips baked as a STATIC HOLD of their first trimmed frame.
#
# The descent loops for however long the fall lasts, so it has to be seamless.
# Holding a 4-frame window of the dive still had 93.6cm of per-bone travel across
# the seam (the body is mid-rotation there), which would stutter every 0.13s.
# Freezing the window to one pose makes the loop exact, and a held attitude is
# what the move wants anyway: the diver does not flail on the way down.
HOLD = {"leapOfFaith"}

# Clips whose horizontal freeze anchors at the rig origin instead of at the
# clip's own opening keyframe.
#
# remove_root_motion freezes Hips local X/Z at keyframe_points[0] — whatever the
# clip happens to OPEN on. For a whole Mixamo performance that IS the origin, so
# the distinction never surfaced. For a clip cut out of the MIDDLE of a
# performance it is not: leapOfFaith is frames 19-23 of the dive, by which point
# the body is 2.39m downrange. Freezing there pinned the held descent 2.39m in
# front of the capsule for the entire fall, and put a 2.39m pop at the
# dive -> descent handoff, where leapOfFaithDive (trimmed from frame 0, so
# anchored at ~0) clamps into it.
#
# This is the surviving half of the bug that removed the "all" mode: "freeze
# wherever the clip happens to open" has no correct use, but only the vertical
# axis was fixed at the time. Measured with the hips-world-offset sweep, every
# other clip on the rig sits within 0.14m of origin and is unaffected.
RECENTER_HORIZONTAL = {"leapOfFaith"}

# Diagnostics for A/B-ing a root-motion decision:
#   BAKE_ONLY_CLIPS=mantle,slide   bake just these (fast iteration)
#   BAKE_NO_ROOT_STRIP=1           bake with authored root motion intact, so a
#                                  render shows the performance as Mixamo authored
#                                  it rather than as the game will drive it
ONLY_CLIPS = [c for c in os.environ.get("BAKE_ONLY_CLIPS", "").split(",") if c]
NO_ROOT_STRIP = os.environ.get("BAKE_NO_ROOT_STRIP") == "1"

# Per-clip root-motion handling:
#   "horizontal" - freeze Hips bone-local X/Z, keep local Y. The Mixamo Hips
#                  parent/rest transform maps local Y to world vertical;
#                  validate this with inspect_glb.mjs worldRoot output.
#                  and interaction performances the world controller drives).
#   "all"        - freeze Hips X/Y/Z entirely (root-neutral): the physics layer
#                  and authored anchors own ALL displacement, so the clip never
#                  double-moves the body (jumps, vault, climbs).
# Anything not listed keeps its authored root untouched (already in-place clips
# such as reach/work/talk have no meaningful root translation).
# The rule that decides between them: whichever axes the game drives, freeze.
# Physics drives vertical only for the airborne/climbing set, so those are the
# only "grounded" clips. Every other clip's vertical channel is the *only* source
# of its read (a landing's squat, a roll's dip, a death's collapse) and freezing
# it would flatten the performance while the horizontal channel would double-move
# the body. Spans below are measured with inspect_motion_fbx.py.
ROOT_MODE = {
    "idle": "horizontal",
    "walk": "horizontal",
    "run": "horizontal",
    # Sprint is an in-place cycle already (0cm net travel); frozen so a future
    # re-pull without "In Place" cannot silently start double-moving the body.
    "sprint": "horizontal",
    "carryWalk": "horizontal",
    "knock": "horizontal",
    # crouchWalk drifted ~1.47m per cycle and crouchToStand ~0.33m against the
    # code-driven position: both were missing from this table entirely.
    "crouchWalk": "horizontal",
    "crouchToStand": "horizontal",
    # Physics owns the arc/ascent, so the clip must contribute no displacement —
    # and must not hold a baked vertical offset either. These were "all" until a
    # sweep found every one of them pinned off rest height (see remove_root_motion).
    "jump": "grounded",
    "runJump": "grounded",
    "vault": "grounded",
    "climbUp": "grounded",
    "climbDown": "grounded",
    # Landing: the capsule is already grounded and static by the time this plays
    # (AIRBORNE_VISUAL_TUNING.landingRecoverySeconds), so the 47cm vertical squat
    # is the entire read and is kept; the 18cm forward slide is frozen.
    "land": "horizontal",
    "landHard": "horizontal",
    # Dodge/roll: the duel drives the burst itself (DODGE_SPEED_SCALE over
    # DODGE_SECONDS) so the 96cm of forward travel is frozen, while the 87cm
    # vertical dip is what makes it read as a roll rather than a slide.
    "dodge": "horizontal",
    # The landing roll travels 341cm forward, all of it code-driven, and dips
    # 88cm. Its vertical OPENS at -9cm (already on the ground) because the Game
    # Blend cut of "Falling To Roll" starts at the moment of contact — which is
    # exactly when traversal fires it. The other cut of that card was rejected
    # for the opposite reason: it opens 146cm in the air, and "horizontal" would
    # have floated the body a metre and a half above the capsule on every roll.
    "dropRoll": "horizontal",
    # ---- chained traversal ------------------------------------------------
    # Every one of these is a committed verb: the traversal system has already
    # decided the path and moves the capsule along it, so the clip supplies pose
    # only. They are "grounded" rather than "all" because each is authored from
    # partway up its obstacle and would otherwise freeze mid-air.
    #   mantle    rises 189cm  (physics owns the pull onto the ledge)
    #   climbOver drops 118cm from a 111cm start
    #   hangDrop  drops 84cm from a 75cm start
    #   landRun   drops 59cm from a 46cm start
    "mantle": "grounded",
    "climbOver": "grounded",
    "hangDrop": "grounded",
    "landRun": "grounded",
    "stepUp": "grounded",
    # Slide travels 7.5m forward — by far the largest root translation in the
    # set, and the code drives all of it. The 79cm vertical dip is the slide.
    "slide": "horizontal",
    # The leap-of-faith chain. Physics owns the whole trajectory: the dive throws
    # the body 4.95m forward and 1.79m down, and the descent is held for however
    # long the fall lasts, so both are pinned to rest height. Left on "horizontal"
    # the descent would sit 9cm below rest for no reason.
    "leapOfFaithDive": "grounded",
    "leapOfFaith": "grounded",
    # Starts lying down (hips 100cm below rest) and rises 88cm to standing. The
    # vertical IS the get-up, so only the 76cm of forward crawl is frozen.
    "leapOfFaithLand": "horizontal",
    "throwLight": "horizontal",
    "blendWalk": "horizontal",
    # Duel performances are stationary, but every one of them braces, steps or
    # staggers 6-33cm horizontally. Unfrozen, that walks the duellist out of
    # position over six rounds.
    "standoff": "horizontal",
    "draw": "horizontal",
    "idleAim": "horizontal",
    "fire": "horizontal",
    "reload": "horizontal",
    "aimWalk": "horizontal",
    "aimRun": "horizontal",
    "hitReaction": "horizontal",
    # Death keeps its 93cm vertical collapse (nothing else lowers the body) and
    # freezes the 37cm sideways fall so the body drops where it was standing.
    "death": "horizontal",
}


def get_fcurves(action):
    if hasattr(action, "fcurves"):
        return list(action.fcurves)
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for slot in action.slots:
                try:
                    bag = strip.channelbag(slot)
                except Exception:
                    bag = None
                if bag:
                    out.extend(bag.fcurves)
    return out


def remove_root_motion(action, mode, recenter=False):
    # Mixamo Hips location channels are bone-local under a rotated armature:
    # local X/Z map to world horizontal while local Y maps to world vertical.
    #
    #   "horizontal" freeze local X/Z at their first-frame value, keep vertical.
    #   "grounded"   freeze X/Z the same way AND pin vertical to 0, the rig's
    #                rest height, for clips where physics owns vertical too.
    #
    # `recenter` freezes X/Z at 0 rather than at the opening keyframe, for a clip
    # trimmed out of the middle of a performance. See RECENTER_HORIZONTAL.
    #
    # There used to be an "all" mode that froze every axis at its FIRST KEYFRAME.
    # That is only safe for a clip which happens to start at standing height, and
    # a swept measurement (verify_clip_contacts.py, vFreeze column) showed that
    # not one of the five clips using it did:
    #
    #   climbDown +123.23cm   floated 1.23m for the clip's whole duration
    #   climbUp    +17.17cm   floated 17cm
    #   runJump    -15.61cm   sank 15.6cm through the floor
    #   vault      -16.24cm   sank 16.2cm
    #   jump        -1.25cm   marginal
    #
    # The mode was removed rather than fixed in place, because "freeze wherever
    # the clip happens to open" has no correct use: a physics-owned clip belongs
    # at rest height, which is what "grounded" pins it to.
    axes = {0, 2}
    for curve in get_fcurves(action):
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        if len(curve.keyframe_points) == 0:
            continue
        if curve.array_index in axes:
            base = 0.0 if recenter else curve.keyframe_points[0].co[1]
        elif mode == "grounded" and curve.array_index == 1:
            base = 0.0
        else:
            continue
        for key in curve.keyframe_points:
            key.co[1] = base
            key.handle_left[1] = base
            key.handle_right[1] = base


def reverse_action(action):
    # Mirror every keyframe about the action's own frame range. Handles are
    # rebuilt by setting the interpolation back, so no easing is inherited from
    # the forward direction.
    for curve in get_fcurves(action):
        keys = list(curve.keyframe_points)
        if not keys:
            continue
        first = keys[0].co[0]
        last = keys[-1].co[0]
        values = [key.co[1] for key in keys]
        for key, value in zip(keys, reversed(values)):
            key.co[1] = value
            key.handle_left[1] = value
            key.handle_right[1] = value
        frames = [first + last - key.co[0] for key in keys]
        for key, frame in zip(keys, reversed(frames)):
            key.co[0] = frame
            key.handle_left[0] = frame - 1
            key.handle_right[0] = frame + 1
        curve.update()


def hips_rest_length(armature):
    for bone in armature.data.bones:
        if "Hips" in bone.name:
            return bone.matrix_local.translation.length
    return None


def rescale_hips_location(action, ratio):
    """Convert the Hips translation channel into the target rig's units.

    A Mixamo motion FBX stores Hips translation in the same units as its own bone
    rest lengths (centimetres: hips rest ~110). Matching bone NAMES does not imply
    matching units, and some rigs in this cast are authored in metres instead
    (officer hips rest 1.2238). Copying the action across unchanged then moves the
    body by ~100x its own height — the officer's pre-existing walk bounces 4.6
    body-heights vertically, and every clip flings him clear out of frame.

    Rotations are scale-invariant, so only translation needs converting.

    A UNIT mismatch only. Two rigs in the same units still have slightly
    different rest lengths because they are different bodies, and rescaling by
    that is not a conversion — it is a 5% distortion of the performance. The
    player is the case in point: its hips rest 115.678 against the sources' ~110,
    a ratio of 1.0516, and both are centimetre rigs at armature scale 0.01
    (probe_rig_space.py). Applying it pushed crouchIdle, crouchToStand, fire and
    sprint 2-3cm through the floor and moved aimRun's measured stride from
    2.55 m/s to 1.62 — a 36% error against the CLIP_AUTHORED_SPEED_MPS the mixer
    de-skates with. The officer, the rig this was written for, sits at 1.2238
    against ~110: a ratio of 0.011, two orders of magnitude away and unmistakable.
    """
    if ratio is None or abs(ratio - 1.0) < 1e-6:
        return
    if 0.1 < ratio < 10.0:
        print(f"HIPS_RESCALE_SKIPPED ratio={ratio:.6f} (same units)")
        return
    for curve in get_fcurves(action):
        if "Hips" not in curve.data_path or not curve.data_path.endswith("location"):
            continue
        for key in curve.keyframe_points:
            for attr in ("co", "handle_left", "handle_right"):
                point = getattr(key, attr)
                point[1] = point[1] * ratio
        curve.update()


def trim_action(action, first, last):
    """Keep only frames [first, last] and rebase them to start at frame 0."""
    for curve in get_fcurves(action):
        doomed = [
            key for key in curve.keyframe_points
            if key.co[0] < first - 1e-6 or key.co[0] > last + 1e-6
        ]
        for key in reversed(doomed):
            try:
                curve.keyframe_points.remove(key, fast=True)
            except RuntimeError:
                pass
        for key in curve.keyframe_points:
            frame = key.co[0] - first
            key.co[0] = frame
            key.handle_left[0] = frame - 1
            key.handle_right[0] = frame + 1
        curve.update()


def flatten_action(action):
    """Collapse every channel to its first keyframe, giving an exact-looping hold."""
    for curve in get_fcurves(action):
        keys = list(curve.keyframe_points)
        if not keys:
            continue
        held = keys[0].co[1]
        for key in keys:
            key.co[1] = held
            key.handle_left[1] = held
            key.handle_right[1] = held
        curve.update()


def import_any(path):
    before = set(bpy.data.objects)
    if path.lower().endswith(".glb") or path.lower().endswith(".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    else:
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


def import_fbx(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, use_anim=True)
    return [o for o in bpy.data.objects if o not in before]


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps = 30

character = import_any(INPUT)
rig = next(o for o in character if o.type == "ARMATURE")

# Blender's glTF importer materialises an extra unskinned 42-vertex "Icosphere"
# spanning +/-1m that is NOT in the file (verified: both v6 and v7 GLB JSON carry
# exactly one mesh, Mesh0). It is an import artifact only, so it must not be
# exported back out, and any Blender-side bounds/ground check has to ignore it.
meshes = [o for o in character if o.type == "MESH" and o.find_armature() is rig]
for stray in [o for o in character if o.type == "MESH" and o not in meshes]:
    character.remove(stray)
    bpy.data.objects.remove(stray, do_unlink=True)
assert meshes, "input is not skinned"


# ---------------------------------------------------------------- unit scale
# Mixamo does not guarantee the units of what it hands back, and this script had no
# opinion about them for nine days.
#
# WHAT HAPPENED. officer-clean.fbx is 357 bytes of S3 "503 Slow Down" HTML saved
# with a .fbx extension - a download that failed without failing - so the officer
# could not be uploaded to Mixamo as FBX and went up as OBJ instead. An OBJ carries
# no unit declaration. For the officer, Mixamo returned a rig authored in METRES
# (Hips rest 1.2239, mesh object scale 1.0); for every sibling it returned the usual
# CENTIMETRE rig (Hips rest ~115, mesh object scale 100). Blender's FBX importer
# applies the conventional 0.01 armature scale either way, so the officer arrived
# 100x too small - 1.9cm tall - and this script baked and exported him that way.
#
# Nothing downstream complained. The retarget is proportional, so the clips looked
# right; both runtime loaders normalise a rig by height/measuredHeight, so he
# rendered at the correct height on screen. The file was simply wrong.
#
# WHY THE CORRECTION IS RESTRICTED TO A DECIMAL FACTOR. Normalising to a target
# height would also silently resize a rig that is merely a different body, turning a
# unit bug into an unrequested art change - the failure mode this repo has been bitten
# by repeatedly, where preserving one observable quantity hides a second change. A
# unit mismatch is always a power of ten, so only a power of ten is ever applied, and
# an input that no decimal factor can rescue is refused rather than guessed at.
HUMAN_HEIGHT_M = (1.2, 2.3)
UNIT_FACTORS = (1000.0, 100.0, 10.0, 0.1, 0.01, 0.001)


def skinned_world_height(objects):
    """World-space Z span of the skinned meshes, in metres. Blender is Z-up."""
    bpy.context.view_layer.update()
    low, high = None, None
    for mesh in objects:
        matrix = mesh.matrix_world
        for vertex in mesh.data.vertices:
            z = (matrix @ vertex.co).z
            low = z if low is None else min(low, z)
            high = z if high is None else max(high, z)
    return None if low is None else high - low


def normalise_rig_units(armature, mesh_objects):
    height = skinned_world_height(mesh_objects)
    if height is None or height <= 0:
        raise SystemExit("RIG_UNITS_FAIL cannot measure the rig's height")
    if HUMAN_HEIGHT_M[0] <= height <= HUMAN_HEIGHT_M[1]:
        print(f"RIG_UNITS_OK height={height:.6f}m (no correction needed)")
        return 1.0
    usable = [
        factor
        for factor in UNIT_FACTORS
        if HUMAN_HEIGHT_M[0] <= height * factor <= HUMAN_HEIGHT_M[1]
    ]
    if len(usable) != 1:
        raise SystemExit(
            f"RIG_UNITS_FAIL height={height:.6f}m is not human-scaled and no single "
            f"decimal unit factor lands it in {HUMAN_HEIGHT_M} (candidates={usable}). "
            "The input rig is wrong in a way this bake must not paper over."
        )
    factor = usable[0]
    # Scaling the ARMATURE OBJECT rescales mesh, skeleton and every baked clip
    # together, because the meshes are its children and the actions are keyed in
    # bone-local space. Bone rest lengths in armature-local units are unchanged, so
    # rescale_hips_location's ratio - and therefore the retarget - is untouched.
    armature.scale = armature.scale * factor
    corrected = skinned_world_height(mesh_objects)
    print(
        f"RIG_UNITS_CORRECTED height={height:.6f}m -> {corrected:.6f}m "
        f"(x{factor:g}; input was authored in the wrong unit)"
    )
    if not HUMAN_HEIGHT_M[0] <= corrected <= HUMAN_HEIGHT_M[1]:
        raise SystemExit(f"RIG_UNITS_FAIL correction landed at {corrected:.6f}m")
    return factor


normalise_rig_units(rig, meshes)

if MATERIAL_SOURCE:
    before_material_objects = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=MATERIAL_SOURCE)
    material_meshes = [
        o for o in bpy.data.objects
        if o not in before_material_objects and o.type == "MESH" and o.data.materials
    ]
    if material_meshes:
        materials = list(material_meshes[0].data.materials)
        for mesh in meshes:
            mesh.data.materials.clear()
            for material in materials:
                mesh.data.materials.append(material)
    for o in list(bpy.data.objects):
        if o not in before_material_objects and o not in character:
            bpy.data.objects.remove(o, do_unlink=True)

def drop_unused_alpha():
    """Let the exporter emit JPEG for a base-colour texture whose alpha is noise.

    The player albedo is a 2048x2048 RGBA PNG at 3.998MB — 51% of the whole rig.
    It is PNG only because it carries an alpha channel, and the exporter keeps
    PNG for any base colour on a non-OPAQUE material. Measured with
    probe_texture_alpha.py, exactly 27 of 4,194,304 pixels are below opaque
    (0.0006%): Meshy bake noise, not a cutout. Nothing in the character needs
    per-pixel transparency, so the channel costs ~3.5MB and a sorted
    transparent draw for nothing.

    ALWAYS measure a character with probe_cast_textures.py before relying on this;
    set BAKE_KEEP_ALPHA=1 for any rig whose alpha is genuine (hair cards, lace).
    """
    if os.environ.get("BAKE_KEEP_ALPHA") == "1":
        print("ALPHA_KEPT (BAKE_KEEP_ALPHA=1)")
        return
    for material in bpy.data.materials:
        if not material.use_nodes:
            continue
        for node in material.node_tree.nodes:
            if node.type != "BSDF_PRINCIPLED":
                continue
            alpha = node.inputs.get("Alpha")
            if alpha is not None:
                for link in list(alpha.links):
                    material.node_tree.links.remove(link)
                alpha.default_value = 1.0
        # Blender 4.2+ dropped Material.blend_method for EEVEE Next; guard it.
        if hasattr(material, "blend_method"):
            material.blend_method = "OPAQUE"
        print("ALPHA_DROPPED", material.name)


drop_unused_alpha()

actions = []
# Discard the arbitrary Idle used only to download the skinned character, and —
# when re-baking from an already-baked GLB — every clip it already carried. CLIPS
# is the whole truth about what ships, so anything not listed is dropped here.
rig.animation_data_clear()
for stale in list(bpy.data.actions):
    bpy.data.actions.remove(stale, do_unlink=True)

target_hips = hips_rest_length(rig)
print("TARGET_HIPS_REST", round(target_hips, 6) if target_hips else None)

missing = []
for clip in ONLY_CLIPS or CLIPS:
    path = os.path.join(ANIMS, CLIP_SOURCE.get(clip, clip) + ".fbx")
    if not os.path.exists(path):
        missing.append(clip)
        continue
    objs = import_fbx(path)
    src = next((o for o in objs if o.type == "ARMATURE"), None)
    if src and src.animation_data and src.animation_data.action:
        action = src.animation_data.action.copy()
        action.name = clip
        action.use_fake_user = True
        source_hips = hips_rest_length(src)
        if target_hips and source_hips:
            rescale_hips_location(action, target_hips / source_hips)
        trim = CLIP_TRIM.get(clip)
        if trim:
            trim_action(action, trim[0], trim[1])
        if clip in HOLD:
            flatten_action(action)
        if clip in REVERSE:
            reverse_action(action)
        mode = None if NO_ROOT_STRIP else ROOT_MODE.get(clip)
        if mode:
            remove_root_motion(action, mode, clip in RECENTER_HORIZONTAL)
        actions.append(action)
    for o in objs:
        bpy.data.objects.remove(o, do_unlink=True)
if missing:
    print("MISSING_SOURCE_FBX", ",".join(missing))

rig.animation_data_create()
rig.animation_data.action = None
for action in actions:
    track = rig.animation_data.nla_tracks.new()
    track.name = action.name
    track.strips.new(action.name, int(action.frame_range[0]), action)
    track.mute = True

os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)

# Re-measured rather than trusted: normalise_rig_units ran before the clips were
# attached, and a bake step that moved the rig would otherwise ship silently. This
# is the last point at which a mis-scaled rig can be stopped inside Blender;
# scripts/check-world-scale.mjs stops it again at publication.
final_height = skinned_world_height(meshes)
if final_height is None or not HUMAN_HEIGHT_M[0] <= final_height <= HUMAN_HEIGHT_M[1]:
    raise SystemExit(
        f"RIG_UNITS_FAIL refusing to export {OUTPUT}: height {final_height}m is "
        f"outside {HUMAN_HEIGHT_M}"
    )
print(f"RIG_UNITS_EXPORT height={final_height:.6f}m")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=OUTPUT,
    export_format="GLB",
    export_animations=True,
    export_animation_mode="NLA_TRACKS",
    export_force_sampling=True,
    export_optimize_animation_size=True,
    export_yup=True,
    export_skins=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)
print("WROTE", OUTPUT, os.path.getsize(OUTPUT), "clips", len(actions))
