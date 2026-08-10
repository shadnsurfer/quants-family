#!/usr/bin/env bash
# post-edit-check.sh — Claude Code PostToolUse hook (matcher: Edit|Write|MultiEdit).
# After any code edit, run a fast typecheck on the touched workspace and feed results back.
# This is the "check its own work multiple times" mechanism at the edit granularity —
# separate from the milestone verifier which checks at the milestone granularity.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
mkdir -p build/logs

# Read tool payload from stdin (JSON). Extract edited path if present.
PAYLOAD="$(cat)"
FILE="$(printf '%s' "$PAYLOAD" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(j.tool_input?.file_path||j.tool_input?.path||'')}catch{process.stdout.write('')}})" 2>/dev/null)"

# Only react to TS/JS/JSON edits.
case "$FILE" in
  *.ts|*.tsx|*.mjs|*.js|*.json) ;;
  *) exit 0 ;;
esac

# Fast, non-fatal typecheck. Non-blocking: we return context, never exit 2 here (edits already happened).
OUT="$(pnpm -w run typecheck 2>&1 | tail -30)"
if printf '%s' "$OUT" | grep -qiE "error TS|error:"; then
  echo "[$(date -u +%FT%TZ)] typecheck errors after editing $FILE" >> build/logs/post-edit.log
  # Surface to Claude as context so it fixes before proceeding.
  printf '%s' "{\"decision\":\"block\",\"reason\":\"Typecheck failed after editing ${FILE}. Fix these before continuing:\n$(printf '%s' "$OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(s.replace(/[\"\\\\]/g,' ').slice(-1500)))")\"}"
  exit 0
fi
exit 0
