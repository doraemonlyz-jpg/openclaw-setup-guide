# Build Your Own AI Software Studio

A reproducible blueprint for turning a stock OpenClaw install into an **8-agent local-only software studio**: PM, Tech Lead, two Engineers, QA, DevOps, Designer, Tech Writer. You give the boss request in plain English, the company tries to build the thing.

> Honest expectations first — see [Caveats](#caveats) before you fall in love with the architecture.

---

## TL;DR — one command

After you've installed OpenClaw with the [main quickstart](../README.md):

```bash
curl -fsSL https://REPLACE_OWNER.github.io/openclaw-setup-guide/setup-company.sh | bash
```

You'll have:

- `~/.openclaw/company/projects/` — where artifacts land
- `~/.openclaw/company/agents-workspaces/<id>/AGENTS.md` — each agent's persona
- 8 agents registered in OpenClaw, all routing through Ollama

Then talk to your PM:

```bash
openclaw agent --agent pm --message "Build me a tiny pomodoro CLI in Python. Path: ~/.openclaw/company/projects/pomodoro/"
```

---

## What you get

```
                    you (boss, WebChat / CLI)
                              │
                              ▼
                ┌─────────────────────────────┐
                │  PM (qwen3:8b)              │
                │  spec → orchestrate → report│
                └─────────────┬───────────────┘
                              │ sessions_send (agent-to-agent)
        ┌──────┬──────┬───────┴──────┬──────┬──────┐
        ▼      ▼      ▼              ▼      ▼      ▼
    techlead designer eng-be ─┬─ eng-fe  qa  devops  writer
                              │
                              ▼
            ~/.openclaw/company/projects/<slug>/
            (SPEC.md, TASKS.md, DESIGN.md, *.py, *.html,
             TEST_PLAN.md, TEST_REPORT.md, README.md)
```

| Agent       | Default model        | Job in one line                                  |
|-------------|----------------------|--------------------------------------------------|
| `pm`        | `qwen3:8b`           | Boss's only contact; orchestrates everyone else  |
| `techlead`  | `qwen3:8b`           | Picks stack, breaks SPEC into 3-8 tasks          |
| `designer`  | `qwen3:8b`           | UX flow + page layout + copy                     |
| `eng-be`    | `qwen2.5-coder:7b`   | Backend implementation                           |
| `eng-fe`    | `qwen2.5-coder:7b`   | Frontend implementation                          |
| `qa`        | `qwen3:8b`           | Test plan + actual smoke tests                   |
| `devops`    | `qwen3:8b`           | Starts the project, curls it, reports HTTP code  |
| `writer`    | `qwen3:8b`           | Writes the README                                |

Total disk: **~14 GB** of model files (`qwen3:8b` ≈ 5 GB, `qwen2.5-coder:7b` ≈ 5 GB, `deepseek-r1:14b` ≈ 9 GB shipped but unused by default).

---

## How it works

### 1. Each agent has a workspace + a persona

OpenClaw natively supports multiple isolated agents. Each one gets its own `AGENTS.md` (system prompt) under `~/.openclaw/company/agents-workspaces/<id>/`. The persona defines:

- **Role + scope** — what the agent does and explicitly does NOT do
- **Workflow** — exact step-by-step procedure with tool names spelled out
- **Output contract** — the file or reply shape downstream agents expect

PM's persona is the longest — it owns the whole workflow.

### 2. Agent-to-agent calls go through `sessions_send`

OpenClaw's `sessions_send` tool lets one agent send a message to another agent's session and wait for a reply:

```
sessions_send({
  sessionKey: "agent:techlead:main",
  message: "<full SPEC content + ask>",
  timeoutSeconds: 600
})
```

For this to work across agents, two config flags must be on (the `setup-company.sh` script does this for you):

```bash
openclaw config set tools.sessions.visibility '"all"' --strict-json
openclaw config set tools.agentToAgent \
  '{"enabled":true,"allow":["pm","techlead","eng-be","eng-fe","qa","devops","designer","writer","main"]}' \
  --strict-json
openclaw daemon restart
```

Without `agentToAgent.enabled=true`, sessions are visible but cross-agent send is blocked.

### 3. Artifacts live in a shared workspace

All projects land at `~/.openclaw/company/projects/<slug>/`. Every agent reads from and writes to the same directory, so the BE engineer can see what the FE engineer wrote, QA can read both, etc.

### 4. The full pipeline (PM's `STRICT workflow`)

```
1. Clarify (1 round max)
2. PM writes  ─────────►  SPEC.md
3. PM asks  ─sessions_send─►  Tech Lead writes TASKS.md
4. PM asks  ─sessions_send─►  Designer writes DESIGN.md (if UI)
5. PM asks  ─sessions_send─►  eng-be writes BE files (loop per task)
   PM asks  ─sessions_send─►  eng-fe writes FE files (loop per task)
6. PM asks  ─sessions_send─►  QA writes TEST_PLAN.md + TEST_REPORT.md
7. PM asks  ─sessions_send─►  DevOps starts service + smoke test
8. PM asks  ─sessions_send─►  Writer creates README.md
9. PM reports back to boss (1 paragraph)
```

After every worker reply, PM is required to verify the claimed file exists with `read` (the **trust-but-verify** rule, see Caveats).

---

## Caveats

These aren't optional reading. **Local 8B-14B models cannot match Claude or GPT-5 at multi-step orchestration**, and you will hit each of these:

### 1. Workers will lie about file writes

The single most common failure: a worker claims "I wrote `TASKS.md` with 6 tasks" but never actually invoked the `write` tool — the file isn't on disk. This is pattern-matching, not malice. Each worker persona therefore opens with a `⚠️ CRITICAL — READ FIRST` block screaming "use the tool". PM is also instructed to `read` the file after every claim and **retry on missing files**.

### 2. Reasoning models ≠ tool-use models

`deepseek-r1:14b` looks attractive for the Tech Lead, but R1 is optimized for chain-of-thought, not tool calling. Empirically it returns text that *describes* the file content instead of calling `write`. The default config uses `qwen3:8b` for Tech Lead. If you really want R1: `USE_THINKING_FOR_TECHLEAD=1 bash setup-company.sh`.

### 3. RAM and the cost of model swapping

On a 36 GB Mac, Ollama can keep 1-2 medium models hot. With 6 agents on `qwen3:8b` and 2 on `qwen2.5-coder:7b`, you'll see swaps when the team alternates between roles. Each swap adds 5-15 seconds of cold-start. Expect end-to-end pipeline runs of **20-60 minutes** for a small project.

### 4. Failure cascades

Tech Lead writes a sloppy `TASKS.md` → eng-be picks the wrong dependencies → QA can't run the tests → DevOps can't start the service → README is wrong. Each step amplifies upstream errors. For now this means: **don't expect the company to ship anything you'd put in production**. Use it for personal scripts, weekend toys, and exploring orchestration patterns.

### 5. No sandbox by default

Workers can write anywhere PM can. The default install does NOT enable Docker sandboxing. Add Colima + sandbox before letting the company touch anything you care about:

```bash
brew install colima docker
colima start
openclaw config set agents.defaults.sandbox.mode '"non-main"' --strict-json
openclaw daemon restart
```

The PM remains on the host (it's the orchestrator); workers run isolated.

---

## Tweak the team

Everything is plain text:

| What you want                                  | Where to edit                                                    |
|------------------------------------------------|------------------------------------------------------------------|
| Change a role's behavior                       | `~/.openclaw/company/agents-workspaces/<id>/AGENTS.md`           |
| Swap a model                                   | `openclaw agents delete <id> --force` then `openclaw agents add <id> --model ollama/<new> --workspace <ws>` |
| Add a new role (e.g. `marketing`)              | Same `add` flow + write a fresh `AGENTS.md` + add the id to `tools.agentToAgent.allow` |
| Tighten what tools a worker can use            | Per-agent `tools.profile` in `~/.openclaw/openclaw.json`         |
| Route Telegram → PM directly                   | `openclaw agents bind --agent pm --bind telegram` (channel must be configured first) |

After persona edits, **reset the agent's session** so the new system prompt takes effect:

```bash
echo '{}' > ~/.openclaw/agents/<id>/sessions/sessions.json
openclaw daemon restart
```

---

## Try it

Three example boss prompts (paste into PM):

**Stock viewer (web app)**
```
Build me a tiny website where I can type a stock ticker and see its current price plus a 30-day chart. Path: ~/.openclaw/company/projects/stock-viewer/. Local Flask, dark theme, yfinance for data, handle invalid tickers gracefully.
```

**Pomodoro timer (CLI)**
```
Build me a Python pomodoro CLI. Path: ~/.openclaw/company/projects/pomodoro/. Args: --work 25 --break 5 --rounds 4. Big terminal countdown, system bell on each interval.
```

**Notes search (CLI)**
```
Build me a Python CLI that searches ~50 markdown files in ~/Documents/notes/ and returns top 5 matches with a 1-line snippet. Path: ~/.openclaw/company/projects/notes-search/. Stdlib only.
```

Then watch the artifacts appear:

```bash
watch -n 2 ls -la ~/.openclaw/company/projects/<slug>/
```

---

## When it goes wrong

| Symptom                                        | Likely cause + fix                                                |
|------------------------------------------------|-------------------------------------------------------------------|
| `provider/model overrides not authorized`      | You passed `--model` to `openclaw agent`. Don't — each agent has its own model already.  |
| `No API key found for provider "openai"`       | An old session was created when the default model was an OpenAI placeholder. Reset that agent's `sessions.json`. |
| `Unknown model: ollama/...`                    | Add `OLLAMA_API_KEY=local` to `~/.openclaw/service-env/ai.openclaw.gateway.env` then `openclaw daemon restart`. |
| Worker replies "done" but file isn't on disk   | The model lied. Check the `read` retry happened in PM's session; consider re-running with stronger persona language. |
| Round trip takes 5+ minutes                    | Ollama cold-loaded the model. Subsequent calls reuse the loaded weights for ~5 minutes (configurable via `OLLAMA_KEEP_ALIVE`). |
| `The session send visibility is restricted`    | `tools.sessions.visibility` is still `tree` (the default). Set to `"all"` and restart gateway. |
| `agent-to-agent messaging not allowed`         | `tools.agentToAgent.enabled` is false or the target agent isn't in `allow`. |

---

## Files in this repo

- [`setup-company.sh`](../setup-company.sh) — idempotent installer
- [`docs/company.md`](./company.md) — this page
- Each agent's `AGENTS.md` is created on disk under `~/.openclaw/company/agents-workspaces/<id>/`

---

## Next steps the company can't do for you (yet)

- Push code to GitHub (DevOps doesn't have credentials)
- Deploy to a real host (intentional, no internet writes)
- Long projects spanning multiple boss sessions (no persistent memory across separate boss requests yet — coming via OpenClaw's `memory_*` tools)
- Real human-in-the-loop review (the boss is the final reviewer)

PRs welcome to extend this blueprint.
