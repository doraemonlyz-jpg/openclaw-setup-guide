#!/usr/bin/env bash
# setup-dashboard.sh — install + launch the Boss Dashboard.
#
# Reads from ~/.openclaw/ live, no DB. Default port 5050.
#
# Re-runnable: kills any previous dashboard before relaunching.

set -euo pipefail

PORT="${BOSS_DASHBOARD_PORT:-5050}"
DASH_DIR="$HOME/.openclaw/company/boss-dashboard"
LOG="/tmp/boss-dashboard.log"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
fail() { printf '\033[31m✗\033[0m %s\n' "$1"; exit 1; }

bold "Boss Dashboard installer"

# ──────── prereqs ────────
command -v python3 >/dev/null || fail "python3 not on PATH"
[ -d "$HOME/.openclaw" ] || fail "$HOME/.openclaw not found. Run quickstart.sh first."
[ -d "$HOME/.openclaw/company" ] || warn "no company set up yet — run setup-company.sh first (dashboard will still launch but show empty data)"
ok "python3 + ~/.openclaw OK"

# ──────── flask ────────
if python3 -c "import flask" >/dev/null 2>&1; then
  ok "Flask already installed"
else
  echo "  installing Flask..."
  if pip3 install flask --quiet 2>/dev/null; then
    ok "Flask installed"
  else
    pip3 install flask --quiet --break-system-packages
    ok "Flask installed (--break-system-packages, brew Python)"
  fi
fi

# ──────── dashboard files ────────
mkdir -p "$DASH_DIR"

# Where this script lives — ship the dashboard files alongside it
SRC_DIR="$(cd "$(dirname "$0")" && pwd)/boss-dashboard"
if [ ! -d "$SRC_DIR" ]; then
  # If installer is curl'd standalone, fall back to GitHub raw
  RAW_BASE="https://raw.githubusercontent.com/REPLACE_OWNER/openclaw-setup-guide/main/boss-dashboard"
  echo "  fetching dashboard files from GitHub..."
  for f in app.py index.html styles.css app.js; do
    curl -fsSL "$RAW_BASE/$f" -o "$DASH_DIR/$f"
  done
  ok "dashboard files fetched"
else
  cp "$SRC_DIR"/{app.py,index.html,styles.css,app.js} "$DASH_DIR/"
  ok "dashboard files copied from $SRC_DIR"
fi

# ──────── stop previous instance ────────
if pgrep -f "python3 .*boss-dashboard.*app.py" >/dev/null 2>&1; then
  pkill -f "python3 .*boss-dashboard.*app.py" || true
  sleep 1
  ok "stopped previous dashboard instance"
fi

# ──────── launch ────────
cd "$DASH_DIR"
BOSS_DASHBOARD_PORT="$PORT" nohup python3 app.py > "$LOG" 2>&1 &
DPID=$!
sleep 2
if ps -p "$DPID" > /dev/null 2>&1; then
  ok "dashboard running (pid=$DPID)"
else
  fail "dashboard failed to start. tail $LOG for details"
fi

# ──────── smoke ────────
if curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:$PORT/api/agents" | grep -q "^200$"; then
  ok "API responding on http://127.0.0.1:$PORT"
else
  warn "API didn't respond yet. tail $LOG and refresh in a few seconds."
fi

echo
bold "Open it"
echo "  → http://127.0.0.1:$PORT"
echo
echo "  Logs: tail -f $LOG"
echo "  Stop: pkill -f 'python3 .*boss-dashboard.*app.py'"
