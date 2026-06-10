# Repo Deep Research Agent 调研与设计

面向 16-24 小时 demo：输入 GitHub 仓库 → Deep Research Agent 深度理解 → 结合考面题库（kaomian）/ JD → 流式生成面试题。

约束：单一 OpenAI-compatible 模型（Tokendance deepseek-v4-pro，按 ~128k context 假设，需实测确认）、TypeScript/Next.js、无预算上 embedding 基础设施、评分标准强调"最小可用闭环 + 比直接用 ChatGPT 强"。

---

## 一、调研结论

### 1. 架构范式：社区分成两派，对"有界仓库"场景答案明确

| 方案 | 范式 | 关键数据/教训 | 对本项目借鉴度 |
|---|---|---|---|
| Anthropic multi-agent research | orchestrator + 3-5 并行 subagent | 比单 agent 高 90.2%，但 token 消耗 ~15x；token 用量解释 80% 质量方差 | 中：抄任务分派四要素（目标/输出格式/工具指引/边界）和 digest 回传 |
| Cognition "Don't Build Multi-Agents" | 单线程 + context 压缩 | 多 agent 失败根因：子 agent 基于冲突假设各自决策（miscommunication cascade） | 高：一致性哲学直接适用 |
| LangChain open_deep_research | Scope → Research → Write 三阶段 | 亲述教训：并行写报告章节导致割裂，改为"并行收集 + 单次合成写作" | 高：阶段划分直接抄 |
| GPT Researcher | planner → 并行 executor → publisher | 并行只用于抓取 | 中 |
| Jina node-DeepResearch | 单 agent Search-Read-Reason 循环，TS 原生无框架 | FIFO gap 问题队列、token 耗尽时 beast mode 强制出答案、Zod 约束 action | 高（唯一可直接读码移植的 TS 实现） |
| 字节 deer-flow | Planner → 人审计划 → 执行 → Reporter | "计划先展示再执行"对 demo 体验是亮点 | 中 |

学术佐证：MAST taxonomy（arXiv 2503.13657）统计多 agent 系统失败率 41%-86.7%，主因 inter-agent misalignment（32.3%）和系统设计问题（44.2%）。

**结论：不做自由 swarm。** 仓库是有界输入（不是开放 web），多 agent 的"广度并行"收益锐减而失败成本不变；面试题集必须自洽，恰好是多 agent 最容易翻车的点。正确形态：**单编排线程为骨架，只在"按维度的只读分析"一步做受控并行，最后单次合成。**

### 2. 仓库理解：agentic search 压倒 embedding RAG

- Anthropic 内部给 Claude Code 建过完整 RAG pipeline，对比后**整体替换为 agentic search**（grep/glob/read 循环 + 渐进披露）；Sourcegraph Cody 企业版已退役 embeddings，转回 keyword + code graph。
- Amazon Science 测得 agentic keyword search 达到 RAG faithfulness 的 94.5% 且零向量库。
- paper-code 仓库结构清晰、命名规范，正是符号/关键词搜索的优势区。
- **deepwiki-open（DeepWiki 开源复刻）的"两阶段生成"**最值得抄：先喂文件树 + README 让 LLM 出结构骨架（XML/JSON），再逐节填充。其文件过滤规则与本项目 `github.ts` 现有逻辑高度一致。
- **Aider repo map**：tree-sitter 抽符号 + PageRank 选最重要文件。24h 内可降级为"import 引用计数 + 锚点文件启发式"拿到大部分效果。
- 文件重要性信号（社区验证）：README/configs/入口文件 > 符号图中心度 > commit 频率。

### 3. 上下文工程：三个最高 ROI 技巧

1. **代码骨架化 / repo map**：大文件只保留签名 + docstring，全仓库地图控制在 1-4k token。metadata skeleton 单独就能支撑准确推理（Stingy Context, 18:1 压缩）。
2. **Sub-worker 返回结构化 digest，原始文件内容绝不进主线程**：worker 读全文、只回 100-300 token 固定 schema 摘要；主线程只持有几十条 digest，128k 绰绰有余。这是 Anthropic 多 agent 收益的真正来源（context 隔离），但用"同模型的子调用"就能拿到，不需要 agent 框架。
3. **KV-cache 友好的稳定前缀**：system prompt / 工具定义全程不变、不放时间戳、历史 append-only。缓存命中 token 价差 ~10x（Manus 称之为生产 agent 最重要的单一指标）。注意：需实测 Tokendance 端点是否支持 prefix caching，不支持则此条降级。

候补：recitation（每轮把"已知/待办/当前假设"复述到 prompt 末尾，对抗 lost-in-the-middle）、保留错误（工具失败原样回灌，不静默重试）。

---

## 二、架构设计

### 总体：四阶段流水线，单编排 + 受控并行 worker

```
POST /api/analyze  (SSE 流式)
│
├─ Phase 0  Scout（确定性，无 LLM，~5s）
│    repo 元数据 + 完整文件树（现有 github.ts 逻辑）
│    → 锚点文件（README/configs/入口）+ import 引用计数中心度
│    → repoMap：文件树骨架 + top 文件清单（1-4k token）
│
├─ Phase 1  Plan（1 次 LLM 调用）
│    输入：repoMap + README 全文
│    输出（Zod 约束 JSON）：
│      analysisMode（paper-code/general-code）
│      researchDimensions[]（method/training/eval/data/overview，按仓库动态取舍）
│      fileAssignments：每个维度分配 3-8 个文件
│      techTags[]（供 kaomian 检索）
│    SSE: 推送计划给前端展示（deer-flow 式"先亮计划"）
│
├─ Phase 2  Research（受控并行，并发 ≤3，最多 2 轮）
│    每个维度一个 worker 子调用（同模型、独立干净 context）：
│      输入：repoMap + 分配文件内容（超预算的文件骨架化）+ 维度专属指令
│      输出：DimensionDigest（见下）
│    编排器收集 digest，合并 openQuestions / requestedFiles
│    → 预算允许且有未决问题 → 第 2 轮追加读取（Jina gap 队列思想）
│    → 预算耗尽 → beast mode：基于已有 digest 强制进入合成
│    SSE: file_read / finding 逐条推送（demo 的 wow moment：看着 agent 读仓库）
│
├─ Phase 3  Synthesize（单次合成，1 次 LLM 调用，流式）
│    输入：全部 digest + repoMap（不含任何原始文件）
│    输出：项目理解报告（streamed markdown）
│    单次合成保证报告自洽（ODR 教训）
│
└─ Phase 4  Questions（1 次 LLM 调用，流式逐题）
     输入：报告 + kaomian 按 techTags 关键词匹配出的题目 + 可选 JD
     输出：NDJSON 逐题流式（每题含 evidence/whyAsk/followUps/redFlags）
     约束：主追问链必须绑定仓库证据；kaomian 题必须改写为项目相关，标记"主追问/补充八股"
```

### DimensionDigest schema（worker 唯一合法输出）

```ts
type DimensionDigest = {
  dimension: "overview" | "method" | "training" | "evaluation" | "data";
  summary: string;                  // ≤3 句
  findings: Array<{
    claim: string;
    evidence: string[];             // "path" 或 "path:Lx-Ly"
    confidence: "high" | "medium" | "low";
  }>;
  claimCodeLinks: Array<{ claim: string; code: string[]; experiments: string[] }>;
  askPoints: string[];              // 可出题点（带证据）
  openQuestions: string[];          // 回答不了的问题
  requestedFiles: string[];         // 申请第 2 轮读取的路径（必须在文件树内）
};
```

要点：
- worker 输出用 Zod 校验，失败重试 1 次后降级跳过该维度（保留现有 fallback 报告路径作为全局兜底）。
- digest 每条 finding 强制 evidence，复用现有 `ensureEvidence` 修复逻辑。
- 主线程 context = repoMap + N 条 digest，总量可控在 ~20k token 内。

### SSE 事件设计

```
event: stage      data: { stage: "scout|plan|research|synthesize|questions", detail }
event: plan       data: { analysisMode, dimensions, fileAssignments }
event: file_read  data: { path, dimension }
event: finding    data: { dimension, claim, evidence, confidence }
event: report     data: { delta: "..." }          // 报告增量
event: question   data: { ...完整单题 JSON }       // 逐题推送
event: warning    data: { message }
event: done       data: { summary }
```

实现：Next.js Route Handler 返回 `ReadableStream`（`text/event-stream`），前端 `fetch` reader 消费替换现有一次性 JSON。事件就是把编排循环里本来就有的状态透出去，无新算法。

### 上下文管理规则（硬约束写进代码）

1. 原始文件内容只进 worker context，绝不进主线程。
2. 单文件超 ~6k token → 骨架化（按语言用正则保留 def/class/function 签名行 + docstring 首段 + import 块；24h 内不用 tree-sitter）。
3. 单 worker 输入预算 ~40k token，超出按文件分数截断并在 digest 标注。
4. 所有 LLM 调用共享同一 system prompt 前缀 + repoMap 前缀（KV-cache 友好），无时间戳，JSON key 顺序固定。
5. 每轮编排 prompt 末尾复述当前状态（recitation）：已覆盖维度 / 未决问题 / 剩余预算。
6. 全局预算：LLM 调用 ≤ 1(plan) + 5(worker 一轮) + 5(worker 二轮上限) + 1(合成) + 1(出题) ≈ 13 次；总时长目标 ≤ 3 分钟（需实测 Tokendance 单调用延迟后校准）。

### kaomian / JD 接入（不用 embedding）

- Phase 1 产出 techTags + 风险点 → 对 kaomian 题库做关键词/标签匹配（题库预先打标签，构建期一次性完成）。
- 匹配题 → Phase 4 prompt 里作为"高频考点素材"，要求模型改写成绑定本仓库证据的追问，并区分"主追问链"（必须有 evidence）与"补充八股"（标注来源题库）。
- JD 可选输入：作为 Phase 4 的偏置段落（影响题目权重排序），不影响 Phase 1-3 的理解主线（与 ROADMAP "JD 只是偏置层"一致）。

---

## 三、24 小时实施切片

| 时段 | 交付 | 说明 |
|---|---|---|
| H1-H3 | SSE 管道打通 | route.ts 改流式；前端进度 feed（stage/file_read/finding）；现有逻辑先原样跑在新管道里 |
| H4-H8 | Phase 0/1/2 | repoMap（复用 github.ts 评分）+ planner + worker digest 循环 + 骨架化 + 预算控制 |
| H9-H12 | Phase 3/4 | 单次合成流式报告 + 逐题流式出题 |
| H13-H15 | kaomian + JD | 题库打标签、关键词匹配、出题 prompt 接入 |
| H16+ | 部署 + 录 demo | 云服务器、公网 URL、3 分钟视频（wow moment 放最前：实时看 agent 读仓库出题） |

**明确砍掉**：tree-sitter/PageRank（用 import 计数）、embedding/向量库（全程不用）、agent 编排框架（手写 ~200 行编排循环）、真并行多 agent（受控 Promise 并发即可）、跨请求缓存（可选 in-memory by repo+SHA，10 行）。

**风险与对策**：
- Tokendance 单调用延迟未知（现有代码超时设 20 分钟）→ H1 先实测；若单调用 >60s，削减 worker 轮数到 1、维度合并到 3 个。
- deepseek JSON 稳定性 → 已有 Zod preprocess 容错；worker 失败降级跳过。
- GitHub 限流 → 必须配 GITHub_TOKEN；raw 文件抓取改并发 (limit 5)。

---

## 四、可直接参考的代码/文章

架构：
- Anthropic multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- Cognition Don't Build Multi-Agents: https://cognition.ai/blog/dont-build-multi-agents
- LangChain open_deep_research（"并行收集+单次合成"教训）: https://github.com/langchain-ai/open_deep_research / https://rlancemartin.github.io/2025/07/30/bitter_lesson/
- Jina node-DeepResearch（TS 单 agent，可直接读码）: https://github.com/jina-ai/node-DeepResearch
- MAST 多 agent 失败分类: https://arxiv.org/pdf/2503.13657
- 字节 deer-flow（计划人审交互）: https://github.com/bytedance/deer-flow

仓库理解：
- deepwiki-open（两阶段结构生成，TS）: https://github.com/AsyncFuncAI/deepwiki-open
- Aider repo map: https://aider.chat/2023/10/22/repomap.html
- Anthropic context engineering（agentic search 替换 RAG、just-in-time）: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Cody 退役 embeddings: https://sourcegraph.com/blog/how-cody-understands-your-codebase
- codebase 面试题工作流（难度分档+rubric）: https://terminalskills.io/use-cases/create-automated-technical-interview-questions-from-codebase

上下文工程 / 流式：
- Manus context engineering（KV-cache/recitation/保留错误）: https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- u14app/deep-research（SSE 实现参考）: https://github.com/u14app/deep-research
- dzhng/deep-research（TS，learnings[] 传递）: https://github.com/dzhng/deep-research
- Next.js SSE 最小实现: https://github.com/rishi-raj-jain/sse-streaming-llm-response

备注：devcontext.ai 已无公开可访问信息（域名 404，无 HN/PH 记录），产品形态参考改用 DeepWiki + 上述面试题工作流。
