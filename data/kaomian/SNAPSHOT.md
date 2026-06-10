# kaomian 题库快照

- 来源仓库：https://github.com/smile-struggler/kaomian
- 固定 commit：`2651f16666ba48e858bd934b317313763f69ed02`
- 快照日期：2026-06-10
- 快照范围：源仓库 `题库/` 目录下全部 7 个 Markdown 文件，逐字节一致

## 文件清单

| 文件 | 用途（对应 V1.0.0_PLAN §4.5） |
| --- | --- |
| 00_题库总索引.md | 题库索引 |
| 01_Top100_高频题.md | 推荐优先使用 |
| 02_知识问答题.md | 补充 |
| 03_Agent_RAG_Tool_Memory.md | 推荐优先使用 |
| 04_LeetCode_算法手撕.md | 补充 |
| 05_机器学习_大模型手撕.md | 推荐优先使用 |
| 06_项目拷打题.md | 推荐优先使用 |

## 更新方式

v1.4.0 之前为手动快照。重新拉取时更新固定 commit 与快照日期：

```bash
gh api "repos/smile-struggler/kaomian/contents/题库/<文件名>.md?ref=<commit>" --jq '.content' | base64 -d > data/kaomian/<文件名>.md
```
