# Git 工作流

本仓库会长期演进，Git 的目标不是形式化，而是让每次方向变化和功能变化都能回看。

## 分支规则

当前阶段可以直接在 `main` 上小步提交，因为项目仍处于早期搭建期。

当进入多人协作或开始有可用产品后，改用：

- `main`: 稳定主线。
- `feat/<short-name>`: 新功能。
- `docs/<short-name>`: 文档和定位。
- `fix/<short-name>`: 修复。
- `research/<topic>`: 调研实验。

## 提交规则

使用简短中文 conventional commit：

```text
docs: 记录版本演化工作日志
feat: 增加 GitHub 仓库解析
fix: 修复 arXiv PDF 解析失败兜底
research: 调研 kaomian 题库结构
chore: 建立版本管理流程
```

常用类型：

- `docs`: 文档、定位、工作日志。
- `feat`: 用户可见功能。
- `fix`: 缺陷修复。
- `research`: 调研、实验、验证性脚本。
- `chore`: 工程配置、流程、依赖维护。
- `refactor`: 不改变行为的重构。

## 提交粒度

每个提交只做一类事情。

好的提交：

- 新增 V1.0.0 计划。
- 建立版本管理流程。
- 增加 arXiv 抓取模块。

不好的提交：

- 同时改定位、写前端、换依赖、修样式。

## 提交前检查

文档提交：

- 确认新增文档已被 README 或相关索引引用。
- 确认没有把 PDF、密钥、运行产物提交进去。
- 确认版本变化写入 `CHANGELOG.md` 或 `VERSION_WORKLOG.md`。

代码提交：

- 先跑项目已有测试 / 类型检查。
- 如果没有测试，至少手动运行对应功能。
- 大模型 JSON 输出相关代码必须有失败兜底。

## 推送规则

本地可以连续小步提交。

推送到远端前：

- `git status --short --branch`
- `git log --oneline -5`
- 确认没有敏感文件。

当前仓库已有 PDF 原始资料，但 `.gitignore` 已排除 `*.pdf`，不要把原始 PDF 加进提交。

