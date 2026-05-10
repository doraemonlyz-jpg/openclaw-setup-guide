# AGENTS.md — OpenClaw setup, the agent way

> Audience: coding agents (Claude / Cursor / Codex / etc.). Optimized for token efficiency. Every command in this file is meant to be copy-pasted verbatim. Human-readable explanations live in `README.md` and the website (`docs/`).

## TL;DR

If the user asks "install OpenClaw on my machine", the fastest path is:

```bash
curl -fsSL https://raw.githubusercontent.com/doraemonlyz-jpg/<repo>/main/quickstart.sh | bash
# or, if the repo is already cloned:
bash quickstart.sh
```

Default behaviour: installs OpenClaw + Ollama + `qwen3:8b` + WebChat. Override with env vars:

```bash
OPENCLAW_PROVIDER=ollama OPENCLAW_MODEL=qwen3:8b bash quickstart.sh
OPENCLAW_PROVIDER=openai OPENAI_API_KEY=sk-xxx bash quickstart.sh
OPENCLAW_PROVIDER=skip bash quickstart.sh   # daemon only, configure later
```

## Architecture in 4 lines

1. **Gateway**: Node service, WebSocket + HTTP on `127.0.0.1:18789`, runs as launchd / systemd user service, control plane for everything.
2. **Agent**: One or more isolated agent runtimes (default: `main`), each with its own auth profiles + sessions in `~/.openclaw/agents/<id>/`.
3. **Channels**: Plugins that bridge Gateway ↔ external IM (Telegram / Discord / WebChat / WeChat / iMessage / Feishu / etc.).
4. **Models**: Auth profiles bind a model id (`<provider>/<model>`) to credentials. Local runtimes (Ollama / LM Studio) still need a placeholder secret.

## State directory map (memorize this)

```
~/.openclaw/
├── openclaw.json                       # main config (gateway port, default agent, plugins)
├── openclaw.json.bak                   # auto-rolling backup
├── service-env/
│   ├── ai.openclaw.gateway-env-wrapper.sh
│   └── ai.openclaw.gateway.env         # ENV for the launchd-spawned gateway (add OLLAMA_API_KEY here)
├── logs/
│   ├── gateway.log                     # tail this when debugging
│   └── gateway.err.log
├── agents/main/
│   ├── agent/auth-profiles.json        # per-agent provider auth (OAuth tokens, paste tokens)
│   └── sessions/sessions.json          # active session keys -> sessionId (DELETE TO RESET)
├── workspace/
│   ├── AGENTS.md                       # injected into every prompt
│   ├── SOUL.md                         # personality
│   └── TOOLS.md                        # tool guidance
├── plugins/
└── npm/                                # installed channel plugins (WeChat, etc.)
```

```
~/Library/LaunchAgents/ai.openclaw.gateway.plist   # macOS service definition
```

## Step-by-step (no skipping)

### 0. Prerequisites

```bash
# macOS: must have Homebrew + Node >= 22.16 (Node 24 recommended; Node 25 also works)
node -v   # → must show v22.16.x or higher
which brew
sw_vers   # macOS 13+ recommended
```

If Node is missing/old: `brew install node` (gets latest), or `nvm install 24 && nvm use 24`.

### 1. Install the CLI

```bash
npm install -g openclaw@latest
openclaw --version    # → "OpenClaw <year>.<month>.<day> (<sha>)"
```

### 2. Non-interactive onboard

```bash
openclaw onboard \
  --non-interactive --accept-risk \
  --install-daemon \
  --auth-choice skip \
  --skip-channels --skip-skills --skip-search --skip-ui
```

Side effects:

- Writes `~/.openclaw/openclaw.json` with a generated gateway token at `gateway.auth.token`.
- Writes `~/.openclaw/workspace/{AGENTS.md,SOUL.md,TOOLS.md}`.
- macOS: installs `~/Library/LaunchAgents/ai.openclaw.gateway.plist` and starts the daemon.
- Linux: installs `~/.config/systemd/user/openclaw-gateway.service` and starts the daemon.

Verify the gateway is running:

```bash
lsof -nP -iTCP:18789 -sTCP:LISTEN | head -2     # macOS / Linux: should show node ... LISTEN
curl -s http://127.0.0.1:18789/__openclaw__/health | head -c 80
```

### 3. Provider setup (pick ONE branch)

#### 3a. Ollama (local, free)

```bash
brew install ollama                          # macOS
brew services start ollama                   # daemonize on port 11434
ollama pull qwen3:8b                         # ~5.2 GB, takes 1-5 min depending on bandwidth
ollama list                                  # verify

openclaw models set "ollama/qwen3:8b"

# Register placeholder API key for Ollama (REQUIRED even though local)
echo "export OLLAMA_API_KEY='local'" >> ~/.openclaw/service-env/ai.openclaw.gateway.env
```

Linux equivalent: `curl -fsSL https://ollama.com/install.sh | sh && systemctl --user enable --now ollama`.

#### 3b. OpenAI (API key)

```bash
openclaw onboard --non-interactive --accept-risk --auth-choice openai-api-key \
  --openai-api-key "$OPENAI_API_KEY" \
  --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
openclaw models set "openai/gpt-5.2"   # or any current flagship; check `openclaw models list`
```

#### 3c. Anthropic Claude (API key)

```bash
openclaw onboard --non-interactive --accept-risk --auth-choice anthropic \
  --anthropic-api-key "$ANTHROPIC_API_KEY" \
  --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
openclaw models set "anthropic/claude-sonnet-4.5"
```

#### 3d. DeepSeek / Moonshot / Qwen / VolcEngine / Z.AI / StepFun / MiniMax

All use the same pattern; just swap the `--auth-choice` value and the matching `--<provider>-api-key` flag. See `openclaw onboard --help | rg api-key` for the exhaustive list.

```bash
# DeepSeek example
openclaw onboard --non-interactive --accept-risk --auth-choice deepseek-api-key \
  --deepseek-api-key "$DEEPSEEK_API_KEY" \
  --skip-channels --skip-skills --skip-search --skip-ui --skip-daemon --skip-bootstrap
openclaw models set "deepseek/deepseek-chat"
```

### 4. Restart gateway after auth changes

```bash
# macOS
launchctl kickstart -k gui/$UID/ai.openclaw.gateway

# Linux
systemctl --user restart openclaw-gateway

# Wait 3 seconds for the gateway to come back up
sleep 3
```

### 5. Reset sticky session (CRITICAL after first model change)

If you switch the default model after the first `onboard` run, existing sessions still bind to the old model and will fail with `No API key found for provider <old>`. Reset:

```bash
mv ~/.openclaw/agents/main/sessions/sessions.json{,.bak} 2>/dev/null
echo '{}' > ~/.openclaw/agents/main/sessions/sessions.json
```

### 6. Smoke test

```bash
openclaw agent --agent main --message "Reply with exactly: PONG" --thinking off
# Expect: "PONG" or close (some models are chatty; trim wrappers)
```

If you get `Unknown model:` → step 4 wasn't done or env wasn't picked up. If you get `provider not authorized` → don't pass `--model` to `openclaw agent`; rely on `models set`.

### 7. Channel setup (optional)

Default install gives you **WebChat** for free at `http://127.0.0.1:18789/webchat`. The auth token is in `~/.openclaw/openclaw.json` under `gateway.auth.token`.

To add Telegram / Discord / etc., see [Channels reference](#channels-reference).

## Models reference

| Provider | `models set` value | `--auth-choice` | API-key flag | Notes |
|---|---|---|---|---|
| OpenAI | `openai/gpt-5.2` | `openai-api-key` | `--openai-api-key` | Also supports `openai-codex` (OAuth via Codex CLI) |
| OpenAI Codex | `openai/codex-mini-latest` | `openai-codex-device-code` | n/a (device code) | OAuth flow, no key |
| Anthropic | `anthropic/claude-sonnet-4.5` | `anthropic` | `--anthropic-api-key` | Or `claude-cli` for OAuth |
| Google Gemini | `google/gemini-2.5-pro` | `gemini-api-key` | `--gemini-api-key` | Or `google-gemini-cli` for OAuth |
| xAI | `xai/grok-4` | `xai-api-key` | `--xai-api-key` |  |
| DeepSeek | `deepseek/deepseek-chat` | `deepseek-api-key` | `--deepseek-api-key` | Cheap & fast, CN-friendly |
| Moonshot Kimi | `moonshot/kimi-k2-turbo` | `moonshot-api-key` (intl) / `moonshot-api-key-cn` | `--moonshot-api-key` | CN endpoint variant available |
| Qwen Cloud | `qwen/qwen3-max` | `qwen-api-key` (intl) / `qwen-api-key-cn` | `--modelstudio-standard-api-key` | Alibaba Cloud Model Studio |
| Z.AI (智谱) | `zai/glm-4.6` | `zai-api-key` | `--zai-api-key` | OAuth variants: `zai-coding-cn`, `zai-coding-global` |
| StepFun | `stepfun/step-3` | `stepfun-api-key` | `--stepfun-api-key` |  |
| MiniMax | `minimax/abab7-chat` | `minimax-cn-api` / `minimax-global-api` | `--minimax-api-key` | OAuth variants exist |
| VolcEngine (火山) | `volcengine/<endpoint-id>` | `volcengine-api-key` | `--volcengine-api-key` | ByteDance |
| BytePlus | `byteplus/<endpoint-id>` | `byteplus-api-key` | `--byteplus-api-key` | ByteDance overseas |
| OpenRouter | `openrouter/<model-id>` | `openrouter-api-key` | `--openrouter-api-key` | One key, hundreds of models |
| GitHub Copilot | (via auth) | `github-copilot` | n/a (device code) | Requires Copilot subscription |
| Ollama | `ollama/<tag>` | `ollama` | n/a (placeholder env) | LOCAL — set `OLLAMA_API_KEY=local` in service env |
| LM Studio | `lmstudio/<model>` | `lmstudio` | `--lmstudio-api-key` | LOCAL — start LM Studio server first |
| vLLM | `vllm/<model>` | `vllm` | n/a | Self-hosted OpenAI-compatible |
| SGLang | `sglang/<model>` | `sglang` | n/a | Self-hosted |
| Custom (any OpenAI-compatible) | `<id>/<model>` | `custom-api-key` | `--custom-base-url` + `--custom-api-key` + `--custom-model-id` | For one-offs |

For Ollama, recommended models on Apple Silicon by RAM:

| RAM | Recommended | Size |
|---|---|---|
| 16 GB | `qwen3:8b` or `llama3.1:8b` | ~5 GB |
| 32 GB | `qwen2.5-coder:14b` or `gemma3:12b` | ~9 GB |
| 64 GB+ | `gpt-oss:20b` or `qwen3:32b` | ~13-20 GB |

## Channels reference

### WebChat (zero config — already working after step 2)

```
URL:   http://127.0.0.1:18789/webchat
Token: $(jq -r .gateway.auth.token ~/.openclaw/openclaw.json)
```

### Telegram

```bash
# 1. Talk to @BotFather on Telegram, /newbot, copy the token
export TELEGRAM_BOT_TOKEN="123456:ABC..."

# 2. Configure
openclaw config set channels.telegram.botToken "$TELEGRAM_BOT_TOKEN"
openclaw config set channels.telegram.allowFrom '["telegram:<your-user-id>"]' --strict-json

# 3. Restart
launchctl kickstart -k gui/$UID/ai.openclaw.gateway

# 4. Find your user id by sending /start to your bot, then check logs:
tail -50 ~/.openclaw/logs/gateway.log | rg telegram
```

### Discord

```bash
# 1. Discord Developer Portal → New Application → Bot → copy token, enable MESSAGE CONTENT INTENT
export DISCORD_BOT_TOKEN="..."

openclaw config set channels.discord.token "$DISCORD_BOT_TOKEN"
openclaw config set channels.discord.dmPolicy '"pairing"'
launchctl kickstart -k gui/$UID/ai.openclaw.gateway

# 2. Invite the bot via the OAuth2 URL generator (scope: bot, perms: Send Messages + Read Message History)
# 3. DM the bot — it will reply with a pairing code:
openclaw pairing approve <code-from-bot>
```

### Slack

```bash
# 1. Slack App: Socket Mode ON, generate Bot Token (xoxb-...) + App Token (xapp-...)
openclaw config set channels.slack.botToken "$SLACK_BOT_TOKEN"
openclaw config set channels.slack.appToken "$SLACK_APP_TOKEN"
launchctl kickstart -k gui/$UID/ai.openclaw.gateway
```

### Feishu (飞书 / Lark)

```bash
# 1. open.feishu.cn → Build self-hosted app → Get App ID + App Secret + Verification Token + Encrypt Key
openclaw config set channels.feishu.appId "$FEISHU_APP_ID"
openclaw config set channels.feishu.appSecret "$FEISHU_APP_SECRET"
openclaw config set channels.feishu.verificationToken "$FEISHU_VERIFICATION_TOKEN"
openclaw config set channels.feishu.encryptKey "$FEISHU_ENCRYPT_KEY"
launchctl kickstart -k gui/$UID/ai.openclaw.gateway
```

Feishu needs a public callback URL — use Tailscale Funnel, ngrok, or Cloudflare Tunnel.

### WeChat (Tencent official iLink)

```bash
# Requires the ClawBot plugin in WeChat (Me → Settings → Plugins). If you don't see it,
# Tencent hasn't rolled it out to your account yet — use a different channel.
openclaw plugins install "@tencent-weixin/openclaw-weixin"
openclaw channels login --channel openclaw-weixin   # interactive: scan QR with WeChat
```

⚠️ Private chats only. Group chats not supported by the official API.

### iMessage (BlueBubbles, recommended) / Signal / Matrix / IRC / etc.

See `openclaw configure --section channels` (interactive) or `openclaw channels --help`.

## Common errors → fixes (cheat sheet)

| Error | Fix |
|---|---|
| `No API key found for provider <X>` | `models set` to your real default + reset sessions (step 5) |
| `Unknown model: ollama/...` | Add `OLLAMA_API_KEY=local` to service env, restart gateway |
| `provider/model overrides are not authorized for this caller` | Don't use `--model` on `openclaw agent`; configure default model |
| `Pass --to <E.164>, --session-id, or --agent` | Add `--agent main` to the command |
| `EPERM: ... config-health.json` | Permissions issue (often sandbox); ignore in normal terminals |
| Gateway not in `launchctl list` | Run `launchctl bootstrap gui/$UID ~/Library/LaunchAgents/ai.openclaw.gateway.plist` |
| Plugin loaded warning `plugins.allow is empty` | `openclaw config set plugins.allow '["openclaw-weixin", ...]' --strict-json` |
| WeChat plugin install hangs | npm-link bug; kill and retry, or skip and use Telegram |

## How to extend this guide

If you add a new model or channel:

1. Append a row to the table in this file (`AGENTS.md`).
2. Add a section to the website tutorial (`docs/tutorial.html`) with a working example.
3. Bump the test command in `quickstart.sh` if it affects the default install.
4. Update `llms.txt` "Common pitfalls" if you found a new one.

## Verification checklist (the agent should run these to confirm install worked)

```bash
[ -f ~/.openclaw/openclaw.json ]                          && echo "✓ config" || echo "✗ config"
lsof -nP -iTCP:18789 -sTCP:LISTEN >/dev/null              && echo "✓ gateway" || echo "✗ gateway"
openclaw models status 2>&1 | grep -q "Default"           && echo "✓ default model" || echo "✗ default model"
echo "ping" | openclaw agent --agent main --message ping --thinking off >/dev/null 2>&1 && echo "✓ end-to-end" || echo "✗ end-to-end"
```
