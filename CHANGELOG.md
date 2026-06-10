# 变更日志

本文件记录对外可读的版本变化。产品定位的思考过程见 `VERSION_WORKLOG.md`，架构见 `docs/ARCHITECTURE.md`。

## 未发布

### 新增

- 产品更名为 **Traceback**。
- 首页新增 `Demo / 介绍` 切换；`介绍` 页面用于 3 分钟演示讲解。
- 新增 Repo 面试风险审查器双栏界面：左侧风险点，右侧 Evidence Viewer。
- 新增 `RepoInterviewRisk`、`EvidenceRef`、`EvidenceDocument`、`EvidenceCheck` 类型。
- 新增 Evidence Check Agent：审核每个风险点的 reference 是否充分且必要。
- 新增 `/api/risk-chat`，支持单风险点持续追问，不限制轮数。
- 风险卡新增参考答案、红旗回答、补坑建议、Evidence Check 折叠区。
- Agent Dashboard 展示 Scout / Plan / Research / Synthesize / Risk Gen / Evidence / Result 当前阶段。
- Demo 演示配置切换为 `deepseek-v4-flash` + non-thinking。

### 调整

- 主产品从完整 AI 面试平台收缩为 Repo 面试风险审查器。
- 删除用户可见的 Survey / Practice / Test 主入口语言。
- 主结果文案固定为：`这是你的项目里最可能被面试官问穿的 k 个地方。`
- 风险点数量不再固定为 8；目标 8 个及以上，由模型根据仓库复杂度和证据密度判断。
- `kaomian` 改为“真实面经问题素材”，不再作为泛八股题库直接出题。
- 问题生成规则改为“先说代码事实，再问风险”，禁止把 evidence 没证明的细节写成实现事实。
- 外部框架、版本升级、兼容性不再作为主问题，除非有依赖文件、README、版本说明或相关文档证据。
- Evidence viewer 第一版聚焦分析时打包的 snippets，不做完整 IDE。

### 修复

- 修正 DistributedAttention / FlashAttention varlen 互斥分支类问题：不能把非分布式 varlen 分支里的 `cu_seqlens` 构造错误归到 DistributedAttention 内部。
- 修正 import-only / docstring-only reference 容易被误判为充分证据的问题。
- 修正风险点详情过长的问题：对应 claim、参考答案、红旗回答、补坑建议和 Evidence Check 改为折叠按钮。

## 历史记录摘要

- v0.0.1：项目深挖压力面试官，主要基于用户手填项目描述连续追问。
- v1.0.0-alpha：GitHub repo 基础理解。
- v1.0.0-alpha.1：paper-code 仓库理解。
- v1.0.0-beta：Repo Deep Research Agent + Survey / Practice / Test 完整平台尝试。
- v1.0.0-beta.2：收缩到 Survey + 可看提示的 Test。
- v1.0.0-beta.3：进一步收缩并更名为 Traceback，主形态改为 Repo 面试风险审查器。
