# Module 09 — Self-Healing：FIX MODE 自愈系统

> 让 Agent **修自己造的 bug** 是 2026 年最实际的"high-leverage" 应用。
> 这章拆解我们项目的 FIX MODE：诊断 → 派单 → 验证 → 重试，用真实代码讲清楚每一环。

---

## 1. 为什么需要 Self-Healing

### 1.1 Agent 系统的"bug 复利"

Agent 系统比传统软件 bug 多得多：

- 模型选错工具
- 工具结果被截断，模型误解
- 文件结构看起来对但运行起 500
- 依赖装不上
- 端口被占用
- 模板语法错误
- ...

如果每次出 bug 都要老板介入修，Agent 的"自动化价值" 就消失了一半——**Agent 越多，老板被中断越多**。

### 1.2 Self-Healing 的承诺

让 Agent 系统**自己感知 bug + 自己修**。老板只在最终结果上做决策（满意 / 不满意），不参与中间。

### 1.3 反例：盲目重试 ≠ 自愈

很多人做"自愈"就是循环重试：

```python
for i in range(5):
    try:
        agent_run(task)
        break
    except:
        continue
```

**这不是自愈**——这是"撞大运"。同样的输入跑多次，错误不会消失。

真自愈要：

1. **诊断**（弄清楚错在哪）
2. **定向修**（修对的地方）
3. **验证**（确认修好了）

---

## 2. FIX MODE 总览

我们的 PM 有一个专门的 "FIX MODE" workflow，由用户点击 dashboard 上的 **FIX** 按钮触发。

```
[Boss 点 FIX 按钮]
        │
        ▼
[Dashboard POST /api/projects/<slug>/fix]
        │
        ▼
[Spawn PM Agent with [FIX] prompt]
        │
        ▼
┌─────────── PM FIX MODE ───────────┐
│                                   │
│  Step 1: 让 DevOps 跑诊断 smoke-test │
│         (不改任何文件)              │
│                                   │
│  Step 2: 读 EVIDENCE                │
│         若 PASS → "其实是好的" 报老板 │
│                                   │
│  Step 3 (FAIL): 根据失败模式定位     │
│         - TemplateNotFound → eng-fe │
│         - ImportError → eng-be      │
│         - HTTP 404 → eng-be 路由 bug │
│         - HTML 缺失 → eng-fe        │
│         - 进程崩溃 → 看 log → eng-be │
│                                   │
│  Step 4: 派单（含 EVIDENCE 全文）   │
│                                   │
│  Step 5: trust-but-verify 修改     │
│                                   │
│  Step 6: 重跑 DevOps gate           │
│         FAIL → loop step 4         │
│         （最多 3 轮）              │
│                                   │
│  Step 7: 重写 STATUS.json           │
│                                   │
│  Step 8: 报告老板                   │
│                                   │
└───────────────────────────────────┘
        │
        ▼
[Watchdog 兜底 STATUS.json]
        │
        ▼
[Dashboard 弹完成横幅 / 失败横幅]
```

---

## 3. 三个核心设计决策

### 3.1 不重建，只修

老板的反馈（真实事件）：

> "你不应该让 PM 把整个 SPEC / TASKS / DESIGN / 所有代码都重写一遍。它只应该改坏的那一个文件。"

PM 的 FIX MODE persona 明确禁止：

```markdown
**Do NOT** in FIX MODE:
- Re-write SPEC.md / TASKS.md / DESIGN.md (they're still valid — only implementation broke)
- Re-engage the writer (README is fine if it was fine)
- Run the full new-project pipeline (phases 2-9) — that wastes 30+ minutes
```

### 3.2 用 Structural Evidence 做诊断，不靠 LLM 直觉

PM 不允许"猜哪里坏了"。它必须先让 DevOps 跑 smoke-test，**拿到一个 EVIDENCE block**（含 HTTP 码、ALIVE 标记、log tail），再据此**机械地**映射到对应的 owner。

映射表（在 PM persona 里写死）：

| 失败模式 | 坏文件 | Route to |
|---|---|---|
| `TemplateNotFound` / 500 on `/` | `templates/<file>` | eng-fe |
| `ImportError` / `ModuleNotFoundError` | `requirements.txt` | eng-be |
| `<HTTP=404>` on a known route | `app.py` 路由 | eng-be |
| HTML 看似存在但浏览器空白 | 前端 | eng-fe |
| 进程开机就死 | 看 log → 通常 backend | eng-be |

**机械映射 > LLM 推理**——速度快、可重现、可调试。

### 3.3 限定循环次数

```markdown
6. Re-run DevOps gate (step 1) on the fixed project.
   If <RESULT>PASS</RESULT> → continue to step 7.
   If still FAIL → loop to step 4 with new EVIDENCE
   (max 3 fix rounds total).
```

**为什么 3 次**：
- 第 1 次错可能是模型 mistakes
- 第 2 次错可能是修的地方对但还有别的地方
- 第 3 次还错，**说明这个 bug 不是 Agent 能修的**——必须报失败让人介入

无限循环是 Agent 系统的死亡陷阱。

---

## 4. Smoke-test endpoint 详解

FIX MODE 的命脉是 dashboard 提供的 `/api/projects/<slug>/smoke-test` endpoint。看代码：

```python
@app.route("/api/projects/<slug>/smoke-test", methods=["POST", "GET"])
def api_project_smoke_test(slug: str):
    project = _project_path(slug)
    if not project:
        return "no such project", 404

    extra_path = request.args.get("path", "/").lstrip("/")
    extra_path = "/" + extra_path

    # 1. 装依赖
    venv = _ensure_venv(project)
    # 2. 起进程在空闲端口
    port = _free_port(5099, 5199)
    proc = _start_process(project, venv, port)
    time.sleep(3)  # 给 Flask 启动时间

    ev_lines = []
    ev_lines.append(f"Entry point: {entry} on port {port}")
    ev_lines.append(f"<ALIVE={0 if proc.poll() is None else 1}>")

    # 3. GET /
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/",
                                    timeout=10) as r:
            body = r.read(2048).decode("utf-8", errors="replace")
            ev_lines.append(f"<HTTP={r.status}>")
            ev_lines.append("```")
            ev_lines.append(body[:500])
            ev_lines.append("```")
    except Exception as e:
        ev_lines.append(f"<HTTP=0>")
        ev_lines.append(f"GET / failed: {e}")

    # 4. GET extra path（如 /price?ticker=AAPL）
    if extra_path != "/":
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}{extra_path}", timeout=10) as r:
                body = r.read(2048).decode("utf-8", errors="replace")
                ev_lines.append(f"\nGET {extra_path}")
                ev_lines.append(f"<HTTP={r.status}>")
                ev_lines.append(body[:500])
        except Exception as e:
            ev_lines.append(f"\n{extra_path} failed: {e}")

    # 5. tail 最近 log
    log_tail = _read_log_tail(project, lines=10)
    ev_lines.append(f"\nApp log tail:\n{log_tail}")

    # 6. 杀进程
    proc.terminate()
    proc.wait(timeout=5)

    # 7. 计算 RESULT
    is_pass = ("<HTTP=200>" in "\n".join(ev_lines)
               and "<html" in "\n".join(ev_lines).lower())
    ev_lines.append(f"\n<RESULT>{'PASS' if is_pass else 'FAIL'}</RESULT>")

    return ("\n".join(ev_lines), 200, {"Content-Type": "text/plain"})
```

注意几个设计：

1. **Plain text output**——DevOps 的 LLM 可以原样转发，不用解析 JSON
2. **Verbatim body**（前 500 字符）——让 LLM 能"看到"真实页面内容
3. **`<HTTP=...>` / `<RESULT>` tag**——机器可读
4. **每次都新启动 + 杀掉**——干净，没有副作用

---

## 5. 一次完整的 FIX MODE 跑通

实际跑出来的日志：

```
[T+0]    User clicks FIX button on stock-price-app
         (project's templates/index.html is broken — only 62 bytes)

[T+1s]   Dashboard POST /api/projects/stock-price-app/fix
         → spawns: openclaw agent --agent pm --message "[FIX] ..."

[T+15s]  PM Ollama load (cold)

[T+30s]  PM tool_call: sessions_send to devops "diagnose-only smoke-test"

[T+45s]  DevOps tool_call: bash curl -X POST .../smoke-test

[T+50s]  Dashboard runs:
         - venv create
         - pip install flask yfinance
         - .venv/bin/python app.py &
         - curl http://127.0.0.1:5099/
         - returns EVIDENCE:
             <ALIVE=0>
             <HTTP=200>
             ```
             /* placeholder */
             ```
             <RESULT>FAIL</RESULT>

[T+90s]  DevOps replies to PM with verbatim EVIDENCE

[T+95s]  PM analyzes:
         - HTTP=200 但 body 是 "/* placeholder */"
         - 映射表："HTML present but broken → eng-fe"

[T+100s] PM tool_call: sessions_send to eng-fe
         "FIX request for stock-price-app. The current
         templates/index.html is just a CSS comment placeholder.
         Read app.py to see what variables/routes exist, then
         write a proper templates/index.html.
         <Pasted EVIDENCE block verbatim>"

[T+110s] eng-fe Ollama swap (qwen2.5-coder:7b)

[T+180s] eng-fe tool_call: read app.py
[T+200s] eng-fe tool_call: write templates/index.html (2535 bytes)
[T+210s] eng-fe replies to PM "T-fix done: templates/index.html restored"

[T+215s] PM trust-but-verify: read templates/index.html
         → file size 2535 bytes, contains <html>, OK

[T+220s] PM tool_call: sessions_send to devops "re-run smoke-test"

[T+250s] DevOps + dashboard re-run:
         <HTTP=200>
         ```
         <html><head><title>Stock Price</title>...
         <RESULT>PASS</RESULT>

[T+255s] PM writes STATUS.json:
         {"phase": "complete",
          "summary": "Restored templates/index.html (62 → 2535 bytes)",
          "ended_at": ..., "files": 8,
          "test_status": "pass", "smoke_http_code": 200}

[T+260s] PM replies to boss:
         "Fixed: templates/index.html was a 62-byte placeholder.
         eng-fe rewrote it (2535 bytes) using the variables from
         app.py. DevOps confirms HTTP 200 with real content.
         Open http://127.0.0.1:5099/ to verify."

[T+260s] Dashboard detects new STATUS.json → "DELIVERED" 横幅 + chime
```

**4 分 20 秒**，全自动，老板没动手。

---

## 6. Watchdog 兜底（再讲一次，因为 self-healing 也要兜底）

如果 PM 干完活但**忘了写 STATUS.json**，watchdog 接管：

```python
def _spawn_status_watchdog(slug, pm_pid, dispatch_at, project_path):
    # 等 PM 退出（最多 30 分钟）
    while time.time() < deadline:
        try: os.kill(pm_pid, 0)
        except ProcessLookupError: break
        time.sleep(10)

    # 检查 PM 是否真的写了 STATUS.json
    if status_path.exists() and status_path.stat().st_mtime >= dispatch_at:
        return  # PM 干了，不管

    # PM 没写 → 自己跑一次 smoke-test，写一个
    evidence = curl(f"http://127.0.0.1:5050/api/projects/{slug}/smoke-test")
    is_pass = "<RESULT>PASS</RESULT>" in evidence

    status_path.write_text(json.dumps({
        "phase": "complete" if is_pass else "failed",
        "summary": "Auto-stamped by watchdog (PM didn't stamp)",
        "source": "watchdog",
        "reason": "pm_did_not_stamp" if not is_pass else "",
        ...
    }))
```

**意义**：即使 self-healing 部分失败，老板还是能拿到一个明确的"成功 / 失败" 结论——而不是"不知道"。

---

## 7. Self-Healing 的设计原则总结

1. **具体诊断 > 盲目重试**：先弄清楚错在哪，再修
2. **机械映射 > LLM 推理**：失败模式 → owner 用查表，不用让 LLM 猜
3. **结构化证据**：smoke-test 返回的 `<HTTP=200>` 比 LLM 自评可信
4. **限定循环次数**：3 次修不好就投降，让人介入
5. **不重建**：只动出错的文件，别拆房子重盖
6. **Trust-but-verify**：worker 说改完了，PM read 确认
7. **失败要诚实**：STATUS.json `phase: "failed"` 必须填 `reason`
8. **Watchdog 兜底**：任何环节挂了，dashboard 兜底写一个明确的结果

---

## 8. 把 Self-Healing 应用到别的场景

### 8.1 Production 错误自愈

监控到错误率突增 → spawn fix Agent：

1. 拿最近 N 条错误 log
2. 分析共性
3. 找 commit 历史中可能引入 bug 的 PR
4. 生成回滚 PR / hotfix PR

### 8.2 数据流水线自愈

ETL 任务失败 → fix Agent：

1. 读 task log
2. 判断是上游数据缺失 / schema 变了 / 资源不足
3. 重启 / 通知上游 / 提 ticket

### 8.3 客服自愈

用户反馈"产品不能用" → support Agent：

1. 拿用户 ID 查最近 session
2. 跑诊断 endpoint（账户状态 / 订阅状态 / 网络）
3. 自动修（重置缓存、退订重订、联系 OPS）

通用模板：**诊断 endpoint → 映射表 → 派对应 specialist Agent → 验证 → 报告**。

---

## 9. 实战练习

设计一个 **TestFlakeFixerAgent**：

**场景**：CI 偶发性失败（flaky test）。Agent 自动判断这次失败是 flake 还是真 bug，是 flake 就重跑，是 bug 就开 ticket。

写出：

1. 诊断流程（怎么判断 flake vs bug）
2. 失败模式 → 处理映射
3. 循环上限 / 退出条件
4. 怎么验证修对了

把这个写完，面试聊"production 故障自愈"有现成例子讲。

---

## 10. 自测题

1. 为什么"循环重试"不算 self-healing？真 self-healing 要哪 3 步？
2. FIX MODE 为什么不允许 PM 重建整个项目？
3. PM 怎么决定派给哪个 worker？为什么不让它"自己看着办"？
4. Smoke-test endpoint 在 self-healing 里起什么作用？
5. 3 轮限制后还修不好，应该做什么？
6. Watchdog 在 self-healing 失败时怎么兜底？

下一站：[Module 10 — Observability](10-observability.md)
