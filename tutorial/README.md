# LLM Agent 工程：从单 Agent 到生产级多 Agent 系统

> 一份「面试向、能讲细节、能上代码」的完整教程
> 用一个真实跑通的多 Agent AI 软件公司（[OpenClaw 公司](../docs/company.md)）作为贯穿案例

---

## 这份教程是给谁看的

- **正在面 LLM / Agent / AI Infra 岗位的工程师**：要能从 token、tool calling 一路讲到多 Agent 编排、沙箱、可观测性
- **想跳到 AI 方向但没做过 Agent 的后端 / 前端**：从零理解概念，用一套真代码而不是 PPT
- **已经做过简单 Agent，想升级到「多 Agent 自愈系统」的人**：直接看 Module 5 之后

学完后你应该能：

1. 在白板上画清楚 LLM → Tool Use → Single Agent → Multi-Agent 的演进路径，并解释每一步为什么必要
2. 答得出「你的 Agent 怎么防止幻觉？」「多 Agent 之间怎么通信？」「怎么沙箱？」这些八股
3. 拿出 GitHub 仓库现场演示一个能自愈的 8-Agent 软件公司

---

## 模块路线图

| # | 模块 | 大致字数 | 核心收获 |
|---|---|---|---|
| 00 | [总览 & 学习路径](modules/00-overview.md) | 短 | 建立心智地图 |
| 01 | [为什么 2026 年大家都在做 Agent](modules/01-why-agents.md) | 中 | 行业背景、岗位画像、面试关注点 |
| 02 | [LLM 基础：Token / Context / Sampling / 量化](modules/02-llm-fundamentals.md) | 长 | 一切 Agent 工作的地基 |
| 03 | [Tool Use 与 Function Calling](modules/03-tool-use.md) | 长 | 把 LLM 从「聊天机器人」变成「能干活的 Agent」 |
| 04 | [单 Agent 系统设计](modules/04-single-agent.md) | 长 | Persona、循环、retry、eval |
| 05 | [多 Agent 编排模式](modules/05-multi-agent.md) | 长 | Hub-and-spoke / Pipeline / Swarm |
| 06 | [Trust & Verify：防止 Agent 撒谎](modules/06-trust-verify.md) | 长 | 结构化验证、watchdog |
| 07 | [Lane Discipline：让每个 Agent 守住自己的边界](modules/07-lane-discipline.md) | 中 | 角色边界、OUT OF LANE 协议 |
| 08 | [Sandboxing：当 Agent 真能执行代码](modules/08-sandboxing.md) | 中 | 威胁模型、allowlist、Docker 隔离 |
| 09 | [Self-Healing：FIX MODE 自愈系统](modules/09-self-healing.md) | 长 | 诊断 → 派单 → 验证 → 重试 |
| 10 | [Observability：让老板看得见](modules/10-observability.md) | 中 | STATUS.json、Live Activity、通知 |
| 11 | [50 道高频面试题（带答案）](modules/11-interview-qa.md) | 超长 | 面试前一晚刷它就行 |
| 12 | [系统设计 4 题：从白板到落地](modules/12-system-design.md) | 长 | 真题 + 完整解题思路 |

---

## 怎么用这份教程

### 路径 A：面试前 3 天突击

读 **Module 01 → 02 → 03 → 05 → 06 → 11**。
其他模块当字典，被问到时去查。

### 路径 B：从零系统学习（推荐）

按 00 → 12 顺序读。每个模块结尾有「自测题」和「动手任务」，做完再往下走。
预计耗时：每天 1.5h，2 周走完。

### 路径 C：作为参考资料

把这个仓库 fork 下来，跟着 [`setup-company.sh`](../setup-company.sh) 在自己的笔记本上跑起来一套，一边读教程一边对照真代码。

---

## 配套资源

- **配套代码仓库**：[openclaw-setup-guide](https://github.com/doraemonlyz-jpg/openclaw-setup-guide) — 教程里所有代码示例都来自这个仓库的真实文件
- **网页版教程**（推荐，体验更好）：在本仓库 `tutorial/site/` 目录下。一行启动：

  ```bash
  cd openclaw-setup-guide/tutorial/site
  python3 -m http.server 8765
  # 浏览器打开 http://127.0.0.1:8765
  ```

  网页版功能：左侧模块导航 / 右侧页面大纲 / 全文搜索 / 上一节-下一节 / 移动端适配 / 代码语法高亮。

- **真实运行截图 / 演示视频**：见 `docs/company.md` 与 Boss Dashboard

---

## 写在前面的几句大实话

1. **多 Agent 系统不是银弹**。绝大多数任务用一个大 context 的单 Agent 更省钱、更快、更可控。本教程会讲清楚「什么时候该上多 Agent，什么时候不该」。
2. **本地 8B-14B 模型不是 GPT-4**。本教程的所有「防撒谎」「防越界」机制都是为了应对小模型的能力上限设计的，不是因为概念上必要。如果你用 GPT-5 / Claude Opus，很多 hack 可以省掉。
3. **代码示例都是 production 跑过的**，不是「概念演示」。包括失败的版本——失败的 commit 在 git log 里都能找到，记得点开看，那是最值钱的。

开始吧。打开 [Module 00](modules/00-overview.md)。
