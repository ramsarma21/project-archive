# Pipeline archive

These scripts were one-off or superseded steps in the 3D asset pipeline: early
rigging experiments (native-Mixamo rig/retarget/remesh spikes replaced by the
Meshy-skeleton bake in `rig_character.mjs` + `bake_character_anims.py` +
`append_clips.py`), single-use fixes for assets that have already landed and been
synced to `apps/web/public/world/` (sign/press/interior/prop optimizes and
assemblers), and disposable visual-QA capture scripts superseded by the reusable
`qa_*.mjs` harnesses. They are kept only for provenance and are safe **deletion
candidates after one release cycle** — nothing in the runtime, tests, gates, or
the active pipeline factory imports or executes them. If you need to regenerate a
landed asset, prefer the retained factory scripts one directory up; resurrect a
script from here only as a reference.
