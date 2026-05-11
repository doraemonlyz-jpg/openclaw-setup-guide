/* LLM Agent Engineering Tutorial — site app */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STATE = {
  manifest: null,
  currentModule: null,
  contentCache: new Map(),
};

/* ───────── boot ───────── */

async function boot() {
  // load manifest
  STATE.manifest = await fetch('manifest.json').then(r => r.json());

  // wire links to repo
  $('#github-link').href = STATE.manifest.github;
  $('#footer-github').href = STATE.manifest.github;
  $('#path-github').href = STATE.manifest.github;

  // setup marked
  marked.setOptions({
    gfm: true,
    breaks: false,
    headerIds: true,
    mangle: false,
    highlight: (code, lang) => {
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; }
        catch { /* ignore */ }
      }
      return hljs.highlightAuto(code).value;
    },
  });

  buildSidebarToc();
  buildLandingGrid();
  computeTotalMinutes();

  // route
  window.addEventListener('hashchange', route);
  route();

  // search
  setupSearch();

  // mobile menu
  $('#menu-toggle').addEventListener('click', toggleSidebar);
  // close sidebar on nav click (mobile)
  $('#sidebar').addEventListener('click', e => {
    if (e.target.closest('.toc-item') || e.target.closest('.outline-item')) {
      if (window.innerWidth <= 768) closeSidebar();
    }
  });
}

/* ───────── routing ───────── */

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '').trim();
  if (!h) return { kind: 'home' };
  // hash might be "module-id" or "module-id#anchor"
  const [moduleId, anchor] = h.split('#');
  return { kind: 'module', moduleId, anchor };
}

async function route() {
  const r = parseHash();
  if (r.kind === 'home') {
    showHome();
  } else {
    await showModule(r.moduleId, r.anchor);
  }
  highlightActiveTocItem();
}

function showHome() {
  $('#hero').classList.remove('hidden');
  $('#module').classList.add('hidden');
  STATE.currentModule = null;
  document.title = `${STATE.manifest.title} · ${STATE.manifest.subtitle}`;
  // clear page outline
  $('#page-outline').innerHTML = '<p class="muted small">Open a module to see headings.</p>';
  window.scrollTo(0, 0);
}

async function showModule(moduleId, anchor) {
  const mod = STATE.manifest.modules.find(m => m.id === moduleId);
  if (!mod) { showHome(); return; }

  $('#hero').classList.add('hidden');
  $('#module').classList.remove('hidden');

  $('#module-num').textContent = `MODULE ${mod.num}`;
  $('#module-mins').textContent = `~${mod.minutes} min`;
  document.title = `${mod.num} · ${mod.title} | ${STATE.manifest.title}`;

  STATE.currentModule = mod;

  const content = $('#module-content');
  content.innerHTML = '<div class="loading">Loading…</div>';

  const md = await loadModule(mod.id);
  content.innerHTML = marked.parse(md);

  // assign data-lang to <pre> blocks
  $$('pre code', content).forEach(codeEl => {
    const cls = codeEl.className.match(/language-(\w+)/);
    if (cls) {
      codeEl.parentElement.setAttribute('data-lang', cls[1]);
    }
    // re-highlight if needed
    hljs.highlightElement(codeEl);
  });

  // build page outline (h2 + h3)
  buildPageOutline(content);

  // intercept internal links to other modules
  $$('a', content).forEach(a => {
    const href = a.getAttribute('href');
    if (href && href.match(/^\d+-[a-z-]+\.md$/)) {
      a.setAttribute('href', '#/' + href.replace('.md', ''));
    } else if (href && href.startsWith('../')) {
      // README link or assets — leave external open
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener');
    }
  });

  // build prev/next nav
  buildModuleNav(mod);

  // scroll to anchor or top
  if (anchor) {
    setTimeout(() => {
      const el = document.getElementById(anchor);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  } else {
    window.scrollTo(0, 0);
  }

  // setup scroll spy on outline
  setupScrollSpy();
}

async function loadModule(id) {
  if (STATE.contentCache.has(id)) return STATE.contentCache.get(id);
  const r = await fetch(`modules/${id}.md`);
  if (!r.ok) return `# 加载失败\n\n无法加载 \`modules/${id}.md\`。请从 \`tutorial/site/\` 目录启动 HTTP server：\n\n\`\`\`bash\ncd openclaw-setup-guide/tutorial/site\npython3 -m http.server 8765\n\`\`\``;
  const md = await r.text();
  STATE.contentCache.set(id, md);
  return md;
}

/* ───────── sidebar ───────── */

function buildSidebarToc() {
  const nav = $('#toc-nav');
  nav.innerHTML = '';
  STATE.manifest.modules.forEach(m => {
    const a = document.createElement('a');
    a.className = 'toc-item';
    a.href = `#/${m.id}`;
    a.dataset.id = m.id;
    a.innerHTML = `
      <span class="toc-num">${m.num}</span>
      <span class="toc-title">${escapeHtml(m.title)}</span>
    `;
    nav.appendChild(a);
  });
}

function highlightActiveTocItem() {
  $$('.toc-item').forEach(el => el.classList.remove('active'));
  if (STATE.currentModule) {
    const active = $(`.toc-item[data-id="${STATE.currentModule.id}"]`);
    if (active) active.classList.add('active');
  }
}

function buildPageOutline(contentEl) {
  const outline = $('#page-outline');
  outline.innerHTML = '';
  const headings = $$('h2, h3', contentEl);
  if (!headings.length) {
    outline.innerHTML = '<p class="muted small">No subheadings.</p>';
    return;
  }
  headings.forEach(h => {
    const id = h.id || slugify(h.textContent);
    if (!h.id) h.id = id;
    const a = document.createElement('a');
    a.className = `outline-item ${h.tagName.toLowerCase()}`;
    a.href = `#/${STATE.currentModule.id}#${id}`;
    a.textContent = h.textContent;
    outline.appendChild(a);
  });
}

function setupScrollSpy() {
  const headings = $$('#module-content h2, #module-content h3');
  const outlineItems = $$('.outline-item');
  if (!headings.length || !outlineItems.length) return;

  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const id = entry.target.id;
        outlineItems.forEach(o => {
          if (o.getAttribute('href').endsWith('#' + id)) {
            o.classList.add('active');
          } else {
            o.classList.remove('active');
          }
        });
      }
    });
  }, { rootMargin: '-20% 0px -70% 0px' });

  headings.forEach(h => observer.observe(h));
}

/* ───────── module nav ───────── */

function buildModuleNav(mod) {
  const idx = STATE.manifest.modules.findIndex(m => m.id === mod.id);
  const prev = STATE.manifest.modules[idx - 1];
  const next = STATE.manifest.modules[idx + 1];

  const prevEl = $('#nav-prev');
  const nextEl = $('#nav-next');

  if (prev) {
    prevEl.href = `#/${prev.id}`;
    prevEl.innerHTML = `
      <span class="nav-label">← 上一节 · ${prev.num}</span>
      <span class="nav-title">${escapeHtml(prev.title)}</span>
    `;
    prevEl.style.display = '';
  } else {
    prevEl.innerHTML = '';
    prevEl.style.display = 'none';
  }

  if (next) {
    nextEl.href = `#/${next.id}`;
    nextEl.innerHTML = `
      <span class="nav-label">下一节 · ${next.num} →</span>
      <span class="nav-title">${escapeHtml(next.title)}</span>
    `;
    nextEl.style.display = '';
  } else {
    nextEl.innerHTML = '';
    nextEl.style.display = 'none';
  }
}

/* ───────── landing grid ───────── */

function buildLandingGrid() {
  const grid = $('#module-grid');
  grid.innerHTML = '';
  STATE.manifest.modules.forEach(m => {
    const card = document.createElement('a');
    card.className = 'mg-card';
    card.href = `#/${m.id}`;
    card.innerHTML = `
      <div class="mg-num">MODULE ${m.num}</div>
      <div class="mg-title">${escapeHtml(m.title)}</div>
      <div class="mg-summary">${escapeHtml(m.summary)}</div>
      <div class="mg-mins">~${m.minutes} min</div>
    `;
    grid.appendChild(card);
  });
}

function computeTotalMinutes() {
  const total = STATE.manifest.modules.reduce((s, m) => s + (m.minutes || 0), 0);
  $('#stat-mins').textContent = total;
}

/* ───────── search ───────── */

function setupSearch() {
  const input = $('#search');
  const overlay = $('#search-overlay');
  const results = $('#search-results');
  let cache = null;

  async function ensureIndex() {
    if (cache) return cache;
    cache = [];
    for (const m of STATE.manifest.modules) {
      const md = await loadModule(m.id);
      cache.push({ module: m, content: md });
    }
    return cache;
  }

  input.addEventListener('input', async () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { overlay.classList.add('hidden'); return; }
    const idx = await ensureIndex();
    const hits = [];
    for (const { module, content } of idx) {
      const lc = content.toLowerCase();
      const pos = lc.indexOf(q);
      if (pos >= 0) {
        const snippet = content.substring(Math.max(0, pos - 40), pos + 80).replace(/\n/g, ' ');
        hits.push({ module, snippet });
        if (hits.length >= 12) break;
      }
    }
    if (!hits.length) {
      results.innerHTML = '<div class="search-result"><div class="muted small">没有匹配项</div></div>';
    } else {
      results.innerHTML = hits.map(h => `
        <a class="search-result" href="#/${h.module.id}">
          <div class="search-result-title">${h.module.num} · ${escapeHtml(h.module.title)}</div>
          <div class="search-result-snippet">${escapeHtml(h.snippet)}</div>
        </a>
      `).join('');
    }
    overlay.classList.remove('hidden');
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search') && !e.target.closest('.search-overlay')) {
      overlay.classList.add('hidden');
    }
  });

  results.addEventListener('click', () => { overlay.classList.add('hidden'); input.value = ''; });

  // ESC to close
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      overlay.classList.add('hidden');
      input.blur();
    }
  });
}

/* ───────── mobile menu ───────── */

function toggleSidebar() { $('#sidebar').classList.toggle('open'); }
function closeSidebar() { $('#sidebar').classList.remove('open'); }

/* ───────── helpers ───────── */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* go */
boot();
