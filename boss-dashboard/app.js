/* Boss Dashboard frontend — polls the Flask backend every few seconds. */

const POLL_AGENTS_MS = 4000;
const POLL_PROJECTS_MS = 6000;
const POLL_ACTIVITY_MS = 3000;
const POLL_BOSS_LOG_MS = 2500;
const POLL_STATUS_MS = 5000;

let activeProject = null;
let activeFile = null;
let lastBossLogModified = 0;

// ──────── helpers ────────
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const escapeHtml = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const fmtTime = (ts) => {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};
const fmtAgo = (ts) => {
  if (!ts) return "—";
  const ds = Math.floor(Date.now() / 1000 - ts);
  if (ds < 5) return "just now";
  if (ds < 60) return ds + "s ago";
  if (ds < 3600) return Math.floor(ds / 60) + "m ago";
  if (ds < 86400) return Math.floor(ds / 3600) + "h ago";
  return Math.floor(ds / 86400) + "d ago";
};
const fmtSize = (b) => {
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
  return (b / 1024 / 1024).toFixed(1) + " MB";
};

// ──────── agents ────────
async function refreshAgents() {
  try {
    const r = await fetch("/api/agents");
    const d = await r.json();
    const list = $("#agents-list");
    list.innerHTML = "";
    for (const a of d.agents) {
      const card = el("div", "agent-card" + (a.busy ? " busy" : ""));
      card.innerHTML = `
        <div class="agent-name"><span class="agent-id">${escapeHtml(a.id)}</span></div>
        <div class="agent-role">${escapeHtml(a.role)}</div>
        <div class="agent-meta">
          <span class="model">${escapeHtml(a.model)}</span>
          <span>${a.msg_count} msgs</span>
          <span>${fmtAgo(a.last_active)}</span>
        </div>
      `;
      card.title = a.description;
      list.appendChild(card);
    }
    $("#agent-count").textContent = d.agents.length;
    $("#updated-at").textContent = "updated " + fmtTime(d.now);
  } catch (e) {
    console.warn("agents refresh failed:", e);
  }
}

// ──────── projects ────────
async function refreshProjects() {
  try {
    const r = await fetch("/api/projects");
    const d = await r.json();
    const list = $("#projects-list");
    list.innerHTML = "";
    for (const p of d.projects) {
      const status = lastRunStatus[p.slug] || {};
      const phase = status.phase || "?";
      const phaseHtml = phase !== "?" ?
        `<span class="proj-phase phase-${escapeHtml(phase)}">${escapeHtml(phase.toUpperCase())}</span>` : "";
      const runDot = status.running ? `<span class="pi-running" title="running on port ${status.running.port}"></span>` : "";
      const item = el("div", "project-item" + (activeProject === p.slug ? " active" : ""));
      item.dataset.slug = p.slug;
      item.innerHTML = `
        <button class="pi-delete" title="Delete project">✕</button>
        <div class="project-name">${escapeHtml(p.slug)}${phaseHtml}${runDot}</div>
        <div class="project-meta">
          <span>📄 ${p.files.length} files</span>
          <span>${fmtAgo(p.modified)}</span>
        </div>
      `;
      item.addEventListener("click", (e) => {
        if (e.target.classList.contains("pi-delete")) return; // handled below
        openProject(p);
      });
      item.querySelector(".pi-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        confirmDelete(p.slug);
      });
      list.appendChild(item);
    }
    $("#project-count").textContent = d.projects.length;
    if (d.projects.length === 0) {
      list.innerHTML = `<div class="empty-state">No projects yet.<br/>Tell PM to build something →</div>`;
    }
  } catch (e) {
    console.warn("projects refresh failed:", e);
  }
}

async function openProject(p) {
  activeProject = p.slug;
  await refreshProjects();
  $("#project-detail").classList.remove("hidden");
  $("#pd-title").textContent = p.slug + "/";
  const tabs = $("#pd-tabs");
  tabs.innerHTML = "";
  // Sort files: SPEC.md → TASKS.md → DESIGN.md → others → README.md → TEST_*
  const order = (n) => {
    if (n === "SPEC.md") return 0;
    if (n === "TASKS.md") return 1;
    if (n === "DESIGN.md") return 2;
    if (n === "README.md") return 80;
    if (n.startsWith("TEST_")) return 90;
    return 50;
  };
  const sorted = [...p.files].sort((a, b) => order(a.path) - order(b.path));
  for (const f of sorted) {
    const tab = el("button", "file-tab", escapeHtml(f.path));
    tab.dataset.path = f.path;
    tab.addEventListener("click", () => loadFile(p.slug, f.path));
    tabs.appendChild(tab);
  }
  if (sorted.length > 0) loadFile(p.slug, sorted[0].path);
  paintProjectActions();
}

async function loadFile(slug, relPath) {
  activeFile = relPath;
  $$("#pd-tabs .file-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.path === relPath);
  });
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(relPath)}`);
    const d = await r.json();
    if (d.error) {
      $("#pd-content").textContent = "Error: " + d.error;
      return;
    }
    $("#pd-content").textContent = d.content;
  } catch (e) {
    $("#pd-content").textContent = "Failed to load: " + e.message;
  }
}

$("#pd-close").addEventListener("click", () => {
  activeProject = null;
  activeFile = null;
  $("#project-detail").classList.add("hidden");
  refreshProjects();
});

// ════════════════════════════════════════════════════════════════
// PROJECT ACTIONS — RUN / STOP / OPEN / DELETE + run-log tail
// ════════════════════════════════════════════════════════════════

let runLogPollHandle = null;

function paintProjectActions() {
  if (!activeProject) return;
  const status = lastRunStatus[activeProject] || {};
  const running = status.running;            // null or {pid, port, url, ...}
  const runnable = status.runnable !== false;
  const runBtn = $("#pd-run");
  const stopBtn = $("#pd-stop");
  const openBtn = $("#pd-open");
  const statusEl = $("#pd-status");

  if (running) {
    runBtn.hidden = true;
    stopBtn.hidden = false;
    openBtn.hidden = false;
    openBtn.href = running.url;
    const upS = Math.max(0, Math.floor(Date.now() / 1000 - running.started_at));
    const upStr = upS < 60 ? `${upS}s` : `${Math.floor(upS / 60)}m${upS % 60}s`;
    statusEl.className = "pd-status running";
    statusEl.textContent = `● RUNNING · pid ${running.pid} · :${running.port} · up ${upStr}`;
    if (!runLogPollHandle) {
      runLogPollHandle = setInterval(refreshRunLog, 2000);
      refreshRunLog();
    }
  } else {
    runBtn.hidden = false;
    stopBtn.hidden = true;
    openBtn.hidden = true;
    if (!runnable) {
      runBtn.disabled = true;
      statusEl.className = "pd-status";
      statusEl.textContent = "no entry point found";
    } else {
      runBtn.disabled = false;
      const entry = status.entry || "?";
      const kind = status.entry_kind || "?";
      statusEl.className = "pd-status";
      statusEl.textContent = `entry: ${entry} (${kind})`;
    }
    if (runLogPollHandle) { clearInterval(runLogPollHandle); runLogPollHandle = null; }
  }
}

$("#pd-run").addEventListener("click", async () => {
  if (!activeProject) return;
  const btn = $("#pd-run");
  const statusEl = $("#pd-status");
  btn.classList.add("starting");
  btn.disabled = true;
  statusEl.className = "pd-status starting";
  statusEl.textContent = "BOOTING...";
  $("#pd-runlog").classList.remove("hidden");
  $("#pd-runlog").textContent = "starting...";

  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/run`, { method: "POST" });
    const d = await r.json();
    if (!d.ok) {
      statusEl.className = "pd-status error";
      statusEl.textContent = `✗ ${d.error || "boot failed"}`;
      $("#pd-runlog").textContent = (d.detail || "") + "\n\n" + (d.log_tail || "(no log)");
    } else if (d.already_running) {
      statusEl.textContent = `(already running on :${d.port})`;
    }
    // refresh status which re-paints buttons
    await refreshRunStatus();
    paintProjectActions();
  } catch (e) {
    statusEl.className = "pd-status error";
    statusEl.textContent = "✗ " + e.message;
  } finally {
    btn.classList.remove("starting");
    btn.disabled = false;
  }
});

$("#pd-stop").addEventListener("click", async () => {
  if (!activeProject) return;
  const btn = $("#pd-stop");
  btn.disabled = true;
  try {
    await fetch(`/api/projects/${encodeURIComponent(activeProject)}/stop`, { method: "POST" });
    await refreshRunStatus();
    paintProjectActions();
    $("#pd-runlog").classList.add("hidden");
  } finally {
    btn.disabled = false;
  }
});

$("#pd-delete").addEventListener("click", () => {
  if (!activeProject) return;
  confirmDelete(activeProject);
});

// ──────── FIX modal ────────
$("#pd-fix").addEventListener("click", () => {
  if (!activeProject) return;
  $("#fix-slug").textContent = activeProject;
  $("#fix-input").value = "";
  $("#fix-modal").classList.remove("hidden");
  setTimeout(() => $("#fix-input").focus(), 50);
});
$("#fix-cancel").addEventListener("click", () => {
  $("#fix-modal").classList.add("hidden");
});
$("#fix-modal").addEventListener("click", (e) => {
  if (e.target.id === "fix-modal") $("#fix-modal").classList.add("hidden");
});
$("#fix-submit").addEventListener("click", async () => {
  if (!activeProject) return;
  const slug = activeProject;
  const description = $("#fix-input").value.trim();
  $("#fix-modal").classList.add("hidden");
  const fixBtn = $("#pd-fix");
  const statusEl = $("#pd-status");
  fixBtn.classList.add("dispatched");
  statusEl.className = "pd-status starting";
  statusEl.textContent = "DISPATCHING TO PM...";
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(slug)}/fix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const d = await r.json();
    if (!d.ok) {
      statusEl.className = "pd-status error";
      statusEl.textContent = "✗ " + (d.error || "dispatch failed");
      fixBtn.classList.remove("dispatched");
      return;
    }
    statusEl.className = "pd-status starting";
    statusEl.textContent = `🔧 PM dispatched (pid ${d.pid}) — watch Live Activity →`;
    // Hold the dispatched-state visual for ~30s; refreshRunStatus will
    // eventually overwrite it once the project's STATUS.json gets re-stamped.
    setTimeout(() => fixBtn.classList.remove("dispatched"), 30000);
  } catch (e) {
    statusEl.className = "pd-status error";
    statusEl.textContent = "✗ " + e.message;
    fixBtn.classList.remove("dispatched");
  }
});

async function refreshRunLog() {
  if (!activeProject) return;
  try {
    const r = await fetch(`/api/projects/${encodeURIComponent(activeProject)}/run-tail`);
    const d = await r.json();
    const log = $("#pd-runlog");
    log.classList.toggle("hidden", !d.log);
    if (d.log) {
      const wasAtBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
      log.textContent = d.log;
      if (wasAtBottom) log.scrollTop = log.scrollHeight;
    }
    if (!d.alive && runLogPollHandle) {
      // Process died — refresh status to update buttons + stop polling
      clearInterval(runLogPollHandle); runLogPollHandle = null;
      refreshRunStatus().then(paintProjectActions);
    }
  } catch (e) {}
}

// ──────── confirm modal ────────
let pendingConfirm = null;
function showConfirm({ title, body, onYes }) {
  pendingConfirm = onYes;
  $("#confirm-title").textContent = title;
  $("#confirm-body").innerHTML = body;
  $("#confirm-modal").classList.remove("hidden");
}
function hideConfirm() {
  pendingConfirm = null;
  $("#confirm-modal").classList.add("hidden");
}
$("#confirm-no").addEventListener("click", hideConfirm);
$("#confirm-yes").addEventListener("click", async () => {
  const fn = pendingConfirm;
  hideConfirm();
  if (fn) try { await fn(); } catch (e) { console.warn(e); }
});
$("#confirm-modal").addEventListener("click", (e) => {
  if (e.target.id === "confirm-modal") hideConfirm();
});

function confirmDelete(slug) {
  showConfirm({
    title: "DELETE PROJECT",
    body: `Permanently delete <span class="target">${escapeHtml(slug)}</span>?<br/><br/>` +
          `This removes <code>~/.openclaw/company/projects/${escapeHtml(slug)}/</code>` +
          ` including all files, the venv, and the run log.<br/>` +
          `If it's running, it will be stopped first.<br/><br/>` +
          `<b>This cannot be undone.</b>`,
    onYes: async () => {
      try {
        const r = await fetch(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
        const d = await r.json();
        if (!d.ok) {
          alert("Delete failed: " + (d.error || "unknown") + "\n" + (d.detail || ""));
          return;
        }
        if (activeProject === slug) {
          activeProject = null;
          activeFile = null;
          $("#project-detail").classList.add("hidden");
        }
        // forget cached state for this slug
        delete lastRunStatus[slug];
        firedCompletions.delete(`complete:${slug}`);
        firedCompletions.delete(`failed:${slug}`);
        await refreshRunStatus();
        await refreshProjects();
      } catch (e) {
        alert("Delete failed: " + e.message);
      }
    },
  });
}

// ──────── activity stream ────────
// Track scroll state: are we pinned to the bottom (terminal-style auto-follow)
// or did the user scroll up to read history (don't yank them around)?
let stickToBottom = true;
let lastRenderedKey = "";
let knownMessageIds = new Set();   // for "new flash" detection
let firstActivityRender = true;     // suppress flash on initial load

const stream = $("#activity-stream");
stream.addEventListener("scroll", () => {
  const slack = 40; // px tolerance
  const atBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < slack;
  stickToBottom = atBottom;
  $("#scroll-pin").classList.toggle("visible", !atBottom);
});

$("#scroll-pin").addEventListener("click", () => {
  stickToBottom = true;
  scrollActivityToBottom();
});

function scrollActivityToBottom() {
  stream.scrollTop = stream.scrollHeight;
  $("#scroll-pin").classList.remove("visible");
}

function renderActivityCard(m) {
  const cls = ["act-msg", `role-${m.role}`, `kind-${m.kind}`];
  if (m.tool_calls.length || m.tool_results.length) cls.push("has-tool");
  const card = el("div", cls.join(" "));
  const peerStr = m.peer ? `← ${escapeHtml(m.peer)}` : "";
  let body = "";
  if (m.text) {
    // Strip the inter-session boilerplate prefix
    const cleaned = m.text.replace(
      /^\[Inter-session message\][^\n]*\nThis content was routed[^\n]*\n[^\n]*\n?/, ""
    );
    body = `<div class="act-body">${escapeHtml(cleaned).slice(0, 1200)}</div>`;
  }
  let toolHtml = "";
  for (const tc of m.tool_calls) {
    const argsStr = JSON.stringify(tc.args || {}).slice(0, 200);
    toolHtml += `<div class="tool-call">→ <span class="name">${escapeHtml(tc.name)}</span>(${escapeHtml(argsStr)})</div>`;
  }
  for (const tr of m.tool_results.slice(0, 1)) {
    toolHtml += `<div class="tool-result">${escapeHtml(tr.slice(0, 300))}</div>`;
  }
  card.innerHTML = `
    <div class="act-head">
      <span class="agent-tag">${escapeHtml(m.agent)}</span>
      <span class="role-tag">${escapeHtml(m.role)}</span>
      <span>${escapeHtml(peerStr)}</span>
      <span class="ts">${fmtTime(m.ts)}</span>
    </div>
    ${body}
    ${toolHtml}
  `;
  return card;
}

function msgKey(m) { return `${m.agent}:${m.id || m.ts || ""}`; }

async function refreshActivity() {
  try {
    const r = await fetch("/api/activity?limit=30");
    const d = await r.json();
    const key = d.items.map(msgKey).join("|");
    if (key === lastRenderedKey) {
      $("#activity-count").textContent = d.items.length;
      return;
    }
    lastRenderedKey = key;

    // Detect which messages are brand new (not in our last seen set)
    const newIds = new Set();
    if (!firstActivityRender) {
      for (const m of d.items) {
        const k = msgKey(m);
        if (!knownMessageIds.has(k)) newIds.add(k);
      }
    }
    knownMessageIds = new Set(d.items.map(msgKey));

    stream.innerHTML = "";
    for (const m of d.items) {
      const card = renderActivityCard(m);
      if (newIds.has(msgKey(m))) card.classList.add("new-flash");
      stream.appendChild(card);
    }
    $("#activity-count").textContent = d.items.length;

    if (stickToBottom) {
      requestAnimationFrame(() => requestAnimationFrame(scrollActivityToBottom));
    }
    firstActivityRender = false;
  } catch (e) {
    console.warn("activity refresh failed:", e);
  }
}

// ──────── HUD telemetry (mostly cosmetic, plus real-ish latency) ────────
const bootTime = Date.now();
let lastHudLatency = null;

function fmtUptime() {
  const s = Math.floor((Date.now() - bootTime) / 1000);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

async function refreshHud() {
  // measure round-trip latency on the lightest endpoint
  const t0 = performance.now();
  let ok = true;
  try {
    await fetch("/api/agents", { method: "HEAD" }).catch(() => fetch("/api/agents"));
  } catch { ok = false; }
  const lat = Math.round(performance.now() - t0);
  lastHudLatency = lat;

  $("#hud-conn").textContent = ok ? "OK" : "DOWN";
  $("#hud-conn").parentElement.classList.toggle("crit", !ok);

  $("#hud-lat").textContent = lat + "ms";
  const latCell = $("#hud-lat").parentElement;
  latCell.classList.toggle("warn", lat > 200 && lat <= 500);
  latCell.classList.toggle("crit", lat > 500);

  // GPU + MEM are simulated — they pulse around plausible values for vibe
  const gpu = 30 + Math.floor(Math.sin(Date.now() / 4000) * 25 + Math.random() * 30);
  $("#hud-gpu").textContent = gpu + "%";
  $("#hud-gpu").parentElement.classList.toggle("warn", gpu > 70 && gpu <= 90);
  $("#hud-gpu").parentElement.classList.toggle("crit", gpu > 90);

  const memUsed = (16 + Math.sin(Date.now() / 6000) * 4 + Math.random() * 2).toFixed(1);
  $("#hud-mem").textContent = `${memUsed}/36G`;

  $("#hud-up").textContent = fmtUptime();
}

// ──────── boss send ────────
$("#boss-send").addEventListener("click", async () => {
  const ta = $("#boss-input");
  const msg = ta.value.trim();
  if (!msg) return;
  const btn = $("#boss-send");
  btn.disabled = true;
  btn.textContent = "sending...";
  try {
    const r = await fetch("/api/boss/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: msg }),
    });
    const d = await r.json();
    if (d.error) {
      alert("Error: " + d.error);
    } else {
      ta.value = "";
      $("#boss-log").classList.remove("hidden");
      $("#boss-log").textContent = `[${fmtTime(d.started_at)}] sent to PM (pid ${d.pid}) — log: ${d.log}\nWaiting for PM to reply...`;
      setTimeout(refreshBossLog, 1500);
    }
  } catch (e) {
    alert("Failed: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Send to PM →";
  }
});

// Keyboard shortcut: Cmd/Ctrl + Enter to send
$("#boss-input").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    $("#boss-send").click();
  }
});

async function refreshBossLog() {
  try {
    const r = await fetch("/api/boss/log");
    const d = await r.json();
    if (!d.path) return;
    if (d.modified === lastBossLogModified) return;
    lastBossLogModified = d.modified;
    $("#boss-log").classList.remove("hidden");
    const head = `[log: ${d.path} · updated ${fmtTime(d.modified)}]\n\n`;
    $("#boss-log").textContent = head + (d.log || "(empty)");
    $("#boss-log").scrollTop = $("#boss-log").scrollHeight;
  } catch (e) {}
}

// ════════════════════════════════════════════════════════════════
// COMPLETION DETECTION  →  banner + desktop notification + chime
// ════════════════════════════════════════════════════════════════
//
// Strategy: poll /api/run-status every 5s. Track each project's last
// known phase. When a project transitions running→complete (or shows up
// already-complete on a fresh page load with mtime within last 5min),
// fire all three signals — once per project per page session.

let lastRunStatus = {};            // slug -> last status object
let firedCompletions = new Set();  // slugs we've already celebrated
let firstStatusRender = true;
let audioCtx = null;

function getAudioCtx() {
  // Lazy-create — browsers require user gesture before first playback,
  // but the AudioContext itself can exist; we just stay quiet until one.
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { audioCtx = null; }
  }
  return audioCtx;
}

// Quick cyberpunk chime: rising 3-note arpeggio with a soft sweep.
function playCompletionChime() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const notes = [
    { f: 660,  d: 0.18, t: 0.00 },  // E5
    { f: 880,  d: 0.18, t: 0.10 },  // A5
    { f: 1320, d: 0.32, t: 0.22 },  // E6
  ];
  for (const n of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(n.f, t0 + n.t);
    osc.frequency.exponentialRampToValueAtTime(n.f * 1.005, t0 + n.t + n.d);
    gain.gain.setValueAtTime(0, t0 + n.t);
    gain.gain.linearRampToValueAtTime(0.18, t0 + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + n.t + n.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.05);
  }
  // Sub-bass thump on the resolution
  try {
    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(110, t0 + 0.22);
    sub.frequency.exponentialRampToValueAtTime(55, t0 + 0.6);
    subGain.gain.setValueAtTime(0, t0 + 0.22);
    subGain.gain.linearRampToValueAtTime(0.25, t0 + 0.25);
    subGain.gain.exponentialRampToValueAtTime(0.0005, t0 + 0.7);
    sub.connect(subGain).connect(ctx.destination);
    sub.start(t0 + 0.22);
    sub.stop(t0 + 0.75);
  } catch {}
}

// Failure tone: descending minor 3rd + dissonant low buzz. Different enough
// from the chime that you know without looking which fired.
function playFailureTone() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  const t0 = ctx.currentTime;
  const drops = [
    { f: 440, d: 0.22, t: 0.00 },  // A4
    { f: 311, d: 0.28, t: 0.18 },  // Eb4 (tritone)
    { f: 220, d: 0.40, t: 0.40 },  // A3
  ];
  for (const n of drops) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(n.f, t0 + n.t);
    gain.gain.setValueAtTime(0, t0 + n.t);
    gain.gain.linearRampToValueAtTime(0.14, t0 + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0005, t0 + n.t + n.d);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.t);
    osc.stop(t0 + n.t + n.d + 0.05);
  }
}

function fmtDuration(seconds) {
  if (!seconds || seconds < 0) return "—";
  if (seconds < 60) return seconds + "s";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  return `${Math.floor(m/60)}h ${m%60}m`;
}

function showCompletionBanner(proj, kind = "complete") {
  const banner = $("#completion-banner");
  banner.classList.toggle("failed", kind === "failed");
  const glitch = banner.querySelector(".cb-glitch");
  const icon = $(".cb-icon");
  if (kind === "failed") {
    glitch.textContent = "◤ BUILD FAILED ◢";
    glitch.setAttribute("data-text", "◤ BUILD FAILED ◢");
    icon.textContent = "✕";
    $("#cb-title").textContent = `${proj.slug.toUpperCase()} · BUILD FAILED`;
  } else {
    glitch.textContent = "◤ DELIVERED ◢";
    glitch.setAttribute("data-text", "◤ DELIVERED ◢");
    icon.textContent = "✓";
    $("#cb-title").textContent = `${proj.slug.toUpperCase()} · DELIVERED`;
  }

  const filesNum = `<span class="num">${proj.file_count}</span>`;
  const durNum = `<span class="num">${fmtDuration(proj.duration_sec)}</span>`;
  const ex = proj.explicit || {};
  const summary = ex.summary || (kind === "failed" ? "see STATUS.json for reason" : "ready to run");
  let extra = "";
  if (kind === "failed" && ex.reason) extra = ` · <span class="num">reason:</span> ${escapeHtml(ex.reason)}`;
  if (kind === "complete" && ex.qa_pass_ratio) extra = ` · qa <span class="num">${escapeHtml(ex.qa_pass_ratio)}</span>`;
  if (kind === "complete" && ex.smoke_http_code) extra += ` · http <span class="num">${ex.smoke_http_code}</span>`;
  $("#cb-meta").innerHTML =
    `${filesNum} files · ${kind === "failed" ? "ran for" : "built in"} ${durNum} · ${escapeHtml(summary)}${extra}`;

  banner.classList.remove("hidden");
  requestAnimationFrame(() => banner.classList.add("visible"));

  $("#cb-open").onclick = () => {
    dismissBanner();
    const list = $("#projects-list");
    const item = list.querySelector(`[data-slug="${CSS.escape(proj.slug)}"]`);
    if (item) item.click();
  };
}
function dismissBanner() {
  const banner = $("#completion-banner");
  banner.classList.remove("visible");
  setTimeout(() => banner.classList.add("hidden"), 700);
}
$("#cb-dismiss").addEventListener("click", dismissBanner);

function fireDesktopNotification(proj, kind = "complete") {
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const ex = proj.explicit || {};
  try {
    const isFail = kind === "failed";
    const title = isFail ? "✕ AI Studio — Build Failed" : "✅ AI Studio — Project Delivered";
    let body = `${proj.slug} · ${proj.file_count} files · ${fmtDuration(proj.duration_sec)}`;
    if (isFail && ex.reason) body += `\nReason: ${ex.reason}`;
    if (!isFail && ex.qa_pass_ratio) body += `\nQA ${ex.qa_pass_ratio} · HTTP ${ex.smoke_http_code || "—"}`;
    body += "\nClick to open dashboard.";
    const n = new Notification(title, {
      body,
      tag: `${kind}-${proj.slug}`,
      requireInteraction: isFail,  // failures stick around until dismissed
      silent: false,
    });
    n.onclick = () => { window.focus(); n.close(); };
  } catch (e) { console.warn("notification failed:", e); }
}

function celebrateCompletion(proj, kind = "complete") {
  const dedupKey = `${kind}:${proj.slug}`;
  if (firedCompletions.has(dedupKey)) return;
  firedCompletions.add(dedupKey);
  showCompletionBanner(proj, kind);
  if (kind === "failed") playFailureTone(); else playCompletionChime();
  fireDesktopNotification(proj, kind);
  const icon = kind === "failed" ? "✕" : "✅";
  const word = kind === "failed" ? "FAILED" : "done";
  document.title = `${icon} ${proj.slug} ${word} · BOSS_CONSOLE`;
  setTimeout(() => { document.title = "// BOSS_CONSOLE :: AI_STUDIO //"; }, 30000);
}

async function refreshRunStatus() {
  try {
    const r = await fetch("/api/run-status");
    const d = await r.json();
    const now = d.now || Math.floor(Date.now() / 1000);

    for (const proj of d.projects) {
      const prev = lastRunStatus[proj.slug];
      lastRunStatus[proj.slug] = proj;

      // Two terminal phases worth notifying on: complete and failed.
      const terminalPhases = new Set(["complete", "failed"]);
      const finishedRecently = (now - proj.last_file_mtime) < 300;

      for (const term of terminalPhases) {
        const dedupKey = `${term}:${proj.slug}`;
        let isEvent = false;

        if (firstStatusRender) {
          // On initial page load, only celebrate things that finished within
          // the last 5 minutes — assume older terminal states already saw
          // their notification (or the user wasn't here).
          if (proj.phase === term && finishedRecently && !firedCompletions.has(dedupKey)) {
            isEvent = true;
          } else if (proj.phase === term) {
            firedCompletions.add(dedupKey);  // mark as seen so we don't fire later
          }
        } else if (prev && prev.phase !== term && proj.phase === term) {
          isEvent = true;
        }

        if (isEvent) celebrateCompletion(proj, term);
      }
    }
    firstStatusRender = false;
    // Repaint action bar so RUN/STOP/OPEN reflect current process state
    paintProjectActions();
  } catch (e) {
    console.warn("run-status refresh failed:", e);
  }
}

// ──────── notify permission toggle ────────
function paintNotifyBtn() {
  const btn = $("#notify-toggle");
  const icon = $("#notify-icon");
  const label = $("#notify-label");
  if (!("Notification" in window)) {
    btn.classList.add("denied");
    icon.textContent = "🚫"; label.textContent = "UNSUPPORTED";
    btn.disabled = true; return;
  }
  const p = Notification.permission;
  btn.classList.toggle("granted", p === "granted");
  btn.classList.toggle("denied", p === "denied");
  if (p === "granted") { icon.textContent = "🔔"; label.textContent = "ARMED"; }
  else if (p === "denied") { icon.textContent = "🚫"; label.textContent = "BLOCKED"; }
  else { icon.textContent = "🔕"; label.textContent = "ENABLE"; }
}
$("#notify-toggle").addEventListener("click", async () => {
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    try { await Notification.requestPermission(); } catch {}
  } else if (Notification.permission === "granted") {
    // Tap to test sound + banner
    playCompletionChime();
    showCompletionBanner({
      slug: "test-signal",
      file_count: 0,
      duration_sec: 0,
      explicit: { summary: "test chime — system ready" },
    });
  }
  // First click also unlocks AudioContext (browser requires user gesture)
  const ctx = getAudioCtx();
  if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
  paintNotifyBtn();
});

// ──────── kick off ────────
paintNotifyBtn();
refreshAgents();    setInterval(refreshAgents, POLL_AGENTS_MS);
// refreshRunStatus runs first so refreshProjects has phase data
refreshRunStatus().then(refreshProjects);
setInterval(refreshRunStatus, POLL_STATUS_MS);
setInterval(refreshProjects, POLL_PROJECTS_MS);
refreshActivity();  setInterval(refreshActivity, POLL_ACTIVITY_MS);
refreshBossLog();   setInterval(refreshBossLog, POLL_BOSS_LOG_MS);
refreshHud();       setInterval(refreshHud, 1000);

// uptime ticks once a second on its own (cheaper than full HUD refresh)
setInterval(() => { $("#hud-up").textContent = fmtUptime(); }, 1000);
