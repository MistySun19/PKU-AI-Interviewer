# PKU AI Interviewer

AI、算法、研究岗实习与保研场景下的项目考核面试生成器。

当前 v1.0.0-beta：用户输入公开 GitHub 仓库，Repo Deep Research Agent 深度理解整个项目（方法 claim、核心代码、训练配置、数据处理、评测逻辑和复现路线），再结合 `kaomian` 高频题库，流式生成有证据来源的算法岗项目考核面试。支持两种模式：

- **Survey 全量报告**：一次读懂整个项目，流式输出理解报告 + 考核点 + 全量分层面试题。
- **Interactive 模拟面试**：一问一答模拟真实面试，回答按 1-5 分实时评估，弱回答触发追问，结束后生成总结与补坑计划。

一句话定位：

> 不是帮你背面试题，而是读懂你的仓库后，生成真正围绕项目本身的拷打计划。

## v1.0.0-beta 闭环

1. 输入 GitHub 仓库链接，选择 Survey 或 Interactive 模式。
2. **Scout**：抓取仓库元数据、文件树和关键证据文件，构建 repo map（import 引用计数中心度 + 目录骨架）。
3. **Plan**：模型规划研究维度（overview/method/training/evaluation/data）、分配文件、判断 `paper-code` / `general-code`、产出题库检索标签。
4. **Research**：每个维度一个独立上下文的 digest worker 并行深读（并发 3，最多 2 轮，可主动申请补读文件），原始代码不进主线程。
5. **Synthesize**：全部 digest 单次合成自洽的理解报告（流式输出）。
6. **Questions**：结合 `kaomian` 高频题匹配，流式逐条生成考核点和分层面试题；Interactive 模式则进入一问一答面试循环。

全程 SSE 流式：实时看到系统读了哪个文件、发现了什么、题目逐条出现。架构详见 `docs/ARCHITECTURE.md`。

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
- `TOKENDANCE_RESEARCH_MODEL`: 可选，Plan / Research digest 阶段模型名，默认 `deepseek-v4-flash`。

## 技术栈

- 框架：Next.js 16（App Router）+ React 19 + TypeScript
- 核心管道：自研 Repo Deep Research Agent（单编排线程 + 受控并行 digest worker + 单次合成），SSE 流式输出
- 数据来源：GitHub REST API（不做 git clone）
- LLM：OpenAI-compatible API（支持 Tokendance 聚合服务）
- 校验：zod；测试：vitest；CI：GitHub Actions（typecheck + test）
- 部署：Docker / pm2，见 `docs/DEPLOYMENT.md`

## 题库策略

- `kaomian`: 已接入（ADR-0002 快照模式）。快照在 `data/kaomian/kaomian.json`（636 题，来自 [smile-struggler/kaomian](https://github.com/smile-struggler/kaomian)），按技术标签关键词检索，模型必须把高频题改写成绑定本仓库证据的追问才能使用，并标注"高频题改写"。
- 刷新快照：`node scripts/build-kaomian.mjs`。
- `bagu-killer`: 未来用于定时更新题库的生产流水线，暂不接入主流程。

## 后续增强

- v1.0.0-alpha：GitHub repo 基础理解。已完成。
- v1.0.0-alpha.1：GitHub repo paper-code 理解。已完成。
- v1.0.0-beta：Repo Deep Research Agent + `kaomian` + Survey/Interactive 双模式。当前版本（实时面试追问从 v1.3.0 提前落地为交互版）。
- v1.0.0-rc：支持 GitHub repo + 一句话自述。
- v1.1.0：接入 arXiv / 论文项目理解。
- v1.2.0：接入 JD / 岗位描述偏置。
- v1.3.0：面试强度切换、多场景压力面。
- v1.4.0：`kaomian` 向量检索与定时更新。

## 已知限制

- 交互面试会话保存在进程内存，服务重启后会话丢失（demo 取舍）。
- `kaomian` 检索为关键词/标签级，不做 embedding。
- 完整分析一个仓库约 5-10 分钟（受模型输出速度限制），全程有流式进度。
- 深度理解质量的 golden repo 回归评测集尚未建立，列入下一步。

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
- `用户访谈工作日志.md`: 用户访谈工作日志
- `PRODUCT_MEMO.md`: Product Memo（提交材料草稿）
- `SUBMISSION_CHECKLIST.md`: 提交对照清单
- `docs/DEPLOYMENT.md`: 云服务器部署指南
- `docs/demo-video-script.md`: Demo 视频脚本
- `data/kaomian/`: kaomian 高频题库快照（v1.0.0-beta 使用）
- `user-research.md`: 国内大学生面试需求初步调研
- `github-competitor-research.md`: GitHub 竞品调研
