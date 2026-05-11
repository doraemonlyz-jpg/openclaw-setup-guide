# SRE Agent — Multi-Agent Incident Response (v0)

> A small AI on-call team. PagerDuty / Datadog fires an alert,
> 6 specialized agents fan out across logs / metrics / traces / deploys,
> a hypothesis generator ranks root causes,
> a remediation suggester writes the fix — **never executes it**.
> Diagnosis target: **< 90 seconds**.

This project reuses every safety pattern from the OpenClaw boss-company tutorial:
- Hub-and-spoke orchestration (Incident PM = router)
- Lane discipline (each worker has explicit ALLOWED / FORBIDDEN writes)
- Structural EVIDENCE gates (machine-readable blocks, not freeform prose)
- Trust-but-verify (PM re-reads every claimed artifact)
- Human-in-the-loop remediation (agents never mutate prod in v0)

---

## Quick start (60 seconds)

```bash
cd sre-agent
./setup.sh
open http://127.0.0.1:5060
```

Click **+ FIRE ALERT** and pick one of the 3 demo scenarios:

| Scenario | What you'll see |
|---|---|
| **Redis pool exhaustion after deploy** | Classic: deploy 28 min before, error rate 192×, slow `redis.get` span, rollback suggested |
| **False positive** | 1-min p99 blip from a single user — system correctly says "no signal" |
| **Downstream cascade** | The alerted service is healthy; the broken service is its upstream `auth-service`. The agent finds the real culprit. |

Each scenario takes ~7 seconds end-to-end. The live agent log on the right shows you the multi-agent dispatch.

---

## What's in the box

```
sre-agent/
├── DESIGN.md                 # full architecture + flow + roadmap
├── README.md                 # this file
├── setup.sh                  # one-shot setup
├── personas/                 # 7 agent personas (markdown)
│   ├── incident-pm.md
│   ├── log-detective.md
│   ├── metrics-analyst.md
│   ├── trace-reader.md
│   ├── deploy-historian.md
│   ├── hypothesis-gen.md
│   └── remediation-sug.md
├── dashboard/                # Flask web UI
│   ├── app.py                # backend (mock Datadog APIs + pipeline simulator)
│   ├── index.html
│   ├── styles.css            # cyberpunk theme, reused from boss-dashboard
│   ├── app.js
│   └── requirements.txt
└── mocks/
    └── scenarios.json        # 3 hand-built demo incidents with realistic data
```

---

## How v0 works (vs v0.5 and beyond)

**v0 (this version)** — *deterministic, agents are simulated.*
- The dashboard runs a Python pipeline that mimics the 7-agent flow with realistic timings (~0.5-1.5s per agent step).
- All "EVIDENCE" comes from `mocks/scenarios.json`.
- Lets you test the **UX, the persona shape, and the dashboard wiring** without depending on Ollama.

**v0.5** — *real local agents.*
- Same dashboard. Same 7 personas. Same EVIDENCE block contract.
- The dashboard's `/api/incidents/fire` endpoint spawns a real `openclaw agent --agent incident-pm`.
- Workers still query the mock Datadog endpoints — but now via real `curl` from real agents.
- This is when you'd evaluate whether the personas hold up against `gpt-oss:20b`.

**v1** — *real Datadog + Slack.*
- Mock endpoints get swapped for the real Datadog MCP server (already available in this workspace).
- A real PagerDuty webhook routes into `/api/incidents/fire`.
- Slack integration posts the diagnosis to a channel.

The dashboard surface, the EVIDENCE contract, and the personas **do not change** between v0 → v1. Only the data plumbing.

---

## Why this beats a single GPT-4o call

| Concern | Single Agent | Multi-Agent (this) |
|---|---|---|
| Latency | ~30s sequential | ~10s parallel (4 workers concurrent) |
| Trust boundaries | One agent reads logs+metrics+executes | Remediation Suggester literally cannot mutate prod |
| Specialization | One big prompt for everything | Each persona is 1-2k tokens of role-specific guidance |
| Hallucination | "I checked the logs" with no proof | EVIDENCE block with `log_id` citations the PM re-verifies |
| Cost | $0.10-$0.50 per incident | ~$0.02 per incident (local model + parallelism) |

---

## Comparing to the market

| Tool | Their angle | Ours |
|---|---|---|
| Resolve.ai ($35M Series A) | SaaS, k8s-native, auto-remediation | Self-hosted, local-first, human-in-the-loop |
| Cleric AI | SRE chat copilot | Webhook-driven pipeline, not chat |
| Datadog Bits AI | Inline summaries on Datadog dashboards | Outside Datadog, cross-tool correlation |
| Honeycomb / Coralogix | "ask your logs" | "diagnose this alert end-to-end" |

The unique angle: **the structural EVIDENCE-block contract** is what makes it
ship-able into a real on-call rotation. Most LLM ops tools fail because they
hallucinate citations. Ours can't — the PM rejects replies without verifiable
log/trace IDs.

---

## Roadmap

See `DESIGN.md` § 7. TL;DR:

- v0 (today): mock pipeline + dashboard
- v0.5 (+1 day): real Ollama agents driving the same dashboard
- v1 (+1 week): real Datadog MCP + PagerDuty webhook + Slack
- v1.5 (+2 weeks): eval pipeline against 10 real historical incidents
- v2 (+1 month): GitHub deploy correlation, k8s read-only context
- v3 (+3 months): optional auto-remediation with kill-switch

---

## Stopping the dashboard

```bash
kill $(cat /tmp/sre-dashboard.pid)
```

---

## What this isn't (yet)

- ❌ Not production-grade auth (anyone on your loopback can fire alerts)
- ❌ Not connected to real PagerDuty / Datadog (v1)
- ❌ Real agents not wired in (v0.5)
- ❌ No persistent metrics across restarts (incidents stay in memory + disk JSON)

Those are explicit v0 cuts. The point of v0 is to validate the **UX and the agent shape** before plumbing real systems in.
