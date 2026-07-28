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
  t "$W/mission-world/packages/engine-world/src/collision.ts" mission-world allow
  t "$W/mission-flow/packages/engine-world/src/collision.ts" mission-flow deny
  t "$W/mission-flow/apps/web/public/world/props/liberty-elm-hero.glb" mission-flow allow
  t "$W/boss-fight/content/m1/duel-items.json" boss-fight allow
  t "$W/boss-fight/packages/engine-world/src/collision.ts" boss-fight deny
  t "$W/world-audit/packages/mission-m1/src/level/route.ts" world-audit deny
  t "/Users/ramsarma/Projects/project-archive/packages/engine-world/src/collision.ts" main deny
  t "/Users/ramsarma/Projects/project-archive/docs/process/M1-STATUS.md" main allow
  t "$W/mission-cinematic/apps/web/src/mission/duelPort.ts" mission-cinematic allow
  t "$W/mission-cinematic/apps/web/src/mission/traversal.ts" mission-cinematic deny
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

contested=$(jq -c '.contested // []' "$MAP" 2>/dev/null) || allow
if matches_any "$rel" "$contested"; then
  deny "LANE GUARD: $rel is CONTESTED - shared by several lanes and owned by none. Editing it in parallel is how work gets clobbered. Report what you need and let the orchestrator sequence it, or ask to be given the file explicitly. See docs/process/LANES.md."
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
