# Module 07 — Lane Discipline：让每个 Agent 守住自己的边界

> 这章解决一个具体的生产问题：**多 Agent 系统里，每个 Agent 都"乐于助人"导致互相越界，结果谁的活都干不好**。
> 这是 LLM 的"helpfulness training" 在多 Agent 场景的副作用——必须用结构化机制压制。

---

## 1. 问题：Agent 都太"乐于助人"

我们项目实际遇到的三个故事：

### 故事 1：PM 偷偷写代码

PM 在 FIX MODE 里，本应派 eng-fe 去修 `templates/index.html`。结果它直接自己 `write` 了 HTML——**因为 LLM 觉得"反正我都能写，省一步派单"**。

老板看起来是项目修好了，但**多 Agent 系统的"团队协作"成了假象**——其实是 PM 一个人在干。

### 故事 2：eng-be 内联 stub HTML

PM 让 eng-be 写 `app.py`。eng-be 想"反正前端文件还没写，我先 inline 一段占位 HTML"——结果 `app.py` 里 hardcode 了 1KB 的 `<html>...</html>`。

后来 eng-fe 写真正的 `templates/index.html`，但 `app.py` 里的内联版本还在，造成混乱。

### 故事 3：QA / DevOps 偷偷修 bug

QA 跑测试发现一个 typo：`prince` 应该是 `price`。它"贴心地"自己用 edit 工具改了。

但**QA 的职责是发现 bug，不是修 bug**。一旦它修了，没人知道这个 bug 存在过，eng-be 也学不到经验，下次还会犯同样错误。

---

## 2. 为什么 Agent 倾向于越界

### 2.1 Helpfulness Training 的副作用

LLM 在 RLHF 阶段被强化"对用户有用"。当 PM 让 eng-be 写 `app.py`，eng-be 看到任务依赖 `templates/index.html` 还不存在，会"贴心"地补上——因为这样看起来更"完成度高"。

### 2.2 任务边界本身模糊

"写一个能跑起来的 Pomodoro 应用"——这个任务到底是 eng-be 的还是 eng-fe 的？模型自己也判断不清，倾向于"全做了算了"。

### 2.3 Persona 没有显式禁止

如果 eng-be 的 persona 只说"你写后端"，没说"你不能写前端"——模型会觉得"我也能写前端，那就一起做了"。

---

## 3. 解决方案：Lane Discipline

### 3.1 核心思想

为每个 Agent 显式定义：

1. **ALLOWED 写入路径**（白名单）
2. **FORBIDDEN 写入路径**（黑名单）
3. **越界时的标准回复模板**

### 3.2 我们的设计

每个 worker 的 AGENTS.md 都有一节：

```markdown
## 🚧 Stay in your lane — Backend Engineer

**ALLOWED write paths (under ~/.openclaw/company/projects/<slug>/):**
- app.py, server.py, main.py, or any Python file in project root
- requirements.txt
- Dockerfile (only if a deployment task explicitly mentions it)
- <config>.json (e.g. data fixtures referenced by your Python code)
- Sub-modules: api/*.py, models/*.py, services/*.py

**FORBIDDEN write paths:**
- Anything inside templates/ (eng-fe's)
- Anything inside static/ (eng-fe's)
- *.html, *.css, *.js anywhere
- Other agents' docs: SPEC.md, TASKS.md, DESIGN.md, README.md, TEST_*.md, STATUS.json

**When the task requires HTML/CSS/JS or any UI artifact, reply:**

OUT OF LANE: <task asks for templates/index.html etc.>
ROUTE TO: eng-fe
REASON: frontend file

Do NOT inline a placeholder, do NOT "stub it for now".
Stop and let PM dispatch eng-fe.
```

注意三个关键设计：

1. **ALLOWED + FORBIDDEN 都列**：不是"白名单优先"，而是双向冗余，让模型注意力被两遍强调
2. **OUT OF LANE 是固定模板**：让 PM 能机械识别（甚至代码 grep）
3. **明确禁止"省事行为"**：写明"Do NOT inline a placeholder"

### 3.3 完整的 lane 表

| Agent | ALLOWED 写 | FORBIDDEN 写 |
|---|---|---|
| **pm** | `SPEC.md`, `STATUS.json`, optional `PROGRESS.md` | 任何代码、其他人的 .md |
| **techlead** | `TASKS.md`, `ARCHITECTURE.md` | 任何代码、其他人的 .md |
| **eng-be** | `*.py`, `requirements.txt`, `Dockerfile` | `templates/`, `static/`, `*.html`, `*.css`, `*.js`, 所有文档 |
| **eng-fe** | `templates/*.html`, `static/{css,js,img}` | 任何 `.py`, `requirements.txt`, 所有文档 |
| **qa** | `TEST_PLAN.md`, `TEST_REPORT.md` | 任何代码、其他人的 .md |
| **devops** | (几乎不写) optional `DEPLOY.md` | 任何代码、所有文档 |
| **designer** | `DESIGN.md` | 任何代码、其他人的 .md |
| **writer** | `README.md`, optional `CHANGELOG.md` | 任何代码、其他人的 .md |

---

## 4. OUT OF LANE 协议

### 4.1 标准格式

任何 worker 收到不属于自己的任务，回复：

```
OUT OF LANE: <一行描述被要求做的事>
ROUTE TO: <正确的 agent id>
REASON: <一行原因>
```

例：

```
OUT OF LANE: asked to modify templates/index.html
ROUTE TO: eng-fe
REASON: HTML file ownership belongs to frontend engineer
```

### 4.2 PM 怎么处理

PM 的 persona 写：

```markdown
## ⚠️ Handle "OUT OF LANE" replies — re-route, never absorb

When a teammate replies with "OUT OF LANE: ...":

1. Read the ROUTE TO field.
2. Re-dispatch the SAME task to that agent via sessions_send.
3. Include the original task description PLUS the prior agent's
   OUT OF LANE reply as context.

Never treat OUT OF LANE as a signal to pick up the work yourself.
Never retry the same agent with "no really, just do it".
```

PM 见到 OUT OF LANE 就**机械地**派给 ROUTE TO 字段指定的 Agent。**不思考、不商量**。

---

## 5. 为什么不能让 LLM 自己判断"该不该做"

很合理的想法："给 PM 写一段 prompt，让它自己判断这个任务该派给谁"。

**实际跑下来不行**，原因：

1. **PM 也是 LLM**，自己也容易"乐于助人"——觉得 eng-be 已经累了，自己来 5 分钟搞定。
2. **判断不一致**：同一个任务今天派给 eng-be，明天派给 eng-fe，无可重现性。
3. **没有强制信号**：persona 写"应该派对人"是软约束；ALLOWED/FORBIDDEN 文件路径是硬约束。

**结构性约束 > 软性建议**。

---

## 6. 这个设计借鉴自哪里

### 6.1 Microservice 架构里的 "Bounded Context"

DDD（Domain-Driven Design）讲每个 service 有自己的 bounded context，不能跨界查别人的库。

Lane Discipline 把这个理念搬到 Agent：每个 Agent 是一个 microservice，有自己的"领域"（文件类型）。

### 6.2 操作系统里的"权限分离"

Linux user / group permission 限制谁能写哪些文件。

我们的 lane 是 LLM 层的 user permission。

### 6.3 团队管理里的"职责清单"

公司里前端不写后端，QA 不修 bug，理由都是同一套：**专业分工 + 责任明确 + 可追溯**。

---

## 7. 边界冲突怎么处理

### 7.1 灰色地带

例：`config.json` 既可以是后端配置（eng-be 改）也可以是前端 build config（eng-fe 改）。

解决：
- 用文件名前缀区分：`server.config.json` vs `client.config.json`
- 或在 persona 里显式说明（"`config/api.json` is eng-be; `config/ui.json` is eng-fe"）

### 7.2 跨 lane 的修改

例：要加一个新 API endpoint，同时改 `app.py`（后端）和 `templates/index.html`（前端）。

解决：拆成两个任务：
- T1: eng-be 加 `/api/foo` route
- T2: eng-fe 在前端 fetch `/api/foo`

PM 串行（或并发）派两个 worker。

### 7.3 急事

老板说"我现在要看到效果！"，PM 想"破例自己写一行"。

**不行**。Lane Discipline 是绝对的，没有"紧急通行权"。
正确做法：让 PM 派给最快可用的 Agent，加紧急标记。

---

## 8. Lane Discipline 的副作用与缓解

### 8.1 增加延迟

每次"误派"都要多一次往返：PM → wrong_agent → "OUT OF LANE" → PM → right_agent → done。

缓解：persona 里给 PM 一份明确的"任务类型 → 正确 agent" 映射表，减少误派。

### 8.2 增加 token 成本

OUT OF LANE 回合多花 ~500 tokens。

缓解：本地模型成本接近 0，可接受。云端模型可以缩短回复模板。

### 8.3 模型可能"忘记" lane

特别是 context 长了之后，模型可能突然"破戒"。

缓解：
- Persona 里 lane 信息放在最显眼位置
- 关键 worker（eng-be、eng-fe）的 lane 用 ⚠️ 强调
- 配合 Layer 5 watchdog：如果 PM 越界写 STATUS.json 之外的文件，dashboard 报警（这部分还没实现，是 future work）

---

## 9. 实战：给 ChatBot 系统加 Lane Discipline

设计场景：你有一个客服 ChatBot 系统，3 个 Agent：

- **router**：识别用户意图，分发请求
- **support_agent**：处理售后问题
- **sales_agent**：处理销售咨询

写出：

1. 每个 Agent 的 ALLOWED / FORBIDDEN 操作（不是文件路径，而是**API 调用**）
   - 比如 sales_agent 不能修改用户订单状态（那是 support 的事）
2. router 的 persona 节选（≤ 30 行）
3. OUT OF LANE 协议（文字模板）
4. router 怎么处理 OUT OF LANE

把这个练习做完，面试聊"多 Agent 边界"能聊很深。

---

## 10. 自测题

1. Helpfulness training 怎么导致 Agent 越界？
2. ALLOWED + FORBIDDEN 双列表的设计意图是什么？为什么不只列其中一种？
3. OUT OF LANE 协议为什么必须是固定格式？
4. PM 见到 OUT OF LANE 应该做什么？不应该做什么？
5. Lane Discipline 借鉴了哪些已有概念（至少给 2 个）？

下一站：[Module 08 — Sandboxing](08-sandboxing.md)
