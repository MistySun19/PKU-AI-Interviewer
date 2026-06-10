# 版本演化工作日志

这个文件记录产品定位如何变化，避免后续版本覆盖早期判断。

## v0.0.1：项目深挖压力面试官

最早的洞察：

> 用户最痛的不是泛面试题，而是项目被认真深挖时答不住。

当时设想：

```text
输入项目经历 -> 提取高风险追问点 -> 连续追问 -> 项目防问卡
```

问题：

- 输入依赖用户手填项目描述。
- 证据不硬。
- 容易退化成“ChatGPT 根据项目简介出题”。

## V1.0.0：证据驱动面试生成器

第一次升级：

```text
用户描述 -> 一手材料
```

关键变化：

- 必要输入升级为 GitHub 仓库。
- 系统先审查仓库，再生成问题。
- 每个问题必须绑定证据。
- `kaomian` 被引入为真实面经 / 高频问题素材。

保留判断：

- 不做通用 AI 面试题库。
- 项目深挖是核心差异化。
- 题库只能校准问题风格，不能替代仓库审查。

## v1.0.0-beta：完整平台尝试

beta 阶段做出了完整能力：

- Repo Deep Research Agent。
- Survey。
- Practice。
- Test。
- 实时追问。
- 评分。
- 复盘。
- 历史记录。
- `kaomian` 题库连接。

这个阶段证明了工程上可以做完整平台，但也暴露出产品风险：

> 还没证明最小闭环有需求，就开始做完整平台。

## v1.0.0-beta.2：第一次收缩

核心质疑：

> 这个软件和 ChatGPT 加一个 GitHub 地址，到底有什么很大的区别？

当时收缩为：

```text
GitHub repo -> Survey 证据地图 -> Test 输出 8 个追问点
```

保留：

- Repo Deep Research。
- paper-code 理解。
- Survey。
- 可看提示的 Test。

移出：

- Practice。
- 连续追问。
- 评分。
- 复盘。
- 历史。
- 泛八股连接。

这次收缩让产品更聚焦，但仍然保留了 Survey / Test 这样的模块语言，第一眼冲击力不够强。

## v1.0.0-beta.3：Traceback / Repo 面试风险审查器

最新判断：

> 产品不应该叫“AI 生成一份面试报告”，而应该是“项目面试风险审查器”。

新的产品名：

```text
Traceback
```

一句话：

> 你的 GitHub 项目，真的经得起面试官追问吗？

新形态：

```text
左侧：会被问穿的问题
右侧：代码 / README / 配置证据
```

主结果文案：

> 这是你的项目里最可能被面试官问穿的 k 个地方。

重要修正：

- `k` 不固定死为 8；目标 8 个及以上，由模型根据仓库复杂度和证据密度判断。
- AI 可以一直追问，不再限制 1-2 轮。
- 每个风险点都给参考答案。
- `kaomian` 改称真实面经问题素材，不再说八股题库。
- 删除用户可见 Survey / Practice / Test 主入口。

## Evidence Check Agent

新版本加入阻断式 Evidence Check Agent。

它检查：

- reference 是否充分。
- reference 是否必要。

如果证据不够，风险点不能直接进入最终结果。

新增字段：

```text
status: pass | needs_revision | drop
sufficiency: sufficient | partial | insufficient
necessity: necessary | excessive | irrelevant
missingEvidence
removedEvidenceRefs
reason
```

核心原则：

- evidence 只能证明它真的能证明的事情。
- 问题可以追问风险，但不能把假设说成实现。
- 如果问题涉及外部框架、版本升级、兼容性，但没有依赖文件、README、版本说明或相关文档证据，不能进入最终结果。
- 但主线仍然应该聚焦项目内部设计思路和具体实现，而不是外部生态泛讨论。

## 自测后的重要修正

SWE-bench / distributed attention 自测暴露出证据问题：

1. `distributed_attention.py` 能证明存在 `tensor_split`、`all_to_all`、`DistributedAttention.forward`。
2. 但它不能直接证明变长序列不均匀时如何处理 padding、GPU 空转或显存浪费。
3. “在 DistributedAttention 里 cu_seqlens 怎么构造”这个问题不准，因为真正的 `cu_seqlens` 逻辑在非分布式 varlen 分支。

因此问题应该改成：

> 这段 LLaMA attention 里，分布式分支和 varlen 分支是互斥的。为什么分布式路径没有走 `flash_attn_varlen_kvpacked_func`？如果 batch 里 padding 很多，分布式路径会不会失去 varlen 的收益？

这次修正确定了新的质量标准：

- 先说代码事实，再问风险。
- 不把 evidence 没证明的实现写成事实。
- 互斥分支必须按互斥分支来问。
- import-only / docstring-only / README-only 通常不足以支撑具体实现追问。

## Demo / 介绍页

为了演示，首页加入两个视图：

- `Demo`：真实风险审查器。
- `介绍`：一页 3 分钟讲解页。

演示节奏：

```text
0:00 - 0:30  展示 wow moment
0:30 - 2:30  讲 Deep Research Agent + Evidence Check Agent
2:30 - 3:00  展示持续追问和用户价值
```

## 当前路线

当前优先级：

1. 稳定真实公网 pipeline，保证等待过程可解释，避免公网返回固定 demo。
2. 提高 Evidence Check 准确性。
3. 打磨双栏 viewer。
4. 打磨单风险点持续追问。
5. 建立 golden repo 评测集。

暂缓：

- Survey / Practice / Test 主入口。
- 整场评分。
- 详尽复盘。
- 泛题库。
- JD / arXiv。
- 登录和数据库。

## 当前产品判断

Traceback 的护城河不是“AI 会生成题”，而是：

```text
repo 证据 -> 面试风险点 -> 代码定位 -> 参考答案 / 红旗回答 -> 持续追问
```

这个闭环如果足够准，就比 ChatGPT + GitHub URL 更有价值，也更容易被用户一眼理解。
