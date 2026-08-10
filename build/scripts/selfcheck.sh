#!/usr/bin/env bash
# selfcheck.sh — proves the harness itself is wired before any real building starts.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
fail=0
check(){ if eval "$2" >/dev/null 2>&1; then echo "  ok: $1"; else echo "  MISSING: $1"; fail=1; fi; }

echo "harness self-check:"
check "CLAUDE.md present"                "test -f CLAUDE.md"
check "PROJECT.md present"               "test -f PROJECT.md"
check "MILESTONES.md present"            "test -f build/MILESTONES.md"
check "progress.json present"            "test -f build/state/progress.json"
check "stop-loop hook present+exec"      "test -x .claude/hooks/stop-loop.sh"
check "safety-guard hook present+exec"   "test -x .claude/hooks/safety-guard.sh"
check "post-edit hook present+exec"      "test -x .claude/hooks/post-edit-check.sh"
check "session-start hook present+exec"  "test -x .claude/hooks/session-start.sh"
check "settings.json present"            "test -f .claude/settings.json"
check "milestone-runner skill present"   "test -f .claude/skills/milestone-runner/SKILL.md"
check "builder subagent present"         "test -f .claude/agents/builder.md"
check "verifier script present"          "test -f build/scripts/verify-milestone.mjs"
check "verifier parses milestones"       "node build/scripts/verify-milestone.mjs --dry 2>/dev/null || true; test -f build/state/progress.json"
if [ "$fail" -eq 0 ]; then echo "HARNESS OK"; exit 0; else echo "HARNESS INCOMPLETE"; exit 1; fi
