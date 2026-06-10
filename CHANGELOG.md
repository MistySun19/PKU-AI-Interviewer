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

### 调整

- 将 V1.0.0 范围调整为 GitHub 仓库理解优先。
- 将路线调整为 GitHub repo -> `kaomian` -> 一句话自述 -> arXiv -> JD。
- 将 alpha 主线从通用软件工程审查调整为 AI 算法岗项目考核，重点覆盖方法、训练、评测、配置、数据和复现。

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
