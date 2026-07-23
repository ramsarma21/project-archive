"""
Visible one-time Mixamo rig capture. The user places markers with real pointer
input; the script records the valid /rig payload, waits for completion, then
downloads Idle with skin. That payload geometry mapping can seed later batch
automation.
"""
import json
import os
import sys
import time
from pathlib import Path

MIXAMO_TOOL = "/tmp/mixamo-mcp"
inp = str(Path(sys.argv[1]).resolve())
out = str(Path(sys.argv[2]).resolve())
sys.path.insert(0, MIXAMO_TOOL)
os.chdir(MIXAMO_TOOL)

import browser  # noqa
from screens.upload import upload_file, get_status  # noqa
from screens.animations import search, get_animation_list, select_animation  # noqa
from screens.download import open_modal, set_format, set_skin, set_fps, confirm  # noqa

browser.DEBUG = True
page = browser.start()
rig_payloads = []


def on_request(req):
    if req.url.rstrip("/").endswith("/rig"):
        try:
            data = req.post_data_json
            rig_payloads.append(data)
            print("RIG_PAYLOAD", json.dumps(data), flush=True)
            Path(out + ".rig-payload.json").write_text(json.dumps(data, indent=2))
        except Exception as exc:
            print("payload error", exc, flush=True)


page.on("request", on_request)
upload_file(page, inp)

# Wait for orientation screen, then advance to empty marker screen.
while get_status(page.content()).get("state") != "markers":
    time.sleep(1)
page.locator(".modal-footer button.btn-primary").click()
page.wait_for_selector("#chin")
page.bring_to_front()
print("MANUAL_MARKERS_READY", flush=True)

# User places markers and clicks Next. If Mixamo returns to markers, keep the
# window alive so they can adjust and submit again.
previous_payload_count = 0
review_ready = False
while not review_ready:
    st = get_status(page.content())
    text = st.get("text", "").lower()
    btn = page.locator(".modal-footer button.btn-primary")
    label = btn.inner_text().strip().lower() if btn.count() else ""
    enabled = btn.count() > 0 and btn.is_enabled()
    if len(rig_payloads) > previous_payload_count:
        previous_payload_count = len(rig_payloads)
        print("RIG_SUBMITTED", previous_payload_count, flush=True)
    if st.get("state") == "review" and "auto-rigging" not in text and "processing" not in text and label == "next" and enabled:
        review_ready = True
        break
    time.sleep(1)

print("RIG_SUCCESS", flush=True)
page.locator(".modal-footer button.btn-primary").click()
while "autorig-modal" in page.content():
    time.sleep(1)

search(page, "Idle")
items = get_animation_list(page.content())["items"]
idle = next((x for x in items if x["name"].strip().lower() == "idle"), items[0])
select_animation(page, idle["id"])
time.sleep(4)
open_modal(page)
set_format(page, "fbx")
set_skin(page, True)
set_fps(page, 30)
confirm(page, out)
print("WROTE", out, os.path.getsize(out), flush=True)
browser.stop()
