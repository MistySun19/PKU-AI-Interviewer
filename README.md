# PKU AI Interviewer

AI、算法、研究岗实习与保研场景下的项目考核面试生成器。

当前 V1.0.0-alpha.1 方向：用户输入公开 GitHub 仓库。系统优先按论文 / AI 项目制代码库理解方法 claim、核心代码、训练配置、数据处理、评测逻辑和复现路线，生成一份有证据来源的算法岗项目考核面试计划。

一句话定位：

> 不是帮你背面试题，而是读懂你的仓库后，生成真正围绕项目本身的拷打计划。

## V1.0.0 闭环

1. 输入 GitHub 仓库链接。
2. 系统抓取 README、文件树、关键方法代码、配置、训练、推理、数据和评测文件。
3. 系统自动判断 `paper-code` / `general-code` / `unknown`。
4. 系统用轻量论文项目理解 skill 结构化理解 paper claim、核心方法、训练 / 推理入口、数据流和评测逻辑。
5. 系统审查可出题点。
6. 输出一份项目考核面试计划。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 `http://localhost:3000`，输入公开 GitHub 仓库链接即可生成 alpha 报告。

当前 deep research 请求可能较慢，`/api/analyze` 和模型请求超时设置为 20 分钟。

环境变量：

- `OPENAI_API_KEY`: OpenAI-compatible API key。未配置时会生成降级报告。
- `OPENAI_BASE_URL`: OpenAI-compatible endpoint，默认 `https://api.openai.com/v1`。
- `OPENAI_MODEL`: OpenAI-compatible 模型名；使用 Tokendance 时可以留空。
- `GITHUB_TOKEN`: 可选但强烈建议。GitHub REST API 不按请求收费；未认证通常只有 60 次/小时/IP，配置 token 后常规可到 5000 次/小时。
- `TOKENDANCE_API_KEY`: 可选，Tokendance API key；未配置 `OPENAI_API_KEY` 时自动使用。
- `TOKENDANCE_BASE_URL`: 可选，Tokendance OpenAI-compatible endpoint。
- `TOKENDANCE_CHAT_COMPLETIONS_URL`: 可选，Tokendance chat completions 完整 URL。
- `TOKENDANCE_MODEL`: 可选，Tokendance 模型名，默认 `deepseek-v4-pro`。

## 题库策略

- `kaomian`: V1.0.0 直接使用的题库快照。
- `bagu-killer`: 未来用于定时更新题库的生产流水线。

alpha.1 暂不接入 `kaomian`，先把 GitHub repo paper-code 理解做扎实。

## 后续增强

- v1.0.0-alpha：只支持 GitHub repo 基础理解。
- v1.0.0-alpha.1：支持 GitHub repo paper-code 理解。
- v1.0.0-beta：接入 `kaomian`。
- v1.0.0-rc：支持 GitHub repo + 一句话自述。
- v1.1.0：接入 arXiv / 论文项目理解。
- v1.2.0：接入 JD / 岗位描述偏置。
- v1.3.0：接入实时面试追问。

## 文档

- `docs/ARCHITECTURE.md`: Repo Deep Research Agent 系统架构图与阶段说明
- `V1.0.0_PLAN.md`: V1.0.0 架构和落地计划
- `ROADMAP.md`: 从 GitHub repo 到 kaomian、一句话自述、arXiv、JD 的计划线
- `VERSION_WORKLOG.md`: 版本演化工作日志，保留 v0.0.1 到 V1.0.0 的定位变化
- `CHANGELOG.md`: 对外版本变更日志
- `AGENTS.md`: 仓库定位、V1.0.0 架构和智能体工作规则
- `agent.md`: 智能体入口说明，指向 `AGENTS.md`
- `docs/workflows/GIT_WORKFLOW.md`: Git 提交流程
- `docs/workflows/VERSIONING.md`: 版本管理规则
- `docs/workflows/WORKLOG_SYSTEM.md`: 工作日志体系
- `docs/comparisons/devcontext-vs-pku-agent-workflow.html`: DevContext.AI 和本项目 agent workflow 对比
- `docs/research/iclr-paper-repo-research.md`: ICLR / AI paper repo 结构调研与 alpha.1 文件选择依据
- `docs/research/deep-research-agent-design.md`: Repo Deep Research Agent 调研结论与架构设计
- `docs/adr/`: 架构决策记录
- `PROJECT_POSITIONING_v0.0.1.md`: v0.0.1 项目定位总结
- `interview-worklog.md`: 用户访谈工作日志
- `user-research.md`: 国内大学生面试需求初步调研
- `github-competitor-research.md`: GitHub 竞品调研
