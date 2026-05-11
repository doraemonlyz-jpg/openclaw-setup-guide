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
import re
import shutil
import signal
import socket
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
RUNNING_STATE = OPENCLAW / "boss-dashboard" / "running.json"
RUN_LOG_DIR = Path("/tmp/boss-dashboard-runs")
RUN_LOG_DIR.mkdir(exist_ok=True)

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


_IGNORE_DIRS = {"__pycache__", ".venv", "venv", "node_modules", ".git",
                "dist", "build", ".pytest_cache", ".mypy_cache", ".idea",
                ".vscode", ".tox", ".cache"}


def list_projects() -> list[dict[str, Any]]:
    out = []
    if not PROJECTS.exists():
        return out
    for p in sorted(PROJECTS.iterdir(), key=lambda p: -p.stat().st_mtime if p.is_dir() else 0):
        if not p.is_dir():
            continue
        files = []
        for f in sorted(p.rglob("*")):
            if not f.is_file():
                continue
            if f.name.startswith("."):
                continue
            # Skip noise dirs anywhere in the path (venv, cache, deps, ...)
            if set(f.relative_to(p).parts) & _IGNORE_DIRS:
                continue
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

    running_state = _load_running()
    # Garbage-collect dead pids before we trust the state
    dirty = False
    for slug in list(running_state.keys()):
        if not _pid_alive(running_state[slug].get("pid", 0)):
            running_state.pop(slug)
            dirty = True
    if dirty:
        _save_running(running_state)

    projects: list[dict[str, Any]] = []
    if PROJECTS.exists():
        for p in sorted(PROJECTS.iterdir(),
                        key=lambda x: -x.stat().st_mtime if x.is_dir() else 0):
            if not p.is_dir():
                continue

            # Skip noise dirs (cache, venv, deps) — they confuse "recently modified"
            files = [
                f for f in p.rglob("*")
                if f.is_file()
                and not f.name.startswith(".")
                and not (set(f.relative_to(p).parts) & _IGNORE_DIRS)
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

            run_info = running_state.get(p.name)
            entry_detected = _detect_entry(p)
            runnable = entry_detected is not None

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
                "runnable": runnable,
                "entry": entry_detected[0] if entry_detected else None,
                "entry_kind": entry_detected[1] if entry_detected else None,
                "running": run_info,  # null if not running, else {pid, port, url, ...}
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


# ════════════════════════════════════════════════════════════════
# PROJECT RUNNER — start/stop/inspect a project's actual server
# ════════════════════════════════════════════════════════════════
#
# State shape (persisted to RUNNING_STATE so dashboard restart doesn't lose
# track of processes that are still alive):
#   { "<slug>": {
#       "pid": 12345,
#       "port": 5099,
#       "entry": "app.py",
#       "kind": "flask"|"static"|"node",
#       "started_at": <epoch>,
#       "log": "/tmp/boss-dashboard-runs/<slug>.log",
#       "url": "http://127.0.0.1:5099/"
#   } }


def _load_running() -> dict[str, dict]:
    if not RUNNING_STATE.exists():
        return {}
    try:
        return json.loads(RUNNING_STATE.read_text())
    except Exception:
        return {}


def _save_running(state: dict[str, dict]) -> None:
    RUNNING_STATE.parent.mkdir(parents=True, exist_ok=True)
    RUNNING_STATE.write_text(json.dumps(state, indent=2))


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    # First reap if it's a zombie child of ours — otherwise os.kill(pid, 0)
    # succeeds on zombies and we'd report dead processes as alive.
    try:
        done_pid, _ = os.waitpid(pid, os.WNOHANG)
        if done_pid == pid:
            return False
    except (ChildProcessError, OSError):
        pass
    try:
        os.kill(pid, 0)
        return True
    except (ProcessLookupError, PermissionError):
        return False
    except Exception:
        return False


def _free_port(start: int = 5099, end: int = 5199) -> int | None:
    """Find a free TCP port on 127.0.0.1 in the given range."""
    for p in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return None


def _detect_entry(project: Path) -> tuple[str, str, int | None] | None:
    """Return (entry_file, kind, declared_port) or None if no entry found.

    kind ∈ {"flask", "python", "static", "node"}
    declared_port: parsed from app.run(port=N) if present, else None
    """
    candidates = ["app.py", "main.py", "server.py", "run.py", "wsgi.py"]
    for c in candidates:
        f = project / c
        if f.is_file():
            try:
                src = f.read_text(errors="replace")
            except Exception:
                src = ""
            kind = "flask" if "flask" in src.lower() else "python"
            port = None
            m = re.search(r"\.run\([^)]*port\s*=\s*(\d+)", src)
            if m:
                try: port = int(m.group(1))
                except ValueError: pass
            return (c, kind, port)
    if (project / "package.json").is_file():
        return ("package.json", "node", None)
    if (project / "index.html").is_file():
        return ("index.html", "static", None)
    return None


def _ensure_venv(project: Path) -> Path:
    """Create .venv in project if missing; install requirements.txt if present.

    Returns path to the venv's python interpreter.
    """
    venv = project / ".venv"
    py = venv / "bin" / "python"
    if not py.exists():
        subprocess.run(
            ["python3", "-m", "venv", str(venv)],
            check=False, capture_output=True, timeout=60,
        )
    pip = venv / "bin" / "pip"
    req = project / "requirements.txt"
    if req.is_file() and pip.exists():
        try:
            subprocess.run(
                [str(pip), "install", "-q", "--disable-pip-version-check",
                 "-r", str(req)],
                check=False, capture_output=True, timeout=180,
            )
        except subprocess.TimeoutExpired:
            pass
    return py if py.exists() else Path("python3")


def _start_process(slug: str, project: Path) -> tuple[bool, dict]:
    """Start the project. Returns (ok, info-or-error)."""
    detected = _detect_entry(project)
    if not detected:
        return False, {"error": "no entry point found",
                       "detail": "looked for app.py / main.py / server.py / index.html"}
    entry, kind, declared_port = detected

    port = declared_port if declared_port and _is_port_free(declared_port) else _free_port()
    if not port:
        return False, {"error": "no free port", "detail": "tried 5099-5199"}

    log_path = RUN_LOG_DIR / f"{slug}.log"
    log_fh = open(log_path, "w")

    if kind == "flask":
        py = _ensure_venv(project)
        # Flask apps usually do `if __name__ == "__main__": app.run(...)`. When
        # we import them as a module, that block won't fire — perfect, we
        # control the port. Always use the shim so the user sees the app on
        # the port we promised them, not whatever Flask happens to pick.
        mod_name = entry[:-3] if entry.endswith(".py") else entry
        shim = (
            "import sys\n"
            "sys.path.insert(0, '.')\n"
            f"import {mod_name} as _mod\n"
            "app = getattr(_mod, 'app', None) or getattr(_mod, 'application', None)\n"
            f"if app is None: raise SystemExit('no Flask app object found in {entry}')\n"
            f"app.run(host='127.0.0.1', port={port}, debug=False, use_reloader=False)\n"
        )
        cmd = [str(py), "-c", shim]
    elif kind == "python":
        py = _ensure_venv(project)
        cmd = [str(py), entry]
    elif kind == "static":
        cmd = ["python3", "-m", "http.server", str(port),
               "--bind", "127.0.0.1", "--directory", str(project)]
    elif kind == "node":
        cmd = ["npm", "start"]
    else:
        return False, {"error": "unsupported kind", "kind": kind}

    try:
        proc = subprocess.Popen(
            cmd, cwd=str(project),
            stdout=log_fh, stderr=subprocess.STDOUT,
            stdin=subprocess.DEVNULL,
            start_new_session=True,
        )
    except Exception as e:
        return False, {"error": "spawn failed", "detail": str(e)}

    # Wait briefly to detect immediate boot crash
    time.sleep(2.5)
    if not _pid_alive(proc.pid):
        try: tail = "\n".join(log_path.read_text(errors="replace").splitlines()[-20:])
        except Exception: tail = ""
        return False, {"error": "process died on boot",
                       "log_tail": tail, "log": str(log_path)}

    info = {
        "pid": proc.pid,
        "port": port,
        "entry": entry,
        "kind": kind,
        "started_at": int(time.time()),
        "log": str(log_path),
        "url": f"http://127.0.0.1:{port}/",
    }
    return True, info


def _is_port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _stop_process(slug: str, info: dict) -> bool:
    pid = info.get("pid")
    if not pid or not _pid_alive(pid):
        return True
    try:
        os.killpg(os.getpgid(pid), signal.SIGTERM)
    except Exception:
        try: os.kill(pid, signal.SIGTERM)
        except Exception: pass
    # Give it 1.5s to die gracefully, then SIGKILL
    for _ in range(15):
        if not _pid_alive(pid):
            return True
        time.sleep(0.1)
    try:
        os.killpg(os.getpgid(pid), signal.SIGKILL)
    except Exception:
        try: os.kill(pid, signal.SIGKILL)
        except Exception: pass
    return not _pid_alive(pid)


def _project_path(slug: str) -> Path | None:
    """Resolve and validate a project slug → safe absolute path inside PROJECTS."""
    if not slug or "/" in slug or ".." in slug or slug.startswith("."):
        return None
    p = (PROJECTS / slug).resolve()
    try:
        p.relative_to(PROJECTS.resolve())
    except ValueError:
        return None
    if not p.exists() or not p.is_dir():
        return None
    return p


# ────────── Runner endpoints ──────────

@app.route("/api/projects/<slug>/run", methods=["POST"])
def api_project_run(slug: str):
    project = _project_path(slug)
    if not project:
        return jsonify({"error": "project not found"}), 404

    state = _load_running()
    existing = state.get(slug)
    if existing and _pid_alive(existing.get("pid", 0)):
        return jsonify({"ok": True, "already_running": True, **existing})

    # Stale entry — clean up
    if existing:
        state.pop(slug, None)

    ok, info = _start_process(slug, project)
    if not ok:
        return jsonify({"ok": False, **info}), 500

    state[slug] = info
    _save_running(state)
    return jsonify({"ok": True, **info})


@app.route("/api/projects/<slug>/stop", methods=["POST"])
def api_project_stop(slug: str):
    state = _load_running()
    info = state.get(slug)
    if not info:
        return jsonify({"ok": True, "was_running": False})
    stopped = _stop_process(slug, info)
    state.pop(slug, None)
    _save_running(state)
    return jsonify({"ok": stopped, "was_running": True, "pid": info.get("pid")})


@app.route("/api/projects/<slug>/run-tail")
def api_project_run_tail(slug: str):
    state = _load_running()
    info = state.get(slug)
    log_path = (info or {}).get("log") or str(RUN_LOG_DIR / f"{slug}.log")
    p = Path(log_path)
    if not p.exists():
        return jsonify({"log": "", "alive": False})
    try:
        content = p.read_text(errors="replace")[-4000:]
    except Exception as e:
        content = f"(read failed: {e})"
    return jsonify({
        "log": content,
        "alive": bool(info and _pid_alive(info.get("pid", 0))),
        "info": info,
    })


# ────────── Delete endpoint ──────────

@app.route("/api/projects/<slug>", methods=["DELETE"])
def api_project_delete(slug: str):
    project = _project_path(slug)
    if not project:
        return jsonify({"error": "project not found"}), 404

    # Stop any running process for this slug first
    state = _load_running()
    if slug in state:
        _stop_process(slug, state[slug])
        state.pop(slug, None)
        _save_running(state)

    try:
        shutil.rmtree(project)
    except Exception as e:
        return jsonify({"error": "delete failed", "detail": str(e)}), 500

    # Also remove log
    log = RUN_LOG_DIR / f"{slug}.log"
    if log.exists():
        try: log.unlink()
        except Exception: pass

    return jsonify({"ok": True, "slug": slug})


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
