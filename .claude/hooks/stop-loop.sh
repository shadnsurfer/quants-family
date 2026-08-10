#!/usr/bin/env bash
# stop-loop.sh — Claude Code Stop hook. This is the autonomous engine.
#
# Fires when Claude tries to end its turn. It runs the milestone verifier.
#   - verifier exit 0  => build complete (or active milestone truly done AND nothing left) -> ALLOW stop
#   - verifier exit 10 => not done / more milestones remain -> BLOCK stop, inject next instruction
#   - verifier exit 20 => blocked on a human confirm file -> BLOCK unless it's the M8 halt
#
# Blocking is done by emitting {"decision":"block","reason":"..."} on stdout.
# Claude Code caps consecutive blocks (default 8) — we raise it via env in settings.json so long
# builds don't get short-circuited. The verifier's own attempt counter is the real guard against
# infinite failure (see escalate logic below).

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

LOG="build/logs/stop-loop.log"
mkdir -p build/logs
echo "[$(date -u +%FT%TZ)] Stop hook fired" >> "$LOG"

# Run the referee.
OUT="$(node build/scripts/verify-milestone.mjs 2>&1)"
CODE=$?
echo "$OUT" >> "$LOG"
echo "[verifier exit $CODE]" >> "$LOG"

PROGRESS="build/state/progress.json"
ACTIVE="$(node -e "process.stdout.write(require('./build/state/progress.json').activeMilestone||'')" 2>/dev/null)"
ATTEMPTS="$(node -e "const p=require('./build/state/progress.json');process.stdout.write(String(p.milestones[p.activeMilestone]?.attempts||0))" 2>/dev/null)"

# Completion.
if [ "$CODE" -eq 0 ]; then
  echo "[$(date -u +%FT%TZ)] BUILD COMPLETE — allowing stop" >> "$LOG"
  # allow normal stop
  exit 0
fi

# M8 is the intentional human halt.
if [ "$ACTIVE" = "m8-readiness" ] && [ "$CODE" -eq 20 ]; then
  echo "[$(date -u +%FT%TZ)] M8 readiness reached — halting for human by design" >> "$LOG"
  exit 0
fi

# Escalation guard: if the SAME milestone has failed too many times, stop the loop and ask for help
# instead of burning tokens forever. 12 attempts on one milestone => surface to human.
if [ "${ATTEMPTS:-0}" -ge 12 ]; then
  cat <<JSON
{"decision":"block","reason":"ESCALATE: milestone '$ACTIVE' has failed ${ATTEMPTS} times. Stop trying the same approach. Re-read build/logs/stop-loop.log and build/state/progress.json, write a short build/state/BLOCKER-$ACTIVE.md describing the root cause and 2 alternative approaches, then attempt the most promising alternative. Do not repeat prior failing edits verbatim."}
JSON
  exit 0
fi

# Normal case: not done -> block stop and instruct Claude to continue via the milestone-runner skill.
REASON="Build not complete. Active milestone: ${ACTIVE}. The milestone verifier did not pass yet (see below). Continue autonomously: (1) read build/MILESTONES.md for '${ACTIVE}', (2) read build/state/progress.json, (3) if this milestone benefits from parallel work, dispatch subagents per .claude/agents, (4) implement/fix, (5) run the milestone's verify commands yourself before yielding. Do NOT ask the human anything unless a *-OK confirm file is the only blocker. Verifier output follows:\n${OUT}"
# JSON-escape the reason.
node -e '
const r = process.argv[1];
process.stdout.write(JSON.stringify({decision:"block", reason:r}));
' "$REASON"
exit 0
