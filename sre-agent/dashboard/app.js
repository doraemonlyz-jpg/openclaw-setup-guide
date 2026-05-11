// SRE Command Center — frontend
(() => {
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const STATE = {
    incidents: [],            // list summary from /api/incidents
    selectedId: null,         // currently viewed incident id
    fullIncident: null,       // full data of selected
    lastEventTs: 0,           // for activity log streaming
    scenarios: [],
    activeTab: 'logs',
  };

  // ─────────────────────────── boot ───────────────────────────
  document.addEventListener('DOMContentLoaded', async () => {
    bindUi();
    await loadScenarios();
    await refresh();
    setInterval(refresh, 1000);
  });

  function bindUi() {
    $('#btn-fire').addEventListener('click', openFireModal);
    $('#btn-modal-close').addEventListener('click', closeFireModal);
  }

  async function loadScenarios() {
    const r = await fetch('/api/scenarios');
    const j = await r.json();
    STATE.scenarios = j.scenarios;
    const ul = $('#scenario-list');
    ul.innerHTML = STATE.scenarios.map(s => `
      <li class="scenario-item" data-id="${s.id}">
        <div class="scenario-label">${s.label}</div>
        <div class="scenario-svc">${s.service} · ${s.severity}</div>
      </li>
    `).join('');
    $$('.scenario-item', ul).forEach(el => {
      el.addEventListener('click', () => fireScenario(el.dataset.id));
    });
  }

  function openFireModal()  { $('#fire-modal').classList.remove('hidden'); }
  function closeFireModal() { $('#fire-modal').classList.add('hidden'); }

  async function fireScenario(scenarioId) {
    closeFireModal();
    const r = await fetch('/api/incidents/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: scenarioId }),
    });
    const j = await r.json();
    STATE.selectedId = j.id;
    STATE.lastEventTs = 0;
    await refresh();
  }

  // ─────────────────────────── refresh ───────────────────────────

  async function refresh() {
    const [listRes, detailRes] = await Promise.all([
      fetch('/api/incidents').then(r => r.json()).catch(() => ({ incidents: [] })),
      STATE.selectedId
        ? fetch(`/api/incidents/${STATE.selectedId}`).then(r => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]);

    STATE.incidents = listRes.incidents || [];
    STATE.fullIncident = detailRes && !detailRes.error ? detailRes : null;

    renderStats();
    renderIncidentList();
    renderDetail();
    renderActivity();
  }

  // ─────────────────────────── stats ───────────────────────────

  function renderStats() {
    const active = STATE.incidents.filter(i => i.phase === 'investigating').length;
    const diag   = STATE.incidents.filter(i => i.phase === 'diagnosed').length;
    const mttis  = STATE.incidents.filter(i => i.diagnosis_ms).map(i => i.diagnosis_ms);
    $('#stat-active').textContent = active;
    $('#stat-diag').textContent   = diag;
    if (mttis.length) {
      const avg = mttis.reduce((a, b) => a + b, 0) / mttis.length;
      $('#stat-mtti').textContent = `${(avg / 1000).toFixed(1)}s`;
    } else {
      $('#stat-mtti').textContent = '—';
    }
  }

  // ─────────────────────────── incident list ───────────────────────────

  function renderIncidentList() {
    const ul = $('#incident-list');
    if (!STATE.incidents.length) {
      ul.innerHTML = '<li class="empty">No incidents yet — click <b>FIRE ALERT</b> to start a demo.</li>';
      return;
    }

    ul.innerHTML = STATE.incidents.map(inc => {
      const sevN = (inc.alert.severity || '').match(/\d+/)?.[0] || '3';
      const isActive = inc.id === STATE.selectedId ? 'active' : '';
      const phaseLabel = inc.phase.toUpperCase().replace('_', ' ');
      const phaseCls = `phase-${inc.phase}`;
      const elapsed = inc.diagnosis_ms
        ? `${(inc.diagnosis_ms / 1000).toFixed(1)}s`
        : `${((Date.now() - inc.started_at) / 1000).toFixed(0)}s`;
      return `
        <li class="incident-item ${isActive}" data-id="${inc.id}">
          <div class="incident-svc">${inc.alert.service}</div>
          <div class="incident-meta">
            <span class="sev-pill sev-${sevN}">SEV-${sevN}</span>
            <span class="phase-pill ${phaseCls}">${phaseLabel}</span>
            <span>${elapsed}</span>
          </div>
        </li>
      `;
    }).join('');

    $$('.incident-item', ul).forEach(el => {
      el.addEventListener('click', () => {
        STATE.selectedId = el.dataset.id;
        STATE.lastEventTs = 0;
        refresh();
      });
    });
  }

  // ─────────────────────────── detail ───────────────────────────

  function renderDetail() {
    const body = $('#detail-body');
    const head = $('#detail-header');
    const inc  = STATE.fullIncident;

    if (!inc) {
      head.textContent = 'SELECT AN INCIDENT';
      body.innerHTML = `
        <div class="empty-detail">
          <div class="empty-graphic">◤ ◢</div>
          <p>Pick an incident from the left, or fire a new demo alert.</p>
        </div>
      `;
      return;
    }

    head.textContent = `INCIDENT ${inc.id} · ${inc.alert.service} · ${inc.phase.toUpperCase()}`;

    const sections = [];

    // -- Alert summary --
    sections.push(`
      <div class="detail-section">
        <div class="section-title">ALERT</div>
        <div class="kv-grid">
          <div class="k">service</div>      <div class="v">${inc.alert.service}</div>
          <div class="k">severity</div>     <div class="v">${inc.alert.severity}</div>
          <div class="k">description</div>  <div class="v">${inc.alert.description}</div>
          <div class="k">tags</div>         <div class="v">${(inc.alert.tags || []).join(', ')}</div>
          <div class="k">started</div>      <div class="v">${new Date(inc.started_at).toLocaleTimeString()}</div>
        </div>
      </div>
    `);

    // -- Hypothesis (if any) --
    if (inc.hypothesis) {
      const h = inc.hypothesis;
      sections.push(`
        <div class="detail-section">
          <div class="section-title mag">HYPOTHESES</div>
          <div class="hypothesis-card">
            <div class="conf">▶ TOP · ${(h.confidence * 100).toFixed(0)}% confidence</div>
            <div class="text">${escapeHtml(h.top)}</div>
            <div style="margin-top:10px;font-size:11px;color:var(--text-muted);font-family:var(--font-mono);">
              backed by: ${(h.supporting_evidence || []).map(s => `[E:${s}]`).join(' ')}
            </div>
          </div>
        </div>
      `);
    }

    // -- Remediation (if any) --
    if (inc.remediation) {
      const reMd = inc.remediation.map(r => `
        <div class="remediation-item risk-${r.risk}">
          <div class="remediation-head">
            <span class="risk-pill risk-${r.risk}">risk: ${r.risk}</span>
          </div>
          <div class="remediation-cmd">${escapeHtml(r.action)}</div>
          <div class="remediation-why">${escapeHtml(r.why)}</div>
        </div>
      `).join('');
      sections.push(`
        <div class="detail-section">
          <div class="section-title green">REMEDIATION — HUMAN-IN-THE-LOOP</div>
          ${reMd}
          <div class="detail-actions">
            <button class="btn-primary" id="btn-slack">▶ POST TO SLACK</button>
            <button class="btn-secondary">MARK FALSE POSITIVE</button>
          </div>
        </div>
      `);
    }

    // -- Evidence (4 tabs) --
    if (inc.findings && Object.keys(inc.findings).length) {
      sections.push(renderEvidenceTabs(inc.findings));
    }

    body.innerHTML = sections.join('');

    // bind tabs
    $$('.tab', body).forEach(t => {
      t.addEventListener('click', () => {
        STATE.activeTab = t.dataset.tab;
        $$('.tab', body).forEach(x => x.classList.toggle('active', x.dataset.tab === STATE.activeTab));
        $$('.tab-pane', body).forEach(x => x.classList.toggle('active', x.dataset.pane === STATE.activeTab));
      });
    });

    const slackBtn = $('#btn-slack', body);
    if (slackBtn) slackBtn.addEventListener('click', () => postToSlack(inc.id));
  }

  async function postToSlack(incidentId) {
    const r = await fetch(`/api/incidents/${incidentId}/post-slack`, { method: 'POST' });
    const j = await r.json();
    alert(j.preview || JSON.stringify(j));
  }

  function renderEvidenceTabs(findings) {
    const tabs = [
      { key: 'logs',    label: 'LOGS',    has: !!findings.logs },
      { key: 'metrics', label: 'METRICS', has: !!findings.metrics },
      { key: 'traces',  label: 'TRACES',  has: !!findings.traces },
      { key: 'deploys', label: 'DEPLOYS', has: !!findings.deploys },
    ];
    const activeKey = tabs.find(t => t.has && t.key === STATE.activeTab)?.key
                    || tabs.find(t => t.has)?.key
                    || 'logs';
    STATE.activeTab = activeKey;

    return `
      <div class="detail-section">
        <div class="section-title amber">EVIDENCE</div>
        <div class="tabs">
          ${tabs.map(t => `
            <button class="tab ${t.key === activeKey ? 'active' : ''} ${t.has ? '' : 'disabled'}"
                    data-tab="${t.key}" ${t.has ? '' : 'disabled'}>${t.label}</button>
          `).join('')}
        </div>
        <div class="tab-pane ${activeKey === 'logs' ? 'active' : ''}" data-pane="logs">${renderLogs(findings.logs)}</div>
        <div class="tab-pane ${activeKey === 'metrics' ? 'active' : ''}" data-pane="metrics">${renderMetrics(findings.metrics)}</div>
        <div class="tab-pane ${activeKey === 'traces' ? 'active' : ''}" data-pane="traces">${renderTraces(findings.traces)}</div>
        <div class="tab-pane ${activeKey === 'deploys' ? 'active' : ''}" data-pane="deploys">${renderDeploys(findings.deploys)}</div>
      </div>
    `;
  }

  function renderLogs(logs) {
    if (!logs) return '<div style="color:var(--text-faint)">no logs evidence yet…</div>';
    const top = (logs.top_messages || []).map(m =>
      `<div class="log-msg"><span class="count">${m.count}</span>${escapeHtml(m.message)}</div>`
    ).join('');
    return `
      <div class="kv-grid">
        <div class="k">total hits</div> <div class="v">${logs.hits}</div>
        <div class="k">first at</div>   <div class="v">${logs.first_at || '—'}</div>
        <div class="k">peak at</div>    <div class="v">${logs.peak_at || '—'}</div>
      </div>
      <div style="margin-top:12px">${top}</div>
    `;
  }

  function renderMetrics(metrics) {
    if (!metrics) return '<div style="color:var(--text-faint)">no metrics yet…</div>';
    const rows = Object.entries(metrics).map(([name, m]) => {
      const cls = (m.verdict || '').startsWith('SPIKE') ? 'spike'
                : (m.verdict || '').startsWith('NORMAL') ? 'normal' : '';
      return `
        <div class="evidence-line">
          <span class="k">${name}</span>
          <span class="v ${cls}">${m.baseline} → ${m.peak} @ ${m.peak_at?.slice(11,16) || '—'} · <b>${m.verdict}</b></span>
        </div>
      `;
    }).join('');
    return rows;
  }

  function renderTraces(traces) {
    if (!traces) return '<div style="color:var(--text-faint)">no traces yet…</div>';
    let html = `
      <div class="kv-grid">
        <div class="k">inspected</div>  <div class="v">${traces.traces_inspected}</div>
        <div class="k">error rate</div> <div class="v">${traces.error_rate}</div>
      </div>
    `;
    if (traces.hot_span) {
      html += `
        <div style="margin-top:10px"><b style="color:var(--cyan)">HOT SPAN</b></div>
        <div class="evidence-line">
          <span class="k">${traces.hot_span.name}</span>
          <span class="v spike">${traces.hot_span.baseline_ms}ms → ${traces.hot_span.median_ms}ms (${traces.hot_span.ratio})</span>
        </div>
        <div style="margin-top:10px;color:var(--text-muted);font-size:12px">
          ${escapeHtml(traces.downstream_suspect || '')}
        </div>
      `;
    }
    return html;
  }

  function renderDeploys(deploys) {
    if (!deploys) return '<div style="color:var(--text-faint)">no deploy info yet…</div>';
    if (!deploys.deploys || !deploys.deploys.length) {
      return '<div style="color:var(--text-muted);font-style:italic">no deploys in the 2h window — likely not a code regression.</div>';
    }
    return deploys.deploys.map(d => `
      <div class="evidence-line">
        <span class="k suspect-${d.suspect}">${d.suspect}</span>
        <span class="v">
          <b>${d.service}</b> · <code>${d.sha}</code> · ${d.minutes_before}m before
          <br>${escapeHtml(d.pr_title)} by @${d.author}
          <br><a href="${d.pr_url}" target="_blank" style="color:var(--cyan);font-size:10px">${d.pr_url}</a>
        </span>
      </div>
    `).join('');
  }

  // ─────────────────────────── activity log ───────────────────────────

  function renderActivity() {
    const ul = $('#activity-log');
    const inc = STATE.fullIncident;
    if (!inc || !inc.events?.length) {
      ul.innerHTML = '<li class="empty">— idle —</li>';
      return;
    }

    const atBottom = ul.scrollHeight - ul.scrollTop - ul.clientHeight < 12;

    ul.innerHTML = inc.events.map(e => `
      <li class="activity-line">
        <span class="time">${new Date(e.ts).toLocaleTimeString().slice(0,8)}</span>
        <span class="agent agent-${e.agent}">[${e.agent}]</span>
        <span class="action">${e.action}</span>
        <span class="detail">${escapeHtml(e.detail || '')}</span>
      </li>
    `).join('');

    if (atBottom) ul.scrollTop = ul.scrollHeight;
  }

  // ─────────────────────────── util ───────────────────────────

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
})();
