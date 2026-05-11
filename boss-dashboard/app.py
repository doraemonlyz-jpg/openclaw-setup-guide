#!/usr/bin/env python3
"""Boss Dashboard — a tiny Flask app to watch your AI software studio.

Reads OpenClaw agent metadata + session transcripts from ~/.openclaw/
and exposes a 4-endpoint API. Pairs with index.html in the same directory.

Run: python3 app.py
Open: http://127.0.0.1:5050
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

HOME = Path(os.path.expanduser("~"))
OPENCLAW = HOME / ".openclaw"
COMPANY = OPENCLAW / "company"
PROJECTS = COMPANY / "projects"
WORKSPACES = COMPANY / "agents-workspaces"
AGENTS_DIR = OPENCLAW / "agents"
CONFIG_PATH = OPENCLAW / "openclaw.json"

# The 8 official company agents (order matters for UI display)
COMPANY_AGENTS = [
    ("pm", "Product Manager", "Boss's only contact; orchestrates everyone"),
    ("techlead", "Tech Lead", "Picks stack, breaks SPEC into tasks"),
    ("designer", "Designer", "UX flow + page layout + copy"),
    ("eng-be", "Backend Engineer", "API + data + server-side code"),
    ("eng-fe", "Frontend Engineer", "UI implementation"),
    ("qa", "QA Engineer", "Test plan + smoke tests"),
    ("devops", "DevOps", "Starts service + curls + reports"),
    ("writer", "Tech Writer", "README + docs"),
]

app = Flask(__name__, static_folder=None)


# ────────── helpers ──────────

def load_config() -> dict[str, Any]:
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except Exception:
            return {}
    return {}


def agent_model(agent_id: str) -> str:
    cfg = load_config()
    for a in cfg.get("agents", {}).get("list", []) or []:
        if a.get("id") == agent_id:
            return a.get("model") or "—"
    return "—"


def latest_session_jsonl(agent_id: str) -> Path | None:
    sessions = AGENTS_DIR / agent_id / "sessions"
    if not sessions.exists():
        return None
    candidates = [
        p for p in sessions.glob("*.jsonl")
        if not p.name.endswith(".trajectory.jsonl")
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def parse_session(path: Path, limit: int = 200) -> list[dict[str, Any]]:
    """Return a normalized message list from a session JSONL transcript."""
    if not path or not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        lines = path.read_text(errors="replace").splitlines()
    except Exception:
        return []
    for line in lines:
        try:
            d = json.loads(line)
        except Exception:
            continue
        if d.get("type") != "message":
            continue
        msg = d.get("message", {})
        role = msg.get("role", "?")
        ts_raw = msg.get("timestamp")
        ts = int(ts_raw / 1000) if isinstance(ts_raw, (int, float)) and ts_raw > 1e12 else None
        prov = msg.get("provenance", {})
        kind = "human"
        peer = None
        if prov.get("kind") == "inter_session":
            kind = "agent"
            peer = (prov.get("sourceSessionKey") or "").split(":")[1] if prov.get("sourceSessionKey", "").count(":") >= 2 else None
        text_parts: list[str] = []
        tool_calls: list[dict] = []
        tool_results: list[str] = []
        content = msg.get("content", [])
        if isinstance(content, list):
            for c in content:
                t = c.get("type")
                if t == "text":
                    text_parts.append(c.get("text", ""))
                elif t == "toolCall":
                    tool_calls.append({
                        "name": c.get("name"),
                        "args": c.get("arguments", {}),
                    })
                elif t == "toolResult":
                    tc = c.get("content", [])
                    if isinstance(tc, list):
                        for x in tc:
                            if x.get("type") == "text":
                                tool_results.append(x.get("text", ""))
        out.append({
            "id": d.get("id"),
            "role": role,
            "kind": kind,
            "peer": peer,
            "ts": ts,
            "text": "\n".join(t for t in text_parts if t),
            "tool_calls": tool_calls,
            "tool_results": tool_results,
        })
    return out[-limit:]


def list_projects() -> list[dict[str, Any]]:
    out = []
    if not PROJECTS.exists():
        return out
    for p in sorted(PROJECTS.iterdir(), key=lambda p: -p.stat().st_mtime if p.is_dir() else 0):
        if not p.is_dir():
            continue
        files = []
        for f in sorted(p.rglob("*")):
            if f.is_file() and not f.name.startswith("."):
                rel = str(f.relative_to(p))
                files.append({
                    "path": rel,
                    "size": f.stat().st_size,
                    "modified": int(f.stat().st_mtime),
                })
        out.append({
            "slug": p.name,
            "path": str(p),
            "modified": int(p.stat().st_mtime),
            "files": files,
        })
    return out


# ────────── API endpoints ──────────

@app.route("/api/agents")
def api_agents():
    out = []
    for aid, role, desc in COMPANY_AGENTS:
        model = agent_model(aid)
        sess_path = latest_session_jsonl(aid)
        last_active = None
        msg_count = 0
        if sess_path and sess_path.exists():
            last_active = int(sess_path.stat().st_mtime)
            try:
                msg_count = sum(
                    1 for ln in sess_path.read_text(errors="replace").splitlines()
                    if json.loads(ln).get("type") == "message"
                ) if sess_path.stat().st_size > 0 else 0
            except Exception:
                pass
        # Heuristic: agent "busy" if its session was modified in last 60s
        busy = bool(last_active and (time.time() - last_active < 60))
        out.append({
            "id": aid,
            "role": role,
            "description": desc,
            "model": model,
            "last_active": last_active,
            "msg_count": msg_count,
            "busy": busy,
        })
    return jsonify({"agents": out, "now": int(time.time())})


@app.route("/api/projects")
def api_projects():
    return jsonify({"projects": list_projects()})


@app.route("/api/projects/<slug>/file")
def api_project_file(slug: str):
    rel = request.args.get("path", "")
    if not rel or ".." in rel:
        return jsonify({"error": "bad path"}), 400
    full = (PROJECTS / slug / rel).resolve()
    if not str(full).startswith(str(PROJECTS.resolve())):
        return jsonify({"error": "escape attempt"}), 400
    if not full.exists() or not full.is_file():
        return jsonify({"error": "not found"}), 404
    try:
        return jsonify({
            "path": rel,
            "content": full.read_text(errors="replace"),
            "size": full.stat().st_size,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/run-status")
def api_run_status():
    """Per-project run status + global agent activity.

    Frontend uses this to detect running→complete transitions and fire
    desktop notifications, sound, and the completion banner.

    Status sources, in priority order:
      1. STATUS.json in the project dir (authoritative — PM writes it)
      2. Heuristic: file mtimes + agent session activity
    """
    now = time.time()

    # Global: which agents have been touched in the last minute?
    busy_agents: list[str] = []
    most_recent_agent_activity = 0
    for aid, *_ in COMPANY_AGENTS:
        sess = latest_session_jsonl(aid)
        if not sess:
            continue
        m = sess.stat().st_mtime
        most_recent_agent_activity = max(most_recent_agent_activity, m)
        if now - m < 60:
            busy_agents.append(aid)
    any_agent_active = bool(busy_agents)

    projects: list[dict[str, Any]] = []
    if PROJECTS.exists():
        for p in sorted(PROJECTS.iterdir(),
                        key=lambda x: -x.stat().st_mtime if x.is_dir() else 0):
            if not p.is_dir():
                continue

            # Skip noise dirs (cache, venv, deps) — they confuse "recently modified"
            ignore_parts = {"__pycache__", ".venv", "venv", "node_modules",
                            ".git", "dist", "build", ".pytest_cache", ".mypy_cache"}
            files = [
                f for f in p.rglob("*")
                if f.is_file()
                and not f.name.startswith(".")
                and not (set(f.relative_to(p).parts) & ignore_parts)
            ]
            file_count = len(files)
            mtimes = [f.stat().st_mtime for f in files] or [p.stat().st_mtime]
            last_file_mtime = max(mtimes)
            first_file_mtime = min(mtimes) if files else last_file_mtime

            has_readme = (p / "README.md").exists()
            code_exts = {".py", ".js", ".ts", ".jsx", ".tsx", ".go",
                         ".rs", ".java", ".html", ".css", ".sh"}
            has_code = any(f.suffix in code_exts for f in files)

            # Was this project touched recently?
            recently_modified = (now - last_file_mtime) < 90

            # Read explicit STATUS.json if present
            explicit: dict[str, Any] | None = None
            sj = p / "STATUS.json"
            if sj.exists():
                try:
                    explicit = json.loads(sj.read_text())
                except Exception:
                    explicit = None

            # Decide phase. STATUS.json wins; otherwise project-local mtime
            # is the only "running" signal — global agent activity does NOT
            # imply this particular project is being worked on.
            if explicit and explicit.get("phase"):
                phase = explicit["phase"]
                source = "explicit"
            elif recently_modified:
                phase = "running"
                source = "heuristic"
            elif has_readme and has_code:
                phase = "complete"
                source = "heuristic"
            elif file_count > 0:
                phase = "stalled"
                source = "heuristic"
            else:
                phase = "empty"
                source = "heuristic"

            projects.append({
                "slug": p.name,
                "phase": phase,
                "source": source,
                "started_at": int(first_file_mtime),
                "last_file_mtime": int(last_file_mtime),
                "ended_at": int(explicit.get("ended_at", last_file_mtime)) if explicit else int(last_file_mtime),
                "duration_sec": int(last_file_mtime - first_file_mtime),
                "file_count": file_count,
                "has_readme": has_readme,
                "has_code": has_code,
                "recently_modified": recently_modified,
                "explicit": explicit,
            })

    return jsonify({
        "now": int(now),
        "any_agent_active": any_agent_active,
        "busy_agents": busy_agents,
        "most_recent_agent_activity": int(most_recent_agent_activity),
        "projects": projects,
    })


@app.route("/api/activity")
def api_activity():
    """Combined timeline of recent messages across all company agents."""
    limit_per_agent = int(request.args.get("limit", "30"))
    items: list[dict] = []
    for aid, role, _desc in COMPANY_AGENTS:
        sess = latest_session_jsonl(aid)
        if not sess:
            continue
        msgs = parse_session(sess, limit=limit_per_agent)
        for m in msgs:
            m["agent"] = aid
            m["agent_role"] = role
            items.append(m)
    items.sort(key=lambda m: m.get("ts") or 0)
    return jsonify({"items": items[-200:], "now": int(time.time())})


@app.route("/api/boss/send", methods=["POST"])
def api_boss_send():
    """Send a message from the boss to PM. Runs `openclaw agent` in background."""
    data = request.get_json(silent=True) or {}
    msg = (data.get("message") or "").strip()
    if not msg:
        return jsonify({"error": "empty message"}), 400
    log_dir = Path("/tmp")
    ts = int(time.time())
    log_path = log_dir / f"boss-msg-{ts}.log"
    try:
        proc = subprocess.Popen(
            ["openclaw", "agent", "--agent", "pm",
             "--message", msg, "--thinking", "off"],
            stdout=open(log_path, "w"), stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
        return jsonify({
            "ok": True,
            "pid": proc.pid,
            "log": str(log_path),
            "started_at": ts,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/boss/log")
def api_boss_log():
    """Tail the latest boss-message log."""
    logs = sorted(Path("/tmp").glob("boss-msg-*.log"),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    if not logs:
        return jsonify({"log": "", "path": None})
    latest = logs[0]
    try:
        content = latest.read_text(errors="replace")
    except Exception:
        content = ""
    return jsonify({
        "path": str(latest),
        "log": content[-8000:],
        "modified": int(latest.stat().st_mtime),
    })


# ────────── static UI ──────────

@app.route("/")
def index():
    return send_from_directory(Path(__file__).parent, "index.html")


@app.route("/<path:filename>")
def static_files(filename: str):
    return send_from_directory(Path(__file__).parent, filename)


if __name__ == "__main__":
    print("Boss Dashboard → http://127.0.0.1:5050")
    print(f"  watching: {COMPANY}")
    print(f"  agents:   {len(COMPANY_AGENTS)}")
    app.run(host="127.0.0.1", port=5050, debug=False)
