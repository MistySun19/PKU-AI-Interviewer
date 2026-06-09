import type { AnalyzeResponse, ExamPoint, InterviewQuestion, RepoContext, Understanding } from "./types";

export function buildMarkdownReport(result: Omit<AnalyzeResponse, "markdownReport">): string {
  const lines: string[] = [];
  const { repo, understanding, examPoints, questions, evidenceFiles, warnings } = result;

  lines.push(`# ${repo.fullName} 项目考核面试计划`);
  lines.push("");
  lines.push("## 1. 仓库摘要");
  lines.push("");
  lines.push(`- 仓库：${repo.htmlUrl}`);
  lines.push(`- 默认分支：${repo.defaultBranch}`);
  lines.push(`- 主要语言：${repo.language ?? "未知"}`);
  lines.push(`- Stars：${repo.stars}`);
  lines.push(`- 文件数量：${repo.fileCount}`);
  if (repo.description) lines.push(`- GitHub 描述：${repo.description}`);
  lines.push("");
  lines.push(understanding.summary);
  lines.push("");

  lines.push("## 2. 项目主流程理解");
  lines.push("");
  pushList(lines, understanding.mainFlow);

  lines.push("## 3. 核心模块地图");
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

  lines.push("## 4. 面试官视角总结");
  lines.push("");
  lines.push(`- 技术栈：${understanding.techStack.join("、") || "未明确识别"}`);
  lines.push(`- 入口文件：${understanding.entryPoints.join("、") || "未明确识别"}`);
  lines.push(`- 数据流：${understanding.dataFlow.join(" -> ") || "未明确识别"}`);
  lines.push(`- 测试/评测信号：${understanding.evaluationSignals.join("、") || "未发现明显测试或评测"}`);
  lines.push(`- 部署/运行信号：${understanding.deploymentNotes.join("、") || "未发现明显部署说明"}`);
  lines.push(`- 潜在贡献点：${understanding.contributionHypotheses.join("、") || "需要候选人现场说明"}`);
  lines.push("");

  lines.push("## 5. 项目考核点");
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

  lines.push("## 6. 分层面试题");
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

  lines.push("## 7. 面试前补坑建议");
  lines.push("");
  const fixHints = buildFixHints(examPoints, understanding);
  pushList(lines, fixHints);

  lines.push("## 8. 证据文件列表");
  lines.push("");
  evidenceFiles.forEach((file) => {
    lines.push(`- ${file.path} (${file.reason}${file.truncated ? "，已截断" : ""})`);
  });

  if (warnings.length > 0) {
    lines.push("");
    lines.push("## 9. Alpha 注意事项");
    lines.push("");
    pushList(lines, warnings);
  }

  return lines.join("\n");
}

export function fallbackUnderstanding(context: RepoContext): Understanding {
  const filePaths = context.files.map((file) => file.path);
  const techStack = inferTechStack(filePaths, context.repo.language);
  const entryPoints = filePaths.filter((path) => /(main|index|app|server|cli|train|infer|evaluate|eval)\.(ts|tsx|js|jsx|py|go|rs)$/i.test(path)).slice(0, 6);
  const evalSignals = filePaths.filter((path) => /(test|spec|eval|benchmark|metric)/i.test(path)).slice(0, 8);

  return {
    summary: `${context.repo.fullName} 是一个以 ${techStack.join("、") || context.repo.language || "未知技术栈"} 为主的公开仓库。当前报告基于文件结构和关键文件生成，建议在配置模型后获得更细的语义分析。`,
    techStack,
    entryPoints,
    coreModules: filePaths
      .filter((path) => /(src|lib|app|backend|server|core|agent|rag|model|eval|train)/i.test(path))
      .slice(0, 6)
      .map((path) => ({
        name: path,
        responsibility: "根据路径判断是候选人需要能解释的核心文件或模块。",
        evidence: [path]
      })),
    mainFlow: [
      "从 README 和入口文件确认项目目标与运行方式。",
      "沿入口文件进入核心模块，解释输入、处理和输出。",
      "检查测试、评测或示例，说明项目如何证明自己有效。"
    ],
    dataFlow: entryPoints.length > 0 ? entryPoints : filePaths.slice(0, 4),
    evaluationSignals: evalSignals,
    deploymentNotes: filePaths.filter((path) => /(docker|compose|deploy|vercel|next\.config|requirements|package\.json)/i.test(path)).slice(0, 6),
    contributionHypotheses: ["核心模块实现", "评测/测试设计", "工程组织与异常处理"]
  };
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
      "为什么这样拆模块，而不是放在主流程里？",
      "如果线上失败，你会先看哪里？"
    ]
  }));

  points.unshift({
    title: "项目目标和主流程是否讲得清",
    riskLevel: "medium",
    evidence: evidence.slice(0, 2),
    whyAsk: "项目考核的第一步是确认候选人能不能从仓库证据讲清这个项目到底做什么。",
    followUps: ["这个项目解决什么问题？", "主流程从哪个文件开始？", "输入、处理、输出分别是什么？"]
  });

  points.push({
    title: "评测和 bad case 是否充分",
    riskLevel: understanding.evaluationSignals.length > 0 ? "medium" : "high",
    evidence: understanding.evaluationSignals.length > 0 ? understanding.evaluationSignals : evidence.slice(0, 2),
    whyAsk: "研究岗和算法岗面试经常会从项目效果追到评测可信度。",
    followUps: ["有哪些失败样例？", "指标为什么能证明项目有效？", "如果结果不稳定，怎么定位？"]
  });

  points.push(
    {
      title: "核心实现和 README 是否一致",
      riskLevel: "medium",
      evidence: evidence.slice(0, 3),
      whyAsk: "面试官会检查候选人讲的项目故事是否能在仓库里找到对应实现。",
      followUps: ["README 里最关键的承诺对应哪些文件？", "有没有代码和说明不一致的地方？", "如果让你重构一个模块，你会从哪里开始？"]
    },
    {
      title: "失败场景和异常处理是否准备充分",
      riskLevel: "medium",
      evidence: evidence.slice(0, 3),
      whyAsk: "真实面试会从 happy path 追到失败定位和边界条件。",
      followUps: ["这个项目最容易在哪里失败？", "日志、重试、fallback 在哪里？", "如果线上出问题，你怎么定位？"]
    },
    {
      title: "候选人的真实贡献点是否可验证",
      riskLevel: "high",
      evidence: evidence.slice(0, 3),
      whyAsk: "实习和保研场景都会追问候选人到底做了项目里的哪一块。",
      followUps: ["你最熟悉哪个模块？", "这块为什么是你做的？", "面试官打开代码时你会带他看哪几处？"]
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
      expectedAnswer: ["能指出代码证据", "能解释设计选择", "能说明替代方案和取舍"],
      redFlags: ["只复述项目简介", "说不出核心文件作用", "无法解释失败场景"],
      followUps: point.followUps
    },
    {
      question: `如果面试官继续追问「${point.title}」里的失败场景，你会怎么回答？`,
      difficulty: point.riskLevel === "high" ? "hard" : "medium",
      evidence: point.evidence,
      whyAsk: "连续追问会测试候选人是否真的做过项目，并能把实现、原理和排错连接起来。",
      expectedAnswer: ["能给出具体失败例子", "能说明定位步骤", "能回到仓库证据解释"],
      redFlags: ["只说理论", "没有 bad case", "无法指出相关文件"],
      followUps: ["如果数据或输入变了怎么办？", "如果评测指标下降你先查什么？", "有没有更简单的替代实现？"]
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
    "准备一条从入口文件到核心模块的 90 秒讲解。",
    "为每个核心模块准备“为什么这样设计”和“替代方案是什么”。",
    "给测试/评测补充 bad case 和失败定位思路。"
  ];
  if (understanding.evaluationSignals.length === 0) {
    hints.push("仓库里缺少明显评测信号，建议准备一段如何验证项目效果的回答。");
  }
  if (points.some((point) => point.riskLevel === "high")) {
    hints.push("优先补齐高风险考核点，否则面试时容易被连续追问。");
  }
  return hints;
}
