#!/usr/bin/env python3
"""Project Archive: legacy Boston Day 1 consequential text playtest.

This is a no-render prototype for testing game flow, not final dialogue or history
media. It predates the current four-errand, three-Sync, three-stage Day 1 in
``Day-1.md`` and must not be used as the implementation fixture for
``Backend-AI-System.md`` until it is rewritten against those current contracts.
It models:
  * real job actions and route pressure,
  * bounded unpredictable outcomes that are deterministic for a fixed seed,
  * persistent local consequences,
  * documented fixed history,
  * world-state carrier rerouting so required learning survives every outcome, and
  * an embedded headline action instead of a detached end-of-day quiz.

Run:
    python3 sim/boston_day1.py
    python3 sim/boston_day1.py --seed 1765
    python3 sim/boston_day1.py --designer
    python3 sim/boston_day1.py --validate
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import textwrap
from dataclasses import asdict, dataclass, field
from itertools import permutations, product
from pathlib import Path


WIDTH = 78
ACTIVE_SAVE_PATH: Path | None = None
ACTIVE_STATE: State | None = None


def wrap(text: str, prefix: str = "") -> str:
    return "\n".join(
        textwrap.fill(
            paragraph,
            width=WIDTH,
            initial_indent=prefix,
            subsequent_indent=prefix,
        )
        if paragraph
        else ""
        for paragraph in text.splitlines()
    )


def title(text: str) -> None:
    print("\n" + "═" * WIDTH)
    print(text.center(WIDTH))
    print("═" * WIDTH)


def scene(text: str) -> None:
    print("\n" + wrap(text))


def say(name: str, text: str) -> None:
    print(f"\n{name}: “{text}”")


def document(name: str, lines: list[str]) -> None:
    print(f"\n┌─ {name} " + "─" * max(1, WIDTH - len(name) - 4))
    for line in lines:
        print("│ " + line)
    print("└" + "─" * (WIDTH - 1))


def designer_note(enabled: bool, text: str) -> None:
    if enabled:
        print("\n" + wrap("[DESIGN CHECK] " + text, "  "))


def choose(prompt: str, options: list[str], choice_id: str) -> int:
    print("\n" + wrap(prompt))
    for index, option in enumerate(options, 1):
        print(wrap(f"{index}. {option}", "  "))
    if ACTIVE_STATE is not None and choice_id in ACTIVE_STATE.committed_choices:
        restored = ACTIVE_STATE.committed_choices[choice_id]
        if not 0 <= restored < len(options):
            raise RuntimeError(f"saved choice {choice_id} is invalid for current options")
        print(f"\n> [restored choice {restored + 1}]")
        return restored
    while True:
        answer = input("\n> ").strip().lower()
        if answer in {"q", "quit", "exit"}:
            raise SystemExit("\nPlaytest stopped. State would auto-save invisibly.")
        if answer.isdigit() and 1 <= int(answer) <= len(options):
            selected = int(answer) - 1
            if ACTIVE_STATE is not None:
                persist_committed_choice(
                    ACTIVE_STATE, choice_id, selected, ACTIVE_SAVE_PATH
                )
            return selected
        print(f"Choose 1–{len(options)}, or q to quit.")


def continue_prompt() -> None:
    input("\n[Enter to continue]")


SIM_PACKAGE_HASH = hashlib.sha256(b"PROJECT_ARCHIVE_TEXT_SIM_V1").digest()


def _canon_str(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return len(encoded).to_bytes(4, "big") + encoded


def outcome_bucket(seed: int, policy_id: str, total: int = 10_000) -> int:
    """Integer-only PA.OUTCOME.RANK.v1 draw for the text simulator."""
    if not 0 <= seed < 2**128:
        raise ValueError("seed must be a 128-bit unsigned integer")
    if total <= 0:
        raise ValueError("total must be positive")
    key = seed.to_bytes(16, "big")
    message = (
        b"PA.OUTCOME.RANK.v1\x00"
        + SIM_PACKAGE_HASH
        + _canon_str(policy_id)
        + _canon_str("1")
        + _canon_str(f"SIM-{seed:032x}")
        + _canon_str(f"SIM.ACTION.{policy_id}")
        + (0).to_bytes(4, "big")
        + _canon_str(policy_id)
    )
    rank = int.from_bytes(hmac.new(key, message, hashlib.sha256).digest(), "big")
    return (rank * total) // 2**256


@dataclass
class State:
    seed: int
    designer: bool = False
    time: int = 0
    stops_done: set[str] = field(default_factory=set)
    gate_access: bool = False
    thomas_helped: bool = False
    pike_result: str = "pending"
    handoff: str = "pending"
    watcher_present: bool = False
    watcher_recognized: bool = False
    handbills_custody: str = "player"
    handbills_condition: str = "intact"
    proof_custody: str = "player"
    proof_condition: str = "intact"
    circular_custody: str = "player"
    circular_condition: str = "intact"
    source_notes_condition: str = "intact"
    living_slots: list[str] = field(default_factory=list)
    handoff_variation: str = "pending"
    event_start_time: int | None = None
    crowd_result: str = "pending"
    headline: str = "pending"
    headline_support: str = "pending"
    headline_selected_index: int | None = None
    headline_support_index: int | None = None
    publication_result: str = "pending"
    abigail_relationship: str = "cautious"
    concepts: set[str] = field(default_factory=set)
    evidence: set[str] = field(default_factory=set)
    consequences: list[str] = field(default_factory=list)
    committed_choices: dict[str, int] = field(default_factory=dict)
    phase: str = "new"


def save_state(path: Path, state: State) -> None:
    payload = asdict(state)
    payload["stops_done"] = sorted(state.stops_done)
    payload["concepts"] = sorted(state.concepts)
    payload["evidence"] = sorted(state.evidence)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, sort_keys=True), encoding="utf-8")
    os.replace(temporary, path)


def load_state(path: Path) -> State:
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["stops_done"] = set(payload["stops_done"])
    payload["concepts"] = set(payload["concepts"])
    payload["evidence"] = set(payload["evidence"])
    return State(**payload)


def checkpoint(state: State, phase: str | None = None) -> None:
    if phase is not None:
        state.phase = phase
    if ACTIVE_SAVE_PATH is not None:
        save_state(ACTIVE_SAVE_PATH, state)


def persist_committed_choice(
    state: State, choice_id: str, selected: int, path: Path | None
) -> None:
    """Persist intent against the last outcome checkpoint, not transient mutations."""
    state.committed_choices[choice_id] = selected
    if path is None:
        return
    if path.exists():
        persisted = load_state(path)
        persisted.committed_choices[choice_id] = selected
        save_state(path, persisted)
    else:
        save_state(path, state)


def carried_paper_label(state: State) -> str:
    if state.handbills_custody == "player":
        return "the political handbills"
    if state.proof_custody == "player":
        return "Pike's legal proof"
    if state.circular_custody == "player":
        return "Thomas's circular"
    return "your source notes"


def opening(state: State) -> None:
    title("PROJECT ARCHIVE — BOSTON ON THE BRINK")
    document(
        "CONTEXT RECORD",
        [
            "WAR ENDS — 1763",
            "BRITAIN OWES FAR MORE MONEY",
            "PARLIAMENT LOOKS TO THE COLONIES FOR REVENUE",
        ],
    )
    document(
        "TEMPORAL INSERTION",
        ["Boston · 14 August 1765", "Cover · Printer's apprentice"],
    )

    scene(
        "Heat. Ink. The hard wooden knock of a press. You arrive beside it while "
        "Abigail Mercer is already pulling the next sheet."
    )
    say("Abigail", "You're late. Catch the other end.")
    choose(
        "TUTORIAL — Pull the damp sheet without folding it.",
        ["Take both corners, lift, and carry it flat to the rack."],
        "opening.press.catch-sheet",
    )

    scene(
        "The page is warm in your hands. You have to look at it to line up the rack."
    )
    document(
        "THE SHEET",
        [
            "THE STAMP ACT — BEGINS 1 NOVEMBER",
            "Newspapers, pamphlets, legal papers, licenses, playing cards,",
            "and other covered items must use paid stamped paper.",
            "",
            "A tax laid inside the colonies should require the people's consent",
            "through their representatives.",
        ],
    )
    document(
        "SHOP PROOF — COMPARE",
        [
            "TODAY: ordinary legal form; valid with the clerk's words and seal.",
            "AFTER 1 NOVEMBER: same words; paid stamped paper also required.",
            "The new tax reaches paper and transactions inside the colonies,",
            "not only goods passing through a port.",
        ],
    )
    state.concepts.update(
        {"war_debt_policy", "stamp_act", "internal_tax", "representation"}
    )
    state.evidence.update({"morning_sheet", "retained_shop_proof"})

    designer_note(
        state.designer,
        "The player learns by handling the work. A sourced Benjamin Edes print item "
        "could identify his real print-network role in some runs, but the opening does "
        "not force an extra famous-person tag where it would interrupt the job.",
    )

    say(
        "Abigail",
        "Circular to Thomas. Proof to Pike. Handbills to the south-road carrier "
        "before the evening bell.",
    )
    say("Abigail", "Crowd's been under the elm since morning. If it closes, go around.")
    scene(
        "She loads three sleeves in your satchel and marks the handoff on a paper "
        "route map. Outside, bells and voices carry over the roofs."
    )


def living_encounter(state: State, label: str) -> None:
    encounter_roll = outcome_bucket(state.seed, f"encounter:{label}")
    if encounter_roll >= 6700:
        state.living_slots.append("route:NO_ACTION")
        scene("The next lane stays clear. For once, nothing needs you.")
        return

    if encounter_roll < 3300:
        scene(
            "A loaded handcart has jammed sideways between two stalls. The quick lane "
            "is gone. People are squeezing around it. The driver is trying to save "
            "cloth and hardware brought in through the harbor; three shops are waiting "
            "on the same load."
        )
        action = choose(
            "The carrier's bell is getting closer. What do you do?",
            [
                "Climb over the tied load and drop down the far side.",
                "Take the yard passage. Slower, but clear.",
                "Help the driver straighten the cart.",
            ],
            f"living.{len(state.living_slots)}.handcart.action",
        )
        if action == 0:
            result = outcome_bucket(state.seed, f"cart-climb:{label}")
            if result < 2000:
                scene(
                    "A rope shifts under your shoe. You catch the rail, but the satchel "
                    "hits the cart. The papers still in your custody take the impact."
                )
                damaged = damage_carried_papers(state)
                state.consequences.append("Handbills creased during cart climb.")
                state.consequences[-1] = f"{damaged.capitalize()} creased during cart climb."
            else:
                scene("Boot on the wheel. Hand on the rail. You're over before it moves.")
        elif action == 1:
            state.time = min(7, state.time + 1)
            scene("You take the yard. It works, but the sun is lower when you come out.")
        else:
            state.time = min(7, state.time + 2)
            state.consequences.append("Helped clear a merchant's handcart.")
            scene("It takes both of you. The lane opens behind you, but you've lost time.")
        state.living_slots.append("route:HANDCART")
    else:
        exposed_papers = carried_paper_label(state)
        scene(
            "A hard shower starts without warning. Black ink freckles the top sheet "
            "before you get under an awning. One wet bundle can stop an argument from "
            "reaching the next town; print travels only as far as workers can carry it."
        )
        action = choose(
            "The street ahead is still open.",
            [
                f"Wrap {exposed_papers} in retained plain packing sheets, then run.",
                "Wait under the awning and protect everything.",
                "Run now with the satchel under your coat.",
            ],
            f"living.{len(state.living_slots)}.rain.action",
        )
        if action == 0:
            state.time = min(7, state.time + 1)
            protected = protect_carried_papers(state)
            scene("The packing sheets keep the ink dry. Repacking costs you a little time.")
            state.consequences.append(f"Protected {protected} from rain.")
        elif action == 1:
            state.time = min(7, state.time + 2)
            scene("The rain passes. The work is clean. The bell is much closer.")
        else:
            result = outcome_bucket(state.seed, f"rain-run:{label}")
            if result < 2500:
                damaged = damage_carried_papers(state, "watermarked")
                state.consequences.append(f"{damaged.capitalize()} watermarked in the rain.")
                scene("You make the corner, but water has bled through one edge.")
            else:
                scene("You reach the next overhang with the satchel dry.")
        state.living_slots.append("route:RAIN_ON_PRINT")


def stop_thomas(state: State) -> None:
    state.stops_done.add("thomas")
    state.circular_custody = "thomas"
    state.time += 1
    title("THOMAS BELL — COUNTING HOUSE")
    scene(
        "Thomas is pulling a roll of good cloth away from his front window. He takes "
        "the circular with one hand and keeps dragging with the other."
    )
    say("Thomas", "Put it there. Then help me with this, or get clear.")
    if state.time >= 7:
        say("Thomas", "Bell. Go—the street's moving.")
        state.consequences.append("Thomas's circular arrived as the procession began.")
        return
    action = choose(
        "The carrier will not wait past the evening bell.",
        [
            "Help Thomas move and cover the cloth.",
            "Keep the delivery window. Tell him you have to go.",
        ],
        "thomas.move-cloth",
    )
    if action == 0:
        if state.time + 2 > 7:
            state.time = 7
            state.consequences.append("Started helping Thomas; the bell cut the work short.")
            say("Thomas", "Leave it. They're moving.")
            return
        state.time += 2
        state.gate_access = True
        state.thomas_helped = True
        state.consequences.append("Thomas trusts you with his rear-yard gate.")
        scene(
            "You drag the cloth behind the counter. Thomas gives you the rear-gate "
            "latch and points through his yard."
        )
        say("Thomas", "If the square closes, use that. Shut it behind you.")
    else:
        state.consequences.append("Thomas remembers that you protected the deadline.")
        say("Thomas", "Fine. Go. I should've asked before the streets turned.")

    scene(
        "Behind him: the old list of port duties. In your satchel: the new tax that "
        "reaches newspapers and legal desks inside the colony."
    )
    say("Thomas", "Port taxes, I can plan for. This reaches every desk in town.")
    say("Thomas", "Nobody here had a vote on it.")
    state.evidence.add("thomas_contrast")
    designer_note(
        state.designer,
        "Thomas gives the player a request with a cost. His two short lines clarify "
        "the world evidence; they are not a stand-and-listen lesson.",
    )


def stop_pike(state: State) -> None:
    state.stops_done.add("pike")
    state.proof_custody = "pike"
    state.time += 1
    title("PIKE — CLERK'S OFFICE")
    scene(
        "The door opens before you knock. Pike takes Abigail's proof and lays it beside "
        "a sample form. Same words. The new one has a space for the paid stamp."
    )
    say("Pike", "Same form. No stamp, no good. What am I meant to tell people?")
    if state.time >= 7:
        state.pike_result = "delivered_at_bell"
        say("Pike", "Go. That's the bell.")
        state.consequences.append("Pike's proof arrived as the procession began.")
        return
    action = choose(
        "Pike has deeds and licenses stacked across his desk.",
        [
            "Tell him straight: after 1 November, no stamp means the form is not valid.",
            "Tell him it will probably be fine and get out quickly.",
            "Help him sort the jobs that must be finished before 1 November.",
        ],
        "pike.response",
    )
    if action == 0:
        state.pike_result = "direct"
        say("Pike", "Right. Bad news, but right.")
        state.consequences.append("Pike remembers the honest answer.")
    elif action == 1:
        state.pike_result = "misled"
        say("Pike", "You think? ...All right. Tell Abigail I asked.")
        state.consequences.append("Pike received false reassurance.")
    else:
        if state.time + 2 > 7:
            state.time = 7
            state.pike_result = "help_interrupted"
            scene("You start sorting. The evening bell cuts through the room.")
            state.consequences.append("Pike's sorting help was interrupted by the procession.")
            return
        state.time += 2
        state.pike_result = "helped"
        scene(
            "You separate deeds, licenses, and court forms from scrap. The pile that "
            "must be finished before November is larger than Pike expected."
        )
        say("Pike", "That's half my desk.")
        state.consequences.append("Helped Pike prepare work before the Act begins.")

    state.evidence.add("legal_proof")
    state.concepts.add("internal_tax")
    designer_note(
        state.designer,
        "The document comparison guarantees the Stamp Act carrier. The human choice "
        "changes trust, time, and later reaction—not whether the player learns.",
    )


def resolve_handoff(state: State) -> None:
    state.stops_done.add("carrier")
    state.time += 1
    title("SOUTH-ROAD CARRIER")
    if state.time > 6:
        state.handoff_variation = "DEADLINE_MISSED"
        state.handoff = "missed"
        state.handbills_custody = "player"
        state.consequences.append("Missed the south-road carrier.")
        scene(
            "The hitching post is empty. Wheel marks run south through the wet dirt. "
            "The carrier left at the bell; the handbills are still yours."
        )
        return

    state.watcher_present = outcome_bucket(state.seed, "watcher-present") < 6200
    if not state.watcher_present:
        state.handoff_variation = "NO_ACTION"
        scene(
            "The carrier is tying down the last bundle. Nobody is paying much attention."
        )
        choose(
            "Complete the handoff.",
            ["Pass over Abigail's bundle and take the carrier's receipt."],
            "handoff.ordinary.complete",
        )
        state.handoff = (
            "delivered_damaged"
            if state.handbills_condition in {"creased", "watermarked"}
            else "delivered_unseen"
        )
        state.handbills_custody = "carrier"
        return

    state.handoff_variation = "ROYAL_OFFICE_WATCHER"
    scene(
        "The carrier is ready—but a royal-office customer is leaning beside the pump, "
        "watching every bundle change hands. The handbills are public, not illegal. "
        "Being recognized could still cost Abigail government work."
    )
    options = [
        "Hand the bundle over openly before the carrier leaves.",
        "Wrap it inside ordinary work and make the handoff while the carrier turns.",
        "Wait for the watcher to move. Risk the bell.",
    ]
    if state.gate_access:
        options.append(
            "Use Thomas's rear gate, cross the cart and low shed, and reach the far side."
        )
    action = choose("How do you try it?", options, "handoff.watcher.approach")

    if action == 0:
        state.handoff = "delivered_recognized"
        state.handbills_custody = "carrier"
        state.watcher_recognized = True
        scene("The bundle makes it. The watcher reads Abigail's seal and watches you leave.")
    elif action == 1:
        roll = outcome_bucket(state.seed, "wrapped-handoff")
        already_obvious = state.handbills_condition == "watermarked"
        if roll < 2000 or already_obvious:
            state.handoff = "delivered_recognized"
            state.handbills_custody = "carrier"
            state.watcher_recognized = True
            scene(
                "The carrier has it—but one handbill edge slips from the wrap. The "
                "watcher sees Abigail's seal before you can tuck it back."
            )
        else:
            state.handoff = "delivered_unseen"
            state.handbills_custody = "carrier"
            scene("One turn, one grip, and the bundle disappears under the carrier's tarp.")
    elif action == 2:
        state.time = min(7, state.time + 2)
        if state.time > 6:
            state.handoff = "missed"
            state.handbills_custody = "player"
            scene(
                "The watcher finally leaves. The carrier leaves first. You still have "
                "the bundle."
            )
        else:
            state.handoff = "delivered_unseen"
            state.handbills_custody = "carrier"
            scene("The pump clears. You make the handoff with one bell-stroke left.")
    else:
        scene(
            "You cut through Thomas's yard, climb the braced cart, and reach the shed "
            "roof. One plank bows under your foot."
        )
        roof = choose(
            "You can see the carrier below. The watcher cannot see the far wall yet.",
            [
                "Lower the bundle first, then cross slowly.",
                "Keep the bundle tight and move before the watcher turns.",
            ],
            "handoff.roof.execution",
        )
        roll = outcome_bucket(state.seed, f"roof-handoff:{roof}")
        if roof == 0:
            state.time = min(7, state.time + 1)
            if roll < 1000:
                state.handbills_condition = "creased"
                state.handoff = "delivered_damaged"
                state.handbills_custody = "carrier"
                scene("The cord slips. The bundle lands hard—but beside the carrier.")
            else:
                state.handoff = "delivered_unseen"
                state.handbills_custody = "carrier"
                scene("Bundle down. Three careful steps. You drop behind the far wall.")
        elif roll < 3000:
            state.handoff = "delivered_recognized"
            state.handbills_custody = "carrier"
            state.watcher_recognized = True
            scene(
                "A roof tile snaps. The watcher looks up as you drop. The carrier has "
                "the handbills, but your route is no secret."
            )
        else:
            state.handoff = "delivered_unseen"
            state.handbills_custody = "carrier"
            scene("You cross before the plank settles and drop beside the carrier.")

    if state.handoff == "missed":
        state.consequences.append("Missed the south-road carrier.")
    elif state.handoff == "delivered_recognized":
        state.consequences.append("Handbills delivered; Abigail's shop was recognized.")
    elif state.handoff == "delivered_damaged":
        state.consequences.append("Handbills delivered damaged.")
    else:
        state.consequences.append("Handbills delivered without recognition.")


def close_unfinished_at_dusk(state: State, *, quiet: bool = False) -> None:
    """History starts on schedule; unfinished Job objects remain unfinished."""
    state.time = min(state.time, 7)
    state.event_start_time = 7
    remaining = {"thomas", "pike", "carrier"} - state.stops_done
    if not remaining:
        return
    if not quiet:
        scene(
            "The evening bell starts. The crowd under the elm moves before your route "
            "is finished. History does not wait."
        )
    if "thomas" in remaining:
        state.stops_done.add("thomas")
        state.circular_custody = "player"
        state.consequences.append("Thomas's circular returned undelivered.")
    if "pike" in remaining:
        state.stops_done.add("pike")
        state.proof_custody = "player"
        state.pike_result = "missed"
        state.consequences.append("Pike's proof returned undelivered.")
    if "carrier" in remaining:
        state.stops_done.add("carrier")
        state.handoff = "missed"
        state.handbills_custody = "player"
        state.handoff_variation = "DEADLINE_MISSED"
        state.consequences.append("Missed the south-road carrier.")


def run_deliveries(state: State) -> None:
    traversal_slots_resolved = len(state.living_slots)
    while len(state.stops_done) < 3:
        available = []
        keys = []
        if "thomas" not in state.stops_done:
            available.append("Thomas Bell — deliver the merchant circular")
            keys.append("thomas")
        if "pike" not in state.stops_done:
            available.append("Pike — return the legal proof")
            keys.append("pike")
        if "carrier" not in state.stops_done:
            urgency = " (the evening bell is close)" if state.time >= 4 else ""
            available.append("South-road carrier — hand off the political print" + urgency)
            keys.append("carrier")

        selected = keys[
            choose(
                "Where do you go next?",
                available,
                f"route.stop.{len(state.stops_done)}",
            )
        ]
        if len(state.stops_done) in {1, 2} and traversal_slots_resolved < 2:
            living_encounter(state, selected)
            traversal_slots_resolved += 1
            checkpoint(state, "deliveries")
            if state.time >= 7:
                close_unfinished_at_dusk(state)
                checkpoint(state, "deliveries_complete")
                break

        if selected == "thomas":
            stop_thomas(state)
        elif selected == "pike":
            stop_pike(state)
        else:
            resolve_handoff(state)
        checkpoint(state, "deliveries")
        if state.time >= 7:
            close_unfinished_at_dusk(state)
            checkpoint(state, "deliveries_complete")
            break
    if state.event_start_time is None:
        state.event_start_time = 7
    checkpoint(state, "deliveries_complete")


def damage_carried_papers(state: State, condition: str = "creased") -> str:
    """Damage only an object still in player custody."""
    if state.handbills_custody == "player":
        state.handbills_condition = condition
        return "the undelivered handbills"
    if state.proof_custody == "player":
        state.proof_condition = condition
        return "Pike's undelivered proof"
    if state.circular_custody == "player":
        state.circular_condition = condition
        return "Thomas's undelivered circular"
    state.source_notes_condition = condition
    return "your source notes"


def protect_carried_papers(state: State) -> str:
    """Wrap only a paper object still in player custody."""
    if state.handbills_custody == "player":
        state.handbills_condition = "wrapped"
        return "the handbills"
    if state.proof_custody == "player":
        state.proof_condition = "wrapped"
        return "Pike's proof"
    if state.circular_custody == "player":
        state.circular_condition = "wrapped"
        return "Thomas's circular"
    state.source_notes_condition = "wrapped"
    return "the source notes"


def crowd_and_history(state: State) -> None:
    title("THE GREAT ELM — DUSK")
    scene(
        "The effigies have hung there since morning. Andrew Oliver. A giant boot for "
        "Lord Bute, with a devil climbing out. Now people are taking them down."
    )
    scene(
        "The street moves all at once. Artisans, laborers, mariners, apprentices, "
        "shoppers, people cheering, people only trying to get home. Your route vanishes."
    )
    action = choose(
        "CROWD PRESSURE — You still have to account for Abigail's work.",
        [
            "Keep the satchel high and move with the crowd until a side lane opens.",
            "Climb a braced cart and cross the low work shed into the alley.",
            "Pull a fallen apprentice up, even if the satchel gets crushed.",
            "Shelter in a doorway and wait for the surge to pass.",
        ],
        "crowd.pressure.action",
    )
    roll = outcome_bucket(state.seed, f"crowd:{action}")
    if action == 0:
        if roll < 2000:
            damaged = damage_carried_papers(state)
            state.crowd_result = "pressed"
            scene(f"A shoulder hits the satchel. You keep your feet; {damaged} do not.")
        else:
            state.crowd_result = "moved_with_crowd"
            scene("You give the street room, keep the bag high, and reach the side lane.")
    elif action == 1:
        if roll < 2500:
            state.crowd_result = "roof_noise"
            scene(
                "The cart holds. The shed board does not. You drop safely into the "
                "alley, loud enough for three people to notice."
            )
        else:
            state.crowd_result = "roof_clear"
            scene("Cart, shed, alley. You're outside the crush before it closes.")
    elif action == 2:
        damaged = damage_carried_papers(state)
        state.crowd_result = "helped_apprentice"
        scene(
            f"You get them upright. Your satchel goes under a boot; {damaged} crease, "
            "but the apprentice gets to the wall."
        )
        state.consequences.append("Helped a fallen apprentice during the surge.")
    else:
        state.time = min(7, state.time + 2)
        state.crowd_result = "boxed_in"
        scene(
            "The doorway protects you, then traps you. You see the procession through "
            "shoulders and smoke as the street carries it away."
        )

    document(
        "FIELD TAG",
        [
            "EBENEZER McINTOSH — SHOEMAKER",
            "Chosen by the Loyal Nine to lead the August 14 action.",
        ],
    )

    title("FIXED HISTORICAL EVENT")
    scene(
        "McIntosh leads the procession toward Oliver's dock. The crowd tears down a "
        "structure believed meant to be a stamp office. At Fort Hill, its timbers and "
        "the effigies feed a bonfire. Later, people break Oliver's windows and damage "
        "his property."
    )
    scene(
        "You cannot start it, stop it, or turn it into another history. You can only "
        "move, protect what is left, help people near you, and remember what you saw."
    )
    designer_note(
        state.designer,
        "Source boundary: this is August 14, not the separate August 26 destruction "
        "of Hutchinson's house. The scene does not claim Samuel Adams ordered the "
        "violence. These are production constraints, not an interruption shown to "
        "the student.",
    )
    state.evidence.add("fixed_protest")
    state.concepts.add("organized_resistance")


def resolve_headline_pair(selected: int, support: int) -> tuple[str, bool]:
    """Return draft model and whether a source-backed correction is required."""
    if (selected, support) == (0, 0):
        return "complete", False
    if (selected, support) == (2, 1):
        return "event_with_cause", False
    if (selected, support) == (1, 0):
        return "cost_only", True
    if (selected, support) == (2, 0):
        return "event_only", True
    return "unsupported", True


def derive_abigail_relationship(state: State) -> str:
    score = 0
    score += {
        "delivered_unseen": 1,
        "delivered_damaged": 0,
        "delivered_recognized": 0,
        "missed": -1,
    }.get(state.handoff, 0)
    score += {
        "direct": 1,
        "helped": 1,
        "delivered_at_bell": 0,
        "help_interrupted": 0,
        "misled": -2,
        "missed": -1,
    }.get(state.pike_result, 0)
    score += 1 if state.publication_result == "cause_complete" else 0
    score -= 1 if state.headline == "unsupported" else 0
    if score >= 2:
        return "increased"
    if score <= -2:
        return "strained"
    return "cautious"


def headline_sync(state: State) -> None:
    title("RETURN — ABIGAIL'S SHOP")
    if state.handoff == "delivered_recognized":
        scene(
            "Abigail hears the result, closes one royal-office account in her ledger, "
            "and ties it shut."
        )
        say("Abigail", "They know whose press it came from.")
    elif state.handoff == "missed":
        scene("You put the unsent handbills back on her bench. She does not pretend otherwise.")
        say("Abigail", "Then they didn't go. Put them with the sources.")
    elif state.handoff == "delivered_damaged":
        say("Abigail", "They got there. Next time, dry would be better.")
    else:
        say("Abigail", "Carrier got them? Good.")

    if state.pike_result == "misled":
        scene("A note from Pike arrived ahead of you. Abigail reads it once.")
        say("Abigail", "Don't guess when a man's work is on the line.")

    scene(
        "She drops a composing stick beside an empty headline. On the source tray: "
        "the retained Stamp Act shop copy, a reviewed representation excerpt, the "
        "proof if it returned, and the source notes that survived the street."
    )
    say("Abigail", "You saw it. Set the line.")

    if state.headline_selected_index is None:
        state.headline_selected_index = choose(
            "EMBEDDED ARCHIVE SYNC — Choose the headline, then pull the proof.",
            [
                "NO STAMPS WITHOUT A COLONIAL VOICE",
                "STAMP TAX WILL RAISE THE PRICE OF PAPER",
                "EFFIGIES BURN AS CROWD ATTACKS OLIVER PROPERTY",
                "BOSTON REJECTS BRITAIN AND DEMANDS INDEPENDENCE",
            ],
            "headline.draft",
        )
        checkpoint(state, "headline_draft")
    selected = state.headline_selected_index
    support_options = {
        0: [
            "Parliament set an internal tax while the colonies had no representatives there.",
            "The crowd burned Oliver's effigy at Fort Hill.",
        ],
        1: [
            "Newspapers and legal forms will require paid stamped paper.",
            "Everyone in Boston already wants independence.",
        ],
        2: [
            "The procession destroyed the suspected stamp office and damaged property.",
            "The tax was set without colonial representatives in Parliament.",
        ],
        3: [
            "Use the day's evidence—none of it supports an independence demand in 1765.",
            "Print it without a source.",
        ],
    }
    if state.headline_support_index is None:
        state.headline_support_index = choose(
            "Set one supporting line beneath it.",
            support_options[selected],
            "headline.support",
        )
        checkpoint(state, "headline_support")
    support = state.headline_support_index
    state.headline_support = f"{selected}:{support}"
    state.headline, correction_required = resolve_headline_pair(selected, support)

    if state.headline in {"complete", "event_with_cause"}:
        say("Abigail", "That tells them why.")
    elif state.headline == "cost_only":
        say("Abigail", "True. Not the whole fight.")
    elif state.headline == "event_only":
        say("Abigail", "That's tonight. What started it?")
    else:
        say("Abigail", "Show me the source.")
        scene("The source does not support that line. She slides the evidence back.")

    if correction_required:
        say("Abigail", "Set the cause under it before we print.")
        choose(
            "Your first draft remains recorded. Add the source-backed line.",
            [
                "Parliament set an internal tax while the colonies had no "
                "representatives there."
            ],
            "headline.correction",
        )
        state.publication_result = "editorial_correction_complete"
        state.consequences.append("Draft required a source-backed correction before print.")
    else:
        state.publication_result = "cause_complete"

    scene(
        "You lock the corrected type, ink it, lay the sheet, and pull. The press "
        "answers with one hard wooden knock."
    )
    state.concepts.add("representation_retrieved")
    document("FIELD RECORD UPDATED", ["Mission Day 1 interpretation captured."])
    state.abigail_relationship = derive_abigail_relationship(state)


def end_report(state: State) -> None:
    title("MISSION DAY 1 COMPLETE")
    print(f"\nAttempt seed: {state.seed}")
    print(f"Carrier handoff: {state.handoff}")
    print(
        f"Handbills: custody={state.handbills_custody}, "
        f"condition={state.handbills_condition}"
    )
    print(f"Legal proof: custody={state.proof_custody}, condition={state.proof_condition}")
    print(f"Circular custody: {state.circular_custody}")
    print(f"Source notes: {state.source_notes_condition}")
    print(f"Living Encounter slots: {', '.join(state.living_slots)}")
    print(f"Handoff variation: {state.handoff_variation}")
    print(f"Thomas gate: {'earned' if state.gate_access else 'not earned'}")
    print(f"Pike result: {state.pike_result}")
    print(f"Crowd result: {state.crowd_result}")
    print(f"Headline draft model: {state.headline}")
    print(f"Publication result: {state.publication_result}")
    print(f"Abigail relationship: {state.abigail_relationship}")
    print("\nPersistent consequences:")
    for item in state.consequences or ["None beyond the common historical state."]:
        print("  • " + item)
    print("\nRequired learning reached:")
    print("  • French and Indian War debt led Britain to seek revenue.")
    print("  • The Stamp Act taxed covered paper used inside the colonies.")
    print("  • The deeper dispute involved taxation without colonial representation.")
    print("  • Resistance was organized, but people differed over methods and order.")
    print("\nFixed history reached:")
    print("  • August 14 effigies, procession, suspected stamp-office destruction,")
    print("    Fort Hill bonfire, and attack on Oliver's property.")
    print("\nYour Job consequences remain different. The required history does not.")


def validate_invariance() -> None:
    """Validate real simulator transition helpers; not a package/model-checking claim."""

    # Every headline/support pair uses the same resolver as play. Unsupported or
    # partial drafts require correction before the press can publish.
    headline_checks = 0
    for selected, support in product(range(4), range(2)):
        model, correction = resolve_headline_pair(selected, support)
        headline_checks += 1
        if model in {"complete", "event_with_cause"}:
            assert not correction
        else:
            assert correction

    relationship_states = set()
    for handoff, pike, headline, publication in product(
        ["delivered_unseen", "delivered_recognized", "delivered_damaged", "missed"],
        ["direct", "helped", "misled", "missed"],
        ["complete", "event_with_cause", "cost_only", "event_only", "unsupported"],
        ["cause_complete", "editorial_correction_complete"],
    ):
        state = State(seed=1)
        state.handoff = handoff
        state.pike_result = pike
        state.headline = headline
        state.publication_result = publication
        first = derive_abigail_relationship(state)
        second = derive_abigail_relationship(state)
        assert first == second
        relationship_states.add(first)
    assert relationship_states == {"increased", "cautious", "strained"}

    # Damage follows custody. A transferred handbill bundle cannot be damaged later.
    custody_checks = 0
    for handbill_custody, proof_custody in product(
        ["player", "carrier"], ["player", "pike"]
    ):
        state = State(seed=1)
        state.handbills_custody = handbill_custody
        state.proof_custody = proof_custody
        target = damage_carried_papers(state)
        custody_checks += 1
        if handbill_custody == "player":
            assert target == "the undelivered handbills"
            assert state.handbills_condition == "creased"
        elif proof_custody == "player":
            assert target == "Pike's undelivered proof"
            assert state.proof_condition == "creased"
            assert state.handbills_condition == "intact"
        else:
            assert target == "Thomas's undelivered circular"
            assert state.circular_condition == "creased"
            assert state.handbills_condition == "intact"

    state = State(seed=1)
    state.handbills_custody = "carrier"
    state.proof_custody = "pike"
    state.circular_custody = "thomas"
    assert damage_carried_papers(state) == "your source notes"
    assert state.source_notes_condition == "creased"
    custody_checks += 1

    # Exercise all delivery orders, help choices, and encounter delays through the
    # same dusk rule. Unfinished work remains in player custody; the event starts.
    schedule_checks = 0
    for order, thomas_help, pike_help, encounter_delay in product(
        permutations(["thomas", "pike", "carrier"]),
        [False, True],
        [False, True],
        [0, 1, 2],
    ):
        state = State(seed=1)
        for index, stop in enumerate(order):
            if index == 1:
                state.time += encounter_delay
                if state.time >= 7:
                    close_unfinished_at_dusk(state, quiet=True)
                    break
            state.time += 1
            state.stops_done.add(stop)
            if stop == "thomas":
                state.circular_custody = "thomas"
                if thomas_help:
                    state.time += 2
            elif stop == "pike":
                state.proof_custody = "pike"
                state.pike_result = "helped" if pike_help else "direct"
                if pike_help:
                    state.time += 2
            else:
                if state.time > 6:
                    state.handoff = "missed"
                else:
                    state.handoff = "delivered_unseen"
                    state.handbills_custody = "carrier"
            if state.time >= 7:
                close_unfinished_at_dusk(state, quiet=True)
                break
        close_unfinished_at_dusk(state, quiet=True)
        schedule_checks += 1
        assert state.stops_done == {"thomas", "pike", "carrier"}
        if state.handoff == "missed":
            assert state.handbills_custody == "player"
        if state.pike_result == "missed":
            assert state.proof_custody == "player"
        # Fixed history is outside Job completion and starts at its hard boundary.
        assert state.event_start_time == 7
        assert state.time <= 7

    # Check deterministic uncertainty is reproducible and calibrated so competent,
    # context-suited actions usually work but sometimes fail.
    policies = {
        "cart": ("cart-climb:test", 2000),
        "rain": ("rain-run:test", 2500),
        "wrap": ("wrapped-handoff", 2000),
        "roof_careful": ("roof-handoff:0", 1000),
        "roof_fast": ("roof-handoff:1", 3000),
        "crowd_protect": ("crowd:0", 2000),
        "crowd_roof": ("crowd:1", 2500),
    }
    outcome_checks = 0
    for label, (domain, threshold) in policies.items():
        first = [outcome_bucket(seed, domain) for seed in range(4096)]
        second = [outcome_bucket(seed, domain) for seed in range(4096)]
        assert first == second, label
        failures = sum(value < threshold for value in first)
        rate = failures / len(first)
        expected = threshold / 10_000
        assert 0 < failures < len(first), label
        assert abs(rate - expected) < 0.035, (label, rate, expected)
        assert threshold <= 3000, (label, threshold)
        outcome_checks += len(first)

    # Backend checkpoint round-trip preserves the 128-bit seed, phase, committed
    # object/consequence state, relationship inputs, and every future outcome draw.
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "day1.json"
        before = State(seed=2**127 + 1765)
        before.phase = "headline_support"
        before.stops_done = {"thomas", "pike", "carrier"}
        before.handbills_custody = "carrier"
        before.handbills_condition = "creased"
        before.handoff = "delivered_recognized"
        before.watcher_recognized = True
        before.headline_selected_index = 2
        before.headline_support_index = 1
        before.consequences.append("Committed test consequence.")
        save_state(path, before)
        after = load_state(path)
        assert asdict(before) == asdict(after)
        for domain, _threshold in policies.values():
            assert outcome_bucket(before.seed, domain) == outcome_bucket(after.seed, domain)

        # A choice commits against the last stable outcome checkpoint. Transient
        # mutations are not serialized; recovery replays the exact saved choice and
        # deterministic OutcomePolicy, then commits the resulting consequence once.
        baseline = State(seed=2**126 + 14)
        baseline.phase = "deliveries"
        baseline.time = 2
        save_state(path, baseline)
        transient = load_state(path)
        transient.time = 6  # uncommitted in-action mutation
        persist_committed_choice(transient, "test.mechanic.choice", 1, path)
        recovered = load_state(path)
        assert recovered.time == 2
        assert recovered.committed_choices["test.mechanic.choice"] == 1
        expected_outcome = outcome_bucket(
            recovered.seed, "test.mechanic.outcome"
        )
        replayed_outcome = outcome_bucket(
            recovered.seed, "test.mechanic.outcome"
        )
        assert expected_outcome == replayed_outcome
        recovered.handoff = "delivered_recognized"
        recovered.watcher_recognized = True
        checkpoint_path = Path(directory) / "committed.json"
        save_state(checkpoint_path, recovered)
        committed = load_state(checkpoint_path)
        assert committed.handoff == "delivered_recognized"
        assert committed.watcher_recognized

    print(
        "PASS: simulator transition validation "
        f"({headline_checks} headline pairs, {custody_checks} custody states, "
        f"{schedule_checks} schedules, {outcome_checks} deterministic outcome draws)."
    )
    print(
        "PASS: no unsupported draft publishes, transferred objects cannot be damaged, "
        "dusk does not wait, and suitable actions usually work."
    )
    print(
        "PASS: backend checkpoints preserve exact committed choices/state and cannot "
        "reroll outcomes."
    )
    print("NOTE: this validates the text simulator only; it is not package certification.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, help="fixed deterministic attempt seed")
    parser.add_argument("--designer", action="store_true", help="show design notes")
    parser.add_argument("--validate", action="store_true", help="validate outcome matrix")
    parser.add_argument("--new", action="store_true", help="discard the current auto-save")
    parser.add_argument(
        "--save-path",
        type=Path,
        default=Path("sim/.state/boston_day1.json"),
        help=argparse.SUPPRESS,
    )
    return parser.parse_args()


def main() -> None:
    global ACTIVE_SAVE_PATH, ACTIVE_STATE
    args = parse_args()
    if args.validate:
        validate_invariance()
        return
    ACTIVE_SAVE_PATH = args.save_path
    if args.new and ACTIVE_SAVE_PATH.exists():
        ACTIVE_SAVE_PATH.unlink()
    if ACTIVE_SAVE_PATH.exists():
        state = load_state(ACTIVE_SAVE_PATH)
        state.designer = args.designer
    else:
        seed = args.seed if args.seed is not None else secrets.randbits(128)
        state = State(seed=seed, designer=args.designer)
        checkpoint(state)
    ACTIVE_STATE = state

    if state.phase == "new":
        opening(state)
        checkpoint(state, "opening_complete")
    if state.phase == "opening_complete":
        continue_prompt()
        checkpoint(state, "deliveries")
    if state.phase == "deliveries":
        run_deliveries(state)
    if state.phase == "deliveries_complete":
        continue_prompt()
        crowd_and_history(state)
        checkpoint(state, "history_complete")
    if state.phase in {"history_complete", "headline_draft", "headline_support"}:
        continue_prompt()
        headline_sync(state)
        checkpoint(state, "headline_complete")
    end_report(state)
    if ACTIVE_SAVE_PATH.exists():
        ACTIVE_SAVE_PATH.unlink()


if __name__ == "__main__":
    main()
