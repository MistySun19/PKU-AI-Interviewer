# PKU AI Interviewer

AI、算法、研究岗实习与保研场景下的证据驱动面试生成器。

当前 V1.0.0 方向：用户输入 arXiv 论文或 GitHub 仓库，可选输入 JD。系统先审查论文 / 仓库本身，再结合 `kaomian` 高频题库，生成一份有证据来源的项目相关面试计划。

一句话定位：

> 不是帮你背面试题，而是读取你的论文 / 仓库后，生成真正围绕材料本身的拷打计划。

## V1.0.0 闭环

1. 输入 arXiv 链接或 GitHub 仓库链接。
2. 可选输入 JD / 岗位描述。
3. 系统抓取并结构化理解材料。
4. 系统审查可出题点。
5. 系统检索 `kaomian` 高频八股题。
6. 系统把材料证据和八股题连接起来。
7. 输出一份项目相关面试计划。

## 题库策略

- `kaomian`: V1.0.0 直接使用的题库快照。
- `bagu-killer`: 未来用于定时更新题库的生产流水线。

## 文档

- `V1.0.0_PLAN.md`: V1.0.0 架构和落地计划
- `VERSION_WORKLOG.md`: 版本演化工作日志，保留 v0.0.1 到 V1.0.0 的定位变化
- `CHANGELOG.md`: 对外版本变更日志
- `AGENTS.md`: 仓库定位、V1.0.0 架构和智能体工作规则
- `agent.md`: 智能体入口说明，指向 `AGENTS.md`
- `docs/workflows/GIT_WORKFLOW.md`: Git 提交流程
- `docs/workflows/VERSIONING.md`: 版本管理规则
- `docs/workflows/WORKLOG_SYSTEM.md`: 工作日志体系
- `docs/adr/`: 架构决策记录
- `PROJECT_POSITIONING_v0.0.1.md`: v0.0.1 项目定位总结
- `interview-worklog.md`: 用户访谈工作日志
- `user-research.md`: 国内大学生面试需求初步调研
- `github-competitor-research.md`: GitHub 竞品调研
