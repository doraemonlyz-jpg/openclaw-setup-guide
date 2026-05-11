# Module 04 — 单 Agent 系统设计

> Multi-Agent 之前必须先把 Single Agent 设计好。这一章讲一个能稳定干活的 Agent 长什么样。
> 90% 的"多 Agent 设计不好"问题，根源是单 Agent 没设计好。

---

## 1. Agent 的解剖结构

一个 Agent 由 5 个组件组成：

```
┌──────────────────── Agent ────────────────────┐
│                                               │
│  ┌─────────────┐    ┌──────────────────────┐  │
│  │   Persona   │    │      Loop Driver     │  │
│  │ (system     │    │  while not done:     │  │
│  │  prompt)    │    │    msg = llm(state)  │  │
│  └─────────────┘    │    if msg.tool_call: │  │
│                     │      run_tool()      │  │
│  ┌─────────────┐    │      append_result() │  │
│  │   Tools     │    │    else: break       │  │
│  │ (schema +   │    └──────────────────────┘  │
│  │  impl)      │                              │
│  └─────────────┘    ┌──────────────────────┐  │
│                     │  State (messages,    │  │
│  ┌─────────────┐    │  scratchpad, memory) │  │
│  │   Model     │    └──────────────────────┘  │
│  │ Provider    │                              │
│  └─────────────┘    ┌──────────────────────┐  │
│                     │   Eval / Monitoring  │  │
│                     └──────────────────────┘  │
└───────────────────────────────────────────────┘
```

每一块都能单独优化。

---

## 2. Persona / System Prompt 的写作

### 2.1 一个糟糕的 persona

```
你是一个有用的 AI 助手。请帮我处理任务。
```

问题：
- 没有角色定义
- 没有约束
- 没有工作流
- 模型只能靠通用直觉

### 2.2 一个能用的 persona（结构）

```markdown
# Role: <角色名>

<一句话身份定义>

## ⚠️ CRITICAL — READ FIRST
<最容易被违反的硬约束，强调 1-2 条>

## Your STRICT workflow
<编号步骤，越具体越好>
1. ...
2. ...
3. ...

## Required output template
<给出输出格式的 EXACT 模板，模型会照抄>

## Hard rules
<一条一行，bullet>

## What you do NOT do
<反例清单>

## Output style
<语气、长度、格式偏好>
```

### 2.3 我们的 PM persona 拆解

打开 `~/.openclaw/company/agents-workspaces/pm/AGENTS.md`，你会看到：

```markdown
# Role: Product Manager (PM) — Company Entrypoint

You are the PM at a small AI software studio.
You are the only agent the boss talks to directly.

## Team you can call
| Agent id | sessionKey | Use them for |
|----------|------------|--------------|
| techlead | agent:techlead:main | Architecture |
...

## Tool call template (memorize this exact shape)
sessions_send({sessionKey: "agent:<id>:main", message: "...", timeoutSeconds: 600})

## 🚧 Stay in your lane — PM is a router, not a worker
ALLOWED write paths: SPEC.md, STATUS.json, PROGRESS.md
FORBIDDEN: anything else
...

## Your STRICT workflow (do not deviate)
1. Clarify (1 round max)
2. Spec
3. Architecture
4. Design (only if UI)
5. Build
6. Test (gated)
7. Smoke run (gated)
8. Docs
9. Stamp completion (gated by 6+7)
10. Report to boss

## ⚠️ NON-NEGOTIABLE FINAL STEP — write STATUS.json
...

## ⚠️ Trust-but-verify rule
...

## Hard rules
- You do NOT write code yourself.
- You DO write SPEC.md.
- Always include the project path.
- One project at a time.
- Brevity. Replies to the boss ≤ 4 sentences.
```

观察几个写作技巧：

1. **明确限制范围**："You are the only agent the boss talks to" → 强行排除模型乱认人
2. **给可记忆的"模板"**："memorize this exact shape" → 模型对"模板"特别敏感，记得很牢
3. **编号 + 短句**："1. Clarify ..." → 比段落易跟随
4. **重复关键约束**：trust-but-verify 出现两次（hard rules + 专门一节） → 重要的事说三遍

---

## 3. Workflow 设计：让 Agent 不"自由发挥"

### 3.1 反模式：开放式指令

```
请帮我开发一个 Pomodoro 应用。
```

会发生什么？
- 模型可能直接开始写代码（没规划）
- 也可能先问 5 个澄清问题
- 也可能写一段"我建议这样做..."然后停止

**没有可预测性**。

### 3.2 正模式：显式 phase

PM 的 STRICT workflow 写得像这样：

```
1. Clarify (1 round max). If ambiguous, ask ONE clear question. Otherwise skip to 2.
2. Spec. write SPEC.md.
3. Architecture. sessions_send to techlead.
4. Design (only if UI). sessions_send to designer.
...
```

为什么这样写？

- **"1 round max"** 把模型的"反复确认"癖好掐死
- **"otherwise skip to 2"** 给一条默认路径
- **每步都说明用什么工具** → 减少模型选错工具
- **条件分支显式**（"only if UI"） → 不会走多余路径

### 3.3 不要假设模型能"灵活应对"

GPT-4 / Claude Opus 级别的模型可以"见招拆招"。
本地 8B / 20B 模型**必须有一条清晰路径，每个分叉都告诉它怎么走**。

经验：persona 越像一份 SOP（标准操作流程），小模型表现越好。

---

## 4. State 管理：你的 Agent 记得什么

### 4.1 三种 State

```
┌────────── State ──────────┐
│                           │
│  1. Messages (对话历史)   │
│  2. Scratchpad (笔记)     │
│  3. Memory (跨会话记忆)   │
│                           │
└───────────────────────────┘
```

#### Messages

最基本的 state。每一轮新增 `assistant` 和 `tool` 消息。
缺点：长起来快，吃光 context window。

#### Scratchpad

Agent 主动写给自己的笔记。例如：
- "已完成 T1，T2 阻塞中"
- "用户偏好用 Python"
- "下一步要调 search 工具"

可以放在每轮的 user message 里，或者用专门的 `note` 工具持久化。

#### Memory（跨会话）

- **Short-term memory**：单次任务内的关键事实摘要
- **Long-term memory**：跨任务的偏好、过往经验
- 通常用向量数据库（Pinecone / Chroma / Qdrant）做语义检索

我们的项目里**没有显式 Memory 系统**——靠 PM 在 PROGRESS.md 里记笔记，靠每个 worker 的 AGENTS.md 是固定 system prompt。

### 4.2 Context 截断策略

当 messages 过长，必须裁剪：

| 策略 | 实现 | 适合场景 |
|---|---|---|
| **Sliding window** | 只保留最近 N 条 | 对话型 Agent |
| **Summarization** | 旧消息汇总成一段 | 任务型 Agent |
| **Vector retrieval** | 旧消息存向量库，按需检索 | 长程记忆 |
| **Tool 结果裁剪** | 长输出只保留 head/tail | 经常调 cat/grep 的 Agent |

每种策略都会丢信息——选择题，没标准答案。

---

## 5. 重试与错误处理

### 5.1 工具失败的 4 种类型

| 类型 | 例子 | 处理 |
|---|---|---|
| **Schema error** | LLM 漏字段、字段类型不对 | 立即返回错误给 LLM，让它重试 |
| **Permission denied** | 工具被 allowlist 拒绝 | 返回明确错误："This command is not allowed" |
| **External error** | 网络 5xx、API 限流 | 自动重试 1-2 次，用指数退避 |
| **Domain error** | `read` 一个不存在的文件 | 直接返回错误内容，让 LLM 决定下一步 |

**关键原则**：错误信息要让 LLM 能看懂、能据此调整行动。

```python
# 烂的错误返回
return "Error"

# 好的错误返回
return {
  "ok": False,
  "error": "FileNotFoundError",
  "detail": "/tmp/foo.txt does not exist",
  "hint": "Did you create the file with the write tool first?"
}
```

`hint` 字段能让 LLM **不犯第二次错**——这是经验值。

### 5.2 整轮重试 vs 工具重试

```python
def agent_run(messages, tools, max_iter=20):
    for i in range(max_iter):
        try:
            resp = llm(messages, tools)
        except RateLimitError:
            time.sleep(2 ** i)  # 指数退避
            continue
        except ContextLengthError:
            messages = compact(messages)  # 截断重组
            continue

        if not resp.tool_calls:
            return resp.content

        for tc in resp.tool_calls:
            try:
                result = run_tool(tc)
            except ToolNotAllowed as e:
                result = {"ok": False, "error": "Permission denied", "hint": str(e)}
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(result)})

    return "max iterations exceeded"
```

注意 `ToolNotAllowed` 是**返回给 LLM 的，不是 raise 的**——让模型有机会换条路。

---

## 6. 评估：你怎么知道 Agent 真的工作

### 6.1 不同层次的 eval

| 层次 | 方法 | 适合 |
|---|---|---|
| **Unit** | 每个工具的输入输出测试 | 工具实现正确性 |
| **Component** | 单步推理 eval（给定状态，下一步动作） | 模型选择 |
| **End-to-end** | 跑完整任务，最后看结果 | 整体可用性 |
| **Adversarial** | red-team 攻击：诱导越权、骗人、死循环 | 安全 |

### 6.2 任务完成率 ≠ 质量

最朴素的 eval：

```python
def eval_pipeline(task_set):
    results = []
    for task in task_set:
        try:
            output = agent_run(task["input"])
            success = task["check_fn"](output)
        except Exception as e:
            success = False
        results.append(success)
    return sum(results) / len(results)
```

但 success 只是布尔。还需要看：

- **Latency**：完成需要多少秒
- **Cost**：花了多少 token
- **Tool calls count**：调了几次工具
- **Iteration count**：循环了几次
- **Quality**：结果对不对（需要人判或更强的 LLM as judge）

### 6.3 LLM as Judge

让一个更强的 LLM（Claude Opus / GPT-4o）评 Agent 的输出。

```python
judge_prompt = """
You are a senior engineer reviewing an AI agent's output.
Task: {task_description}
Agent output: {agent_output}
Score on:
- Correctness (1-5)
- Completeness (1-5)
- Code quality (1-5)
Output JSON: {"correctness": N, "completeness": N, "quality": N, "feedback": "..."}
"""
```

陷阱：
- LLM judge 自己有偏好（喜欢长输出、喜欢自信语气）
- 评估和被评估用同一模型，容易"自我吹捧"
- 一定要人工抽样校准

### 6.4 我们项目的 eval

**结构化 gate**：
- QA 必须报 `<EXIT=N>`，0 才算 PASS
- DevOps 必须报 `<HTTP=2xx>` + `<html`，否则 FAIL
- Smoke-test 端点真的起项目、真的 curl 它

**这些都是 eval，只是嵌在工作流里**——不是单独跑一个测试集。这种设计叫"持续 eval"，比离线 eval 更接近生产。

---

## 7. 一个完整的单 Agent 实现（伪代码）

```python
class SingleAgent:
    def __init__(self, model, persona, tools, max_iter=20):
        self.model = model
        self.system = persona
        self.tools = tools
        self.max_iter = max_iter

    def run(self, user_message):
        messages = [
            {"role": "system", "content": self.system},
            {"role": "user", "content": user_message},
        ]
        for i in range(self.max_iter):
            resp = self.model.chat(
                messages=messages,
                tools=[t.schema for t in self.tools],
                temperature=0.1,
            )
            messages.append(resp.message)

            if not resp.tool_calls:
                return resp.message.content

            for tc in resp.tool_calls:
                tool = self._find_tool(tc.function.name)
                if tool is None:
                    result = {"error": f"Unknown tool: {tc.function.name}"}
                else:
                    try:
                        args = json.loads(tc.function.arguments)
                        result = tool.run(**args)
                    except json.JSONDecodeError:
                        result = {"error": "Invalid JSON in tool arguments"}
                    except ToolNotAllowed as e:
                        result = {"error": "Permission denied", "detail": str(e)}
                    except Exception as e:
                        result = {"error": "Tool execution failed", "detail": str(e)}

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": json.dumps(result),
                })

        return f"Agent stopped: max iterations ({self.max_iter}) exceeded"
```

**这就是一个完整的 Agent 框架核心**。所有"复杂的 Agent 框架"——LangGraph / CrewAI / AutoGen——拆到底都是在这个循环上加东西（更复杂的 state、多 Agent 通信、checkpointing）。

---

## 8. Agent 的失败模式速查

| 失败 | 症状 | 通常原因 | 修法 |
|---|---|---|---|
| 死循环 | 反复调同一个工具 | 工具结果模型看不懂；persona 没说"调一次就够" | 加 max_iter；改 prompt；裁剪重复结果 |
| 不调工具 | LLM 直接答文字 | persona 不强；模型选了"省力" | 写 ⚠️ CRITICAL；trust-but-verify |
| 调错工具 | 工具描述不清 | schema 写得糙 | 改 description，加 enum |
| Context 爆 | messages 越来越长 | 没截断策略 | sliding window + summarize |
| 越权 | 写了不该写的文件 | 没有 lane discipline | Module 07 |
| 撒谎 | 假装做了 | 小模型 hallucinate | 多重验证（Module 06） |

---

## 9. 实战练习

设计一个 **GitIssueAgent**：用户给一个 GitHub issue 链接，Agent 自动：
1. 获取 issue 内容
2. 看相关代码
3. 提出修复方案
4. （可选）写一个 PR

写出：
- Persona（不少于 50 行）
- 4-6 个工具的 schema
- 失败时的重试策略
- 怎么评估它（一个 eval set 设计）

把这个写完，下次面试聊"你怎么设计 Agent"，你能聊半小时。

---

## 自测题

1. Agent 的 5 个组件是什么？
2. 写 persona 时，为什么"⚠️ CRITICAL"块这么有效？
3. State 有几种？各自适合什么场景？
4. 工具失败有 4 种类型，分别怎么处理？
5. 怎么 eval 一个 Agent？

下一站：[Module 05 — 多 Agent 编排模式](05-multi-agent.md)
