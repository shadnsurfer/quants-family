#!/usr/bin/env bash
# session-start.sh — SessionStart hook. stdout is injected as context at the top of the session.
# This makes the autonomous loop resilient to restarts, /clear, and auto-compaction: whenever a
# session (re)starts, Claude is immediately re-oriented to exactly where the build is.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

ACTIVE="$(node -e "process.stdout.write(require('./build/state/progress.json').activeMilestone||'m0-harness')" 2>/dev/null || echo m0-harness)"

echo "=== QUANTS AUTONOMOUS BUILD — SESSION CONTEXT ==="
echo "You are the ORCHESTRATOR for the quants build. Work autonomously; do not ask the human"
echo "for anything unless a *-OK confirm file is the only remaining blocker."
echo ""
echo "Active milestone: ${ACTIVE}"
echo ""
echo "Progress snapshot:"
node -e "const p=require('./build/state/progress.json');for(const [k,v] of Object.entries(p.milestones)){console.log('  '+k+': '+v.status+(v.attempts?(' ('+v.attempts+' attempts)'):''))}" 2>/dev/null || echo "  (progress.json unreadable)"
echo ""
echo "Your loop: read build/MILESTONES.md -> implement the active milestone (dispatch subagents from"
echo ".claude/agents when parallelizable) -> run its verify commands -> yield. The Stop hook re-checks"
echo "and will send you back if anything fails. Read PROJECT.md (the full quants spec) for product truth."
echo ""
echo "Human-visible test surfaces once built: dashboard http://localhost:4321 , dry-run feeds"
echo "http://localhost:4321/feeds . Keep them working after every milestone."
echo "=== END SESSION CONTEXT ==="
exit 0
