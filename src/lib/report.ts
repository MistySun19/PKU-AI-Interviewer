import type { AnalyzeResponse, ExamPoint, InterviewQuestion, PaperCodeMapItem, RepoContext, Understanding } from "./types";

export function buildMarkdownReport(result: Omit<AnalyzeResponse, "markdownReport">): string {
  const lines: string[] = [];
  const { repo, analysisMode, paperSignals, researchArtifacts, paperCodeMap, understanding, examPoints, questions, evidenceFiles, warnings } = result;

  lines.push(`# ${repo.fullName} AI 算法岗项目考核面试计划`);
  lines.push("");
  lines.push("## 1. 仓库 / 论文身份识别");
  lines.push("");
  lines.push(`- 仓库：${repo.htmlUrl}`);
  lines.push(`- 分析模式：${analysisMode}`);
  lines.push(`- 默认分支：${repo.defaultBranch}`);
  lines.push(`- 主要语言：${repo.language ?? "未知"}`);
  lines.push(`- Stars：${repo.stars}`);
  lines.push(`- 文件数量：${repo.fileCount}`);
  if (repo.description) lines.push(`- GitHub 描述：${repo.description}`);
  lines.push(`- 会议 / 论文信号：${paperSignals.venues.join("、") || "未明显识别"}`);
  lines.push(`- 论文链接：${paperSignals.paperLinks.join("、") || "未明显识别"}`);
  lines.push(`- Citation / official code：${paperSignals.citationFound ? "有 citation" : "未识别 citation"}；${paperSignals.officialImplementation ? "疑似官方实现" : "未识别官方实现声明"}`);
  lines.push("");
  lines.push(understanding.summary);
  lines.push("");

  lines.push("## 2. Paper Claim 摘要");
  lines.push("");
  lines.push(`- 问题设定：${understanding.problemSetting || "未明确识别"}`);
  pushList(lines, understanding.paperClaims);

  lines.push("## 3. 训练、推理、评测复现路线");
  lines.push("");
  lines.push("- 主流程：");
  pushList(lines, understanding.mainFlow);
  lines.push("- 复现路线：");
  pushList(lines, understanding.reproductionRecipe);
  lines.push("- 关键超参 / 配置：");
  pushList(lines, understanding.keyHyperparameters);

  lines.push("## 4. 核心方法代码地图");
  lines.push("");
  if (understanding.coreModules.length === 0) {
    lines.push("- 未识别到明确核心模块。");
  } else {
    for (const module of understanding.coreModules) {
      lines.push(`- **${module.name}**：${module.responsibility}`);
      lines.push(`  - 证据：${module.evidence.join("、") || "未提供"}`);
    }
  }
  lines.push("");
  lines.push("- 方法概念到代码证据：");
  pushList(lines, understanding.methodCodeMap);

  lines.push("## 5. 实验与评测证据地图");
  lines.push("");
  lines.push(`- 技术栈：${understanding.techStack.join("、") || "未明确识别"}`);
  lines.push(`- 入口文件：${understanding.entryPoints.join("、") || "未明确识别"}`);
  lines.push(`- 数据流：${understanding.dataFlow.join(" -> ") || "未明确识别"}`);
  lines.push(`- 测试/评测信号：${understanding.evaluationSignals.join("、") || "未发现明显测试或评测"}`);
  lines.push(`- 实验证据：${understanding.experimentEvidence.join("、") || "未发现明确实验/消融证据"}`);
  lines.push(`- 推理/demo/运行信号：${understanding.deploymentNotes.join("、") || "未发现明显运行说明"}`);
  lines.push(`- 潜在贡献点：${understanding.contributionHypotheses.join("、") || "需要候选人现场说明"}`);
  lines.push("");

  lines.push("## 6. Paper Claim -> Code Evidence -> Interview Risk");
  lines.push("");
  if (paperCodeMap.length === 0) {
    lines.push("- 未形成明确 paper-code 映射。");
  } else {
    paperCodeMap.forEach((item, index) => {
      lines.push(`### ${index + 1}. ${item.claim}`);
      lines.push("");
      lines.push(`- 代码证据：${item.codeEvidence.join("、") || "未提供"}`);
      lines.push(`- 实验/评测证据：${item.experimentEvidence.join("、") || "未提供"}`);
      lines.push(`- 面试风险：${item.interviewRisk}`);
    });
  }
  lines.push("");

  lines.push("## 7. 项目考核点");
  lines.push("");
  examPoints.forEach((point, index) => {
    lines.push(`### ${index + 1}. ${point.title}`);
    lines.push("");
    lines.push(`- 风险等级：${point.riskLevel}`);
    lines.push(`- 证据：${point.evidence.join("、") || "未提供"}`);
    lines.push(`- 为什么会问：${point.whyAsk}`);
    lines.push("- 可能追问：");
    pushList(lines, point.followUps);
  });

  lines.push("## 8. 分层面试题");
  lines.push("");
  questions.forEach((question, index) => {
    lines.push(`### ${index + 1}. ${question.question}`);
    lines.push("");
    lines.push(`- 难度：${question.difficulty}`);
    lines.push(`- 证据：${question.evidence.join("、") || "未提供"}`);
    lines.push(`- 为什么问：${question.whyAsk}`);
    lines.push("- 期望回答要点：");
    pushList(lines, question.expectedAnswer);
    lines.push("- 红旗回答：");
    pushList(lines, question.redFlags);
    lines.push("- 后续追问：");
    pushList(lines, question.followUps);
  });

  lines.push("## 9. 红旗回答与面试前补坑建议");
  lines.push("");
  const fixHints = buildFixHints(examPoints, understanding);
  pushList(lines, fixHints);

  lines.push("## 10. 证据文件列表");
  lines.push("");
  lines.push(`- Paper/docs：${researchArtifacts.paperDocs.join("、") || "未明显识别"}`);
  lines.push(`- Method：${researchArtifacts.methodFiles.join("、") || "未明显识别"}`);
  lines.push(`- Train：${researchArtifacts.trainingFiles.join("、") || "未明显识别"}`);
  lines.push(`- Eval：${researchArtifacts.evaluationFiles.join("、") || "未明显识别"}`);
  lines.push(`- Config：${researchArtifacts.configFiles.join("、") || "未明显识别"}`);
  lines.push(`- Data：${researchArtifacts.dataFiles.join("、") || "未明显识别"}`);
  lines.push(`- Demo：${researchArtifacts.demoFiles.join("、") || "未明显识别"}`);
  lines.push(`- Scripts：${researchArtifacts.scripts.join("、") || "未明显识别"}`);
  lines.push("");
  evidenceFiles.forEach((file) => {
    lines.push(`- ${file.path} (${file.category}；${file.reason}${file.truncated ? "，已截断" : ""})`);
  });

  if (warnings.length > 0) {
    lines.push("");
    lines.push("## 11. Alpha 注意事项");
    lines.push("");
    pushList(lines, warnings);
  }

  return lines.join("\n");
}

export function fallbackUnderstanding(context: RepoContext): Understanding {
  const filePaths = context.files.map((file) => file.path);
  const techStack = inferTechStack(filePaths, context.repo.language);
  const entryPoints = filePaths.filter((path) => /(main|train|pretrain|finetune|launch|run|infer|inference|evaluate|eval|benchmark)\.(ts|tsx|js|jsx|py|go|rs|sh)$/i.test(path)).slice(0, 8);
  const evalSignals = filePaths.filter((path) => /(test|spec|eval|benchmark|metric)/i.test(path)).slice(0, 8);
  const artifacts = context.researchArtifacts;

  return {
    analysisMode: context.analysisMode,
    paperSignals: context.paperSignals,
    summary: `${context.repo.fullName} 已按 ${context.analysisMode} 模式生成降级报告。当前报告基于 README、文件结构和关键文件分类，优先围绕方法、训练、评测和复现来准备算法岗项目深挖。`,
    problemSetting: context.paperSignals.venues.length > 0 ? `仓库包含 ${context.paperSignals.venues.join("、")} 等论文信号，需要按论文项目实现来解释问题设定。` : "README 中未稳定抽取问题设定，需要候选人补充论文动机和任务定义。",
    paperClaims: [
      context.repo.description ?? "README / GitHub 描述未给出明确 claim。",
      ...context.paperSignals.paperLinks.map((link) => `存在论文链接证据：${link}`)
    ].slice(0, 5),
    techStack,
    entryPoints,
    coreModules: filePaths
      .filter((path) => /(models?|modules?|loss|criterion|algorithm|method|diffusion|agent|rlhf|rag|train|eval|dataset|dataloader)/i.test(path))
      .slice(0, 8)
      .map((path) => ({
        name: path,
        responsibility: "根据路径判断是方法实现、训练评测或数据处理相关文件，候选人需要能解释其论文/项目作用。",
        evidence: [path]
      })),
    mainFlow: [
      "从 README / paper docs 确认任务、方法 claim 和复现入口。",
      "沿训练或推理入口进入模型、loss、数据处理和配置文件。",
      "检查 eval、benchmark、metric 或 reproduce 脚本，说明结果如何支撑 claim。"
    ],
    dataFlow: entryPoints.length > 0 ? entryPoints : filePaths.slice(0, 4),
    evaluationSignals: evalSignals,
    reproductionRecipe: [...artifacts.paperDocs, ...artifacts.configFiles, ...artifacts.trainingFiles, ...artifacts.evaluationFiles].slice(0, 10),
    methodCodeMap: artifacts.methodFiles.slice(0, 8).map((path) => `方法实现候选文件：${path}`),
    experimentEvidence: [...artifacts.evaluationFiles, ...artifacts.configFiles].slice(0, 8),
    keyHyperparameters: artifacts.configFiles.slice(0, 8),
    deploymentNotes: [...artifacts.demoFiles, ...artifacts.scripts].slice(0, 6),
    contributionHypotheses: ["核心方法实现", "训练配置与超参选择", "评测/消融设计", "数据处理与 bad case 分析"]
  };
}

export function fallbackPaperCodeMap(context: RepoContext, understanding: Understanding): PaperCodeMapItem[] {
  const methodEvidence = context.researchArtifacts.methodFiles.length > 0 ? context.researchArtifacts.methodFiles : understanding.coreModules.flatMap((module) => module.evidence);
  const experimentEvidence = [...context.researchArtifacts.evaluationFiles, ...context.researchArtifacts.configFiles];
  const claims = understanding.paperClaims.length > 0 ? understanding.paperClaims : [understanding.summary];

  return claims.slice(0, 5).map((claim) => ({
    claim,
    codeEvidence: methodEvidence.slice(0, 3),
    experimentEvidence: experimentEvidence.slice(0, 3),
    interviewRisk: "需要候选人说明该 claim 在代码中的实现位置，以及训练/评测证据是否足以支撑。"
  }));
}

export function fallbackExamPoints(understanding: Understanding): ExamPoint[] {
  const fallbackEvidence = [
    ...understanding.entryPoints,
    ...understanding.dataFlow,
    ...understanding.coreModules.flatMap((module) => module.evidence)
  ].filter(Boolean);
  const evidence = fallbackEvidence.length > 0 ? fallbackEvidence : ["README"];
  const modules = understanding.coreModules.slice(0, 5);
  const points: ExamPoint[] = modules.map((module) => ({
    title: `解释 ${module.name} 的设计理由`,
    riskLevel: "medium",
    evidence: module.evidence.length > 0 ? module.evidence : evidence.slice(0, 1),
    whyAsk: "面试官会用核心模块判断候选人是否真的理解项目，而不是只会复述 README。",
    followUps: [
      "这个模块的输入和输出是什么？",
      "它对应论文或项目 claim 里的哪一部分？",
      "如果实验结果复现不出来，你会先看哪个配置或数据处理环节？"
    ]
  }));

  points.unshift({
    title: "论文/项目 claim 和代码实现是否能对上",
    riskLevel: "medium",
    evidence: evidence.slice(0, 2),
    whyAsk: "算法岗项目考核会先确认候选人能不能把方法 claim、代码实现和实验结果串起来。",
    followUps: ["这个项目解决什么任务？", "最核心的 claim 对应哪些文件？", "训练、推理、评测分别从哪里开始？"]
  });

  points.push({
    title: "评测、消融和 bad case 是否支撑方法 claim",
    riskLevel: understanding.evaluationSignals.length > 0 ? "medium" : "high",
    evidence: understanding.evaluationSignals.length > 0 ? understanding.evaluationSignals : evidence.slice(0, 2),
    whyAsk: "研究岗和算法岗面试经常会从项目效果追到 baseline、metric、ablation 和数据泄漏风险。",
    followUps: ["有哪些 baseline 或 ablation？", "指标为什么能证明方法有效？", "如果结果不稳定，先查 seed、数据还是配置？"]
  });

  points.push(
    {
      title: "核心实现和 README / paper 描述是否一致",
      riskLevel: "medium",
      evidence: evidence.slice(0, 3),
      whyAsk: "面试官会检查候选人讲的项目故事是否能在仓库里找到对应实现。",
      followUps: ["README 里最关键的承诺对应哪些文件？", "有没有代码和说明不一致的地方？", "如果让你复现实验，你会先跑哪条命令？"]
    },
    {
      title: "失败场景、数据边界和指标退化是否准备充分",
      riskLevel: "medium",
      evidence: evidence.slice(0, 3),
      whyAsk: "真实面试会从 happy path 追到数据分布、评测指标和方法局限。",
      followUps: ["这个方法最容易在哪类样本上失败？", "指标退化时先查数据、模型还是评测脚本？", "有没有更简单的 baseline 能打平？"]
    },
    {
      title: "候选人的真实贡献点是否可验证",
      riskLevel: "high",
      evidence: evidence.slice(0, 3),
      whyAsk: "实习和保研场景都会追问候选人到底做了方法、实验、数据还是工程封装里的哪一块。",
      followUps: ["你最熟悉哪个方法或实验模块？", "这块为什么是你做的？", "面试官打开代码时你会带他看哪几处？"]
    }
  );

  return points.slice(0, 8);
}

export function fallbackQuestions(examPoints: ExamPoint[]): InterviewQuestion[] {
  const questions = examPoints.flatMap((point): InterviewQuestion[] => [
    {
      question: `${point.title}：你会怎么向面试官解释？`,
      difficulty: "medium",
      evidence: point.evidence,
      whyAsk: point.whyAsk,
      expectedAnswer: ["能指出代码证据", "能解释方法或实验设计选择", "能说明 baseline、替代方案和取舍"],
      redFlags: ["只复述项目简介", "说不出核心文件作用", "无法解释实验或失败场景"],
      followUps: point.followUps
    },
    {
      question: `如果面试官继续追问「${point.title}」里的失败场景，你会怎么回答？`,
      difficulty: point.riskLevel === "high" ? "hard" : "medium",
      evidence: point.evidence,
      whyAsk: "连续追问会测试候选人是否真的做过项目，并能把实现、原理和排错连接起来。",
      expectedAnswer: ["能给出具体失败例子", "能说明从数据、配置、模型、指标逐步定位", "能回到仓库证据解释"],
      redFlags: ["只说理论", "没有 bad case", "无法指出相关文件"],
      followUps: ["如果数据分布变了怎么办？", "如果评测指标下降你先查什么？", "有没有更简单的 baseline？"]
    }
  ]);

  return questions.slice(0, 12);
}

function pushList(lines: string[], items: string[]) {
  if (items.length === 0) {
    lines.push("- 未明确识别。");
  } else {
    for (const item of items) lines.push(`- ${item}`);
  }
  lines.push("");
}

function inferTechStack(paths: string[], primary: string | null): string[] {
  const stack = new Set<string>();
  if (primary) stack.add(primary);
  if (paths.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"))) stack.add("TypeScript");
  if (paths.some((path) => path.endsWith(".py"))) stack.add("Python");
  if (paths.some((path) => path.endsWith(".ipynb"))) stack.add("Jupyter Notebook");
  if (paths.some((path) => /package\.json$/i.test(path))) stack.add("Node.js");
  if (paths.some((path) => /requirements\.txt|pyproject\.toml/i.test(path))) stack.add("Python ecosystem");
  if (paths.some((path) => /dockerfile|compose/i.test(path))) stack.add("Docker");
  return [...stack];
}

function buildFixHints(points: ExamPoint[], understanding: Understanding): string[] {
  const hints = [
    "准备一条从 paper claim 到方法代码再到实验结果的 90 秒讲解。",
    "为每个核心方法模块准备“为什么这样设计”和“替代 baseline 是什么”。",
    "给评测补充 baseline、ablation、bad case 和失败定位思路。"
  ];
  if (understanding.evaluationSignals.length === 0) {
    hints.push("仓库里缺少明显评测信号，建议准备一段如何验证项目效果的回答。");
  }
  if (points.some((point) => point.riskLevel === "high")) {
    hints.push("优先补齐高风险考核点，否则面试时容易被连续追问。");
  }
  return hints;
}
