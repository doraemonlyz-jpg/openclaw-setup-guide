/* Boss Dashboard frontend — polls the Flask backend every few seconds. */

const POLL_AGENTS_MS = 4000;
const POLL_PROJECTS_MS = 6000;
const POLL_ACTIVITY_MS = 3000;
const POLL_BOSS_LOG_MS = 2500;

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
      const item = el("div", "project-item" + (activeProject === p.slug ? " active" : ""));
      item.dataset.slug = p.slug;
      item.innerHTML = `
        <div class="project-name">${escapeHtml(p.slug)}</div>
        <div class="project-meta">
          <span>📄 ${p.files.length} files</span>
          <span>${fmtAgo(p.modified)}</span>
        </div>
      `;
      item.addEventListener("click", () => openProject(p));
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

// ──────── kick off ────────
refreshAgents();    setInterval(refreshAgents, POLL_AGENTS_MS);
refreshProjects();  setInterval(refreshProjects, POLL_PROJECTS_MS);
refreshActivity();  setInterval(refreshActivity, POLL_ACTIVITY_MS);
refreshBossLog();   setInterval(refreshBossLog, POLL_BOSS_LOG_MS);
refreshHud();       setInterval(refreshHud, 1000);

// uptime ticks once a second on its own (cheaper than full HUD refresh)
setInterval(() => { $("#hud-up").textContent = fmtUptime(); }, 1000);
