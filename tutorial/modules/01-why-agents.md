# Module 01 — 为什么 2026 年大家都在做 Agent

## 时间线：从 ChatGPT 到 Agent 元年

| 时间 | 事件 | 行业认知变化 |
|---|---|---|
| 2022.11 | ChatGPT 发布 | "LLM 能聊天，能写代码片段" |
| 2023.03 | GPT-4 + Function Calling API | "LLM 可以调函数了" |
| 2023.04 | AutoGPT 病毒式传播 | "让 LLM 自己规划任务，自己执行" |
| 2023.10 | OpenAI 推出 Assistants API + Threads | 工具用持久化对话状态托管起来 |
| 2024 全年 | LangGraph / CrewAI / AutoGen 爆发 | "多 Agent 协作"成为新热点 |
| 2025.05 | MCP（Model Context Protocol）被 Anthropic 推广 | 工具接入有了标准协议 |
| 2025.10 | Claude Computer Use / GPT operator | Agent 开始操作真实电脑 |
| 2026 | "Agent Engineer" / "Applied AI Engineer" 成为独立职位 | 大厂招聘明确这个方向 |

简单说：**2024 是 Agent 概念年，2025 是 Agent 工具链年，2026 是 Agent 真正落地生产的年**。这就是为什么你现在去面试，所有人都在问 Agent。

## 什么是 Agent？三种常见定义（都对，都不全）

### 定义 1（学术派）

> An agent is anything that perceives its environment through sensors and acts upon that environment through actuators. — Russell & Norvig, AIMA

太宽泛，恒温器都能算 Agent。面试不要这样答。

### 定义 2（工程派）

> An LLM-based system that can reason about a goal, decompose it into steps, call external tools to execute those steps, observe the results, and iterate until the goal is achieved.

实用，能讲清楚。

### 定义 3（最简）

> Agent = LLM + Tools + Loop.

这是面试最爱听的回答。三个词，但每个词都能展开。

## Agent 和 Chatbot 的本质区别

把这张表背下来：

| 维度 | Chatbot | Agent |
|---|---|---|
| 输入 | 自然语言 | 自然语言 + 工具结果 |
| 输出 | 自然语言 | 自然语言 + 工具调用 |
| 状态 | 通常单轮，或简单对话历史 | 显式状态机 / Memory / Scratchpad |
| 副作用 | 无（只生成文本） | 有（写文件、调 API、执行代码） |
| 评估指标 | 人类满意度 / BLEU / 助手感 | 任务完成率 / 正确性 / 成本 / 延迟 |
| 失败模式 | "答非所问" | 死循环、幻觉调用、越权操作、状态污染 |

注意最后一行——Agent 的失败模式比 Chatbot 复杂得多，因此**测试和监控的难度是数量级的**。本教程后半段大量讨论这个。

## 为什么大公司在 2026 年都在投 Agent

### 商业价值

- **客服、运营、内部工具自动化**：原来需要 5 个人盯的工作，1 个 Agent + 1 个监督员能干。
- **代码 / 数据流水线**：Cursor / Copilot Workspace / Devin 这一类，已经证明了 Agent 能完成从 issue 到 PR 的端到端任务。
- **新交互形态**：浏览器 / 桌面 / 手机 Agent（Claude Computer Use、Anthropic 的浏览器助手），正在重新定义"软件"。

### 技术合理性

- **模型能力达标**：GPT-4 级别以上的模型，函数调用准确率到了 90%+，生产可用。
- **工具生态成熟**：MCP 让任何系统都能 5 分钟接成 Agent 工具。
- **本地模型可用**：8B-32B 的开源模型（Qwen / Llama / DeepSeek）能干 80% 的简单 Agent 任务，成本几乎为零。

### 招聘端的反映

2026 年大厂常见 Agent 相关岗位：

- **Agent Engineer / Applied AI Engineer**：写 prompt、设计工具集、调优 Agent 行为
- **AI Infra Engineer**：搭 LLM 推理平台、tool gateway、向量库、可观测性
- **AI Safety / Eval Engineer**：设计 Agent 测评集、red-team、防越权
- **Agent Product Manager**：定义 Agent 的"工作流"和"可接受错误率"

每个方向问的问题都不一样，但**底层概念都是这份教程涵盖的**。

## 面试时常被问的"开场白"

> "你怎么理解 Agent？跟 ChatGPT 有什么区别？"

不要只说概念。**直接给一个具体的例子**：

> "我自己实现过一个 8 Agent 的软件公司。老板提一个需求，PM 写 SPEC，TechLead 拆任务，前后端工程师写代码，QA 跑测试，DevOps 做冒烟测试，writer 写 README。每个 Agent 都用本地的 Ollama 模型跑。这个系统跟 ChatGPT 的区别是：ChatGPT 给我一段建议，但我的系统会真的把代码写到磁盘上、跑起来、测出 HTTP 200，最后给我一个能运行的项目。中间还有一套验证机制防止 Agent 撒谎说'我做完了'但其实没做。"

这样开场，对方接下来 30 分钟会顺着你讲，**不会出超纲题**。

## 行业对 Agent 工程师的能力期望

按重要性排：

1. **Prompt Engineering**：能写出让小模型也稳定跟随的 system prompt（不是写"扮演 XXX"，而是写工作流、约束、评估标准）
2. **Tool Design**：能设计干净的 JSON schema，能讨论"什么粒度的工具最合适"
3. **Failure Mode Awareness**：能讲清楚至少 5 种 Agent 常见失败，以及对应的防御策略
4. **Eval / Observability**：能搭一个 Agent 的测评流水线，能讲 latency / cost / success rate 怎么监控
5. **Multi-Agent Orchestration**（高级岗）：能画清楚 3 种以上的多 Agent 通信模式
6. **Safety / Sandboxing**（高级岗）：能讲威胁模型，能讲怎么限制 Agent 的副作用

不要试图样样精通——挑你做的那个项目最深的两三项重点讲。

## 自测题

1. 用 30 秒讲清楚 Agent 和 Chatbot 的区别。
2. 列举 3 种 Agent 比 Chatbot 更难调试的原因。
3. 你现在面的岗位（Agent Engineer / AI Infra / Safety）对应本教程的哪几个模块？

下一站：[Module 02 — LLM 基础](02-llm-fundamentals.md)
