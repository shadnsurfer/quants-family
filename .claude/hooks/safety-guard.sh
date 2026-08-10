#!/usr/bin/env bash
# safety-guard.sh — Claude Code PreToolUse hook (matcher: Bash).
# Deterministic guardrail: the autonomous loop must never (a) nuke the repo, or
# (b) flip to real-money live mode on its own. Real capital is a human decision.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PAYLOAD="$(cat)"
CMD="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.command||'')}catch{process.stdout.write('')}})" 2>/dev/null)"

block() { printf '%s' "{\"decision\":\"block\",\"reason\":\"$1\"}"; exit 0; }

# 1) Destructive filesystem / git.
if printf '%s' "$CMD" | grep -qiE 'rm -rf (/| ~|\.\.)|:\(\)\{|mkfs|dd if=|git reset --hard|git clean -[a-z]*f'; then
  block "SAFETY: refusing destructive command. If truly needed, the human must run it manually."
fi

# 2) Real-money live mode. The loop builds/tests in paper + dust only.
#    Live requires BOTH the env flip AND the human confirm file GO_LIVE_OK.
if printf '%s' "$CMD" | grep -qiE 'MODE=live|--live|--mainnet-real|--go-live'; then
  if [ ! -f "$ROOT/build/state/GO_LIVE_OK" ]; then
    block "SAFETY: live/real-money mode is blocked. This is the one action the autonomous loop will not take. Charles must complete the M8 readiness checklist and drop build/state/GO_LIVE_OK manually."
  fi
fi

# 3) Dust launches need DUST_OK (spends real, but tiny, funds).
if printf '%s' "$CMD" | grep -qiE 'dust-launch\.mjs'; then
  if [ ! -f "$ROOT/build/state/DUST_OK" ]; then
    # Not a hard block — emit the sentinel the verifier understands, so M5 becomes blocked-waiting-human.
    echo "NO_CONFIRM_FILE: dust launch requires build/state/DUST_OK (funded key). Skipping." 1>&2
    block "WAITING_HUMAN: dust launch needs build/state/DUST_OK + a funded key. Mark M5 blocked-waiting-human and continue with other milestones (M6+)."
  fi
fi

exit 0
