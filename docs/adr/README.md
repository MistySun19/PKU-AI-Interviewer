# 架构决策记录

ADR 用来记录不可轻易回滚的重要决策。

命名规则：

```text
0001-short-title.md
0002-short-title.md
```

每个 ADR 使用以下结构：

```markdown
# ADR-0001 标题

## 状态

已接受 / 已废弃 / 讨论中

## 背景

## 决策

## 后果

## 相关文档
```

当前决策：

- `0001-evidence-first-input.md`: V1.0.0 以 arXiv / GitHub 为必要输入。
- `0002-kaomian-as-snapshot.md`: V1.0.0 先使用 `kaomian` 题库快照。
- `0003-repo-understanding-first.md`: V1.0.0 先做好 GitHub 仓库理解，JD 和 arXiv 后置。
