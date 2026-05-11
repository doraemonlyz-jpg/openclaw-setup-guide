# Module 10 — Observability：让老板看得见

> Multi-Agent 系统跑起来像一群黑盒。没有可观测性，老板就在猜"它们在干嘛"。
> 这章讲怎么让 Agent 系统变透明：状态、日志、通知、UI。

---

## 1. Observability 的三个维度

借用 Charity Majors 的分法（来自 honeycomb.io 文化）：

| 维度 | 问题 | 工具 |
|---|---|---|
| **Metrics** | 多少 Agent 在跑？延迟分布？成功率？ | Prometheus / Datadog |
| **Logs** | 那个 Agent 这一步具体说了什么？ | ELK / Loki |
| **Traces** | 这一次任务从老板请求到最终交付，每一步用了多少时间？ | Jaeger / OTel |

加上 Agent 特有的第四个维度：

| 维度 | 问题 | 工具 |
|---|---|---|
| **Conversation Replay** | 让我看 PM 和 worker 之间到底说了什么 | 自建 UI / LangSmith |

---

## 2. 我们项目的 Observability 体系

### 2.1 总览

```
┌──────────────── Boss Dashboard ─────────────────┐
│                                                 │
│  Top bar:  AGENTS: 8 | PROJECTS: 12 | LIVE: 3   │
│            ┌────────────────────────────────┐   │
│            │  ◤ DELIVERED ◢                 │   │
│            │  pomodoro · 5m 12s · HTTP 200  │   │
│            └────────────────────────────────┘   │
│                                                 │
│  ┌─Agents──┐ ┌─Projects───┐ ┌─Live Activity─┐  │
│  │ pm      │ │ stock-app  │ │ [PM] dispatching │
│  │ techlead│ │   running  │ │ [eng-be] writ... │
│  │ eng-be  │ │ pomodoro   │ │ [QA] PASS 6/6    │
│  │ ...     │ │   complete │ │ ...               │
│  └─────────┘ └────────────┘ └──────────────────┘ │
│                                                 │
│  ┌─Project Detail (selected: stock-app)────────┐│
│  │ ▶ RUN  ⏹ STOP  OPEN  FIX        ● RUNNING  ││
│  │ Files: app.py, templates/, static/, ...     ││
│  │ STATUS.json: phase=complete                 ││
│  │ Run log: [INFO] Listening on :5099 ...      ││
│  └─────────────────────────────────────────────┘│
│                                                 │
│  Boss command: [Type your request here...]      │
└─────────────────────────────────────────────────┘
```

### 2.2 模块对应

| UI 区域 | 数据源 | 协议 |
|---|---|---|
| Agents 列表 | `~/.openclaw/company/agents-workspaces/*/AGENTS.md` 的存在性 | filesystem scan |
| Projects 列表 + phase | `~/.openclaw/company/projects/<slug>/STATUS.json` + 启发式 | filesystem scan + read JSON |
| Live Activity | `openclaw sessions tail` 或 OpenClaw 的 session log | child process stdout |
| Project Detail (files) | `os.scandir(project_dir)` | filesystem |
| Project Detail (RUN/STOP) | `running.json` 持久化 + `os.kill(pid, 0)` 心跳 | local state |
| Run log | `/tmp/<slug>-run.log` (per-project tailable) | filesystem tail |
| Completion banner | 比较 last poll 的 STATUS.json | client-side delta detection |
| Desktop notification | Browser Notifications API | browser native |
| Chime / failure tone | WebAudio API | browser native |

---

## 3. STATUS.json：唯一可信的"完成签名"

### 3.1 Why explicit > heuristic

我们最早用启发式：

```python
def detect_phase(project):
    if has_readme and has_code and has_tests and recently_modified:
        return "complete"
    return "running"
```

问题：

- `recently_modified` 把 `.venv` / `__pycache__` 的 mtime 算进去 → 永远"running"
- worker 写一个空 README 就"骗"过了 has_readme
- 项目真的失败了（test 不过）也可能被标 "complete"

### 3.2 STATUS.json 设计

```json
{
  "phase": "complete",                      // 或 "failed"
  "summary": "Pomodoro CLI delivered",       // 一句话给老板
  "ended_at": 1715377800,                    // unix seconds
  "files": 8,                                // 项目文件数
  "test_status": "pass",                     // pass | fail | partial
  "qa_pass_ratio": "6/6",                    // QA 测试通过比
  "smoke_http_code": 200,                    // DevOps 抓到的 HTTP code
  "source": "pm",                            // pm 写的 vs watchdog 兜底
  "reason": "",                              // failed 时填："qa_4_of_6_passed"
  "next_step": ""                            // failed 时填：下一步建议
}
```

### 3.3 Dashboard 怎么用

```python
def project_phase(project_dir):
    status_file = project_dir / "STATUS.json"
    if status_file.exists():
        data = json.loads(status_file.read_text())
        return data.get("phase", "unknown"), data
    # 兜底启发式
    return _heuristic_phase(project_dir), None
```

**优先用 STATUS.json**——它不存在才用启发式。

---

## 4. Live Activity：让老板看 PM 和 worker 在说什么

### 4.1 实现思路

OpenClaw 的 session 数据写在 `~/.openclaw/sessions/<id>.json`，每条消息都带时间戳。

dashboard 每 2 秒拉一次最近的 N 条，按 Agent 分类显示：

```javascript
async function refreshLiveActivity() {
  const r = await fetch('/api/live-activity?limit=50');
  const events = await r.json();
  events.forEach(ev => {
    activityEl.appendChild(renderEvent(ev));
  });
  activityEl.scrollTop = activityEl.scrollHeight; // auto-scroll
}
setInterval(refreshLiveActivity, 2000);
```

### 4.2 显示格式

```
[13:42:15 PM]      → techlead: "Write TASKS.md for Pomodoro..."
[13:42:30 techlead] read SPEC.md
[13:42:45 techlead] write TASKS.md (1.2 KB)
[13:42:46 techlead] → PM: "TASKS.md ready, 6 tasks."
[13:42:48 PM]      read TASKS.md (verify)
[13:42:50 PM]      → eng-be: "T1: Build timer logic..."
...
```

每条带 timestamp、来源 Agent、动作、对象。

### 4.3 自动滚动陷阱

老板正在往上滑看历史，新消息把他拉回底部 = 极差体验。
解决：

```javascript
// 用户是否在底部？
const atBottom = activityEl.scrollHeight - activityEl.scrollTop
                 - activityEl.clientHeight < 5;

// 只在底部时才自动滚
if (atBottom) {
    activityEl.scrollTop = activityEl.scrollHeight;
}
```

我们 dashboard 早期没做这个，老板狂吐槽。

---

## 5. Notifications：项目跑完通知老板

### 5.1 三种通道，全部用上

#### 浏览器横幅

```javascript
function showCompletionBanner(slug, phase, summary) {
    const banner = document.getElementById('completion-banner');
    banner.classList.remove('hidden');
    banner.classList.toggle('failed', phase === 'failed');
    banner.querySelector('.cb-title').textContent =
        phase === 'complete' ? '◤ DELIVERED ◢' : '◤ BUILD FAILED ◢';
    banner.querySelector('.cb-meta').textContent = `${slug} · ${summary}`;
}
```

#### 桌面通知（Notifications API）

```javascript
function fireDesktopNotification(slug, phase, summary) {
    if (Notification.permission !== 'granted') return;
    const n = new Notification(
        phase === 'complete' ? `✓ ${slug} delivered` : `✗ ${slug} build failed`,
        { body: summary, icon: '/favicon.ico' }
    );
    n.onclick = () => window.focus();
}
```

需要先请求权限：

```javascript
notifyBtn.onclick = async () => {
    const result = await Notification.requestPermission();
    paintNotifyBtn(result);
};
```

#### 音效（WebAudio API）

```javascript
function playCompletionChime() {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {  // C-E-G 三和弦
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.2, now + i * 0.1 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.1 + 0.6);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.7);
    });
}
```

失败用低音 / 不和谐音：

```javascript
function playFailureTone() {
    // 220Hz + 233Hz (小二度，刺耳)
}
```

### 5.2 触发时机

```javascript
async function refreshRunStatus() {
    const newStatus = await fetchAll();
    Object.entries(newStatus).forEach(([slug, info]) => {
        const prev = lastRunStatus[slug];
        if (prev && prev.phase === 'running' && info.phase === 'complete') {
            celebrateCompletion(slug, info, 'complete');
        }
        if (prev && prev.phase === 'running' && info.phase === 'failed') {
            celebrateCompletion(slug, info, 'failed');
        }
    });
    lastRunStatus = newStatus;
}
setInterval(refreshRunStatus, 3000);
```

**核心**：检测的是 **phase 变化**，不是绝对状态。`running → complete` 才触发，避免重复弹。

### 5.3 防重复

```javascript
const firedCompletions = new Set();
function celebrateCompletion(slug, info, phase) {
    const key = `${slug}:${phase}:${info.ended_at}`;
    if (firedCompletions.has(key)) return;
    firedCompletions.add(key);
    showCompletionBanner(slug, phase, info.summary);
    fireDesktopNotification(slug, phase, info.summary);
    if (phase === 'complete') playCompletionChime();
    else playFailureTone();
}
```

---

## 6. Trace：跨 Agent 关联日志

理想：老板点一个项目，能看到从老板请求到 STATUS.json 的**整条 trace**。

### 6.1 简单版（我们项目）

每个 PM dispatch 给一个 trace_id。
所有 worker 在自己 log 里带这个 trace_id。
dashboard 按 trace_id 聚合显示。

### 6.2 标准版

用 OpenTelemetry：

```python
from opentelemetry import trace

tracer = trace.get_tracer("agent-system")

with tracer.start_as_current_span("pm.dispatch_techlead"):
    with tracer.start_as_current_span("llm.completion"):
        resp = llm.chat(messages, tools)
    with tracer.start_as_current_span("tool.sessions_send"):
        result = run_tool(resp.tool_calls[0])
```

输出可以喂给 Jaeger / Tempo / Honeycomb。

### 6.3 Agent 特有的 trace 内容

每个 span 应该带：

- `agent.id`
- `agent.model`
- `agent.persona_hash`（追踪 prompt 改动影响）
- `tool.name`（如果是 tool call）
- `prompt.tokens` / `completion.tokens`
- `cost_usd`（折算）

---

## 7. Metric：什么应该上报

### 7.1 全局

| Metric | Why |
|---|---|
| `agent_invocations_total{agent,model}` | 谁被调最多 |
| `agent_latency_seconds{agent,model}` | 哪个 Agent 最慢 |
| `tool_calls_total{tool,agent}` | 哪个工具用得多 |
| `tool_failures_total{tool,reason}` | 工具哪里出问题 |
| `agent_iterations_count{agent}` | Agent 跑几轮才完 |
| `task_completion_rate{phase}` | 整体成功率 |
| `tokens_consumed_total{agent,direction}` | 成本 |

### 7.2 业务

| Metric | Why |
|---|---|
| `projects_built_total{phase}` | 一天交付多少项目 |
| `time_to_delivery_seconds` | 从老板请求到 STATUS.json 完成 |
| `fix_mode_invocations_total` | 多少项目要 FIX |
| `watchdog_stamped_total{reason}` | watchdog 兜底了多少次 |
| `gate_failures_total{gate}` | QA / DevOps gate 哪个失败多 |

### 7.3 Alert 设计

```
- alert: AgentSystemDown
  expr: rate(agent_invocations_total[5m]) == 0
  for: 5m
  annotations:
    summary: "No agent activity in last 5 min"

- alert: ExcessiveFixMode
  expr: rate(fix_mode_invocations_total[1h]) > 5
  annotations:
    summary: "FIX MODE triggered >5x/hour — quality issue?"

- alert: WatchdogOverload
  expr: rate(watchdog_stamped_total[10m]) > 0.1
  annotations:
    summary: "Watchdog tagging >10% of completions — PM is failing to stamp"
```

---

## 8. UX 细节：让 dashboard 真的能用

### 8.1 颜色编码

| 状态 | 颜色 | 心理映射 |
|---|---|---|
| running | 绿色脉动 | "在跑，有活力" |
| complete | 青色稳定 | "冷静、完成" |
| failed | 红色 | 警告 |
| stalled | 黄色闪烁 | "可疑，要看看" |
| empty | 灰色 | "啥也没有" |

### 8.2 不要塞所有信息

dashboard 一次只显示用户当下决策需要的信息。详细信息**点击展开**。

我们的 dashboard 默认显示 8 个 Agent 状态 + 当前项目 phase + 最新 5 条 activity。其他都在二级页面。

### 8.3 动作可逆 / 二次确认

- DELETE 必须二次确认
- STOP 不需要（误点损失小）
- FIX 不需要（FIX 不会破坏现有文件）

---

## 9. 实战练习

给一个 customer support Agent 系统设计可观测性：

3 个 Agent：router、support、sales。
每天处理 10K conversation。

写出：

1. 5 个最重要的 metric
2. 3 条 alert 规则
3. 一个 trace 示例：用户 → router → support → 完成
4. dashboard mockup（哪些信息要露在第一屏）
5. 怎么处理 PII（用户 message 不能直接进 metric）

---

## 10. 自测题

1. Observability 的四个维度（含 Agent 特有的）是哪几个？
2. STATUS.json 比启发式好在哪？
3. 浏览器通知三件套（横幅 / desktop / 音效）各自适合什么场景？为什么要三个都做？
4. trace 一个 Agent 任务，每个 span 应该带哪些标签？
5. WatchdogOverload alert 触发说明系统什么问题？

下一站：[Module 11 — 50 道高频面试题](11-interview-qa.md)
