"""
Upload a static Meshy T-pose FBX to Mixamo, place auto-rig markers, select Idle,
and download a Mixamo-rigged FBX with skin. Uses the persistent browser profile
created by /tmp/mixamo-mcp so Adobe login is needed only once.

Usage:
  /tmp/mixamo-mcp/.venv/bin/python assets/pipeline/mixamo_rig_character.py \
    input.fbx output-with-skin.fbx
"""
import os
import json
import sys
import time
from pathlib import Path

MIXAMO_TOOL = "/tmp/mixamo-mcp"
inp = str(Path(sys.argv[1]).resolve())
out = str(Path(sys.argv[2]).resolve())
POSE_KIND = sys.argv[3].lower() if len(sys.argv) > 3 else "t"
debug_shot = str(Path(out).with_suffix(".markers.png"))
USE_SYMMETRY = True

sys.path.insert(0, MIXAMO_TOOL)
os.chdir(MIXAMO_TOOL)

import browser  # noqa: E402
from screens.upload import upload_file, get_status  # noqa: E402
from screens.animations import search, get_animation_list, select_animation  # noqa: E402
from screens.download import open_modal, set_format, set_skin, set_fps, confirm  # noqa: E402


def wait_for(predicate, timeout=240, step=1):
    start = time.time()
    while time.time() - start < timeout:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    raise TimeoutError("Mixamo step timed out")


def upload_to_marker_screen(page):
    upload_file(page, inp)

    def ready():
        st = get_status(page.content())
        if st.get("state") == "error":
            raise RuntimeError(st.get("text"))
        return st if st.get("state") == "markers" else None

    wait_for(ready)
    # First marker-classified screen is orientation review.
    page.locator(".modal-footer button.btn-primary").click()
    wait_for(lambda: page.locator("#chin").count() > 0)


def place_markers(page):
    page.set_default_timeout(10_000)
    symmetry = page.locator('input[name="symmetry"]')
    if not USE_SYMMETRY and symmetry.count() and symmetry.is_checked():
        # React-controlled checkbox: locator.click changes the DOM visual but
        # did not update Mixamo's component state (the rig payload still sent
        # symmetric:true). Use the native setter + input/change events.
        page.evaluate(
            """() => {
                const el = document.querySelector('input[name="symmetry"]');
                const setter = Object.getOwnPropertyDescriptor(
                    HTMLInputElement.prototype, 'checked'
                ).set;
                setter.call(el, false);
                el.dispatchEvent(new Event('input', {bubbles:true}));
                el.dispatchEvent(new Event('change', {bubbles:true}));
            }"""
        )
        time.sleep(0.5)
    overlay = page.locator(".autorig-overlay").bounding_box()
    if not overlay:
        raise RuntimeError("marker overlay not found")

    # Normalized positions in Mixamo's auto-framed T-pose viewport. The static
    # Meshy cast uses standard human proportions, symmetry on, and full-body
    # centered framing.
    targets = {
        # Calibrated from a successful real-pointer Mixamo submission.
        "chin": (0.500, 0.136),
        "larm": (0.259, 0.212),
        "lelbow": (0.345, 0.214),
        "lknee": (0.448, 0.638),
        "groin": (0.500, 0.426),
    }
    if POSE_KIND == "a":
        targets["larm"] = (0.296, 0.437)
        targets["lelbow"] = (0.385, 0.310)
    elif POSE_KIND == "rider":
        targets["larm"] = (0.259, 0.225)
        targets["lelbow"] = (0.355, 0.205)
        targets["lknee"] = (0.448, 0.660)
        targets["groin"] = (0.500, 0.470)
    if not USE_SYMMETRY:
        targets.update({
            "rarm": (0.760, 0.190),
            "relbow": (0.640, 0.195),
            "rknee": (0.545, 0.730),
        })
    for marker_id, (nx, ny) in targets.items():
        print("[mixamo] marker", marker_id, flush=True)
        box = page.evaluate(
            """(id) => {
                const el = document.getElementById(id);
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return {x:r.x, y:r.y, width:r.width, height:r.height};
            }""",
            marker_id,
        )
        if not box:
            raise RuntimeError(f"marker {marker_id} missing")
        sx = box["x"] + box["width"] / 2
        sy = box["y"] + box["height"] / 2
        tx = overlay["x"] + overlay["width"] * nx
        ty = overlay["y"] + overlay["height"] * ny
        # Real multi-step pointer input is required: each intermediate move
        # drives Mixamo's 3D raycast so the marker receives the character
        # surface depth. A single jump leaves every marker on the same flat
        # overlay plane and the rig service rejects them as "not on character."
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(tx, ty, steps=12)
        page.mouse.up()
        time.sleep(0.2)
        print("[mixamo] marker done", marker_id, flush=True)

    # Standard is the same skeleton used by the user's successful manual rig.
    page.locator(".autorig-modal select").select_option("")
    print("[mixamo] markers placed", flush=True)
    page.screenshot(path=debug_shot, timeout=15_000)


def run():
    browser.DEBUG = False
    page = browser.start()
    def fix_rig_payload(route, request):
        try:
            data = request.post_data_json
            if not USE_SYMMETRY and data and "rigging_inputs" in data:
                data["rigging_inputs"]["symmetric"] = False
                print("[mixamo] forcing rig payload symmetric:false", flush=True)
                route.continue_(post_data=json.dumps(data))
                return
        except Exception as exc:
            print("[mixamo] rig route error", exc, flush=True)
        route.continue_()
    page.route("**/api/v1/characters/*/rig", fix_rig_payload)
    def log_request(request):
        if request.url.rstrip("/").endswith("/rig"):
            print("[mixamo] rig request", request.post_data, flush=True)
    page.on("request", log_request)
    def log_response(response):
        url = response.url.lower()
        if "autorig" in url or "character" in url or response.status >= 400:
            print("[mixamo] response", response.status, response.url, flush=True)
            if response.status >= 400:
                try:
                    print("[mixamo] response body", response.text()[:1000], flush=True)
                except Exception:
                    pass
    page.on("response", log_response)
    page.on("requestfailed", lambda req: print("[mixamo] request failed", req.url, req.failure, flush=True))
    try:
        print("[mixamo] uploading", inp, flush=True)
        upload_to_marker_screen(page)
        print("[mixamo] placing markers", flush=True)
        place_markers(page)
        page.locator(".modal-footer button.btn-primary").click()
        print("[mixamo] rigging started", flush=True)

        # Wait for the rigging phase to finish and its review Next button to
        # become enabled. Avoid mistaking the intermediate "Processing upload"
        # holder for the actual review screen.
        start = time.time()
        review = None
        saw_rigging = False
        while time.time() - start < 600:
            st = get_status(page.content())
            if st.get("state") == "error":
                raise RuntimeError(st.get("text"))
            text = st.get("text", "").lower()
            btn = page.locator(".modal-footer button.btn-primary")
            enabled = btn.count() > 0 and btn.is_enabled()
            label = btn.inner_text().strip().lower() if btn.count() else ""
            if st.get("state") == "review" and "auto-rigging" in text:
                saw_rigging = True
            if saw_rigging and st.get("state") == "markers":
                page.screenshot(path=str(Path(out).with_suffix(".rig-failed.png")))
                raise RuntimeError("Mixamo returned to marker placement: auto-rig job failed")
            elapsed = int(time.time() - start)
            if elapsed % 10 == 0:
                print("[mixamo] rig", elapsed, st, "button=", label, "enabled=", enabled, flush=True)
                time.sleep(1)
            if (
                st.get("state") == "review"
                and "auto-rigging" not in text
                and "processing" not in text
                and enabled
                and label == "next"
            ):
                # The final review shows a rigged/animated character; the
                # processing holder uses a Please Wait button.
                review = st
                break
            time.sleep(1)
        if review is None:
            page.screenshot(path=str(Path(out).with_suffix(".timeout.png")))
            raise TimeoutError("Mixamo rigging review timed out")
        print("[mixamo] rig review ready", review, flush=True)
        time.sleep(2)
        for attempt in range(3):
            page.locator(".modal-footer button.btn-primary").click(force=True)
            try:
                page.wait_for_selector(".autorig-modal", state="detached", timeout=20_000)
                break
            except Exception:
                print("[mixamo] review Next retry", attempt + 1, flush=True)

        # Animation browser with the newly rigged character.
        wait_for(lambda: "autorig-modal" not in page.content() and "mixamo.com" in page.url, timeout=90)
        print("[mixamo] selecting Idle", flush=True)
        time.sleep(3)
        search(page, "Idle")
        listing = []
        for _ in range(30):
            listing = get_animation_list(page.content())["items"]
            if listing:
                break
            time.sleep(1)
        if not listing:
            raise RuntimeError("Mixamo Idle search returned no animation cards")
        idle = next((x for x in listing if x["name"].strip().lower() == "idle"), listing[0])
        select_animation(page, idle["id"])
        time.sleep(4)

        open_modal(page)
        set_format(page, "fbx")
        set_skin(page, True)
        set_fps(page, 30)
        confirm(page, out)
        print("WROTE", out, os.path.getsize(out), flush=True)
    finally:
        browser.stop()


run()
