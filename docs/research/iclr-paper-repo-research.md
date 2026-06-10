# ICLR / AI Paper Repo 结构调研

本调研用于支撑 `v1.0.0-alpha.1`：把 GitHub repo 理解从通用软件工程审查改成 AI 算法岗项目考核。

核心结论：

> 论文 / AI 项目制代码库不是先看“工程质量”，而是先看 paper claim 是否能落到方法代码、训练配置、数据处理、评测脚本和复现路径上。

## 样本仓库

| 仓库 | 观察重点 |
| --- | --- |
| `mrflogs/ICLR24` | README、DATASET、configs、datasets、main scripts 很关键，配置数量远多于入口文件。 |
| `twni2016/self-predictive-rl` | RL 仓库按实验环境拆分，linear / minigrid / mujoco 的入口和评测要分开读。 |
| `pickxiguapi/Clean-Offline-RLHF` | RLHF 仓库高度 configs-heavy，算法、训练脚本和 rlhf pipeline 是主证据。 |
| `mlvlab/DDMI` | diffusion / INR 项目里 method、eval、configs、data 同时重要。 |
| `Visual-AI/FROSTER` | open-vocab video/action 项目包含大量 labels、CSV、benchmark 文件，必须限制数据文件数量。 |
| `MS-Diffusion/MS-Diffusion` | diffusion personalization 项目重点是 inference、config、models、dataset、train script。 |
| `ASK-Berkeley/MLFF-distill` | scientific ML 仓库常见大量 configs 和 scripts，核心代码不一定在顶层。 |
| `deepseek-ai/DreamCraft3D` | 3D generation 仓库有 staged commands、configs、launch、preprocess 和 method modules。 |
| `lmb-freiburg/ovqa` | VQA benchmark 仓库重点是 reproduce、metrics、datasets 和评测协议。 |
| `HHenryD/TAP` | VLM prompt learning 仓库重点是 train.py、configs、requirements 和 prompt / model 逻辑。 |

## 对 Pipeline 的要求

Step 1 必须是“论文项目理解”，而不是通用 repo summary。它要先判断这个 repo 更像 benchmark、training、inference、method、data 还是 reproduce 仓库，再决定优先理解哪些证据。

文件选择必须覆盖这些 bucket：

- `paperDocs`：README、paper、arXiv、citation、project page。
- `configFiles`：configs、hydra、yaml、requirements、pyproject、environment。
- `trainingFiles`：train、pretrain、finetune、launch、main、run。
- `demoFiles`：infer、inference、demo、sample、generate、predict。
- `evaluationFiles`：eval、benchmark、metric、ablation、reproduce、results。
- `dataFiles`：datasets、dataloader、preprocess、tokenizer、labels、annotations。
- `methodFiles`：models、losses、algorithms、methods、diffusion、agent、RLHF、RAG、policy、reward。
- `scripts`：scripts、slurm、jobs、notebooks。

每个 bucket 需要上限。原因是 FROSTER 这类 benchmark 仓库会出现大量 label / CSV / annotation 文件，如果只按关键词打分，模型会读到很多数据文件，却看不到真正的方法实现。

## 轻量 Skill Registry

alpha.1 先把 skill 作为理解策略写进 prompt 和 pipeline，不单独做插件系统。后续可以逐个替换成更强的专门 agent。

| Skill | 适用仓库 | 必须理解的证据 | 典型追问 |
| --- | --- | --- | --- |
| `benchmark-skill` | benchmark / eval / VQA / leaderboard repo | dataset、metric、baseline、eval script、reproduce、result files | 指标是否支撑 claim？有没有 data leakage？baseline 是否公平？ |
| `training-skill` | train / finetune / RLHF / diffusion repo | train entry、loss、optimizer、scheduler、config、seed、checkpoint、dataloader | 关键超参为什么这样设？结果不稳定先查哪里？ |
| `inference-skill` | inference / demo / generation repo | weights、sampling、prompt、postprocess、demo script、runtime constraint | 推理失败样例是什么？速度 / 显存 / sampling 怎么取舍？ |
| `method-skill` | model / algorithm / agent / RAG repo | model、loss、policy、reward、retrieval、agent loop、tool、memory | 方法为什么成立？更简单 baseline 能不能打平？ |
| `data-skill` | dataset / preprocess / annotation repo | raw data、cleaning、split、tokenizer、label、annotation | 数据分布是否合理？split 是否泄漏？标签噪声怎么处理？ |
| `reproduce-skill` | reproduce / scripts / configs-heavy repo | command chain、environment、configs、scripts、logs、results | 其他人能否复现？缺哪些依赖、权重或命令？ |

一个仓库可以命中多个 skill。skill 的输出必须回到文件证据，不能只凭 README 或仓库名推断。

## 对 LLM 审查的要求

第一步仓库理解应该输出：

- 问题设定。
- Paper / README claim。
- 训练、推理、评测入口。
- 方法概念到代码文件的映射。
- 数据处理和配置超参。
- baseline、ablation、metric、benchmark 证据。
- 复现风险。

第二步面试审查应该优先追问：

- method validity：方法为什么成立。
- baseline / ablation：是否有更简单方法能打平。
- data leakage：数据处理和评测是否泄漏。
- metric choice：指标是否真的支撑 claim。
- config / hyperparameter：关键配置和默认值为什么这样设。
- reproducibility：别人能不能按仓库复现结果。
- failure cases：方法在哪类样本或场景会失败。
- paper-code consistency：README / paper 说的东西是否真的在代码里。

## alpha.1 决策

- 输入不变：仍然只输入公开 GitHub 仓库链接。
- 自动识别 `paper-code` / `general-code` / `unknown`。
- Step 1 使用轻量 skill registry 做论文项目理解，后续可替换成更高级 skill。
- API 增加 `analysisMode`、`paperSignals`、`researchArtifacts`、`paperCodeMap`。
- 报告主线改成“paper claim -> code evidence -> experiment evidence -> interview risk”。
- `kaomian`、一句话自述、arXiv、JD 全部后置。
