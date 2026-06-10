# 变更日志

本文件记录对外可读的版本变化。产品定位的思考过程请看 `VERSION_WORKLOG.md`，具体设计决策请看 `docs/adr/`。

格式参考 Keep a Changelog，但内容按本项目需要简化。

## 未发布

### 新增

- 建立 Git / 版本 / 决策 / 工作日志体系。
- 新增 V1.0.0 证据驱动面试生成器计划。
- 新增智能体工作规则 `AGENTS.md`。
- 新增 DevContext.AI 与本项目 agent workflow 对比页。
- 新增产品路线图 `ROADMAP.md`。
- 实现 v1.0.0-alpha Web Demo：输入公开 GitHub 仓库，生成项目考核面试计划。
- 新增 GitHub 仓库抓取、文件筛选、证据文件选择、LLM 分析和降级报告能力。
- 新增基础单元测试，覆盖 GitHub URL 解析、文件过滤、文件排序和 JSON 容错。
- 实现 v1.0.0-alpha.1：GitHub repo paper-code 理解，自动识别论文 / AI 项目制仓库。
- 新增 paper signals、research artifacts、paper-code map 输出。
- 新增 ICLR / AI paper repo 结构调研文档，作为 alpha.1 文件筛选和面试追问依据。
- 在计划中加入轻量论文项目理解 skill registry，覆盖 benchmark、training、inference、method、data 和 reproduce 仓库形态。
- 明确 alpha.1 继续使用 GitHub REST API，不使用 `git clone`；通过 `GITHUB_TOKEN` 提升 API 次数。
- 调整 paperSignals / analysisMode：不再由 ingest 阶段正则判断，改为 Step 1 大模型基于 README、链接、文件树和代码证据自行判断。
- 移除模型请求的 `max_tokens` 输出限制，并取消 README 30k 字符截断。
- 将模型请求和 `/api/analyze` 路由超时调整为 20 分钟，支持 repo deep research 长请求。
- 实现 v1.0.0-beta：Repo Deep Research Agent 四阶段管道（scout 元数据抓取 / plan 维度规划 / 并行 digest worker 深读 / 单次合成），替换单轮全量喂入。
- 新增 repo map（import 引用计数中心度 + 目录骨架）与大文件骨架化；原始文件内容只进 worker 上下文，不进主合成上下文。
- 新增 SSE 流式输出：阶段进度、读文件、维度发现、报告增量、考核点与面试题逐条推送。
- 新增 Survey / Interactive 双模式：Survey 一次读懂全仓库并流式出全量题；Interactive 一问一答模拟真实面试，回答按 1-5 分评估，弱回答触发追问，结束生成总结与补坑计划。
- 接入 `kaomian` 高频题快照（`data/kaomian/`，636 题），按技术标签检索并要求模型改写为绑定仓库证据的追问，来源标注"高频题改写"。
- 新增 GitHub contents API 回退通道（raw CDN 不可用时自动切换）与 raw 路径段校验。
- 新增架构文档 `docs/ARCHITECTURE.md` 与 deep research agent 调研 `docs/research/deep-research-agent-design.md`。
- 新增 repomap、事件通道、编排器、kaomian 检索、面试状态机的单元测试（40 项）。

### 调整

- 将 V1.0.0 范围调整为 GitHub 仓库理解优先。
- 将路线调整为 GitHub repo -> `kaomian` -> 一句话自述 -> arXiv -> JD。
- 将 alpha 主线从通用软件工程审查调整为 AI 算法岗项目考核，重点覆盖方法、训练、评测、配置、数据和复现。
- `/api/analyze` 从一次性 JSON 改为 SSE 流式；新增 `/api/interview` 面试会话接口（内存会话，重启丢失）。
- 模型 JSON 解析全面宽容化：枚举非法值回退、字符串数组对象提取、嵌套结构解包、校验失败自动重试一次。
- 依赖版本从 `latest` 固定为明确版本号。
- 将实时面试追问从 v1.3.0 提前到 v1.0.0-beta（交互版），原计划位置由后续增强接替。

## v0.0.1 - 项目定位

提交：`2112580`

### 新增

- 明确项目不做通用 AI 面试题库。
- 明确核心痛点是项目深挖压力训练。
- 建立用户访谈工作日志。
- 建立用户需求调研和 GitHub 竞品调研。

### 主要结论

- 用户不是缺题库，而是缺围绕自己项目的高强度、个性化、连续追问。
- 研究岗、算法岗、认真导师都有“项目细节 -> 原理 / 八股 -> 场景迁移”的共同拷打模式。

## v1.0.0-plan - 证据驱动面试生成器计划

提交：`23dc904`

### 新增

- 明确必要输入为 arXiv 链接或 GitHub 仓库链接。
- 明确 JD 为可选输入。
- 明确 `kaomian` 是 V1.0.0 的题库快照。
- 明确 `bagu-killer` 是未来定时更新题库的生产流水线。
- 明确 V1.0.0 先生成项目相关面试计划，不先做实时聊天。

### 主要结论

- V1.0.0 要从一手材料出发，而不是从用户手填项目描述出发。
- 每个问题都必须绑定论文 / 仓库证据。
- 题库只能作为校准器，不能替代材料审查。
