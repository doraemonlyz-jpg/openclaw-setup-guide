# Boss Dashboard

A tiny single-file Flask app that visualises your AI software studio. Three columns, one boss-input footer, no build step. **Cyberpunk** theme: neon cyan + magenta + matrix green over a dark grid background, CRT scanlines overlay, clip-path corners, glow on every accent.

```
┌────────────────────────────────────────────────────────────────────┐
│  🦞  Boss Console — 8-agent AI software studio                      │
├──────────────┬─────────────────────────────┬───────────────────────┤
│ AGENTS       │ PROJECTS                    │ LIVE ACTIVITY         │
│              │                             │                       │
│ ● pm         │ ▸ stock-viewer              │ [16:53] PM → write    │
│   gpt-oss:20b│ ▸ pomodoro                  │ [16:54] PM → techlead │
│   12 msgs    │ ▸ notes-search              │ [16:55] tl: TASKS.md  │
│              │                             │ [16:55] PM: report    │
│ ○ techlead   │  (click to inspect files)   │                       │
│ ○ eng-be     │                             │                       │
│   ...        │                             │                       │
├──────────────┴─────────────────────────────┴───────────────────────┤
│ 老板下指令 / Boss says: [textarea_______________________] [Send →]  │
└────────────────────────────────────────────────────────────────────┘
```

## What you see

- **Left** — 8 agents with their model, message count, last-active timestamp. Cards glow with the lobster accent when the agent's session was modified in the last 60 s.
- **Middle** — every project under `~/.openclaw/company/projects/`. Click one to inspect SPEC.md / TASKS.md / DESIGN.md / source files / TEST_REPORT.md / README.md in tabs.
- **Right** — combined timeline of every message in every agent's session, **oldest at top, newest at bottom (terminal-style)**. The view auto-scrolls to follow new messages when you're at the bottom; if you scroll up to read history, scrolling stops to not yank you around. A floating `▼ LIVE` button appears top-right when there's catch-up to do — click it to jump back to the latest. Inter-session (agent→agent) messages glow magenta; tool calls glow yellow; assistant replies glow green. Polls every 3 seconds.
- **Bottom** — type a request and hit `Send` (or `Cmd/Ctrl+Enter`). It spawns `openclaw agent --agent pm --message "..."` in the background and tails the log inline.

## Run it

```bash
pip3 install flask --break-system-packages   # (or in a venv)
cd boss-dashboard
python3 app.py
# → http://127.0.0.1:5050
```

The app reads from `~/.openclaw/` directly — there's no shared state with the Flask process, so kill/restart at will.

## Files

- `app.py` — Flask backend, ~250 lines. Six endpoints (`/api/agents`, `/api/projects`, `/api/projects/<slug>/file`, `/api/activity`, `/api/boss/send`, `/api/boss/log`) plus static.
- `index.html` — single-page UI scaffold.
- `styles.css` — lobster + ocean blue theme matching the main project site.
- `app.js` — client polling + interactivity. No framework, just `fetch` + DOM.

## Caveats

- Polling, not WebSockets — there can be a 3-6 s lag.
- The "boss send" endpoint shells out to `openclaw agent ...`; if that command isn't on PATH the request will fail.
- The activity tab only reads each agent's **most recent** session. Older sessions are ignored. Reset via `echo '{}' > ~/.openclaw/agents/<id>/sessions/sessions.json`.
- Designed for `127.0.0.1` only. Don't expose this on a public network — it has full execution authority over your PM agent.
