#!/usr/bin/env bash
# Local stand-in for the 8 GitHub Actions workflows (Actions quota exhausted).
# Mirrors step lists from .github/workflows/*.yml using this machine's PG (:5433, hermes_next_test).
set -uo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
export NODE_ENV="${NODE_ENV:-test}"
export DEV_MOCK_AUTH=false

OUT="${OUT:-/tmp/rc1-local-ci-matrix}"
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
: > "$SUMMARY"
FAILED=0

run_step() {
  local wf="$1" step="$2"; shift 2
  local log="$OUT/$(echo "$wf" | tr ' /' '__')_$(echo "$step" | tr ' /:' '___').log"
  local t0 t1 ec
  printf '## %s · `%s`\n\n' "$wf" "$step" >> "$SUMMARY"
  printf '```bash\n%s\n```\n' "$*" >> "$SUMMARY"
  echo "▶ [$wf] $step"
  t0=$(date +%s)
  if "$@" >"$log" 2>&1; then ec=0; else ec=$?; fi
  t1=$(date +%s)
  if [ "$ec" -eq 0 ]; then
    printf 'Result: **PASS** (%ss) · log: `%s`\n\n' "$((t1-t0))" "$log" >> "$SUMMARY"
    echo "  ✔ PASS ($((t1-t0))s)"
  else
    FAILED=$((FAILED+1))
    printf 'Result: **FAIL** exit=%s (%ss) · log: `%s`\n\n```tail\n%s\n```\n\n' \
      "$ec" "$((t1-t0))" "$log" "$(tail -40 "$log")" >> "$SUMMARY"
    echo "  ✖ FAIL exit=$ec ($((t1-t0))s) → $log"
    tail -30 "$log"
  fi
  return 0
}

{
  echo "# Local CI matrix (8 workflows)"
  echo
  echo "- branch: \`$(git rev-parse --abbrev-ref HEAD)\` @ \`$(git rev-parse --short HEAD)\`"
  echo "- date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "- reason: GitHub Actions quota exhausted on private repo; run equivalent matrix locally."
  echo
} >> "$SUMMARY"

# ── Shared preamble (all workflows) ──────────────────────────────────────────
run_step "shared" "prisma generate" npx prisma generate
run_step "shared" "typecheck" npm run typecheck
run_step "shared" "prisma migrate deploy" npx prisma migrate deploy

# ── Quality CI ───────────────────────────────────────────────────────────────
WF="Quality CI"
run_step "$WF" "test:golden" npm run test:golden
run_step "$WF" "test:potential" npm run test:potential
run_step "$WF" "test:channel-routes" npm run test:channel-routes
run_step "$WF" "test:model-gateway" npm run test:model-gateway
run_step "$WF" "test:model-control" npm run test:model-control
run_step "$WF" "test:model-runtime" npm run test:model-runtime
run_step "$WF" "test:harness" npm run test:harness
run_step "$WF" "test:validation-decision" npm run test:validation-decision
run_step "$WF" "test:decision-intelligence" npm run test:decision-intelligence
run_step "$WF" "test:launch-auth" npm run test:launch-auth
run_step "$WF" "lint" npm run lint
run_step "$WF" "build" env NODE_ENV=production npm run build

# ── Governance CI ────────────────────────────────────────────────────────────
WF="Governance CI"
run_step "$WF" "tsc -p tsconfig.governance.json" npx tsc --noEmit -p tsconfig.governance.json
run_step "$WF" "test:governance" npm run test:governance
run_step "$WF" "test:research-snapshot" npm run test:research-snapshot
run_step "$WF" "test:g3" npm run test:g3
run_step "$WF" "test:g2" npm run test:g2
run_step "$WF" "test:structured" npm run test:structured
run_step "$WF" "test:gate-boundaries" npm run test:gate-boundaries

# ── Workforce / Decision / Autopilot / Experience / Business Event / Golden Org
run_step "Workforce CI" "test:workforce" npm run test:workforce
run_step "Decision CI" "test:decision-run" npm run test:decision-run
run_step "Decision CI" "test:system-principal" npm run test:system-principal
run_step "Autopilot CI" "test:autopilot" npm run test:autopilot
run_step "Experience CI" "test:experience" npm run test:experience
run_step "Business Event CI" "test:business-events" npm run test:business-events
run_step "Golden Organization CI" "test:golden-org" npm run test:golden-org

{
  echo
  if [ "$FAILED" -eq 0 ]; then
    echo "## Verdict: **ALL PASS** (0 failed steps)"
  else
    echo "## Verdict: **$FAILED FAILED step(s)**"
  fi
} >> "$SUMMARY"

echo
echo "=== SUMMARY ==="
rg -n "Result:|Verdict:" "$SUMMARY" || true
echo "full: $SUMMARY"
exit "$FAILED"
