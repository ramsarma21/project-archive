#!/bin/bash
# Lane guard: refuse a file write that belongs to another lane, or to the owner's
# playable checkout.
#
# Two incidents this project already paid for:
#   - two lanes editing the same authoring destroyed a worker's edits (27 Jul)
#   - a crossed interrupt swept a sibling's uncommitted work into a stray commit
#
# Ownership was declared in prose and in task briefs, and neither is enforcement.
# This is.
#
# Fails OPEN by design. A guard bug must not be able to halt all work, so a parse
# failure or a missing map allows the write. That means a silently broken guard is
# possible: the standing audit loop re-tests it, and `--selftest` exists for that.
#
# WHAT `--selftest` CANNOT TELL YOU, measured from the hooks log on 29 Jul. This
# guard's logic is correct and it does return verdicts (89 completed runs, 87
# allow, 2 correct deny). It nevertheless protects only a MINORITY of writes:
#   - 148 further invocations were CANCELLED at 0 ms with no verdict, and they
#     split by session — foreground calls complete, whole background-subagent
#     conversations abort and fall open. Most lane work is background subagents.
#   - `Shell` is not in the hook matcher (`Write|StrReplace|Delete|EditNotebook`),
#     so any edit made through python, sed, a heredoc, cp or a redirect fires no
#     hook at all and does not even appear in the log. A shell command carries no
#     file path to inspect, so this one is structural, not a bug to fix.
# Prevention is therefore not available here; DETECTION is the enforcement point.
# `scripts/check-lane-integrity.mjs` reads the same map out of git state after the
# fact and catches both holes. Keep this guard — it is free and it works for
# foreground writes — but do not treat a green selftest as coverage. A mechanism's
# own selftest cannot tell you whether it runs in production.

set -uo pipefail

MAP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/lane-ownership.json"

allow() { echo '{ "permission": "allow" }'; exit 0; }

deny() {
  # jq -Rs to make the reason a valid JSON string whatever it contains.
  local reason; reason=$(printf '%s' "$1" | jq -Rs .)
  printf '{ "permission": "deny", "agent_message": %s, "user_message": %s }\n' "$reason" "$reason"
  exit 0
}

if [[ "${1:-}" == "--selftest" ]]; then
  fail=0
  t() { # path, lane, expect(allow|deny)
    local got
    got=$(printf '{"tool_input":{"path":"%s"}}' "$1" | LANE_OVERRIDE="$2" "${BASH_SOURCE[0]}" | jq -r .permission)
    if [[ "$got" == "$3" ]]; then echo "  PASS  $3  $2 -> $1"; else echo "  FAIL  want $3 got $got  $2 -> $1"; fail=1; fi
  }
  W=/Users/ramsarma/Projects/project-archive-worktrees
  # Ownership invariant, tested on an engine-world file no transient grant touches,
  # so retiring a grant cannot silently break this case (a grant CAN and does
  # override ownership — see the module.json grant to module-lesson below — so the
  # structural test must stand on a path outside every grant).
  t "$W/mission-world/packages/engine-world/src/contact.ts" mission-world allow
  t "$W/mission-flow/packages/engine-world/src/contact.ts" mission-flow deny
  t "$W/mission-flow/apps/web/public/world/props/liberty-elm-hero.glb" mission-flow allow
  t "$W/boss-fight/content/m1/duel-items.json" boss-fight allow
  t "$W/boss-fight/packages/engine-world/src/contact.ts" boss-fight deny
  t "$W/world-audit/packages/mission-m1/src/level/route.ts" world-audit deny
  t "/Users/ramsarma/Projects/project-archive/packages/engine-world/src/contact.ts" main deny
  t "/Users/ramsarma/Projects/project-archive/docs/process/M1-STATUS.md" main allow
  t "$W/mission-cinematic/apps/web/src/mission/duelPort.ts" mission-cinematic allow
  t "$W/mission-cinematic/apps/web/src/mission/traversal.ts" mission-cinematic deny
  # A lane owns its own tree, and only its own.
  t "$W/module-lesson/apps/web/src/module/ModulePlayer.tsx" module-lesson allow
  t "$W/duel-hud/apps/web/src/module/ModulePlayer.tsx" duel-hud deny
  # A grant OVERRIDES ownership, in both directions: content/** is boss-fight's,
  # but while module.json is granted to module-lesson that lane may write it and
  # boss-fight may not. These two cases are the grant mechanism itself, so they
  # must be re-pointed at a LIVE grant whenever one is retired, never deleted.
  t "$W/module-lesson/content/m1/module.json" module-lesson allow
  t "$W/boss-fight/content/m1/module.json" boss-fight deny
  # A grant also overrides CONTESTED, which is the other half of the mechanism:
  # DuelOverlay.tsx and duel.css are denied to every lane by default, and while
  # they are granted to duel-hud that lane may write them and no other may. Same
  # re-pointing rule as above — retiring this grant means moving these cases to a
  # live one, not deleting them.
  t "$W/duel-hud/apps/web/src/duel/DuelOverlay.tsx" duel-hud allow
  t "$W/duel-hud/apps/web/src/duel/duel.css" duel-hud allow
  t "$W/boss-fight/apps/web/src/duel/duel.css" boss-fight deny
  t "$W/mission-cinematic/apps/web/src/duel/DuelOverlay.tsx" mission-cinematic deny
  # Retiring a grant must hand the file BACK, and these two pin that it did.
  # collision.ts returns to mission-world's ownership (camera-occluder's grant
  # retired 2026-07-29, work merged at d457081); MissionHud.tsx returns to
  # contested, so the lane that held it is refused it like everyone else
  # (mission-flow's elm-beat grant retired 2026-07-29, merged at 2c27d6a).
  t "$W/mission-world/packages/engine-world/src/collision.ts" mission-world allow
  t "$W/mission-flow/apps/web/src/mission/MissionHud.tsx" mission-flow deny
  t "$W/mission-cinematic/apps/web/src/mission/MissionHud.tsx" mission-cinematic deny
  [[ $fail -eq 0 ]] && echo "lane-guard selftest: OK" || echo "lane-guard selftest: FAILED"
  exit $fail
fi

command -v jq >/dev/null 2>&1 || allow
[[ -f "$MAP" ]] || allow

input=$(cat 2>/dev/null) || allow
[[ -n "$input" ]] || allow

# The edit tools spell the target differently; take the first that looks like a path.
target=$(printf '%s' "$input" | jq -r '
  [ .tool_input.path?, .tool_input.file_path?, .tool_input.target_notebook?,
    .path?, .file_path?, .arguments.path? ]
  | map(select(type == "string" and (startswith("/"))))
  | first // empty' 2>/dev/null) || allow
[[ -n "$target" ]] || allow

lane="${LANE_OVERRIDE:-}"
if [[ -z "$lane" ]]; then
  if [[ "$target" == */project-archive-worktrees/* ]]; then
    lane="${target#*/project-archive-worktrees/}"; lane="${lane%%/*}"
  elif [[ "$target" == */Projects/project-archive/* ]]; then
    lane="main"
  else
    allow   # outside the project: not ours to police
  fi
fi

# Path relative to the checkout root.
if [[ "$lane" == "main" ]]; then
  rel="${target#*/Projects/project-archive/}"
else
  rel="${target#*/project-archive-worktrees/"$lane"/}"
fi

matches_any() { # rel, json-array-of-globs
  printf '%s' "$2" | jq -r '.[]' 2>/dev/null | while read -r glob; do
    [[ -n "$glob" ]] || continue
    # shellcheck disable=SC2053
    if [[ "$1" == $glob ]]; then echo yes; return; fi
    # `**` should span directories, which bash globs only do loosely here.
    if [[ "$glob" == *'**'* ]]; then
      local prefix="${glob%%\**}"
      [[ "$1" == "$prefix"* ]] && { echo yes; return; }
    fi
  done | grep -q yes
}

if [[ "$lane" == "main" ]]; then
  denied=$(jq -c '.mainCheckoutDenied' "$MAP" 2>/dev/null) || allow
  if matches_any "$rel" "$denied"; then
    deny "LANE GUARD: refusing to write $rel in the MAIN checkout. The owner plays there (web :5173, api :3001) and edits land under his feet. Work in /Users/ramsarma/Projects/project-archive-worktrees/<lane> on branch workflow/<lane>. See docs/process/LANES.md."
  fi
  allow
fi

# Grants come first: a grant is an explicit, temporary, exclusive claim the
# orchestrator made, so it OVERRIDES both contested and another lane's ownership.
# Granted to this lane -> allow. Granted to another lane -> deny (the grant is the
# whole reason this file is off-limits to everyone else right now). Reported on by
# scripts/check-lane-integrity.mjs.
grant_lanes=$(jq -r '.grants // [] | .[].lane' "$MAP" 2>/dev/null | sort -u)
for gl in $grant_lanes; do
  gpaths=$(jq -c --arg l "$gl" '[.grants[] | select(.lane==$l) | .paths[]]' "$MAP" 2>/dev/null)
  if matches_any "$rel" "$gpaths"; then
    if [[ "$gl" == "$lane" ]]; then
      allow
    else
      greason=$(jq -r --arg l "$gl" 'first(.grants[] | select(.lane==$l) | .reason) // "no reason recorded"' "$MAP" 2>/dev/null)
      deny "LANE GUARD: $rel is GRANTED to lane '$gl' right now, not '$lane'. The orchestrator handed this file to '$gl' temporarily (reason: $greason). Editing it from another lane is exactly the clobber the grant exists to stop. Report what you need. See docs/process/LANES.md."
    fi
  fi
done

contested=$(jq -c '.contested // []' "$MAP" 2>/dev/null) || allow
if matches_any "$rel" "$contested"; then
  deny "LANE GUARD: $rel is CONTESTED - shared by several lanes and owned by none. Editing it in parallel is how work gets clobbered. Report what you need and let the orchestrator sequence it, or ask to be given the file explicitly (a grant). See docs/process/LANES.md."
fi

owned=$(jq -c --arg l "$lane" '.lanes[$l] // empty' "$MAP" 2>/dev/null) || allow
[[ -n "$owned" ]] || allow   # unknown lane: not enough information to refuse

# Anything no lane claims is open; only refuse a path another lane owns.
claimed_by=$(jq -r --arg l "$lane" '.lanes | to_entries[] | select(.key != $l) | .key' "$MAP" 2>/dev/null)

if matches_any "$rel" "$owned"; then allow; fi

for other in $claimed_by; do
  globs=$(jq -c --arg o "$other" '.lanes[$o]' "$MAP" 2>/dev/null)
  if matches_any "$rel" "$globs"; then
    deny "LANE GUARD: $rel belongs to lane '$other', not '$lane'. Two lanes editing one file already destroyed a worker's edits on this project. Stop and report what you need instead of editing it, or ask the orchestrator to re-assign. See docs/process/LANES.md."
  fi
done

allow
