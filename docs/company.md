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
| `pm`        | `gpt-oss:20b`        | Boss's only contact; orchestrates everyone else  |
| `techlead`  | `gpt-oss:20b`        | Picks stack, breaks SPEC into 3-8 tasks          |
| `designer`  | `gpt-oss:20b`        | UX flow + page layout + copy                     |
| `eng-be`    | `qwen2.5-coder:7b`   | Backend implementation                           |
| `eng-fe`    | `qwen2.5-coder:7b`   | Frontend implementation                          |
| `qa`        | `gpt-oss:20b`        | Test plan + actual smoke tests                   |
| `devops`    | `gpt-oss:20b`        | Starts the project, curls it, reports HTTP code  |
| `writer`    | `gpt-oss:20b`        | Writes the README                                |

Total disk: **~18 GB** of model files (`gpt-oss:20b` ≈ 13 GB, `qwen2.5-coder:7b` ≈ 5 GB).

**Why `gpt-oss:20b` for orchestration?** It is OpenAI's open-weights model trained for agentic tool use. In our smoke tests it reliably calls `sessions_send` and `write` on the first try, while smaller models (or reasoning-first models like DeepSeek-R1) often *describe* the call instead of making it. All 6 orchestration agents share one loaded copy in RAM, so no model swap penalty between them. If you're tight on RAM, `FAST=1 bash setup-company.sh` falls back to `qwen3:8b` for orchestration (~9 GB total).

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
6. PM asks  ─sessions_send─►  QA writes TEST_PLAN.md + TEST_REPORT.md  ←─┐
                                ❘ requires "## Summary\nPASS: X/Y" X==Y │ retry
7. PM asks  ─sessions_send─►  DevOps starts + smoke tests              │ up to
                                ❘ requires <RESULT>PASS</RESULT> tag    │ 2-3
                                ❘ on the LAST line of the reply        ─┘ rounds
8. PM asks  ─sessions_send─►  Writer creates README.md
9. PM writes  ─────────►  STATUS.json (phase: complete | failed)
                            ↳ dashboard fires desktop notification + chime
10. PM reports back to boss (1 paragraph, honest)
```

**Two structural gates, not honor-system rules:**

- **QA evidence gate** — every scenario in `TEST_REPORT.md` must include `Exit code: <N>` captured via `; echo "<EXIT=$?>"`. Verdict comes from the exit code, not opinion. Reports without exit codes are rejected by PM.
- **DevOps result gate** — the last line of DevOps's reply must be `<RESULT>PASS</RESULT>` or `<RESULT>FAIL</RESULT>`. PM greps for the tag. PASS requires `<HTTP=2xx>` actually appearing in DevOps's EVIDENCE block. No tag = retry; FAIL = send back to engineer to fix.

If either gate fails after retries, PM stamps `STATUS.json` with `phase: failed` plus a `reason` field. The dashboard fires a red "BUILD FAILED" banner + descending failure tone (different from the success chime), so you know without looking which one happened.

After every worker reply, PM is required to verify the claimed file exists with `read` (the **trust-but-verify** rule, see Caveats).

---

## Lane discipline — agents stay in their job description

Each persona has an explicit `🚧 Stay in your lane` block that lists ALLOWED `write` paths and FORBIDDEN ones. The contract is:

| Agent | ALLOWED writes | NEVER writes |
|---|---|---|
| `pm` | `SPEC.md`, `STATUS.json`, optional `PROGRESS.md` | any code file, all other `.md` |
| `techlead` | `TASKS.md`, `ARCHITECTURE.md` | any code, other agents' docs |
| `eng-be` | `*.py`, `requirements.txt`, `Dockerfile`, sub-modules under project root | `templates/`, `static/`, `*.html`, `*.css`, `*.js`, all docs |
| `eng-fe` | `templates/*.html`, `static/{css,js,img}` | any `.py`, `requirements.txt`, all docs |
| `qa` | `TEST_PLAN.md`, `TEST_REPORT.md` | any code, other agents' docs |
| `devops` | (almost always nothing — output is the EVIDENCE block); optional `DEPLOY.md` | any code, all other docs |
| `designer` | `DESIGN.md` | any code, other agents' docs |
| `writer` | `README.md`, optional `CHANGELOG.md` | any code, other agents' docs |

When PM hands an agent something outside its lane, that agent replies with a literal three-line **`OUT OF LANE`** signal:

```
OUT OF LANE: <one-line description of what was asked>
ROUTE TO: <correct agent id>
REASON: <one line>
```

PM's persona has a matching rule: when it sees `OUT OF LANE: …`, it **re-dispatches** the same task to the named agent — never patches the file itself, never argues with the worker.

This solves three real failure modes from the previous build:

1. **PM patching code mid-FIX.** During a self-heal run, PM was directly writing `templates/index.html` instead of dispatching `eng-fe`. The boss saw the project work, but the team's autonomy was a fiction. With lane locks, PM physically can't justify writing `.html` — it dispatches every time.
2. **eng-be inventing a stub HTML.** When asked to "make sure the page works", the backend engineer was inlining a placeholder template "for now". Now it bounces with `ROUTE TO: eng-fe` and the right person gets the work.
3. **QA / DevOps absorbing fixes.** Both used to occasionally edit a missing import while smoke-testing. Now they REPORT the bug in their evidence and PM routes the fix.

## Caveats

These aren't optional reading. **Local 8B-14B models cannot match Claude or GPT-5 at multi-step orchestration**, and you will hit each of these:

### 1. Workers will lie about file writes

The single most common failure: a worker claims "I wrote `TASKS.md` with 6 tasks" but never actually invoked the `write` tool — the file isn't on disk. This is pattern-matching, not malice. Each worker persona therefore opens with a `⚠️ CRITICAL — READ FIRST` block screaming "use the tool". PM is also instructed to `read` the file after every claim and **retry on missing files**.

### 2. Reasoning models ≠ tool-use models

`deepseek-r1:14b` looks attractive for the Tech Lead, but R1 is optimized for chain-of-thought, not tool calling. Empirically it returns text that *describes* the file content instead of calling `write`. The default config uses `qwen3:8b` for Tech Lead. If you really want R1: `USE_THINKING_FOR_TECHLEAD=1 bash setup-company.sh`.

### 3. RAM and the cost of model swapping

On a 36 GB Mac, Ollama can keep 1-2 medium models hot. With 6 agents on `qwen3:8b` and 2 on `qwen2.5-coder:7b`, you'll see swaps when the team alternates between roles. Each swap adds 5-15 seconds of cold-start. Expect end-to-end pipeline runs of **20-60 minutes** for a small project.

### 4. Failure cascades

Tech Lead writes a sloppy `TASKS.md` → eng-be picks the wrong dependencies → QA can't run the tests → DevOps can't start the service → README is wrong. Each step amplifies upstream errors.

The QA + DevOps gates (see §4 of "Two structural gates" above) catch the most common cascade — workers claiming success when nothing actually runs. With gates active, a project that doesn't really start ships as `phase: failed` with a useful `reason`, instead of as `phase: complete` with broken code. **You'll still see failures, but you'll know about them.**

For now: **don't expect the company to ship anything you'd put in production**. Use it for personal scripts, weekend toys, and exploring orchestration patterns.

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

## Watch it work — the Boss Dashboard

A tiny Flask app gives you a live, three-column view: agents, projects, message stream — plus a footer to send the boss's next instruction. One command:

```bash
bash setup-dashboard.sh   # → http://127.0.0.1:5050
```

What you see:

- **Left** — 8 agent cards with model + activity timestamps; the active agent's card glows in lobster orange.
- **Middle** — every project under `~/.openclaw/company/projects/`; click a project to inspect SPEC.md / TASKS.md / DESIGN.md / source files / TEST_REPORT.md / README.md in tabs.
- **Right** — combined timeline of all messages across all agents. Inter-session (agent→agent) messages are highlighted; tool calls are visible inline.
- **Bottom** — type the next request, hit `Send` (or `Cmd/Ctrl+Enter`); it spawns `openclaw agent --agent pm --message "..."` and tails the log.

Files: [`boss-dashboard/`](../boss-dashboard/) — `app.py` (Flask, ~250 lines), `index.html`, `styles.css`, `app.js`. No build step.

> Don't expose port 5050 publicly — the boss endpoint has full execution authority over your PM agent.

## Try it

Three example boss prompts (paste into PM, or into the dashboard footer):

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
