# AGENTS.md

本仓库正在构建 **PKU AI Interviewer** 的 V1.0.0 版本。

这份文件是智能体和后续开发者的工作约束。它不是最终产品说明书，而是当前阶段的工程共识。

## 产品定位

PKU AI Interviewer 不是通用模拟面试题库。

它是一个 **仓库理解优先的项目考核面试生成器**：

> 输入 GitHub 仓库，系统先读懂项目目标、代码结构、核心模块、数据流和评测逻辑，再结合动态八股题库，生成一份项目相关的面试拷打计划。

核心差异：

- 普通 AI 面试：用户描述项目，AI 生成泛问题。
- PKU AI Interviewer：AI 读取仓库证据，找出真实可追问点，再生成面试。

## V1.0.0 输入约束

必要输入：

- GitHub 仓库链接

可选输入：

- 用户补充背景，例如目标方向、自己负责的模块、希望重点检查的代码路径

不要把“手填项目描述”作为 V1.0.0 的主要入口。它只能作为兜底补充。

JD / 岗位描述不进入 V1.0.0 主流程，放到 V1.1 作为岗位偏置层。arXiv / 论文解析放到 V1.2。

## V1.0.0 输出目标

第一阶段先输出一份结构化的 **项目相关面试计划**，不急着做实时聊天。

输出必须包含：

- 仓库摘要
- 项目主流程理解
- 核心模块地图
- 可出题点列表
- 每个出题点的证据来源
- 与 `kaomian` 高频题的连接
- 分层面试问题
- 预期回答要点
- 红旗回答
- 追问链

## 题库策略

V1.0.0 先使用 `kaomian` 作为题库快照。

`kaomian` 的角色：

- 提供 AI Agent / RAG / Tool Calling / Memory / 多 Agent 岗位的高频拷打题。
- 作为仓库审查结果和高频八股之间的连接层。
- 不能替代仓库审查。

`bagu-killer` 的角色：

- 作为未来定时更新题库的生产流水线。
- V1.0.0 不需要集成它的抓取、OCR、抽取、归并流程。
- 后续版本可以定时运行 `bagu-killer`，产出新的题库快照，再刷新检索索引。

架构分层：

```text
GitHub 仓库               -> V1.0.0 一手证据源
kaomian                   -> 当前八股题库快照
bagu-killer               -> 未来定时题库更新流水线
PKU AI Interviewer agent  -> 证据审查 + 题库连接 + 面试生成
```

## 智能体流程

V1.0.0 推荐使用这条 agent loop：

1. 输入解析智能体
   - 校验 GitHub 仓库链接。
   - 解析 owner、repo、branch。
   - 解析用户补充的目标方向和负责模块。

2. 仓库抓取智能体
   - 获取 README、文件树、关键源码文件、配置文件、测试文件和评测脚本。
   - 必须过滤大文件、二进制文件、构建产物、依赖目录和锁文件。

3. 仓库结构化理解智能体
   - 拆出项目目标、技术栈、入口、核心模块、主流程、数据流、异常处理、测试、评测和部署。
   - 如果是 AI / Agent / RAG / RL 项目，必须识别模型、数据、agent loop、tool、memory、eval 和推理链路。

4. 审查智能体
   - 像认真面试官 / reviewer 一样找可追问点。
   - 重点找设计选择、细节缺口、评测问题、实现风险、可扩展性问题。

5. 题库检索智能体
   - 用仓库技术标签、材料标签、审查出的风险点去检索 `kaomian`。
   - 召回高频八股和项目拷打题。
   - 不允许直接硬塞题库题，必须和证据点绑定。

6. 出题规划智能体
   - 把问题组织成由浅入深的追问链。
   - 每条链至少包含：
     - 项目事实
     - 设计理由
     - 原理 / 八股连接
     - 失败情况 / 真实场景
     - 反事实或替代方案

7. 面试生成智能体
   - 生成最终面试计划。
   - 每个问题必须有证据来源、追问理由、期望回答和红旗回答。

## 材料审查原则

GitHub 审查重点：

- 项目目标是否清楚。
- README 和代码是否一致。
- 入口和核心模块在哪里。
- 核心逻辑是否有可解释设计。
- 数据流和状态流是否清楚。
- 是否有测试、评测、日志、异常处理。
- 是否有部署和生产化考虑。
- 哪些代码最容易被问“为什么这样写”。
- 哪些地方能看出用户是否真的做过这个项目。

## 题库连接原则

`kaomian` 题库只能作为连接层，不是主线。

正确用法：

```text
仓库里有 RAG 召回模块
-> 审查智能体发现没有评测和 bad case 处理
-> kaomian 召回“RAG 召回 bad case 怎么处理”
-> 生成项目相关问题：你这个项目的 RAG 召回失败时怎么定位，是 chunk 问题、embedding 问题，还是 rerank 问题？
```

错误用法：

```text
用户输入 Agent 项目
-> 直接塞 10 道 kaomian 高频题
-> 和项目证据没有关系
```

## 技术建议

先保持实现简单：

- Next.js App Router
- TypeScript
- 兼容 OpenAI 接口的大模型 API
- Markdown 题库快照
- 本地内存 / 浏览器状态即可

后续再加：

- JD / 岗位描述偏置
- arXiv / 论文项目理解
- 向量检索
- 题库定时更新
- 数据库存储
- 用户会话历史
- 实时面试聊天

## 文件组织建议

```text
src/
  app/
    page.tsx
    api/
      analyze/route.ts
      generate-interview/route.ts
  lib/
    ingest/
      github.ts
    agents/
      parse-input.ts
      understand-material.ts
      review-material.ts
      retrieve-bagu.ts
      plan-questions.ts
      generate-interview.ts
    knowledge/
      kaomian.ts
    prompts.ts
    schemas.ts
```

## V1.0.0 成功标准

V1.0.0 成功，不要求完成完整聊天产品。

成功标准是：

1. 用户输入 GitHub 仓库链接。
2. 系统能抓取并结构化理解 GitHub 仓库。
3. 系统能找出 5 到 8 个有证据的可出题点。
4. 系统能解释仓库主流程、核心模块、数据流和评测逻辑。
5. 系统能从 `kaomian` 召回相关八股题。
6. 系统能把仓库证据和八股题连接起来。
7. 系统能生成一份项目考核面试计划。

## 当前不要做

- 不要先做语音 / 视频。
- 不要先做登录。
- 不要先做大型数据库。
- 不要先做 JD 匹配。
- 不要先做 arXiv 论文解析。
- 不要先做泛题库页面。
- 不要把用户手写项目描述作为主入口。
- 不要把 `kaomian` 的题直接拼到输出里。
- 不要在没有证据来源的情况下生成“项目相关问题”。

## 源文档

核心定位文档：

- `CHANGELOG.md`
- `V1.0.0_PLAN.md`
- `VERSION_WORKLOG.md`
- `PROJECT_POSITIONING_v0.0.1.md`
- `interview-worklog.md`
- `user-research.md`
- `github-competitor-research.md`
- `docs/workflows/GIT_WORKFLOW.md`
- `docs/workflows/VERSIONING.md`
- `docs/workflows/WORKLOG_SYSTEM.md`
- `docs/adr/`

当本文和旧文档冲突时，以 `V1.0.0_PLAN.md` 和本文为准。

## 仓库治理规则

- 对外版本变化写入 `CHANGELOG.md`。
- 产品定位演化写入 `VERSION_WORKLOG.md`。
- 用户访谈继续写入 `interview-worklog.md`。
- 关键架构决策写入 `docs/adr/`。
- Git 提交和版本规则遵守 `docs/workflows/`。
- 新文档必须被 README 或对应索引引用。
