#!/usr/bin/env bash
# quickstart.sh — one-shot, idempotent installer for OpenClaw on macOS / Linux.
#
# Defaults: installs OpenClaw + Ollama + qwen3:8b + WebChat.
# Override with env vars:
#   OPENCLAW_PROVIDER   ollama (default) | openai | anthropic | deepseek | skip
#   OPENCLAW_MODEL      provider model id (provider prefix optional, will be inferred)
#   OPENCLAW_OLLAMA_TAG ollama tag if provider=ollama (default: qwen3:8b)
#   OPENAI_API_KEY      required if OPENCLAW_PROVIDER=openai
#   ANTHROPIC_API_KEY   required if OPENCLAW_PROVIDER=anthropic
#   DEEPSEEK_API_KEY    required if OPENCLAW_PROVIDER=deepseek
#   OPENCLAW_SKIP_SMOKE 1 to skip the end-to-end smoke test
#
# Re-running is safe; every step checks current state before doing work.

set -euo pipefail

# ───────── colors ─────────
if [[ -t 1 ]] && command -v tput >/dev/null 2>&1; then
  C_R=$(tput setaf 1); C_G=$(tput setaf 2); C_Y=$(tput setaf 3); C_B=$(tput setaf 4); C_M=$(tput setaf 5); C_C=$(tput setaf 6); C_W=$(tput setaf 7); C_BOLD=$(tput bold); C_RST=$(tput sgr0)
else
  C_R=""; C_G=""; C_Y=""; C_B=""; C_M=""; C_C=""; C_W=""; C_BOLD=""; C_RST=""
fi

step()    { printf "\n${C_BOLD}${C_C}▶ %s${C_RST}\n" "$*"; }
ok()      { printf "${C_G}  ✓ %s${C_RST}\n" "$*"; }
warn()    { printf "${C_Y}  ! %s${C_RST}\n" "$*"; }
err()     { printf "${C_R}  ✗ %s${C_RST}\n" "$*" >&2; }
fatal()   { err "$*"; exit 1; }

banner() {
  cat <<'EOF'

   🦞  OpenClaw quickstart
   ────────────────────────────────────────
   Local-first personal AI assistant
   https://openclaw.ai

EOF
}

# ───────── env / defaults ─────────
PROVIDER="${OPENCLAW_PROVIDER:-ollama}"
OLLAMA_TAG="${OPENCLAW_OLLAMA_TAG:-qwen3:8b}"
DEFAULT_MODEL="${OPENCLAW_MODEL:-}"

OS="$(uname -s)"
case "$OS" in
  Darwin) OS=macos ;;
  Linux)  OS=linux ;;
  *)      fatal "Unsupported OS: $OS (this script supports macOS and Linux; on Windows use WSL2)" ;;
esac

banner

# ───────── 0. preflight ─────────
step "Preflight checks ($OS)"

if ! command -v node >/dev/null 2>&1; then
  fatal "Node.js not found. Install Node 22.16+ first (try: brew install node, or use nvm)."
fi
NODE_MAJ=$(node -p "process.versions.node.split('.')[0]")
NODE_MIN=$(node -p "process.versions.node.split('.')[1]")
if (( NODE_MAJ < 22 )) || (( NODE_MAJ == 22 && NODE_MIN < 16 )); then
  fatal "Node $NODE_MAJ.$NODE_MIN.x is too old. Need >= 22.16 (24 recommended)."
fi
ok "Node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  fatal "npm not found (should ship with Node)"
fi
ok "npm $(npm -v)"

if [[ "$OS" == macos ]] && ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found. You'll need to install Ollama manually if PROVIDER=ollama."
fi

# ───────── 1. install openclaw ─────────
step "Installing OpenClaw CLI"

if command -v openclaw >/dev/null 2>&1; then
  CUR_VER=$(openclaw --version 2>/dev/null | awk '{print $2}' || echo unknown)
  ok "openclaw already installed ($CUR_VER)"
else
  npm install -g openclaw@latest
  ok "openclaw installed: $(openclaw --version)"
fi

# ───────── 2. onboard (idempotent) ─────────
step "Bootstrapping workspace + Gateway daemon"

if [[ -f "$HOME/.openclaw/openclaw.json" ]]; then
  ok "~/.openclaw already initialized — skipping onboard"
else
  openclaw onboard \
    --non-interactive --accept-risk \
    --install-daemon \
    --auth-choice skip \
    --skip-channels --skip-skills --skip-search --skip-ui
  ok "Onboard complete"
fi

# ───────── 3. provider setup ─────────
case "$PROVIDER" in
  ollama)
    step "Setting up Ollama (local) + model: $OLLAMA_TAG"
    if ! command -v ollama >/dev/null 2>&1; then
      if [[ "$OS" == macos ]] && command -v brew >/dev/null 2>&1; then
        brew install ollama
      elif [[ "$OS" == linux ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
      else
        fatal "Cannot auto-install Ollama on this platform; install from https://ollama.com"
      fi
    fi
    ok "Ollama present: $(ollama --version 2>&1 | head -1)"

    # start ollama service
    if [[ "$OS" == macos ]]; then
      if ! brew services list 2>/dev/null | grep -q "ollama.*started"; then
        brew services start ollama || true
        sleep 2
      fi
    else
      systemctl --user enable --now ollama 2>/dev/null || (nohup ollama serve >/dev/null 2>&1 & disown) || true
      sleep 2
    fi

    # wait for ollama to be reachable
    for i in 1 2 3 4 5; do
      if curl -sf -m 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
        ok "Ollama listening on 127.0.0.1:11434"
        break
      fi
      sleep 2
    done

    if ! ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$OLLAMA_TAG"; then
      step "Pulling $OLLAMA_TAG (this may take a few minutes)…"
      ollama pull "$OLLAMA_TAG"
    else
      ok "Model $OLLAMA_TAG already present"
    fi

    : "${DEFAULT_MODEL:=ollama/$OLLAMA_TAG}"
    [[ "$DEFAULT_MODEL" == ollama/* ]] || DEFAULT_MODEL="ollama/$DEFAULT_MODEL"
    openclaw models set "$DEFAULT_MODEL"
    ok "Default model set to $DEFAULT_MODEL"

    # register placeholder OLLAMA_API_KEY in service env
    ENV_FILE="$HOME/.openclaw/service-env/ai.openclaw.gateway.env"
    if [[ -f "$ENV_FILE" ]] && ! grep -q "^export OLLAMA_API_KEY=" "$ENV_FILE"; then
      echo "export OLLAMA_API_KEY='local'" >> "$ENV_FILE"
      ok "Registered OLLAMA_API_KEY=local in $ENV_FILE"
    else
      ok "OLLAMA_API_KEY already in service env"
    fi
    ;;

  openai)
    [[ -n "${OPENAI_API_KEY:-}" ]] || fatal "OPENAI_API_KEY is required when OPENCLAW_PROVIDER=openai"
    step "Configuring OpenAI provider"
    openclaw onboard --non-interactive --accept-risk --auth-choice openai-api-key \
      --openai-api-key "$OPENAI_API_KEY" \
      --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
    : "${DEFAULT_MODEL:=openai/gpt-5.2}"
    [[ "$DEFAULT_MODEL" == openai/* ]] || DEFAULT_MODEL="openai/$DEFAULT_MODEL"
    openclaw models set "$DEFAULT_MODEL"
    ok "Default model set to $DEFAULT_MODEL"
    ;;

  anthropic)
    [[ -n "${ANTHROPIC_API_KEY:-}" ]] || fatal "ANTHROPIC_API_KEY is required when OPENCLAW_PROVIDER=anthropic"
    step "Configuring Anthropic provider"
    openclaw onboard --non-interactive --accept-risk --auth-choice anthropic \
      --anthropic-api-key "$ANTHROPIC_API_KEY" \
      --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
    : "${DEFAULT_MODEL:=anthropic/claude-sonnet-4.5}"
    [[ "$DEFAULT_MODEL" == anthropic/* ]] || DEFAULT_MODEL="anthropic/$DEFAULT_MODEL"
    openclaw models set "$DEFAULT_MODEL"
    ok "Default model set to $DEFAULT_MODEL"
    ;;

  deepseek)
    [[ -n "${DEEPSEEK_API_KEY:-}" ]] || fatal "DEEPSEEK_API_KEY is required when OPENCLAW_PROVIDER=deepseek"
    step "Configuring DeepSeek provider"
    openclaw onboard --non-interactive --accept-risk --auth-choice deepseek-api-key \
      --deepseek-api-key "$DEEPSEEK_API_KEY" \
      --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
    : "${DEFAULT_MODEL:=deepseek/deepseek-chat}"
    [[ "$DEFAULT_MODEL" == deepseek/* ]] || DEFAULT_MODEL="deepseek/$DEFAULT_MODEL"
    openclaw models set "$DEFAULT_MODEL"
    ok "Default model set to $DEFAULT_MODEL"
    ;;

  skip)
    warn "PROVIDER=skip — daemon installed but no model configured. Configure later with: openclaw configure --section providers"
    ;;

  *)
    fatal "Unsupported OPENCLAW_PROVIDER='$PROVIDER'. Use ollama|openai|anthropic|deepseek|skip"
    ;;
esac

# ───────── 4. restart gateway ─────────
step "Restarting Gateway to pick up new auth/model"

if [[ "$OS" == macos ]]; then
  launchctl kickstart -k "gui/$(id -u)/ai.openclaw.gateway" 2>/dev/null || true
elif [[ "$OS" == linux ]]; then
  systemctl --user restart openclaw-gateway 2>/dev/null || true
fi
sleep 3

# ───────── 5. reset sticky session ─────────
SESS_FILE="$HOME/.openclaw/agents/main/sessions/sessions.json"
if [[ -f "$SESS_FILE" ]] && [[ "$PROVIDER" != skip ]]; then
  if grep -q '"status"\s*:\s*"failed"' "$SESS_FILE" 2>/dev/null || [[ -n "$(jq -r 'keys[0] // empty' "$SESS_FILE" 2>/dev/null || cat "$SESS_FILE" | head -c 50)" ]]; then
    cp "$SESS_FILE" "${SESS_FILE}.bak.$(date +%s)" 2>/dev/null || true
    echo '{}' > "$SESS_FILE"
    ok "Reset session bindings (was sticky to old model)"
  fi
fi

# ───────── 6. smoke test ─────────
if [[ "${OPENCLAW_SKIP_SMOKE:-0}" != "1" && "$PROVIDER" != "skip" ]]; then
  step "End-to-end smoke test"
  if perl -e 'alarm(120); exec @ARGV' openclaw agent --agent main --message "Reply with exactly: PONG" --thinking off 2>&1 | tee /tmp/openclaw-smoke.txt | tail -3 | grep -qiE "pong|ok|hi|hello"; then
    ok "Agent responded successfully"
  else
    warn "Smoke test didn't return a clear PONG. Output:"
    sed 's/^/    /' /tmp/openclaw-smoke.txt | tail -10
    warn "Check ~/.openclaw/logs/gateway.log for details."
  fi
fi

# ───────── done ─────────
TOKEN=$(grep -E '"token"' "$HOME/.openclaw/openclaw.json" 2>/dev/null | head -1 | sed -E 's/.*"token"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || echo "<see ~/.openclaw/openclaw.json>")

cat <<EOF

${C_BOLD}${C_G}🦞 Setup complete!${C_RST}

${C_BOLD}WebChat:${C_RST}  http://127.0.0.1:18789/webchat
${C_BOLD}Token:${C_RST}    ${TOKEN}
${C_BOLD}Logs:${C_RST}     tail -f ~/.openclaw/logs/gateway.log
${C_BOLD}Status:${C_RST}   openclaw status
${C_BOLD}Chat:${C_RST}     openclaw agent --agent main --message "hi"

Add a chat channel later with:  openclaw configure --section channels
Docs:  https://docs.openclaw.ai

EOF
