#!/bin/sh
# Stop hook for the local coder (AV_ROLE=coder): don't let the session end with uncommitted work.
# Constitution Principle VIII. Blocks once; if the model stops again (stop_hook_active) it is allowed to, to avoid loops.
[ "$AV_ROLE" = "coder" ] || exit 0
input=$(cat)
case "$input" in *'"stop_hook_active":true'*|*'"stop_hook_active": true'*) exit 0 ;; esac
cd "${CLAUDE_PROJECT_DIR:-.}" 2>/dev/null || exit 0
[ -n "$(git status --porcelain 2>/dev/null)" ] || exit 0
branch=$(git symbolic-ref --short -q HEAD || true)
num=$(printf '%s' "$branch" | sed -n 's/^\([0-9][0-9][0-9]\)-.*/\1/p')
tag="[spec-${num:-NNN}]"
cat <<JSON
{"decision":"block","reason":"You have uncommitted changes. Before stopping, commit them as logical commits (one per task or a few closely related tasks, with the tasks.md checkbox in the same commit). Each message must end with $tag. If tests are failing, still commit but say WIP in the message. Do not create summary files."}
JSON
exit 0
