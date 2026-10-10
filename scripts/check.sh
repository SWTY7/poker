#!/usr/bin/env bash
# Single check entry point. Copy to scripts/check.sh in a project.
# Used by: Stop hook, merge step, worker self-check, reviewer.
# Usage: scripts/check.sh [--fast]
set -euo pipefail

# ---- CONFIGURE ------------------------------------------------------------
# One entry per step: "name::command". Prefix the name with "slow:" to skip it under --fast.
# Leave empty to auto-detect (python: ruff/pytest, node: npm run lint/typecheck/test).
STEPS=(
  "lint::npm run lint --silent"
  "tests::npm test --silent"
  "slow:build::npm run build --silent"
)
# ---------------------------------------------------------------------------

FAST=0
for a in "$@"; do
  case "$a" in
    --fast) FAST=1 ;;
    *) echo "unknown argument: $a (supported: --fast)" >&2; exit 2 ;;
  esac
done

cd "$(dirname "${BASH_SOURCE[0]}")/.."

PY=""
for c in python3 python; do
  if command -v "$c" >/dev/null 2>&1 && "$c" -c "" >/dev/null 2>&1; then PY="$c"; break; fi
done

detect() {
  if [ -n "$PY" ] && { [ -f pyproject.toml ] || [ -f setup.py ] || [ -f requirements.txt ] || [ -f pytest.ini ] || ls ./*.py >/dev/null 2>&1 || [ -d tests ]; }; then
    if command -v ruff >/dev/null 2>&1; then STEPS+=("lint::ruff check ."); 
    elif "$PY" -m ruff --version >/dev/null 2>&1; then STEPS+=("lint::$PY -m ruff check ."); fi
    if "$PY" -m pytest --version >/dev/null 2>&1; then STEPS+=("tests::$PY -m pytest -q"); fi
  fi
  if [ -f package.json ] && command -v npm >/dev/null 2>&1; then
    local s
    for s in lint typecheck test; do
      if grep -Eq "\"$s\"[[:space:]]*:" package.json; then
        if [ "$s" = test ]; then STEPS+=("tests::npm test --silent"); else STEPS+=("$s::npm run $s --silent"); fi
      fi
    done
  fi
}

if [ "${#STEPS[@]}" -eq 0 ]; then
  echo "== no STEPS configured; auto-detecting =="
  detect
  if [ "${#STEPS[@]}" -eq 0 ]; then
    if [ "${CHECK_ALLOW_UNCONFIGURED:-0}" = 1 ]; then
      echo "CHECK UNCONFIGURED: no checks yet (edit STEPS in scripts/check.sh); allowed because CHECK_ALLOW_UNCONFIGURED=1" >&2
      exit 0
    fi
    echo "CHECK FAILED: no checks configured (edit STEPS in scripts/check.sh)" >&2
    exit 1
  fi
  for s in "${STEPS[@]}"; do echo "  chose: ${s%%::*} -> ${s#*::}"; done
fi

ran=0
for entry in "${STEPS[@]}"; do
  name="${entry%%::*}"
  cmd="${entry#*::}"
  if [ "$FAST" -eq 1 ] && [[ "$name" == slow:* ]]; then
    echo "== SKIP (--fast): ${name#slow:} =="
    continue
  fi
  name="${name#slow:}"
  echo "======== STEP: $name ========"
  echo "\$ $cmd"
  rc=0
  bash -c "$cmd" || rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "CHECK FAILED: $name" >&2
    echo "  command:   $cmd" >&2
    echo "  exit code: $rc" >&2
    exit "$rc"
  fi
  ran=$((ran + 1))
done

if [ "$ran" -eq 0 ]; then
  if [ "$FAST" -eq 1 ]; then
    echo "CHECK PASSED (0 steps; every step is slow: and was skipped under --fast)"
    exit 0
  fi
  echo "CHECK FAILED: no steps ran" >&2
  exit 1
fi
echo "CHECK PASSED ($ran steps)"
