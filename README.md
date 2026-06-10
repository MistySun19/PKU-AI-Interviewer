# Traceback

你的 GitHub 项目，真的经得起面试官追问吗？

Traceback 是一个 **Repo 面试风险审查器**：输入公开 GitHub 仓库，系统会找出项目里最可能被面试官问穿的细节，并把每个问题直接链接到代码、README 或配置证据。

它不是通用题库，也不是让 AI 随机生成面试题。核心闭环是：

```text
GitHub repo -> 仓库理解 -> 风险点生成 -> Evidence Check -> 证据 viewer -> 持续追问
```

## 当前产品形态

主界面是双栏 viewer：

- 左侧：`会被问穿的问题`，展示一组通过审核的项目风险点。
- 右侧：`Evidence Viewer`，展示对应代码、README 或配置片段。
- 每个风险点包含风险等级、面试官追问、对应 claim、参考答案、红旗回答、补坑建议和 Evidence Check 结果。
- 用户可以在任意风险点下直接回答，系统会继续追问，不限制轮数。

主结果文案固定为：

> 这是你的项目里最可能被面试官问穿的 k 个地方。

`k` 由模型和证据密度决定，目标是 8 个及以上；证据不足时宁可少一点，也不强行编造。

## 为什么不是 ChatGPT + GitHub 链接

Traceback 的关键价值不在“生成题”，而在 **repo 证据 -> 面试风险点 -> 定位到代码 -> 回答建议 -> 持续追问** 这一整套 workflow。

每个风险点必须先经过 Evidence Check Agent：

- **充分性**：reference 是否能支撑问题、claim、参考答案和红旗回答。
- **必要性**：每条 reference 是否真的对判断风险点有贡献。
- **阻断规则**：证据不充分的风险点不能直接进入最终结果；无法补足时降级或丢弃。

这让产品更像：

```text
Turnitin for GitHub 项目面试

像 Turnitin 标出论文可疑引用一样，
Traceback 标出项目里可能被面试官质疑的地方，并展示证据原文。
```

## Agent Pipeline

1. **Scout**
   抓取仓库元数据、README、文件树和关键证据文件。

2. **Plan**
   规划研究维度，例如 overview、method、training、evaluation、data。

3. **Research**
   并行深读关键文件，提取代码事实、claim-code link、设计取舍和候选风险线索。

4. **Synthesize**
   合成项目理解地图，解释项目声称做什么、核心实现在哪里、评测或复现证据是否足够。

5. **Risk Gen**
   生成面试官最可能追问的项目细节，重点是设计思路、具体实现、失败边界和替代方案。

6. **Evidence Check**
   审核每个风险点的 references 是否充分且必要。

7. **Risk Viewer**
   左侧展示风险点，右侧展示证据，用户可以继续和单个风险点对话。

## Demo 模式

为了课堂 / 路演演示，首页右上角提供两个视图：

- `Demo`：真实产品界面，展示风险点、证据 viewer 和追问框。
- `介绍`：一页项目介绍页，用于 3 分钟 PPT 式讲解。

当前建议演示节奏：

1. 前 30 秒展示 wow moment：左边风险点，右边代码证据。
2. 之后切到 `介绍`，讲 Traceback 为什么不是普通 AI 出题工具。
3. 最后回到 Demo，展示 Evidence Check 和持续追问。

## 本地运行

```bash
npm install
cp .env.example .env.local
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

环境变量：

- `OPENAI_API_KEY`: OpenAI-compatible API key。未配置时会生成降级报告。
- `OPENAI_BASE_URL`: OpenAI-compatible endpoint，默认 `https://api.openai.com/v1`。
- `OPENAI_MODEL`: OpenAI-compatible 模型名。若设置，会覆盖所有阶段。
- `GITHUB_TOKEN`: 可选但建议配置，提升 GitHub REST API rate limit。
- `TOKENDANCE_API_KEY`: Tokendance API key，兼容 OpenAI API。
- `TOKENDANCE_BASE_URL`: Tokendance endpoint。
- `TOKENDANCE_CHAT_COMPLETIONS_URL`: Tokendance chat completions 完整 URL。
- `TOKENDANCE_MODEL`: 默认最终生成模型。
- `TOKENDANCE_RESEARCH_MODEL`: Plan / Research 阶段模型。
- `TOKENDANCE_THINKING_TYPE`: DeepSeek V4 thinking 开关；演示建议 `disabled`。

演示优先配置：

```env
OPENAI_MODEL=deepseek-v4-flash
TOKENDANCE_MODEL=deepseek-v4-flash
TOKENDANCE_RESEARCH_MODEL=deepseek-v4-flash
TOKENDANCE_THINKING_TYPE=disabled
```

## 技术栈

- Next.js 16 App Router
- React 19
- TypeScript
- GitHub REST API
- OpenAI-compatible LLM API
- SSE 流式进度
- Zod schema 校验
- Vitest 单元测试

## 当前取舍

- 不做 Survey / Practice / Test 三模块作为主入口。
- 不做泛题库页面。
- 不把 `kaomian` 当八股题库直接塞题，只作为真实面经问题素材，且必须绑定 repo 证据。
- 不做评分和整场复盘，先把“问题是否抓得准、证据是否够硬”验证出来。
- 不做完整 GitHub IDE，右侧 viewer 第一版展示分析时打包的 evidence snippets。

## 文档

- `docs/ARCHITECTURE.md`: Traceback agent pipeline 与系统架构。
- `docs/demo-video-script.md`: 3 分钟演示讲稿。
- `PRODUCT_MEMO.md`: 产品说明与提交材料草稿。
- `ROADMAP.md`: 产品收缩后的路线图。
- `V1.0.0_PLAN.md`: V1 计划。
- `VERSION_WORKLOG.md`: 版本演化记录。
- `CHANGELOG.md`: 对外变更日志。
- `AGENTS.md`: 当前工程约束与智能体工作规则。
- `docs/DEPLOYMENT.md`: 部署指南。
- `docs/adr/`: 架构决策记录。
