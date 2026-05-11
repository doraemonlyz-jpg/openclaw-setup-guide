# Module 02 — LLM 基础：Token / Context / Sampling / 量化

> 这一章不讲怎么训模型（那是另一个领域），只讲**做 Agent 必须懂的 LLM 推理侧知识**。
> 把这些概念背下来，面试官问任何"为什么 Agent 这里慢/不准/费钱"的问题，你都能从底层解释。

---

## 1. Token：LLM 的最小单位

### 1.1 不是字符，也不是单词

LLM 不"看"文字，它看 **token**。Token 是一种叫 **BPE（Byte Pair Encoding）** 的算法切出来的子词。

举几个例子（用 GPT-4 的 cl100k_base tokenizer）：

```
"hello world"           → ["hello", " world"]                      → 2 tokens
"unbelievable"          → ["unbel", "ievable"]                     → 2 tokens
"我爱中国"              → ["我", "爱", "中国"]                     → 3 tokens
"中華人民共和國"        → ["中", "華", "人民", "共", "和", "國"]   → 6 tokens
"```python\nprint(1)```" → ["```", "python", "\n", "print", "(", "1", ")", "```"] → 8 tokens
```

注意几个关键点：

- 英文 1 个 token ≈ 4 个字符 ≈ 0.75 个单词
- **中文 1 个字 ≈ 1-2 个 token**（GPT 系列对中文较费 token，Qwen 系列对中文友好）
- 标点、空格、换行都算独立 token
- 罕见词被切成多个 token

### 1.2 为什么这件事重要

**因为你按 token 计费，按 token 算延迟，按 token 算 context 用量**。

- 你给 Agent 一个 30K 字的中文文档，可能就是 40K-50K tokens，已经塞满 GPT-4o 的 context
- 你的 system prompt 写得太长（5K tokens），每次请求都要重复发，钱就这么花掉了
- 输出限制 4K tokens 的模型，不可能让它一次写一份 200 行的代码

### 1.3 工具

- OpenAI 提供 [`tiktoken`](https://github.com/openai/tiktoken)，本地能算 token 数
- 在线工具：<https://platform.openai.com/tokenizer>
- 面试时被问到「这段 prompt 多少 token」，能脱口而出一个量级估算就够了（中文 ≈ 1.5x 字符数，英文 ≈ 1/4 字符数）

---

## 2. Context Window：LLM 的"短期记忆"

### 2.1 定义

LLM 一次推理能看到的**最大 token 数**（input + output 加起来）。

- GPT-4o: 128K
- Claude 4 Opus: 200K
- Gemini 2.0: 1M-2M
- Qwen 2.5: 32K-128K（视模型大小）
- Llama 3: 8K-128K
- 我们用的 `gpt-oss:20b`: ~32K
- 我们用的 `qwen2.5-coder:7b`: ~32K

### 2.2 不是 context 越大越好

三个反直觉的事实：

#### Fact 1: Lost in the Middle 现象

[Liu et al. 2023](https://arxiv.org/abs/2307.03172) 实验证明：当上下文很长时，**LLM 对中间位置的内容关注度最低**。开头和结尾召回率都高，中间会"丢失"。

**Agent 实操影响**：

- 关键指令放 system prompt（最前面）
- 当前任务放最近一条 user message（最后面）
- 中间堆历史对话时要小心

#### Fact 2: Context 越大，推理越慢、越贵

注意力机制是 O(n²)。Context 翻倍，推理时间和显存使用翻 4 倍。

GPT-4o 处理 100K input：~5-10 秒首 token 延迟
处理 5K input：~0.5 秒

#### Fact 3: 模型在长 context 下"质量"会下降

不是 hallucination 增加那么简单——而是**指令跟随能力下降**。一个 32K context 的模型塞了 25K 内容，它对 system prompt 里"必须用 write 工具"这种指令的执行率会从 95% 掉到 60%。

**面试金句**：

> "Context window 是上限，不是工作区。我设计 Agent 的时候默认按 context 的 50% 设计，留一半给中间过程的工具结果和重试。"

---

## 3. Sampling：怎么从概率分布里挑下一个 token

LLM 的输出在每一步是一个**概率分布**（vocab size 通常 ~50K-150K）。**Sampling 决定了从这个分布里怎么挑一个**。

### 3.1 关键参数

| 参数 | 作用 | 实操建议 |
|---|---|---|
| `temperature` (0-2) | 拉平 / 锐化分布。0 = 总挑最高概率，1 = 原始分布，>1 = 更随机 | Agent 默认 0-0.3，写代码用 0，创意写作用 0.7-1 |
| `top_k` | 只在概率最高的 K 个 token 里采样 | 通常 40，一般不调 |
| `top_p` (nucleus) | 累积概率到 P 的最小 token 集合里采样 | 0.9 是经典默认 |
| `frequency_penalty` | 已出现过的 token 被惩罚 | 防止重复，0.5 比较常用 |
| `presence_penalty` | 出现过就惩罚（不管多少次） | 鼓励多样性 |

### 3.2 Agent 场景下的金句

> "做 Agent 我都把 temperature 调到 0 或 0.1。Agent 的任务是确定性执行，不是创作。Temperature 0 还能让我做差异化测试——同一个 prompt 跑两次结果应该一样，不一样说明 prompt 不稳定。"

注意这不绝对——某些场景（如让 Agent 探索多种解法）需要 temperature > 0。但生产 Agent 的"可重现性"是核心需求，低 temperature 是默认起点。

### 3.3 一个常被忽略的细节：deterministic 不等于 reproducible

即使 `temperature=0`，**同一 prompt 在不同次调用、不同 batch size、不同硬件上可能给出不同结果**。原因：

- GPU 浮点累加顺序不同
- 模型内部 KV cache 的不同填充
- API 提供方做了 batched inference 优化

OpenAI 提供 `seed` 参数可以一定程度复现，但不保证。**要做 eval 必须考虑这个**。

---

## 4. Quantization：让大模型在你笔记本上跑起来

### 4.1 为什么需要量化

`gpt-oss:20b` 原始 FP16 权重：20B × 2 bytes = **40GB 显存**。普通笔记本根本装不下。

量化把权重从 FP16 (16-bit) 压成更低位（4-bit 是最常见）：

20B × 0.5 bytes = **10GB**。一个 36GB 内存的 Mac 能跑，还能开浏览器。

### 4.2 常见量化等级（Ollama / GGUF 命名）

| 名字 | 位数 | 大小相对 FP16 | 质量损失 |
|---|---|---|---|
| `Q8_0` | 8-bit | 50% | 几乎无损 |
| `Q6_K` | 6-bit | 38% | 极小 |
| `Q5_K_M` | 5-bit | 33% | 小 |
| `Q4_K_M` | 4-bit | 25% | 可接受（生产常用） |
| `Q3_K_M` | 3-bit | 19% | 明显下降 |
| `Q2_K` | 2-bit | 13% | 不推荐 |

`K_M` / `K_S` 是不同的细分量化策略，不深究——**记住 `Q4_K_M` 是日常默认**。

### 4.3 量化损失体现在哪

不是简单的"准确率降低"。具体表现：

- 数学/代码任务掉点最明显（Q4 vs FP16 可能差 5-10 个百分点）
- 长上下文召回变差
- **工具调用的 JSON 结构准确率会下降**（Q4 容易出现 JSON 漏逗号、字段名拼错）

**Agent 实操**：用 Q4 跑流程编排（PM、TechLead），用 Q5/Q6 跑代码生成（eng-be、eng-fe）。性价比最高。

我们的项目里 `qwen2.5-coder:7b` 默认是 Q4，写代码够用；`gpt-oss:20b` 也是 Q4，跑编排够用。

---

## 5. 本地模型 vs 云端模型：什么时候选哪个

| 维度 | 云端（GPT-4o / Claude） | 本地（Ollama） |
|---|---|---|
| 单次质量 | 高，工具调用准确率 95%+ | 低（本地 8B 工具调用 70-85%） |
| 单次成本 | $0.001-$0.05 | 电费（接近 0） |
| 延迟 | 0.5-3 秒（首 token） | 1-10 秒（取决于硬件） |
| 隐私 | 走第三方 | 完全本地 |
| 离线 | 不行 | 行 |
| 长 context | 行（128K-200K） | 较弱（32K 是常见上限） |
| 函数调用稳定性 | 高 | 看模型，差异巨大 |
| 可控性 | 你不能改模型 | 完全可控 |

### 选型决策树

```
任务对单次质量要求很高？（金融、医疗、法律）
├── 是 → 云端，别犹豫
└── 否 → 数据敏感？
         ├── 是 → 本地（Ollama）
         └── 否 → 量大？
                  ├── 大（>100k 请求/天） → 本地（成本碾压）
                  └── 小 → 云端（快、稳）
```

**面试金句**：

> "我的设计原则是：编排用本地（成本敏感 + 隐私 + 可控），有强质量要求的代码生成考虑接云端 API。但对于个人项目和原型，全本地跑能让你以接近 0 成本快速迭代——所以这次教程里我全用 Ollama。"

---

## 6. 模型选型：8B / 13B / 20B / 70B 怎么挑

### 6.1 一般规律

| 大小 | 典型用途 | 工具调用能力 |
|---|---|---|
| <3B | 嵌入式、边缘 | 不能用做 Agent |
| 7B-8B | 单一任务 Agent、代码补全 | 中等，能用但要小心 |
| 13B-20B | 流程编排、多步推理 | 较稳定 |
| 30B-70B | 复杂规划、多 Agent 编排 | 高（接近 GPT-3.5 工具调用水平） |
| 100B+ | 对标 GPT-4 / Claude 级别 | 高 |

### 6.2 我们项目的选型解释

```
PM        → gpt-oss:20b      （编排，需要稳定 reasoning）
TechLead  → gpt-oss:20b      （拆任务，需要结构化输出）
Designer  → gpt-oss:20b      （生成 markdown 设计文档）
Writer    → gpt-oss:20b      （生成 README）
QA        → gpt-oss:20b      （写测试计划，要求结构化）
DevOps    → gpt-oss:20b      （决策 + 调工具，要求 reasoning）
eng-be    → qwen2.5-coder:7b （写 Python，专门的 coding 模型）
eng-fe    → qwen2.5-coder:7b （写 HTML/CSS/JS，coding 模型够用）
```

为什么不全用 20B？**RAM 不够**。一台 36GB Mac 只能同时 hot 1-2 个中等模型，多了就要 swap，每次切换 5-15 秒。8 个 Agent 全用 20B 会让流水线慢得无法接受。

### 6.3 一个反例

之前的版本里我们试过用 `deepseek-r1:14b` 当 TechLead——一个**Reasoning 模型**。结果它经常返回一段"分析"文字而不调用 `write` 工具。换成 `qwen3:8b` 后立刻好转。

**经验**：Reasoning 模型（R1 系列、o1 系列）适合"想清楚一件事"，不适合"按步骤干活"。Agent 编排要选**Tool-Use 优化过的模型**（gpt-oss、qwen-coder、Llama-3.1-Instruct 这一类）。

---

## 7. Inference Engine：Ollama 是什么

Ollama 是一个本地推理引擎，做了三件事：

1. **下载并管理模型**（`ollama pull qwen2.5:7b`）
2. **跑 OpenAI 兼容 API**（`http://localhost:11434/v1/chat/completions`）
3. **管理显存**（自动 load/unload，防止 OOM）

底层用的是 [`llama.cpp`](https://github.com/ggerganov/llama.cpp)，这是 GGUF 格式的事实标准 inference 引擎。

### 同类产品

- **[vLLM](https://github.com/vllm-project/vllm)**：服务端高吞吐，PagedAttention，企业级首选
- **[TGI](https://github.com/huggingface/text-generation-inference)**：HuggingFace 出品
- **[llama.cpp](https://github.com/ggerganov/llama.cpp)**：纯 C++，最快，但用起来 raw
- **Ollama**：llama.cpp 的友好包装，本地开发首选
- **[LM Studio](https://lmstudio.ai/)**：带 GUI 的 Ollama，给非工程师用

### 面试可能问到

> "你为什么用 Ollama 而不是 vLLM？"

答：

> "本地开发用 Ollama 的体验最好——一行命令拉模型，自动 OpenAI API 兼容。生产环境如果要服务化，会换成 vLLM 或 TGI 来吃多请求并发的吞吐红利。Ollama 内部模型 swap 比较慢，不适合多模型并发。"

---

## 8. KV Cache：理解 Agent 延迟的关键

LLM 推理分两步：
1. **Prefill**：把 prompt 一次性算完，生成所有 layer 的 key/value 缓存
2. **Decode**：一个一个 token 生成，每个 token 复用 KV cache

**KV cache 是 Agent 性能的隐藏关键**。两个推论：

### 8.1 同一个 system prompt 反复用，可以省钱省时间

OpenAI / Anthropic 的 [prompt caching](https://platform.openai.com/docs/guides/prompt-caching) 利用的就是这个——固定前缀的 KV cache 可以跨请求复用，省 50-90% 成本。

**Agent 实操**：把 persona 放最前面，永远不变。每次请求重复这段，但 cache 命中后几乎免费。

### 8.2 长对话/多轮 Agent 的延迟主要来自 KV cache 的内存占用

每多 1K tokens 上下文，KV cache 多占几十 MB。所以 Ollama 跑 32K context 比 8K context 慢得多——不是算力问题，是内存带宽和管理开销。

---

## 9. 一个完整的 LLM 调用是怎么发生的

走一遍完整流程，让你脑子里有个画面：

```
你：openclaw agent --agent pm --message "帮我写一个 Pomodoro 应用"
                  │
                  ▼
OpenClaw CLI 加载 PM 的 AGENTS.md (system prompt)
                  │
                  ▼
组装请求体：
{
  "model": "ollama/gpt-oss:20b",
  "messages": [
    {"role": "system", "content": "<PM persona, 3000 tokens>"},
    {"role": "user", "content": "帮我写一个 Pomodoro 应用"}
  ],
  "tools": [
    {"name": "sessions_send", "parameters": {...}},
    {"name": "write", ...},
    {"name": "read", ...},
    {"name": "bash", ...}
  ],
  "temperature": 0.1
}
                  │
                  ▼
HTTP POST → http://localhost:11434/v1/chat/completions
                  │
                  ▼
Ollama 检查 gpt-oss:20b 是否已 load
  ├── 已 load → 直接 prefill
  └── 未 load → 先从磁盘加载到 RAM/VRAM (5-15s)
                  │
                  ▼
Prefill 阶段：把 system + user 一次性算完，生成 KV cache
                  │
                  ▼
Decode 阶段：一个 token 一个 token 输出
  Token 1: "I"
  Token 2: "'ll"
  Token 3: " start"
  ...
  Token N: <tool_call>{"name": "write", "arguments": {...}}</tool_call>
                  │
                  ▼
OpenClaw 解析输出，发现 tool call
  ├── 用户允许（allowlist 里）→ 执行
  └── 用户没允许 → 拒绝，返回错误
                  │
                  ▼
工具结果作为 "tool" 消息追加到 messages
                  │
                  ▼
回到第二步，继续 LLM 调用，循环直到模型不再 call tool
```

**这个图你要能在白板上画出来**。面试问 Agent 工作流，画这张就够了。

---

## 10. 常见误解纠正

### 误解 1：「LLM 有记忆」

❌ LLM 是无状态的。每次推理都是独立的。
✅ "记忆"来自把历史对话作为 prompt 的一部分塞回去。所谓 Memory 系统就是某种"挑选哪些历史塞回去"的策略。

### 误解 2：「同样的 prompt 永远给同样的结果」

❌ 即使 temperature=0，因为浮点不确定性，结果可能不一致。
✅ 想要可重现，要么用支持 seed 的 API，要么接受小概率的不一致。

### 误解 3：「换更大的模型一定更好」

❌ 大模型更慢、更贵，工具调用稳定性也未必更好（取决于训练）。
✅ 选模型按"任务×大小×推理引擎"三维评估，用 eval 集打分。

### 误解 4：「LLM 知道现在几点」

❌ LLM 不知道。它只知道训练数据截止日期。
✅ 当前时间应该作为 prompt 的一部分注入（"Current time: 2026-05-10..."）。

### 误解 5：「Function Calling 让 LLM 真的执行了函数」

❌ Function Calling 只是让 LLM 输出"我想调用这个函数"的结构化信号。**真正执行还是你的代码做的**。
✅ Agent 框架的核心责任就是接住这个信号，去执行，再把结果塞回 messages。

---

## 自测题

1. 写一个 1024 个英文字符的 prompt，大约多少 token？换成中文呢？
2. 为什么 Agent 通常用 temperature=0？什么场景例外？
3. Q4_K_M 量化损失最容易体现在哪类任务？
4. KV cache 的复用为什么能让 Agent 显著降本？
5. 你怎么解释「同一 prompt 两次跑结果不一致」？

---

## 拓展阅读

- [Karpathy: Let's Build the GPT Tokenizer](https://www.youtube.com/watch?v=zduSFxRajkE) — 把 BPE 讲透
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) — 必读
- [vLLM: PagedAttention](https://blog.vllm.ai/2023/06/20/vllm.html) — 理解推理引擎
- [Ollama 官方文档](https://github.com/ollama/ollama/blob/main/docs/README.md)

下一站：[Module 03 — Tool Use 与 Function Calling](03-tool-use.md)
