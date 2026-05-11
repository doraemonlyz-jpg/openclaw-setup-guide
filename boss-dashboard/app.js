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
async function refreshActivity() {
  try {
    const r = await fetch("/api/activity?limit=20");
    const d = await r.json();
    const stream = $("#activity-stream");
    stream.innerHTML = "";
    const inner = el("div", "activity-stream-inner");
    // Show newest at the top of inner; flex column-reverse on outer flips it visually
    const items = [...d.items].reverse();
    for (const m of items) {
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
      inner.appendChild(card);
    }
    stream.appendChild(inner);
    $("#activity-count").textContent = d.items.length;
  } catch (e) {
    console.warn("activity refresh failed:", e);
  }
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
