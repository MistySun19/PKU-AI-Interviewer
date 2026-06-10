# AGENTS.md

本仓库当前正在构建 **Traceback**。

这份文件是智能体和后续开发者的工作约束。它描述当前工程共识，不是历史归档。

## 产品定位

Traceback 不是通用模拟面试题库，也不是代码质量审查工具。

它是一个 **Repo 面试风险审查器**：

> 输入 GitHub 仓库，系统把最容易被面试官问穿的项目细节标出来，并把每个问题直接链接到代码、README 或配置证据。

核心差异：

- 普通 AI 面试：用户描述项目，AI 生成泛问题。
- 通用代码审查：AI 给出工程质量、可维护性或部署风险。
- Traceback：AI 先读取仓库证据，再找出项目面试中最容易被追问穿的 claim、实现细节、设计取舍和失败边界。

一句话：

```text
Turnitin for GitHub 项目面试
```

像 Turnitin 把论文里的可疑引用和来源并排展示，Traceback 把项目里可能被面试官质疑的地方和代码证据并排展示。

## 当前 V1 输入

必要输入：

- GitHub 仓库链接

可选输入：

- 用户补充背景，例如目标方向、自己负责的模块、希望重点检查的代码路径

不要把“手填项目描述”作为主入口。它只能作为补充上下文。

## 当前 V1 输出

主结果文案：

> 这是你的项目里最可能被面试官问穿的 k 个地方。

输出包含：

- 仓库摘要
- 项目 claim 与代码证据
- 8 个及以上风险点，数量由模型和证据密度决定
- 每个风险点的风险等级、面试官追问、对应 claim、证据 refs
- 参考答案
- 红旗回答
- 补坑建议
- Evidence Check 结果
- 单风险点下的持续追问聊天

如果证据不足，宁可返回较少风险点并给 warning，也不要强行编造。

## 当前不要再做的主入口

以下能力可以保留为历史代码或后续实验，但不要作为当前产品主入口：

- Survey
- Practice
- Test
- 题目种子
- 题集历史
- 整场评分
- 详尽复盘

当前主入口只有：

```text
Repo 输入 -> 风险审查结果 -> Evidence Viewer -> 单风险点持续追问
```

## kaomian 策略

`kaomian` 保留，但必须转换说法和用法：

- 它不是“八股题库”。
- 它是“真实面经问题素材”。
- 只能辅助生成绑定 repo 证据的风险点。
- 不能直接把面经题塞进输出。

正确用法：

```text
仓库里有 RAG 召回模块
-> 风险生成发现没有评测和 bad case 证据
-> kaomian 召回真实面经里关于 RAG bad case 的追问方式
-> 改写成绑定本仓库证据的问题
```

错误用法：

```text
用户输入 Agent 项目
-> 直接塞 10 道高频题
-> 问题和仓库证据没有关系
```

## Agent Pipeline

推荐 pipeline：

1. **输入解析**
   - 校验 GitHub 仓库链接。
   - 解析 owner、repo、branch。
   - 解析用户补充的目标方向和负责模块。

2. **Scout Agent**
   - 获取 README、文件树、关键源码、配置、训练 / 推理 / 评测 / 数据处理文件。
   - 过滤大文件、二进制、构建产物、依赖目录和锁文件。
   - 不使用 `git clone`，默认走 GitHub REST API。

3. **Plan Agent**
   - 按仓库形态规划 overview、method、training、evaluation、data 等研究维度。
   - 只从已读取证据文件中分配路径，不发明文件。

4. **Research Agents**
   - 每个维度只读分析，抽取代码事实、claim-code link、askPoints、openQuestions。
   - 重点关注控制流、数据流、关键参数构造、评测逻辑、配置、错误处理和失败边界。

5. **Synthesis Agent**
   - 合成自洽的项目理解地图。
   - 对 paper-code 仓库，拆出问题设定、论文 claim、方法实现、训练 / 推理入口、数据处理、配置超参、评测 / 消融 / benchmark 和复现路线。

6. **Risk Generation Agent**
   - 生成候选风险点。
   - 只出思路题，不出复述题。
   - 问题必须是面试官口语，不能把文件路径写进题面。
   - 主问题必须围绕项目内部实现，不把 HuggingFace / vLLM / transformers / 版本升级作为主问题。

7. **Evidence Bundle Builder**
   - 将 evidence path 解析成 `filePath/startLine/endLine/snippet/reason/highlightTerms`。
   - 尽量避免只引用 import、docstring 或泛相关文件。

8. **Evidence Check Agent**
   - 审核 reference 是否充分且必要。
   - 删除不必要 evidence。
   - 要求补充不足 evidence。
   - 无法补足则降级或丢弃风险点。

9. **Risk Viewer**
   - 左侧风险点列表。
   - 右侧代码证据 viewer。
   - 单风险点持续追问。

## Evidence Check 原则

充分：

- reference 能支撑问题中的代码事实。
- reference 能支撑 claim、参考答案、红旗回答。
- 至少覆盖核心实现或配置；必要时覆盖 README claim / eval / train / data。

必要：

- 每条 reference 都对判断该风险点有贡献。
- 不能只是同目录、同关键词、泛相关。

不充分：

- 只有 README。
- 只有文件名。
- 只有宽泛模块。
- 不能支撑具体追问。

不必要：

- 同义重复。
- 无关文件。
- 只因关键词命中但不支撑问题。

处理策略：

- `pass`：进入最终结果。
- `needs_revision`：尝试补 evidence 或重写 risk。
- `drop`：不进入最终结果。

## 问题质量原则

问题应该问：

- 为什么这样设计？
- 这个实现牺牲了什么，换来了什么？
- 哪些输入或场景下会失效？
- 如果换一个实现，会破坏哪些假设？
- README / paper claim 和代码是否对得上？
- 指标、评测、baseline、数据处理是否真的支撑 claim？

不要问：

- “X 包含哪些部分？”
- “某函数有哪些参数？”
- “请基于某文件说明……”
- “为什么不用某个外部框架？”
- 没有证据支撑的兼容性或版本升级泛讨论。

## 文件组织

```text
src/
  app/
    page.tsx
    api/
      analyze/route.ts
      risk-chat/route.ts
  lib/
    github.ts
    orchestrator.ts
    llm.ts
    risk-audit.ts
    kaomian.ts
    report.ts
    types.ts
```

## 成功标准

1. 用户输入 GitHub 仓库链接。
2. 系统能抓取并结构化理解仓库。
3. 系统能找出 8 个及以上有证据的项目面试风险点。
4. 每个进入最终结果的风险点都有充分且必要的 reference。
5. 点击风险点后，右侧 evidence viewer 能显示对应代码 / README / 配置证据。
6. 用户能在单个风险点下持续回答，系统继续追问。
7. Demo / 介绍切换适合 3 分钟演示。

## 当前不要做

- 不要先做语音 / 视频。
- 不要先做登录。
- 不要先做大型数据库。
- 不要先做 JD 匹配。
- 不要先做 arXiv 论文解析。
- 不要先做泛题库页面。
- 不要把用户手写项目描述作为主入口。
- 不要把 `kaomian` 的题直接拼到输出里。
- 不要在没有证据来源的情况下生成“项目相关问题”。
- 不要恢复 Survey / Practice / Test 作为主入口，除非产品重新决策。

## 文档治理

- 对外版本变化写入 `CHANGELOG.md`。
- 产品定位演化写入 `VERSION_WORKLOG.md`。
- 架构变化写入 `docs/ARCHITECTURE.md` 或 `docs/adr/`。
- 演示脚本写入 `docs/demo-video-script.md`。
- 提交材料写入 `PRODUCT_MEMO.md` 和 `SUBMISSION_CHECKLIST.md`。
