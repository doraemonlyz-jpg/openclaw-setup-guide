"""
SRE Command Center — Flask dashboard for the multi-agent incident-response system.

v0 endpoints:
  GET  /                                serves the UI (index.html)
  GET  /api/scenarios                   list available demo scenarios
  POST /api/incidents/fire              fire a (mock) alert -> spawns Incident PM
  GET  /api/incidents                   list all incidents (active + resolved)
  GET  /api/incidents/<id>              get full incident state + findings
  POST /api/incidents/<id>/post-slack   (stub) posts the summary to Slack
  POST /api/sre/datadog/logs            mock Datadog logs API (read by Log Detective)
  POST /api/sre/datadog/metrics         mock Datadog metrics API
  POST /api/sre/datadog/traces          mock Datadog APM API
  POST /api/sre/deploys                 mock deploy / git history API

In v0 we DO NOT actually spawn openclaw agents — we run a deterministic
in-process pipeline using the scenario data. That makes the demo bullet-proof
and lets users test the UX without a working Ollama install.
v0.5 will add `--spawn-real-agents` to call openclaw for real.
"""

from __future__ import annotations

import json
import os
import time
import uuid
import threading
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, request, send_from_directory

# ---------------------------------------------------------------------------
# Constants & paths
# ---------------------------------------------------------------------------

PORT = int(os.environ.get("SRE_PORT", "5060"))
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MOCK_PATH = ROOT / "mocks" / "scenarios.json"
INCIDENTS_DIR = Path.home() / ".openclaw" / "sre" / "incidents"
INCIDENTS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Mock data loading
# ---------------------------------------------------------------------------

with MOCK_PATH.open("r", encoding="utf-8") as f:
    SCENARIOS: dict[str, dict[str, Any]] = {s["id"]: s for s in json.load(f)["scenarios"]}


def _scenario_for_service(service: str) -> dict[str, Any] | None:
    for s in SCENARIOS.values():
        if s["alert"]["service"] == service:
            return s
    return None


# ---------------------------------------------------------------------------
# In-memory incident store + simulated pipeline
# ---------------------------------------------------------------------------

# incident_id -> dict
INCIDENTS: dict[str, dict[str, Any]] = {}
INCIDENTS_LOCK = threading.Lock()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _agent_event(incident_id: str, agent: str, action: str, detail: str = "") -> None:
    """Append a live-activity event the UI streams."""
    with INCIDENTS_LOCK:
        inc = INCIDENTS.get(incident_id)
        if not inc:
            return
        inc["events"].append({
            "ts": _now_ms(),
            "agent": agent,
            "action": action,
            "detail": detail,
        })


def _persist(incident_id: str) -> None:
    """Persist full incident state to disk (so we survive restarts)."""
    inc = INCIDENTS.get(incident_id)
    if not inc:
        return
    folder = INCIDENTS_DIR / incident_id
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "INCIDENT.json").write_text(json.dumps(inc, indent=2))


def _simulate_pipeline(incident_id: str, scenario_id: str) -> None:
    """
    Deterministic v0 pipeline. Simulates the multi-agent flow using mock data.
    Each step adds a delay so the live-activity log feels real.
    """
    scen = SCENARIOS[scenario_id]
    started_at = _now_ms()

    def step(seconds: float):
        time.sleep(seconds)

    # Step 1: PM receives alert
    _agent_event(incident_id, "incident-pm", "received", f"alert for {scen['alert']['service']}")
    step(0.6)
    _agent_event(incident_id, "incident-pm", "dispatch",
                 "fan-out to log-detective / metrics-analyst / trace-reader / deploy-historian (parallel)")
    step(0.4)

    # Step 2: 4 parallel workers (we simulate them as quasi-parallel)
    _agent_event(incident_id, "log-detective", "querying", "POST /api/sre/datadog/logs")
    step(0.8)
    logs = scen["logs"]
    _agent_event(incident_id, "log-detective", "evidence",
                 f"{logs['hits']} hits — top: \"{logs['top_messages'][0]['message'][:60]}\"")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["findings"]["logs"] = scen["logs"]

    _agent_event(incident_id, "metrics-analyst", "querying", "5 metrics in parallel")
    step(0.7)
    m = scen["metrics"]
    spikes = [n for n, v in m.items() if "SPIKE" in v["verdict"]]
    _agent_event(incident_id, "metrics-analyst", "evidence",
                 f"spike on {', '.join(spikes) or 'nothing — all normal'}")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["findings"]["metrics"] = scen["metrics"]

    _agent_event(incident_id, "trace-reader", "querying", "POST /api/sre/datadog/traces")
    step(0.9)
    t = scen["traces"]
    if t["hot_span"]:
        _agent_event(incident_id, "trace-reader", "evidence",
                     f"hot span {t['hot_span']['name']} ({t['hot_span']['ratio']} baseline)")
    else:
        _agent_event(incident_id, "trace-reader", "evidence", "no anomalous traces")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["findings"]["traces"] = scen["traces"]

    _agent_event(incident_id, "deploy-historian", "querying", "GET /api/sre/deploys")
    step(0.5)
    d = scen["deploys"]
    if d["deploys"]:
        first = d["deploys"][0]
        _agent_event(incident_id, "deploy-historian", "evidence",
                     f"PR #{first['pr_url'].rsplit('/',1)[-1]} by @{first['author']}, "
                     f"{first['minutes_before']}min before — suspect {first['suspect']}")
    else:
        _agent_event(incident_id, "deploy-historian", "evidence", "no deploys in window")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["findings"]["deploys"] = scen["deploys"]

    # Step 3: Hypothesis Generator
    step(0.5)
    _agent_event(incident_id, "hypothesis-gen", "thinking", "combining 4 evidence blocks")
    step(1.2)
    hyp = scen["expected_hypothesis"]
    _agent_event(incident_id, "hypothesis-gen", "evidence",
                 f"top hypothesis (conf {int(hyp['confidence']*100)}%): {hyp['top'][:80]}…")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["hypothesis"] = hyp

    # Step 4: Remediation Suggester
    step(0.4)
    _agent_event(incident_id, "remediation-sug", "writing", "REMEDIATION.md (NEVER executes)")
    step(1.0)
    rem = scen["expected_remediation"]
    _agent_event(incident_id, "remediation-sug", "evidence",
                 f"{len(rem)} actions ranked by reversibility")
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["remediation"] = rem

    # Step 5: PM stamps INCIDENT.json
    step(0.3)
    finished_at = _now_ms()
    with INCIDENTS_LOCK:
        INCIDENTS[incident_id]["phase"] = "diagnosed"
        INCIDENTS[incident_id]["diagnosed_at"] = finished_at
        INCIDENTS[incident_id]["diagnosis_ms"] = finished_at - started_at
    _agent_event(incident_id, "incident-pm", "done",
                 f"INCIDENT.json stamped — diagnosed in {(finished_at - started_at)/1000:.1f}s")
    _persist(incident_id)


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)


# ---- static files ---------------------------------------------------------

@app.route("/")
def root():
    return send_from_directory(str(HERE), "index.html")


@app.route("/<path:fname>")
def static_files(fname: str):
    safe = (HERE / fname).resolve()
    if not str(safe).startswith(str(HERE)):
        return "forbidden", 403
    if safe.is_file():
        return send_from_directory(str(HERE), fname)
    return "not found", 404


# ---- scenarios / incidents -----------------------------------------------

@app.route("/api/scenarios", methods=["GET"])
def api_scenarios():
    return jsonify({
        "scenarios": [
            {"id": s["id"], "label": s["label"], "service": s["alert"]["service"], "severity": s["alert"]["severity"]}
            for s in SCENARIOS.values()
        ]
    })


@app.route("/api/incidents/fire", methods=["POST"])
def api_fire():
    payload = request.get_json(force=True, silent=True) or {}
    scenario_id = payload.get("scenario_id") or next(iter(SCENARIOS))
    if scenario_id not in SCENARIOS:
        return jsonify({"error": f"unknown scenario_id: {scenario_id}"}), 400

    scen = SCENARIOS[scenario_id]
    incident_id = uuid.uuid4().hex[:10]

    with INCIDENTS_LOCK:
        INCIDENTS[incident_id] = {
            "id": incident_id,
            "scenario_id": scenario_id,
            "alert": scen["alert"],
            "phase": "investigating",
            "started_at": _now_ms(),
            "events": [],
            "findings": {},
            "hypothesis": None,
            "remediation": None,
        }
    _persist(incident_id)

    # spawn pipeline in background
    threading.Thread(target=_simulate_pipeline, args=(incident_id, scenario_id), daemon=True).start()

    return jsonify({"id": incident_id, "phase": "investigating"})


@app.route("/api/incidents", methods=["GET"])
def api_list_incidents():
    with INCIDENTS_LOCK:
        items = sorted(
            ({"id": i["id"], "alert": i["alert"], "phase": i["phase"], "started_at": i["started_at"],
              "diagnosed_at": i.get("diagnosed_at"), "diagnosis_ms": i.get("diagnosis_ms")}
             for i in INCIDENTS.values()),
            key=lambda x: -x["started_at"],
        )
    return jsonify({"incidents": items})


@app.route("/api/incidents/<incident_id>", methods=["GET"])
def api_get_incident(incident_id: str):
    with INCIDENTS_LOCK:
        inc = INCIDENTS.get(incident_id)
        if not inc:
            return jsonify({"error": "not found"}), 404
        return jsonify(inc)


@app.route("/api/incidents/<incident_id>/post-slack", methods=["POST"])
def api_post_slack(incident_id: str):
    with INCIDENTS_LOCK:
        inc = INCIDENTS.get(incident_id)
        if not inc or not inc.get("hypothesis"):
            return jsonify({"error": "not diagnosed yet"}), 400
    return jsonify({
        "ok": True,
        "note": "v0 stub — in v1 this will POST to a real Slack webhook",
        "preview": _slack_preview(inc),
    })


def _slack_preview(inc: dict[str, Any]) -> str:
    h = inc["hypothesis"]
    return (
        f"🚨 *{inc['alert']['service']}* {inc['alert']['severity']}\n"
        f"_{inc['alert']['description']}_\n\n"
        f"*Top hypothesis* ({int(h['confidence']*100)}%):\n"
        f"> {h['top']}\n\n"
        f"*Diagnosed in*: {inc.get('diagnosis_ms', 0)/1000:.1f}s\n"
        f"*Remediation*: {len(inc.get('remediation') or [])} actions ranked — see dashboard"
    )


# ---- mock Datadog APIs (read by workers in v0.5+) ------------------------

@app.route("/api/sre/datadog/logs", methods=["POST"])
def api_dd_logs():
    body = request.get_json(force=True, silent=True) or {}
    service = body.get("service", "")
    scen = _scenario_for_service(service)
    if not scen:
        return jsonify({"hits": 0, "samples": []}), 200
    return jsonify(scen["logs"])


@app.route("/api/sre/datadog/metrics", methods=["POST"])
def api_dd_metrics():
    body = request.get_json(force=True, silent=True) or {}
    service = body.get("service", "")
    metric = body.get("metric")
    scen = _scenario_for_service(service)
    if not scen:
        return jsonify({}), 200
    if metric:
        return jsonify(scen["metrics"].get(metric, {}))
    return jsonify(scen["metrics"])


@app.route("/api/sre/datadog/traces", methods=["POST"])
def api_dd_traces():
    body = request.get_json(force=True, silent=True) or {}
    service = body.get("service", "")
    scen = _scenario_for_service(service)
    if not scen:
        return jsonify({"traces_inspected": 0, "sample_trace_ids": []}), 200
    return jsonify(scen["traces"])


@app.route("/api/sre/deploys", methods=["POST"])
def api_deploys():
    body = request.get_json(force=True, silent=True) or {}
    services = body.get("services") or []
    if not services:
        return jsonify({"deploys": [], "config_changes": []})
    # In v0 we just use the first matching service.
    for svc in services:
        scen = _scenario_for_service(svc)
        if scen:
            return jsonify(scen["deploys"])
    return jsonify({"deploys": [], "config_changes": []})


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@app.route("/api/health", methods=["GET"])
def api_health():
    return jsonify({
        "ok": True,
        "scenarios": len(SCENARIOS),
        "active_incidents": sum(1 for i in INCIDENTS.values() if i["phase"] == "investigating"),
        "total_incidents": len(INCIDENTS),
    })


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print(f"SRE Command Center on http://127.0.0.1:{PORT}")
    print(f"   {len(SCENARIOS)} demo scenarios loaded from {MOCK_PATH}")
    app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
