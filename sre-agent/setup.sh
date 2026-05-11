#!/usr/bin/env bash
# SRE Agent v0 — one-shot setup script.
# Idempotent. Re-run any time.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${SRE_PORT:-5060}"

echo "──────────────────────────────────────────────────────────"
echo "  SRE Command Center — v0 setup"
echo "──────────────────────────────────────────────────────────"
echo

# 1. python venv
if [[ ! -d "$HERE/dashboard/.venv" ]]; then
  echo "▶ creating python venv"
  python3 -m venv "$HERE/dashboard/.venv"
fi
echo "▶ installing Flask"
"$HERE/dashboard/.venv/bin/pip" install --quiet -r "$HERE/dashboard/requirements.txt"

# 2. kill any stale instance
if lsof -ti:"$PORT" >/dev/null 2>&1; then
  echo "▶ killing stale instance on :$PORT"
  lsof -ti:"$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# 3. start dashboard
echo "▶ starting dashboard on http://127.0.0.1:$PORT"
nohup "$HERE/dashboard/.venv/bin/python" "$HERE/dashboard/app.py" \
  > /tmp/sre-dashboard.log 2>&1 &
DASH_PID=$!
echo "$DASH_PID" > /tmp/sre-dashboard.pid

# 4. wait until /api/health responds
for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    echo "▶ dashboard ready"
    break
  fi
  sleep 0.5
done

# 5. summary
echo
echo "✓ Dashboard up: http://127.0.0.1:$PORT"
echo "  pid:  $DASH_PID"
echo "  log:  /tmp/sre-dashboard.log"
echo
echo "Open the URL in your browser and click  +FIRE ALERT  to run a demo."
echo
echo "Stop with:   kill \$(cat /tmp/sre-dashboard.pid)"
