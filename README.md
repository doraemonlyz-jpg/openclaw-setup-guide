<div align="center">

# 🦞 OpenClaw Setup Guide

**Self-hosted personal AI assistant — installed in one command.**
**自托管个人 AI 助手 — 一行命令搞定。**

[🌐 Live Tutorial Site](https://doraemonlyz-jpg.github.io/openclaw-setup-guide/) · [Quickstart](#-quickstart) · [For Agents](#-for-agents) · [中文](#中文)

</div>

---

## 💬 Telling another AI to install this for you / 给另一个 Agent 用的指令

Copy-paste this into Claude / Cursor / Codex / any coding agent:

> Install OpenClaw on this machine. First fetch
> <https://doraemonlyz-jpg.github.io/openclaw-setup-guide/llms.txt> to learn the
> spec, then run:
> ```
> curl -fsSL https://raw.githubusercontent.com/doraemonlyz-jpg/openclaw-setup-guide/main/quickstart.sh | bash
> ```
> Defaults to local Ollama + qwen3:8b + WebChat. Read AGENTS.md for the full
> error→fix matrix if anything breaks.

中文版 — 复制给任意 coding agent：

> 帮我在这台机器装 OpenClaw 个人 AI 助手。先 fetch
> <https://doraemonlyz-jpg.github.io/openclaw-setup-guide/llms.txt> 了解规格，
> 然后跑：
> ```
> curl -fsSL https://raw.githubusercontent.com/doraemonlyz-jpg/openclaw-setup-guide/main/quickstart.sh | bash
> ```
> 默认本地 Ollama + qwen3:8b + WebChat。出错查 AGENTS.md 的 "Common errors → fixes" 表。

---

## 🚀 Quickstart

```bash
# Install OpenClaw + Ollama + qwen3:8b + WebChat (macOS / Linux)
curl -fsSL https://raw.githubusercontent.com/doraemonlyz-jpg/openclaw-setup-guide/main/quickstart.sh | bash

# Or override the defaults
OPENCLAW_PROVIDER=ollama OPENCLAW_OLLAMA_TAG=qwen2.5-coder:14b bash <(curl -fsSL ...)
OPENCLAW_PROVIDER=openai OPENAI_API_KEY=sk-xxx bash <(curl -fsSL ...)
OPENCLAW_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-xxx bash <(curl -fsSL ...)
OPENCLAW_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-xxx bash <(curl -fsSL ...)
```

When it finishes, open <http://127.0.0.1:18789/webchat> and start chatting.

## 🤖 For Agents

If you are a coding agent (Claude / Cursor / Codex / etc.) tasked with installing OpenClaw on a user's machine, **read [`AGENTS.md`](AGENTS.md) first** — it is the token-efficient command-only spec.

Key files:

- [`llms.txt`](llms.txt) — TL;DR + critical pitfalls (LLM-readable, ~150 lines)
- [`AGENTS.md`](AGENTS.md) — full step-by-step + provider/channel reference + error→fix matrix
- [`quickstart.sh`](quickstart.sh) — idempotent one-shot installer (parameterized via env vars)

A re-install is safe: every step in `quickstart.sh` checks current state before doing work.

## 📦 What you get

```
~/.openclaw/                     ← all state, easy to back up
├── openclaw.json                ← config (gateway port, default model, plugins, channels)
├── service-env/...env           ← env vars passed to the gateway daemon
├── logs/gateway.log             ← single tail target for debugging
├── agents/main/                 ← per-agent auth + sessions
└── workspace/                   ← AGENTS.md / SOUL.md / TOOLS.md (injected into every prompt)

Endpoints (after install):
  WebChat   http://127.0.0.1:18789/webchat
  Dashboard http://127.0.0.1:18789/
  Gateway   ws://127.0.0.1:18789  (control plane)
  Ollama    http://127.0.0.1:11434 (if local model)
```

## ✨ Why this guide exists

Following [openclaw.ai](https://openclaw.ai) docs end-to-end takes ~30 minutes the first time and hits a few non-obvious gotchas:

1. `onboard --non-interactive` requires `--accept-risk` together; documented but easy to miss
2. Local Ollama still needs a placeholder `OLLAMA_API_KEY` registered in service env, not in shell
3. After changing the default model, existing sessions are sticky to the old model and must be reset
4. CLI `--model` overrides are blocked by default; `models set` is the only way

This guide collapses that into one idempotent script + one command-only spec.

## 🛠 Manual install (if you want to read what's happening)

See the **[full tutorial site](https://doraemonlyz-jpg.github.io/openclaw-setup-guide/)** for a step-by-step walkthrough with copyable commands, or read the source: [`docs/tutorial.html`](docs/tutorial.html).

## 🤝 Contributing

PRs welcome. Especially: new model providers, new channels, new error→fix entries.

When adding a model/channel:

1. Add a row to the table in [`AGENTS.md`](AGENTS.md)
2. Add a section to [`docs/tutorial.html`](docs/tutorial.html)
3. If it changes default install behaviour, update [`quickstart.sh`](quickstart.sh)

## 🛠 Maintenance cheat sheet / 维护小抄

```bash
# Edit any file, then commit + push — GitHub Actions auto-redeploys the site
git add -A
git commit -m "your message"
git push

# Watch the deploy
gh run list -R doraemonlyz-jpg/openclaw-setup-guide --limit 3
gh run watch <run-id>

# Local preview (no build step needed — pure static HTML/CSS/JS)
cd docs && python3 -m http.server 8000
# → http://127.0.0.1:8000

# Adding a new model provider:
#   1. Add a row to AGENTS.md "Models reference" table
#   2. Add a row to docs/index.html "providers" table
#   3. Add a case branch to quickstart.sh
#   4. Update llms.txt "Quick recipe" if it changes the default

# Adding a new chat channel:
#   1. Add a section to AGENTS.md "Channels reference"
#   2. Add a card to docs/index.html "channel-grid"

# Fixing a translation:
#   - Bilingual text uses data-i18n="key" in docs/index.html
#   - Translations live in docs/app.js → const I18N = { zh: {...}, en: {...} }
#   - Add the same key to BOTH zh and en blocks
```

The Pages workflow auto-replaces `REPLACE_OWNER` and `openclaw-setup-guide` placeholders with the actual repo owner/name at deploy time, so forks "just work" without editing anything. 部署时会自动替换占位符，fork 后无需手动改任何东西。

## 📜 License

MIT — see [LICENSE](LICENSE).

OpenClaw itself is MIT-licensed by the [openclaw/openclaw](https://github.com/openclaw/openclaw) project. This guide is independent and unaffiliated.

---

<a id="中文"></a>

## 中文

**🦞 OpenClaw 安装指南** — 一条命令搭起属于你自己的本地 AI 助手。

### 🚀 快速开始

```bash
# 安装 OpenClaw + Ollama + qwen3:8b + WebChat（macOS / Linux）
curl -fsSL https://raw.githubusercontent.com/doraemonlyz-jpg/openclaw-setup-guide/main/quickstart.sh | bash
```

跑完后浏览器打开 <http://127.0.0.1:18789/webchat> 就能聊天。Token 在 `~/.openclaw/openclaw.json` 的 `gateway.auth.token`。

### 🤖 给 Agent 看

如果你是个 coding agent（Claude / Cursor / Codex…），用户让你帮他在本机装 OpenClaw，**先读 [`AGENTS.md`](AGENTS.md)**——那是为你优化的命令密集型说明，省 token。

| 文件 | 用途 |
|---|---|
| [`llms.txt`](llms.txt) | LLM 可读的 TL;DR + 关键坑点 |
| [`AGENTS.md`](AGENTS.md) | 完整命令清单 + provider/channel 参考表 + 错误→修复对照 |
| [`quickstart.sh`](quickstart.sh) | 幂等一键安装脚本（环境变量配置） |

### ✨ 为什么造这个轮子

按官方文档一步一步搭，第一次大概要 30 分钟，会踩几个不太明显的坑：

1. `onboard --non-interactive` 必须和 `--accept-risk` 一起用——文档有但容易看漏
2. 本地 Ollama 也要在 launchd 的 service env 里塞一个占位 `OLLAMA_API_KEY=local`，不是设在 shell 里
3. 默认 model 切换后，老 session 还粘在旧 model 上，要清空 `sessions.json`
4. CLI 默认禁止 `--model` 临时 override，只能 `models set`

这个仓库把这些经验固化成了一行脚本 + 一份命令清单。

### 🛠 手动安装

完整的中英双语教程在 [**网站版本**](https://doraemonlyz-jpg.github.io/openclaw-setup-guide/)，里面每条命令都有"复制"按钮，且支持中英切换。

### 🔧 维护小抄

```bash
# 改完任何文件 → commit + push，GitHub Actions 自动重新部署
git add -A && git commit -m "msg" && git push

# 看部署进度
gh run list -R doraemonlyz-jpg/openclaw-setup-guide --limit 3

# 本地预览（纯静态，不用 build）
cd docs && python3 -m http.server 8000   # → http://127.0.0.1:8000

# 加新 model：1) AGENTS.md 表格 2) docs/index.html 表格 3) quickstart.sh case
# 加新 channel：1) AGENTS.md "Channels reference" 2) docs/index.html "channel-grid"
# 改翻译：docs/index.html 用 data-i18n="key"，docs/app.js 的 I18N.{zh,en} 都要加
```

### 📜 协议

MIT。OpenClaw 本身由 [openclaw/openclaw](https://github.com/openclaw/openclaw) 维护，本仓库独立、非官方。
