# ROADMAP：Traceback

Traceback 当前路线不是做完整 AI 面试平台，而是先证明一个尖锐闭环：

> 给我一个 GitHub repo，告诉我项目里最可能被面试官问穿的地方，并把每个问题链接到代码、README 或配置证据。

## 当前阶段

当前阶段目标：**Repo 面试风险审查器**。

保留：

- GitHub repo 输入。
- Repo Deep Research Agent。
- Risk Generation Agent。
- Evidence Check Agent。
- 双栏 viewer：左侧风险点，右侧代码证据。
- 单风险点持续追问。
- 参考答案、红旗回答、补坑建议。
- `kaomian` 作为真实面经问题素材。

移出主线：

- Survey / Practice / Test 主入口。
- 泛题库。
- 整场评分。
- 详尽复盘。
- 题集历史。
- JD 匹配。
- arXiv 论文解析。

## 为什么收缩

之前的 beta 已经能做很多事：deep research、题库连接、练习、测试、追问、评分、复盘、历史记录。

问题是：从 YC 视角看，这太像完整平台，但还没有证明最小闭环是否真的有需求。

更强的 MVP 是：

```text
repo -> 最可能被问穿的风险点 -> 证据原文 -> 回答与追问
```

这个形态第一眼价值更清楚，也更能说明产品和 ChatGPT 的区别。

## V1 成功标准

1. 输入一个公开 GitHub repo。
2. 系统在 1 分钟演示路径内展示稳定结果。
3. 主结果显示：`这是你的项目里最可能被面试官问穿的 k 个地方。`
4. `k` 目标 8 个及以上，证据不足时不硬凑。
5. 每个风险点都有至少一个可展示 evidence ref。
6. Evidence Check 能阻断证据不充分或不必要的问题。
7. 用户点击风险点后，右侧 evidence viewer 正确切换。
8. 用户能在风险点下持续追问。

## Phase 0：真实公网演示稳定化

目标：公网入口默认走真实 pipeline，同时尽量缩短等待并让进度可解释。

任务：

- 公网 `/api/analyze` 默认不返回固定快照。
- 本地如需演示快照，必须显式设置 `TRACEBACK_DEMO_SNAPSHOT=enabled`。
- 真实 pipeline 使用 fast model + non-thinking 提速。
- 首页保留 `Demo / 介绍` 切换。
- 演示配置使用 `deepseek-v4-flash` + non-thinking。

## Phase 1：Evidence 命中质量

目标：让问题和代码证据足够准。

任务：

- 建 golden repo 回归集。
- 为常见错误建立规则：
  - import-only reference 不算充分。
  - README-only reference 不支撑具体实现。
  - 外部框架兼容性不能作为主问题。
  - 互斥分支不能写成同一路径内的参数构造。
- 输出 evidenceCheck reason，方便人工检查。

## Phase 2：Risk Viewer 增强

目标：让“左问题 / 右证据”的产品形态更强。

任务：

- 文件树。
- 多 evidence 对照。
- 行号高亮。
- README claim 高亮。
- 配置项高亮。
- reference 点击后自动滚动。

## Phase 3：持续追问质量

目标：让单风险点追问更接近真人面试。

任务：

- 回答后继续追问，不限制轮数。
- 追问聚焦用户回答里的虚处。
- 参考答案保持简短，不做长复盘。
- 保持单风险点聊天，不恢复整场 Test。

## Phase 4：可选扩展

只有当 repo 风险审查闭环被验证后，才考虑恢复：

- 学习模式。
- 历史记录。
- 复盘。
- JD / 岗位偏置。
- arXiv paper claim 对齐。
- `kaomian` embedding 检索。

## 非目标

当前不做：

- 通用八股题库。
- AI 面试评分平台。
- 语音 / 视频面试。
- 登录 / 账号系统。
- 大型数据库。
- 完整 GitHub IDE。

## 当前判断

Traceback 的护城河不是“生成问题”，而是：

```text
真实 repo 证据 -> 面试风险判断 -> 代码定位 -> 回答建议 -> 持续追问
```

如果这个闭环足够准，产品才有资格继续长成更完整的平台。
