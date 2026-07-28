#!/bin/bash
# One worker per worktree.
#
# The lane guard enforces path -> lane. It does NOT stop two workers running in the
# SAME lane, and that is the failure that actually destroyed work: a determinism
# worker and a ladder worker were both live in `mission-world`, and an interrupt
# told one to "commit everything", which swept the other's in-progress files into a
# stray commit. It was recovered by luck and a conscientious worker.
#
# This also makes lane ACTIVITY tracked rather than remembered. `--status` is the
# answer to "which lanes are busy right now", which the orchestrator otherwise
# holds only in context and loses on compaction.
#
# Fails OPEN: a lock bug must not be able to stop work being dispatched.

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/locks"
STALE_MIN=${LANE_LOCK_STALE_MIN:-120}

mkdir -p "$DIR" 2>/dev/null || true

allow() { echo '{ "permission": "allow" }'; exit 0; }

now() { date +%s; }

lane_of() { # read a worktree lane out of arbitrary text
  printf '%s' "$1" | grep -o 'project-archive-worktrees/[a-zA-Z0-9._-]\+' | head -1 | cut -d/ -f2
}

is_stale() { # lockfile
  local ts; ts=$(head -1 "$1" 2>/dev/null)
  [[ -z "$ts" ]] && return 0
  (( ( $(now) - ts ) / 60 >= STALE_MIN ))
}

case "${1:-}" in
  --status)
    found=0
    for f in "$DIR"/*.lock; do
      [[ -e "$f" ]] || continue
      lane=$(basename "$f" .lock); ts=$(head -1 "$f"); age=$(( ( $(now) - ts ) / 60 ))
      state="ACTIVE"; is_stale "$f" && state="STALE"
      printf '  %-22s %s  %dm  %s\n' "$lane" "$state" "$age" "$(sed -n 2p "$f")"
      found=1
    done
    [[ $found -eq 0 ]] && echo "  (no lanes locked)"
    exit 0 ;;
  --release)
    [[ -n "${2:-}" ]] && rm -f "$DIR/$2.lock" && echo "released $2"
    exit 0 ;;
  --release-all)
    rm -f "$DIR"/*.lock 2>/dev/null; echo "all lane locks released"; exit 0 ;;
  --selftest)
    fail=0; T=$(mktemp -d); DIR="$T/locks"; mkdir -p "$DIR"
    p='work in /Users/ramsarma/Projects/project-archive-worktrees/mission-world and do things'
    got=$(printf '{"prompt":%s}' "$(printf '%s' "$p" | jq -Rs .)" | DIR_OVERRIDE="$DIR" "${BASH_SOURCE[0]}" start | jq -r .permission)
    [[ "$got" == allow ]] && echo "  PASS  first worker into a free lane -> allow" || { echo "  FAIL  first worker got $got"; fail=1; }
    got=$(printf '{"prompt":%s}' "$(printf '%s' "$p" | jq -Rs .)" | DIR_OVERRIDE="$DIR" "${BASH_SOURCE[0]}" start | jq -r .permission)
    [[ "$got" == deny ]] && echo "  PASS  second worker into a busy lane -> deny" || { echo "  FAIL  second worker got $got"; fail=1; }
    printf '{"prompt":%s}' "$(printf '%s' "$p" | jq -Rs .)" | DIR_OVERRIDE="$DIR" "${BASH_SOURCE[0]}" stop >/dev/null
    got=$(printf '{"prompt":%s}' "$(printf '%s' "$p" | jq -Rs .)" | DIR_OVERRIDE="$DIR" "${BASH_SOURCE[0]}" start | jq -r .permission)
    [[ "$got" == allow ]] && echo "  PASS  lane reusable after stop -> allow" || { echo "  FAIL  after stop got $got"; fail=1; }
    got=$(printf '{"prompt":"no worktree mentioned here"}' | DIR_OVERRIDE="$DIR" "${BASH_SOURCE[0]}" start | jq -r .permission)
    [[ "$got" == allow ]] && echo "  PASS  unparseable lane -> fail open" || { echo "  FAIL  unparseable got $got"; fail=1; }
    rm -rf "$T"
    [[ $fail -eq 0 ]] && echo "lane-lock selftest: OK" || echo "lane-lock selftest: FAILED"
    exit $fail ;;
esac

[[ -n "${DIR_OVERRIDE:-}" ]] && DIR="$DIR_OVERRIDE"
command -v jq >/dev/null 2>&1 || allow

mode="${1:-start}"
input=$(cat 2>/dev/null) || allow
[[ -n "$input" ]] || allow

text=$(printf '%s' "$input" | jq -r '[.prompt?, .description?, .arguments?|tostring] | map(select(type=="string")) | join(" ")' 2>/dev/null) || allow
lane=$(lane_of "$text")
[[ -n "$lane" ]] || allow   # no worktree named: can't police it, don't block it

lock="$DIR/$lane.lock"

if [[ "$mode" == "stop" ]]; then
  rm -f "$lock"
  echo '{}'
  exit 0
fi

if [[ -f "$lock" ]] && ! is_stale "$lock"; then
  msg="LANE LOCK: '$lane' already has a worker running (started $(( ( $(now) - $(head -1 "$lock") ) / 60 ))m ago). Two workers in one worktree already destroyed a worker's edits on this project - an interrupt told one to commit everything and it swept the other's in-progress files. Wait for it, resume it instead of starting a sibling, or use a different lane. Run .cursor/hooks/lane-lock.sh --status to see what is live."
  reason=$(printf '%s' "$msg" | jq -Rs .)
  printf '{ "permission": "deny", "user_message": %s, "agent_message": %s }\n' "$reason" "$reason"
  exit 0
fi

{ now; printf '%s\n' "$(printf '%s' "$text" | head -c 120 | tr '\n' ' ')"; } > "$lock" 2>/dev/null
allow
